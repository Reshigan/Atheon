// workers/api/src/routes/assessments.ts
// Pre-Assessment Tool API — superadmin only
import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import {
  runAssessment,
  DEFAULT_ASSESSMENT_CONFIG,
  type AssessmentConfig,
} from '../services/assessment-engine';
import {
  runValueAssessment,
  generateValueReportPDF,
  DEFAULT_VALUE_ASSESSMENT_CONFIG,
  type ValueAssessmentConfig,
} from '../services/value-assessment-engine';

const assessments = new Hono<AppBindings>();

function requireSuperAdmin(auth: AuthContext | undefined): boolean {
  return auth?.role === 'superadmin';
}

// ── GET /api/assessments — list all assessments ───────────────────────────
assessments.get('/', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const results = await c.env.DB.prepare(`
    SELECT a.*, t.name as tenant_name
    FROM assessments a
    JOIN tenants t ON a.tenant_id = t.id
    ORDER BY a.created_at DESC
  `).all<Record<string, unknown>>();

  return c.json({
    assessments: results.results.map(formatAssessment),
    total: results.results.length
  });
});

// ── POST /api/assessments — create + run assessment ───────────────────────
assessments.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{
    prospect_name: string;
    prospect_industry: string;
    erp_connection_id?: string;
    config: AssessmentConfig;
  }>();

  if (!body.prospect_name || !body.prospect_industry) {
    return c.json({ error: 'prospect_name and prospect_industry are required' }, 400);
  }

  const id = crypto.randomUUID();
  const config = { ...DEFAULT_ASSESSMENT_CONFIG, ...body.config };

  // For pre-assessment: resolve tenant_id from the ERP connection so we query
  // the prospect's data, not the superadmin's home tenant.
  let tenantId = auth!.tenantId;
  if (body.erp_connection_id) {
    const conn = await c.env.DB.prepare(
      'SELECT tenant_id FROM erp_connections WHERE id = ?'
    ).bind(body.erp_connection_id).first<{ tenant_id: string }>();
    if (conn) tenantId = conn.tenant_id;
  }

  await c.env.DB.prepare(`
    INSERT INTO assessments (id, tenant_id, prospect_name, prospect_industry, erp_connection_id, status, config, created_by)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(
    id,
    tenantId,
    body.prospect_name,
    body.prospect_industry,
    body.erp_connection_id || null,
    JSON.stringify(config),
    auth!.userId
  ).run();

  // Run assessment in background (use waitUntil for Cloudflare Workers)
  const assessmentPromise = runAssessment(
    c.env.DB,
    c.env.AI,
    c.env.STORAGE,
    tenantId,
    id,
    body.erp_connection_id || '',
    config,
    body.prospect_industry,
    body.prospect_name,
  );

  c.executionCtx.waitUntil(assessmentPromise);

  return c.json({ id, status: 'running' }, 201);
});

// ── GET /api/assessments/config/defaults — return default config ──────────
assessments.get('/config/defaults', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const saved = await c.env.CACHE.get('assessment_defaults');
  if (saved) {
    try {
      return c.json(JSON.parse(saved) as AssessmentConfig);
    } catch { /* fall through */ }
  }
  return c.json(DEFAULT_ASSESSMENT_CONFIG);
});

// ── PUT /api/assessments/config/defaults — save default config ────────────
assessments.put('/config/defaults', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const config = await c.req.json<AssessmentConfig>();
  await c.env.CACHE.put('assessment_defaults', JSON.stringify(config));
  return c.json({ success: true });
});

// ── GET /api/assessments/:id — get assessment + results ───────────────────
assessments.get('/:id', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const assessment = await c.env.DB.prepare(`
    SELECT a.*, t.name as tenant_name
    FROM assessments a
    JOIN tenants t ON a.tenant_id = t.id
    WHERE a.id = ?
  `).bind(c.req.param('id')).first<Record<string, unknown>>();

  if (!assessment) return c.json({ error: 'Not found' }, 404);
  return c.json(formatAssessment(assessment));
});

// ── GET /api/assessments/:id/status — polling endpoint ────────────────────
assessments.get('/:id/status', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const assessment = await c.env.DB.prepare(
    'SELECT status, results FROM assessments WHERE id = ?'
  ).bind(c.req.param('id')).first<Record<string, unknown>>();

  if (!assessment) return c.json({ error: 'Not found' }, 404);

  const status = assessment.status as string;
  let progress = 'pending';
  if (status === 'running') progress = 'Processing data...';
  if (status === 'complete') progress = 'Complete';
  if (status === 'failed') {
    const results = JSON.parse(assessment.results as string || '{}');
    progress = results.error || 'Assessment failed';
  }

  return c.json({ status, progress });
});

// ── GET /api/assessments/:id/report/business — download business PDF ──────
assessments.get('/:id/report/business', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const assessmentId = c.req.param('id');
  const assessment = await c.env.DB.prepare(
    'SELECT id, tenant_id, business_report_key, prospect_name FROM assessments WHERE id = ?'
  ).bind(assessmentId).first<Record<string, unknown>>();

  if (!assessment) {
    return c.json({ error: 'Report not available' }, 404);
  }

  let key = assessment.business_report_key as string | null;

  // Fallback: if the key was never set (e.g. seeder failed to generate during
  // bulk insert), regenerate it on demand from the value-summary row. This
  // means the Download Report button works even if seeding had a hiccup.
  if (!key) {
    try {
      const generated = await generateValueReportPDF(
        c.env.DB,
        c.env.STORAGE,
        assessment.tenant_id as string,
        assessment.id as string,
        (assessment.prospect_name as string) || 'Prospect',
        DEFAULT_VALUE_ASSESSMENT_CONFIG,
      );
      if (generated) key = generated;
    } catch (err) {
      console.warn('[Assessments] On-demand report regen failed:', (err as Error).message);
    }
  }

  if (!key) {
    return c.json({ error: 'Report not available' }, 404);
  }

  const obj = await c.env.STORAGE.get(key);
  if (!obj) return c.json({ error: 'Report file not found' }, 404);

  const filenameBase = sanitizeFilename(assessment.prospect_name as string);
  const arrayBuf = await obj.arrayBuffer();

  // HTML report: serve inline so the browser opens it (print-to-PDF available
  // from there). The Value Assessment engine produces A4-styled HTML.
  if (key.endsWith('.html')) {
    return new Response(arrayBuf, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="${filenameBase}-business-case.html"`,
      },
    });
  }

  // PDF path: validate magic bytes before serving.
  const header = new Uint8Array(arrayBuf.slice(0, 5));
  const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46; // %PDF
  if (!isPdf) {
    return c.json({ error: 'Stored report is not a recognised format' }, 415);
  }

  return new Response(arrayBuf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filenameBase}-business-case.pdf"`,
    },
  });
});

// ── GET /api/assessments/:id/report/technical — download technical PDF ────
assessments.get('/:id/report/technical', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const assessment = await c.env.DB.prepare(
    'SELECT technical_report_key, prospect_name FROM assessments WHERE id = ?'
  ).bind(c.req.param('id')).first<Record<string, unknown>>();

  if (!assessment || !assessment.technical_report_key) {
    return c.json({ error: 'Report not available' }, 404);
  }

  const obj = await c.env.STORAGE.get(assessment.technical_report_key as string);
  if (!obj) return c.json({ error: 'Report file not found' }, 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${sanitizeFilename(assessment.prospect_name as string)}-technical-sizing.pdf"`,
    },
  });
});

// ── GET /api/assessments/:id/report/excel — download Excel model ──────────
assessments.get('/:id/report/excel', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const assessment = await c.env.DB.prepare(
    'SELECT excel_model_key, prospect_name FROM assessments WHERE id = ?'
  ).bind(c.req.param('id')).first<Record<string, unknown>>();

  if (!assessment || !assessment.excel_model_key) {
    return c.json({ error: 'Excel model not available' }, 404);
  }

  const obj = await c.env.STORAGE.get(assessment.excel_model_key as string);
  if (!obj) return c.json({ error: 'Excel file not found' }, 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${sanitizeFilename(assessment.prospect_name as string)}-model.xlsx"`,
    },
  });
});

// ── POST /api/assessments/:id/run-value-assessment ────────────────────────
assessments.post('/:id/run-value-assessment', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const assessmentId = c.req.param('id');
  const body = await c.req.json<{ mode?: 'full' | 'quick'; outcomeFeePercent?: number }>().catch(() => ({ mode: undefined as 'full' | 'quick' | undefined, outcomeFeePercent: undefined as number | undefined }));

  const assessment = await c.env.DB.prepare(
    'SELECT * FROM assessments WHERE id = ?'
  ).bind(assessmentId).first<Record<string, unknown>>();
  if (!assessment) return c.json({ error: 'Not found' }, 404);

  const tenantId = assessment.tenant_id as string;
  const config: ValueAssessmentConfig = {
    ...DEFAULT_VALUE_ASSESSMENT_CONFIG,
    mode: body.mode ?? 'full',
    outcomeFeePercent: body.outcomeFeePercent ?? 20,
  };

  // Run in background
  const promise = runValueAssessment(
    c.env.DB, c.env.AI, c.env.STORAGE,
    tenantId, assessmentId,
    (assessment.erp_connection_id as string) || '',
    config,
    (assessment.prospect_industry as string) || 'general',
    (assessment.prospect_name as string) || 'Prospect',
  );
  c.executionCtx.waitUntil(promise);

  return c.json({ id: assessmentId, status: 'running', mode: config.mode }, 200);
});

// ── GET /api/assessments/:id/findings ──────────────────────────────────────
assessments.get('/:id/findings', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const assessmentId = c.req.param('id');
  const category = c.req.query('category');
  const severity = c.req.query('severity');
  const domain = c.req.query('domain');

  let sql = 'SELECT * FROM assessment_findings WHERE assessment_id = ?';
  const binds: unknown[] = [assessmentId];

  if (category) { sql += ' AND category = ?'; binds.push(category); }
  if (severity) { sql += ' AND severity = ?'; binds.push(severity); }
  if (domain) { sql += ' AND domain = ?'; binds.push(domain); }
  sql += ' ORDER BY financial_impact DESC';

  const results = await c.env.DB.prepare(sql).bind(...binds).all<Record<string, unknown>>();
  return c.json({
    findings: (results.results || []).map(f => ({
      ...f,
      evidence: JSON.parse(f.evidence as string || '{}'),
    })),
    total: results.results?.length || 0,
  });
});

// ── GET /api/assessments/:id/data-quality ──────────────────────────────────
assessments.get('/:id/data-quality', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const results = await c.env.DB.prepare(
    'SELECT * FROM assessment_data_quality WHERE assessment_id = ? ORDER BY table_name'
  ).bind(c.req.param('id')).all<Record<string, unknown>>();

  return c.json({
    dataQuality: (results.results || []).map(dq => ({
      ...dq,
      field_scores: JSON.parse(dq.field_scores as string || '{}'),
      issues: JSON.parse(dq.issues as string || '[]'),
    })),
    total: results.results?.length || 0,
  });
});

// ── GET /api/assessments/:id/process-timing ────────────────────────────────
assessments.get('/:id/process-timing', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const results = await c.env.DB.prepare(
    'SELECT * FROM assessment_process_timing WHERE assessment_id = ? ORDER BY process_name'
  ).bind(c.req.param('id')).all<Record<string, unknown>>();

  return c.json({
    processTiming: (results.results || []).map(t => ({
      ...t,
      evidence: JSON.parse(t.evidence as string || '{}'),
    })),
    total: results.results?.length || 0,
  });
});

// ── GET /api/assessments/:id/value-summary ─────────────────────────────────
assessments.get('/:id/value-summary', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const summary = await c.env.DB.prepare(
    'SELECT * FROM assessment_value_summary WHERE assessment_id = ? LIMIT 1'
  ).bind(c.req.param('id')).first<Record<string, unknown>>();

  if (!summary) return c.json({ error: 'No value summary found' }, 404);

  return c.json({
    ...summary,
    value_by_domain: JSON.parse(summary.value_by_domain as string || '{}'),
    value_by_category: JSON.parse(summary.value_by_category as string || '{}'),
  });
});

// ── GET /api/assessments/:id/report/value — download Value Assessment report ──
assessments.get('/:id/report/value', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const assessment = await c.env.DB.prepare(
    'SELECT business_report_key, prospect_name FROM assessments WHERE id = ?'
  ).bind(c.req.param('id')).first<Record<string, unknown>>();

  if (!assessment || !assessment.business_report_key) {
    return c.json({ error: 'Value report not available' }, 404);
  }

  const key = assessment.business_report_key as string;
  const obj = await c.env.STORAGE.get(key);
  if (!obj) return c.json({ error: 'Report file not found' }, 404);

  const filenameBase = sanitizeFilename(assessment.prospect_name as string);
  const arrayBuf = await obj.arrayBuffer();

  if (key.endsWith('.html')) {
    return new Response(arrayBuf, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="${filenameBase}-value-assessment.html"`,
      },
    });
  }

  const header = new Uint8Array(arrayBuf.slice(0, 5));
  const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46;
  if (!isPdf) {
    return c.json({ error: 'Stored report is not a recognised format' }, 415);
  }

  return new Response(arrayBuf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filenameBase}-value-assessment.pdf"`,
    },
  });
});

// ── GET /api/assessments/:id/evidence/:findingId ──────────────────────────
assessments.get('/:id/evidence/:findingId', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const finding = await c.env.DB.prepare(
    'SELECT * FROM assessment_findings WHERE id = ? AND assessment_id = ?'
  ).bind(c.req.param('findingId'), c.req.param('id')).first<Record<string, unknown>>();

  if (!finding) return c.json({ error: 'Finding not found' }, 404);

  return c.json({
    ...finding,
    evidence: JSON.parse(finding.evidence as string || '{}'),
  });
});

// ── DELETE /api/assessments/:id ───────────────────────────────────────────
assessments.delete('/:id', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const assessment = await c.env.DB.prepare(
    'SELECT business_report_key, technical_report_key, excel_model_key FROM assessments WHERE id = ?'
  ).bind(c.req.param('id')).first<Record<string, unknown>>();

  if (!assessment) return c.json({ error: 'Not found' }, 404);

  // Delete stored files
  const keys = [
    assessment.business_report_key,
    assessment.technical_report_key,
    assessment.excel_model_key,
  ].filter(Boolean) as string[];

  for (const key of keys) {
    try { await c.env.STORAGE.delete(key); } catch { /* ignore */ }
  }

  await c.env.DB.prepare('DELETE FROM assessments WHERE id = ?')
    .bind(c.req.param('id')).run();

  return c.json({ success: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────
function sanitizeFilename(name: string): string {
  return name.replace(/["\r\n\\/:*?<>|]/g, '_').slice(0, 100);
}

function formatAssessment(a: Record<string, unknown>) {
  return {
    id: a.id,
    tenantId: a.tenant_id,
    tenantName: a.tenant_name,
    prospectName: a.prospect_name,
    prospectIndustry: a.prospect_industry,
    erpConnectionId: a.erp_connection_id,
    status: a.status,
    config: JSON.parse(a.config as string || '{}'),
    dataSnapshot: JSON.parse(a.data_snapshot as string || '{}'),
    results: JSON.parse(a.results as string || '{}'),
    businessReportKey: a.business_report_key,
    technicalReportKey: a.technical_report_key,
    excelModelKey: a.excel_model_key,
    createdBy: a.created_by,
    createdAt: a.created_at,
    completedAt: a.completed_at,
  };
}

export default assessments;
