/**
 * SAP ECC Demo Seeder — Phase 10-26.
 *
 * Creates a fully-populated demo tenant that mirrors a realistic SAP ECC
 * customer (single-company manufacturer with finance + procurement +
 * warehouse + HR catalysts), then runs the full Phase 10 chain so we
 * can validate the platform end-to-end on every deploy.
 *
 * Seeded artefacts:
 *   - tenant + entitlements + admin user
 *   - erp_connections row tagged vendor='sap_ecc' with stub credentials
 *   - 1 erp_company (single-org tenant)
 *   - 5 process_metrics covering procurement / finance / warehouse / hr
 *     (matching the canonical Margin↓ ← cost↑ ← Brent +22% AND picking↓
 *     ← HR hiring lag causal-chain example)
 *   - 30 daily process_metric_history rows per KPI with carefully-shaped
 *     trends (one falling, three rising, one flat)
 *   - 30 daily external_signals raw_data.history points for Brent crude
 *     with the same +22% trend so Phase 10-3 attribution finds it
 *   - sub_catalyst_kpi_definitions declaring direction (so Phase 10-6
 *     classification works)
 *   - tenant_settings with monthly_revenue_base + currency
 *   - 1 verified catalyst_action so Phase 10-19 billing has eligible
 *     evidence on a future closure
 *
 * After seeding, callers can invoke `runPhase10ChainForTenant(db, tid)`
 * — the chain's outputs are deterministic enough that we assert in
 * tests that a Brent → Procurement Input Cost attribution gets created.
 */

import { logInfo } from './logger';
import { hashPassword } from '../middleware/auth';

export interface SeedResult {
  tenantId: string;
  adminUserId: string;
  metrics: Array<{ id: string; name: string; status: string }>;
  signalIds: string[];
  notes: string[];
}

export interface SeedOptions {
  /** Override tenant ID (defaults to 'demo-sap-ecc'). */
  tenantId?: string;
  /** Override admin user email (defaults to 'demo-admin@example.invalid'). */
  adminEmail?: string;
  /** Re-seed even if the tenant already exists; default true so the
   *  script is idempotent for repeatable deploy validation. */
  reseed?: boolean;
}

const DEFAULT_TENANT_ID = 'demo-sap-ecc';
const DEFAULT_ADMIN_EMAIL = 'demo-admin@example.invalid';

interface MetricSpec {
  id: string;
  name: string;
  unit: string;
  domain: string;
  /** Direction the KPI is preferred to move ('higher_better' or 'lower_better'). */
  direction: 'higher_better' | 'lower_better';
  /** Latest (current-day) value. */
  latest: number;
  /** Threshold tuple. */
  thresholds: { red: number; amber: number; green: number };
  status: 'red' | 'amber' | 'green';
  /** History generator — returns 30 points oldest-first. */
  history: (latest: number) => number[];
}

const DAYS = 30;

/** Generate a falling series ending at `latest`, declining by ~30% over
 *  the window with mild noise. */
function fallingSeries(latest: number): number[] {
  const start = latest / 0.7; // 30% drop
  const out: number[] = [];
  for (let i = 0; i < DAYS; i++) {
    const t = i / (DAYS - 1);
    const noise = Math.sin(i * 0.7) * (start * 0.01);
    out.push(Number((start + (latest - start) * t + noise).toFixed(2)));
  }
  return out;
}

/** Rising series ending at `latest`, +30% over window. */
function risingSeries(latest: number): number[] {
  const start = latest / 1.3;
  const out: number[] = [];
  for (let i = 0; i < DAYS; i++) {
    const t = i / (DAYS - 1);
    const noise = Math.sin(i * 0.5) * (start * 0.01);
    out.push(Number((start + (latest - start) * t + noise).toFixed(2)));
  }
  return out;
}

/** Flat series with mild noise. */
function flatSeries(latest: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < DAYS; i++) {
    const noise = Math.sin(i * 0.4) * (latest * 0.005);
    out.push(Number((latest + noise).toFixed(2)));
  }
  return out;
}

const METRIC_SPECS: MetricSpec[] = [
  {
    id: 'm-margin-demo', name: 'Gross Margin %', unit: 'pct', domain: 'finance',
    direction: 'higher_better',
    latest: 12.0,
    thresholds: { red: 15, amber: 20, green: 25 },
    status: 'red',
    history: fallingSeries,
  },
  {
    id: 'm-procurement-cost-demo', name: 'Procurement Input Cost', unit: 'ZAR', domain: 'procurement',
    direction: 'lower_better',
    latest: 6_400_000,
    thresholds: { red: 5_500_000, amber: 5_000_000, green: 4_500_000 },
    status: 'red',
    history: risingSeries,
  },
  {
    id: 'm-ap-days-demo', name: 'Days Payable Outstanding', unit: 'days', domain: 'finance',
    direction: 'lower_better',
    latest: 38,
    thresholds: { red: 35, amber: 30, green: 25 },
    status: 'red',
    history: risingSeries,
  },
  {
    id: 'm-pick-eff-demo', name: 'Warehouse Picking Efficiency', unit: 'pct', domain: 'logistics-warehouse',
    direction: 'higher_better',
    latest: 78,
    thresholds: { red: 80, amber: 88, green: 95 },
    status: 'red',
    history: fallingSeries,
  },
  {
    id: 'm-hires-demo', name: 'Open Pickers Reqs', unit: 'count', domain: 'hr',
    direction: 'lower_better',
    latest: 12,
    thresholds: { red: 6, amber: 3, green: 1 },
    status: 'red',
    history: risingSeries,
  },
  {
    id: 'm-rev-demo', name: 'Monthly Revenue', unit: 'ZAR', domain: 'finance',
    direction: 'higher_better',
    latest: 22_000_000,
    thresholds: { red: 20_000_000, amber: 25_000_000, green: 30_000_000 },
    status: 'amber',
    history: flatSeries,
  },
];

// ── DB helpers ─────────────────────────────────────────────────────────

async function deleteExisting(db: D1Database, tenantId: string): Promise<void> {
  // Order matters — children first
  const tables = [
    // Children first; FKs walk top→bottom. Tables added in v74-action
    // layer (transactional_actions, ap_invoice_inbox, etc.) plus the
    // sub_catalyst_runs / kpi / insights writes that the new
    // transactional-runner produces via recordRun all need cleanup
    // here so re-seed is idempotent.
    'sub_catalyst_kpi_values',
    'sub_catalyst_kpi_definitions',
    'sub_catalyst_run_items',
    'sub_catalyst_runs',
    'sub_catalyst_kpis',
    'catalyst_insights',
    'health_score_history',
    'health_scores',
    'risk_alerts',
    'anomalies',
    'process_metric_history',
    'process_metrics',
    'signal_impacts',
    'external_signals',
    'correlation_events',
    'causal_factors',
    'root_cause_analyses',
    'executive_briefings',
    'kpi_forecasts',
    'inference_calibration',
    'industry_patterns',
    'billable_line_items',
    'billable_periods',
    'catalyst_actions',
    'transactional_actions',
    'customer_credit_holds',
    'bank_statement_lines',
    'customer_payments',
    'ar_open_invoices',
    'ap_invoice_inbox',
    'goods_receipts',
    'purchase_orders',
    'erp_connections',
    'erp_companies',
    'tenant_settings',
    'catalyst_clusters',
  ];
  for (const t of tables) {
    try {
      // industry_patterns is global (no tenant_id), filter by tenant only where applicable
      if (t === 'industry_patterns') continue;
      await db.prepare(`DELETE FROM ${t} WHERE tenant_id = ?`).bind(tenantId).run();
    } catch {
      // Some tables may not exist in older deploys — skip
    }
  }
  await db.prepare(`DELETE FROM users WHERE tenant_id = ?`).bind(tenantId).run();
  await db.prepare(`DELETE FROM tenant_entitlements WHERE tenant_id = ?`).bind(tenantId).run();
  await db.prepare(`DELETE FROM tenants WHERE id = ?`).bind(tenantId).run();
}

async function seedTenantAndAdmin(
  db: D1Database, tenantId: string, adminEmail: string,
): Promise<string> {
  await db.prepare(
    `INSERT INTO tenants (id, name, slug, plan, status, region)
     VALUES (?, 'SAP ECC Demo Co', ?, 'enterprise', 'active', 'af-south-1')`
  ).bind(tenantId, tenantId).run();

  await db.prepare(
    `INSERT INTO tenant_entitlements (tenant_id, layers, catalyst_clusters,
       max_agents, max_users, autonomy_tiers, llm_tiers, features, sso_enabled,
       api_access, custom_branding, data_retention_days)
     VALUES (?, '["apex","pulse","catalyst","mind","memory"]',
             '["finance","procurement","warehouse","hr"]',
             20, 50, '["read-only","supervised","autonomous"]',
             '["tier-1","tier-2","tier-3"]', '[]', 0, 1, 0, 365)`
  ).bind(tenantId).run();

  const adminId = crypto.randomUUID();
  const passwordHash = await hashPassword('demo-not-a-real-password-Nv8z');
  await db.prepare(
    `INSERT INTO users (id, tenant_id, email, name, role, password_hash, status)
     VALUES (?, ?, ?, 'Demo Admin', 'admin', ?, 'active')`
  ).bind(adminId, tenantId, adminEmail, passwordHash).run();

  // tenant_settings: monthly_revenue_base for billing + currency
  await db.prepare(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES (?, ?, 'monthly_revenue_base', ?)`
  ).bind(crypto.randomUUID(), tenantId, JSON.stringify(22_000_000)).run();
  await db.prepare(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES (?, ?, 'currency', ?)`
  ).bind(crypto.randomUUID(), tenantId, JSON.stringify('ZAR')).run();
  await db.prepare(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES (?, ?, 'billing_share_pct', ?)`
  ).bind(crypto.randomUUID(), tenantId, JSON.stringify(0.2)).run();

  return adminId;
}

async function seedErpConnection(db: D1Database, tenantId: string): Promise<void> {
  // Try to insert an erp_connection. The schema's adapter_id FK
  // expects a row in erp_adapters; we tolerate missing FK target by
  // running a fallback write to erp_companies + skipping the connection
  // when the FK is not satisfied.
  try {
    await db.prepare(
      `INSERT INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
       VALUES ('sap-ecc-stub', 'SAP ECC Stub', 'sap_ecc', '6.0', 'REST', 'available', '[]', '["basic"]')`
    ).run();
  } catch {
    // Already present
  }
  try {
    await db.prepare(
      `INSERT INTO erp_connections
         (id, tenant_id, adapter_id, name, status, config, last_sync, sync_frequency, records_synced, connected_at)
       VALUES (?, ?, 'sap-ecc-stub', 'SAP ECC Demo', 'connected', '{"sandbox":true}',
               datetime('now'), 'daily', 12500, datetime('now', '-1 days'))`
    ).bind(`erp-${tenantId}`, tenantId).run();
  } catch { /* skip if FK unhappy */ }

  try {
    await db.prepare(
      `INSERT INTO erp_companies (id, tenant_id, code, name, currency, base_country, fiscal_year_start_month)
       VALUES (?, ?, '1000', 'Demo Manufacturing (Pty) Ltd', 'ZAR', 'ZA', 3)`
    ).bind(`co-${tenantId}`, tenantId).run();
  } catch { /* may not exist on older schemas */ }
}

async function seedKpiDefinitions(db: D1Database, tenantId: string): Promise<void> {
  // Sub-catalyst declarations so Phase 10-6 KPI direction resolution
  // uses the customer's authoritative classification.
  const clusterId = `cluster-${tenantId}`;
  await db.prepare(
    `INSERT OR REPLACE INTO catalyst_clusters
       (id, tenant_id, name, domain, status)
     VALUES (?, ?, 'demo-finance', 'finance', 'active')`
  ).bind(clusterId, tenantId).run();
  for (const m of METRIC_SPECS) {
    await db.prepare(
      `INSERT INTO sub_catalyst_kpi_definitions
         (id, tenant_id, cluster_id, sub_catalyst_name, kpi_name, unit,
          direction, threshold_green, threshold_amber, threshold_red,
          calculation, data_source, category, is_universal, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, 0, 0, 1)`
    ).bind(
      crypto.randomUUID(), tenantId, clusterId, 'demo', m.name, m.unit,
      m.direction, m.thresholds.green, m.thresholds.amber, m.thresholds.red,
      m.domain.replace(/-.*$/, ''),
    ).run();
  }
}

async function seedProcessMetricsAndHistory(
  db: D1Database, tenantId: string,
): Promise<Array<{ id: string; name: string; status: string }>> {
  const out: Array<{ id: string; name: string; status: string }> = [];
  for (const m of METRIC_SPECS) {
    // Namespace metric IDs by tenant so the same demo can be seeded
    // for many tenants in parallel without UNIQUE constraint clashes.
    const namespacedId = `${m.id}::${tenantId}`;
    await db.prepare(
      `INSERT INTO process_metrics
         (id, tenant_id, name, value, unit, status, threshold_red,
          threshold_amber, threshold_green, domain, source_system, measured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sap_ecc', datetime('now'))`
    ).bind(
      namespacedId, tenantId, m.name, m.latest, m.unit, m.status,
      m.thresholds.red, m.thresholds.amber, m.thresholds.green, m.domain,
    ).run();

    const series = m.history(m.latest);
    for (let i = 0; i < series.length; i++) {
      const offset = series.length - 1 - i; // newest-first → oldest at offset DAYS-1
      await db.prepare(
        `INSERT INTO process_metric_history (id, tenant_id, metric_id, value, recorded_at)
         VALUES (?, ?, ?, ?, datetime('now', '-' || ? || ' days'))`
      ).bind(crypto.randomUUID(), tenantId, namespacedId, series[i], offset).run();
    }
    out.push({ id: namespacedId, name: m.name, status: m.status });
  }
  return out;
}

async function seedExternalSignals(
  db: D1Database, tenantId: string,
): Promise<string[]> {
  // Brent crude rising trend that correlates with Procurement Input Cost
  const today = new Date();
  const brentHistory: Array<{ date: string; value: number }> = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const t = (DAYS - 1 - i) / (DAYS - 1);
    const v = 75 + 22 * t + Math.sin(i * 0.4) * 0.5; // 75 → 97 USD/bbl
    brentHistory.push({ date: d.toISOString().slice(0, 10), value: Number(v.toFixed(2)) });
  }

  const sigOilId = `sig-brent-${tenantId}`;
  await db.prepare(
    `INSERT INTO external_signals
       (id, tenant_id, category, title, summary, source_url, source_name,
        reliability_score, relevance_score, sentiment, raw_data, detected_at)
     VALUES (?, ?, 'commodity', 'Brent crude spot price',
             'Brent rising trend over last 30 days', 'https://www.eia.gov/petroleum/',
             'EIA', 0.95, 0.85, 'neutral', ?, datetime('now'))`
  ).bind(sigOilId, tenantId, JSON.stringify({
    signal_key: 'oil.brent_spot',
    latest_value: brentHistory[brentHistory.length - 1].value,
    latest_date: brentHistory[brentHistory.length - 1].date,
    unit: 'USD/bbl',
    history: brentHistory,
  })).run();

  // FX (USD/ZAR) — flat-ish so it doesn't generate spurious attributions
  const fxHistory: Array<{ date: string; value: number }> = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    fxHistory.push({ date: d.toISOString().slice(0, 10), value: 18.5 + Math.sin(i * 0.5) * 0.05 });
  }
  const sigFxId = `sig-fx-${tenantId}`;
  await db.prepare(
    `INSERT INTO external_signals
       (id, tenant_id, category, title, summary, source_url, source_name,
        reliability_score, relevance_score, sentiment, raw_data, detected_at)
     VALUES (?, ?, 'fx', 'USD/ZAR exchange rate',
             'USD/ZAR ~18.5 stable', 'https://api.frankfurter.app',
             'frankfurter.app', 0.9, 0.7, 'neutral', ?, datetime('now'))`
  ).bind(sigFxId, tenantId, JSON.stringify({
    signal_key: 'fx.usd_zar',
    latest_value: fxHistory[fxHistory.length - 1].value,
    latest_date: fxHistory[fxHistory.length - 1].date,
    unit: 'ZAR',
    history: fxHistory,
  })).run();

  return [sigOilId, sigFxId];
}

async function seedSubCatalystRunsAndKpiValues(
  db: D1Database, tenantId: string,
): Promise<{ runIds: string[]; kpiValueCount: number }> {
  const clusterId = `cluster-${tenantId}`;

  // Pull KPI definitions we just inserted so we can link kpi_values to them.
  const kpiDefs = await db.prepare(
    `SELECT id, kpi_name FROM sub_catalyst_kpi_definitions WHERE tenant_id = ?`
  ).bind(tenantId).all<{ id: string; kpi_name: string }>();
  const defByName = new Map<string, string>();
  for (const r of kpiDefs.results || []) defByName.set(r.kpi_name, r.id);

  const runs = [
    {
      sub: 'procurement-cost-monitor', domain: 'procurement',
      matched: 1240, discrepancies: 87, exceptions_raised: 14,
      avg_confidence: 0.82, status: 'completed' as const,
      total_source_value: 6_400_000, total_discrepancy_value: 145_000,
      reasoning: 'Procurement input cost rose 28% over 30 days; 87 line-item variances flagged against PO master prices, driven by Brent crude pass-through on petrochemical inputs.',
      kpis: ['Procurement Input Cost'],
    },
    {
      sub: 'finance-margin-watch', domain: 'finance',
      matched: 980, discrepancies: 32, exceptions_raised: 6,
      avg_confidence: 0.88, status: 'completed' as const,
      total_source_value: 22_000_000, total_discrepancy_value: 220_000,
      reasoning: 'Gross margin trending below the 15% red threshold; 32 invoice variances spotted between AR aging and DPO baseline.',
      kpis: ['Gross Margin %', 'Days Payable Outstanding', 'Monthly Revenue'],
    },
    {
      sub: 'warehouse-picking-efficiency', domain: 'logistics-warehouse',
      matched: 1550, discrepancies: 184, exceptions_raised: 22,
      avg_confidence: 0.79, status: 'completed' as const,
      total_source_value: 0, total_discrepancy_value: 0,
      reasoning: 'Picking efficiency fell from 92% to 78% over 30 days; 184 over-time pick events on SKUs with stock-out risk.',
      kpis: ['Warehouse Picking Efficiency'],
    },
    {
      sub: 'hr-hiring-pipeline', domain: 'hr',
      matched: 64, discrepancies: 12, exceptions_raised: 3,
      avg_confidence: 0.91, status: 'completed' as const,
      total_source_value: 0, total_discrepancy_value: 0,
      reasoning: 'Open picker reqs grew from 4 to 12 over the window; time-to-hire above target across all open roles.',
      kpis: ['Open Pickers Reqs'],
    },
  ];

  const runIds: string[] = [];
  let kpiValueCount = 0;

  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const runId = `run-${tenantId}-${i}`;
    runIds.push(runId);
    const startedOffset = (runs.length - i) * 6 + 2; // staggered hours
    await db.prepare(
      `INSERT INTO sub_catalyst_runs
         (id, tenant_id, cluster_id, sub_catalyst_name, run_number,
          triggered_by, started_at, completed_at, duration_ms,
          source_record_count, target_record_count, status, mode,
          matched, unmatched_source, unmatched_target,
          discrepancies, exceptions_raised, avg_confidence,
          min_confidence, max_confidence, reasoning,
          total_source_value, total_matched_value, total_discrepancy_value,
          total_exception_value, total_unmatched_value, currency,
          items_total, items_reviewed, items_approved,
          review_complete, sign_off_status, created_at)
       VALUES (?, ?, ?, ?, ?, 'scheduled',
               datetime('now', '-' || ? || ' hours'),
               datetime('now', '-' || ? || ' hours'),
               45000,
               ?, ?, ?, 'reconciliation',
               ?, 0, 0, ?, ?, ?,
               ?, ?, ?,
               ?, ?, ?,
               ?, ?, 'ZAR',
               ?, ?, 0,
               1, 'open', datetime('now', '-' || ? || ' hours'))`
    ).bind(
      runId, tenantId, clusterId, r.sub, i + 1,
      startedOffset, Math.max(1, startedOffset - 1),
      r.matched + r.discrepancies, r.matched + r.discrepancies, r.status,
      r.matched, r.discrepancies, r.exceptions_raised, r.avg_confidence,
      Math.max(0, r.avg_confidence - 0.1), Math.min(1, r.avg_confidence + 0.05),
      r.reasoning,
      r.total_source_value, r.total_source_value - r.total_discrepancy_value,
      r.total_discrepancy_value,
      r.total_discrepancy_value * 0.2, 0,
      r.matched + r.discrepancies, r.matched + r.discrepancies,
      startedOffset,
    ).run();

    // Per-KPI values for this run, linked to the KPI definition rows we
    // already seeded. Each KPI value's status is the same red/amber/green
    // we set on the matching process_metric so consumers get a
    // consistent view across both surfaces.
    for (const kpiName of r.kpis) {
      const defId = defByName.get(kpiName);
      if (!defId) continue;
      const metric = METRIC_SPECS.find((m) => m.name === kpiName);
      if (!metric) continue;
      await db.prepare(
        `INSERT INTO sub_catalyst_kpi_values
           (id, tenant_id, definition_id, run_id, value, status, trend, measured_at)
         VALUES (?, ?, ?, ?, ?, ?, '[]', datetime('now', '-' || ? || ' hours'))`
      ).bind(
        crypto.randomUUID(), tenantId, defId, runId,
        metric.latest, metric.status, Math.max(1, startedOffset - 1),
      ).run();
      kpiValueCount++;
    }
  }
  return { runIds, kpiValueCount };
}

async function seedHealthScoresAndInsights(
  db: D1Database, tenantId: string, runIds: string[],
): Promise<{ insightsCount: number }> {
  // Headline health score (composite). Dimensions match the canonical
  // Atheon five-dimension framework so the Apex score-ring renders.
  const dimensions = {
    financial: 38,        // red: margin + DPO + revenue all stressed
    operational: 52,      // amber: picking efficiency
    cost: 42,             // red: procurement cost rising
    people: 56,           // amber: hiring lag
    revenue: 70,          // amber-flat
  };
  const overall = Math.round(
    Object.values(dimensions).reduce((s, v) => s + v, 0) / Object.values(dimensions).length,
  );
  await db.prepare(
    `INSERT INTO health_scores (id, tenant_id, overall_score, dimensions, calculated_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).bind(crypto.randomUUID(), tenantId, overall, JSON.stringify(dimensions)).run();

  // History — 30 days of snapshots showing the deterioration that led
  // to the current red state. Apex's HealthTrendChart reads this.
  for (let i = 29; i >= 0; i--) {
    const t = i / 29;
    const startScore = 75; // healthy 30 days ago
    const score = Math.round(startScore + (overall - startScore) * (1 - t));
    await db.prepare(
      `INSERT INTO health_score_history (id, tenant_id, overall_score, dimensions,
                                          source_run_id, catalyst_name, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-' || ? || ' days'))`
    ).bind(
      crypto.randomUUID(), tenantId, score, JSON.stringify(dimensions),
      runIds[i % runIds.length] ?? null,
      ['procurement-cost-monitor', 'finance-margin-watch', 'warehouse-picking-efficiency', 'hr-hiring-pipeline'][i % 4],
      i,
    ).run();
  }

  // Catalyst insights — one per run, plus a couple of cross-catalyst
  // insights for the Apex narrative panel.
  const insights: Array<{ category: string; title: string; description: string; severity: string; level: string; runId: string | null }> = [
    { category: 'kpi_movement', title: 'Procurement input cost up 28%', description: 'Procurement input cost has crossed the R5.5M red threshold; 87 line-item variances flagged against PO master prices.', severity: 'critical', level: 'apex', runId: runIds[0] ?? null },
    { category: 'kpi_movement', title: 'Gross margin breached red', description: 'Gross margin fell below 15% on the back of input cost rises; needs immediate intervention.', severity: 'critical', level: 'apex', runId: runIds[1] ?? null },
    { category: 'issue_detected', title: 'Picking efficiency degraded', description: 'Warehouse picking efficiency dropped from 92% to 78% across the period; 184 over-time pick events.', severity: 'warning', level: 'pulse', runId: runIds[2] ?? null },
    { category: 'issue_detected', title: 'Hiring lag widening', description: 'Open picker reqs have tripled to 12; time-to-hire above target.', severity: 'warning', level: 'pulse', runId: runIds[3] ?? null },
    { category: 'recommendation', title: 'Renegotiate supplier contracts', description: 'Atheon recommends opening price-discovery on top-3 procurement vendors given Brent +22%.', severity: 'info', level: 'apex', runId: runIds[0] ?? null },
  ];
  for (const ins of insights) {
    await db.prepare(
      `INSERT INTO catalyst_insights
         (id, tenant_id, source_type, source_run_id, cluster_id,
          sub_catalyst_name, domain, insight_level, category, title,
          description, severity, data, traceability, generated_at)
       VALUES (?, ?, 'catalyst_run', ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', '{}', datetime('now'))`
    ).bind(
      crypto.randomUUID(), tenantId, ins.runId, `cluster-${tenantId}`,
      ins.runId ? `run-${tenantId}` : null,
      'finance', ins.level, ins.category, ins.title, ins.description, ins.severity,
    ).run();
  }
  return { insightsCount: insights.length };
}

/**
 * Seed transactional substrate (Phase 10-30) so the action-layer
 * subcatalysts have something to work on.
 *
 * Layout is deliberate so each subcatalyst has at least one
 * auto-post case AND at least one block case:
 *
 *   - 5 POs + 4 matching GRs (one PO has no GR — blocks 3-way)
 *   - 6 AP invoices in inbox:
 *       3 cleanly match PO+GR → 3-way auto-post
 *       1 outside tolerance → 3-way block
 *       1 no GR → 3-way block
 *       1 duplicate of an auto-posted one → dup-blocker block
 *   - 4 AR open invoices across 2 customers
 *   - 3 customer payments:
 *       2 match (one via remittance text, one via single-amount)
 *       1 unmatched (no candidate)
 *   - 1 customer's credit limit set so exposure > limit triggers hold
 *   - 4 bank statement lines:
 *       2 receipts matching cash-app posted amounts
 *       1 payment matching payment-run posted amount
 *       1 unmatched (forces an exception)
 */
async function seedTransactionalSubstrate(
  db: D1Database, tenantId: string,
): Promise<{ posCount: number; apInvoiceCount: number; arInvoiceCount: number; bankLineCount: number }> {
  const connRow = await db.prepare(
    `SELECT id FROM erp_connections WHERE tenant_id = ? ORDER BY connected_at DESC LIMIT 1`,
  ).bind(tenantId).first<{ id: string }>();
  const connId = connRow?.id ?? null;
  const today = new Date();
  const isoDay = (offsetDays: number): string => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  };

  // ── 5 POs ────────────────────────────────────────────────────
  const pos = [
    { po: 'PO-1001', vendor_id: 'V-MAERSK',  vendor: 'Maersk Logistics SA',  amount: 125000 },
    { po: 'PO-1002', vendor_id: 'V-SASOL',   vendor: 'Sasol Chemicals',      amount:  78500 },
    { po: 'PO-1003', vendor_id: 'V-IMPALA',  vendor: 'Impala Mining Supply', amount: 240000 },
    { po: 'PO-1004', vendor_id: 'V-TRANSF',  vendor: 'Transnet Freight',     amount:  42000 },
    { po: 'PO-1005', vendor_id: 'V-BIDVEST', vendor: 'Bidvest Industrial',   amount:  18000 },
  ];
  for (const p of pos) {
    await db.prepare(
      `INSERT INTO purchase_orders (id, tenant_id, erp_connection_id, po_number, vendor_id, vendor_name,
         po_amount, po_currency, po_date, expected_delivery, status, payment_terms, source_system)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ZAR', ?, ?, 'open', 'NET30', 'sap_ecc')`,
    ).bind(
      `po-${tenantId}::${p.po}`, tenantId, connId,
      p.po, p.vendor_id, p.vendor, p.amount,
      isoDay(-30), isoDay(-15),
    ).run();
  }

  // ── 4 GRs (PO-1004 deliberately has none) ────────────────────
  const grs = [
    { gr: 'GR-2001', po: 'PO-1001', amount: 125000 },
    { gr: 'GR-2002', po: 'PO-1002', amount:  78500 },
    { gr: 'GR-2003', po: 'PO-1003', amount: 240000 },
    { gr: 'GR-2005', po: 'PO-1005', amount:  18000 },
  ];
  for (const g of grs) {
    await db.prepare(
      `INSERT INTO goods_receipts (id, tenant_id, erp_connection_id, gr_number, po_number,
         gr_date, qty_received, gr_amount, currency, status, source_system)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'ZAR', 'received', 'sap_ecc')`,
    ).bind(
      `gr-${tenantId}::${g.gr}`, tenantId, connId,
      g.gr, g.po, isoDay(-12), g.amount,
    ).run();
  }

  // ── 6 AP invoices ────────────────────────────────────────────
  const apInv = [
    { num: 'INV-9001', po: 'PO-1001', vendor_id: 'V-MAERSK',  vendor: 'Maersk Logistics SA',  amount: 125000 }, // matches
    { num: 'INV-9002', po: 'PO-1002', vendor_id: 'V-SASOL',   vendor: 'Sasol Chemicals',      amount:  78500 }, // matches
    { num: 'INV-9003', po: 'PO-1003', vendor_id: 'V-IMPALA',  vendor: 'Impala Mining Supply', amount: 240000 }, // matches exactly
    { num: 'INV-9004', po: 'PO-1004', vendor_id: 'V-TRANSF',  vendor: 'Transnet Freight',     amount:  42000 }, // no GR → block
    { num: 'INV-9005', po: 'PO-1005', vendor_id: 'V-BIDVEST', vendor: 'Bidvest Industrial',   amount:  21000 }, // 16% over PO → block
    { num: 'INV-9006', po: 'PO-1001', vendor_id: 'V-MAERSK',  vendor: 'Maersk Logistics SA',  amount: 125000 }, // duplicate of INV-9001 → dup-block
  ];
  for (const i of apInv) {
    await db.prepare(
      `INSERT INTO ap_invoice_inbox (id, tenant_id, erp_connection_id, invoice_number, vendor_id, vendor_name,
         po_number, invoice_amount, currency, invoice_date, due_date, payment_terms, source_system, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ZAR', ?, ?, 'NET30', 'sap_ecc', 'received')`,
    ).bind(
      `apinv-${tenantId}::${i.num}`, tenantId, connId,
      i.num, i.vendor_id, i.vendor, i.po, i.amount,
      isoDay(-3), isoDay(5),
    ).run();
  }

  // ── 4 AR open invoices ───────────────────────────────────────
  const arInv = [
    { num: 'AR-5001', cust_id: 'C-PNP',     cust: 'Pick n Pay',     amount: 180000, paid: 0 },
    { num: 'AR-5002', cust_id: 'C-PNP',     cust: 'Pick n Pay',     amount:  92000, paid: 0 },
    { num: 'AR-5003', cust_id: 'C-WOOLIES', cust: 'Woolworths',     amount: 145000, paid: 0 },
    { num: 'AR-5004', cust_id: 'C-WOOLIES', cust: 'Woolworths',     amount:  68000, paid: 0 },
  ];
  for (const i of arInv) {
    await db.prepare(
      `INSERT INTO ar_open_invoices (id, tenant_id, erp_connection_id, invoice_number, customer_id, customer_name,
         invoice_amount, currency, invoice_date, due_date, paid_amount, status, source_system)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ZAR', ?, ?, ?, 'open', 'sap_ecc')`,
    ).bind(
      `arinv-${tenantId}::${i.num}`, tenantId, connId,
      i.num, i.cust_id, i.cust, i.amount, isoDay(-20), isoDay(10), i.paid,
    ).run();
  }

  // ── 3 customer payments ──────────────────────────────────────
  const pays = [
    { ref: 'BANK-RCT-7001', cust_id: 'C-PNP',     cust: 'Pick n Pay', amount: 180000, remit: 'Payment for AR-5001 thanks' }, // remittance match
    { ref: 'BANK-RCT-7002', cust_id: 'C-WOOLIES', cust: 'Woolworths', amount:  68000, remit: null }, // single-amount match → AR-5004
    { ref: 'BANK-RCT-7003', cust_id: 'C-MAKRO',   cust: 'Makro',      amount:  35000, remit: null }, // unmatched (no open invoice)
  ];
  for (const p of pays) {
    await db.prepare(
      `INSERT INTO customer_payments (id, tenant_id, erp_connection_id, payment_ref, customer_id, customer_name,
         amount, currency, received_date, remittance_text, application_status, source_system)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ZAR', ?, ?, 'unapplied', 'sap_ecc')`,
    ).bind(
      `pay-${tenantId}::${p.ref}`, tenantId, connId,
      p.ref, p.cust_id, p.cust, p.amount, isoDay(-1), p.remit,
    ).run();
  }

  // ── Credit limit: PNP exposure (180k+92k=272k) > limit (200k) → hold ──
  await db.prepare(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES (?, ?, 'customer_credit_limit:C-PNP', ?)`,
  ).bind(crypto.randomUUID(), tenantId, '200000').run();
  await db.prepare(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES (?, ?, 'customer_credit_limit:C-WOOLIES', ?)`,
  ).bind(crypto.randomUUID(), tenantId, '500000').run();

  // ── 4 bank statement lines ───────────────────────────────────
  // 2 receipts that will match cash-app posts; 1 payment that will
  // match a payment-run posted amount; 1 unmatched line.
  // (Payment-run amounts: V-MAERSK 125k matches, etc.)
  const bankLines = [
    { ref: 'STMT-2026-05', line: 1, amount:  180000, cp: 'Pick n Pay',  narrative: 'Receipt AR-5001' },
    { ref: 'STMT-2026-05', line: 2, amount:   68000, cp: 'Woolworths',  narrative: 'Receipt AR-5004' },
    { ref: 'STMT-2026-05', line: 3, amount: -125000, cp: 'Maersk Logistics', narrative: 'Pmt MAERSK NET30' },
    { ref: 'STMT-2026-05', line: 4, amount:   12500, cp: 'Unknown',     narrative: 'Misc credit' },
  ];
  for (const b of bankLines) {
    await db.prepare(
      `INSERT INTO bank_statement_lines (id, tenant_id, erp_connection_id, statement_ref, line_number,
         value_date, amount, currency, counterparty, narrative, recon_status, source_system)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ZAR', ?, ?, 'unmatched', 'sap_ecc')`,
    ).bind(
      `bnk-${tenantId}::${b.ref}::${b.line}`, tenantId, connId,
      b.ref, b.line, isoDay(-1), b.amount, b.cp, b.narrative,
    ).run();
  }

  return {
    posCount: pos.length,
    apInvoiceCount: apInv.length,
    arInvoiceCount: arInv.length,
    bankLineCount: bankLines.length,
  };
}

async function seedVerifiedAction(db: D1Database, tenantId: string): Promise<void> {
  // One verified completed action so future RCA closures (when metrics
  // recover in subsequent ticks) become billable per Phase 10-19.
  const clusterId = `cluster-${tenantId}`;
  await db.prepare(
    `INSERT INTO catalyst_actions
       (id, cluster_id, tenant_id, catalyst_name, action, status,
        confidence, completed_at, verification_status, verified_at, created_at)
     VALUES (?, ?, ?, 'demo-procurement', 'renegotiate-supplier', 'completed',
             0.85, datetime('now', '-2 days'), 'verified',
             datetime('now', '-1 days'), datetime('now', '-3 days'))`
  ).bind(`act-${tenantId}`, clusterId, tenantId).run();
}

// ── Main ──────────────────────────────────────────────────────────────

export async function seedSapEccDemo(
  db: D1Database, opts: SeedOptions = {},
): Promise<SeedResult> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const adminEmail = opts.adminEmail ?? DEFAULT_ADMIN_EMAIL;
  const reseed = opts.reseed ?? true;
  const notes: string[] = [];

  if (reseed) {
    await deleteExisting(db, tenantId);
    notes.push(`Cleared prior data for ${tenantId}`);
  }

  const adminUserId = await seedTenantAndAdmin(db, tenantId, adminEmail);
  notes.push(`Seeded tenant + admin user (${adminEmail})`);

  await seedErpConnection(db, tenantId);
  notes.push('Seeded SAP ECC erp_connection + erp_companies (best-effort on FK)');

  await seedKpiDefinitions(db, tenantId);
  notes.push(`Seeded ${METRIC_SPECS.length} KPI definitions`);

  const metrics = await seedProcessMetricsAndHistory(db, tenantId);
  notes.push(`Seeded ${metrics.length} process_metrics + ${metrics.length * DAYS} history rows`);

  const signalIds = await seedExternalSignals(db, tenantId);
  notes.push(`Seeded ${signalIds.length} external_signals with ${DAYS}-day history`);

  await seedVerifiedAction(db, tenantId);
  notes.push('Seeded 1 verified catalyst_action for billing eligibility');

  const { runIds, kpiValueCount } = await seedSubCatalystRunsAndKpiValues(db, tenantId);
  notes.push(`Seeded ${runIds.length} sub_catalyst_runs + ${kpiValueCount} sub_catalyst_kpi_values`);

  const { insightsCount } = await seedHealthScoresAndInsights(db, tenantId, runIds);
  notes.push(`Seeded health_scores + 30-day history + ${insightsCount} catalyst_insights`);

  const txn = await seedTransactionalSubstrate(db, tenantId);
  notes.push(`Seeded transactional substrate: ${txn.posCount} POs, ${txn.apInvoiceCount} AP invoices, ${txn.arInvoiceCount} AR invoices, ${txn.bankLineCount} bank lines`);

  logInfo('demo_sap_ecc.seed_completed',
    { tenantId, layer: 'demo', action: 'seed' },
    { metrics: metrics.length, signals: signalIds.length });

  return { tenantId, adminUserId, metrics, signalIds, notes };
}
