/**
 * Notifications & Webhooks Service
 * Email/webhook notification dispatch for alerts, approvals, and system events
 */

export interface NotificationPayload {
  tenantId: string;
  type: 'alert' | 'approval' | 'escalation' | 'system' | 'catalyst_notification' | 'webhook';
  title: string;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  actionUrl?: string;
  recipients?: string[];
  metadata?: Record<string, unknown>;
}

export interface WebhookConfig {
  id: string;
  tenantId: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  retryCount: number;
  lastTriggered?: string;
}

export interface NotificationResult {
  id: string;
  delivered: boolean;
  channel: string;
  error?: string;
}

// ── Store notification in DB ──

export async function createNotification(
  db: D1Database,
  payload: NotificationPayload,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO notifications (id, tenant_id, type, title, message, severity, action_url, metadata, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime(\'now\'))'
  ).bind(
    id, payload.tenantId, payload.type, payload.title, payload.message,
    payload.severity, payload.actionUrl || null,
    payload.metadata ? JSON.stringify(payload.metadata) : null,
  ).run();
  return id;
}

// ── Dispatch webhook ──

async function signWebhookPayload(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const bytes = new Uint8Array(sig);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function dispatchWebhook(
  config: WebhookConfig,
  event: string,
  payload: Record<string, unknown>,
): Promise<NotificationResult> {
  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  try {
    const signature = await signWebhookPayload(body, config.secret);

    const resp = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Atheon-Signature': `sha256=${signature}`,
        'X-Atheon-Event': event,
        'X-Atheon-Delivery': crypto.randomUUID(),
      },
      body,
    });

    return {
      id: crypto.randomUUID(),
      delivered: resp.ok,
      channel: 'webhook',
      error: resp.ok ? undefined : `HTTP ${resp.status}: ${resp.statusText}`,
    };
  } catch {
    return {
      id: crypto.randomUUID(),
      delivered: false,
      channel: 'webhook',
      error: 'Webhook dispatch failed',
    };
  }
}

// ── Dispatch notifications to all configured channels ──

export async function dispatchNotification(
  db: D1Database,
  cache: KVNamespace,
  payload: NotificationPayload,
): Promise<NotificationResult[]> {
  const results: NotificationResult[] = [];

  // 1. Store in DB
  const notifId = await createNotification(db, payload);
  results.push({ id: notifId, delivered: true, channel: 'database' });

  // 2. Dispatch to webhooks
  const webhooks = await db.prepare(
    'SELECT * FROM webhooks WHERE tenant_id = ? AND active = 1'
  ).bind(payload.tenantId).all().catch(() => ({ results: [] as Record<string, unknown>[] }));

  for (const wh of webhooks.results) {
    const events = JSON.parse(wh.events as string || '[]') as string[];
    if (events.includes('*') || events.includes(payload.type)) {
      const whResult = await dispatchWebhook(
        {
          id: wh.id as string,
          tenantId: wh.tenant_id as string,
          url: wh.url as string,
          secret: wh.secret as string,
          events,
          active: true,
          retryCount: wh.retry_count as number || 0,
        },
        payload.type,
        {
          title: payload.title,
          message: payload.message,
          severity: payload.severity,
          actionUrl: payload.actionUrl,
          metadata: payload.metadata,
        },
      );
      results.push(whResult);

      // Update last triggered
      await db.prepare(
        'UPDATE webhooks SET last_triggered = datetime(\'now\') WHERE id = ?'
      ).bind(wh.id).run().catch(() => {});
    }
  }

  // 3. Cache recent notifications for quick access
  const cacheKey = `notifications:${payload.tenantId}:recent`;
  const existing = await cache.get(cacheKey);
  const recent = existing ? JSON.parse(existing) as unknown[] : [];
  recent.unshift({ id: notifId, type: payload.type, title: payload.title, severity: payload.severity, createdAt: new Date().toISOString() });
  if (recent.length > 50) recent.length = 50;
  await cache.put(cacheKey, JSON.stringify(recent), { expirationTtl: 3600 });

  return results;
}

// ── Get unread notification count ──

export async function getUnreadCount(db: D1Database, tenantId: string): Promise<number> {
  const result = await db.prepare(
    'SELECT COUNT(*) as count FROM notifications WHERE tenant_id = ? AND read = 0'
  ).bind(tenantId).first<{ count: number }>().catch(() => null);
  return result?.count || 0;
}

// ── Mark notifications as read ──

export async function markAsRead(db: D1Database, tenantId: string, notificationIds: string[]): Promise<void> {
  for (const id of notificationIds) {
    await db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  }
}
