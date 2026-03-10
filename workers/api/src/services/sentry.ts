/**
 * Sentry Error Monitoring Service for Cloudflare Workers
 * Lightweight Sentry integration that sends error events via the Sentry HTTP API.
 * No SDK dependency required — uses fetch() directly to post envelope payloads.
 *
 * Usage:
 *   1. Set SENTRY_DSN as a Worker secret (e.g. https://key@o123.ingest.sentry.io/456)
 *   2. Call captureException() in error handlers
 *   3. Call captureMessage() for alerting on important events
 */

/** Parsed Sentry DSN components */
interface SentryDSNComponents {
  publicKey: string;
  host: string;
  projectId: string;
}

/** Sentry event payload shape */
interface SentryEvent {
  event_id: string;
  timestamp: number;
  platform: string;
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  logger: string;
  server_name: string;
  environment: string;
  release?: string;
  tags: Record<string, string>;
  extra: Record<string, unknown>;
  exception?: {
    values: Array<{
      type: string;
      value: string;
      stacktrace?: { frames: Array<{ filename: string; function: string; lineno?: number }> };
    }>;
  };
  message?: { formatted: string };
  request?: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  user?: {
    id: string;
    email?: string;
    ip_address?: string;
  };
}

/**
 * Parse a Sentry DSN string into its component parts.
 * @param dsn - Full DSN URL (e.g. https://key@o123.ingest.sentry.io/456)
 * @returns Parsed DSN components, or null if invalid
 */
function parseDSN(dsn: string): SentryDSNComponents | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const host = url.hostname;
    const projectId = url.pathname.replace('/', '');
    if (!publicKey || !host || !projectId) return null;
    return { publicKey, host, projectId };
  } catch {
    return null;
  }
}

/**
 * Generate a Sentry-compatible event ID (32 hex chars, no dashes).
 * @returns 32-character hex string
 */
function generateEventId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * Parse a JS Error stack trace into Sentry frame format.
 * @param stack - Error.stack string
 * @returns Array of Sentry stack frames
 */
function parseStackTrace(stack: string): Array<{ filename: string; function: string; lineno?: number }> {
  const frames: Array<{ filename: string; function: string; lineno?: number }> = [];
  const lines = stack.split('\n').slice(1); // Skip first line (error message)

  for (const line of lines) {
    const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):\d+\)/);
    if (match) {
      frames.push({
        function: match[1],
        filename: match[2],
        lineno: parseInt(match[3], 10),
      });
    } else {
      const simpleMatch = line.match(/at\s+(.+?):(\d+):\d+/);
      if (simpleMatch) {
        frames.push({
          function: '<anonymous>',
          filename: simpleMatch[1],
          lineno: parseInt(simpleMatch[2], 10),
        });
      }
    }
  }

  return frames.reverse(); // Sentry expects oldest frame first
}

/**
 * Send an event to Sentry via the HTTP Envelope API.
 * Uses waitUntil() so it doesn't block the response.
 * @param dsn - Sentry DSN string
 * @param event - Sentry event payload
 * @param ctx - Execution context for waitUntil
 */
async function sendToSentry(dsn: string, event: SentryEvent, ctx?: ExecutionContext): Promise<void> {
  const components = parseDSN(dsn);
  if (!components) {
    console.error('Sentry: Invalid DSN, cannot send event');
    return;
  }

  const envelopeUrl = `https://${components.host}/api/${components.projectId}/envelope/`;

  const envelopeHeader = JSON.stringify({
    event_id: event.event_id,
    dsn,
    sent_at: new Date().toISOString(),
  });

  const itemHeader = JSON.stringify({
    type: 'event',
    content_type: 'application/json',
  });

  const envelope = `${envelopeHeader}\n${itemHeader}\n${JSON.stringify(event)}`;

  const doSend = async () => {
    try {
      const resp = await fetch(envelopeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=atheon-workers/1.0, sentry_key=${components.publicKey}`,
        },
        body: envelope,
      });
      if (!resp.ok) {
        console.error(`Sentry: Failed to send event (${resp.status})`);
      }
    } catch (err) {
      console.error('Sentry: Network error sending event:', err);
    }
  };

  // Use waitUntil if available so we don't block the response
  if (ctx) {
    ctx.waitUntil(doSend());
  } else {
    await doSend();
  }
}

/**
 * Capture an exception and send it to Sentry.
 * @param error - The caught Error object
 * @param options - Additional context for the error event
 */
export function captureException(
  error: Error,
  options: {
    dsn: string;
    environment?: string;
    release?: string;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    request?: { url: string; method: string; headers?: Record<string, string> };
    user?: { id: string; email?: string; ip_address?: string };
    ctx?: ExecutionContext;
  },
): void {
  const event: SentryEvent = {
    event_id: generateEventId(),
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    logger: 'atheon.workers',
    server_name: 'cloudflare-worker',
    environment: options.environment || 'production',
    release: options.release,
    tags: {
      runtime: 'cloudflare-workers',
      ...(options.tags || {}),
    },
    extra: options.extra || {},
    exception: {
      values: [{
        type: error.name || 'Error',
        value: error.message,
        stacktrace: error.stack ? { frames: parseStackTrace(error.stack) } : undefined,
      }],
    },
    request: options.request ? {
      url: options.request.url,
      method: options.request.method,
      headers: options.request.headers || {},
    } : undefined,
    user: options.user,
  };

  sendToSentry(options.dsn, event, options.ctx);
}

/**
 * Capture a message (non-exception alert) and send it to Sentry.
 * @param message - The alert message
 * @param level - Severity level
 * @param options - Additional context
 */
export function captureMessage(
  message: string,
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug',
  options: {
    dsn: string;
    environment?: string;
    release?: string;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    ctx?: ExecutionContext;
  },
): void {
  const event: SentryEvent = {
    event_id: generateEventId(),
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level,
    logger: 'atheon.workers',
    server_name: 'cloudflare-worker',
    environment: options.environment || 'production',
    release: options.release,
    tags: {
      runtime: 'cloudflare-workers',
      ...(options.tags || {}),
    },
    extra: options.extra || {},
    message: { formatted: message },
  };

  sendToSentry(options.dsn, event, options.ctx);
}

/**
 * Create a Hono-compatible error handler middleware that reports errors to Sentry.
 * @param dsn - Sentry DSN string
 * @param environment - Deployment environment name
 * @returns Error handler function compatible with app.onError()
 */
export function sentryErrorHandler(
  dsn: string | undefined,
  environment: string = 'production',
): (err: Error, c: { req: { url: string; method: string; header: (name: string) => string | undefined }; get: (key: string) => unknown; executionCtx: ExecutionContext; env: { ENVIRONMENT?: string } }) => void {
  return (err, c) => {
    if (!dsn) return; // Sentry not configured — skip silently

    const auth = c.get('auth') as { userId?: string; email?: string } | undefined;

    captureException(err, {
      dsn,
      environment: c.env.ENVIRONMENT || environment,
      tags: {
        url: c.req.url,
        method: c.req.method,
      },
      extra: {
        url: c.req.url,
        method: c.req.method,
        userAgent: c.req.header('user-agent') || 'unknown',
      },
      request: {
        url: c.req.url,
        method: c.req.method,
      },
      user: auth ? { id: auth.userId || 'unknown', email: auth.email } : undefined,
      ctx: c.executionCtx,
    });
  };
}
