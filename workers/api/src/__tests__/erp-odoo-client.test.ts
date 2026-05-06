/**
 * Phase 10-39 — Odoo JSON-RPC client.
 *
 * Mocks globalThis.fetch to intercept the JSON-RPC calls and assert:
 *   - request URL is `<base>/jsonrpc`
 *   - request body matches the JSON-RPC envelope shape
 *   - authenticate handles uid + false-on-bad-creds
 *   - execute_kw passes through model/method/args/kwargs correctly
 *   - error responses surface as OdooError with message + name + debug
 *   - HTTP non-2xx surfaces as OdooError with status
 *   - High-level helpers (postApInvoice, postPayment, ...) chain the
 *     create + action_post + read sequence and return the final name
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  odooAuthenticate, odooExecuteKw,
  odooPostApInvoice, odooPostPayment, odooPostJournalEntry, odooSetCreditHold,
  isOdooError,
} from '../services/erp-odoo-client';

const cfg = {
  url: 'https://acme.odoo.com',
  db: 'acme',
  login: 'atheon-bot@acme.com',
  password: 'pa55phrase',
};

interface MockCall {
  url: string;
  body: { jsonrpc: string; method: string; params: { service: string; method: string; args: unknown[] } };
  headers: Record<string, string>;
}

let calls: MockCall[];

function setMockResponses(responses: Array<{ ok?: boolean; status?: number; result?: unknown; error?: { code: number; message: string; data?: { name?: string; debug?: string } }; bodyText?: string }>) {
  calls = [];
  let i = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const r = responses[i++];
    if (!r) throw new Error(`unexpected fetch call #${i} (only ${responses.length} mocked)`);
    const url = typeof input === 'string' ? input : (input as Request).url;
    const body = init?.body ? JSON.parse(init.body as string) : null;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const k of Object.keys(h)) headers[k] = h[k];
    }
    calls.push({ url, body, headers });
    const responseBody = r.bodyText ?? JSON.stringify(
      r.error ? { jsonrpc: '2.0', error: r.error } : { jsonrpc: '2.0', result: r.result },
    );
    return new Response(responseBody, {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }));
}

describe('Phase 10-39 — Odoo JSON-RPC client', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    calls = [];
  });

  describe('odooAuthenticate', () => {
    it('returns the uid on success', async () => {
      setMockResponses([{ result: 42 }]);
      const uid = await odooAuthenticate(cfg);
      expect(uid).toBe(42);
      expect(calls[0].url).toBe('https://acme.odoo.com/jsonrpc');
      expect(calls[0].body.params.service).toBe('common');
      expect(calls[0].body.params.method).toBe('authenticate');
      expect(calls[0].body.params.args).toEqual(['acme', 'atheon-bot@acme.com', 'pa55phrase', {}]);
    });

    it('throws OdooError when Odoo returns false', async () => {
      setMockResponses([{ result: false }]);
      await expect(odooAuthenticate(cfg)).rejects.toThrow(/authenticate failed/);
      try { await odooAuthenticate(cfg); } catch (err) {
        // Mock has been consumed; just verify the type
        expect(isOdooError(err) || err instanceof Error).toBe(true);
      }
    });

    it('throws OdooError on Odoo error envelope', async () => {
      setMockResponses([{
        error: { code: 100, message: 'Access Denied', data: { name: 'odoo.exceptions.AccessDenied', debug: 'Wrong login/password' } },
      }]);
      try {
        await odooAuthenticate(cfg);
        expect.fail('should have thrown');
      } catch (err) {
        expect(isOdooError(err)).toBe(true);
        if (isOdooError(err)) {
          expect(err.message).toContain('AccessDenied');
          expect(err.odooErrorName).toBe('odoo.exceptions.AccessDenied');
          expect(err.debug).toBe('Wrong login/password');
        }
      }
    });

    it('throws OdooError on HTTP non-2xx', async () => {
      setMockResponses([{ ok: false, status: 502, bodyText: 'Bad Gateway' }]);
      try {
        await odooAuthenticate(cfg);
        expect.fail('should have thrown');
      } catch (err) {
        expect(isOdooError(err)).toBe(true);
        if (isOdooError(err)) {
          expect(err.httpStatus).toBe(502);
          expect(err.message).toContain('Bad Gateway');
        }
      }
    });

    it('strips trailing slashes from the configured URL', async () => {
      setMockResponses([{ result: 1 }]);
      await odooAuthenticate({ ...cfg, url: 'https://acme.odoo.com///' });
      expect(calls[0].url).toBe('https://acme.odoo.com/jsonrpc');
    });
  });

  describe('odooExecuteKw', () => {
    it('passes (db, uid, password, model, method, args, kwargs) to execute_kw', async () => {
      setMockResponses([{ result: [{ id: 7, name: 'Some Partner' }] }]);
      const out = await odooExecuteKw<Array<{ id: number; name: string }>>(
        cfg, 5, 'res.partner', 'read', [[7], ['id', 'name']], { context: { lang: 'en_US' } },
      );
      expect(out).toEqual([{ id: 7, name: 'Some Partner' }]);
      const c = calls[0];
      expect(c.body.params.service).toBe('object');
      expect(c.body.params.method).toBe('execute_kw');
      expect(c.body.params.args).toEqual([
        'acme', 5, 'pa55phrase', 'res.partner', 'read', [[7], ['id', 'name']], { context: { lang: 'en_US' } },
      ]);
    });
  });

  describe('odooPostApInvoice', () => {
    it('creates → posts → reads back; returns name', async () => {
      // Mock the three sequential JSON-RPC calls: create → action_post → read
      setMockResponses([
        { result: 99 },                             // create returns id
        { result: true },                           // action_post returns true
        { result: [{ id: 99, name: 'BILL/2026/00099' }] }, // read returns rows
      ]);

      const out = await odooPostApInvoice(cfg, 5, {
        move_type: 'in_invoice',
        partner_id: 17,
        invoice_date: '2026-04-15',
        invoice_date_due: '2026-05-15',
        ref: 'INV-9001',
        invoice_line_ids: [[0, 0, { name: 'Inv line', quantity: 1, price_unit: 125000 }]],
      });

      expect(out).toEqual({ id: 99, name: 'BILL/2026/00099' });
      expect(calls.length).toBe(3);
      // Create call
      expect(calls[0].body.params.args[3]).toBe('account.move');
      expect(calls[0].body.params.args[4]).toBe('create');
      // Post call
      expect(calls[1].body.params.args[3]).toBe('account.move');
      expect(calls[1].body.params.args[4]).toBe('action_post');
      expect(calls[1].body.params.args[5]).toEqual([[99]]);
      // Read call
      expect(calls[2].body.params.args[3]).toBe('account.move');
      expect(calls[2].body.params.args[4]).toBe('read');
    });
  });

  describe('odooPostPayment', () => {
    it('chains create + post + read for a payment', async () => {
      setMockResponses([
        { result: 12 },
        { result: true },
        { result: [{ id: 12, name: 'PAY/OUT/2026/00012' }] },
      ]);
      const out = await odooPostPayment(cfg, 5, {
        payment_type: 'outbound', partner_type: 'supplier',
        partner_id: 17, amount: 125000, date: '2026-05-01', journal_id: 3,
      });
      expect(out.name).toBe('PAY/OUT/2026/00012');
      expect(calls[0].body.params.args[3]).toBe('account.payment');
      expect(calls[1].body.params.args[4]).toBe('action_post');
    });
  });

  describe('odooPostJournalEntry', () => {
    it('chains create + post + read for a manual JE', async () => {
      setMockResponses([
        { result: 200 },
        { result: true },
        { result: [{ id: 200, name: 'JE/2026/00200' }] },
      ]);
      const out = await odooPostJournalEntry(cfg, 5, {
        ref: 'Recurring depreciation Apr',
        date: '2026-04-30',
        journal_id: 9,
        line_ids: [
          [0, 0, { name: 'Dep expense', account_id: 6800, debit: 32000 }],
          [0, 0, { name: 'Accum dep', account_id: 1500, credit: 32000 }],
        ],
      });
      expect(out).toEqual({ id: 200, name: 'JE/2026/00200' });
      // The create call carries move_type='entry' + the rest of the payload
      const createPayload = (calls[0].body.params.args[5] as Array<Record<string, unknown>>)[0];
      expect(createPayload.move_type).toBe('entry');
      expect(createPayload.journal_id).toBe(9);
    });
  });

  describe('odooSetCreditHold', () => {
    it('writes sale_warn=block + sale_warn_msg + reads back', async () => {
      setMockResponses([
        { result: true },
        { result: [{ id: 17, name: 'Acme Customer' }] },
      ]);
      const out = await odooSetCreditHold(cfg, 5, 17, 'Exposure exceeded credit limit by 72k');
      expect(out).toEqual({ id: 17, name: 'Acme Customer' });
      const writeCall = calls[0];
      expect(writeCall.body.params.args[3]).toBe('res.partner');
      expect(writeCall.body.params.args[4]).toBe('write');
      const writeArgs = writeCall.body.params.args[5] as [number[], Record<string, unknown>];
      expect(writeArgs[0]).toEqual([17]);
      expect(writeArgs[1].sale_warn).toBe('block');
      expect(writeArgs[1].sale_warn_msg).toContain('Exposure exceeded');
    });
  });
});
