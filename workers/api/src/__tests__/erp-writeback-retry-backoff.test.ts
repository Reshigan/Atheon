/**
 * Phase 10-48 — dispatch retry / backoff / dead-letter.
 *
 * Locks down the failure-handling contract for executePendingActions:
 *
 *   - First failure leaves status='failed', sets next_retry_at to a
 *     future ISO timestamp, retry_count=1
 *   - The pickup query INCLUDES failed rows whose backoff window has
 *     elapsed (retry-eligible)
 *   - The pickup query EXCLUDES failed rows still in the backoff window
 *   - After MAX_DISPATCH_RETRIES failures, the row is frozen at
 *     status='dead_letter' with dead_letter_at set
 *   - Dead-lettered rows are NEVER picked up by the sweep
 *   - reviveDeadLetterAction() flips a dead-lettered row back to
 *     'approved' with retry_count=0
 *   - Successful retry clears error + next_retry_at and posts cleanly
 *
 * The dispatcher is forced to fail (or succeed) by stubbing fetch —
 * we use a Xero AP-invoice path because it's the simplest mocked
 * adapter (no CSRF handshake, no chained calls, single PUT).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  stageTransactionalAction, executePendingActions, reviveDeadLetterAction,
  MAX_DISPATCH_RETRIES,
} from '../services/erp-writeback';
import { encrypt } from '../services/encryption';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'retry-tenant';
const CONN = 'retry-conn';
const ENC_KEY = 'test-encryption-key-min-16-chars-for-hkdf';

beforeAll(async () => {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
  });
  if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);

  await env.DB.prepare(`DELETE FROM transactional_actions WHERE tenant_id = ?`).bind(TENANT).run();
  await env.DB.prepare(`DELETE FROM erp_connections WHERE tenant_id = ?`).bind(TENANT).run();
  await env.DB.prepare(`DELETE FROM tenants WHERE id = ?`).bind(TENANT).run();
  await env.DB.prepare(
    `INSERT INTO tenants (id, name, slug, plan, status)
     VALUES (?, 'Retry Test', ?, 'enterprise', 'active')`,
  ).bind(TENANT, `retry-${Date.now()}`).run();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
     VALUES ('erp-xero', 'Xero', 'Xero', '2.0', 'REST', 'available', '[]', '["OAuth 2.0"]')`,
  ).run();

  // Encrypted Xero creds
  const cfgPlain = JSON.stringify({
    client_id: 'CID', client_secret: 'CSEC', tenant_id: 'xero-tenant-1',
    access_token: 'access-1', refresh_token: 'refresh-1',
    token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  const enc = await encrypt(cfgPlain, ENC_KEY);
  await env.DB.prepare(
    `INSERT INTO erp_connections (id, tenant_id, adapter_id, name, status, config, encrypted_config, sync_frequency, records_synced, connected_at)
     VALUES (?, ?, 'erp-xero', 'Retry Test Conn', 'active', '{}', ?, 'hourly', 0, datetime('now'))`,
  ).bind(CONN, TENANT, enc).run();
}, 60_000);

afterEach(async () => {
  vi.unstubAllGlobals();
  // Wipe between tests so each starts from a clean slate
  await env.DB.prepare(`DELETE FROM transactional_actions WHERE tenant_id = ?`).bind(TENANT).run();
});

async function stageAndApprove(refSuffix: string): Promise<string> {
  const staged = await stageTransactionalAction(env.DB, {
    tenantId: TENANT, erpConnectionId: CONN,
    subCatalystName: 'ap-3way-match', actionType: 'ap_invoice_post',
    targetEntity: `INV-${refSuffix}`, sourceRecordRef: `INV-${refSuffix}`,
    payload: {
      vendor_name: 'Acme', invoice: { invoice_number: `INV-${refSuffix}`, invoice_date: '2026-04-15' },
      line_items: [{ description: 'svc', quantity: 1, unit_amount: 1000, account_code: '400' }],
    },
    reasoning: 'matched', postedValue: 1000, currency: 'USD', autoApprove: false,
  });
  await env.DB.prepare(`UPDATE transactional_actions SET status = 'approved' WHERE id = ?`).bind(staged.id).run();
  return staged.id;
}

function stubFetchToFail(status = 502, body = 'Bad Gateway') {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
    status, headers: { 'content-type': 'text/plain' },
  })));
}

function stubFetchToSucceed() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ Invoices: [{ InvoiceID: 'inv-uuid-ok', InvoiceNumber: 'INV-OK' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )));
}

async function readRow(id: string) {
  return env.DB.prepare(
    `SELECT status, retry_count, next_retry_at, dead_letter_at, error FROM transactional_actions WHERE id = ?`,
  ).bind(id).first<{
    status: string; retry_count: number; next_retry_at: string | null;
    dead_letter_at: string | null; error: string | null;
  }>();
}

describe('Phase 10-48 — dispatch retry / backoff', () => {
  it('first failure sets retry_count=1 + next_retry_at in the future + status=failed', async () => {
    const id = await stageAndApprove('R1');
    stubFetchToFail();

    const before = Date.now();
    const out = await executePendingActions(env.DB, TENANT, { encryptionKey: ENC_KEY });
    expect(out.failed).toBe(1);
    expect(out.posted).toBe(0);

    const r = await readRow(id);
    expect(r?.status).toBe('failed');
    expect(r?.retry_count).toBe(1);
    expect(r?.dead_letter_at).toBeNull();
    expect(r?.next_retry_at).toBeTruthy();
    // Backoff schedule[1] = 60s; should land roughly 60s in the future
    const retryMs = Date.parse(r!.next_retry_at!);
    expect(retryMs).toBeGreaterThan(before + 30_000);
    expect(retryMs).toBeLessThan(before + 120_000);
  });

  it('the sweep does NOT pick up failed rows still inside the backoff window', async () => {
    const id = await stageAndApprove('R2');
    stubFetchToFail();
    await executePendingActions(env.DB, TENANT, { encryptionKey: ENC_KEY });

    // Confirm we're at retry_count=1 with a future next_retry_at
    let r = await readRow(id);
    expect(r?.retry_count).toBe(1);

    // Run the sweep again immediately — should be a no-op (no fetch calls).
    const fetchSpy = vi.fn(async () => new Response('should not be called', { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);
    const out = await executePendingActions(env.DB, TENANT, { encryptionKey: ENC_KEY });
    expect(out.failed).toBe(0);
    expect(out.posted).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    r = await readRow(id);
    expect(r?.retry_count).toBe(1); // unchanged
  });

  it('the sweep DOES pick up failed rows once the backoff window has elapsed', async () => {
    const id = await stageAndApprove('R3');
    stubFetchToFail();
    await executePendingActions(env.DB, TENANT, { encryptionKey: ENC_KEY });

    // Time-warp the row's next_retry_at to the past so it becomes eligible
    await env.DB.prepare(
      `UPDATE transactional_actions SET next_retry_at = datetime('now', '-1 minute') WHERE id = ?`,
    ).bind(id).run();

    // Sweep again with another failure — retry_count should bump to 2
    stubFetchToFail();
    const out = await executePendingActions(env.DB, TENANT, { encryptionKey: ENC_KEY });
    expect(out.failed).toBe(1);

    const r = await readRow(id);
    expect(r?.status).toBe('failed');
    expect(r?.retry_count).toBe(2);
    expect(r?.next_retry_at).toBeTruthy();
    // Schedule[2] = 300s; new next_retry_at must be in the future, not the past
    expect(Date.parse(r!.next_retry_at!)).toBeGreaterThan(Date.now());
  });

  it('exhausting MAX_DISPATCH_RETRIES freezes the row at dead_letter', async () => {
    const id = await stageAndApprove('R4');
    stubFetchToFail();

    // Run the sweep MAX_DISPATCH_RETRIES times, time-warping after each failure.
    // After the Nth failure (N == MAX_DISPATCH_RETRIES), the row should be dead_letter.
    for (let i = 1; i <= MAX_DISPATCH_RETRIES; i++) {
      await executePendingActions(env.DB, TENANT, { encryptionKey: ENC_KEY });
      // Pull row to inspect
      const r = await readRow(id);
      if (i < MAX_DISPATCH_RETRIES) {
        // Push next_retry_at into the past so the next sweep picks it up
        expect(r?.status).toBe('failed');
        await env.DB.prepare(
          `UPDATE transactional_actions SET next_retry_at = datetime('now', '-1 minute') WHERE id = ?`,
        ).bind(id).run();
      } else {
        expect(r?.status).toBe('dead_letter');
        expect(r?.retry_count).toBe(MAX_DISPATCH_RETRIES);
        expect(r?.dead_letter_at).toBeTruthy();
        expect(r?.next_retry_at).toBeNull();
      }
    }

    // Even forcing the row past its retry window, the sweep ignores dead_letter
    const fetchSpy = vi.fn(async () => new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);
    const out = await executePendingActions(env.DB, TENANT, { encryptionKey: ENC_KEY });
    expect(out.failed).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reviveDeadLetterAction puts the row back to approved + clears retry state', async () => {
    const id = await stageAndApprove('R5');
    // Manually mark dead_letter to simulate exhaustion
    await env.DB.prepare(
      `UPDATE transactional_actions
          SET status = 'dead_letter', retry_count = ?, dead_letter_at = datetime('now'), error = 'persistent 502'
        WHERE id = ?`,
    ).bind(MAX_DISPATCH_RETRIES, id).run();

    const ok = await reviveDeadLetterAction(env.DB, TENANT, id);
    expect(ok).toBe(true);

    const r = await readRow(id);
    expect(r?.status).toBe('approved');
    expect(r?.retry_count).toBe(0);
    expect(r?.dead_letter_at).toBeNull();
    expect(r?.next_retry_at).toBeNull();
    expect(r?.error).toBeNull();

    // Now the next sweep should pick it up — succeed this time
    stubFetchToSucceed();
    const out = await executePendingActions(env.DB, TENANT, { encryptionKey: ENC_KEY });
    expect(out.posted).toBe(1);
    const after = await readRow(id);
    expect(after?.status).toBe('posted');
  });

  it('successful retry clears error and next_retry_at', async () => {
    const id = await stageAndApprove('R6');
    stubFetchToFail();
    await executePendingActions(env.DB, TENANT, { encryptionKey: ENC_KEY });
    let r = await readRow(id);
    expect(r?.status).toBe('failed');
    expect(r?.error).toBeTruthy();
    expect(r?.next_retry_at).toBeTruthy();

    // Time-warp + succeed
    await env.DB.prepare(
      `UPDATE transactional_actions SET next_retry_at = datetime('now', '-1 minute') WHERE id = ?`,
    ).bind(id).run();
    stubFetchToSucceed();
    const out = await executePendingActions(env.DB, TENANT, { encryptionKey: ENC_KEY });
    expect(out.posted).toBe(1);

    r = await readRow(id);
    expect(r?.status).toBe('posted');
    expect(r?.error).toBeNull();
    expect(r?.next_retry_at).toBeNull();
  });

  it('reviveDeadLetterAction is a no-op for non-dead-letter rows', async () => {
    const id = await stageAndApprove('R7');
    // Row is still 'approved'; revive should refuse (no rows changed).
    const ok = await reviveDeadLetterAction(env.DB, TENANT, id);
    expect(ok).toBe(false);
    const r = await readRow(id);
    expect(r?.status).toBe('approved');
  });
});
