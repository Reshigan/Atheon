// workers/api/src/routes/assessments.ts
// Pre-Assessment Tool API — superadmin only
import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import {
  runAssessment,
  DEFAULT_ASSESSMENT_CONFIG,
  type AssessmentConfig,
} from '../services/assessment-engine';

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
  const tenantId = auth!.tenantId;

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

  const assessment = await c.env.DB.prepare(
    'SELECT business_report_key, prospect_name FROM assessments WHERE id = ?'
  ).bind(c.req.param('id')).first<Record<string, unknown>>();

  if (!assessment || !assessment.business_report_key) {
    return c.json({ error: 'Report not available' }, 404);
  }

  const obj = await c.env.STORAGE.get(assessment.business_report_key as string);
  if (!obj) return c.json({ error: 'Report file not found' }, 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${assessment.prospect_name}-business-case.pdf"`,
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
      'Content-Disposition': `attachment; filename="${assessment.prospect_name}-technical-sizing.pdf"`,
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
      'Content-Disposition': `attachment; filename="${assessment.prospect_name}-model.xlsx"`,
    },
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
