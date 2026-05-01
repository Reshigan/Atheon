/**
 * Sage Intacct Live Write Adapter — Phase 9-6.
 *
 * Sage Intacct uses an XML API at https://api.intacct.com/ia/xml/xmlgw.phtml
 * with session-based auth (NOT OAuth). The flow is:
 *   1. POST a `getAPISession` envelope with sender_id + sender_password
 *      and login (company + user_id + password). Returns a sessionid +
 *      endpoint URL.
 *   2. POST subsequent function calls (create_potransaction, create_apdoc,
 *      etc.) wrapped in the same session envelope using sessionid.
 *
 * The session is cached on the connection (encrypted_config.session_id +
 * session_endpoint) so each subsequent call skips re-auth. Sessions
 * expire after ~30 minutes of inactivity; a 401 / session-error response
 * triggers re-auth + retry.
 */

import type {
  CatalystWriteAction,
  ActionExecutionResult,
  ActionType,
  AdapterContext,
} from './erp-write-actions';
import { encrypt, decrypt, isEncrypted } from './encryption';
import { logError } from './logger';

const DEFAULT_GATEWAY = 'https://api.intacct.com/ia/xml/xmlgw.phtml';
const MAX_RETRIES = 3;

export interface IntacctCredentials {
  /** Application-level credentials issued by Sage to the integrator. */
  sender_id?: string;
  sender_password?: string;
  /** Customer-tenant credentials. */
  company_id?: string;
  user_id?: string;
  user_password?: string;
  /** Cached session — populated after getAPISession. */
  session_id?: string;
  session_endpoint?: string;
  live_mode?: boolean;
}

function escapeXml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function envelope(c: IntacctCredentials, controlId: string, operationXml: string, useSession: boolean): string {
  const auth = useSession && c.session_id
    ? `<sessionid>${escapeXml(c.session_id)}</sessionid>`
    : `<login>
         <userid>${escapeXml(c.user_id)}</userid>
         <companyid>${escapeXml(c.company_id)}</companyid>
         <password>${escapeXml(c.user_password)}</password>
       </login>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<request>
  <control>
    <senderid>${escapeXml(c.sender_id)}</senderid>
    <password>${escapeXml(c.sender_password)}</password>
    <controlid>${escapeXml(controlId)}</controlid>
    <uniqueid>false</uniqueid>
    <dtdversion>3.0</dtdversion>
    <includewhitespace>false</includewhitespace>
  </control>
  <operation>
    <authentication>${auth}</authentication>
    <content>
      ${operationXml}
    </content>
  </operation>
</request>`;
}

interface IntacctResponse {
  status: 'success' | 'failure';
  controlStatus?: string;
  errorMessage?: string;
  /** When successful, the inner data XML returned by the function. */
  data?: string;
  /** Session info (only present on getAPISession success). */
  sessionId?: string;
  sessionEndpoint?: string;
}

/** Tiny tag extractor — pull the first match for `<tag>...</tag>`. */
function findTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}

function parseIntacctResponse(xml: string): IntacctResponse {
  const controlStatus = findTag(xml, 'status');
  // Operation-level error
  const errorMessage = findTag(xml, 'description2') || findTag(xml, 'description') || findTag(xml, 'errormessage');
  if (controlStatus === 'failure' || errorMessage) {
    return { status: 'failure', controlStatus: controlStatus || undefined, errorMessage: errorMessage || 'Intacct returned failure' };
  }
  // Session info
  const sessionId = findTag(xml, 'sessionid');
  const sessionEndpoint = findTag(xml, 'endpoint');
  return { status: 'success', controlStatus: controlStatus || undefined, sessionId: sessionId || undefined, sessionEndpoint: sessionEndpoint || undefined, data: xml };
}

async function persistSession(
  db: D1Database, tenantId: string, connectionId: string,
  newSessionId: string, newSessionEndpoint: string | undefined, encryptionKey: string | undefined,
): Promise<void> {
  try {
    const row = await db.prepare('SELECT encrypted_config, config FROM erp_connections WHERE id = ? AND tenant_id = ?')
      .bind(connectionId, tenantId).first<{ encrypted_config: string | null; config: string }>();
    if (!row) return;
    let parsed: IntacctCredentials = {};
    if (row.encrypted_config && isEncrypted(row.encrypted_config) && encryptionKey) {
      const dec = await decrypt(row.encrypted_config, encryptionKey);
      if (dec) parsed = JSON.parse(dec);
    } else if (row.config && row.config !== '{}') {
      parsed = JSON.parse(row.config);
    }
    parsed.session_id = newSessionId;
    if (newSessionEndpoint) parsed.session_endpoint = newSessionEndpoint;
    const json = JSON.stringify(parsed);
    if (encryptionKey && encryptionKey.length >= 16) {
      const enc = await encrypt(json, encryptionKey);
      await db.prepare(`UPDATE erp_connections SET encrypted_config = ?, config = '{}' WHERE id = ? AND tenant_id = ?`)
        .bind(enc, connectionId, tenantId).run();
    } else {
      await db.prepare(`UPDATE erp_connections SET config = ? WHERE id = ? AND tenant_id = ?`)
        .bind(json, connectionId, tenantId).run();
    }
  } catch (err) {
    logError('intacct.live.session_persist_failed', err, { tenantId }, { connectionId });
  }
}

async function postIntacct(
  endpoint: string, body: string,
): Promise<{ ok: boolean; status: number; xml: string }> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml', Accept: 'application/xml' },
    body,
  });
  const xml = await res.text();
  return { ok: res.ok, status: res.status, xml };
}

async function ensureSession(
  ctx: AdapterContext, tenantId: string, connectionId: string,
  c: IntacctCredentials, encryptionKey: string | undefined,
): Promise<{ sessionId: string; endpoint: string } | null> {
  if (c.session_id && c.session_endpoint) return { sessionId: c.session_id, endpoint: c.session_endpoint };
  if (!c.sender_id || !c.sender_password || !c.company_id || !c.user_id || !c.user_password) return null;

  const body = envelope(c, `atheon-${Date.now()}`,
    `<function controlid="atheon-getsession"><getAPISession /></function>`, false);
  const res = await postIntacct(DEFAULT_GATEWAY, body);
  if (!res.ok) return null;
  const parsed = parseIntacctResponse(res.xml);
  if (parsed.status === 'failure' || !parsed.sessionId) return null;

  c.session_id = parsed.sessionId;
  c.session_endpoint = parsed.sessionEndpoint || DEFAULT_GATEWAY;
  await persistSession(ctx.db, tenantId, connectionId, parsed.sessionId, parsed.sessionEndpoint, encryptionKey);
  return { sessionId: parsed.sessionId, endpoint: parsed.sessionEndpoint || DEFAULT_GATEWAY };
}

interface IntacctCall { controlId: string; functionXml: string }

type LiveCallable = (a: CatalystWriteAction) => IntacctCall;

const LIVE_CALLS: Partial<Record<ActionType, LiveCallable>> = {
  ap_payment_release: (a) => ({
    controlId: `atheon-pay-${a.idempotency_key}`,
    functionXml: `<function controlid="atheon-pay-${escapeXml(a.idempotency_key)}">
      <create>
        <APPYMT>
          <FINANCIALENTITY>${escapeXml(a.payload.financial_entity)}</FINANCIALENTITY>
          <PAYMENTMETHOD>${escapeXml(a.payload.payment_method || 'Printed Check')}</PAYMENTMETHOD>
          <VENDORID>${escapeXml(a.payload.vendor_id)}</VENDORID>
          <PAYMENTDATE>${escapeXml(a.payload.payment_date || new Date().toISOString().slice(0, 10))}</PAYMENTDATE>
          <APPYMTDETAILS>
            ${(a.payload.details as Array<{ apdoc_id: string; amount: number }> || []).map((d) => `
              <APPYMTDETAIL>
                <RECORDKEY>${escapeXml(d.apdoc_id)}</RECORDKEY>
                <PAYMENTAMOUNT>${escapeXml(d.amount)}</PAYMENTAMOUNT>
              </APPYMTDETAIL>`).join('')}
          </APPYMTDETAILS>
        </APPYMT>
      </create>
    </function>`,
  }),
  po_create: (a) => ({
    controlId: `atheon-po-${a.idempotency_key}`,
    functionXml: `<function controlid="atheon-po-${escapeXml(a.idempotency_key)}">
      <create_potransaction>
        <transactiontype>Purchase Order</transactiontype>
        <datecreated><year>${escapeXml((a.payload.date as string || new Date().toISOString().slice(0,10)).slice(0,4))}</year><month>${escapeXml((a.payload.date as string || new Date().toISOString().slice(0,10)).slice(5,7))}</month><day>${escapeXml((a.payload.date as string || new Date().toISOString().slice(0,10)).slice(8,10))}</day></datecreated>
        <vendorid>${escapeXml(a.payload.vendor_id)}</vendorid>
        <potransitems>
          ${(a.payload.line_items as Array<{ item_id: string; quantity: number; price?: number }> || []).map((li) => `
            <potransitem>
              <itemid>${escapeXml(li.item_id)}</itemid>
              <quantity>${escapeXml(li.quantity)}</quantity>
              ${li.price !== undefined ? `<price>${escapeXml(li.price)}</price>` : ''}
            </potransitem>`).join('')}
        </potransitems>
      </create_potransaction>
    </function>`,
  }),
  journal_post: (a) => ({
    controlId: `atheon-je-${a.idempotency_key}`,
    functionXml: `<function controlid="atheon-je-${escapeXml(a.idempotency_key)}">
      <create_gltransaction>
        <journalid>${escapeXml(a.payload.journal_id)}</journalid>
        <description>${escapeXml(a.payload.description || `Atheon-${a.idempotency_key}`)}</description>
        <gltransactionentries>
          ${(a.payload.entries as Array<{ account: string; debit?: number; credit?: number; memo?: string }> || []).map((e) => `
            <gltransactionentry>
              <glaccountno>${escapeXml(e.account)}</glaccountno>
              ${e.debit !== undefined ? `<trtype>1</trtype><amount>${escapeXml(e.debit)}</amount>` : ''}
              ${e.credit !== undefined ? `<trtype>-1</trtype><amount>${escapeXml(e.credit)}</amount>` : ''}
              ${e.memo ? `<memo>${escapeXml(e.memo)}</memo>` : ''}
            </gltransactionentry>`).join('')}
        </gltransactionentries>
      </create_gltransaction>
    </function>`,
  }),
  invoice_post: (a) => ({
    controlId: `atheon-inv-${a.idempotency_key}`,
    functionXml: `<function controlid="atheon-inv-${escapeXml(a.idempotency_key)}">
      <update_arinvoice>
        <recordno>${escapeXml(a.payload.invoice_id)}</recordno>
        <state>posted</state>
      </update_arinvoice>
    </function>`,
  }),
  customer_credit_update: (a) => ({
    controlId: `atheon-cust-${a.idempotency_key}`,
    functionXml: `<function controlid="atheon-cust-${escapeXml(a.idempotency_key)}">
      <update_customer>
        <customerid>${escapeXml(a.payload.customer_id)}</customerid>
        <creditlimit>${escapeXml(a.payload.credit_limit)}</creditlimit>
      </update_customer>
    </function>`,
  }),
};

export interface IntacctLiveExecuteOptions { tenantId: string; connectionId: string; encryptionKey?: string }

export async function executeIntacctLive(
  action: CatalystWriteAction, ctx: AdapterContext, c: IntacctCredentials, opts: IntacctLiveExecuteOptions,
): Promise<ActionExecutionResult> {
  const callable = LIVE_CALLS[action.type];
  if (!callable) {
    return { ok: false, status: 'failed', summary: `Sage Intacct does not natively support ${action.type}`, error: 'unsupported_action' };
  }
  if (!c.sender_id || !c.sender_password || !c.company_id || !c.user_id || !c.user_password) {
    return { ok: false, status: 'failed',
      summary: 'Sage Intacct live mode is enabled but credentials are missing — need sender_id, sender_password, company_id, user_id, user_password',
      error: 'no_credentials' };
  }

  const sess = await ensureSession(ctx, opts.tenantId, opts.connectionId, c, opts.encryptionKey);
  if (!sess) {
    return { ok: false, status: 'failed', summary: 'Sage Intacct session establish failed — check credentials', error: 'auth_failed' };
  }

  const call = callable(action);
  let lastErr: string | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const body = envelope(c, call.controlId, call.functionXml, true);
    const r = await postIntacct(sess.endpoint, body);
    if (!r.ok) {
      lastErr = `Intacct gateway returned HTTP ${r.status}`;
      continue;
    }
    const parsed = parseIntacctResponse(r.xml);
    if (parsed.status === 'success') {
      return {
        ok: true, status: 'completed',
        summary: `Sage Intacct ${call.controlId} succeeded`,
        details: { request: { controlId: call.controlId }, response_xml: r.xml.slice(0, 4000) },
        mode: 'live',
      };
    }
    // Session expired? Re-auth + retry.
    if ((parsed.errorMessage || '').toLowerCase().includes('session') && attempt === 0) {
      c.session_id = undefined; c.session_endpoint = undefined;
      const newSess = await ensureSession(ctx, opts.tenantId, opts.connectionId, c, opts.encryptionKey);
      if (newSess) { sess.sessionId = newSess.sessionId; sess.endpoint = newSess.endpoint; continue; }
    }
    return {
      ok: false, status: 'failed',
      summary: parsed.errorMessage || 'Sage Intacct returned failure',
      error: 'intacct_business_error',
      details: { request: { controlId: call.controlId }, response_xml: r.xml.slice(0, 4000) },
    };
  }
  return { ok: false, status: 'failed', summary: lastErr || 'Sage Intacct retry budget exhausted', error: 'transient' };
}
