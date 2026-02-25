/**
 * Real-Time Dashboard Service using Durable Objects
 * Provides WebSocket connections for live dashboard updates,
 * notification broadcasting, and connection management.
 */

// ── Durable Object: DashboardRoom ──
// Each tenant gets their own DashboardRoom for real-time updates

export class DashboardRoom {
  private state: DurableObjectState;
  private sessions: Map<WebSocket, { tenantId: string; userId: string; subscribedChannels: Set<string> }>;
  private lastBroadcast: Map<string, number>;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.sessions = new Map();
    this.lastBroadcast = new Map();

    // Restore sessions on wake
    this.state.getWebSockets().forEach(ws => {
      const meta = ws.deserializeAttachment() as { tenantId: string; userId: string; channels: string[] } | null;
      if (meta) {
        this.sessions.set(ws, {
          tenantId: meta.tenantId,
          userId: meta.userId,
          subscribedChannels: new Set(meta.channels || ['dashboard']),
        });
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request, url);
    }

    // HTTP API for broadcasting events from backend
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      return this.handleBroadcast(request);
    }

    // Connection stats
    if (url.pathname === '/stats') {
      return Response.json({
        activeSessions: this.sessions.size,
        channels: this.getChannelStats(),
        lastBroadcasts: Object.fromEntries(this.lastBroadcast),
      });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  private handleWebSocket(request: Request, url: URL): Response {
    const tenantId = url.searchParams.get('tenant_id') || 'unknown';
    const userId = url.searchParams.get('user_id') || 'anonymous';
    const channels = (url.searchParams.get('channels') || 'dashboard').split(',');

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Accept with hibernation support
    this.state.acceptWebSocket(server);

    // Store session metadata
    const sessionData = { tenantId, userId, channels };
    server.serializeAttachment(sessionData);

    this.sessions.set(server, {
      tenantId,
      userId,
      subscribedChannels: new Set(channels),
    });

    // Send welcome message
    server.send(JSON.stringify({
      type: 'connected',
      tenantId,
      userId,
      channels,
      timestamp: new Date().toISOString(),
    }));

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleBroadcast(request: Request): Promise<Response> {
    const body = await request.json() as {
      channel: string;
      event: string;
      data: Record<string, unknown>;
      tenantId?: string;
    };

    let sent = 0;
    const now = Date.now();

    // Rate limit broadcasts (max 10 per second per channel)
    const lastTime = this.lastBroadcast.get(body.channel) || 0;
    if (now - lastTime < 100) {
      return Response.json({ sent: 0, skipped: true, reason: 'rate_limited' });
    }
    this.lastBroadcast.set(body.channel, now);

    const message = JSON.stringify({
      type: 'event',
      channel: body.channel,
      event: body.event,
      data: body.data,
      timestamp: new Date().toISOString(),
    });

    for (const [ws, session] of this.sessions) {
      // Filter by tenant if specified
      if (body.tenantId && session.tenantId !== body.tenantId) continue;

      // Filter by channel subscription
      if (!session.subscribedChannels.has(body.channel) && !session.subscribedChannels.has('*')) continue;

      try {
        ws.send(message);
        sent++;
      } catch {
        // Connection dead — will be cleaned up in webSocketClose
        this.sessions.delete(ws);
      }
    }

    return Response.json({ sent, channel: body.channel, event: body.event });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    try {
      const data = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) as {
        type: string;
        channels?: string[];
        channel?: string;
      };

      const session = this.sessions.get(ws);
      if (!session) return;

      switch (data.type) {
        case 'subscribe':
          if (data.channels) {
            data.channels.forEach(ch => session.subscribedChannels.add(ch));
            ws.serializeAttachment({
              tenantId: session.tenantId,
              userId: session.userId,
              channels: Array.from(session.subscribedChannels),
            });
            ws.send(JSON.stringify({ type: 'subscribed', channels: Array.from(session.subscribedChannels) }));
          }
          break;

        case 'unsubscribe':
          if (data.channels) {
            data.channels.forEach(ch => session.subscribedChannels.delete(ch));
            ws.serializeAttachment({
              tenantId: session.tenantId,
              userId: session.userId,
              channels: Array.from(session.subscribedChannels),
            });
            ws.send(JSON.stringify({ type: 'unsubscribed', channels: Array.from(session.subscribedChannels) }));
          }
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          break;

        default:
          ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${data.type}` }));
      }
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  }

  webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    void _code;
    void _reason;
    void _wasClean;
    this.sessions.delete(ws);
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    void _error;
    this.sessions.delete(ws);
  }

  private getChannelStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const [, session] of this.sessions) {
      for (const ch of session.subscribedChannels) {
        stats[ch] = (stats[ch] || 0) + 1;
      }
    }
    return stats;
  }
}
