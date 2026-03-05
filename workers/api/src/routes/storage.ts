/**
 * R2 Storage Routes - Document upload/download, report generation
 */

import { Hono } from 'hono';
import type { AppBindings } from '../types';
import type { AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';

const storage = new Hono<AppBindings>();

/** Superadmin/support_admin can override tenant via ?tenant_id= query param */
const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || 'vantax';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// GET /api/storage/documents
storage.get('/documents', async (c) => {
  const tenantId = getTenantId(c);
  const docType = c.req.query('type');
  const limit = parseInt(c.req.query('limit') || '50');

  let query = 'SELECT * FROM documents WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (docType) { query += ' AND type = ?'; binds.push(docType); }
  query += ' ORDER BY created_at DESC LIMIT ?';
  binds.push(limit);

  const results = await c.env.DB.prepare(query).bind(...binds).all();

  return c.json({
    documents: results.results.map((d: Record<string, unknown>) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      mimeType: d.mime_type,
      size: d.size,
      r2Key: d.r2_key,
      uploadedBy: d.uploaded_by,
      createdAt: d.created_at,
    })),
    total: results.results.length,
  });
});

// POST /api/storage/documents - Upload a document
storage.post('/documents', async (c) => {
  const contentType = c.req.header('Content-Type') || '';

  let fileName: string;
  let fileData: ArrayBuffer;
  let mimeType: string;
  const tenantId = getTenantId(c);
  let docType: string;
  let uploadedBy: string | null = null;

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return c.json({ error: 'No file provided' }, 400);

    fileName = file.name;
    fileData = await file.arrayBuffer();
    mimeType = file.type || 'application/octet-stream';
    docType = (formData.get('type') as string) || 'document';
    uploadedBy = formData.get('uploaded_by') as string | null;
  } else {
    // JSON body with base64 encoded file
    const body = await c.req.json<{
      name: string; type?: string; mime_type?: string;
      data: string; uploaded_by?: string;
    }>();

    if (!body.name || !body.data) return c.json({ error: 'name and data are required' }, 400);

    fileName = body.name;
    mimeType = body.mime_type || 'application/octet-stream';
    docType = body.type || 'document';
    uploadedBy = body.uploaded_by || null;

    // Decode base64
    const binaryStr = atob(body.data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    fileData = bytes.buffer;
  }

  const id = crypto.randomUUID();
  const r2Key = `${tenantId}/${docType}/${id}/${fileName}`;

  // Upload to R2 if binding available, otherwise store metadata only
  let stored = false;
  if (c.env.STORAGE) {
    try {
      await c.env.STORAGE.put(r2Key, fileData, {
        httpMetadata: { contentType: mimeType },
        customMetadata: { tenantId, docType, uploadedBy: uploadedBy || 'system' },
      });
      stored = true;
    } catch (err) {
      console.error('R2 upload error:', err);
    }
  }

  // Store document metadata in D1
  await c.env.DB.prepare(
    'INSERT INTO documents (id, tenant_id, name, type, mime_type, size, r2_key, uploaded_by, stored_in_r2, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
  ).bind(id, tenantId, fileName, docType, mimeType, fileData.byteLength, r2Key, uploadedBy, stored ? 1 : 0).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), tenantId, 'document.uploaded', 'storage', id,
    JSON.stringify({ name: fileName, type: docType, size: fileData.byteLength, r2: stored }),
    'success',
  ).run();

  return c.json({
    id, name: fileName, type: docType, mimeType, size: fileData.byteLength,
    r2Key, storedInR2: stored,
  }, 201);
});

// GET /api/storage/documents/:id - Download a document
storage.get('/documents/:id', async (c) => {
  const id = c.req.param('id');
  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first();
  if (!doc) return c.json({ error: 'Document not found' }, 404);

  // Try to retrieve from R2
  if (c.env.STORAGE && doc.stored_in_r2) {
    try {
      const object = await c.env.STORAGE.get(doc.r2_key as string);
      if (object) {
        const headers = new Headers();
        headers.set('Content-Type', doc.mime_type as string || 'application/octet-stream');
        headers.set('Content-Disposition', `attachment; filename="${doc.name}"`);
        headers.set('Content-Length', String(doc.size));
        object.writeHttpMetadata(headers);
        return new Response(object.body, { headers });
      }
    } catch (err) {
      console.error('R2 download error:', err);
    }
  }

  // Return metadata only if R2 not available
  return c.json({
    id: doc.id, name: doc.name, type: doc.type, mimeType: doc.mime_type,
    size: doc.size, r2Key: doc.r2_key, storedInR2: doc.stored_in_r2 === 1,
    uploadedBy: doc.uploaded_by, createdAt: doc.created_at,
  });
});

// DELETE /api/storage/documents/:id
storage.delete('/documents/:id', async (c) => {
  const id = c.req.param('id');
  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first();
  if (!doc) return c.json({ error: 'Document not found' }, 404);

  // Delete from R2
  if (c.env.STORAGE && doc.stored_in_r2) {
    try {
      await c.env.STORAGE.delete(doc.r2_key as string);
    } catch (err) {
      console.error('R2 delete error:', err);
    }
  }

  await c.env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(id).run();

  return c.json({ success: true });
});

// POST /api/storage/reports/generate - Generate a report and store in R2
storage.post('/reports/generate', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    report_type: string; format?: string;
    date_range?: { start: string; end: string };
  }>(c, [
    { field: 'report_type', type: 'string', required: true, minLength: 1, maxLength: 64 },
    { field: 'format', type: 'string', required: false, maxLength: 16 },
  ]);
  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  const reportId = crypto.randomUUID();
  const format = body.format || 'json';
  let reportData: Record<string, unknown> = {};

  // Generate report based on type
  switch (body.report_type) {
    case 'executive_summary': {
      const [health, risks, briefings, metrics] = await Promise.all([
        c.env.DB.prepare('SELECT * FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1').bind(tenantId).first(),
        c.env.DB.prepare('SELECT * FROM risk_alerts WHERE tenant_id = ? AND status = ? ORDER BY detected_at DESC LIMIT 10').bind(tenantId, 'active').all(),
        c.env.DB.prepare('SELECT * FROM executive_briefings WHERE tenant_id = ? ORDER BY generated_at DESC LIMIT 3').bind(tenantId).all(),
        c.env.DB.prepare('SELECT * FROM process_metrics WHERE tenant_id = ? ORDER BY measured_at DESC LIMIT 20').bind(tenantId).all(),
      ]);
      reportData = {
        type: 'executive_summary', generatedAt: new Date().toISOString(),
        health: health ? { score: health.overall_score, dimensions: JSON.parse(health.dimensions as string || '{}') } : null,
        activeRisks: risks.results.length, risks: risks.results,
        recentBriefings: briefings.results, keyMetrics: metrics.results,
      };
      break;
    }
    case 'audit_trail': {
      let entries;
      if (body.date_range) {
        entries = await c.env.DB.prepare(
          'SELECT * FROM audit_log WHERE tenant_id = ? AND created_at BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 1000'
        ).bind(tenantId, body.date_range.start, body.date_range.end).all();
      } else {
        entries = await c.env.DB.prepare(
          'SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1000'
        ).bind(tenantId).all();
      }
      reportData = { type: 'audit_trail', generatedAt: new Date().toISOString(), entries: entries.results, totalEntries: entries.results.length };
      break;
    }
    case 'catalyst_performance': {
      const [clusters, actions, governance] = await Promise.all([
        c.env.DB.prepare('SELECT * FROM catalyst_clusters WHERE tenant_id = ?').bind(tenantId).all(),
        c.env.DB.prepare('SELECT status, COUNT(*) as count FROM catalyst_actions WHERE tenant_id = ? GROUP BY status').bind(tenantId).all(),
        c.env.DB.prepare('SELECT autonomy_tier, AVG(trust_score) as avg_trust FROM catalyst_clusters WHERE tenant_id = ? GROUP BY autonomy_tier').bind(tenantId).all(),
      ]);
      reportData = {
        type: 'catalyst_performance', generatedAt: new Date().toISOString(),
        clusters: clusters.results, actionBreakdown: actions.results, governanceMetrics: governance.results,
      };
      break;
    }
    case 'risk_assessment': {
      const [activeRisks, resolvedRisks, scenarios] = await Promise.all([
        c.env.DB.prepare('SELECT * FROM risk_alerts WHERE tenant_id = ? AND status = ? ORDER BY severity DESC').bind(tenantId, 'active').all(),
        c.env.DB.prepare('SELECT * FROM risk_alerts WHERE tenant_id = ? AND status = ? ORDER BY resolved_at DESC LIMIT 20').bind(tenantId, 'resolved').all(),
        c.env.DB.prepare('SELECT * FROM scenarios WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 10').bind(tenantId).all(),
      ]);
      reportData = {
        type: 'risk_assessment', generatedAt: new Date().toISOString(),
        activeRisks: activeRisks.results, resolvedRisks: resolvedRisks.results, scenarios: scenarios.results,
      };
      break;
    }
    default:
      return c.json({ error: `Unknown report type: ${body.report_type}` }, 400);
  }

  // Store report
  const reportName = `${body.report_type}_${new Date().toISOString().split('T')[0]}.${format}`;
  const reportContent = JSON.stringify(reportData, null, 2);
  const r2Key = `${tenantId}/reports/${reportId}/${reportName}`;

  // Upload to R2 if available
  let stored = false;
  if (c.env.STORAGE) {
    try {
      await c.env.STORAGE.put(r2Key, reportContent, {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { tenantId, reportType: body.report_type },
      });
      stored = true;
    } catch (err) {
      console.error('R2 report storage error:', err);
    }
  }

  // Store metadata
  await c.env.DB.prepare(
    'INSERT INTO documents (id, tenant_id, name, type, mime_type, size, r2_key, uploaded_by, stored_in_r2, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
  ).bind(reportId, tenantId, reportName, 'report', 'application/json', reportContent.length, r2Key, 'system', stored ? 1 : 0).run();

  return c.json({
    id: reportId, name: reportName, type: body.report_type,
    size: reportContent.length, r2Key, storedInR2: stored,
    data: reportData,
  }, 201);
});

// GET /api/storage/stats
storage.get('/stats', async (c) => {
  const tenantId = getTenantId(c);

  const [totalDocs, totalSize, byType] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM documents WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>(),
    c.env.DB.prepare('SELECT SUM(size) as total FROM documents WHERE tenant_id = ?').bind(tenantId).first<{ total: number }>(),
    c.env.DB.prepare('SELECT type, COUNT(*) as count, SUM(size) as total_size FROM documents WHERE tenant_id = ? GROUP BY type').bind(tenantId).all(),
  ]);

  return c.json({
    totalDocuments: totalDocs?.count || 0,
    totalSize: totalSize?.total || 0,
    totalSizeMB: Math.round((totalSize?.total || 0) / 1048576 * 100) / 100,
    byType: byType.results,
  });
});

export default storage;
