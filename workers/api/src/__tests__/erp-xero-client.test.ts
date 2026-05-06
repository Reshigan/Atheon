/**
 * Phase 10-41 — Xero REST client.
 *
 * Mocks globalThis.fetch to intercept Xero API calls and assert:
 *   - request URL hits the right endpoint (/Invoices, /Payments, /ManualJournals)
 *   - Authorization, xero-tenant-id, Idempotency-Key headers are set
 *   - request body wraps the payload in the right envelope ({ Invoices: [...] }, etc.)
 *   - error responses surface as XeroError with httpStatus + Type
 *   - 401 triggers a token refresh + one retry
 *   - proactive refresh fires when token_expires_at is within 60s
 *   - high-level helpers return the first record's identifier
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  xeroPostInvoice, xeroPostPayment, xeroPostManualJournal,
  xeroRefreshToken, isXeroError,
} from '../services/erp-xero-client';
import type { XeroConnectionConfig } from '../services/erp-xero-client';

function makeCfg(overrides: Partial<XeroConnectionConfig> = {}): XeroConnectionConfig {
  return {
    client_id: 'CID',
    client_secret: 'CSEC',
    tenant_id: 'tenant-guid-1',
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides,
  };
}

interface MockCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

let calls: MockCall[];

interface MockResponse {
  status?: number;
  json?: unknown;
  bodyText?: string;
  contentType?: string;
}

function setMockResponses(responses: MockResponse[]): void {
  calls = [];
  let i = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const r = responses[i++];
    if (!r) throw new Error(`unexpected fetch call #${i} (only ${responses.length} mocked)`);
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = init?.method ?? 'GET';
    const body = init?.body ? safeJson(init.body as string) : null;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const k of Object.keys(h)) headers[k] = h[k];
    }
    calls.push({ url, method, body, headers });
    const responseBody = r.bodyText ?? (r.json !== undefined ? JSON.stringify(r.json) : '');
    return new Response(responseBody, {
      status: r.status ?? 200,
      headers: { 'content-type': r.contentType ?? 'application/json' },
    });
  }));
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

describe('Phase 10-41 — Xero REST client', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    calls = [];
  });

  describe('xeroRefreshToken', () => {
    it('POSTs to identity.xero.com with Basic auth + refresh_token grant', async () => {
      setMockResponses([{ json: { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 1800 } }]);
      const out = await xeroRefreshToken(makeCfg());
      expect(out.access_token).toBe('access-2');
      expect(out.refresh_token).toBe('refresh-2');
      expect(out.expires_in).toBe(1800);
      const c = calls[0];
      expect(c.url).toBe('https://identity.xero.com/connect/token');
      expect(c.method).toBe('POST');
      expect(c.headers.Authorization).toBe(`Basic ${btoa('CID:CSEC')}`);
      expect(c.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });

    it('throws XeroError on non-2xx', async () => {
      setMockResponses([{ status: 400, bodyText: '{"error":"invalid_grant"}' }]);
      try {
        await xeroRefreshToken(makeCfg());
        expect.fail('should have thrown');
      } catch (err) {
        expect(isXeroError(err)).toBe(true);
        if (isXeroError(err)) {
          expect(err.httpStatus).toBe(400);
          expect(err.xeroErrorType).toBe('token_refresh_failed');
        }
      }
    });
  });

  describe('xeroPostInvoice', () => {
    it('PUTs to /Invoices with Idempotency-Key + xero-tenant-id', async () => {
      setMockResponses([{
        json: { Invoices: [{ InvoiceID: 'inv-uuid-1', InvoiceNumber: 'INV-0001' }] },
      }]);
      const out = await xeroPostInvoice(makeCfg(), {
        Type: 'ACCPAY',
        Contact: { Name: 'Acme Vendor' },
        Date: '2026-04-15',
        DueDate: '2026-05-15',
        LineItems: [{ Description: 'Services', Quantity: 1, UnitAmount: 1000, AccountCode: '400' }],
        Reference: 'INV-9001',
        Status: 'AUTHORISED',
      }, 'idem-key-1');

      expect(out).toEqual({ InvoiceID: 'inv-uuid-1', InvoiceNumber: 'INV-0001' });
      const c = calls[0];
      expect(c.url).toBe('https://api.xero.com/api.xro/2.0/Invoices');
      expect(c.method).toBe('PUT');
      expect(c.headers.Authorization).toBe('Bearer access-1');
      expect(c.headers['xero-tenant-id']).toBe('tenant-guid-1');
      expect(c.headers['Idempotency-Key']).toBe('idem-key-1');
      const body = c.body as { Invoices: unknown[] };
      expect(body.Invoices).toHaveLength(1);
    });

    it('throws when API returns no invoices in envelope', async () => {
      setMockResponses([{ json: { Invoices: [] } }]);
      await expect(
        xeroPostInvoice(makeCfg(), {
          Type: 'ACCPAY', Contact: { Name: 'X' }, Date: '2026-04-15',
          LineItems: [{ Description: 'x', Quantity: 1, UnitAmount: 1, AccountCode: '400' }],
        }, 'k'),
      ).rejects.toThrow(/no invoices/i);
    });
  });

  describe('xeroPostPayment', () => {
    it('PUTs to /Payments and returns the first PaymentID', async () => {
      setMockResponses([{
        json: { Payments: [{ PaymentID: 'pay-uuid-1', Reference: 'PAY-0001' }] },
      }]);
      const out = await xeroPostPayment(makeCfg(), {
        Invoice: { InvoiceID: 'inv-uuid-1' },
        Account: { Code: '090' },
        Amount: 1000,
        Date: '2026-05-01',
        Reference: 'INV-9001',
      }, 'idem-key-2');
      expect(out).toEqual({ PaymentID: 'pay-uuid-1', Reference: 'PAY-0001' });
      expect(calls[0].url).toBe('https://api.xero.com/api.xro/2.0/Payments');
      expect(calls[0].method).toBe('PUT');
    });
  });

  describe('xeroPostManualJournal', () => {
    it('PUTs to /ManualJournals and returns the first ManualJournalID', async () => {
      setMockResponses([{
        json: { ManualJournals: [{ ManualJournalID: 'je-uuid-1' }] },
      }]);
      const out = await xeroPostManualJournal(makeCfg(), {
        Narration: 'Recurring depreciation Apr',
        Date: '2026-04-30',
        Status: 'POSTED',
        JournalLines: [
          { Description: 'Dep expense', LineAmount: 32000, AccountCode: '6800' },
          { Description: 'Accum dep',   LineAmount: -32000, AccountCode: '1500' },
        ],
      }, 'idem-key-3');
      expect(out).toEqual({ ManualJournalID: 'je-uuid-1' });
      expect(calls[0].url).toBe('https://api.xero.com/api.xro/2.0/ManualJournals');
    });
  });

  describe('error envelopes', () => {
    it('surfaces Xero validation errors as XeroError with httpStatus + Type', async () => {
      setMockResponses([{
        status: 400,
        json: {
          Type: 'ValidationException',
          Message: 'A validation exception occurred',
          Elements: [{ ValidationErrors: [{ Message: 'Account code 9999 is not a valid code' }] }],
        },
      }]);
      try {
        await xeroPostInvoice(makeCfg(), {
          Type: 'ACCPAY', Contact: { Name: 'X' }, Date: '2026-04-15',
          LineItems: [{ Description: 'x', Quantity: 1, UnitAmount: 1, AccountCode: '9999' }],
        }, 'k');
        expect.fail('should have thrown');
      } catch (err) {
        expect(isXeroError(err)).toBe(true);
        if (isXeroError(err)) {
          expect(err.httpStatus).toBe(400);
          expect(err.xeroErrorType).toBe('ValidationException');
          expect(err.message).toContain('validation');
        }
      }
    });

    it('surfaces non-JSON error bodies cleanly', async () => {
      setMockResponses([{ status: 502, bodyText: 'Bad Gateway' }]);
      try {
        await xeroPostInvoice(makeCfg(), {
          Type: 'ACCPAY', Contact: { Name: 'X' }, Date: '2026-04-15',
          LineItems: [{ Description: 'x', Quantity: 1, UnitAmount: 1, AccountCode: '400' }],
        }, 'k');
        expect.fail('should have thrown');
      } catch (err) {
        expect(isXeroError(err)).toBe(true);
        if (isXeroError(err)) {
          expect(err.httpStatus).toBe(502);
          expect(err.message).toContain('Bad Gateway');
        }
      }
    });
  });

  describe('token refresh', () => {
    it('proactively refreshes when token_expires_at is within 60s', async () => {
      const expiringSoon = new Date(Date.now() + 30_000).toISOString();
      const cfg = makeCfg({ token_expires_at: expiringSoon });
      setMockResponses([
        { json: { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 1800 } },
        { json: { Invoices: [{ InvoiceID: 'inv-uuid-1', InvoiceNumber: 'INV-0001' }] } },
      ]);
      await xeroPostInvoice(cfg, {
        Type: 'ACCPAY', Contact: { Name: 'X' }, Date: '2026-04-15',
        LineItems: [{ Description: 'x', Quantity: 1, UnitAmount: 1, AccountCode: '400' }],
      }, 'k');
      expect(calls).toHaveLength(2);
      expect(calls[0].url).toBe('https://identity.xero.com/connect/token');
      expect(calls[1].url).toBe('https://api.xero.com/api.xro/2.0/Invoices');
      expect(calls[1].headers.Authorization).toBe('Bearer access-2');
      // cfg should be mutated with new token so callers can persist
      expect(cfg.access_token).toBe('access-2');
      expect(cfg.refresh_token).toBe('refresh-2');
    });

    it('reactively refreshes on 401 and retries once', async () => {
      const cfg = makeCfg();
      setMockResponses([
        { status: 401, bodyText: '{"Type":"unauthorized"}' },
        { json: { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 1800 } },
        { json: { Invoices: [{ InvoiceID: 'inv-uuid-1', InvoiceNumber: 'INV-0001' }] } },
      ]);
      const out = await xeroPostInvoice(cfg, {
        Type: 'ACCPAY', Contact: { Name: 'X' }, Date: '2026-04-15',
        LineItems: [{ Description: 'x', Quantity: 1, UnitAmount: 1, AccountCode: '400' }],
      }, 'k');
      expect(out.InvoiceNumber).toBe('INV-0001');
      expect(calls).toHaveLength(3);
      // 1st: original API call (401)
      expect(calls[0].url).toBe('https://api.xero.com/api.xro/2.0/Invoices');
      expect(calls[0].headers.Authorization).toBe('Bearer access-1');
      // 2nd: token refresh
      expect(calls[1].url).toBe('https://identity.xero.com/connect/token');
      // 3rd: retry with new token
      expect(calls[2].url).toBe('https://api.xero.com/api.xro/2.0/Invoices');
      expect(calls[2].headers.Authorization).toBe('Bearer access-2');
      expect(cfg.access_token).toBe('access-2');
    });
  });
});
