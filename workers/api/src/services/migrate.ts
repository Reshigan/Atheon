/**
 * Database Migration Service
 * Extracted from request-path middleware to run on-demand via POST /api/v1/admin/migrate.
 * Contains all schema DDL, indexes, and self-healing columns.
 */

/** Current schema version — bump when adding new tables/columns/indexes */
// v51-trial-findings: trial_assessments.findings_json + findings_summary_json
// (additive self-heal columns, default to empty JSON). Used by the trial-
// assessment route to persist the new assessment-findings engine output for
// the trial UI. v50-service-erp came before; no rollback needed.
// v54-federation: federation_aggregates + federation_observations tables
// for differentially-private cross-tenant pattern learning. Each tenant
// contributes anonymised observations to industry/finding aggregates;
// reads are noised with Laplace mechanism (epsilon = 1.0) before
// returning to any tenant. No raw cross-tenant data exposure.
// v57-erp-schema-discovery: erp_connection_schemas table profiles the
// actual fields each ERP/subsystem sends per (tenant, connection, entity).
// Phase 1 of dynamic ERP-mapping intelligence; Phase 2 builds the auto-
// mapper on top of these profiles.
// v58-erp-auto-mapper: erp_field_mappings table persists per-(tenant,
// connection, entity) field → canonical mappings with confidence + source
// (auto/human/rule). The extractAmount/extractRef/extractEntity resolvers
// now consult these mappings before falling back to the static dictionary,
// so all 470 sub-catalysts + assessment + report endpoints become
// customisation-aware in one swing.
// v59-erp-drift-llm: erp_schema_drift_events table records detected
// schema drift (added/removed source fields per connection+entity) so
// the cron sweep can fire notifications. Phase 3 also adds the LLM
// fallback for fields the rule-based mapper can't place — those land
// as 'suggested' in erp_field_mappings until a human confirms.
// v60-erp-attribution: connection_id self-heal column on canonical ERP
// tables so attribution can roll up per-connection (not just per-source-
// system). Existing rows have NULL and fall back to source_system-level
// attribution; new ingestions tag connection_id explicitly.
// v61-erp-process-profile: erp_connection_config (raw key-value pairs
// observed from the ERP or customer-entered) + erp_process_profiles
// (resolved structured rules: 3-way-match flag, AP tolerance %, payment
// terms days, fiscal year start, approval thresholds, dunning rules).
// Catalysts can read the profile and operate within the customer's
// actual business rules instead of running on assumed defaults.
// v62-erp-write-actions: catalyst_actions self-heal columns for
// write-back action framework (action_type, value_zar,
// source_finding_id, idempotency_key, connection_id, vendor) so the
// approval queue + ROI attribution can join across actions.
export const MIGRATION_VERSION = 'v62-erp-write-actions';

/** Result of a migration run */
export interface MigrationResult {
  version: string;
  tablesCreated: number;
  indexesCreated: number;
  columnsHealed: number;
  durationMs: number;
  errors: string[];
}

/**
 * Run the full database migration: DDL, indexes, self-healing columns.
 * Idempotent — uses CREATE TABLE IF NOT EXISTS and ALTER TABLE wrapped in try/catch.
 * @param db - D1Database binding
 * @returns MigrationResult with stats
 */
export async function runMigrations(db: D1Database): Promise<MigrationResult> {
  const t0 = Date.now();
  const result: MigrationResult = {
    version: MIGRATION_VERSION,
    tablesCreated: 0,
    indexesCreated: 0,
    columnsHealed: 0,
    durationMs: 0,
    errors: [],
  };

  // ── Core Tables ──
  const coreTableSQL = `
    CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, plan TEXT NOT NULL DEFAULT 'starter', status TEXT NOT NULL DEFAULT 'active', deployment_model TEXT NOT NULL DEFAULT 'saas', region TEXT NOT NULL DEFAULT 'af-south-1', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS tenant_entitlements (tenant_id TEXT PRIMARY KEY REFERENCES tenants(id), layers TEXT NOT NULL DEFAULT '["apex","pulse"]', catalyst_clusters TEXT NOT NULL DEFAULT '["finance"]', max_agents INTEGER NOT NULL DEFAULT 5, max_users INTEGER NOT NULL DEFAULT 10, autonomy_tiers TEXT NOT NULL DEFAULT '["read-only"]', llm_tiers TEXT NOT NULL DEFAULT '["tier-1"]', features TEXT NOT NULL DEFAULT '[]', sso_enabled INTEGER NOT NULL DEFAULT 0, api_access INTEGER NOT NULL DEFAULT 0, custom_branding INTEGER NOT NULL DEFAULT 0, data_retention_days INTEGER NOT NULL DEFAULT 90);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'analyst', password_hash TEXT, permissions TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active', last_login TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, email));
    CREATE TABLE IF NOT EXISTS iam_policies (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, description TEXT, type TEXT NOT NULL DEFAULT 'rbac', rules TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS sso_configs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), provider TEXT NOT NULL, client_id TEXT NOT NULL, issuer_url TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, auto_provision INTEGER NOT NULL DEFAULT 0, default_role TEXT NOT NULL DEFAULT 'analyst', domain_hint TEXT);
    CREATE TABLE IF NOT EXISTS catalyst_clusters (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, domain TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'inactive', agent_count INTEGER NOT NULL DEFAULT 0, tasks_completed INTEGER NOT NULL DEFAULT 0, tasks_in_progress INTEGER NOT NULL DEFAULT 0, success_rate REAL NOT NULL DEFAULT 0, trust_score REAL NOT NULL DEFAULT 0, autonomy_tier TEXT NOT NULL DEFAULT 'read-only', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS catalyst_actions (id TEXT PRIMARY KEY, cluster_id TEXT NOT NULL REFERENCES catalyst_clusters(id), tenant_id TEXT NOT NULL REFERENCES tenants(id), catalyst_name TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', confidence REAL, input_data TEXT, output_data TEXT, reasoning TEXT, approved_by TEXT, escalation_level TEXT, retry_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT);
    CREATE TABLE IF NOT EXISTS agent_deployments (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), cluster_id TEXT REFERENCES catalyst_clusters(id), name TEXT NOT NULL, agent_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'provisioning', deployment_model TEXT NOT NULL DEFAULT 'saas', version TEXT NOT NULL DEFAULT '1.0.0', health_score REAL NOT NULL DEFAULT 100, uptime REAL NOT NULL DEFAULT 100, tasks_executed INTEGER NOT NULL DEFAULT 0, last_heartbeat TEXT, config TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS graph_entities (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), type TEXT NOT NULL, name TEXT NOT NULL, properties TEXT NOT NULL DEFAULT '{}', confidence REAL NOT NULL DEFAULT 1.0, source TEXT, valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS graph_relationships (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), source_id TEXT NOT NULL REFERENCES graph_entities(id), target_id TEXT NOT NULL REFERENCES graph_entities(id), type TEXT NOT NULL, properties TEXT NOT NULL DEFAULT '{}', confidence REAL NOT NULL DEFAULT 1.0, valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT);
    CREATE TABLE IF NOT EXISTS health_scores (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), overall_score REAL NOT NULL, dimensions TEXT NOT NULL DEFAULT '{}', calculated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS executive_briefings (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), title TEXT NOT NULL, summary TEXT NOT NULL, risks TEXT NOT NULL DEFAULT '[]', opportunities TEXT NOT NULL DEFAULT '[]', kpi_movements TEXT NOT NULL DEFAULT '[]', decisions_needed TEXT NOT NULL DEFAULT '[]', generated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS risk_alerts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), title TEXT NOT NULL, description TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'medium', category TEXT NOT NULL, probability REAL, impact_value REAL, impact_unit TEXT DEFAULT 'ZAR', recommended_actions TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active', detected_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT);
    CREATE TABLE IF NOT EXISTS scenarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), title TEXT NOT NULL, description TEXT NOT NULL, input_query TEXT NOT NULL, variables TEXT NOT NULL DEFAULT '[]', results TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS process_metrics (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'green', threshold_green REAL, threshold_amber REAL, threshold_red REAL, trend TEXT NOT NULL DEFAULT '[]', source_system TEXT, measured_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS process_metric_history (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), metric_id TEXT NOT NULL REFERENCES process_metrics(id), value REAL NOT NULL, recorded_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS anomalies (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), metric TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'medium', expected_value REAL NOT NULL, actual_value REAL NOT NULL, deviation REAL NOT NULL, hypothesis TEXT, status TEXT NOT NULL DEFAULT 'open', detected_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT);
    CREATE TABLE IF NOT EXISTS process_flows (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]', variants INTEGER NOT NULL DEFAULT 1, avg_duration REAL NOT NULL DEFAULT 0, conformance_rate REAL NOT NULL DEFAULT 100, bottlenecks TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS correlation_events (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), source_system TEXT NOT NULL, source_event TEXT NOT NULL, target_system TEXT NOT NULL, target_impact TEXT NOT NULL, confidence REAL NOT NULL, lag_days REAL NOT NULL DEFAULT 0, detected_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS erp_adapters (id TEXT PRIMARY KEY, name TEXT NOT NULL, system TEXT NOT NULL, version TEXT, protocol TEXT NOT NULL DEFAULT 'REST', status TEXT NOT NULL DEFAULT 'available', operations TEXT NOT NULL DEFAULT '[]', auth_methods TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS erp_connections (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), adapter_id TEXT NOT NULL REFERENCES erp_adapters(id), name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'disconnected', config TEXT NOT NULL DEFAULT '{}', last_sync TEXT, sync_frequency TEXT DEFAULT 'realtime', records_synced INTEGER NOT NULL DEFAULT 0, connected_at TEXT);
    CREATE TABLE IF NOT EXISTS erp_connection_schemas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, connection_id TEXT NOT NULL, source_system TEXT NOT NULL, entity_type TEXT NOT NULL, source_field TEXT NOT NULL, inferred_type TEXT NOT NULL DEFAULT 'string', sample_values TEXT NOT NULL DEFAULT '[]', null_rate REAL NOT NULL DEFAULT 0, occurrences INTEGER NOT NULL DEFAULT 0, sample_size INTEGER NOT NULL DEFAULT 0, first_seen_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, connection_id, entity_type, source_field));
    CREATE TABLE IF NOT EXISTS erp_field_mappings (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, connection_id TEXT NOT NULL, entity_type TEXT NOT NULL, canonical_field TEXT NOT NULL, source_field TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0, learned_from TEXT NOT NULL DEFAULT 'auto', rationale TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, connection_id, entity_type, canonical_field, source_field));
    CREATE TABLE IF NOT EXISTS erp_schema_drift_events (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, connection_id TEXT NOT NULL, entity_type TEXT NOT NULL, added_fields TEXT NOT NULL DEFAULT '[]', removed_fields TEXT NOT NULL DEFAULT '[]', total_current INTEGER NOT NULL DEFAULT 0, total_previous INTEGER NOT NULL DEFAULT 0, acknowledged_at TEXT, detected_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS erp_connection_config (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, connection_id TEXT NOT NULL, namespace TEXT NOT NULL DEFAULT 'general', config_key TEXT NOT NULL, config_value TEXT, value_type TEXT NOT NULL DEFAULT 'string', source TEXT NOT NULL DEFAULT 'inferred', confidence REAL NOT NULL DEFAULT 0, observed_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, connection_id, namespace, config_key));
    CREATE TABLE IF NOT EXISTS erp_process_profiles (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, connection_id TEXT NOT NULL, profile_json TEXT NOT NULL DEFAULT '{}', evidence_json TEXT NOT NULL DEFAULT '{}', inferred_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, connection_id));
    CREATE TABLE IF NOT EXISTS canonical_endpoints (id TEXT PRIMARY KEY, domain TEXT NOT NULL, path TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'GET', description TEXT, request_schema TEXT, response_schema TEXT, rate_limit INTEGER NOT NULL DEFAULT 100, version TEXT NOT NULL DEFAULT 'v1');
    CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT, action TEXT NOT NULL, layer TEXT NOT NULL, resource TEXT, details TEXT, outcome TEXT NOT NULL DEFAULT 'success', ip_address TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS mind_queries (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT, query TEXT NOT NULL, response TEXT, tier TEXT NOT NULL DEFAULT 'tier-1', tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0, citations TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), type TEXT NOT NULL DEFAULT 'system', title TEXT NOT NULL, message TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info', action_url TEXT, metadata TEXT, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), url TEXT NOT NULL, secret TEXT NOT NULL, events TEXT NOT NULL DEFAULT '["*"]', active INTEGER NOT NULL DEFAULT 1, retry_count INTEGER NOT NULL DEFAULT 0, last_triggered TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS webhook_delivery_queue (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), webhook_id TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, last_error TEXT, last_response_code INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), delivered_at TEXT);
    CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'document', mime_type TEXT NOT NULL DEFAULT 'application/octet-stream', size INTEGER NOT NULL DEFAULT 0, r2_key TEXT, uploaded_by TEXT, stored_in_r2 INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS email_queue (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), recipients TEXT NOT NULL, subject TEXT NOT NULL, html_body TEXT NOT NULL, text_body TEXT, status TEXT NOT NULL DEFAULT 'pending', sent_at TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS execution_logs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), action_id TEXT NOT NULL, step_number INTEGER NOT NULL, step_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', detail TEXT, duration_ms INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS managed_deployments (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, deployment_type TEXT NOT NULL DEFAULT 'hybrid', status TEXT NOT NULL DEFAULT 'pending', licence_key TEXT NOT NULL UNIQUE, licence_expires_at TEXT, agent_version TEXT, api_version TEXT, customer_api_url TEXT, region TEXT DEFAULT 'af-south-1', last_heartbeat TEXT, health_score REAL NOT NULL DEFAULT 0, config TEXT NOT NULL DEFAULT '{}', resource_usage TEXT NOT NULL DEFAULT '{}', error_log TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS assessments (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), prospect_name TEXT NOT NULL, prospect_industry TEXT NOT NULL, erp_connection_id TEXT REFERENCES erp_connections(id), status TEXT NOT NULL DEFAULT 'pending', config TEXT NOT NULL DEFAULT '{}', data_snapshot TEXT NOT NULL DEFAULT '{}', results TEXT NOT NULL DEFAULT '{}', business_report_key TEXT, technical_report_key TEXT, excel_model_key TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT);
    CREATE TABLE IF NOT EXISTS chat_conversations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL DEFAULT 'New Conversation', model_tier TEXT NOT NULL DEFAULT 'tier-1', messages TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS password_reset_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL, name TEXT NOT NULL, key_hash TEXT NOT NULL, key_prefix TEXT, permissions TEXT NOT NULL DEFAULT '["read"]', last_used TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT);
    CREATE TABLE IF NOT EXISTS user_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), tenant_id TEXT NOT NULL REFERENCES tenants(id), token_hash TEXT NOT NULL, ip_address TEXT, user_agent TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deleted_tenants (tenant_id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS catalyst_hitl_config (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), cluster_id TEXT NOT NULL REFERENCES catalyst_clusters(id), sub_catalyst_name TEXT, domain TEXT NOT NULL, validator_user_ids TEXT NOT NULL DEFAULT '[]', exception_handler_user_ids TEXT NOT NULL DEFAULT '[]', escalation_user_ids TEXT NOT NULL DEFAULT '[]', notify_on_completion INTEGER NOT NULL DEFAULT 0, notify_on_exception INTEGER NOT NULL DEFAULT 1, notify_on_approval_needed INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, cluster_id, sub_catalyst_name));
    CREATE TABLE IF NOT EXISTS catalyst_run_analytics (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), cluster_id TEXT NOT NULL REFERENCES catalyst_clusters(id), sub_catalyst_name TEXT, run_id TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT, duration_ms INTEGER, total_items INTEGER NOT NULL DEFAULT 0, completed_items INTEGER NOT NULL DEFAULT 0, exception_items INTEGER NOT NULL DEFAULT 0, escalated_items INTEGER NOT NULL DEFAULT 0, pending_items INTEGER NOT NULL DEFAULT 0, auto_approved_items INTEGER NOT NULL DEFAULT 0, avg_confidence REAL NOT NULL DEFAULT 0, min_confidence REAL NOT NULL DEFAULT 0, max_confidence REAL NOT NULL DEFAULT 0, confidence_distribution TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'running', insights TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS sub_catalyst_runs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), cluster_id TEXT NOT NULL REFERENCES catalyst_clusters(id), sub_catalyst_name TEXT NOT NULL, run_number INTEGER NOT NULL, triggered_by TEXT NOT NULL DEFAULT 'manual', trigger_context TEXT, started_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT, duration_ms INTEGER, data_sources_used TEXT NOT NULL DEFAULT '[]', source_record_count INTEGER NOT NULL DEFAULT 0, target_record_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'running', mode TEXT NOT NULL DEFAULT 'reconciliation', matched INTEGER NOT NULL DEFAULT 0, unmatched_source INTEGER NOT NULL DEFAULT 0, unmatched_target INTEGER NOT NULL DEFAULT 0, discrepancies INTEGER NOT NULL DEFAULT 0, exceptions_raised INTEGER NOT NULL DEFAULT 0, avg_confidence REAL NOT NULL DEFAULT 0, min_confidence REAL NOT NULL DEFAULT 0, max_confidence REAL NOT NULL DEFAULT 0, reasoning TEXT, recommendations TEXT DEFAULT '[]', metrics_generated TEXT DEFAULT '[]', anomalies_detected TEXT DEFAULT '[]', risk_alerts_raised TEXT DEFAULT '[]', actions_created TEXT DEFAULT '[]', result_data TEXT, discrepancy_details TEXT, total_source_value REAL NOT NULL DEFAULT 0, total_matched_value REAL NOT NULL DEFAULT 0, total_discrepancy_value REAL NOT NULL DEFAULT 0, total_exception_value REAL NOT NULL DEFAULT 0, total_unmatched_value REAL NOT NULL DEFAULT 0, currency TEXT DEFAULT 'ZAR', items_total INTEGER NOT NULL DEFAULT 0, items_reviewed INTEGER NOT NULL DEFAULT 0, items_approved INTEGER NOT NULL DEFAULT 0, items_rejected INTEGER NOT NULL DEFAULT 0, items_deferred INTEGER NOT NULL DEFAULT 0, review_complete INTEGER NOT NULL DEFAULT 0, parent_run_id TEXT, sign_off_status TEXT DEFAULT 'open', signed_off_by TEXT, signed_off_at TEXT, sign_off_notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS sub_catalyst_kpis (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), cluster_id TEXT NOT NULL REFERENCES catalyst_clusters(id), sub_catalyst_name TEXT NOT NULL, total_runs INTEGER NOT NULL DEFAULT 0, successful_runs INTEGER NOT NULL DEFAULT 0, failed_runs INTEGER NOT NULL DEFAULT 0, success_rate REAL NOT NULL DEFAULT 0, avg_duration_ms INTEGER NOT NULL DEFAULT 0, avg_records_processed INTEGER NOT NULL DEFAULT 0, avg_match_rate REAL NOT NULL DEFAULT 0, avg_discrepancy_rate REAL NOT NULL DEFAULT 0, avg_confidence REAL NOT NULL DEFAULT 0, total_exceptions INTEGER NOT NULL DEFAULT 0, exception_rate REAL NOT NULL DEFAULT 0, success_trend TEXT NOT NULL DEFAULT '[]', duration_trend TEXT NOT NULL DEFAULT '[]', discrepancy_trend TEXT NOT NULL DEFAULT '[]', confidence_trend TEXT NOT NULL DEFAULT '[]', health_dimensions TEXT NOT NULL DEFAULT '[]', health_contribution REAL NOT NULL DEFAULT 0, threshold_success_green REAL DEFAULT 90, threshold_success_amber REAL DEFAULT 70, threshold_success_red REAL DEFAULT 50, threshold_duration_green INTEGER DEFAULT 60000, threshold_duration_amber INTEGER DEFAULT 120000, threshold_duration_red INTEGER DEFAULT 300000, threshold_discrepancy_green REAL DEFAULT 2, threshold_discrepancy_amber REAL DEFAULT 5, threshold_discrepancy_red REAL DEFAULT 10, status TEXT NOT NULL DEFAULT 'green', last_run_at TEXT, next_scheduled_run TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, cluster_id, sub_catalyst_name));
    CREATE TABLE IF NOT EXISTS health_score_history (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), overall_score REAL NOT NULL, dimensions TEXT NOT NULL DEFAULT '{}', source_run_id TEXT, catalyst_name TEXT, recorded_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS sub_catalyst_run_items (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES sub_catalyst_runs(id), tenant_id TEXT NOT NULL REFERENCES tenants(id), item_number INTEGER NOT NULL, item_status TEXT NOT NULL DEFAULT 'matched', category TEXT, source_ref TEXT, source_date TEXT, source_entity TEXT, source_amount REAL, source_currency TEXT DEFAULT 'ZAR', source_data TEXT, target_ref TEXT, target_date TEXT, target_entity TEXT, target_amount REAL, target_currency TEXT DEFAULT 'ZAR', target_data TEXT, match_confidence REAL, match_method TEXT, matched_on_field TEXT, discrepancy_field TEXT, discrepancy_source_value TEXT, discrepancy_target_value TEXT, discrepancy_amount REAL, discrepancy_pct REAL, discrepancy_reason TEXT, exception_type TEXT, exception_severity TEXT, exception_detail TEXT, review_status TEXT NOT NULL DEFAULT 'pending', reviewed_by TEXT, reviewed_at TEXT, review_notes TEXT, reclassified_to TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS run_comments (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES sub_catalyst_runs(id), item_id TEXT REFERENCES sub_catalyst_run_items(id), user_id TEXT NOT NULL, user_name TEXT NOT NULL, comment TEXT NOT NULL, comment_type TEXT DEFAULT 'note', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS sub_catalyst_kpi_definitions (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, cluster_id TEXT NOT NULL REFERENCES catalyst_clusters(id), sub_catalyst_name TEXT NOT NULL, kpi_name TEXT NOT NULL, unit TEXT NOT NULL, direction TEXT NOT NULL DEFAULT 'higher_better', threshold_green REAL, threshold_amber REAL, threshold_red REAL, calculation TEXT NOT NULL DEFAULT '', data_source TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'universal', is_universal INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS sub_catalyst_kpi_values (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, definition_id TEXT NOT NULL REFERENCES sub_catalyst_kpi_definitions(id), run_id TEXT REFERENCES sub_catalyst_runs(id), value REAL NOT NULL, status TEXT NOT NULL DEFAULT 'green', trend TEXT NOT NULL DEFAULT '[]', measured_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS catalyst_insights (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), source_type TEXT NOT NULL DEFAULT 'catalyst_run', source_run_id TEXT, cluster_id TEXT, sub_catalyst_name TEXT, domain TEXT, insight_level TEXT NOT NULL DEFAULT 'pulse', category TEXT NOT NULL DEFAULT 'kpi_movement', title TEXT NOT NULL, description TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info', data TEXT NOT NULL DEFAULT '{}', traceability TEXT NOT NULL DEFAULT '{}', generated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS tenant_settings (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, key));
    CREATE TABLE IF NOT EXISTS radar_signals (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), source TEXT NOT NULL, signal_type TEXT NOT NULL DEFAULT 'regulatory', title TEXT NOT NULL, description TEXT NOT NULL, url TEXT, raw_data TEXT NOT NULL DEFAULT '{}', severity TEXT NOT NULL DEFAULT 'medium', relevance_score REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'new', detected_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS radar_signal_impacts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), signal_id TEXT NOT NULL REFERENCES radar_signals(id), dimension TEXT NOT NULL, impact_direction TEXT NOT NULL DEFAULT 'negative', impact_magnitude REAL NOT NULL DEFAULT 0, affected_metrics TEXT NOT NULL DEFAULT '[]', recommended_actions TEXT NOT NULL DEFAULT '[]', llm_reasoning TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS radar_strategic_context (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), context_type TEXT NOT NULL DEFAULT 'macro', title TEXT NOT NULL, summary TEXT NOT NULL, factors TEXT NOT NULL DEFAULT '[]', sentiment TEXT NOT NULL DEFAULT 'neutral', confidence REAL NOT NULL DEFAULT 0, source_signal_ids TEXT NOT NULL DEFAULT '[]', valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS diagnostic_analyses (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), metric_id TEXT NOT NULL, metric_name TEXT NOT NULL, metric_value REAL NOT NULL, metric_status TEXT NOT NULL, trigger_type TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT);
    CREATE TABLE IF NOT EXISTS diagnostic_causal_chains (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), analysis_id TEXT NOT NULL REFERENCES diagnostic_analyses(id), level INTEGER NOT NULL DEFAULT 0, cause_type TEXT NOT NULL DEFAULT 'direct', title TEXT NOT NULL, description TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0, evidence TEXT NOT NULL DEFAULT '[]', related_metrics TEXT NOT NULL DEFAULT '[]', recommended_fix TEXT, fix_priority TEXT NOT NULL DEFAULT 'medium', fix_effort TEXT NOT NULL DEFAULT 'medium', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS diagnostic_fix_tracking (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), chain_id TEXT NOT NULL REFERENCES diagnostic_causal_chains(id), analysis_id TEXT NOT NULL REFERENCES diagnostic_analyses(id), status TEXT NOT NULL DEFAULT 'proposed', assigned_to TEXT, started_at TEXT, completed_at TEXT, outcome TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS catalyst_patterns (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), pattern_type TEXT NOT NULL DEFAULT 'recurring_issue', title TEXT NOT NULL, description TEXT NOT NULL, frequency INTEGER NOT NULL DEFAULT 1, first_seen TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT NOT NULL DEFAULT (datetime('now')), affected_clusters TEXT NOT NULL DEFAULT '[]', affected_sub_catalysts TEXT NOT NULL DEFAULT '[]', severity TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'active', recommended_actions TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS catalyst_effectiveness (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), cluster_id TEXT NOT NULL REFERENCES catalyst_clusters(id), sub_catalyst_name TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, runs_count INTEGER NOT NULL DEFAULT 0, success_rate REAL NOT NULL DEFAULT 0, avg_match_rate REAL NOT NULL DEFAULT 0, avg_duration_ms INTEGER NOT NULL DEFAULT 0, total_value_processed REAL NOT NULL DEFAULT 0, total_exceptions INTEGER NOT NULL DEFAULT 0, improvement_trend REAL NOT NULL DEFAULT 0, roi_estimate REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, cluster_id, sub_catalyst_name, period_start));
    CREATE TABLE IF NOT EXISTS catalyst_dependencies (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), source_cluster_id TEXT NOT NULL REFERENCES catalyst_clusters(id), source_sub_catalyst TEXT NOT NULL, target_cluster_id TEXT NOT NULL REFERENCES catalyst_clusters(id), target_sub_catalyst TEXT NOT NULL, dependency_type TEXT NOT NULL DEFAULT 'data_flow', strength REAL NOT NULL DEFAULT 0, description TEXT, discovered_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS external_signals (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), category TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, source_url TEXT, source_name TEXT, reliability_score REAL NOT NULL DEFAULT 0.5, relevance_score REAL NOT NULL DEFAULT 0.5, sentiment TEXT NOT NULL DEFAULT 'neutral', raw_data TEXT NOT NULL DEFAULT '{}', detected_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT);
    CREATE TABLE IF NOT EXISTS signal_impacts (id TEXT PRIMARY KEY, signal_id TEXT NOT NULL REFERENCES external_signals(id), tenant_id TEXT NOT NULL REFERENCES tenants(id), health_dimension TEXT NOT NULL, impact_magnitude INTEGER NOT NULL DEFAULT 1, impact_direction TEXT NOT NULL DEFAULT 'headwind', impact_timeline TEXT NOT NULL DEFAULT 'near-term', confidence REAL NOT NULL DEFAULT 0.5, recommended_response TEXT, analysis TEXT NOT NULL DEFAULT '{}', computed_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS competitors (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, industry TEXT, estimated_revenue TEXT, market_share REAL, strengths TEXT NOT NULL DEFAULT '[]', weaknesses TEXT NOT NULL DEFAULT '[]', last_updated TEXT NOT NULL DEFAULT (datetime('now')), signals_count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS market_benchmarks (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), industry TEXT NOT NULL, metric_name TEXT NOT NULL, benchmark_value REAL NOT NULL, benchmark_unit TEXT, percentile_25 REAL, percentile_50 REAL, percentile_75 REAL, source TEXT, measured_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS regulatory_events (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), title TEXT NOT NULL, description TEXT NOT NULL, jurisdiction TEXT, affected_dimensions TEXT NOT NULL DEFAULT '[]', effective_date TEXT, compliance_deadline TEXT, readiness_score REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'upcoming', source_url TEXT);
    CREATE TABLE IF NOT EXISTS root_cause_analyses (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), metric_id TEXT NOT NULL, metric_name TEXT NOT NULL, trigger_status TEXT NOT NULL, causal_chain TEXT NOT NULL DEFAULT '[]', confidence REAL NOT NULL DEFAULT 0, impact_summary TEXT, prescription TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active', source_data_refs TEXT NOT NULL DEFAULT '{}', generated_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT);
    CREATE TABLE IF NOT EXISTS causal_factors (id TEXT PRIMARY KEY, rca_id TEXT NOT NULL REFERENCES root_cause_analyses(id), tenant_id TEXT NOT NULL REFERENCES tenants(id), layer TEXT NOT NULL, factor_type TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '{}', impact_value REAL, impact_unit TEXT DEFAULT 'ZAR', confidence REAL NOT NULL DEFAULT 0, source_run_ids TEXT NOT NULL DEFAULT '[]', source_metric_ids TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS diagnostic_prescriptions (id TEXT PRIMARY KEY, rca_id TEXT NOT NULL REFERENCES root_cause_analyses(id), tenant_id TEXT NOT NULL REFERENCES tenants(id), priority TEXT NOT NULL DEFAULT 'short-term', title TEXT NOT NULL, description TEXT NOT NULL, expected_impact TEXT, effort_level TEXT NOT NULL DEFAULT 'medium', responsible_domain TEXT, deadline_suggested TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT);
    CREATE TABLE IF NOT EXISTS catalyst_prescriptions (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), pattern_id TEXT REFERENCES catalyst_patterns(id), cluster_id TEXT NOT NULL, sub_catalyst_name TEXT NOT NULL, prescription_type TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]', sap_transactions TEXT NOT NULL DEFAULT '[]', expected_impact TEXT, effort_level TEXT NOT NULL DEFAULT 'medium', priority TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT);
    CREATE TABLE IF NOT EXISTS roi_tracking (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), period TEXT NOT NULL, total_discrepancy_value_identified REAL NOT NULL DEFAULT 0, total_discrepancy_value_recovered REAL NOT NULL DEFAULT 0, total_downstream_losses_prevented REAL NOT NULL DEFAULT 0, total_person_hours_saved REAL NOT NULL DEFAULT 0, total_catalyst_runs INTEGER NOT NULL DEFAULT 0, licence_cost_annual REAL NOT NULL DEFAULT 0, roi_multiple REAL NOT NULL DEFAULT 0, calculated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, period));
    CREATE TABLE IF NOT EXISTS board_reports (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), title TEXT NOT NULL, report_type TEXT NOT NULL DEFAULT 'monthly', content TEXT NOT NULL DEFAULT '{}', r2_key TEXT, generated_by TEXT, generated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS industry_radar_seeds (id TEXT PRIMARY KEY, industry TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, source_name TEXT, default_dimensions TEXT NOT NULL DEFAULT '[]', default_magnitude INTEGER NOT NULL DEFAULT 5, default_direction TEXT NOT NULL DEFAULT 'headwind', region TEXT NOT NULL DEFAULT 'ZA');
    CREATE TABLE IF NOT EXISTS industry_benchmark_seeds (id TEXT PRIMARY KEY, industry TEXT NOT NULL, metric_name TEXT NOT NULL, benchmark_value REAL NOT NULL, benchmark_unit TEXT, percentile_25 REAL, percentile_50 REAL, percentile_75 REAL, source TEXT, region TEXT NOT NULL DEFAULT 'ZA');
    CREATE TABLE IF NOT EXISTS industry_regulatory_seeds (id TEXT PRIMARY KEY, industry TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, jurisdiction TEXT NOT NULL DEFAULT 'South Africa', affected_dimensions TEXT NOT NULL DEFAULT '[]', recurring INTEGER NOT NULL DEFAULT 0, typical_deadline_month INTEGER);
    CREATE TABLE IF NOT EXISTS onboarding_progress (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL, step_id TEXT NOT NULL, completed_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, user_id, step_id));
    CREATE TABLE IF NOT EXISTS baseline_snapshots (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), snapshot_type TEXT NOT NULL DEFAULT 'day_zero', health_score REAL NOT NULL DEFAULT 0, dimensions TEXT NOT NULL DEFAULT '{}', metric_count_green INTEGER NOT NULL DEFAULT 0, metric_count_amber INTEGER NOT NULL DEFAULT 0, metric_count_red INTEGER NOT NULL DEFAULT 0, total_discrepancy_value REAL NOT NULL DEFAULT 0, total_process_conformance REAL NOT NULL DEFAULT 0, avg_catalyst_success_rate REAL NOT NULL DEFAULT 0, roi_at_snapshot REAL NOT NULL DEFAULT 0, raw_data TEXT NOT NULL DEFAULT '{}', captured_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS health_targets (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), target_type TEXT NOT NULL, target_name TEXT NOT NULL, target_value REAL NOT NULL, target_deadline TEXT, current_value REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), achieved_at TEXT, UNIQUE(tenant_id, target_type, target_name));
    CREATE TABLE IF NOT EXISTS anonymised_benchmarks (id TEXT PRIMARY KEY, industry TEXT NOT NULL, dimension TEXT NOT NULL, period TEXT NOT NULL, tenant_count INTEGER NOT NULL DEFAULT 0, avg_score REAL NOT NULL DEFAULT 0, p25_score REAL NOT NULL DEFAULT 0, p50_score REAL NOT NULL DEFAULT 0, p75_score REAL NOT NULL DEFAULT 0, min_score REAL NOT NULL DEFAULT 0, max_score REAL NOT NULL DEFAULT 0, calculated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(industry, dimension, period));
    CREATE TABLE IF NOT EXISTS resolution_patterns (id TEXT PRIMARY KEY, pattern_signature TEXT NOT NULL, industry TEXT NOT NULL, resolution_count INTEGER NOT NULL DEFAULT 0, avg_resolution_days REAL NOT NULL DEFAULT 0, avg_value_recovered REAL NOT NULL DEFAULT 0, common_fix_types TEXT NOT NULL DEFAULT '[]', last_updated TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(pattern_signature, industry));
    CREATE TABLE IF NOT EXISTS atheon_score_history (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), score INTEGER NOT NULL, components TEXT NOT NULL DEFAULT '{}', recorded_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS trial_assessments (id TEXT PRIMARY KEY, tenant_id TEXT, company_name TEXT NOT NULL, industry TEXT NOT NULL, contact_name TEXT NOT NULL, contact_email TEXT NOT NULL, data_source TEXT NOT NULL DEFAULT 'csv_upload', status TEXT NOT NULL DEFAULT 'pending', progress INTEGER NOT NULL DEFAULT 0, current_step TEXT, health_score REAL, issues_found INTEGER, estimated_exposure REAL, top_risks TEXT NOT NULL DEFAULT '[]', top_opportunities TEXT NOT NULL DEFAULT '[]', projected_roi REAL, report_r2_key TEXT, ip_address TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT, expires_at TEXT);
    CREATE TABLE IF NOT EXISTS assessment_runs (id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, tenant_id TEXT NOT NULL, cluster_name TEXT NOT NULL, sub_catalyst_name TEXT NOT NULL, domain TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', source_record_count INTEGER NOT NULL DEFAULT 0, target_record_count INTEGER NOT NULL DEFAULT 0, matched INTEGER NOT NULL DEFAULT 0, discrepancies INTEGER NOT NULL DEFAULT 0, exceptions INTEGER NOT NULL DEFAULT 0, total_source_value REAL NOT NULL DEFAULT 0, total_discrepancy_value REAL NOT NULL DEFAULT 0, total_unmatched_value REAL NOT NULL DEFAULT 0, match_rate REAL NOT NULL DEFAULT 0, discrepancy_rate REAL NOT NULL DEFAULT 0, avg_confidence REAL NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, findings TEXT NOT NULL DEFAULT '[]', root_causes TEXT NOT NULL DEFAULT '[]', prescriptions TEXT NOT NULL DEFAULT '[]', started_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT);
    CREATE TABLE IF NOT EXISTS assessment_findings (id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, run_id TEXT NOT NULL, tenant_id TEXT NOT NULL, finding_type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'medium', title TEXT NOT NULL, description TEXT NOT NULL, affected_records INTEGER NOT NULL DEFAULT 0, financial_impact REAL NOT NULL DEFAULT 0, evidence TEXT NOT NULL DEFAULT '{}', root_cause TEXT, prescription TEXT, category TEXT NOT NULL, immediate_value REAL NOT NULL DEFAULT 0, ongoing_monthly_value REAL NOT NULL DEFAULT 0, domain TEXT NOT NULL DEFAULT 'general', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS assessment_data_quality (id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, tenant_id TEXT NOT NULL, table_name TEXT NOT NULL, total_records INTEGER NOT NULL DEFAULT 0, complete_records INTEGER NOT NULL DEFAULT 0, completeness_pct REAL NOT NULL DEFAULT 0, field_scores TEXT NOT NULL DEFAULT '{}', referential_issues INTEGER NOT NULL DEFAULT 0, duplicate_records INTEGER NOT NULL DEFAULT 0, orphan_records INTEGER NOT NULL DEFAULT 0, stale_records INTEGER NOT NULL DEFAULT 0, overall_quality_score REAL NOT NULL DEFAULT 0, issues TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS assessment_process_timing (id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, tenant_id TEXT NOT NULL, process_name TEXT NOT NULL, avg_cycle_time_days REAL NOT NULL DEFAULT 0, median_cycle_time_days REAL NOT NULL DEFAULT 0, p90_cycle_time_days REAL NOT NULL DEFAULT 0, benchmark_cycle_time_days REAL NOT NULL DEFAULT 0, bottleneck_step TEXT, bottleneck_avg_days REAL NOT NULL DEFAULT 0, records_analysed INTEGER NOT NULL DEFAULT 0, records_exceeding_benchmark INTEGER NOT NULL DEFAULT 0, financial_impact_of_delay REAL NOT NULL DEFAULT 0, evidence TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS assessment_value_summary (id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, tenant_id TEXT NOT NULL, total_immediate_value REAL NOT NULL DEFAULT 0, total_ongoing_monthly_value REAL NOT NULL DEFAULT 0, total_ongoing_annual_value REAL NOT NULL DEFAULT 0, total_data_quality_issues INTEGER NOT NULL DEFAULT 0, total_process_delays INTEGER NOT NULL DEFAULT 0, total_findings INTEGER NOT NULL DEFAULT 0, total_critical_findings INTEGER NOT NULL DEFAULT 0, outcome_based_monthly_fee REAL NOT NULL DEFAULT 0, outcome_based_fee_pct REAL NOT NULL DEFAULT 0, payback_days INTEGER NOT NULL DEFAULT 0, value_by_domain TEXT NOT NULL DEFAULT '{}', value_by_category TEXT NOT NULL DEFAULT '{}', executive_narrative TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS tenant_llm_budget (tenant_id TEXT PRIMARY KEY, monthly_token_budget INTEGER, tokens_used_this_month INTEGER NOT NULL DEFAULT 0, tokens_reset_at TEXT, llm_redaction_enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS tenant_llm_usage (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT, prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0, endpoint TEXT, request_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS system_alert_rules (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, description TEXT, event_type TEXT NOT NULL, condition TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'medium', channels TEXT NOT NULL DEFAULT '[]', recipients TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1, silenced_until TEXT, triggered_count INTEGER NOT NULL DEFAULT 0, last_triggered_at TEXT, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS feature_flags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT, type TEXT NOT NULL DEFAULT 'boolean', default_enabled INTEGER NOT NULL DEFAULT 0, rollout_percent INTEGER NOT NULL DEFAULT 0, tenant_allowlist TEXT NOT NULL DEFAULT '[]', created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS iam_custom_roles (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, description TEXT, permissions TEXT NOT NULL DEFAULT '[]', inherits_from TEXT, user_count INTEGER NOT NULL DEFAULT 0, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, name));
    CREATE TABLE IF NOT EXISTS support_tickets (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id), assignee_user_id TEXT REFERENCES users(id), subject TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general', priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS support_ticket_replies (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id), tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS erp_projects (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), company_id TEXT REFERENCES erp_companies(id), external_id TEXT, source_system TEXT NOT NULL DEFAULT 'manual', code TEXT NOT NULL, name TEXT NOT NULL, customer_id TEXT REFERENCES erp_customers(id), customer_name TEXT, project_manager TEXT, start_date TEXT, end_date TEXT, billing_type TEXT NOT NULL DEFAULT 'time_and_materials', currency TEXT DEFAULT 'ZAR', contract_value REAL DEFAULT 0, billed_to_date REAL DEFAULT 0, recognised_revenue REAL DEFAULT 0, budgeted_hours REAL DEFAULT 0, budgeted_cost REAL DEFAULT 0, actual_cost REAL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT);
    CREATE TABLE IF NOT EXISTS erp_time_entries (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), company_id TEXT REFERENCES erp_companies(id), external_id TEXT, source_system TEXT NOT NULL DEFAULT 'manual', employee_id TEXT REFERENCES erp_employees(id), employee_number TEXT, project_id TEXT REFERENCES erp_projects(id), project_code TEXT, work_date TEXT NOT NULL, hours REAL NOT NULL DEFAULT 0, billable INTEGER NOT NULL DEFAULT 1, billed INTEGER NOT NULL DEFAULT 0, billable_rate REAL DEFAULT 0, cost_rate REAL DEFAULT 0, currency TEXT DEFAULT 'ZAR', activity_code TEXT, description TEXT, approval_status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT);
    CREATE TABLE IF NOT EXISTS catalyst_simulations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), cluster_id TEXT REFERENCES catalyst_clusters(id), sub_catalyst_name TEXT NOT NULL, predicted_value_zar REAL NOT NULL, lower_bound_zar REAL NOT NULL, upper_bound_zar REAL NOT NULL, confidence_pct REAL NOT NULL DEFAULT 95, calibration_factor REAL NOT NULL DEFAULT 1, n_priors INTEGER NOT NULL DEFAULT 0, methodology_json TEXT NOT NULL DEFAULT '{}', simulated_at TEXT NOT NULL DEFAULT (datetime('now')), run_id TEXT REFERENCES sub_catalyst_runs(id), actual_value_zar REAL, residual REAL, recorded_at TEXT);
    CREATE TABLE IF NOT EXISTS catalyst_calibrations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), cluster_id TEXT REFERENCES catalyst_clusters(id), sub_catalyst_name TEXT NOT NULL, n_observations INTEGER NOT NULL DEFAULT 0, mean_residual REAL NOT NULL DEFAULT 1, m2_residual REAL NOT NULL DEFAULT 0, calibration_factor REAL NOT NULL DEFAULT 1, std_residual REAL NOT NULL DEFAULT 0, mae REAL NOT NULL DEFAULT 0, last_observation_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, cluster_id, sub_catalyst_name));
    CREATE TABLE IF NOT EXISTS provenance_chain (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), seq INTEGER NOT NULL, parent_id TEXT, payload_type TEXT NOT NULL, payload_hash TEXT NOT NULL, payload_json TEXT NOT NULL, signed_by_user_id TEXT REFERENCES users(id), signature TEXT, merkle_root_after TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, seq));
    CREATE TABLE IF NOT EXISTS federation_observations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), industry_bucket TEXT NOT NULL DEFAULT 'general', finding_code TEXT NOT NULL, resolved_in_days REAL, recovery_pct REAL, raw_value_zar REAL, observed_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS federation_aggregates (id TEXT PRIMARY KEY, industry_bucket TEXT NOT NULL DEFAULT 'general', finding_code TEXT NOT NULL, n_contributors INTEGER NOT NULL DEFAULT 0, avg_resolved_days REAL NOT NULL DEFAULT 0, avg_recovery_pct REAL NOT NULL DEFAULT 0, p25_recovery_pct REAL DEFAULT 0, p75_recovery_pct REAL DEFAULT 0, epsilon REAL NOT NULL DEFAULT 1, last_refreshed_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(industry_bucket, finding_code));
    CREATE TABLE IF NOT EXISTS billing_checkouts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), plan_id TEXT NOT NULL, billing_cycle TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', stripe_session_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `;

  const coreStatements = coreTableSQL.split(';').filter(s => s.trim().length > 0);
  for (const stmt of coreStatements) {
    try {
      await db.prepare(stmt.trim()).run();
      result.tablesCreated++;
    } catch (err) {
      result.errors.push(`Core table: ${(err as Error).message}`);
    }
  }

  // ── Indexes ──
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_clusters_tenant ON catalyst_clusters(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_actions_tenant ON catalyst_actions(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_actions_status ON catalyst_actions(tenant_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_agent_deployments_tenant ON agent_deployments(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_entities_tenant ON graph_entities(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_entities_type ON graph_entities(tenant_id, type)',
    'CREATE INDEX IF NOT EXISTS idx_graph_relationships_source ON graph_relationships(source_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_relationships_target ON graph_relationships(target_id)',
    'CREATE INDEX IF NOT EXISTS idx_health_scores_tenant ON health_scores(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_risk_alerts_tenant ON risk_alerts(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_metric_history_tenant_metric ON process_metric_history(tenant_id, metric_id)',
    'CREATE INDEX IF NOT EXISTS idx_metric_history_recorded_at ON process_metric_history(recorded_at)',
    'CREATE INDEX IF NOT EXISTS idx_anomalies_tenant ON anomalies(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_mind_queries_tenant ON mind_queries(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(tenant_id, read)',
    'CREATE INDEX IF NOT EXISTS idx_webhooks_tenant ON webhooks(tenant_id)',
    // Webhook delivery queue (Audit §3.6) — picker looks up pending rows whose next_attempt_at is due
    'CREATE INDEX IF NOT EXISTS idx_webhook_queue_due ON webhook_delivery_queue(status, next_attempt_at)',
    'CREATE INDEX IF NOT EXISTS idx_webhook_queue_tenant ON webhook_delivery_queue(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_webhook_queue_webhook ON webhook_delivery_queue(webhook_id)',
    'CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(tenant_id, type)',
    'CREATE INDEX IF NOT EXISTS idx_email_queue_tenant ON email_queue(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status)',
    'CREATE INDEX IF NOT EXISTS idx_execution_logs_tenant ON execution_logs(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_execution_logs_action ON execution_logs(action_id)',
    'CREATE INDEX IF NOT EXISTS idx_managed_deployments_tenant ON managed_deployments(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_managed_deployments_licence ON managed_deployments(licence_key)',
    'CREATE INDEX IF NOT EXISTS idx_assessments_tenant ON assessments(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_chat_conversations_tenant ON chat_conversations(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_chat_conversations_user ON chat_conversations(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)',
    'CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_hitl_config_tenant ON catalyst_hitl_config(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_hitl_config_cluster ON catalyst_hitl_config(cluster_id)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_actions_assigned ON catalyst_actions(tenant_id, assigned_to)',
    'CREATE INDEX IF NOT EXISTS idx_scr_tenant_sub ON sub_catalyst_runs(tenant_id, cluster_id, sub_catalyst_name)',
    'CREATE INDEX IF NOT EXISTS idx_scr_status ON sub_catalyst_runs(tenant_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_scr_date ON sub_catalyst_runs(tenant_id, started_at)',
    'CREATE INDEX IF NOT EXISTS idx_scr_parent ON sub_catalyst_runs(parent_run_id)',
    'CREATE INDEX IF NOT EXISTS idx_scri_run ON sub_catalyst_run_items(run_id)',
    'CREATE INDEX IF NOT EXISTS idx_scri_status ON sub_catalyst_run_items(item_status)',
    'CREATE INDEX IF NOT EXISTS idx_scri_review ON sub_catalyst_run_items(review_status)',
    'CREATE INDEX IF NOT EXISTS idx_scri_severity ON sub_catalyst_run_items(exception_severity)',
    'CREATE INDEX IF NOT EXISTS idx_run_comments_run ON run_comments(run_id)',
    'CREATE INDEX IF NOT EXISTS idx_run_comments_item ON run_comments(item_id)',
    // KPI definitions indexes (from PR #129)
    'CREATE INDEX IF NOT EXISTS idx_sckd_tenant_sub ON sub_catalyst_kpi_definitions(tenant_id, cluster_id, sub_catalyst_name)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_sckd_unique ON sub_catalyst_kpi_definitions(tenant_id, cluster_id, sub_catalyst_name, kpi_name)',
    'CREATE INDEX IF NOT EXISTS idx_sckv_def ON sub_catalyst_kpi_values(definition_id)',
    'CREATE INDEX IF NOT EXISTS idx_sckv_run ON sub_catalyst_kpi_values(run_id)',
    // Spec 6: health_score_history indexes
    'CREATE INDEX IF NOT EXISTS idx_hsh_tenant ON health_score_history(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_hsh_tenant_date ON health_score_history(tenant_id, recorded_at)',
    // Spec 6: process_metrics source attribution indexes
    'CREATE INDEX IF NOT EXISTS idx_pm_source_run ON process_metrics(source_run_id)',
    'CREATE INDEX IF NOT EXISTS idx_pm_cluster ON process_metrics(tenant_id, cluster_id)',
    // Traceability optimization indexes
    'CREATE INDEX IF NOT EXISTS idx_ra_source_run ON risk_alerts(tenant_id, source_run_id, cluster_id)',
    'CREATE INDEX IF NOT EXISTS idx_pm_tenant_source ON process_metrics(tenant_id, source_run_id, cluster_id)',
    'CREATE INDEX IF NOT EXISTS idx_scr_tenant_cluster ON sub_catalyst_runs(tenant_id, cluster_id, source_run_id)',
    'CREATE INDEX IF NOT EXISTS idx_anomalies_metric ON anomalies(tenant_id, metric)',
    // Insights engine indexes
    'CREATE INDEX IF NOT EXISTS idx_ci_tenant_level ON catalyst_insights(tenant_id, insight_level)',
    'CREATE INDEX IF NOT EXISTS idx_ci_tenant_domain ON catalyst_insights(tenant_id, domain)',
    'CREATE INDEX IF NOT EXISTS idx_ci_tenant_severity ON catalyst_insights(tenant_id, severity)',
    'CREATE INDEX IF NOT EXISTS idx_ci_generated ON catalyst_insights(tenant_id, generated_at)',
    'CREATE INDEX IF NOT EXISTS idx_ts_tenant_key ON tenant_settings(tenant_id, key)',
    // Process metrics domain/category indexes
    'CREATE INDEX IF NOT EXISTS idx_pm_domain ON process_metrics(tenant_id, domain)',
    // Radar engine indexes
    'CREATE INDEX IF NOT EXISTS idx_radar_signals_tenant ON radar_signals(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_radar_signals_type ON radar_signals(tenant_id, signal_type)',
    'CREATE INDEX IF NOT EXISTS idx_radar_signals_status ON radar_signals(tenant_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_radar_signal_impacts_signal ON radar_signal_impacts(signal_id)',
    'CREATE INDEX IF NOT EXISTS idx_radar_signal_impacts_tenant ON radar_signal_impacts(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_radar_signal_impacts_dim ON radar_signal_impacts(tenant_id, dimension)',
    'CREATE INDEX IF NOT EXISTS idx_radar_strategic_ctx_tenant ON radar_strategic_context(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_radar_strategic_ctx_type ON radar_strategic_context(tenant_id, context_type)',
    // Diagnostics engine indexes
    'CREATE INDEX IF NOT EXISTS idx_diag_analyses_tenant ON diagnostic_analyses(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_diag_analyses_metric ON diagnostic_analyses(tenant_id, metric_id)',
    'CREATE INDEX IF NOT EXISTS idx_diag_analyses_status ON diagnostic_analyses(tenant_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_diag_causal_chains_analysis ON diagnostic_causal_chains(analysis_id)',
    'CREATE INDEX IF NOT EXISTS idx_diag_causal_chains_tenant ON diagnostic_causal_chains(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_diag_fix_tracking_chain ON diagnostic_fix_tracking(chain_id)',
    'CREATE INDEX IF NOT EXISTS idx_diag_fix_tracking_tenant ON diagnostic_fix_tracking(tenant_id, status)',
    // Catalyst intelligence indexes
    'CREATE INDEX IF NOT EXISTS idx_catalyst_patterns_tenant ON catalyst_patterns(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_patterns_type ON catalyst_patterns(tenant_id, pattern_type)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_patterns_status ON catalyst_patterns(tenant_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_effectiveness_tenant ON catalyst_effectiveness(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_effectiveness_cluster ON catalyst_effectiveness(tenant_id, cluster_id)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_deps_tenant ON catalyst_dependencies(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_deps_source ON catalyst_dependencies(source_cluster_id)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_deps_target ON catalyst_dependencies(target_cluster_id)',
    // V2 Spec: external_signals + signal_impacts indexes
    'CREATE INDEX IF NOT EXISTS idx_ext_signals_tenant ON external_signals(tenant_id, category)',
    'CREATE INDEX IF NOT EXISTS idx_ext_signals_detected ON external_signals(detected_at)',
    'CREATE INDEX IF NOT EXISTS idx_sig_impacts_tenant ON signal_impacts(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sig_impacts_signal ON signal_impacts(signal_id)',
    // V2 Spec: competitors, benchmarks, regulatory indexes
    'CREATE INDEX IF NOT EXISTS idx_competitors_tenant ON competitors(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_market_benchmarks_tenant ON market_benchmarks(tenant_id, industry)',
    'CREATE INDEX IF NOT EXISTS idx_regulatory_events_tenant ON regulatory_events(tenant_id, status)',
    // V2 Spec: root_cause_analyses + causal_factors + prescriptions indexes
    'CREATE INDEX IF NOT EXISTS idx_rca_tenant ON root_cause_analyses(tenant_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_rca_metric ON root_cause_analyses(metric_id)',
    'CREATE INDEX IF NOT EXISTS idx_causal_factors_rca ON causal_factors(rca_id)',
    'CREATE INDEX IF NOT EXISTS idx_causal_factors_tenant ON causal_factors(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_diag_prescriptions_rca ON diagnostic_prescriptions(rca_id)',
    'CREATE INDEX IF NOT EXISTS idx_diag_prescriptions_tenant ON diagnostic_prescriptions(tenant_id, status)',
    // V2 Spec: catalyst_prescriptions indexes
    'CREATE INDEX IF NOT EXISTS idx_catalyst_prescriptions_tenant ON catalyst_prescriptions(tenant_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_prescriptions_pattern ON catalyst_prescriptions(pattern_id)',
    // V2 Spec: roi_tracking + board_reports indexes
    'CREATE INDEX IF NOT EXISTS idx_roi_tracking_tenant ON roi_tracking(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_board_reports_tenant ON board_reports(tenant_id)',
    // V2 Spec: industry seed indexes
    'CREATE INDEX IF NOT EXISTS idx_industry_radar_seeds ON industry_radar_seeds(industry)',
    'CREATE INDEX IF NOT EXISTS idx_industry_benchmark_seeds ON industry_benchmark_seeds(industry)',
    'CREATE INDEX IF NOT EXISTS idx_industry_regulatory_seeds ON industry_regulatory_seeds(industry)',
    // §11: Section 11 indexes
    'CREATE INDEX IF NOT EXISTS idx_baseline_tenant ON baseline_snapshots(tenant_id, snapshot_type)',
    'CREATE INDEX IF NOT EXISTS idx_health_targets_tenant ON health_targets(tenant_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_atheon_score_tenant ON atheon_score_history(tenant_id, recorded_at)',
    'CREATE INDEX IF NOT EXISTS idx_trial_assessments_email ON trial_assessments(contact_email)',
    'CREATE INDEX IF NOT EXISTS idx_trial_assessments_ip ON trial_assessments(ip_address)',
    'CREATE INDEX IF NOT EXISTS idx_resolution_patterns_sig ON resolution_patterns(pattern_signature, industry)',
    'CREATE INDEX IF NOT EXISTS idx_anonymised_benchmarks_ind ON anonymised_benchmarks(industry, dimension)',
    // Value Assessment Engine indexes
    'CREATE INDEX IF NOT EXISTS idx_assessment_runs ON assessment_runs(assessment_id)',
    'CREATE INDEX IF NOT EXISTS idx_assessment_runs_tenant ON assessment_runs(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_assessment_findings ON assessment_findings(assessment_id, category)',
    'CREATE INDEX IF NOT EXISTS idx_assessment_findings_tenant ON assessment_findings(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_assessment_findings_severity ON assessment_findings(assessment_id, severity)',
    'CREATE INDEX IF NOT EXISTS idx_assessment_dq ON assessment_data_quality(assessment_id)',
    'CREATE INDEX IF NOT EXISTS idx_assessment_dq_tenant ON assessment_data_quality(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_assessment_timing ON assessment_process_timing(assessment_id)',
    'CREATE INDEX IF NOT EXISTS idx_assessment_timing_tenant ON assessment_process_timing(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_assessment_value_summary ON assessment_value_summary(assessment_id)',
    'CREATE INDEX IF NOT EXISTS idx_assessment_value_summary_tenant ON assessment_value_summary(tenant_id)',
    // LLM budget + PII redaction (v40)
    'CREATE INDEX IF NOT EXISTS idx_tenant_llm_usage_tenant ON tenant_llm_usage(tenant_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_tenant_llm_usage_provider ON tenant_llm_usage(tenant_id, provider)',
    // v45-alerts: system alert rules
    'CREATE INDEX IF NOT EXISTS idx_system_alert_rules_tenant ON system_alert_rules(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_system_alert_rules_enabled ON system_alert_rules(tenant_id, enabled)',
    // v47-platform: Feature flags + custom roles
    'CREATE INDEX IF NOT EXISTS idx_feature_flags_name ON feature_flags(name)',
    'CREATE INDEX IF NOT EXISTS idx_iam_custom_roles_tenant ON iam_custom_roles(tenant_id)',
    // v49-support: Support tickets + replies
    'CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant ON support_tickets(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(tenant_id, user_id)',
    'CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(tenant_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_support_tickets_created ON support_tickets(tenant_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_ticket ON support_ticket_replies(ticket_id)',
    'CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_tenant ON support_ticket_replies(tenant_id)',
    // v50-service-erp: project + time-entry indexes for service-company findings.
    'CREATE INDEX IF NOT EXISTS idx_erp_projects_tenant ON erp_projects(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_projects_company ON erp_projects(tenant_id, company_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_projects_status ON erp_projects(tenant_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_erp_time_entries_tenant ON erp_time_entries(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_time_entries_company ON erp_time_entries(tenant_id, company_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_time_entries_employee ON erp_time_entries(tenant_id, employee_id, work_date)',
    'CREATE INDEX IF NOT EXISTS idx_erp_time_entries_project ON erp_time_entries(tenant_id, project_id)',
    // v52-simulator indexes — fast lookup of recent predictions per
    // catalyst, plus calibration-row uniqueness for upserts.
    'CREATE INDEX IF NOT EXISTS idx_catalyst_simulations_tenant ON catalyst_simulations(tenant_id, sub_catalyst_name)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_simulations_run ON catalyst_simulations(run_id)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_simulations_recent ON catalyst_simulations(tenant_id, simulated_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_catalyst_calibrations_lookup ON catalyst_calibrations(tenant_id, cluster_id, sub_catalyst_name)',
    // v53-provenance — chain walks need fast (tenant_id, seq) lookup; verify
    // operation walks (tenant_id, parent_id) ascending.
    'CREATE INDEX IF NOT EXISTS idx_provenance_chain_walk ON provenance_chain(tenant_id, seq)',
    'CREATE INDEX IF NOT EXISTS idx_provenance_chain_parent ON provenance_chain(tenant_id, parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_provenance_chain_type ON provenance_chain(tenant_id, payload_type, created_at DESC)',
    // v54-federation indexes — observation aggregations group by
    // (industry_bucket, finding_code); reads are uniqueness-constrained.
    'CREATE INDEX IF NOT EXISTS idx_federation_observations_lookup ON federation_observations(industry_bucket, finding_code)',
    'CREATE INDEX IF NOT EXISTS idx_federation_observations_tenant ON federation_observations(tenant_id, finding_code)',
    'CREATE INDEX IF NOT EXISTS idx_federation_aggregates_lookup ON federation_aggregates(industry_bucket, finding_code)',
  ];

  for (const idx of indexes) {
    try {
      await db.prepare(idx).run();
      result.indexesCreated++;
    } catch (err) {
      result.errors.push(`Index: ${(err as Error).message}`);
    }
  }

  // ── Canonical ERP Tables ──
  // Multi-company model: each tenant can have N companies (SAP BUKRS,
  // Odoo companies, Xero organisations, NetSuite subsidiaries, Dynamics
  // companies). Canonical *_company_id columns are added via self-heal
  // below; backfill seeds a default __primary__ company per tenant.
  const erpTables = [
    `CREATE TABLE IF NOT EXISTS erp_companies (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), external_id TEXT, source_system TEXT NOT NULL DEFAULT 'manual', code TEXT, name TEXT NOT NULL, legal_name TEXT, currency TEXT DEFAULT 'ZAR', country TEXT DEFAULT 'ZA', fiscal_year_start TEXT, tax_id TEXT, is_primary INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS erp_customers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), company_id TEXT REFERENCES erp_companies(id), external_id TEXT, source_system TEXT NOT NULL DEFAULT 'manual', name TEXT NOT NULL, trading_name TEXT, registration_number TEXT, vat_number TEXT, customer_group TEXT, credit_limit REAL DEFAULT 0, credit_balance REAL DEFAULT 0, payment_terms TEXT DEFAULT 'Net 30', currency TEXT DEFAULT 'ZAR', address_line1 TEXT, address_line2 TEXT, city TEXT, province TEXT, postal_code TEXT, country TEXT DEFAULT 'ZA', contact_name TEXT, contact_email TEXT, contact_phone TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS erp_suppliers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), external_id TEXT, source_system TEXT NOT NULL DEFAULT 'manual', name TEXT NOT NULL, trading_name TEXT, registration_number TEXT, vat_number TEXT, supplier_group TEXT, payment_terms TEXT DEFAULT 'Net 30', currency TEXT DEFAULT 'ZAR', address_line1 TEXT, city TEXT, province TEXT, postal_code TEXT, country TEXT DEFAULT 'ZA', contact_name TEXT, contact_email TEXT, contact_phone TEXT, bank_name TEXT, bank_account TEXT, bank_branch_code TEXT, status TEXT NOT NULL DEFAULT 'active', risk_score REAL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS erp_products (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), external_id TEXT, source_system TEXT NOT NULL DEFAULT 'manual', sku TEXT NOT NULL, name TEXT NOT NULL, description TEXT, category TEXT, product_group TEXT, uom TEXT DEFAULT 'EA', cost_price REAL DEFAULT 0, selling_price REAL DEFAULT 0, vat_rate REAL DEFAULT 15, stock_on_hand REAL DEFAULT 0, reorder_level REAL DEFAULT 0, reorder_quantity REAL DEFAULT 0, warehouse TEXT, weight_kg REAL, is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS erp_invoices (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), external_id TEXT, source_system TEXT NOT NULL DEFAULT 'manual', invoice_number TEXT NOT NULL, customer_id TEXT REFERENCES erp_customers(id), customer_name TEXT, invoice_date TEXT NOT NULL, due_date TEXT, subtotal REAL NOT NULL DEFAULT 0, vat_amount REAL DEFAULT 0, total REAL NOT NULL DEFAULT 0, amount_paid REAL DEFAULT 0, amount_due REAL DEFAULT 0, currency TEXT DEFAULT 'ZAR', status TEXT NOT NULL DEFAULT 'draft', payment_status TEXT DEFAULT 'unpaid', reference TEXT, notes TEXT, line_items TEXT DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS erp_purchase_orders (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), external_id TEXT, source_system TEXT NOT NULL DEFAULT 'manual', po_number TEXT NOT NULL, supplier_id TEXT REFERENCES erp_suppliers(id), supplier_name TEXT, order_date TEXT NOT NULL, delivery_date TEXT, subtotal REAL NOT NULL DEFAULT 0, vat_amount REAL DEFAULT 0, total REAL NOT NULL DEFAULT 0, currency TEXT DEFAULT 'ZAR', status TEXT NOT NULL DEFAULT 'draft', delivery_status TEXT DEFAULT 'pending', reference TEXT, line_items TEXT DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS erp_gl_accounts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), external_id TEXT, source_system TEXT NOT NULL DEFAULT 'manual', account_code TEXT NOT NULL, account_name TEXT NOT NULL, account_type TEXT NOT NULL, account_class TEXT, parent_account TEXT, currency TEXT DEFAULT 'ZAR', balance REAL DEFAULT 0, ytd_debit REAL DEFAULT 0, ytd_credit REAL DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS erp_journal_entries (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), external_id TEXT, source_system TEXT NOT NULL DEFAULT 'manual', journal_number TEXT NOT NULL, journal_date TEXT NOT NULL, description TEXT, total_debit REAL NOT NULL DEFAULT 0, total_credit REAL NOT NULL DEFAULT 0, status TEXT DEFAULT 'posted', posted_by TEXT, lines TEXT DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS erp_employees (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), external_id TEXT, source_system TEXT NOT NULL DEFAULT 'manual', employee_number TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT, id_number TEXT, department TEXT, position TEXT, cost_centre TEXT, hire_date TEXT, termination_date TEXT, employment_type TEXT DEFAULT 'permanent', salary_frequency TEXT DEFAULT 'monthly', gross_salary REAL DEFAULT 0, tax_number TEXT, bank_name TEXT, bank_account TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS erp_bank_transactions (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), external_id TEXT, source_system TEXT NOT NULL DEFAULT 'manual', bank_account TEXT NOT NULL, transaction_date TEXT NOT NULL, description TEXT, reference TEXT, debit REAL DEFAULT 0, credit REAL DEFAULT 0, balance REAL DEFAULT 0, reconciled INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS erp_tax_entries (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), source_system TEXT NOT NULL DEFAULT 'manual', tax_period TEXT NOT NULL, tax_type TEXT NOT NULL DEFAULT 'VAT', output_vat REAL DEFAULT 0, input_vat REAL DEFAULT 0, net_vat REAL DEFAULT 0, status TEXT DEFAULT 'draft', submitted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  ];

  // ── SAP Native Tables (actual SAP table structures for realistic demo) ──
  const sapTables = [
    // FI - Accounting Document Header (BKPF)
    `CREATE TABLE IF NOT EXISTS sap_bkpf (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), BUKRS TEXT NOT NULL, BELNR TEXT NOT NULL, GJAHR TEXT NOT NULL, BLART TEXT, BUDAT TEXT, BLDAT TEXT, MONAT TEXT, CPUDT TEXT, XBLNR TEXT, BSTAT TEXT, WAERS TEXT DEFAULT 'ZAR', KURSF REAL DEFAULT 1, USNAM TEXT, TCODE TEXT, STBLG TEXT, AWTYP TEXT, AWKEY TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // FI - Accounting Document Line Item (BSEG)
    `CREATE TABLE IF NOT EXISTS sap_bseg (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), BUKRS TEXT NOT NULL, BELNR TEXT NOT NULL, GJAHR TEXT NOT NULL, BUZEI TEXT NOT NULL, BSCHL TEXT, KOART TEXT, KONTO TEXT, DMBTR REAL DEFAULT 0, WRBTR REAL DEFAULT 0, MWSKZ TEXT, MWSTS REAL DEFAULT 0, ZUONR TEXT, SGTXT TEXT, LIFNR TEXT, KUNNR TEXT, MATNR TEXT, EBELN TEXT, EBELP TEXT, SHKZG TEXT, AUGDT TEXT, AUGBL TEXT, ZFBDT TEXT, ZBD1T INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // FI - Customer Open Items (BSID)
    `CREATE TABLE IF NOT EXISTS sap_bsid (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), BUKRS TEXT NOT NULL, KUNNR TEXT NOT NULL, UMSKS TEXT, UMSKZ TEXT, AUGDT TEXT, AUGBL TEXT, ZUONR TEXT, GJAHR TEXT, BELNR TEXT, BUZEI TEXT, BUDAT TEXT, BLDAT TEXT, WAERS TEXT DEFAULT 'ZAR', SHKZG TEXT, DMBTR REAL DEFAULT 0, WRBTR REAL DEFAULT 0, SGTXT TEXT, ZFBDT TEXT, ZBD1T INTEGER DEFAULT 0, REBZG TEXT, XBLNR TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // FI - Vendor Open Items (BSIK)
    `CREATE TABLE IF NOT EXISTS sap_bsik (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), BUKRS TEXT NOT NULL, LIFNR TEXT NOT NULL, UMSKS TEXT, UMSKZ TEXT, AUGDT TEXT, AUGBL TEXT, ZUONR TEXT, GJAHR TEXT, BELNR TEXT, BUZEI TEXT, BUDAT TEXT, BLDAT TEXT, WAERS TEXT DEFAULT 'ZAR', SHKZG TEXT, DMBTR REAL DEFAULT 0, WRBTR REAL DEFAULT 0, SGTXT TEXT, ZFBDT TEXT, ZBD1T INTEGER DEFAULT 0, REBZG TEXT, EBELN TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // FI - Bank Statement Line Items (FEBEP)
    `CREATE TABLE IF NOT EXISTS sap_febep (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), BUKRS TEXT NOT NULL, HESSION TEXT, AESSION TEXT, VALUT TEXT, KWBTR REAL DEFAULT 0, WRBTR REAL DEFAULT 0, WAERS TEXT DEFAULT 'ZAR', VWEZW TEXT, BVTYP TEXT, ESESSION TEXT, GSESSION TEXT, ZUESSION TEXT, XBLNR TEXT, SGTXT TEXT, AUESSION TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // MM - Purchasing Document Header (EKKO)
    `CREATE TABLE IF NOT EXISTS sap_ekko (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), EBELN TEXT NOT NULL, BUKRS TEXT NOT NULL, BSTYP TEXT DEFAULT 'F', BSART TEXT DEFAULT 'NB', LOEKZ TEXT, STATU TEXT, AEDAT TEXT, ERNAM TEXT, LIFNR TEXT, EKGRP TEXT, WAERS TEXT DEFAULT 'ZAR', BEDAT TEXT, KDATB TEXT, KDATE TEXT, MEMORY TEXT, RLWRT REAL DEFAULT 0, ZTERM TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // MM - Purchasing Document Item (EKPO)
    `CREATE TABLE IF NOT EXISTS sap_ekpo (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), EBELN TEXT NOT NULL, EBELP TEXT NOT NULL, LOEKZ TEXT, MATNR TEXT, TXZ01 TEXT, MENGE REAL DEFAULT 0, MEINS TEXT DEFAULT 'EA', NETPR REAL DEFAULT 0, PEINH REAL DEFAULT 1, NETWR REAL DEFAULT 0, BPRME TEXT, MATKL TEXT, WERKS TEXT, LGORT TEXT, MWSKZ TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // MM - History per Purchasing Document (EKBE)
    `CREATE TABLE IF NOT EXISTS sap_ekbe (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), EBELN TEXT NOT NULL, EBELP TEXT NOT NULL, ZEESSION TEXT, VGABE TEXT, GJAHR TEXT, BELNR TEXT, BUZEI TEXT, BEWTP TEXT, MENGE REAL DEFAULT 0, WRBTR REAL DEFAULT 0, WAERS TEXT DEFAULT 'ZAR', AREWR REAL DEFAULT 0, BUDAT TEXT, XBLNR TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // MM - Storage Location Data for Material (MARD)
    `CREATE TABLE IF NOT EXISTS sap_mard (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), MATNR TEXT NOT NULL, WERKS TEXT NOT NULL, LGORT TEXT NOT NULL, LABST REAL DEFAULT 0, INSME REAL DEFAULT 0, SPEME REAL DEFAULT 0, EINME REAL DEFAULT 0, RETME REAL DEFAULT 0, UMLME REAL DEFAULT 0, LFGJA TEXT, LFMON TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // SD - Sales Document Header (VBAK)
    `CREATE TABLE IF NOT EXISTS sap_vbak (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), VBELN TEXT NOT NULL, AUART TEXT DEFAULT 'TA', VKORG TEXT, VTWEG TEXT, SPART TEXT, KUNNR TEXT, BSTNK TEXT, AUDAT TEXT, VDATU TEXT, GUEBG TEXT, NETWR REAL DEFAULT 0, WAERK TEXT DEFAULT 'ZAR', VBTYP TEXT DEFAULT 'C', ABSTK TEXT, ERNAM TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // SD - Sales Document Item (VBAP)
    `CREATE TABLE IF NOT EXISTS sap_vbap (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), VBELN TEXT NOT NULL, POSNR TEXT NOT NULL, MATNR TEXT, ARKTX TEXT, KWMENG REAL DEFAULT 0, VRKME TEXT DEFAULT 'EA', NETPR REAL DEFAULT 0, NETWR REAL DEFAULT 0, WAERK TEXT DEFAULT 'ZAR', WERKS TEXT, MATKL TEXT, ABGRU TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // SD - Billing Document Header (VBRK)
    `CREATE TABLE IF NOT EXISTS sap_vbrk (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), VBELN TEXT NOT NULL, FKART TEXT DEFAULT 'F2', FKTYP TEXT, VKORG TEXT, VTWEG TEXT, SPART TEXT, KUNAG TEXT, KUNRG TEXT, FKDAT TEXT, RFBSK TEXT, NETWR REAL DEFAULT 0, MWSBK REAL DEFAULT 0, WAERK TEXT DEFAULT 'ZAR', BUKRS TEXT, XBLNR TEXT, ERNAM TEXT, FKSTO TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // SD - Billing Document Item (VBRP)
    `CREATE TABLE IF NOT EXISTS sap_vbrp (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), VBELN TEXT NOT NULL, POSNR TEXT NOT NULL, FKIMG REAL DEFAULT 0, VRKME TEXT DEFAULT 'EA', NETWR REAL DEFAULT 0, MWSBP REAL DEFAULT 0, MATNR TEXT, ARKTX TEXT, AUBEL TEXT, AUPOS TEXT, WERKS TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Vendor Master - General Data (LFA1)
    `CREATE TABLE IF NOT EXISTS sap_lfa1 (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), LIFNR TEXT NOT NULL, LAND1 TEXT DEFAULT 'ZA', NAME1 TEXT NOT NULL, NAME2 TEXT, ORT01 TEXT, PSTLZ TEXT, REGIO TEXT, STCD1 TEXT, STCD2 TEXT, TELF1 TEXT, TELFX TEXT, ADRNR TEXT, KTOKK TEXT, LOEVM TEXT, SPERR TEXT, SPERM TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Vendor Master - Company Code Data (LFB1)
    `CREATE TABLE IF NOT EXISTS sap_lfb1 (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), LIFNR TEXT NOT NULL, BUKRS TEXT NOT NULL, AKONT TEXT, ZTERM TEXT, ZWELS TEXT, REPRF TEXT, LNRZB TEXT, HBKID TEXT, ZAHLS TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Customer Master - General Data (KNA1)
    `CREATE TABLE IF NOT EXISTS sap_kna1 (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), KUNNR TEXT NOT NULL, LAND1 TEXT DEFAULT 'ZA', NAME1 TEXT NOT NULL, NAME2 TEXT, ORT01 TEXT, PSTLZ TEXT, REGIO TEXT, STCD1 TEXT, TELF1 TEXT, TELFX TEXT, KTOKD TEXT, LOEVM TEXT, SPERR TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Customer Master - Company Code Data (KNB1)
    `CREATE TABLE IF NOT EXISTS sap_knb1 (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), KUNNR TEXT NOT NULL, BUKRS TEXT NOT NULL, AKONT TEXT, ZTERM TEXT, KLIMK REAL DEFAULT 0, CTLPC TEXT, KNRZE TEXT, ZAMIM TEXT, ZAMIV TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Physical inventory document (for warehouse count comparison)
    `CREATE TABLE IF NOT EXISTS sap_iseg (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), IBLNR TEXT NOT NULL, GJAHR TEXT NOT NULL, ZEESSION TEXT NOT NULL, MATNR TEXT NOT NULL, WERKS TEXT, LGORT TEXT, MENGE REAL DEFAULT 0, MEINS TEXT DEFAULT 'EA', BUCHM REAL DEFAULT 0, XNULL TEXT, XDIFF TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  ];

  for (const tbl of sapTables) {
    try {
      await db.prepare(tbl).run();
      result.tablesCreated++;
    } catch (err) {
      result.errors.push(`SAP table: ${(err as Error).message}`);
    }
  }

  // ── SAP Table Indexes ──
  const sapIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_sap_bkpf_tenant ON sap_bkpf(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_bkpf_doc ON sap_bkpf(tenant_id, BUKRS, BELNR, GJAHR)',
    'CREATE INDEX IF NOT EXISTS idx_sap_bseg_tenant ON sap_bseg(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_bseg_doc ON sap_bseg(tenant_id, BUKRS, BELNR, GJAHR)',
    'CREATE INDEX IF NOT EXISTS idx_sap_bseg_vendor ON sap_bseg(tenant_id, LIFNR)',
    'CREATE INDEX IF NOT EXISTS idx_sap_bseg_customer ON sap_bseg(tenant_id, KUNNR)',
    'CREATE INDEX IF NOT EXISTS idx_sap_bsid_tenant ON sap_bsid(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_bsid_customer ON sap_bsid(tenant_id, KUNNR)',
    'CREATE INDEX IF NOT EXISTS idx_sap_bsik_tenant ON sap_bsik(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_bsik_vendor ON sap_bsik(tenant_id, LIFNR)',
    'CREATE INDEX IF NOT EXISTS idx_sap_febep_tenant ON sap_febep(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_ekko_tenant ON sap_ekko(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_ekko_po ON sap_ekko(tenant_id, EBELN)',
    'CREATE INDEX IF NOT EXISTS idx_sap_ekpo_tenant ON sap_ekpo(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_ekpo_po ON sap_ekpo(tenant_id, EBELN)',
    'CREATE INDEX IF NOT EXISTS idx_sap_ekbe_tenant ON sap_ekbe(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_ekbe_po ON sap_ekbe(tenant_id, EBELN)',
    'CREATE INDEX IF NOT EXISTS idx_sap_mard_tenant ON sap_mard(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_mard_mat ON sap_mard(tenant_id, MATNR, WERKS)',
    'CREATE INDEX IF NOT EXISTS idx_sap_vbak_tenant ON sap_vbak(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_vbak_order ON sap_vbak(tenant_id, VBELN)',
    'CREATE INDEX IF NOT EXISTS idx_sap_vbap_tenant ON sap_vbap(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_vbrk_tenant ON sap_vbrk(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_vbrk_billing ON sap_vbrk(tenant_id, VBELN)',
    'CREATE INDEX IF NOT EXISTS idx_sap_vbrp_tenant ON sap_vbrp(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_lfa1_tenant ON sap_lfa1(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_lfa1_vendor ON sap_lfa1(tenant_id, LIFNR)',
    'CREATE INDEX IF NOT EXISTS idx_sap_lfb1_tenant ON sap_lfb1(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_kna1_tenant ON sap_kna1(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_kna1_customer ON sap_kna1(tenant_id, KUNNR)',
    'CREATE INDEX IF NOT EXISTS idx_sap_knb1_tenant ON sap_knb1(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_iseg_tenant ON sap_iseg(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sap_iseg_mat ON sap_iseg(tenant_id, MATNR)',
  ];

  for (const idx of sapIndexes) {
    try {
      await db.prepare(idx).run();
      result.indexesCreated++;
    } catch (err) {
      result.errors.push(`SAP index: ${(err as Error).message}`);
    }
  }

  // ── Odoo Native Tables (Odoo 17/18 field names) ──
  const odooTables = [
    // Accounting: Journal Entries / Invoices (account.move)
    `CREATE TABLE IF NOT EXISTS odoo_account_move (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, move_type TEXT NOT NULL DEFAULT 'entry', partner_id TEXT, partner_name TEXT, invoice_date TEXT, date TEXT, invoice_date_due TEXT, ref TEXT, narration TEXT, state TEXT DEFAULT 'draft', amount_untaxed REAL DEFAULT 0, amount_tax REAL DEFAULT 0, amount_total REAL DEFAULT 0, amount_residual REAL DEFAULT 0, amount_paid REAL DEFAULT 0, currency_id TEXT DEFAULT 'ZAR', journal_id TEXT, company_id TEXT, payment_state TEXT DEFAULT 'not_paid', invoice_origin TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Accounting: Journal Items (account.move.line)
    `CREATE TABLE IF NOT EXISTS odoo_account_move_line (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), move_id TEXT NOT NULL, move_name TEXT, account_id TEXT, account_name TEXT, partner_id TEXT, name TEXT, debit REAL DEFAULT 0, credit REAL DEFAULT 0, balance REAL DEFAULT 0, amount_currency REAL DEFAULT 0, currency_id TEXT DEFAULT 'ZAR', date_maturity TEXT, date TEXT, reconciled INTEGER DEFAULT 0, tax_line_id TEXT, product_id TEXT, quantity REAL DEFAULT 0, price_unit REAL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Partners: Customers & Suppliers (res.partner)
    `CREATE TABLE IF NOT EXISTS odoo_res_partner (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, display_name TEXT, partner_type TEXT DEFAULT 'contact', is_company INTEGER DEFAULT 0, supplier_rank INTEGER DEFAULT 0, customer_rank INTEGER DEFAULT 0, vat TEXT, company_registry TEXT, street TEXT, city TEXT, state_id TEXT, zip TEXT, country_id TEXT DEFAULT 'ZA', phone TEXT, email TEXT, website TEXT, property_payment_term_id TEXT, property_account_receivable_id TEXT, property_account_payable_id TEXT, credit_limit REAL DEFAULT 0, active INTEGER DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Products (product.product)
    `CREATE TABLE IF NOT EXISTS odoo_product_product (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), default_code TEXT, name TEXT NOT NULL, product_tmpl_id TEXT, barcode TEXT, type TEXT DEFAULT 'product', categ_id TEXT, categ_name TEXT, list_price REAL DEFAULT 0, standard_price REAL DEFAULT 0, uom_id TEXT DEFAULT 'Units', weight REAL DEFAULT 0, volume REAL DEFAULT 0, active INTEGER DEFAULT 1, qty_available REAL DEFAULT 0, virtual_available REAL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Inventory: Stock Quantities (stock.quant)
    `CREATE TABLE IF NOT EXISTS odoo_stock_quant (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), product_id TEXT NOT NULL, product_name TEXT, location_id TEXT NOT NULL, location_name TEXT, lot_id TEXT, package_id TEXT, quantity REAL DEFAULT 0, reserved_quantity REAL DEFAULT 0, inventory_date TEXT, inventory_quantity REAL DEFAULT 0, inventory_diff_quantity REAL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Purchasing: Purchase Orders (purchase.order)
    `CREATE TABLE IF NOT EXISTS odoo_purchase_order (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, partner_id TEXT, partner_name TEXT, date_order TEXT, date_planned TEXT, date_approve TEXT, origin TEXT, state TEXT DEFAULT 'draft', amount_untaxed REAL DEFAULT 0, amount_tax REAL DEFAULT 0, amount_total REAL DEFAULT 0, currency_id TEXT DEFAULT 'ZAR', invoice_status TEXT, receipt_status TEXT, company_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Purchasing: PO Lines (purchase.order.line)
    `CREATE TABLE IF NOT EXISTS odoo_purchase_order_line (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), order_id TEXT NOT NULL, product_id TEXT, product_name TEXT, product_qty REAL DEFAULT 0, qty_received REAL DEFAULT 0, qty_invoiced REAL DEFAULT 0, product_uom TEXT DEFAULT 'Units', price_unit REAL DEFAULT 0, price_subtotal REAL DEFAULT 0, price_tax REAL DEFAULT 0, price_total REAL DEFAULT 0, date_planned TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Sales: Sale Orders (sale.order)
    `CREATE TABLE IF NOT EXISTS odoo_sale_order (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, partner_id TEXT, partner_name TEXT, date_order TEXT, commitment_date TEXT, validity_date TEXT, origin TEXT, client_order_ref TEXT, state TEXT DEFAULT 'draft', amount_untaxed REAL DEFAULT 0, amount_tax REAL DEFAULT 0, amount_total REAL DEFAULT 0, currency_id TEXT DEFAULT 'ZAR', invoice_status TEXT, delivery_status TEXT, company_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Sales: SO Lines (sale.order.line)
    `CREATE TABLE IF NOT EXISTS odoo_sale_order_line (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), order_id TEXT NOT NULL, product_id TEXT, product_name TEXT, product_uom_qty REAL DEFAULT 0, qty_delivered REAL DEFAULT 0, qty_invoiced REAL DEFAULT 0, product_uom TEXT DEFAULT 'Units', price_unit REAL DEFAULT 0, price_subtotal REAL DEFAULT 0, price_tax REAL DEFAULT 0, price_total REAL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Bank Statement Lines (account.bank.statement.line)
    `CREATE TABLE IF NOT EXISTS odoo_account_bank_statement_line (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), statement_id TEXT, journal_id TEXT, date TEXT, payment_ref TEXT, partner_id TEXT, partner_name TEXT, amount REAL DEFAULT 0, amount_currency REAL DEFAULT 0, currency_id TEXT DEFAULT 'ZAR', account_number TEXT, narration TEXT, is_reconciled INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Payments (account.payment)
    `CREATE TABLE IF NOT EXISTS odoo_account_payment (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT, payment_type TEXT DEFAULT 'inbound', partner_type TEXT, partner_id TEXT, partner_name TEXT, amount REAL DEFAULT 0, currency_id TEXT DEFAULT 'ZAR', date TEXT, ref TEXT, journal_id TEXT, payment_method_id TEXT, state TEXT DEFAULT 'draft', reconciled_invoice_ids TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  ];

  for (const tbl of odooTables) {
    try { await db.prepare(tbl).run(); result.tablesCreated++; }
    catch (err) { result.errors.push(`Odoo table: ${(err as Error).message}`); }
  }

  const odooIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_odoo_move_tenant ON odoo_account_move(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_odoo_move_type ON odoo_account_move(tenant_id, move_type)',
    'CREATE INDEX IF NOT EXISTS idx_odoo_move_line_tenant ON odoo_account_move_line(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_odoo_move_line_move ON odoo_account_move_line(tenant_id, move_id)',
    'CREATE INDEX IF NOT EXISTS idx_odoo_partner_tenant ON odoo_res_partner(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_odoo_product_tenant ON odoo_product_product(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_odoo_quant_tenant ON odoo_stock_quant(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_odoo_quant_product ON odoo_stock_quant(tenant_id, product_id)',
    'CREATE INDEX IF NOT EXISTS idx_odoo_po_tenant ON odoo_purchase_order(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_odoo_po_line_tenant ON odoo_purchase_order_line(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_odoo_so_tenant ON odoo_sale_order(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_odoo_so_line_tenant ON odoo_sale_order_line(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_odoo_bank_line_tenant ON odoo_account_bank_statement_line(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_odoo_payment_tenant ON odoo_account_payment(tenant_id)',
  ];

  for (const idx of odooIndexes) {
    try { await db.prepare(idx).run(); result.indexesCreated++; }
    catch (err) { result.errors.push(`Odoo index: ${(err as Error).message}`); }
  }

  // ── Sage Native Tables (Sage 50/200/300 field names) ──
  const sageTables = [
    // Sales Ledger: Customer Accounts
    `CREATE TABLE IF NOT EXISTS sage_customer (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), AccountReference TEXT NOT NULL, CompanyName TEXT NOT NULL, ContactName TEXT, AddressLine1 TEXT, AddressLine2 TEXT, City TEXT, County TEXT, Postcode TEXT, Country TEXT DEFAULT 'ZA', TelephoneNumber TEXT, FaxNumber TEXT, EmailAddress TEXT, VATRegistrationNumber TEXT, CreditLimit REAL DEFAULT 0, Balance REAL DEFAULT 0, TermsAgreed INTEGER DEFAULT 30, AccountType TEXT DEFAULT 'Customer', NominalCode TEXT, CurrencyCode TEXT DEFAULT 'ZAR', AccountStatus TEXT DEFAULT 'Active', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Purchase Ledger: Supplier Accounts
    `CREATE TABLE IF NOT EXISTS sage_supplier (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), AccountReference TEXT NOT NULL, CompanyName TEXT NOT NULL, ContactName TEXT, AddressLine1 TEXT, City TEXT, County TEXT, Postcode TEXT, Country TEXT DEFAULT 'ZA', TelephoneNumber TEXT, EmailAddress TEXT, VATRegistrationNumber TEXT, CreditLimit REAL DEFAULT 0, Balance REAL DEFAULT 0, TermsAgreed INTEGER DEFAULT 30, NominalCode TEXT, CurrencyCode TEXT DEFAULT 'ZAR', BankName TEXT, BankAccountNumber TEXT, BankSortCode TEXT, AccountStatus TEXT DEFAULT 'Active', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Nominal Ledger: GL Accounts
    `CREATE TABLE IF NOT EXISTS sage_nominal_ledger (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), NominalCode TEXT NOT NULL, NominalName TEXT NOT NULL, NominalType TEXT DEFAULT 'Profit and Loss', CategoryCode TEXT, Balance REAL DEFAULT 0, BudgetBalance REAL DEFAULT 0, PriorYearBalance REAL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Sales Invoices
    `CREATE TABLE IF NOT EXISTS sage_sales_invoice (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), InvoiceNumber TEXT NOT NULL, AccountReference TEXT, CustomerName TEXT, InvoiceDate TEXT, DueDate TEXT, NetAmount REAL DEFAULT 0, TaxAmount REAL DEFAULT 0, GrossAmount REAL DEFAULT 0, AmountPaid REAL DEFAULT 0, AmountOutstanding REAL DEFAULT 0, TaxCode TEXT, NominalCode TEXT, Reference TEXT, Details TEXT, Status TEXT DEFAULT 'Outstanding', CurrencyCode TEXT DEFAULT 'ZAR', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Purchase Invoices
    `CREATE TABLE IF NOT EXISTS sage_purchase_invoice (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), InvoiceNumber TEXT NOT NULL, AccountReference TEXT, SupplierName TEXT, InvoiceDate TEXT, DueDate TEXT, NetAmount REAL DEFAULT 0, TaxAmount REAL DEFAULT 0, GrossAmount REAL DEFAULT 0, AmountPaid REAL DEFAULT 0, AmountOutstanding REAL DEFAULT 0, TaxCode TEXT, NominalCode TEXT, Reference TEXT, Details TEXT, Status TEXT DEFAULT 'Outstanding', CurrencyCode TEXT DEFAULT 'ZAR', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Stock Items
    `CREATE TABLE IF NOT EXISTS sage_stock_item (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), ProductCode TEXT NOT NULL, Description TEXT NOT NULL, Category TEXT, SalePrice REAL DEFAULT 0, CostPrice REAL DEFAULT 0, QuantityInStock REAL DEFAULT 0, ReorderLevel REAL DEFAULT 0, ReorderQuantity REAL DEFAULT 0, UnitOfMeasure TEXT DEFAULT 'Each', TaxCode TEXT, NominalCode TEXT, Location TEXT, BinNumber TEXT, WeightKg REAL DEFAULT 0, InactiveFlag INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Bank Transactions
    `CREATE TABLE IF NOT EXISTS sage_bank_transaction (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), BankAccountReference TEXT NOT NULL, TransactionDate TEXT NOT NULL, TransactionType TEXT, Reference TEXT, Details TEXT, NetAmount REAL DEFAULT 0, TaxAmount REAL DEFAULT 0, GrossAmount REAL DEFAULT 0, PaymentMethod TEXT, NominalCode TEXT, Reconciled INTEGER DEFAULT 0, ExchangeRate REAL DEFAULT 1, CurrencyCode TEXT DEFAULT 'ZAR', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Purchase Orders
    `CREATE TABLE IF NOT EXISTS sage_purchase_order (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), OrderNumber TEXT NOT NULL, AccountReference TEXT, SupplierName TEXT, OrderDate TEXT, DeliveryDate TEXT, NetAmount REAL DEFAULT 0, TaxAmount REAL DEFAULT 0, GrossAmount REAL DEFAULT 0, Status TEXT DEFAULT 'Open', DeliveryStatus TEXT DEFAULT 'Pending', Reference TEXT, CurrencyCode TEXT DEFAULT 'ZAR', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Goods Received Notes
    `CREATE TABLE IF NOT EXISTS sage_goods_received (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), GRNNumber TEXT NOT NULL, OrderNumber TEXT, SupplierName TEXT, ReceivedDate TEXT, ProductCode TEXT, Description TEXT, QuantityOrdered REAL DEFAULT 0, QuantityReceived REAL DEFAULT 0, UnitCost REAL DEFAULT 0, TotalCost REAL DEFAULT 0, Status TEXT DEFAULT 'Complete', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  ];

  for (const tbl of sageTables) {
    try { await db.prepare(tbl).run(); result.tablesCreated++; }
    catch (err) { result.errors.push(`Sage table: ${(err as Error).message}`); }
  }

  const sageIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_sage_customer_tenant ON sage_customer(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sage_supplier_tenant ON sage_supplier(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sage_nominal_tenant ON sage_nominal_ledger(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sage_si_tenant ON sage_sales_invoice(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sage_pi_tenant ON sage_purchase_invoice(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sage_stock_tenant ON sage_stock_item(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sage_bank_tenant ON sage_bank_transaction(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sage_po_tenant ON sage_purchase_order(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sage_grn_tenant ON sage_goods_received(tenant_id)',
  ];

  for (const idx of sageIndexes) {
    try { await db.prepare(idx).run(); result.indexesCreated++; }
    catch (err) { result.errors.push(`Sage index: ${(err as Error).message}`); }
  }

  // ── Xero Native Tables (Xero API field names) ──
  const xeroTables = [
    // Invoices (Sales & Purchase)
    `CREATE TABLE IF NOT EXISTS xero_invoice (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), InvoiceID TEXT, InvoiceNumber TEXT NOT NULL, Type TEXT DEFAULT 'ACCREC', Reference TEXT, ContactID TEXT, ContactName TEXT, Date TEXT, DueDate TEXT, Status TEXT DEFAULT 'DRAFT', LineAmountTypes TEXT DEFAULT 'Exclusive', SubTotal REAL DEFAULT 0, TotalTax REAL DEFAULT 0, Total REAL DEFAULT 0, AmountDue REAL DEFAULT 0, AmountPaid REAL DEFAULT 0, AmountCredited REAL DEFAULT 0, CurrencyCode TEXT DEFAULT 'ZAR', CurrencyRate REAL DEFAULT 1, SentToContact INTEGER DEFAULT 0, HasAttachments INTEGER DEFAULT 0, Payments TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Contacts (Customers & Suppliers)
    `CREATE TABLE IF NOT EXISTS xero_contact (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), ContactID TEXT, ContactNumber TEXT, ContactStatus TEXT DEFAULT 'ACTIVE', Name TEXT NOT NULL, FirstName TEXT, LastName TEXT, EmailAddress TEXT, IsSupplier INTEGER DEFAULT 0, IsCustomer INTEGER DEFAULT 0, TaxNumber TEXT, AccountsReceivableTaxType TEXT, AccountsPayableTaxType TEXT, DefaultCurrency TEXT DEFAULT 'ZAR', Phone TEXT, Fax TEXT, AddressLine1 TEXT, City TEXT, Region TEXT, PostalCode TEXT, Country TEXT DEFAULT 'ZA', BankAccountDetails TEXT, Balances_AccountsReceivable_Outstanding REAL DEFAULT 0, Balances_AccountsPayable_Outstanding REAL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Bank Transactions
    `CREATE TABLE IF NOT EXISTS xero_bank_transaction (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), BankTransactionID TEXT, Type TEXT DEFAULT 'SPEND', ContactID TEXT, ContactName TEXT, BankAccountID TEXT, BankAccountName TEXT, Date TEXT, Reference TEXT, IsReconciled INTEGER DEFAULT 0, Status TEXT DEFAULT 'AUTHORISED', SubTotal REAL DEFAULT 0, TotalTax REAL DEFAULT 0, Total REAL DEFAULT 0, CurrencyCode TEXT DEFAULT 'ZAR', LineItems TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Payments
    `CREATE TABLE IF NOT EXISTS xero_payment (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), PaymentID TEXT, PaymentType TEXT DEFAULT 'ACCRECPAYMENT', InvoiceID TEXT, InvoiceNumber TEXT, Date TEXT, Amount REAL DEFAULT 0, CurrencyRate REAL DEFAULT 1, Reference TEXT, Status TEXT DEFAULT 'AUTHORISED', BankAccountID TEXT, BankAccountName TEXT, AccountID TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Items (Products)
    `CREATE TABLE IF NOT EXISTS xero_item (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), ItemID TEXT, Code TEXT NOT NULL, Name TEXT NOT NULL, Description TEXT, PurchaseDescription TEXT, PurchaseUnitPrice REAL DEFAULT 0, SalesUnitPrice REAL DEFAULT 0, QuantityOnHand REAL DEFAULT 0, TotalCostPool REAL DEFAULT 0, IsTrackedAsInventory INTEGER DEFAULT 0, IsSold INTEGER DEFAULT 1, IsPurchased INTEGER DEFAULT 1, SalesAccountCode TEXT, PurchaseAccountCode TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Manual Journals
    `CREATE TABLE IF NOT EXISTS xero_manual_journal (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), ManualJournalID TEXT, Date TEXT, Narration TEXT NOT NULL, Status TEXT DEFAULT 'DRAFT', JournalLines TEXT, ShowOnCashBasisReports INTEGER DEFAULT 1, HasAttachments INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Chart of Accounts
    `CREATE TABLE IF NOT EXISTS xero_account (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), AccountID TEXT, Code TEXT, Name TEXT NOT NULL, Type TEXT NOT NULL, TaxType TEXT, Status TEXT DEFAULT 'ACTIVE', Description TEXT, Class TEXT, BankAccountType TEXT, CurrencyCode TEXT DEFAULT 'ZAR', EnablePaymentsToAccount INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Purchase Orders
    `CREATE TABLE IF NOT EXISTS xero_purchase_order (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), PurchaseOrderID TEXT, PurchaseOrderNumber TEXT NOT NULL, ContactID TEXT, ContactName TEXT, Date TEXT, DeliveryDate TEXT, Reference TEXT, Status TEXT DEFAULT 'DRAFT', SubTotal REAL DEFAULT 0, TotalTax REAL DEFAULT 0, Total REAL DEFAULT 0, CurrencyCode TEXT DEFAULT 'ZAR', SentToContact INTEGER DEFAULT 0, DeliveryAddress TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  ];

  for (const tbl of xeroTables) {
    try { await db.prepare(tbl).run(); result.tablesCreated++; }
    catch (err) { result.errors.push(`Xero table: ${(err as Error).message}`); }
  }

  const xeroIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_xero_invoice_tenant ON xero_invoice(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_xero_invoice_type ON xero_invoice(tenant_id, Type)',
    'CREATE INDEX IF NOT EXISTS idx_xero_contact_tenant ON xero_contact(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_xero_bank_txn_tenant ON xero_bank_transaction(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_xero_payment_tenant ON xero_payment(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_xero_item_tenant ON xero_item(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_xero_journal_tenant ON xero_manual_journal(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_xero_account_tenant ON xero_account(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_xero_po_tenant ON xero_purchase_order(tenant_id)',
  ];

  for (const idx of xeroIndexes) {
    try { await db.prepare(idx).run(); result.indexesCreated++; }
    catch (err) { result.errors.push(`Xero index: ${(err as Error).message}`); }
  }

  // ── QuickBooks Native Tables (QuickBooks Online API field names) ──
  const qbTables = [
    // Invoices (Sales)
    `CREATE TABLE IF NOT EXISTS qb_invoice (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), DocNumber TEXT NOT NULL, TxnDate TEXT, DueDate TEXT, CustomerRef_name TEXT, CustomerRef_value TEXT, TotalAmt REAL DEFAULT 0, Balance REAL DEFAULT 0, Deposit REAL DEFAULT 0, TaxCodeRef TEXT, TxnTaxDetail_TotalTax REAL DEFAULT 0, CurrencyRef TEXT DEFAULT 'ZAR', ExchangeRate REAL DEFAULT 1, ShipDate TEXT, TrackingNum TEXT, PrintStatus TEXT, EmailStatus TEXT, BillEmail TEXT, SalesTermRef TEXT, DepartmentRef TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Bills (Purchase Invoices)
    `CREATE TABLE IF NOT EXISTS qb_bill (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), DocNumber TEXT NOT NULL, TxnDate TEXT, DueDate TEXT, VendorRef_name TEXT, VendorRef_value TEXT, TotalAmt REAL DEFAULT 0, Balance REAL DEFAULT 0, TxnTaxDetail_TotalTax REAL DEFAULT 0, CurrencyRef TEXT DEFAULT 'ZAR', APAccountRef TEXT, SalesTermRef TEXT, DepartmentRef TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Customers
    `CREATE TABLE IF NOT EXISTS qb_customer (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), DisplayName TEXT NOT NULL, CompanyName TEXT, GivenName TEXT, FamilyName TEXT, PrimaryEmailAddr TEXT, PrimaryPhone TEXT, BillAddr_Line1 TEXT, BillAddr_City TEXT, BillAddr_CountrySubDivisionCode TEXT, BillAddr_PostalCode TEXT, BillAddr_Country TEXT DEFAULT 'ZA', TaxExemptionReasonId TEXT, Balance REAL DEFAULT 0, CurrencyRef TEXT DEFAULT 'ZAR', PreferredDeliveryMethod TEXT, PaymentMethodRef TEXT, Active INTEGER DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Vendors (Suppliers)
    `CREATE TABLE IF NOT EXISTS qb_vendor (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), DisplayName TEXT NOT NULL, CompanyName TEXT, GivenName TEXT, FamilyName TEXT, PrimaryEmailAddr TEXT, PrimaryPhone TEXT, BillAddr_Line1 TEXT, BillAddr_City TEXT, BillAddr_Country TEXT DEFAULT 'ZA', TaxIdentifier TEXT, AcctNum TEXT, Balance REAL DEFAULT 0, CurrencyRef TEXT DEFAULT 'ZAR', TermRef TEXT, Active INTEGER DEFAULT 1, Vendor1099 INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Items (Products & Services)
    `CREATE TABLE IF NOT EXISTS qb_item (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), Name TEXT NOT NULL, Sku TEXT, Type TEXT DEFAULT 'Inventory', Description TEXT, PurchaseDesc TEXT, UnitPrice REAL DEFAULT 0, PurchaseCost REAL DEFAULT 0, QtyOnHand REAL DEFAULT 0, ReorderPoint REAL DEFAULT 0, IncomeAccountRef TEXT, ExpenseAccountRef TEXT, AssetAccountRef TEXT, TrackQtyOnHand INTEGER DEFAULT 0, Taxable INTEGER DEFAULT 1, Active INTEGER DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Payments (Received)
    `CREATE TABLE IF NOT EXISTS qb_payment (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), DocNumber TEXT, TxnDate TEXT, CustomerRef_name TEXT, CustomerRef_value TEXT, TotalAmt REAL DEFAULT 0, UnappliedAmt REAL DEFAULT 0, CurrencyRef TEXT DEFAULT 'ZAR', PaymentMethodRef TEXT, DepositToAccountRef TEXT, PaymentRefNum TEXT, LinkedTxns TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Bill Payments
    `CREATE TABLE IF NOT EXISTS qb_bill_payment (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), DocNumber TEXT, TxnDate TEXT, VendorRef_name TEXT, VendorRef_value TEXT, TotalAmt REAL DEFAULT 0, CurrencyRef TEXT DEFAULT 'ZAR', PayType TEXT DEFAULT 'Check', CheckPayment_BankAccountRef TEXT, CreditCardPayment_CCAccountRef TEXT, LinkedTxns TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Journal Entries
    `CREATE TABLE IF NOT EXISTS qb_journal_entry (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), DocNumber TEXT, TxnDate TEXT, TotalAmt REAL DEFAULT 0, Adjustment INTEGER DEFAULT 0, PrivateNote TEXT, CurrencyRef TEXT DEFAULT 'ZAR', ExchangeRate REAL DEFAULT 1, Lines TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Chart of Accounts
    `CREATE TABLE IF NOT EXISTS qb_account (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), Name TEXT NOT NULL, AccountType TEXT NOT NULL, AccountSubType TEXT, AcctNum TEXT, Description TEXT, Classification TEXT, CurrencyRef TEXT DEFAULT 'ZAR', CurrentBalance REAL DEFAULT 0, Active INTEGER DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Purchase Orders
    `CREATE TABLE IF NOT EXISTS qb_purchase_order (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), DocNumber TEXT NOT NULL, TxnDate TEXT, VendorRef_name TEXT, VendorRef_value TEXT, TotalAmt REAL DEFAULT 0, TxnTaxDetail_TotalTax REAL DEFAULT 0, CurrencyRef TEXT DEFAULT 'ZAR', POStatus TEXT DEFAULT 'Open', ShipAddr_Line1 TEXT, DueDate TEXT, Memo TEXT, Lines TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    // Deposits (Bank)
    `CREATE TABLE IF NOT EXISTS qb_deposit (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), TxnDate TEXT, DepositToAccountRef_name TEXT, DepositToAccountRef_value TEXT, TotalAmt REAL DEFAULT 0, CurrencyRef TEXT DEFAULT 'ZAR', PrivateNote TEXT, CashBack_Amount REAL DEFAULT 0, Lines TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  ];

  for (const tbl of qbTables) {
    try { await db.prepare(tbl).run(); result.tablesCreated++; }
    catch (err) { result.errors.push(`QB table: ${(err as Error).message}`); }
  }

  const qbIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_qb_invoice_tenant ON qb_invoice(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_qb_bill_tenant ON qb_bill(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_qb_customer_tenant ON qb_customer(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_qb_vendor_tenant ON qb_vendor(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_qb_item_tenant ON qb_item(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_qb_payment_tenant ON qb_payment(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_qb_bill_payment_tenant ON qb_bill_payment(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_qb_journal_tenant ON qb_journal_entry(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_qb_account_tenant ON qb_account(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_qb_po_tenant ON qb_purchase_order(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_qb_deposit_tenant ON qb_deposit(tenant_id)',
  ];

  for (const idx of qbIndexes) {
    try { await db.prepare(idx).run(); result.indexesCreated++; }
    catch (err) { result.errors.push(`QB index: ${(err as Error).message}`); }
  }

  for (const tbl of erpTables) {
    try {
      await db.prepare(tbl).run();
      result.tablesCreated++;
    } catch (err) {
      result.errors.push(`ERP table: ${(err as Error).message}`);
    }
  }

  // ── ERP Indexes ──
  const erpIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_erp_customers_tenant ON erp_customers(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_suppliers_tenant ON erp_suppliers(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_products_tenant ON erp_products(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_products_sku ON erp_products(tenant_id, sku)',
    'CREATE INDEX IF NOT EXISTS idx_erp_invoices_tenant ON erp_invoices(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_invoices_customer ON erp_invoices(customer_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_invoices_status ON erp_invoices(tenant_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_erp_po_tenant ON erp_purchase_orders(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_po_supplier ON erp_purchase_orders(supplier_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_gl_tenant ON erp_gl_accounts(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_journal_tenant ON erp_journal_entries(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_employees_tenant ON erp_employees(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_bank_tenant ON erp_bank_transactions(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_tax_tenant ON erp_tax_entries(tenant_id)',
    // Canonical UPSERT indexes (tenant_id + external_id + source_system)
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_customers_upsert ON erp_customers(tenant_id, external_id, source_system)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_suppliers_upsert ON erp_suppliers(tenant_id, external_id, source_system)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_products_upsert ON erp_products(tenant_id, external_id, source_system)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_invoices_upsert ON erp_invoices(tenant_id, external_id, source_system)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_po_upsert ON erp_purchase_orders(tenant_id, external_id, source_system)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_gl_upsert ON erp_gl_accounts(tenant_id, external_id, source_system)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_journal_upsert ON erp_journal_entries(tenant_id, external_id, source_system)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_employees_upsert ON erp_employees(tenant_id, external_id, source_system)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_bank_upsert ON erp_bank_transactions(tenant_id, external_id, source_system)',
    // Multi-company indexes — (tenant, company) is the hot-path filter for
    // company-scoped catalyst runs. Separate company-only upsert unique
    // constraint prevents duplicate companies per tenant.
    'CREATE INDEX IF NOT EXISTS idx_erp_companies_tenant ON erp_companies(tenant_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_companies_upsert ON erp_companies(tenant_id, external_id, source_system)',
    'CREATE INDEX IF NOT EXISTS idx_erp_customers_company ON erp_customers(tenant_id, company_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_suppliers_company ON erp_suppliers(tenant_id, company_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_products_company ON erp_products(tenant_id, company_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_invoices_company ON erp_invoices(tenant_id, company_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_po_company ON erp_purchase_orders(tenant_id, company_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_employees_company ON erp_employees(tenant_id, company_id)',
    // v57: schema discovery — lookup by (tenant, connection) for the schema
    // panel; lookup by (tenant, connection, entity) is already covered by the
    // UNIQUE constraint declared inline on erp_connection_schemas.
    'CREATE INDEX IF NOT EXISTS idx_erp_conn_schemas_conn ON erp_connection_schemas(tenant_id, connection_id)',
    // v58: auto-mapper — lookup by (tenant, connection, entity, canonical) is
    // the hot read path used by the resolver on every catalyst extraction.
    'CREATE INDEX IF NOT EXISTS idx_erp_field_mappings_lookup ON erp_field_mappings(tenant_id, connection_id, entity_type, canonical_field, status)',
    // v59: drift events — list-by-tenant for the cron sweep + UI ack.
    'CREATE INDEX IF NOT EXISTS idx_erp_drift_events_tenant ON erp_schema_drift_events(tenant_id, detected_at DESC)',
    // v61: process-profile lookup by (tenant, connection) is the hot path
    // for catalysts that read profile-driven thresholds on every run.
    'CREATE INDEX IF NOT EXISTS idx_erp_process_profiles_lookup ON erp_process_profiles(tenant_id, connection_id)',
    'CREATE INDEX IF NOT EXISTS idx_erp_connection_config_conn ON erp_connection_config(tenant_id, connection_id, namespace)',
  ];

  for (const idx of erpIndexes) {
    try {
      await db.prepare(idx).run();
      result.indexesCreated++;
    } catch (err) {
      // Unique indexes may fail if data has duplicates — non-fatal
      result.errors.push(`ERP index: ${(err as Error).message}`);
    }
  }

  // ── Self-Healing Column Additions ──
  const selfHealColumns: Array<{ table: string; column: string; definition: string }> = [
    { table: 'catalyst_clusters', column: 'sub_catalysts', definition: "TEXT NOT NULL DEFAULT '[]'" },
    // PR H: trial-assessments persist findings_json so the trial results UI
    // can surface them. Additive — old rows default to '[]'.
    { table: 'trial_assessments', column: 'findings_json', definition: "TEXT NOT NULL DEFAULT '[]'" },
    { table: 'trial_assessments', column: 'findings_summary_json', definition: "TEXT NOT NULL DEFAULT '{}'" },
    { table: 'catalyst_actions', column: 'escalation_level', definition: 'TEXT' },
    { table: 'catalyst_actions', column: 'retry_count', definition: 'INTEGER NOT NULL DEFAULT 0' },
    // tenants.industry is intentionally NOT healed here — it is dropped a few
    // hundred lines below in `columnsToDrop`. Healing it first would wastefully
    // re-add the column on every cold start only to drop it again, and
    // misleads readers into thinking the column persists.
    { table: 'tenants', column: 'deployment_model', definition: "TEXT NOT NULL DEFAULT 'saas'" },
    { table: 'tenants', column: 'region', definition: "TEXT NOT NULL DEFAULT 'af-south-1'" },
    { table: 'users', column: 'password_hash', definition: 'TEXT' },
    { table: 'users', column: 'last_login', definition: 'TEXT' },
    { table: 'risk_alerts', column: 'probability', definition: 'REAL' },
    { table: 'risk_alerts', column: 'impact_unit', definition: "TEXT DEFAULT 'ZAR'" },
    { table: 'sso_configs', column: 'auto_provision', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'sso_configs', column: 'default_role', definition: "TEXT NOT NULL DEFAULT 'analyst'" },
    { table: 'sso_configs', column: 'domain_hint', definition: 'TEXT' },
    // OIDC generic provider (Okta, Auth0, Google Workspace, Keycloak) needs
    // a per-tenant client secret since each tenant has its own IdP app.
    // Azure AD uses a shared env var so didn't need this column historically.
    { table: 'sso_configs', column: 'client_secret', definition: 'TEXT' },
    { table: 'notifications', column: 'action_url', definition: 'TEXT' },
    { table: 'notifications', column: 'metadata', definition: 'TEXT' },
    { table: 'notifications', column: 'read', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'erp_connections', column: 'sync_frequency', definition: "TEXT DEFAULT 'realtime'" },
    { table: 'erp_connections', column: 'records_synced', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'erp_connections', column: 'connected_at', definition: 'TEXT' },
    { table: 'documents', column: 'stored_in_r2', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'execution_logs', column: 'duration_ms', definition: 'INTEGER' },
    // Phase 1.1: ERP credential encryption
    { table: 'erp_connections', column: 'encrypted_config', definition: 'TEXT' },
    // Phase 1.3: Email verification
    { table: 'users', column: 'email_verified', definition: 'INTEGER NOT NULL DEFAULT 1' },
    // Phase 1.4: MFA/TOTP support
    { table: 'users', column: 'mfa_enabled', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'users', column: 'mfa_secret', definition: 'TEXT' },
    // v40: Mandatory MFA enforcement for admin roles
    { table: 'users', column: 'mfa_backup_codes', definition: 'TEXT' }, // JSON array of SHA-256 hashed backup codes
    { table: 'users', column: 'mfa_grace_until', definition: 'TEXT' },  // ISO timestamp; null means no active grace period
    // Phase 6.1: Data retention
    { table: 'email_queue', column: 'retry_count', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'email_queue', column: 'max_retries', definition: 'INTEGER NOT NULL DEFAULT 3' },
    // Phase 6.3: API key auth
    { table: 'webhooks', column: 'last_response_code', definition: 'INTEGER' },
    { table: 'webhooks', column: 'last_response_body', definition: 'TEXT' },
    // Phase 4 extras
    { table: 'notifications', column: 'user_id', definition: 'TEXT' },
    { table: 'documents', column: 'folder_path', definition: 'TEXT' },
    { table: 'documents', column: 'tags', definition: 'TEXT' },
    { table: 'documents', column: 'version', definition: 'INTEGER NOT NULL DEFAULT 1' },
    { table: 'risk_alerts', column: 'assigned_to', definition: 'TEXT' },
    { table: 'risk_alerts', column: 'due_date', definition: 'TEXT' },
    { table: 'risk_alerts', column: 'resolution_notes', definition: 'TEXT' },
    { table: 'scenarios', column: 'created_by', definition: 'TEXT' },
    { table: 'anomalies', column: 'assigned_to', definition: 'TEXT' },
    { table: 'anomalies', column: 'resolution_notes', definition: 'TEXT' },
    { table: 'mind_queries', column: 'feedback_rating', definition: 'INTEGER' },
    { table: 'users', column: 'avatar_url', definition: 'TEXT' },
    { table: 'tenants', column: 'logo_url', definition: 'TEXT' },
    { table: 'tenants', column: 'billing_email', definition: 'TEXT' },
    { table: 'tenants', column: 'max_storage_gb', definition: 'INTEGER NOT NULL DEFAULT 10' },
    // Whitelabel — per-tenant branding. Hex color (no #); short display
    // name override that wins over `tenants.name` in the UI when set.
    { table: 'tenants', column: 'brand_primary_color', definition: 'TEXT' },
    { table: 'tenants', column: 'brand_name_override', definition: 'TEXT' },
    // Stripe Checkout session id, persisted on /api/billing/checkout so the
    // webhook can match `checkout.session.completed` events back to the
    // initiating tenant if the metadata field is empty.
    { table: 'billing_checkouts', column: 'stripe_session_id', definition: 'TEXT' },
    { table: 'tenant_entitlements', column: 'api_calls_used', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'tenant_entitlements', column: 'storage_used_gb', definition: 'REAL NOT NULL DEFAULT 0' },
    // Phase 7: HITL user assignment
    { table: 'catalyst_actions', column: 'assigned_to', definition: 'TEXT' },
    { table: 'catalyst_actions', column: 'notification_sent', definition: 'INTEGER NOT NULL DEFAULT 0' },
    // Phase 8: Sub-catalyst HITL permissions
    { table: 'catalyst_hitl_config', column: 'sub_catalyst_name', definition: 'TEXT' },
    // Phase 9: Run analytics
    { table: 'catalyst_actions', column: 'run_id', definition: 'TEXT' },
    { table: 'catalyst_actions', column: 'processing_time_ms', definition: 'INTEGER' },
    // v62: write-back actions — query/aggregation columns
    { table: 'catalyst_actions', column: 'action_type', definition: 'TEXT' },
    { table: 'catalyst_actions', column: 'value_zar', definition: 'REAL' },
    { table: 'catalyst_actions', column: 'source_finding_id', definition: 'TEXT' },
    { table: 'catalyst_actions', column: 'idempotency_key', definition: 'TEXT' },
    { table: 'catalyst_actions', column: 'connection_id', definition: 'TEXT' },
    { table: 'catalyst_actions', column: 'vendor', definition: 'TEXT' },
    // Spec 6 P1: Source attribution on process_metrics
    { table: 'process_metrics', column: 'sub_catalyst_name', definition: 'TEXT' },
    { table: 'process_metrics', column: 'source_run_id', definition: 'TEXT' },
    { table: 'process_metrics', column: 'cluster_id', definition: 'TEXT' },
    // Spec 6 A2: Briefing source data columns
    { table: 'executive_briefings', column: 'health_delta', definition: 'REAL' },
    { table: 'executive_briefings', column: 'red_metric_count', definition: 'INTEGER' },
    { table: 'executive_briefings', column: 'anomaly_count', definition: 'INTEGER' },
    { table: 'executive_briefings', column: 'active_risk_count', definition: 'INTEGER' },
    // Spec 6 A3: Scenario context columns
    { table: 'scenarios', column: 'context_data', definition: 'TEXT' },
    { table: 'scenarios', column: 'model_response', definition: 'TEXT' },
    // Spec 6 P1: Risk alert source attribution
    { table: 'risk_alerts', column: 'source_run_id', definition: 'TEXT' },
    { table: 'risk_alerts', column: 'cluster_id', definition: 'TEXT' },
    { table: 'risk_alerts', column: 'sub_catalyst_name', definition: 'TEXT' },
    // Spec 6 P3: Correlation source attribution + new fields
    { table: 'correlation_events', column: 'source_run_id', definition: 'TEXT' },
    { table: 'correlation_events', column: 'cluster_id', definition: 'TEXT' },
    { table: 'correlation_events', column: 'metric_a', definition: 'TEXT' },
    { table: 'correlation_events', column: 'metric_b', definition: 'TEXT' },
    { table: 'correlation_events', column: 'correlation_type', definition: "TEXT DEFAULT 'temporal'" },
    { table: 'correlation_events', column: 'lag_hours', definition: 'REAL' },
    { table: 'correlation_events', column: 'description', definition: 'TEXT' },
    // Insights engine: process_metrics domain and category columns
    { table: 'process_metrics', column: 'domain', definition: 'TEXT' },
    { table: 'process_metrics', column: 'category', definition: 'TEXT' },
    // V2 Spec: catalyst_effectiveness trend arrays
    { table: 'catalyst_effectiveness', column: 'avg_match_rate_trend', definition: "TEXT NOT NULL DEFAULT '[]'" },
    { table: 'catalyst_effectiveness', column: 'avg_confidence_trend', definition: "TEXT NOT NULL DEFAULT '[]'" },
    { table: 'catalyst_effectiveness', column: 'avg_duration_trend', definition: "TEXT NOT NULL DEFAULT '[]'" },
    { table: 'catalyst_effectiveness', column: 'intervention_impacts', definition: "TEXT NOT NULL DEFAULT '[]'" },
    { table: 'catalyst_effectiveness', column: 'total_discrepancy_value_found', definition: 'REAL NOT NULL DEFAULT 0' },
    { table: 'catalyst_effectiveness', column: 'total_discrepancy_value_resolved', definition: 'REAL NOT NULL DEFAULT 0' },
    { table: 'catalyst_effectiveness', column: 'recovery_rate', definition: 'REAL NOT NULL DEFAULT 0' },
    { table: 'catalyst_effectiveness', column: 'total_items_processed', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'catalyst_effectiveness', column: 'period', definition: "TEXT NOT NULL DEFAULT 'all-time'" },
    // V2 Spec: catalyst_dependencies upstream/downstream + extra columns
    { table: 'catalyst_dependencies', column: 'upstream_cluster_id', definition: 'TEXT' },
    { table: 'catalyst_dependencies', column: 'upstream_sub_name', definition: 'TEXT' },
    { table: 'catalyst_dependencies', column: 'downstream_cluster_id', definition: 'TEXT' },
    { table: 'catalyst_dependencies', column: 'downstream_sub_name', definition: 'TEXT' },
    { table: 'catalyst_dependencies', column: 'lag_hours', definition: 'REAL NOT NULL DEFAULT 0' },
    { table: 'catalyst_dependencies', column: 'correlation_strength', definition: 'REAL NOT NULL DEFAULT 0' },
    { table: 'catalyst_dependencies', column: 'cascade_risk_score', definition: 'REAL NOT NULL DEFAULT 0' },
    { table: 'catalyst_dependencies', column: 'evidence', definition: "TEXT NOT NULL DEFAULT '{}'" },
    { table: 'catalyst_dependencies', column: 'last_confirmed', definition: 'TEXT' },
    // V2 Spec: catalyst_patterns spec-required columns
    { table: 'catalyst_patterns', column: 'cluster_id', definition: 'TEXT' },
    { table: 'catalyst_patterns', column: 'sub_catalyst_name', definition: 'TEXT' },
    { table: 'catalyst_patterns', column: 'evidence', definition: "TEXT NOT NULL DEFAULT '{}'" },
    { table: 'catalyst_patterns', column: 'affected_records_pct', definition: 'REAL NOT NULL DEFAULT 0' },
    { table: 'catalyst_patterns', column: 'confidence', definition: 'REAL NOT NULL DEFAULT 0' },
    { table: 'catalyst_patterns', column: 'first_detected', definition: "TEXT NOT NULL DEFAULT (datetime('now'))" },
    { table: 'catalyst_patterns', column: 'last_confirmed', definition: "TEXT NOT NULL DEFAULT (datetime('now'))" },
    { table: 'catalyst_patterns', column: 'run_count', definition: 'INTEGER NOT NULL DEFAULT 1' },
    { table: 'catalyst_patterns', column: 'prescription_id', definition: 'TEXT' },
    // V2 Spec: competitors extra columns (seed uses website, threat_level, notes, created_at)
    { table: 'competitors', column: 'website', definition: 'TEXT' },
    { table: 'competitors', column: 'threat_level', definition: "TEXT NOT NULL DEFAULT 'medium'" },
    { table: 'competitors', column: 'notes', definition: "TEXT NOT NULL DEFAULT ''" },
    { table: 'competitors', column: 'created_at', definition: "TEXT NOT NULL DEFAULT (datetime('now'))" },
    // V2 Spec: market_benchmarks seed-compatible columns
    { table: 'market_benchmarks', column: 'name', definition: 'TEXT' },
    { table: 'market_benchmarks', column: 'category', definition: 'TEXT' },
    { table: 'market_benchmarks', column: 'value', definition: 'REAL' },
    { table: 'market_benchmarks', column: 'unit', definition: 'TEXT' },
    { table: 'market_benchmarks', column: 'percentile', definition: 'REAL' },
    { table: 'market_benchmarks', column: 'trend', definition: "TEXT NOT NULL DEFAULT 'stable'" },
    { table: 'market_benchmarks', column: 'period', definition: 'TEXT' },
    { table: 'market_benchmarks', column: 'created_at', definition: "TEXT NOT NULL DEFAULT (datetime('now'))" },
    // V2 Spec: regulatory_events seed-compatible columns
    { table: 'regulatory_events', column: 'body', definition: 'TEXT' },
    { table: 'regulatory_events', column: 'authority', definition: 'TEXT' },
    { table: 'regulatory_events', column: 'impact', definition: "TEXT NOT NULL DEFAULT 'medium'" },
    { table: 'regulatory_events', column: 'category', definition: 'TEXT' },
    { table: 'regulatory_events', column: 'created_at', definition: "TEXT NOT NULL DEFAULT (datetime('now'))" },
    // V2 Spec: root_cause_analyses seed-compatible columns
    { table: 'root_cause_analyses', column: 'metric_value', definition: 'REAL' },
    { table: 'root_cause_analyses', column: 'metric_status', definition: 'TEXT' },
    { table: 'root_cause_analyses', column: 'trigger_type', definition: "TEXT NOT NULL DEFAULT 'manual'" },
    { table: 'root_cause_analyses', column: 'rca_depth', definition: 'INTEGER NOT NULL DEFAULT 3' },
    { table: 'root_cause_analyses', column: 'created_at', definition: "TEXT NOT NULL DEFAULT (datetime('now'))" },
    { table: 'root_cause_analyses', column: 'completed_at', definition: 'TEXT' },
    // V2 Spec: causal_factors seed-compatible columns
    { table: 'causal_factors', column: 'level', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'causal_factors', column: 'category', definition: 'TEXT' },
    { table: 'causal_factors', column: 'linked_metrics', definition: "TEXT NOT NULL DEFAULT '[]'" },
    // V2 Spec: diagnostic_prescriptions seed-compatible columns
    { table: 'diagnostic_prescriptions', column: 'effort', definition: "TEXT NOT NULL DEFAULT 'medium'" },
    { table: 'diagnostic_prescriptions', column: 'sap_transaction', definition: 'TEXT' },
    { table: 'diagnostic_prescriptions', column: 'estimated_impact', definition: 'TEXT' },
    // V2 Spec: catalyst_effectiveness seed-compatible columns
    { table: 'catalyst_effectiveness', column: 'sub_catalyst_id', definition: 'TEXT' },
    { table: 'catalyst_effectiveness', column: 'match_rate', definition: 'REAL NOT NULL DEFAULT 0' },
    { table: 'catalyst_effectiveness', column: 'exception_rate', definition: 'REAL NOT NULL DEFAULT 0' },
    { table: 'catalyst_effectiveness', column: 'avg_processing_time', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'catalyst_effectiveness', column: 'trend', definition: "TEXT NOT NULL DEFAULT 'stable'" },
    { table: 'catalyst_effectiveness', column: 'calculated_at', definition: "TEXT NOT NULL DEFAULT (datetime('now'))" },
    // V2 Spec: catalyst_dependencies seed-compatible columns
    { table: 'catalyst_dependencies', column: 'from_catalyst_id', definition: 'TEXT' },
    { table: 'catalyst_dependencies', column: 'from_catalyst_name', definition: 'TEXT' },
    { table: 'catalyst_dependencies', column: 'to_catalyst_id', definition: 'TEXT' },
    { table: 'catalyst_dependencies', column: 'to_catalyst_name', definition: 'TEXT' },
    { table: 'catalyst_dependencies', column: 'created_at', definition: "TEXT NOT NULL DEFAULT (datetime('now'))" },
    // V2 Spec: catalyst_prescriptions seed-compatible columns
    { table: 'catalyst_prescriptions', column: 'effort', definition: "TEXT NOT NULL DEFAULT 'medium'" },
    { table: 'catalyst_prescriptions', column: 'sap_transaction', definition: 'TEXT' },
    { table: 'catalyst_prescriptions', column: 'estimated_savings', definition: 'TEXT' },
    // V2 Spec: roi_tracking seed-compatible columns
    { table: 'roi_tracking', column: 'identified_losses', definition: 'REAL NOT NULL DEFAULT 0' },
    { table: 'roi_tracking', column: 'recovered_amount', definition: 'REAL NOT NULL DEFAULT 0' },
    { table: 'roi_tracking', column: 'prevented_losses', definition: 'REAL NOT NULL DEFAULT 0' },
    { table: 'roi_tracking', column: 'person_hours_saved', definition: 'REAL NOT NULL DEFAULT 0' },
    { table: 'roi_tracking', column: 'platform_cost', definition: 'REAL NOT NULL DEFAULT 0' },
    { table: 'roi_tracking', column: 'breakdown', definition: "TEXT NOT NULL DEFAULT '{}'" },
    { table: 'roi_tracking', column: 'created_at', definition: "TEXT NOT NULL DEFAULT (datetime('now'))" },
    // V2 Spec: industry_radar_seeds seed-compatible columns
    { table: 'industry_radar_seeds', column: 'signal_type', definition: 'TEXT' },
    { table: 'industry_radar_seeds', column: 'description', definition: 'TEXT' },
    { table: 'industry_radar_seeds', column: 'default_severity', definition: "TEXT NOT NULL DEFAULT 'medium'" },
    { table: 'industry_radar_seeds', column: 'created_at', definition: "TEXT NOT NULL DEFAULT (datetime('now'))" },
    // V2 Spec: industry_benchmark_seeds seed-compatible columns
    { table: 'industry_benchmark_seeds', column: 'name', definition: 'TEXT' },
    { table: 'industry_benchmark_seeds', column: 'default_value', definition: 'REAL' },
    { table: 'industry_benchmark_seeds', column: 'unit', definition: 'TEXT' },
    { table: 'industry_benchmark_seeds', column: 'created_at', definition: "TEXT NOT NULL DEFAULT (datetime('now'))" },
    // V2 Spec: industry_regulatory_seeds seed-compatible columns
    { table: 'industry_regulatory_seeds', column: 'default_body', definition: 'TEXT' },
    { table: 'industry_regulatory_seeds', column: 'authority', definition: 'TEXT' },
    { table: 'industry_regulatory_seeds', column: 'created_at', definition: "TEXT NOT NULL DEFAULT (datetime('now'))" },

    // Multi-company ERP: per-entity company_id (nullable for back-compat;
    // rows with null are implicitly scoped to the tenant's primary company
    // after the backfill below runs).
    { table: 'erp_customers',        column: 'company_id', definition: 'TEXT' },
    { table: 'erp_suppliers',        column: 'company_id', definition: 'TEXT' },
    { table: 'erp_invoices',         column: 'company_id', definition: 'TEXT' },
    { table: 'erp_purchase_orders',  column: 'company_id', definition: 'TEXT' },
    { table: 'erp_products',         column: 'company_id', definition: 'TEXT' },
    { table: 'erp_employees',        column: 'company_id', definition: 'TEXT' },
    { table: 'erp_gl_accounts',      column: 'company_id', definition: 'TEXT' },
    { table: 'erp_journal_entries',  column: 'company_id', definition: 'TEXT' },
    { table: 'erp_bank_transactions',column: 'company_id', definition: 'TEXT' },
    // v60: per-connection attribution. Old rows stay NULL and fall back to
    // source_system-level attribution; new ingestions tag connection_id so
    // a multi-ERP customer gets a per-connection savings split in the
    // shared-savings billing trail.
    { table: 'erp_customers',        column: 'connection_id', definition: 'TEXT' },
    { table: 'erp_suppliers',        column: 'connection_id', definition: 'TEXT' },
    { table: 'erp_invoices',         column: 'connection_id', definition: 'TEXT' },
    { table: 'erp_purchase_orders',  column: 'connection_id', definition: 'TEXT' },
    { table: 'erp_products',         column: 'connection_id', definition: 'TEXT' },
    { table: 'erp_employees',        column: 'connection_id', definition: 'TEXT' },
    { table: 'erp_gl_accounts',      column: 'connection_id', definition: 'TEXT' },
    { table: 'erp_journal_entries',  column: 'connection_id', definition: 'TEXT' },
    { table: 'erp_bank_transactions',column: 'connection_id', definition: 'TEXT' },
  ];

  for (const col of selfHealColumns) {
    try {
      await db.prepare(`ALTER TABLE ${col.table} ADD COLUMN ${col.column} ${col.definition}`).run();
      result.columnsHealed++;
    } catch {
      // Column already exists — expected, skip silently
    }
  }

  // ── Column Drops ──
  // Columns we deliberately removed. D1/SQLite 3.35+ supports DROP COLUMN.
  // Wrapped in try/catch so the migration is idempotent (after the column is
  // dropped, subsequent runs throw and we skip silently).
  const columnsToDrop: Array<{ table: string; column: string }> = [
    // Industry no longer tracked per-tenant — catalog is tag-based and not
    // industry-gated. Benchmark tables that still carry `industry` are untouched.
    { table: 'tenants', column: 'industry' },
  ];
  for (const col of columnsToDrop) {
    try {
      await db.prepare(`ALTER TABLE ${col.table} DROP COLUMN ${col.column}`).run();
    } catch {
      // Column already removed or never existed — idempotent skip.
    }
  }

  // ── Multi-company backfill ──
  // Every tenant that has any ERP data gets a synthetic __primary__ company
  // so existing rows (which have company_id = NULL after the self-heal)
  // can be linked. Idempotent: only inserts the primary company when none
  // exists for the tenant, and only backfills NULL company_id rows.
  try {
    const tenantsWithData = await db.prepare(
      `SELECT DISTINCT tenant_id FROM (
         SELECT tenant_id FROM erp_customers
         UNION SELECT tenant_id FROM erp_suppliers
         UNION SELECT tenant_id FROM erp_products
         UNION SELECT tenant_id FROM erp_invoices
         UNION SELECT tenant_id FROM erp_purchase_orders
         UNION SELECT tenant_id FROM erp_employees
       )`,
    ).all<{ tenant_id: string }>();

    for (const row of tenantsWithData.results || []) {
      const tenantId = row.tenant_id;
      if (!tenantId) continue;

      // Find or create the primary company for this tenant.
      let primary = await db.prepare(
        'SELECT id FROM erp_companies WHERE tenant_id = ? AND is_primary = 1 LIMIT 1',
      ).bind(tenantId).first<{ id: string }>();

      if (!primary) {
        const companyId = crypto.randomUUID();
        await db.prepare(
          `INSERT INTO erp_companies (id, tenant_id, external_id, source_system, code, name, legal_name, currency, country, is_primary, status)
           VALUES (?, ?, '__primary__', 'migration', 'PRIMARY', 'Primary Company', 'Primary Company', 'ZAR', 'ZA', 1, 'active')`,
        ).bind(companyId, tenantId).run();
        primary = { id: companyId };
      }

      const primaryId = primary.id;
      // Backfill NULL company_id on each canonical table.
      const tablesToBackfill = [
        'erp_customers', 'erp_suppliers', 'erp_products',
        'erp_invoices', 'erp_purchase_orders', 'erp_employees',
      ];
      for (const table of tablesToBackfill) {
        try {
          await db.prepare(
            `UPDATE ${table} SET company_id = ? WHERE tenant_id = ? AND company_id IS NULL`,
          ).bind(primaryId, tenantId).run();
        } catch (err) {
          result.errors.push(`Backfill ${table} for ${tenantId}: ${(err as Error).message}`);
        }
      }
    }
  } catch (err) {
    // Backfill failures are non-fatal — log and continue. Individual row
    // reads will still work (null company_id is valid); queries that WANT
    // company scoping can re-run backfill via the ops endpoint.
    result.errors.push(`Multi-company backfill: ${(err as Error).message}`);
  }

  // ── Role Upgrades ──
  try {
    await db.prepare("UPDATE users SET role = 'superadmin' WHERE email = 'admin@vantax.co.za' AND role IN ('admin','support_admin') AND tenant_id = 'vantax'").run();
    await db.prepare("UPDATE users SET role = 'superadmin' WHERE email = 'essen@vantax.co.za' AND role IN ('admin','support_admin') AND tenant_id = 'vantax'").run();
    await db.prepare("UPDATE users SET role = 'superadmin' WHERE email = 'essen.naidoo@agentum.com.au' AND role IN ('admin','support_admin') AND tenant_id = 'vantax'").run();
    await db.prepare("UPDATE users SET role = 'support_admin' WHERE email = 'atheon@vantax.co.za' AND role = 'admin' AND tenant_id = 'vantax'").run();
  } catch (err) {
    result.errors.push(`Role upgrade: ${(err as Error).message}`);
  }

  // ── Seed Missing Role-Tier Users ──
  try {
    await db.prepare("INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, permissions) VALUES ('user-mgr','vantax','manager@vantax.co.za','David Khumalo','manager','[\"pulse.*\",\"catalysts.read\",\"catalysts.execute\",\"mind.query\",\"memory.read\"]')").run();
    await db.prepare("INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, permissions) VALUES ('user-analyst','vantax','analyst@vantax.co.za','Fatima Osman','analyst','[\"pulse.read\",\"mind.query\",\"apex.read\"]')").run();
    await db.prepare("INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, permissions) VALUES ('user-operator','vantax','operator@vantax.co.za','Thabo Ndlovu','operator','[\"pulse.read\",\"catalysts.read\",\"catalysts.execute\",\"mind.query\"]')").run();
    await db.prepare("INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, permissions) VALUES ('user-viewer','vantax','viewer@vantax.co.za','Lerato Mabaso','viewer','[\"dashboard.read\"]')").run();
    await db.prepare("INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, permissions) VALUES ('user-essen-ag','vantax','essen.naidoo@agentum.com.au','Essen Naidoo','superadmin','[\"*\"]')").run();
    await db.prepare("INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, permissions) VALUES ('user-reshigan','vantax','reshigan@vantax.co.za','Reshigan','superadmin','[\"*\"]')").run();
  } catch (err) {
    result.errors.push(`Seed users: ${(err as Error).message}`);
  }

  // ── Ensure all ERP adapters exist (INSERT OR IGNORE prevents duplicates) ──
  try {
    const adapters = [
      { id: 'erp-sap-s4', name: 'SAP S/4HANA', system: 'SAP', version: '2025 FPS01', protocol: 'OData V4', operations: '["RFC","BAPI","OData V4","CDS Views","IDoc"]', auth_methods: '["OAuth 2.0","X.509 Certificate","Basic Auth"]' },
      { id: 'erp-sap-ecc', name: 'SAP ECC 6.0', system: 'SAP', version: 'EHP8', protocol: 'RFC/BAPI', operations: '["RFC","BAPI","IDoc","ALE"]', auth_methods: '["SNC","Basic Auth"]' },
      { id: 'erp-oracle', name: 'Oracle Fusion Cloud', system: 'Oracle', version: '26A', protocol: 'REST', operations: '["REST API","SOAP","BI Publisher","OTBI"]', auth_methods: '["OAuth 2.0","JWT Bearer"]' },
      { id: 'erp-d365', name: 'Microsoft Dynamics 365', system: 'Dynamics365', version: '10.0.42', protocol: 'OData v4', operations: '["OData","Custom API","Power Automate","Dataverse"]', auth_methods: '["Azure AD OAuth","Service Principal"]' },
      { id: 'erp-sf', name: 'Salesforce', system: 'Salesforce', version: 'Spring 26', protocol: 'REST/SOAP', operations: '["REST API v66.0","Bulk API 2.0","Pub/Sub API","Metadata API"]', auth_methods: '["OAuth 2.0","JWT Bearer","SAML"]' },
      { id: 'erp-wd', name: 'Workday', system: 'Workday', version: '2025R2', protocol: 'REST/SOAP', operations: '["REST API","SOAP API v45.2","RaaS","EIB","WQL"]', auth_methods: '["OAuth 2.0","X.509","API Key"]' },
      { id: 'erp-ns', name: 'NetSuite', system: 'NetSuite', version: '2026.1', protocol: 'REST/SuiteTalk', operations: '["REST API","SuiteTalk SOAP","SuiteQL","RESTlets"]', auth_methods: '["OAuth 2.0","Token-Based Auth"]' },
      { id: 'erp-sage', name: 'Sage Intacct', system: 'Sage', version: 'R1 2026', protocol: 'REST/XML', operations: '["REST API","XML Gateway","Web Services"]', auth_methods: '["API Key","Session Auth"]' },
      { id: 'erp-xero', name: 'Xero', system: 'Xero', version: '2.0', protocol: 'REST', operations: '["REST API","Webhooks","Bank Feeds","Payroll API"]', auth_methods: '["OAuth 2.0"]' },
      { id: 'erp-sage-bc', name: 'Sage Business Cloud Accounting', system: 'Sage', version: 'v3.1', protocol: 'REST', operations: '["REST API","Webhooks","Banking","Reporting"]', auth_methods: '["OAuth 2.0"]' },
      { id: 'erp-sage-pastel', name: 'Sage Pastel Partner', system: 'Pastel', version: '2026.1', protocol: 'REST/SDK', operations: '["REST API v2","SDK Integration","DDE","ODBC"]', auth_methods: '["API Key","Session Auth","Username/Password"]' },
      { id: 'erp-sage-50', name: 'Sage 50cloud Pastel', system: 'Pastel', version: '2026', protocol: 'REST/SDK', operations: '["REST API v2","SDK","Pastel Connector","CSV Import"]', auth_methods: '["API Key","OAuth 2.0"]' },
      { id: 'erp-sage-intacct', name: 'Sage Intacct', system: 'Sage', version: 'R1 2026', protocol: 'REST/XML', operations: '["REST API","XML Gateway","Web Services","Smart Events"]', auth_methods: '["API Key","Session Auth","OAuth 2.0"]' },
      { id: 'erp-sage-300', name: 'Sage 300 (Accpac)', system: 'Sage', version: '2026', protocol: 'REST/SOAP', operations: '["REST API","SOAP","Views API","Macros"]', auth_methods: '["API Key","Session Auth"]' },
      { id: 'erp-sage-x3', name: 'Sage X3', system: 'Sage', version: 'V12', protocol: 'REST/SOAP', operations: '["REST API","SOAP Web Services","Syracuse","Batch Server"]', auth_methods: '["OAuth 2.0","Basic Auth"]' },
      { id: 'erp-odoo', name: 'Odoo ERP', system: 'Odoo', version: '18.0', protocol: 'JSON-RPC/REST', operations: '["JSON-RPC 2.0","REST API v2","XML-RPC","ORM API"]', auth_methods: '["OAuth 2.0","API Key","Session Auth"]' },
    ];
    for (const a of adapters) {
      try {
        await db.prepare(
          "INSERT OR IGNORE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods) VALUES (?, ?, ?, ?, ?, 'available', ?, ?)"
        ).bind(a.id, a.name, a.system, a.version, a.protocol, a.operations, a.auth_methods).run();
      } catch (err) {
        result.errors.push(`Seed ERP adapter ${a.id}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    result.errors.push(`Seed ERP adapters: ${(err as Error).message}`);
  }

  result.durationMs = Date.now() - t0;
  return result;
}
