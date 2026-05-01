/**
 * ERP Vendor Baselines — Phase 6 of dynamic ERP intelligence.
 *
 * Static reference dictionaries describing the *vendor's* recommended
 * defaults per ERP system: standard fields per entity, recommended
 * process-profile values (tolerance, payment terms, matching mode),
 * and the canonical end-to-end process flows (P2P, O2C, R2R, …).
 *
 * Why this matters under shared-savings:
 *   Without a vendor baseline, a customer's process profile looks like
 *   "the customer's rules". With it, we can flag:
 *     "Your AP tolerance is 5%. Vendor SAP recommendation: ≤2%. Tightening
 *      could recover R X/yr in invoice variances."
 *   That moves an insight from descriptive ("here's your data") to
 *   prescriptive ("here's what to do") — which is the difference between
 *   a report customers tolerate and a report they pay for.
 *
 * Phase 6 scope: SAP S/4HANA, Odoo, Xero — the three highest-deployed
 * ERPs in the customer base. Other vendors (NetSuite, Sage, Dynamics,
 * QuickBooks, Workday, Salesforce) get added in follow-ups as they
 * gather customer demand.
 *
 * Sources for the baselines:
 *   - SAP: SAP Best Practices documentation, SAP S/4HANA Cloud
 *     Configuration Guides, the Vendor Master / Customer Master
 *     standard field definitions, MM/FI customizing tables T001 / T030.
 *   - Odoo: Odoo 17 Community + Enterprise documentation, default
 *     account chart, payment terms templates, MRP module defaults.
 *   - Xero: Xero developer reference (Accounting API objects), default
 *     invoice + bill workflows, tax rate templates.
 *
 * The baselines here are intentionally small and focused on what
 * catalysts actually consult. Each is annotated with `recommended` (a
 * single value) and an optional `acceptable_range` for fields where a
 * narrow band is still healthy. Catalysts compare the customer's
 * profile to `recommended` and emit a deviation insight when the
 * customer is outside `acceptable_range`.
 */

import type { ProcessProfile, ThreeWayMatch } from './erp-process-profile';

export type SupportedVendor = 'SAP' | 'Odoo' | 'Xero';

export interface VendorRecommendation<T> {
  recommended: T;
  acceptable_range?: { min?: T; max?: T };
  rationale: string;
  source: string;
}

export interface VendorEntityFieldsBaseline {
  /** Fields the vendor publishes as part of the standard schema for this entity. */
  standard_fields: string[];
  /** Optional fields the vendor supports but does not require. */
  optional_fields: string[];
}

export interface VendorProcessStep {
  step: string;
  required: boolean;
  description: string;
}

export interface VendorProcessFlow {
  name: string;
  description: string;
  steps: VendorProcessStep[];
}

export interface VendorBaseline {
  vendor: SupportedVendor;
  product: string;
  /** Recommended values the catalysts compare against. */
  profile_recommendations: {
    matching_mode: VendorRecommendation<ThreeWayMatch>;
    tolerance_pct: VendorRecommendation<number>;
    payment_terms_days: VendorRecommendation<number>;
    fiscal_year_start_month: VendorRecommendation<number>;
    default_currency?: VendorRecommendation<string>;
    dunning_days: VendorRecommendation<number[]>;
  };
  /** Per-entity standard schema; used to compare customer's discovered fields. */
  entities: Record<string, VendorEntityFieldsBaseline>;
  /** End-to-end flows; deviations (skipped steps) are surfaced as insights. */
  flows: VendorProcessFlow[];
}

// ── SAP S/4HANA ─────────────────────────────────────────────────────────

const SAP_BASELINE: VendorBaseline = {
  vendor: 'SAP',
  product: 'SAP S/4HANA',
  profile_recommendations: {
    matching_mode: {
      recommended: '3way',
      rationale: 'SAP MM-IV best practice — 3-way invoice verification (PO + GR + IR) prevents over-payment and shrinkage.',
      source: 'SAP Best Practices J45 — Procure-to-Pay',
    },
    tolerance_pct: {
      recommended: 2,
      acceptable_range: { min: 0, max: 5 },
      rationale: 'OBYC tolerance keys default to 2% / R250 — wider tolerance accepts noise that should be exception-handled.',
      source: 'SAP Help — OMR6 (Tolerance limits for invoice verification)',
    },
    payment_terms_days: {
      recommended: 30,
      acceptable_range: { min: 14, max: 60 },
      rationale: 'Payment-term key 0001 (Net 30) is the SAP delivered default for vendor payments.',
      source: 'SAP Help — OBB8 (Terms of payment)',
    },
    fiscal_year_start_month: {
      recommended: 1,
      acceptable_range: { min: 1, max: 12 },
      rationale: 'SAP delivered fiscal year variant K4 is calendar-year (Jan-Dec); regional variants apply (V3 = Apr, V6 = Oct, etc.).',
      source: 'SAP Help — OB29 (Fiscal year variants)',
    },
    dunning_days: {
      recommended: [10, 30, 60, 90],
      rationale: 'Standard SAP dunning procedure 0001 fires 4 levels at 10/30/60/90 days past due.',
      source: 'SAP Help — FBMP (Dunning procedures)',
    },
  },
  entities: {
    invoices: {
      standard_fields: [
        'BELNR', 'BUKRS', 'GJAHR', 'XBLNR', 'BLDAT', 'BUDAT',
        'WAERS', 'WRBTR', 'DMBTR', 'NETWR', 'MWSKZ', 'KOSTL',
        'LIFNR', 'KUNNR', 'ZTERM', 'ZFBDT', 'ZBD1T',
      ],
      optional_fields: ['BLART', 'STBLG', 'STJAH', 'AUGBL', 'AUGDT'],
    },
    purchase_orders: {
      standard_fields: [
        'EBELN', 'BUKRS', 'EKORG', 'EKGRP', 'BSART', 'AEDAT',
        'LIFNR', 'WAERS', 'BEDAT', 'NETWR', 'KNUMV',
      ],
      optional_fields: ['BSAKZ', 'PROCSTAT', 'FRGKE', 'FRGZU'],
    },
    suppliers: {
      standard_fields: [
        'LIFNR', 'NAME1', 'LAND1', 'ORT01', 'STRAS', 'PSTLZ',
        'STCD1', 'STCEG', 'WAERS', 'ZTERM', 'AKONT', 'BUKRS',
      ],
      optional_fields: ['NAME2', 'TELF1', 'SMTP_ADDR', 'BANKL', 'BANKN'],
    },
    customers: {
      standard_fields: [
        'KUNNR', 'NAME1', 'LAND1', 'ORT01', 'STRAS', 'PSTLZ',
        'STCD1', 'STCEG', 'WAERS', 'ZTERM', 'KLIMK', 'AKONT',
      ],
      optional_fields: ['NAME2', 'TELF1', 'SMTP_ADDR', 'KDGRP', 'BZIRK'],
    },
  },
  flows: [
    {
      name: 'Procure-to-Pay (P2P)',
      description: 'Standard SAP P2P flow per Best Practices J45.',
      steps: [
        { step: 'Purchase Requisition', required: false, description: 'ME51N — internal request capturing demand before commercial commitment.' },
        { step: 'Purchase Order', required: true, description: 'ME21N — formal commitment to vendor, releases reservation.' },
        { step: 'Goods Receipt', required: true, description: 'MIGO 101 — confirms physical receipt; required for 3-way match.' },
        { step: 'Invoice Receipt', required: true, description: 'MIRO — vendor invoice posting referencing PO + GR.' },
        { step: '3-Way Match', required: true, description: 'Automatic match of PO + GR + IR within OMR6 tolerance.' },
        { step: 'Payment', required: true, description: 'F110 — payment proposal + run honouring vendor terms.' },
      ],
    },
    {
      name: 'Order-to-Cash (O2C)',
      description: 'Standard SAP O2C flow per Best Practices J55.',
      steps: [
        { step: 'Sales Order', required: true, description: 'VA01 — captures customer demand + commits price/availability.' },
        { step: 'Delivery', required: true, description: 'VL01N — outbound delivery + post-goods-issue.' },
        { step: 'Billing', required: true, description: 'VF01 — invoice creation with tax + revenue recognition.' },
        { step: 'Receipt', required: true, description: 'F-28 — incoming customer payment matched to open invoices.' },
        { step: 'Dunning', required: false, description: 'F150 — automated chasing for overdue receivables per dunning procedure.' },
      ],
    },
  ],
};

// ── Odoo 17 ─────────────────────────────────────────────────────────────

const ODOO_BASELINE: VendorBaseline = {
  vendor: 'Odoo',
  product: 'Odoo 17 (Community + Enterprise)',
  profile_recommendations: {
    matching_mode: {
      recommended: '3way',
      rationale: 'Odoo Purchase + Inventory + Invoicing 3-way match is standard when Inventory module is enabled.',
      source: 'Odoo 17 Documentation — Purchase: 3-way matching',
    },
    tolerance_pct: {
      recommended: 5,
      acceptable_range: { min: 0, max: 10 },
      rationale: 'Odoo defaults to a 5 % invoice-PO tolerance; tightening below this requires manual review of every variance.',
      source: 'Odoo 17 Documentation — Accounting: Vendor bill control',
    },
    payment_terms_days: {
      recommended: 30,
      acceptable_range: { min: 14, max: 60 },
      rationale: '"30 Days end of month" is the most-used Odoo payment term template; "Immediate Payment" is the technical default.',
      source: 'Odoo 17 Accounting — Payment Terms',
    },
    fiscal_year_start_month: {
      recommended: 1,
      acceptable_range: { min: 1, max: 12 },
      rationale: 'Odoo company defaults Fiscal Year Start to Jan 1; per-company override available.',
      source: 'Odoo 17 General Settings — Fiscal Years',
    },
    dunning_days: {
      recommended: [15, 30, 45, 60],
      rationale: 'Odoo Follow-up Levels default to 4 levels at 15/30/45/60 days past due.',
      source: 'Odoo 17 Accounting — Follow-up Reports',
    },
  },
  entities: {
    invoices: {
      standard_fields: [
        'name', 'partner_id', 'invoice_date', 'invoice_date_due',
        'currency_id', 'amount_untaxed', 'amount_tax', 'amount_total',
        'amount_residual', 'state', 'payment_state', 'invoice_payment_term_id',
        'ref', 'invoice_origin', 'company_id',
      ],
      optional_fields: ['narration', 'team_id', 'campaign_id', 'fiscal_position_id'],
    },
    purchase_orders: {
      standard_fields: [
        'name', 'partner_id', 'date_order', 'date_planned',
        'currency_id', 'amount_untaxed', 'amount_tax', 'amount_total',
        'state', 'payment_term_id', 'company_id',
      ],
      optional_fields: ['origin', 'incoterm_id', 'picking_type_id', 'group_id'],
    },
    suppliers: {
      standard_fields: [
        'name', 'is_company', 'country_id', 'street', 'city', 'zip',
        'vat', 'currency_id', 'property_payment_term_id',
        'property_account_payable_id',
      ],
      optional_fields: ['phone', 'email', 'category_id', 'website'],
    },
    customers: {
      standard_fields: [
        'name', 'is_company', 'country_id', 'street', 'city', 'zip',
        'vat', 'currency_id', 'property_payment_term_id', 'credit_limit',
        'property_account_receivable_id',
      ],
      optional_fields: ['phone', 'email', 'category_id', 'team_id'],
    },
  },
  flows: [
    {
      name: 'Procure-to-Pay (P2P)',
      description: 'Standard Odoo P2P with Purchase + Inventory + Accounting modules.',
      steps: [
        { step: 'Purchase Requisition', required: false, description: 'Optional — only when Approvals module is enabled for spend control.' },
        { step: 'Request for Quotation', required: false, description: 'Compare vendor pricing before committing to a PO.' },
        { step: 'Purchase Order', required: true, description: 'Confirmed RFQ becomes a PO that reserves inventory.' },
        { step: 'Receipt', required: true, description: 'Inventory receipt against the PO via Inventory module.' },
        { step: 'Vendor Bill', required: true, description: 'Invoice posted referencing the PO; lines auto-fill from PO.' },
        { step: '3-Way Match', required: true, description: 'Automatic match within bill-control tolerance; differences open exception.' },
        { step: 'Payment', required: true, description: 'Register payment from Vendor Bill; reconciles to bank statement.' },
      ],
    },
  ],
};

// ── Xero ────────────────────────────────────────────────────────────────

const XERO_BASELINE: VendorBaseline = {
  vendor: 'Xero',
  product: 'Xero (Accounting + Projects)',
  profile_recommendations: {
    matching_mode: {
      recommended: 'none',
      rationale: 'Xero is invoice-first — there is no native 3-way matching; SMB users approve bills against the bill itself.',
      source: 'Xero Central — Bills awaiting approval',
    },
    tolerance_pct: {
      recommended: 0,
      acceptable_range: { min: 0, max: 5 },
      rationale: 'Xero does not enforce a tolerance; manual approval is the control. Tightening means more manual reviews.',
      source: 'Xero Central — Bill approval workflow',
    },
    payment_terms_days: {
      recommended: 30,
      acceptable_range: { min: 7, max: 60 },
      rationale: 'Xero default Sales/Purchases settings ship with "30 days following the invoice date".',
      source: 'Xero Central — Invoice settings',
    },
    fiscal_year_start_month: {
      recommended: 7,
      acceptable_range: { min: 1, max: 12 },
      rationale: 'Xero defaults to the regional fiscal year (NZ/AU = July, UK = April, US/ZA = March or January).',
      source: 'Xero Central — Financial settings',
    },
    dunning_days: {
      recommended: [7, 14, 30],
      rationale: 'Xero invoice reminders default to 7, 14, 30 days past due.',
      source: 'Xero Central — Invoice reminders',
    },
  },
  entities: {
    invoices: {
      standard_fields: [
        'InvoiceID', 'InvoiceNumber', 'Type', 'Contact', 'Date', 'DueDate',
        'CurrencyCode', 'SubTotal', 'TotalTax', 'Total', 'AmountDue',
        'Status', 'LineAmountTypes', 'Reference',
      ],
      optional_fields: ['BrandingThemeID', 'Url', 'CISDeduction', 'ExpectedPaymentDate'],
    },
    purchase_orders: {
      standard_fields: [
        'PurchaseOrderID', 'PurchaseOrderNumber', 'Contact', 'Date',
        'DeliveryDate', 'Status', 'CurrencyCode', 'Total', 'Reference',
      ],
      optional_fields: ['BrandingThemeID', 'AttentionTo', 'DeliveryAddress'],
    },
    suppliers: {
      standard_fields: [
        'ContactID', 'Name', 'EmailAddress', 'Addresses', 'Phones',
        'TaxNumber', 'AccountNumber', 'IsSupplier', 'DefaultCurrency',
        'PaymentTerms',
      ],
      optional_fields: ['ContactGroups', 'Website', 'BatchPayments'],
    },
    customers: {
      standard_fields: [
        'ContactID', 'Name', 'EmailAddress', 'Addresses', 'Phones',
        'TaxNumber', 'AccountNumber', 'IsCustomer', 'DefaultCurrency',
        'PaymentTerms',
      ],
      optional_fields: ['ContactGroups', 'Website', 'SalesDefaultLineAmountType'],
    },
  },
  flows: [
    {
      name: 'Bills Workflow',
      description: 'Xero approval-based bills workflow.',
      steps: [
        { step: 'Bill Entry', required: true, description: 'Bill captured manually, via email-to-bill, or via OCR.' },
        { step: 'Approval', required: true, description: 'Manual approval per the bill-approval policy.' },
        { step: 'Payment', required: true, description: 'Mark as paid via batch payment, manual record, or bank-feed match.' },
      ],
    },
    {
      name: 'Sales (Order-to-Cash)',
      description: 'Xero invoice-driven O2C.',
      steps: [
        { step: 'Quote', required: false, description: 'Optional draft sent for customer acceptance.' },
        { step: 'Invoice', required: true, description: 'Invoice raised + sent to customer; status = AUTHORISED.' },
        { step: 'Payment Allocation', required: true, description: 'Bank-feed match or manual payment recorded against invoice.' },
        { step: 'Reminders', required: false, description: 'Automated reminders fire at configured days past due.' },
      ],
    },
  ],
};

// ── Public registry ─────────────────────────────────────────────────────

const REGISTRY: Record<SupportedVendor, VendorBaseline> = {
  SAP: SAP_BASELINE,
  Odoo: ODOO_BASELINE,
  Xero: XERO_BASELINE,
};

/** Look up a vendor baseline by source-system name (case-insensitive prefix match). */
export function getVendorBaseline(sourceSystem: string | null | undefined): VendorBaseline | null {
  if (!sourceSystem) return null;
  const norm = sourceSystem.toLowerCase();
  if (norm.startsWith('sap')) return REGISTRY.SAP;
  if (norm.startsWith('odoo')) return REGISTRY.Odoo;
  if (norm.startsWith('xero')) return REGISTRY.Xero;
  return null;
}

export function listSupportedVendors(): SupportedVendor[] {
  return Object.keys(REGISTRY) as SupportedVendor[];
}

// ── Comparison ──────────────────────────────────────────────────────────

export interface ProfileDeviation {
  field: keyof VendorBaseline['profile_recommendations'];
  customer_value: string | number | string[] | number[];
  recommended_value: string | number | string[] | number[];
  severity: 'info' | 'warning' | 'critical';
  rationale: string;
  source: string;
  /** Suggested action to bring the customer in line (or accept the deviation). */
  action: string;
}

export interface SchemaDeviation {
  entity_type: string;
  /** Vendor-standard fields the customer is NOT sending — likely missing data. */
  missing_fields: string[];
  /** Fields the customer sends that are NOT in the vendor schema — custom fields. */
  custom_fields: string[];
}

export interface BaselineComparison {
  vendor: SupportedVendor;
  product: string;
  profile_deviations: ProfileDeviation[];
  schema_deviations: SchemaDeviation[];
  alignment_score: number; // 0..1 — share of recommendations the customer matches
}

/** Compare one customer profile field to its vendor recommendation; returns a
 *  ProfileDeviation only if the customer is OUTSIDE the acceptable range. */
function compareScalar<T>(
  field: keyof VendorBaseline['profile_recommendations'],
  customer: T, rec: VendorRecommendation<T>,
): ProfileDeviation | null {
  const inRange = (() => {
    if (!rec.acceptable_range) return customer === rec.recommended;
    if (typeof customer !== 'number' || typeof rec.recommended !== 'number') {
      // String fields with acceptable_range are odd — treat exact match only.
      return customer === rec.recommended;
    }
    const min = (rec.acceptable_range.min as number | undefined) ?? -Infinity;
    const max = (rec.acceptable_range.max as number | undefined) ?? Infinity;
    return customer >= min && customer <= max;
  })();

  if (inRange) return null;

  const severity: 'warning' | 'critical' =
    typeof customer === 'number' && typeof rec.recommended === 'number'
      ? Math.abs((customer as number) - (rec.recommended as number)) > (rec.recommended as number) * 0.5
        ? 'critical' : 'warning'
      : 'warning';

  return {
    field, customer_value: customer as unknown as ProfileDeviation['customer_value'],
    recommended_value: rec.recommended as unknown as ProfileDeviation['recommended_value'],
    severity, rationale: rec.rationale, source: rec.source,
    action: `Customer's ${String(field)} = ${String(customer)} differs from ${rec.recommended}; review configuration or accept as intentional deviation.`,
  };
}

/** Compare a customer's process profile to the vendor baseline. */
export function compareProfileToBaseline(
  profile: ProcessProfile, baseline: VendorBaseline,
): ProfileDeviation[] {
  const out: ProfileDeviation[] = [];
  const recs = baseline.profile_recommendations;

  const matching = compareScalar('matching_mode', profile.matching_mode, recs.matching_mode);
  if (matching) out.push(matching);
  const tol = compareScalar('tolerance_pct', profile.tolerance_pct, recs.tolerance_pct);
  if (tol) out.push(tol);
  const pt = compareScalar('payment_terms_days', profile.payment_terms_days, recs.payment_terms_days);
  if (pt) out.push(pt);
  const fy = compareScalar('fiscal_year_start_month', profile.fiscal_year_start_month, recs.fiscal_year_start_month);
  if (fy) out.push(fy);
  if (recs.default_currency) {
    const cur = compareScalar('default_currency', profile.default_currency, recs.default_currency);
    if (cur) out.push(cur);
  }

  return out;
}

/** Compare discovered schema to vendor entity baselines. Returns one
 *  SchemaDeviation row per entity that has either missing or custom fields. */
export function compareSchemaToBaseline(
  discoveredByEntity: Record<string, string[]>,
  baseline: VendorBaseline,
): SchemaDeviation[] {
  const out: SchemaDeviation[] = [];
  for (const [entityType, baselineFields] of Object.entries(baseline.entities)) {
    const discovered = new Set(discoveredByEntity[entityType] || []);
    if (discovered.size === 0) continue;
    const allKnown = new Set([...baselineFields.standard_fields, ...baselineFields.optional_fields]);
    const missing = baselineFields.standard_fields.filter((f) => !discovered.has(f));
    const custom: string[] = [];
    for (const f of discovered) if (!allKnown.has(f)) custom.push(f);
    if (missing.length === 0 && custom.length === 0) continue;
    out.push({ entity_type: entityType, missing_fields: missing, custom_fields: custom });
  }
  return out;
}

/** Combined alignment score in [0, 1] — what fraction of the vendor's
 *  recommendations the customer is in line with. Used as a single
 *  headline number for the UI badge / executive summary. */
export function calculateAlignmentScore(
  profileDeviations: ProfileDeviation[], totalRecommendations: number,
): number {
  if (totalRecommendations === 0) return 1;
  return Math.max(0, 1 - profileDeviations.length / totalRecommendations);
}
