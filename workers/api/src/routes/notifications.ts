/**
 * Notifications & Webhooks Routes
 */

import { Hono } from 'hono';
import type { AppBindings } from '../types';
import type { AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';
import { dispatchNotification, getUnreadCount, markAsRead } from '../services/notifications';
import { sendOrQueueEmail, getAlertEmailTemplate, getApprovalEmailTemplate, getEscalationEmailTemplate } from '../services/email';
import { encrypt, decrypt, isEncrypted } from '../services/encryption';

const notifications = new Hono<AppBindings>();

/** Superadmin/support_admin can override tenant via ?tenant_id= query param */
const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth?.tenantId) throw new Error('No tenant context available');
  const defaultTenantId = auth.tenantId;
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// GET /api/notifications
notifications.get('/', async (c) => {
  const tenantId = getTenantId(c);
  const type = c.req.query('type');
  const unreadOnly = c.req.query('unread') === 'true';
  const limit = parseInt(c.req.query('limit') || '50');

  let query = 'SELECT * FROM notifications WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (type) { query += ' AND type = ?'; binds.push(type); }
  if (unreadOnly) { query += ' AND read = 0'; }
  query += ' ORDER BY created_at DESC LIMIT ?';
  binds.push(limit);

  const results = await c.env.DB.prepare(query).bind(...binds).all();
  const unread = await getUnreadCount(c.env.DB, tenantId);

  return c.json({
    notifications: results.results.map((n: Record<string, unknown>) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      severity: n.severity,
      actionUrl: n.action_url,
      metadata: n.metadata ? JSON.parse(n.metadata as string) : null,
      read: n.read === 1,
      createdAt: n.created_at,
    })),
    total: results.results.length,
    unreadCount: unread,
  });
});

// POST /api/notifications - Create a notification
notifications.post('/', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    type: string; title: string; message: string;
    severity?: string; action_url?: string; metadata?: Record<string, unknown>;
  }>(c, [
    { field: 'title', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'message', type: 'string', required: true, minLength: 1, maxLength: 2000 },
    { field: 'type', type: 'string', required: false, maxLength: 64 },
    { field: 'severity', type: 'string', required: false, maxLength: 32 },
    { field: 'action_url', type: 'string', required: false, maxLength: 500 },
  ]);

  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  const notifType = (body.type || 'system') as 'alert' | 'approval' | 'escalation' | 'system' | 'catalyst_notification' | 'webhook';
  const severity = (body.severity || 'info') as 'critical' | 'high' | 'medium' | 'low' | 'info';

  const results = await dispatchNotification(c.env.DB, c.env.CACHE, {
    tenantId,
    type: notifType,
    title: body.title,
    message: body.message,
    severity,
    actionUrl: body.action_url,
    metadata: body.metadata,
  });

  // Also send email for critical/high severity alerts and approvals
  if (['critical', 'high'].includes(severity) || notifType === 'approval' || notifType === 'escalation') {
    try {
      // Get tenant admin emails
      const admins = await c.env.DB.prepare(
        'SELECT email FROM users WHERE tenant_id = ? AND role IN (?, ?) AND status = ?'
      ).bind(tenantId, 'admin', 'manager', 'active').all();

      const recipients = admins.results.map((u: Record<string, unknown>) => u.email as string);
      if (recipients.length > 0) {
        let template: { html: string; text: string };
        if (notifType === 'approval') {
          template = getApprovalEmailTemplate(body.title, body.message, 0.5, body.message, body.action_url || 'https://atheon.vantax.co.za/catalysts');
        } else if (notifType === 'escalation') {
          template = getEscalationEmailTemplate(body.title, body.message, 'manager', body.message, body.action_url || 'https://atheon.vantax.co.za/catalysts');
        } else {
          template = getAlertEmailTemplate(body.title, body.message, severity, body.action_url);
        }

        const emailResult = await sendOrQueueEmail(c.env.DB, {
          to: recipients,
          subject: `[Atheon ${severity.toUpperCase()}] ${body.title}`,
          htmlBody: template.html,
          textBody: template.text,
          tenantId,
        }, c.env);
        results.push({ id: emailResult.id, delivered: emailResult.sent, channel: emailResult.channel });
      }
    } catch (err) {
      console.error('Email dispatch error:', err);
    }
  }

  return c.json({ results }, 201);
});

// PUT /api/notifications/read - Mark notifications as read
notifications.put('/read', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{ ids: string[] }>(c, []);
  if (!body || errors.length > 0 || !body.ids || body.ids.length === 0) {
    return c.json({ error: 'ids array is required' }, 400);
  }
  await markAsRead(c.env.DB, tenantId, body.ids);
  return c.json({ success: true, marked: body.ids.length });
});

// GET /api/notifications/unread-count
notifications.get('/unread-count', async (c) => {
  const tenantId = getTenantId(c);
  const count = await getUnreadCount(c.env.DB, tenantId);
  return c.json({ unreadCount: count });
});

// ── Webhook Management ──

// GET /api/notifications/webhooks
notifications.get('/webhooks', async (c) => {
  const tenantId = getTenantId(c);
  const results = await c.env.DB.prepare(
    'SELECT * FROM webhooks WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(tenantId).all();

  return c.json({
    webhooks: results.results.map((w: Record<string, unknown>) => ({
      id: w.id,
      url: w.url,
      events: JSON.parse(w.events as string || '[]'),
      active: w.active === 1,
      retryCount: w.retry_count,
      lastTriggered: w.last_triggered,
      createdAt: w.created_at,
    })),
    total: results.results.length,
  });
});

// POST /api/notifications/webhooks - Create a webhook
notifications.post('/webhooks', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    url: string; events?: string[];
  }>(c, [
    { field: 'url', type: 'url', required: true },
  ]);

  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  // Validate URL
  try { new URL(body.url); } catch {
    return c.json({ error: 'Invalid webhook URL' }, 400);
  }

  const id = crypto.randomUUID();
  // Generate a signing secret for the webhook
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(secretBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  // Encrypt the secret before storing in D1
  const encryptedSecret = await encrypt(secret, c.env.ENCRYPTION_KEY);

  await c.env.DB.prepare(
    'INSERT INTO webhooks (id, tenant_id, url, secret, events, active, retry_count, created_at) VALUES (?, ?, ?, ?, ?, 1, 0, datetime(\'now\'))'
  ).bind(id, tenantId, body.url, encryptedSecret, JSON.stringify(body.events || ['*'])).run();

  return c.json({ id, secret, message: 'Webhook created. Store the secret — it will not be shown again.' }, 201);
});

// PUT /api/notifications/webhooks/:id
notifications.put('/webhooks/:id', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const { data: body, errors: valErrors } = await getValidatedJsonBody<{ url?: string; events?: string[]; active?: boolean }>(c, [
    { field: 'url', type: 'url', required: false },
  ]);
  if (!body || valErrors.length > 0) {
    return c.json({ error: 'Invalid input', details: valErrors }, 400);
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.url) { updates.push('url = ?'); values.push(body.url); }
  if (body.events) { updates.push('events = ?'); values.push(JSON.stringify(body.events)); }
  if (body.active !== undefined) { updates.push('active = ?'); values.push(body.active ? 1 : 0); }

  if (updates.length > 0) {
    values.push(id, tenantId);
    await c.env.DB.prepare(`UPDATE webhooks SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  }

  return c.json({ success: true });
});

// DELETE /api/notifications/webhooks/:id
notifications.delete('/webhooks/:id', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM webhooks WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return c.json({ success: true });
});

// POST /api/notifications/webhooks/:id/test - Test a webhook
notifications.post('/webhooks/:id/test', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const webhook = await c.env.DB.prepare('SELECT * FROM webhooks WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!webhook) return c.json({ error: 'Webhook not found' }, 404);

  // Decrypt the webhook secret for signing
  const storedSecret = webhook.secret as string;
  const decryptedSecret = isEncrypted(storedSecret)
    ? await decrypt(storedSecret, c.env.ENCRYPTION_KEY) || storedSecret
    : storedSecret;

  const { dispatchWebhook } = await import('../services/notifications');
  const result = await dispatchWebhook(
    {
      id: webhook.id as string,
      tenantId: tenantId,
      url: webhook.url as string,
      secret: decryptedSecret,
      events: JSON.parse(webhook.events as string || '[]'),
      active: true,
      retryCount: 0,
    },
    'test',
    { message: 'This is a test webhook from Atheon', timestamp: new Date().toISOString() },
  );

  return c.json(result);
});

export default notifications;
