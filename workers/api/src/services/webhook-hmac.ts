/**
 * Webhook HMAC Service — Phase 10-37 / Phase 10-38 (encrypted at rest).
 *
 * Stripe-style signed webhooks for the /ingest/* surface. Untrusted-
 * network callers (banks, payment processors, T&E SaaS, ERP
 * middleware) sign requests with a per-tenant per-source secret
 * instead of holding a JWT.
 *
 * Wire protocol:
 *   POST /api/v1/ingest/<resource>
 *   X-Atheon-Signature: t=<unix_ts>,v1=<hex_hmac_sha256>
 *   X-Atheon-Source: <source-id>
 *   Content-Type: application/json
 *
 *   <body>
 *
 * Server validates:
 *   1. Both headers present + parseable
 *   2. Active secret exists for (tenant_id, source_id)
 *   3. Timestamp within ±5 minutes of server clock (replay window)
 *   4. HMAC-SHA256(decrypt(secret_encrypted), "<ts>.<body>") matches
 *
 * At-rest protection (Phase 10-38): the raw secret is AES-GCM
 * encrypted with the worker's ENCRYPTION_KEY before it ever lands
 * in D1. A row read alone never leaks the verifier — the worker
 * has to decrypt with its env-bound key.
 *
 * Storage shape (in `secret_encrypted` column, base64):
 *   [12 bytes IV] [variable ciphertext] [16 bytes GCM auth tag]
 *
 * Operators see the secret value EXACTLY ONCE at creation. Lost
 * secrets must be rotated, not recovered.
 */

import { logWarn, logInfo } from './logger';

const REPLAY_WINDOW_SECONDS = 5 * 60;
const AES_IV_BYTES = 12;

export interface WebhookSecretRow {
  id: string;
  tenant_id: string;
  source_id: string;
  label: string;
  secret_encrypted: string;  // base64(IV || ciphertext || tag) — never logged
  secret_prefix: string;     // first/last few chars for human ID; never the secret itself
  algorithm: string;
  status: string;
  created_at: string;
  last_used_at: string | null;
}

export type HmacVerifyResult =
  | { ok: true; secret: WebhookSecretRow }
  | { ok: false; reason: string };

// ── Encryption helpers (AES-GCM with ENCRYPTION_KEY) ─────────────

/** Derive the AES-GCM key from the env-bound ENCRYPTION_KEY string.
 *  We treat the env value as a passphrase and hash it to 256 bits;
 *  this avoids enforcing exact-32-byte input on operators. */
async function deriveAesKey(passphrase: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  // Hash passphrase to 32 bytes. Stable across worker restarts.
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(passphrase));
  return crypto.subtle.importKey(
    'raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encrypt the secret value with AES-GCM. Output is base64-encoded
 *  IV || ciphertext || auth-tag (the tag is appended by Web Crypto). */
async function encryptSecret(secret: string, encryptionKey: string): Promise<string> {
  const key = await deriveAesKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const enc = new TextEncoder();
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(secret),
  );
  const cipherBytes = new Uint8Array(cipher);
  const out = new Uint8Array(iv.length + cipherBytes.length);
  out.set(iv, 0);
  out.set(cipherBytes, iv.length);
  return bytesToBase64(out);
}

/** Decrypt the secret value. Throws on auth-tag mismatch (i.e.
 *  ciphertext was tampered with or wrong ENCRYPTION_KEY). */
async function decryptSecret(blob: string, encryptionKey: string): Promise<string> {
  const bytes = base64ToBytes(blob);
  if (bytes.length < AES_IV_BYTES + 16) {
    throw new Error('encrypted secret too short');
  }
  const iv = bytes.slice(0, AES_IV_BYTES);
  const cipher = bytes.slice(AES_IV_BYTES);
  const key = await deriveAesKey(encryptionKey);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, key, cipher,
  );
  return new TextDecoder().decode(plain);
}

// ── Signature parsing + HMAC ─────────────────────────────────────

/** Parse the X-Atheon-Signature header.
 *  Accepts the Stripe-compatible format `t=<ts>,v1=<sig>`. Multiple
 *  signatures (e.g. during rotation) can be sent comma-separated;
 *  any v1 match passes. */
function parseSignatureHeader(header: string | null): { timestamp: number; sigs: string[] } | null {
  if (!header) return null;
  const parts = header.split(',').map((p) => p.trim());
  let timestamp: number | null = null;
  const sigs: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const val = part.slice(eq + 1);
    if (key === 't') {
      const n = parseInt(val, 10);
      if (Number.isFinite(n)) timestamp = n;
    } else if (key === 'v1' && /^[0-9a-fA-F]{64}$/.test(val)) {
      sigs.push(val.toLowerCase());
    }
  }
  if (timestamp == null || sigs.length === 0) return null;
  return { timestamp, sigs };
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** Constant-time hex string compare. Returns true on match. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/**
 * Verify a webhook signature against the matching secret row.
 *
 * @param db - D1 binding
 * @param encryptionKey - The worker's ENCRYPTION_KEY env value, used
 *   to decrypt the at-rest secret blob before HMAC verification
 * @param tenantId - Resolved tenant scope. The HMAC layer doesn't
 *   authoritatively decide tenant; it confirms a known tenant's
 *   secret signed the request.
 * @param sourceId - From the `X-Atheon-Source` header
 * @param signatureHeader - The raw `X-Atheon-Signature` header value
 * @param body - The raw request body bytes (must be the same string fed to the signer)
 */
export async function verifyWebhookSignature(
  db: D1Database,
  encryptionKey: string,
  tenantId: string,
  sourceId: string,
  signatureHeader: string | null,
  body: string,
): Promise<HmacVerifyResult> {
  if (!sourceId) return { ok: false, reason: 'X-Atheon-Source header missing' };

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return { ok: false, reason: 'X-Atheon-Signature header missing or malformed (expected: t=<unix>,v1=<hex64>)' };

  const nowSec = Math.floor(Date.now() / 1000);
  const skew = Math.abs(nowSec - parsed.timestamp);
  if (skew > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: `timestamp out of window (skew=${skew}s, max=${REPLAY_WINDOW_SECONDS}s)` };
  }

  const row = await db.prepare(
    `SELECT id, tenant_id, source_id, label, secret_encrypted, secret_prefix, algorithm, status, created_at, last_used_at
       FROM webhook_signing_secrets
      WHERE tenant_id = ? AND source_id = ? AND status = 'active'
      LIMIT 1`,
  ).bind(tenantId, sourceId).first<WebhookSecretRow>();

  if (!row) {
    return { ok: false, reason: `no active webhook secret for source '${sourceId}'` };
  }
  if (row.algorithm !== 'sha256') {
    return { ok: false, reason: `unsupported algorithm '${row.algorithm}'` };
  }

  // Decrypt the at-rest blob with the worker's ENCRYPTION_KEY. A DB
  // read alone never leaks the verifier — only the worker (which
  // has the key in its env) can recover it.
  let plainSecret: string;
  try {
    plainSecret = await decryptSecret(row.secret_encrypted, encryptionKey);
  } catch (err) {
    logWarn('webhook_hmac.decrypt_failed',
      { tenantId, layer: 'ingest', action: 'hmac_verify' },
      { source_id: sourceId, secret_id: row.id, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, reason: 'secret decrypt failed (check ENCRYPTION_KEY consistency)' };
  }

  const expectedSig = await hmacSha256Hex(plainSecret, `${parsed.timestamp}.${body}`);
  const matched = parsed.sigs.some((s) => timingSafeEqual(s, expectedSig));
  if (!matched) {
    logWarn('webhook_hmac.signature_mismatch',
      { tenantId, layer: 'ingest', action: 'hmac_verify' },
      { source_id: sourceId, secret_id: row.id });
    return { ok: false, reason: 'signature mismatch' };
  }

  // Mark last-used. Awaited (fire-and-forget orphans D1 binding past
  // the request and breaks vitest-pool-workers' isolated storage).
  try {
    await db.prepare(
      `UPDATE webhook_signing_secrets SET last_used_at = datetime('now') WHERE id = ?`,
    ).bind(row.id).run();
  } catch { /* best-effort — never fail verify because of a stats write */ }

  logInfo('webhook_hmac.verified',
    { tenantId, layer: 'ingest', action: 'hmac_verify' },
    { source_id: sourceId, secret_id: row.id });

  return { ok: true, secret: row };
}

/** Provision a new secret for a (tenant, source) pair.
 *
 *  Returns { secret, secretRow } where `secret` is the raw value to
 *  show the operator EXACTLY ONCE, and `secretRow` is the persisted
 *  row metadata (encrypted blob is NOT included). */
export async function provisionWebhookSecret(
  db: D1Database,
  encryptionKey: string,
  tenantId: string,
  sourceId: string,
  label: string,
  createdByUserId: string | null,
): Promise<{ secret: string; secretRow: Omit<WebhookSecretRow, 'secret_encrypted'> }> {
  // Generate a 256-bit secret
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = `whsec_${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  const id = `whs-${crypto.randomUUID()}`;
  // Display-only suffix (last 6 chars of the hex part)
  const prefix = `whsec_…${secret.slice(-6)}`;

  // Encrypt the raw secret with the worker's ENCRYPTION_KEY
  const encrypted = await encryptSecret(secret, encryptionKey);

  // Mark any existing active secret as 'rotated' so the partial
  // unique index (tenant, source, status='active') allows the new one.
  await db.prepare(
    `UPDATE webhook_signing_secrets SET status = 'rotated', last_rotated_at = datetime('now')
      WHERE tenant_id = ? AND source_id = ? AND status = 'active'`,
  ).bind(tenantId, sourceId).run();

  await db.prepare(
    `INSERT INTO webhook_signing_secrets (id, tenant_id, source_id, label, secret_encrypted, secret_prefix, algorithm, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'sha256', 'active', ?)`,
  ).bind(id, tenantId, sourceId, label, encrypted, prefix, createdByUserId).run();

  const row = await db.prepare(
    `SELECT id, tenant_id, source_id, label, secret_prefix, algorithm, status, created_at, last_used_at
       FROM webhook_signing_secrets WHERE id = ?`,
  ).bind(id).first<Omit<WebhookSecretRow, 'secret_encrypted'>>();

  return { secret, secretRow: row! };
}

/** Revoke a secret (sets status='revoked'). Does NOT delete — kept
 *  for audit. After revocation, an in-flight signed request will be
 *  rejected on the next call. */
export async function revokeWebhookSecret(
  db: D1Database, tenantId: string, secretId: string, reason: string,
): Promise<boolean> {
  const res = await db.prepare(
    `UPDATE webhook_signing_secrets SET status = 'revoked', revoked_at = datetime('now'), revoked_reason = ?
      WHERE id = ? AND tenant_id = ? AND status IN ('active', 'rotated')`,
  ).bind(reason.slice(0, 500), secretId, tenantId).run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Helper for clients (Atheon SDK or test fixtures) to compute the
 *  signature header value to send. Exposed as a standalone export so
 *  test code can build correctly-signed requests without copying the
 *  scheme. */
export async function buildSignatureHeader(
  secret: string, body: string, timestamp: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const sig = await hmacSha256Hex(secret, `${timestamp}.${body}`);
  return `t=${timestamp},v1=${sig}`;
}

// ── Hono middleware factory ──────────────────────────────────────

import type { Context, MiddlewareHandler, Next } from 'hono';
import type { AppBindings, AuthContext } from '../types';

/**
 * Hono middleware that authenticates `/ingest/*` requests via either
 * (a) HMAC signature (X-Atheon-Signature + X-Atheon-Source headers)
 *     using a tenant-scoped webhook secret — for untrusted-network
 *     callers like banks, payment processors, T&E SaaS
 * (b) JWT bearer (the existing tenantIsolation path) — for callers
 *     that already hold an Atheon session
 *
 * Resolution order: if X-Atheon-Signature header is present, attempt
 * HMAC verification. Otherwise fall through to the next middleware
 * (which is tenantIsolation in the registered chain).
 *
 * On HMAC success, sets `auth` context with role='integration' and
 * tenantId from the signature lookup, plus a meta field
 * `webhook_source_id` so downstream handlers can audit-log the source.
 *
 * Tenant resolution: HMAC callers MUST send X-Atheon-Tenant with the
 * tenant ID (plaintext; the secret lookup confirms the caller owns
 * that tenant's secret, so no impersonation risk).
 */
export function webhookHmacMiddleware(): MiddlewareHandler<AppBindings> {
  return async (c: Context<AppBindings>, next: Next) => {
    const sigHeader = c.req.header('X-Atheon-Signature');
    if (!sigHeader) {
      // No HMAC headers — fall through to JWT auth (tenantIsolation)
      await next();
      return;
    }

    const sourceId = c.req.header('X-Atheon-Source') ?? '';
    const tenantId = c.req.header('X-Atheon-Tenant') ?? '';
    if (!tenantId) {
      return c.json({ error: 'X-Atheon-Tenant header required for HMAC auth' }, 401);
    }

    const env = c.env as { DB: D1Database; ENCRYPTION_KEY: string };
    if (!env.ENCRYPTION_KEY) {
      return c.json({ error: 'server misconfigured: ENCRYPTION_KEY not set' }, 500);
    }

    // Read body as text. Hono's c.req.text() is consumable once;
    // we re-attach via c.set so downstream handlers can call
    // c.req.json() / c.get('rawBody') without re-reading.
    const body = await c.req.text();
    c.set('rawBody', body);

    const result = await verifyWebhookSignature(
      env.DB, env.ENCRYPTION_KEY, tenantId, sourceId, sigHeader, body,
    );
    if (!result.ok) {
      logWarn('webhook_hmac.middleware_rejected',
        { tenantId, layer: 'ingest', action: 'hmac_reject' },
        { source_id: sourceId, reason: result.reason });
      return c.json({ error: 'webhook signature rejected', reason: result.reason }, 401);
    }

    // Stamp the auth context so downstream code (audit, rate limit,
    // route handlers) sees a synthetic user representing the source.
    const auth: AuthContext = {
      userId: `webhook:${result.secret.source_id}`,
      email: `webhook+${result.secret.source_id}@${tenantId}.atheon.invalid`,
      name: result.secret.label,
      role: 'integration',
      tenantId,
      permissions: ['ingest'],
    };
    c.set('auth', auth);
    c.set('webhookSourceId', result.secret.source_id);

    await next();
  };
}
