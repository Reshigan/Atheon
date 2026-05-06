/**
 * Phase 10-43 — SAP S/4HANA OData client.
 *
 * Mocks globalThis.fetch to intercept the CSRF handshake + write
 * sequence and assert:
 *   - the CSRF GET hits the service root with header `x-csrf-token: fetch`
 *     and Basic auth
 *   - the POST hits the entity-set URL with the returned x-csrf-token,
 *     the cookies from Set-Cookie, and Basic auth
 *   - sap-client query param is appended when configured
 *   - response { d: { ... } } envelope is unwrapped and the document
 *     key is returned
 *   - error responses surface as SapError with httpStatus + code
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  sapPostSupplierInvoice, sapPostIncomingPayment, sapPostJournalEntry,
  sapFetchCsrf, isSapError,
} from '../services/erp-sap-client';
import type { SapConnectionConfig } from '../services/erp-sap-client';

function makeCfg(overrides: Partial<SapConnectionConfig> = {}): SapConnectionConfig {
  return {
    base_url: 'https://my-sap.example.com',
    user: 'ATHEON_BOT',
    password: 'pa55phrase',
    ...overrides,
  };
}

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: MockCall[];

interface MockResponse {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  bodyText?: string;
}

function setMockResponses(responses: MockResponse[]): void {
  calls = [];
  let i = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const r = responses[i++];
    if (!r) throw new Error(`unexpected fetch call #${i} (only ${responses.length} mocked)`);
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = init?.method ?? 'GET';
    let body: unknown = null;
    if (init?.body) { try { body = JSON.parse(init.body as string); } catch { body = init.body; } }
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const k of Object.keys(h)) headers[k] = h[k];
    }
    calls.push({ url, method, headers, body });
    const responseBody = r.bodyText ?? (r.json !== undefined ? JSON.stringify(r.json) : '');
    return new Response(responseBody, {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
    });
  }));
}

describe('Phase 10-43 — SAP OData client', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    calls = [];
  });

  describe('CSRF handshake', () => {
    it('GETs the service root with x-csrf-token: fetch + Basic auth, returns token + cookies', async () => {
      setMockResponses([{
        headers: {
          'x-csrf-token': 'CSRF-TOKEN-1',
          'set-cookie': 'MYSAPSSO2=cookie2; path=/; secure',
        },
        json: { d: { EntitySets: [] } },
      }]);
      const out = await sapFetchCsrf(makeCfg(), '/sap/opu/odata/sap/API_X');
      expect(out.token).toBe('CSRF-TOKEN-1');
      expect(out.cookies).toContain('MYSAPSSO2=cookie2');
      // attributes (path, secure) must be stripped — only name=value
      expect(out.cookies).not.toContain('path=');
      expect(out.cookies).not.toContain('secure');
      const c = calls[0];
      expect(c.url).toBe('https://my-sap.example.com/sap/opu/odata/sap/API_X/');
      expect(c.headers['x-csrf-token']).toBe('fetch');
      expect(c.headers.Authorization).toBe(`Basic ${btoa('ATHEON_BOT:pa55phrase')}`);
    });

    it('appends sap-client query param when configured', async () => {
      setMockResponses([{
        headers: { 'x-csrf-token': 'T1' },
        json: { d: {} },
      }]);
      await sapFetchCsrf(makeCfg({ client: '100' }), '/sap/opu/odata/sap/API_X');
      expect(calls[0].url).toBe('https://my-sap.example.com/sap/opu/odata/sap/API_X/?sap-client=100');
    });

    it('throws SapError when CSRF returns no token', async () => {
      setMockResponses([{ json: { d: {} }, headers: {} }]);
      try {
        await sapFetchCsrf(makeCfg(), '/sap/opu/odata/sap/API_X');
        expect.fail('should have thrown');
      } catch (err) {
        expect(isSapError(err)).toBe(true);
        if (isSapError(err)) expect(err.sapErrorCode).toBe('csrf_missing');
      }
    });

    it('throws SapError on CSRF GET non-2xx', async () => {
      setMockResponses([{ status: 401, bodyText: 'Unauthorized' }]);
      try {
        await sapFetchCsrf(makeCfg(), '/sap/opu/odata/sap/API_X');
        expect.fail('should have thrown');
      } catch (err) {
        expect(isSapError(err)).toBe(true);
        if (isSapError(err)) {
          expect(err.httpStatus).toBe(401);
          expect(err.sapErrorCode).toBe('csrf_fetch_failed');
        }
      }
    });
  });

  describe('sapPostSupplierInvoice', () => {
    it('does CSRF handshake, then POSTs with token + cookies, returns SupplierInvoice', async () => {
      setMockResponses([
        { headers: { 'x-csrf-token': 'T1', 'set-cookie': 'sap-usercontext=client=100; path=/' }, json: { d: {} } },
        { status: 201, json: { d: { SupplierInvoice: '5105612345', FiscalYear: '2026' } } },
      ]);
      const out = await sapPostSupplierInvoice(makeCfg(), {
        CompanyCode: '1000',
        DocumentDate: '2026-04-15',
        PostingDate: '2026-04-15',
        InvoicingParty: '0001000017',
        DocumentCurrency: 'USD',
        InvoiceGrossAmount: '1000.00',
      });
      expect(out).toEqual({ SupplierInvoice: '5105612345', FiscalYear: '2026' });
      expect(calls).toHaveLength(2);
      // CSRF call
      expect(calls[0].method).toBe('GET');
      expect(calls[0].headers['x-csrf-token']).toBe('fetch');
      // Write call
      expect(calls[1].method).toBe('POST');
      expect(calls[1].url).toBe('https://my-sap.example.com/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice');
      expect(calls[1].headers['x-csrf-token']).toBe('T1');
      expect(calls[1].headers.Cookie).toContain('sap-usercontext=client=100');
      expect(calls[1].headers.Authorization).toBe(`Basic ${btoa('ATHEON_BOT:pa55phrase')}`);
    });

    it('appends sap-client to both the CSRF GET and the POST when configured', async () => {
      setMockResponses([
        { headers: { 'x-csrf-token': 'T1' }, json: { d: {} } },
        { status: 201, json: { d: { SupplierInvoice: '1', FiscalYear: '2026' } } },
      ]);
      await sapPostSupplierInvoice(makeCfg({ client: '100' }), {
        CompanyCode: '1000', DocumentDate: '2026-04-15', PostingDate: '2026-04-15',
        InvoicingParty: '17', DocumentCurrency: 'USD', InvoiceGrossAmount: '100.00',
      });
      expect(calls[0].url).toContain('sap-client=100');
      expect(calls[1].url).toContain('sap-client=100');
    });
  });

  describe('sapPostIncomingPayment', () => {
    it('POSTs to /IncomingPayment and returns the PaymentDocument', async () => {
      setMockResponses([
        { headers: { 'x-csrf-token': 'T1' }, json: { d: {} } },
        { status: 201, json: { d: { PaymentDocument: '1400000123', FiscalYear: '2026' } } },
      ]);
      const out = await sapPostIncomingPayment(makeCfg(), {
        CompanyCode: '1000', PostingDate: '2026-05-01',
        Customer: '0000200017', PaymentAmount: '5000.00', PaymentCurrency: 'USD',
      });
      expect(out.PaymentDocument).toBe('1400000123');
      expect(calls[1].url).toBe('https://my-sap.example.com/sap/opu/odata/sap/API_INCOMINGPAYMENT_SRV/IncomingPayment');
    });
  });

  describe('sapPostJournalEntry', () => {
    it('POSTs to /A_JournalEntry and returns the AccountingDocument', async () => {
      setMockResponses([
        { headers: { 'x-csrf-token': 'T1' }, json: { d: {} } },
        { status: 201, json: { d: { AccountingDocument: '4900000777', FiscalYear: '2026' } } },
      ]);
      const out = await sapPostJournalEntry(makeCfg(), {
        CompanyCode: '1000', DocumentDate: '2026-04-30', PostingDate: '2026-04-30',
        AccountingDocumentType: 'SA',
        to_JournalEntryItem: { results: [
          { CompanyCode: '1000', GLAccount: '6800000', DebitCreditCode: 'S', AmountInTransactionCurrency: '32000.00', TransactionCurrency: 'USD' },
          { CompanyCode: '1000', GLAccount: '1500000', DebitCreditCode: 'H', AmountInTransactionCurrency: '32000.00', TransactionCurrency: 'USD' },
        ] },
      });
      expect(out.AccountingDocument).toBe('4900000777');
      expect(calls[1].url).toBe('https://my-sap.example.com/sap/opu/odata/sap/API_JOURNALENTRY_SRV/A_JournalEntry');
    });
  });

  describe('error envelopes', () => {
    it('surfaces SAP OData error envelope as SapError with code + message', async () => {
      setMockResponses([
        { headers: { 'x-csrf-token': 'T1' }, json: { d: {} } },
        {
          status: 400,
          json: {
            error: {
              code: 'FI/CORE/050',
              message: { lang: 'en', value: 'Posting period 04 2026 is not open for company code 1000' },
            },
          },
        },
      ]);
      try {
        await sapPostJournalEntry(makeCfg(), {
          CompanyCode: '1000', DocumentDate: '2026-04-30', PostingDate: '2026-04-30',
          AccountingDocumentType: 'SA',
          to_JournalEntryItem: { results: [] },
        });
        expect.fail('should have thrown');
      } catch (err) {
        expect(isSapError(err)).toBe(true);
        if (isSapError(err)) {
          expect(err.httpStatus).toBe(400);
          expect(err.sapErrorCode).toBe('FI/CORE/050');
          expect(err.message).toContain('Posting period');
        }
      }
    });

    it('surfaces non-JSON 5xx error bodies cleanly', async () => {
      setMockResponses([
        { headers: { 'x-csrf-token': 'T1' }, json: { d: {} } },
        { status: 500, bodyText: 'Internal Server Error' },
      ]);
      try {
        await sapPostSupplierInvoice(makeCfg(), {
          CompanyCode: '1000', DocumentDate: '2026-04-15', PostingDate: '2026-04-15',
          InvoicingParty: '17', DocumentCurrency: 'USD', InvoiceGrossAmount: '100.00',
        });
        expect.fail('should have thrown');
      } catch (err) {
        expect(isSapError(err)).toBe(true);
        if (isSapError(err)) {
          expect(err.httpStatus).toBe(500);
          expect(err.message).toContain('Internal Server Error');
        }
      }
    });
  });
});
