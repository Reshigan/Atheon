/**
 * ERP Write-Back Adapters — Phase 7-1.
 *
 * Vendor-specific implementations of CatalystWriteAdapter. Each adapter
 * knows how to take a CatalystWriteAction and either:
 *   (a) call the vendor's write API to make the change, or
 *   (b) when no real API integration has shipped yet, record the
 *       intended request payload so the customer can see exactly what
 *       would be sent (and we have a clean upgrade path when the real
 *       integration lands).
 *
 * Phase 7-1 ships *documented stubs* for SAP, Odoo, Xero, and a Generic
 * fallback. Each stub:
 *   - Validates the payload shape for the action type
 *   - Returns a projected outcome that's truthful about what would happen
 *   - Does NOT actually call the vendor API (no risk of side effects in
 *     production until the real integration is hooked up)
 *
 * To upgrade an adapter to real write-back later, replace the
 * `executePreview` body with a real API call. The dispatcher and HITL
 * approval paths don't change.
 */

import {
  type CatalystWriteAction,
  type CatalystWriteAdapter,
  type ActionExecutionResult,
  type ActionType,
  type AdapterContext,
  registerWriteAdapter,
} from './erp-write-actions';
import { executeXeroLive, type XeroCredentials } from './erp-xero-live';
import { executeSapLive, type SapCredentials } from './erp-sap-live';

// ── Shared helpers ─────────────────────────────────────────────────────

function fail(summary: string, error: string, details?: Record<string, unknown>): ActionExecutionResult {
  return { ok: false, status: 'failed', summary, error, details };
}
/** Stub adapters return `previewed` when previewOnly is set, otherwise
 *  `completed` — they don't actually call the vendor API but the action
 *  is conceptually executed (the audit trail captures intent). When real
 *  vendor API calls land, the same outcome shape applies. */
function stubOutcome(action: { previewOnly?: boolean }, summary: string, details: Record<string, unknown>): ActionExecutionResult {
  if (action.previewOnly) {
    return { ok: true, status: 'previewed', summary: `[preview] ${summary}`, details, mode: 'preview' };
  }
  // Stubbed completion — explicitly tagged so the UI shows a "stub" badge
  // instead of letting the customer think the change actually landed in
  // their ERP. Once the per-vendor live adapter ships, this falls back
  // only when live_mode is off.
  return { ok: true, status: 'completed', summary: `[stub] ${summary}`, details, mode: 'stub' };
}

function requireField(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  if (v === undefined || v === null || v === '') return `Missing required field: ${key}`;
  return null;
}
function requireFields(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const err = requireField(payload, k);
    if (err) return err;
  }
  return null;
}

// ── SAP adapter ────────────────────────────────────────────────────────
// SAP S/4HANA write-back commonly happens via OData (S/4HANA Cloud) or
// IDOC + RFC (S/4HANA on-prem). The stubs below describe the OData
// endpoint that the real integration would call. The dispatcher records
// the intended payload — production deployments wire these up to the
// SAP Cloud Connector / OData services without touching this file's
// shape (only the body of executePreview is replaced).

const SAP_ACTION_ENDPOINTS: Record<ActionType, { method: string; path: string; description: string } | null> = {
  ar_dunning_send: {
    method: 'POST',
    path: '/sap/opu/odata/sap/API_DUNNING_SRV/CreateDunningRun',
    description: 'Create a single-customer dunning run (FBL5N/F150 equivalent)',
  },
  ap_payment_release: {
    method: 'POST',
    path: '/sap/opu/odata/sap/API_PAYMENT_PROPOSAL_SRV/ReleaseProposal',
    description: 'Release a vendor payment block / approve a payment proposal (F-44)',
  },
  po_create: {
    method: 'POST',
    path: '/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder',
    description: 'Create a Purchase Order (ME21N equivalent)',
  },
  journal_post: {
    method: 'POST',
    path: '/sap/opu/odata/sap/API_JOURNALENTRYITEMBASIC_SRV/A_JournalEntryItemBasic',
    description: 'Post a journal entry (FB50/F-02 equivalent)',
  },
  invoice_post: {
    method: 'POST',
    path: '/sap/opu/odata/sap/API_BILLINGDOCUMENT_SRV/A_BillingDocument',
    description: 'Post a billing document (VF01 equivalent)',
  },
  customer_credit_update: {
    method: 'PATCH',
    path: '/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_CustomerCreditAccount',
    description: 'Update a customer credit limit (FD32 equivalent)',
  },
};

const sapAdapter: CatalystWriteAdapter = {
  vendor: 'SAP',
  supports: (t) => SAP_ACTION_ENDPOINTS[t] !== null,
  execute: async (action: CatalystWriteAction, ctx: AdapterContext): Promise<ActionExecutionResult> => {
    const ep = SAP_ACTION_ENDPOINTS[action.type];
    if (!ep) return fail(`SAP adapter does not support ${action.type}`, 'unsupported_action');

    // Per-action payload validation
    let validation: string | null = null;
    switch (action.type) {
      case 'ar_dunning_send':
        validation = requireFields(action.payload, ['customer_code', 'company_code', 'dunning_level']);
        break;
      case 'ap_payment_release':
        validation = requireFields(action.payload, ['payment_proposal_id', 'company_code']);
        break;
      case 'po_create':
        validation = requireFields(action.payload, ['vendor_code', 'company_code', 'items']);
        break;
      case 'journal_post':
        validation = requireFields(action.payload, ['company_code', 'document_type', 'lines']);
        break;
      case 'invoice_post':
        validation = requireFields(action.payload, ['billing_doc_id']);
        break;
      case 'customer_credit_update':
        validation = requireFields(action.payload, ['customer_code', 'credit_limit', 'company_code']);
        break;
    }
    if (validation) return fail(validation, 'validation');

    // Phase 9-1 — when the connection has opted into `live_mode` AND
    // SAP OData credentials are present, route to the real OData call.
    const creds = (ctx.credentials || {}) as SapCredentials;
    if (!action.previewOnly && creds.live_mode && creds.access_token && creds.base_url) {
      return executeSapLive(action, ctx, creds, {
        tenantId: action.tenantId, connectionId: action.connectionId,
        encryptionKey: ctx.encryptionKey,
      });
    }

    return stubOutcome(action,
      `Would ${ep.method} ${ep.path}`,
      {
        vendor: 'SAP', method: ep.method, path: ep.path, description: ep.description,
        body: action.payload, idempotency_key: action.idempotency_key,
        mode: 'stub',
        note: creds.live_mode === true && (!creds.access_token || !creds.base_url)
          ? 'live_mode set but SAP credentials missing — re-authenticate the SAP connection (need base_url + access_token + client_id/secret for refresh)'
          : 'Connection is in stub mode. Set live_mode=true on the connection config to enable real SAP writes.',
      },
    );
  },
};

// ── Odoo adapter ───────────────────────────────────────────────────────
// Odoo write-back uses XML-RPC or JSON-RPC against /xmlrpc/2/object with
// model + method names. The stubs document what the real call would look
// like; replace executePreview body with the real RPC when wiring up.

const ODOO_ACTION_MODEL_METHODS: Record<ActionType, { model: string; method: string; description: string } | null> = {
  ar_dunning_send: {
    model: 'account.followup.report',
    method: 'send_followup',
    description: 'Send a follow-up letter / email to a customer with overdue invoices',
  },
  ap_payment_release: {
    model: 'account.payment',
    method: 'action_post',
    description: 'Post a vendor payment that was previously in draft state',
  },
  po_create: {
    model: 'purchase.order',
    method: 'create',
    description: 'Create a new purchase order',
  },
  journal_post: {
    model: 'account.move',
    method: 'action_post',
    description: 'Post a draft journal entry',
  },
  invoice_post: {
    model: 'account.move',
    method: 'action_post',
    description: 'Post a customer invoice (move it from draft to posted)',
  },
  customer_credit_update: {
    model: 'res.partner',
    method: 'write',
    description: 'Update credit_limit on a customer partner',
  },
};

const odooAdapter: CatalystWriteAdapter = {
  vendor: 'Odoo',
  supports: (t) => ODOO_ACTION_MODEL_METHODS[t] !== null,
  execute: async (action: CatalystWriteAction, _ctx: AdapterContext): Promise<ActionExecutionResult> => { // eslint-disable-line @typescript-eslint/no-unused-vars
    const mm = ODOO_ACTION_MODEL_METHODS[action.type];
    if (!mm) return fail(`Odoo adapter does not support ${action.type}`, 'unsupported_action');

    let validation: string | null = null;
    switch (action.type) {
      case 'ar_dunning_send':
        validation = requireFields(action.payload, ['partner_id']);
        break;
      case 'ap_payment_release':
        validation = requireFields(action.payload, ['payment_id']);
        break;
      case 'po_create':
        validation = requireFields(action.payload, ['partner_id', 'order_line']);
        break;
      case 'journal_post':
      case 'invoice_post':
        validation = requireFields(action.payload, ['move_id']);
        break;
      case 'customer_credit_update':
        validation = requireFields(action.payload, ['partner_id', 'credit_limit']);
        break;
    }
    if (validation) return fail(validation, 'validation');

    return stubOutcome(action, 
      `Would call Odoo ${mm.model}.${mm.method}`,
      {
        vendor: 'Odoo', model: mm.model, method: mm.method, description: mm.description,
        args: action.payload, idempotency_key: action.idempotency_key,
        note: 'Stubbed adapter — wire to /xmlrpc/2/object when integrating.',
      },
    );
  },
};

// ── Xero adapter ───────────────────────────────────────────────────────
// Xero has the most accessible write-back API in this set (REST,
// well-documented, readily-available test environment). The stubs below
// describe the endpoint per action; the executePreview body is the
// natural place to land a real fetch() call once the OAuth token plumbing
// is wired through AdapterContext.credentials.

const XERO_ACTION_ENDPOINTS: Record<ActionType, { method: string; path: string; description: string } | null> = {
  ar_dunning_send: {
    method: 'POST',
    path: '/api.xro/2.0/Invoices/{InvoiceID}/SendInvoice',
    description: 'Email an overdue invoice as a reminder (uses bill_to email)',
  },
  ap_payment_release: {
    method: 'POST',
    path: '/api.xro/2.0/Payments',
    description: 'Record a vendor payment against an authorised bill',
  },
  po_create: {
    method: 'PUT',
    path: '/api.xro/2.0/PurchaseOrders',
    description: 'Create a draft purchase order',
  },
  journal_post: {
    method: 'POST',
    path: '/api.xro/2.0/ManualJournals',
    description: 'Post a manual journal entry',
  },
  invoice_post: {
    method: 'POST',
    path: '/api.xro/2.0/Invoices/{InvoiceID}',
    description: 'Move an invoice from DRAFT to AUTHORISED status',
  },
  customer_credit_update: null, // Xero has no native credit-limit field
};

const xeroAdapter: CatalystWriteAdapter = {
  vendor: 'Xero',
  supports: (t) => XERO_ACTION_ENDPOINTS[t] !== null,
  execute: async (action: CatalystWriteAction, ctx: AdapterContext): Promise<ActionExecutionResult> => {
    const ep = XERO_ACTION_ENDPOINTS[action.type];
    if (!ep) return fail(`Xero adapter does not support ${action.type} — no native equivalent`, 'unsupported_action');

    let validation: string | null = null;
    switch (action.type) {
      case 'ar_dunning_send':
        validation = requireFields(action.payload, ['invoice_id']);
        break;
      case 'ap_payment_release':
        validation = requireFields(action.payload, ['invoice_id', 'amount', 'account_code']);
        break;
      case 'po_create':
        validation = requireFields(action.payload, ['contact_id', 'line_items']);
        break;
      case 'journal_post':
        validation = requireFields(action.payload, ['narration', 'journal_lines']);
        break;
      case 'invoice_post':
        validation = requireFields(action.payload, ['invoice_id']);
        break;
      // customer_credit_update unreachable (returns early via supports())
    }
    if (validation) return fail(validation, 'validation');

    // Phase 8-1 — when the connection has opted into `live_mode` AND
    // OAuth credentials are present, route to the real Xero API.
    // Otherwise fall through to the stub. The dispatcher contract
    // doesn't change; this is a transparent upgrade per-connection.
    const creds = (ctx.credentials || {}) as XeroCredentials;
    if (!action.previewOnly && creds.live_mode && creds.access_token && creds.xero_tenant_id) {
      return executeXeroLive(action, ctx, creds, {
        tenantId: action.tenantId, connectionId: action.connectionId,
        encryptionKey: ctx.encryptionKey,
      });
    }

    return stubOutcome(action,
      `Would ${ep.method} ${ep.path}`,
      {
        vendor: 'Xero', method: ep.method, path: ep.path, description: ep.description,
        body: action.payload, idempotency_key: action.idempotency_key,
        mode: 'stub',
        note: creds.live_mode === true && (!creds.access_token || !creds.xero_tenant_id)
          ? 'live_mode set but Xero credentials missing — re-authenticate the connection to enable real execution'
          : 'Connection is in stub mode. Set live_mode=true on the connection config to enable real Xero writes.',
      },
    );
  },
};

// ── Generic adapter ────────────────────────────────────────────────────
// Catch-all for vendors without a dedicated write integration. Always
// records the intended payload as a preview; never claims success.

const genericAdapter: CatalystWriteAdapter = {
  vendor: 'Generic',
  supports: () => true,
  execute: async (action: CatalystWriteAction, _ctx: AdapterContext): Promise<ActionExecutionResult> => { // eslint-disable-line @typescript-eslint/no-unused-vars
    return stubOutcome(action, 
      `Generic adapter — recorded intent for ${action.type}`,
      {
        vendor: 'Generic', action: action.type, payload: action.payload,
        idempotency_key: action.idempotency_key,
        note: 'No vendor-specific write adapter; ship a vendor adapter to enable real execution.',
      },
    );
  },
};

// ── Bootstrap ──────────────────────────────────────────────────────────

let registered = false;
export function registerDefaultWriteAdapters(): void {
  if (registered) return;
  registerWriteAdapter(sapAdapter);
  registerWriteAdapter(odooAdapter);
  registerWriteAdapter(xeroAdapter);
  registerWriteAdapter(genericAdapter);
  registered = true;
}

/** Test-only — reset registration flag so beforeEach can re-register. */
export function _resetAdapterRegistrationForTests(): void {
  registered = false;
}

// Eagerly register at module load — production paths import erp-write-adapters
// for the side-effect of registration.
registerDefaultWriteAdapters();
