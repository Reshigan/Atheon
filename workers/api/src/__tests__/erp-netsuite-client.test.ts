/**
 * Phase 10-42 — NetSuite REST client.
 *
 * Mocks globalThis.fetch to intercept SuiteTalk REST calls and assert:
 *   - request URL hits <accountId>.suitetalk.api.netsuite.com with the
 *     /services/rest/record/v1/<endpoint> path
 *   - sandbox account IDs (with underscores) are normalised to hyphens
 *   - Authorization header is OAuth 1.0a with HMAC-SHA256 signature
 *     and contains all required oauth_* parameters
 *   - response Location header is parsed for the new internal ID
 *   - error responses surface as NetSuiteError with httpStatus + Type
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  netsuitePostVendorBill, netsuitePostCustomerPayment, netsuitePostJournalEntry,
  netsuiteRestHost, isNetSuiteError,
} from '../services/erp-netsuite-client';
import type { NetSuiteConnectionConfig } from '../services/erp-netsuite-client';

function makeCfg(overrides: Partial<NetSuiteConnectionConfig> = {}): NetSuiteConnectionConfig {
  return {
    account_id: '1234567',
    consumer_key: 'CKEY',
    consumer_secret: 'CSEC',
    token_id: 'TID',
    token_secret: 'TSEC',
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
    return new Response(r.bodyText ?? '', {
      status: r.status ?? 204,
      headers: r.headers ?? {},
    });
  }));
}

describe('Phase 10-42 — NetSuite REST client', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    calls = [];
  });

  describe('netsuiteRestHost', () => {
    it('lowercases the account ID and converts underscores to hyphens', () => {
      expect(netsuiteRestHost('1234567')).toBe('1234567.suitetalk.api.netsuite.com');
      expect(netsuiteRestHost('1234567_SB1')).toBe('1234567-sb1.suitetalk.api.netsuite.com');
      expect(netsuiteRestHost('1234567_SB2')).toBe('1234567-sb2.suitetalk.api.netsuite.com');
    });
  });

  describe('OAuth 1.0a header', () => {
    it('builds Authorization with realm, oauth_consumer_key, oauth_token, signature_method, timestamp, nonce, version, signature', async () => {
      setMockResponses([{
        status: 204,
        headers: { Location: 'https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/vendorBill/9981' },
      }]);
      await netsuitePostVendorBill(makeCfg(), {
        entity: { id: '5' },
        tranId: 'INV-9001',
        expense: { items: [{ account: { id: '400' }, amount: 1000 }] },
      });
      const c = calls[0];
      expect(c.url).toBe('https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/vendorBill');
      const auth = c.headers.Authorization;
      expect(auth).toMatch(/^OAuth /);
      expect(auth).toContain('realm="1234567"');
      expect(auth).toContain('oauth_consumer_key="CKEY"');
      expect(auth).toContain('oauth_token="TID"');
      expect(auth).toContain('oauth_signature_method="HMAC-SHA256"');
      expect(auth).toContain('oauth_version="1.0"');
      expect(auth).toMatch(/oauth_timestamp="\d{10}"/);
      expect(auth).toMatch(/oauth_nonce="[0-9a-f]{32}"/);
      expect(auth).toMatch(/oauth_signature="[^"]+"/);
    });

    it('signs differently for different requests (nonce + timestamp vary)', async () => {
      setMockResponses([
        { status: 204, headers: { Location: 'https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/vendorBill/1' } },
        { status: 204, headers: { Location: 'https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/vendorBill/2' } },
      ]);
      await netsuitePostVendorBill(makeCfg(), {
        entity: { id: '5' }, expense: { items: [{ account: { id: '400' }, amount: 1 }] },
      });
      await netsuitePostVendorBill(makeCfg(), {
        entity: { id: '5' }, expense: { items: [{ account: { id: '400' }, amount: 1 }] },
      });
      const sig1 = /oauth_signature="([^"]+)"/.exec(calls[0].headers.Authorization)?.[1];
      const sig2 = /oauth_signature="([^"]+)"/.exec(calls[1].headers.Authorization)?.[1];
      expect(sig1).toBeDefined();
      expect(sig2).toBeDefined();
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('netsuitePostVendorBill', () => {
    it('POSTs to /vendorBill and returns the internal ID from Location', async () => {
      setMockResponses([{
        status: 204,
        headers: { Location: 'https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/vendorBill/9981' },
      }]);
      const out = await netsuitePostVendorBill(makeCfg(), {
        entity: { id: '5' },
        tranDate: '2026-04-15',
        tranId: 'INV-9001',
        expense: { items: [{ account: { id: '400' }, amount: 1000 }] },
      });
      expect(out.internalId).toBe('9981');
      expect(out.location).toBe('https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/vendorBill/9981');
      expect(calls[0].method).toBe('POST');
      expect(calls[0].body).toEqual({
        entity: { id: '5' },
        tranDate: '2026-04-15',
        tranId: 'INV-9001',
        expense: { items: [{ account: { id: '400' }, amount: 1000 }] },
      });
    });

    it('throws NetSuiteError when no Location header is returned', async () => {
      setMockResponses([{ status: 204, headers: {} }]);
      try {
        await netsuitePostVendorBill(makeCfg(), {
          entity: { id: '5' }, expense: { items: [{ account: { id: '400' }, amount: 1 }] },
        });
        expect.fail('should have thrown');
      } catch (err) {
        expect(isNetSuiteError(err)).toBe(true);
        if (isNetSuiteError(err)) expect(err.message).toContain('no internal ID');
      }
    });
  });

  describe('netsuitePostCustomerPayment', () => {
    it('POSTs to /customerPayment with apply lines and returns the internal ID', async () => {
      setMockResponses([{
        status: 204,
        headers: { Location: 'https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/customerPayment/4421' },
      }]);
      const out = await netsuitePostCustomerPayment(makeCfg(), {
        customer: { id: '17' },
        payment: 5000,
        tranDate: '2026-05-01',
        account: { id: '120' },
        apply: { items: [{ apply: true, doc: '8901', amount: 5000 }] },
      });
      expect(out.internalId).toBe('4421');
      expect(calls[0].url).toBe('https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/customerPayment');
      const body = calls[0].body as { customer: { id: string }; payment: number; apply: { items: unknown[] } };
      expect(body.customer.id).toBe('17');
      expect(body.payment).toBe(5000);
      expect(body.apply.items).toHaveLength(1);
    });
  });

  describe('netsuitePostJournalEntry', () => {
    it('POSTs to /journalEntry with line items and returns the internal ID', async () => {
      setMockResponses([{
        status: 204,
        headers: { Location: 'https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/journalEntry/777' },
      }]);
      const out = await netsuitePostJournalEntry(makeCfg(), {
        tranDate: '2026-04-30',
        memo: 'Recurring depreciation',
        line: {
          items: [
            { account: { id: '6800' }, debit: 32000, memo: 'Dep expense' },
            { account: { id: '1500' }, credit: 32000, memo: 'Accum dep' },
          ],
        },
      });
      expect(out.internalId).toBe('777');
      expect(calls[0].url).toBe('https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/journalEntry');
    });
  });

  describe('error envelopes', () => {
    it('surfaces NetSuite REST validation errors as NetSuiteError', async () => {
      setMockResponses([{
        status: 400,
        bodyText: JSON.stringify({
          type: 'https://www.example.com/validation',
          title: 'Bad Request',
          status: 400,
          'o:errorDetails': [{
            detail: 'Invalid GL account: 9999',
            'o:errorCode': 'INVALID_KEY_OR_REF',
          }],
        }),
      }]);
      try {
        await netsuitePostVendorBill(makeCfg(), {
          entity: { id: '5' }, expense: { items: [{ account: { id: '9999' }, amount: 100 }] },
        });
        expect.fail('should have thrown');
      } catch (err) {
        expect(isNetSuiteError(err)).toBe(true);
        if (isNetSuiteError(err)) {
          expect(err.httpStatus).toBe(400);
          expect(err.netsuiteErrorType).toBe('INVALID_KEY_OR_REF');
          expect(err.message).toContain('Invalid GL account');
        }
      }
    });

    it('surfaces non-JSON 5xx error bodies cleanly', async () => {
      setMockResponses([{ status: 502, bodyText: 'Bad Gateway' }]);
      try {
        await netsuitePostVendorBill(makeCfg(), {
          entity: { id: '5' }, expense: { items: [{ account: { id: '400' }, amount: 1 }] },
        });
        expect.fail('should have thrown');
      } catch (err) {
        expect(isNetSuiteError(err)).toBe(true);
        if (isNetSuiteError(err)) {
          expect(err.httpStatus).toBe(502);
          expect(err.message).toContain('Bad Gateway');
        }
      }
    });
  });

  describe('sandbox accounts', () => {
    it('routes sandbox account IDs to the hyphenated host', async () => {
      setMockResponses([{
        status: 204,
        headers: { Location: 'https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/record/v1/vendorBill/1' },
      }]);
      await netsuitePostVendorBill(makeCfg({ account_id: '1234567_SB1' }), {
        entity: { id: '5' }, expense: { items: [{ account: { id: '400' }, amount: 1 }] },
      });
      expect(calls[0].url).toBe('https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/record/v1/vendorBill');
      expect(calls[0].headers.Authorization).toContain('realm="1234567_SB1"');
    });
  });
});
