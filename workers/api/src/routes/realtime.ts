/**
 * Real-Time Routes - WebSocket connections and dashboard broadcasting
 * Uses Durable Objects for persistent WebSocket connections per tenant.
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';

const realtime = new Hono<AppBindings>();

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

function getUserId(c: { get: (key: string) => unknown }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  return auth?.userId || 'anonymous';
}

// GET /api/realtime/ws?channels= - WebSocket upgrade
realtime.get('/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return c.json({ error: 'Expected WebSocket upgrade' }, 426);
  }

  const tenantId = getTenantId(c);
  const userId = getUserId(c);
  const channels = c.req.query('channels') || 'dashboard';

  // Get or create the Durable Object for this tenant
  const roomId = c.env.DASHBOARD_ROOM.idFromName(`tenant:${tenantId}`);
  const room = c.env.DASHBOARD_ROOM.get(roomId);

  // Forward the WebSocket upgrade request to the Durable Object
  const url = new URL(c.req.url);
  url.pathname = '/';
  url.searchParams.set('tenant_id', tenantId);
  url.searchParams.set('user_id', userId);
  url.searchParams.set('channels', channels);

  return room.fetch(url.toString(), {
    headers: c.req.raw.headers,
  });
});

// POST /api/realtime/broadcast - Broadcast event to connected clients
realtime.post('/broadcast', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    channel: string;
    event: string;
    data: Record<string, unknown>;
  }>(c, [
    { field: 'channel', type: 'string', required: true, minLength: 1, maxLength: 64 },
    { field: 'event', type: 'string', required: true, minLength: 1, maxLength: 64 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const roomId = c.env.DASHBOARD_ROOM.idFromName(`tenant:${tenantId}`);
  const room = c.env.DASHBOARD_ROOM.get(roomId);

  const resp = await room.fetch('https://internal/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: body.channel,
      event: body.event,
      data: body.data,
      tenantId,
    }),
  });

  const result = await resp.json();
  return c.json(result);
});

// GET /api/realtime/stats - Get connection stats for a tenant
realtime.get('/stats', async (c) => {
  const tenantId = getTenantId(c);

  const roomId = c.env.DASHBOARD_ROOM.idFromName(`tenant:${tenantId}`);
  const room = c.env.DASHBOARD_ROOM.get(roomId);

  const resp = await room.fetch('https://internal/stats');
  const stats = await resp.json();
  return c.json(stats);
});

export default realtime;
