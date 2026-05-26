/**
 * VantaX Demo — reset + billing-materialise helpers.
 *
 * Extracted from `routes/seed-vantax.ts` so tests can import these
 * functions without dragging in the 2,600-line route file (which
 * transitively pulls catalyst-templates and the rest of the seed
 * universe, blowing the vitest worker's import budget).
 *
 * Two responsibilities:
 *   1. `cleanupVantaxTenant` — wipe every tenant-scoped table for the
 *      VantaX demo tenant in dependency-safe order. The same helper
 *      backs both the `/seed-vantax` STEP 1 cleanup and the standalone
 *      `/seed-vantax/reset` endpoint.
 *   2. `materialiseDemoBilling` — turn the seeded (active) RCAs into a
 *      believable shared-savings invoice: resolve two of them, stamp
 *      impact_value, link a verified catalyst_action, and run
 *      `computeBillablePeriod` so the ROI dashboard / billing UI shows
 *      live numbers on day one.
 */

import { computeBillablePeriod } from './billing-engine';

/**
 * Whitelist of allowed table names — used to prevent SQL injection in
 * the `DELETE FROM ${table}` interpolation.
 *
 * IMPORTANT: this set is the union of every tenant-scoped table the seed
 * itself touches AND every tenant-scoped table the post-seed Phase 10
 * chain writes to — so a reset followed by a reseed lands on a clean
 * substrate every time. Adding a new tenant-scoped table elsewhere?
 * Add it here too, otherwise the demo accumulates stale rows on re-seed.
 */
export const VANTAX_TENANT_TABLES = new Set([
  'sub_catalyst_run_items', 'run_comments', 'sub_catalyst_kpi_values',
  'sub_catalyst_runs', 'catalyst_run_analytics', 'health_score_history',
  'health_scores', 'risk_alerts', 'anomalies', 'process_metric_history', 'process_metrics',
  'process_flows', 'correlation_events', 'agent_deployments', 'catalyst_actions',
  'executive_briefings', 'scenarios', 'run_insights', 'catalyst_insights',
  'catalyst_clusters', 'sub_catalyst_kpis', 'sub_catalyst_kpi_definitions',
  'cross_system_correlations', 'execution_logs',
  'erp_invoices', 'erp_purchase_orders', 'erp_suppliers', 'erp_customers',
  'erp_products', 'erp_bank_transactions', 'erp_journal_entries',
  'erp_gl_accounts', 'erp_employees', 'erp_tax_entries',
  'erp_connections',
  // ERP write-side + mapping artefacts (Phase 7–9)
  'erp_field_mappings', 'erp_process_profiles', 'erp_schema_drift_events',
  'erp_connection_config', 'erp_connection_schemas',
  // New engine tables
  'radar_signals', 'radar_signal_impacts', 'radar_strategic_context',
  'diagnostic_analyses', 'diagnostic_causal_chains', 'diagnostic_fix_tracking',
  'catalyst_patterns', 'catalyst_effectiveness', 'catalyst_dependencies',
  'external_signals', 'signal_impacts', 'competitors', 'market_benchmarks', 'regulatory_events',
  'root_cause_analyses', 'causal_factors', 'diagnostic_prescriptions',
  'catalyst_effectiveness', 'catalyst_prescriptions',
  'roi_tracking', 'board_reports',
  'industry_radar_seeds', 'industry_benchmark_seeds', 'industry_regulatory_seeds',
  // Phase 10 chain outputs
  'kpi_forecasts', 'inference_calibration',
  'billable_periods', 'billable_line_items',
  'orchestration_runs', 'orchestration_workflows', 'orchestration_step_executions',
  'catalyst_simulations', 'catalyst_calibrations',
  'dsar_requests',
  // §11 tables
  'atheon_score_history', 'baseline_snapshots', 'health_targets',
  'anonymised_benchmarks', 'resolution_patterns', 'trial_assessments',
  // Value Assessment Engine tables
  'assessment_runs', 'assessment_findings', 'assessment_data_quality',
  'assessment_process_timing', 'assessment_value_summary', 'assessments',
  // SAP native tables
  'sap_bkpf', 'sap_bseg', 'sap_bsid', 'sap_bsik', 'sap_febep',
  'sap_ekko', 'sap_ekpo', 'sap_ekbe', 'sap_mard', 'sap_iseg',
  'sap_vbak', 'sap_vbap', 'sap_vbrk', 'sap_vbrp',
  'sap_lfa1', 'sap_lfb1', 'sap_kna1', 'sap_knb1',
]);

/**
 * Cleanup all VantaX-tenant data in dependency-safe order and return the
 * row count. Shared between the seed flow (STEP 1) and the standalone
 * /reset endpoint.
 *
 * Order:
 *   1. All VANTAX_TENANT_TABLES except `catalyst_clusters` and
 *      `erp_connections` (children of those parents)
 *   2. Then `erp_connections` and `catalyst_clusters`
 *   3. Then `catalyst_hitl_config` (FK by cluster_id, carries a
 *      tenant_id column for filtering)
 *   4. Operational artefacts that accumulate across demos: tenant_settings
 *      (autotune markers, billing share overrides), audit_log, mind_queries,
 *      chat history, notifications, onboarding rows, api_keys, password
 *      reset tokens, user_sessions. These aren't part of the seed's data
 *      shape but they DO leak across cycles if not swept.
 */
export async function cleanupVantaxTenant(
  db: D1Database, tenantId: string,
): Promise<{ count: number; tables: number }> {
  const childTables = [...VANTAX_TENANT_TABLES].filter(
    t => t !== 'catalyst_clusters' && t !== 'erp_connections',
  );
  // `catalyst_hitl_config.cluster_id` REFERENCES `catalyst_clusters(id)`,
  // so it must come BEFORE the cluster delete or SQLite raises a FK error
  // (which we then swallow, leaving an orphan cluster row). Hit-list it
  // up-front. erp_connections and catalyst_clusters stay last as the
  // remaining roots.
  const preCluster = ['catalyst_hitl_config'];
  const parentTables = ['erp_connections', 'catalyst_clusters'];
  const cleanupTables = [...childTables, ...preCluster, ...parentTables];

  // Multi-pass cleanup. The Set's insertion order doesn't match the FK
  // dependency graph in every case (e.g. `root_cause_analyses` is listed
  // before its children `causal_factors` / `diagnostic_prescriptions`,
  // so a single-pass DELETE on the parent fails with FK error, gets
  // swallowed, and the parent survives). Rather than hand-curate a
  // topological order across 90 tables (and re-curate it every time a
  // new FK is added), iterate until the row count stabilises. Bounded
  // to MAX_PASSES so a genuinely-blocked row can't loop forever.
  const MAX_PASSES = 4;
  let cleanupCount = 0;
  let lastPassDeletions = -1;
  for (let pass = 0; pass < MAX_PASSES && lastPassDeletions !== 0; pass++) {
    lastPassDeletions = 0;
    for (const table of cleanupTables) {
      try {
        const result = await db.prepare(
          `DELETE FROM ${table} WHERE tenant_id = ?`
        ).bind(tenantId).run();
        const changed = Number((result.meta as Record<string, unknown>)?.changes) || 0;
        cleanupCount += changed;
        lastPassDeletions += changed;
      } catch {
        // Table may not exist on older deploys — fine.
      }
    }
  }
  // Operational noise (autotune markers, audit log, mind queries, chat).
  // Intentionally not in VANTAX_TENANT_TABLES — they're not seed data,
  // but they DO accumulate across demo cycles and pollute the UI.
  for (const t of [
    'tenant_settings', 'audit_log', 'mind_queries',
    'chat_conversations', 'run_comments', 'notifications',
    'support_ticket_replies', 'support_tickets',
    'onboarding_progress', 'api_keys', 'password_reset_tokens',
    'user_sessions',
  ]) {
    try { await db.prepare(`DELETE FROM ${t} WHERE tenant_id = ?`).bind(tenantId).run(); } catch { /* */ }
  }
  return { count: cleanupCount, tables: cleanupTables.length };
}

export interface MaterialisedBilling {
  rcasResolved: number;
  actionsVerified: number;
  periodId: string | null;
  lineItems: number;
  atheonRevenue: number;
  currency: string;
  windowStart: string;
  windowEnd: string;
}

/**
 * Make the demo's shared-savings billing path real.
 *
 * The seed produces RCAs with `status='active'` and no `impact_value` on
 * any causal_factor — so a clean call to `computeBillablePeriod` returns
 * zero line items, which makes the ROI dashboard / billing tab look empty
 * on first load. For a believable demo we:
 *
 *   1. Pick two RCAs ordered by `generated_at DESC`. Don't touch the
 *      others — Apex still shows live "active" risk narratives.
 *   2. Mark them `resolved` with `resolved_at` spaced across the last 30
 *      days so the demo's monthly period catches both.
 *   3. Set `impact_value` (ZAR) on each RCA's L0 causal factor. Values
 *      track the metric category: 4.2M for OEE-class symptoms, 1.8M for
 *      inventory-class — same shape a real customer would see.
 *   4. Insert a verified catalyst_action per RCA, linked via
 *      `source_finding_id = diagnostic_prescriptions.id` (the join key
 *      billing-engine uses). `verification_status='verified'` is the
 *      billing-eligibility gate.
 *   5. Compute + persist the billable_period for [today-30d, today).
 *      `tenant_settings.billing_share_pct` defaults to 0.2 → Atheon
 *      revenue = 20% of attributed savings.
 *
 * Idempotent: re-running on a freshly-seeded tenant produces the same
 * line items (computeBillablePeriod's UNIQUE constraint UPDATEs the
 * existing period). After `/reset`, this becomes a clean re-materialise.
 */
export async function materialiseDemoBilling(
  db: D1Database, tenantId: string,
): Promise<MaterialisedBilling> {
  // Pick the two most-recently-generated active RCAs.
  const rcas = await db.prepare(
    `SELECT id, metric_name FROM root_cause_analyses
      WHERE tenant_id = ? AND status = 'active'
      ORDER BY generated_at DESC LIMIT 2`
  ).bind(tenantId).all<{ id: string; metric_name: string }>();

  const todayDate = new Date();
  const startDate = new Date(todayDate.getTime() - 30 * 86400 * 1000);
  const windowEnd = todayDate.toISOString().slice(0, 10);
  const windowStart = startDate.toISOString().slice(0, 10);

  const targets = rcas.results || [];
  if (targets.length === 0) {
    return {
      rcasResolved: 0, actionsVerified: 0, periodId: null,
      lineItems: 0, atheonRevenue: 0, currency: 'ZAR',
      windowStart, windowEnd,
    };
  }

  // Impact-value heuristic by metric name. Falls back to ZAR 2M.
  const impactForMetric = (name: string): number => {
    const n = name.toLowerCase();
    if (n.includes('oee') || n.includes('production')) return 4_200_000;
    if (n.includes('inventory')) return 1_800_000;
    if (n.includes('fulfil')) return 950_000;
    if (n.includes('invoice') || n.includes('ap ') || n.includes('match')) return 1_350_000;
    return 2_000_000;
  };

  let rcasResolved = 0;
  let actionsVerified = 0;

  // Stagger resolved_at so the demo shows two distinct revenue events
  // within the window — both inside, but on different days.
  const stagger = [5, 18];
  for (let i = 0; i < targets.length; i++) {
    const rca = targets[i];
    const daysAgo = stagger[i] ?? 10;

    await db.prepare(
      `UPDATE root_cause_analyses
          SET status = 'resolved',
              resolved_at = datetime('now', ?)
        WHERE id = ? AND tenant_id = ?`
    ).bind(`-${daysAgo} days`, rca.id, tenantId).run();
    rcasResolved++;

    // Stamp impact_value on the L0 factor (billing reads MAX across
    // the RCA's factors — one is enough to be eligible).
    const impact = impactForMetric(rca.metric_name);
    await db.prepare(
      `UPDATE causal_factors
          SET impact_value = ?, impact_unit = 'ZAR'
        WHERE rca_id = ? AND tenant_id = ?
          AND id = (SELECT id FROM causal_factors
                     WHERE rca_id = ? AND tenant_id = ?
                     ORDER BY (CASE layer WHEN 'L0' THEN 0 ELSE 1 END), created_at ASC
                     LIMIT 1)`
    ).bind(impact, rca.id, tenantId, rca.id, tenantId).run();

    // Pick the highest-priority prescription for this RCA and create a
    // verified catalyst_action that joins back via source_finding_id.
    const presc = await db.prepare(
      `SELECT id FROM diagnostic_prescriptions
        WHERE rca_id = ? AND tenant_id = ?
        ORDER BY (CASE priority
                    WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                    WHEN 'medium' THEN 2 ELSE 3 END), created_at ASC
        LIMIT 1`
    ).bind(rca.id, tenantId).first<{ id: string }>();
    if (!presc?.id) continue;

    // Any cluster — required FK on catalyst_actions.cluster_id.
    const cluster = await db.prepare(
      `SELECT id FROM catalyst_clusters WHERE tenant_id = ? LIMIT 1`
    ).bind(tenantId).first<{ id: string }>();
    if (!cluster?.id) continue;

    const actionId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO catalyst_actions
         (id, tenant_id, cluster_id, catalyst_name, action, status, confidence,
          reasoning, source_finding_id, verification_status,
          created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, 'completed', 0.92,
               ?, ?, 'verified',
               datetime('now', ?), datetime('now', ?))`
    ).bind(
      actionId, tenantId, cluster.id,
      'Demo Catalyst', 'apply_prescription',
      `Verified demo action for "${rca.metric_name}" — closes the resolved RCA loop and unlocks the shared-savings line item.`,
      presc.id,
      `-${daysAgo + 2} days`, `-${daysAgo} days`,
    ).run();
    actionsVerified++;
  }

  const result = await computeBillablePeriod(db, tenantId, {
    periodStart: windowStart,
    periodEnd: windowEnd,
    persist: true,
  });

  return {
    rcasResolved,
    actionsVerified,
    periodId: result.periodId,
    lineItems: result.lineItemsInserted,
    atheonRevenue: result.period.atheon_revenue,
    currency: result.period.currency,
    windowStart, windowEnd,
  };
}
