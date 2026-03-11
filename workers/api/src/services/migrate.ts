/**
 * Database Migration Service
 * Extracted from request-path middleware to run on-demand via POST /api/v1/admin/migrate.
 * Contains all schema DDL, indexes, self-healing columns, and seed-data orchestration.
 */

import { seedDatabase } from './seed';
import { seedSampleCompany } from './seed-sample-company';
import { seedTestCompanies } from './seed-test-companies';

/** Current schema version — bump when adding new tables/columns/indexes */
export const MIGRATION_VERSION = 'v26';

/** Result of a migration run */
export interface MigrationResult {
  version: string;
  tablesCreated: number;
  indexesCreated: number;
  columnsHealed: number;
  seedsRun: string[];
  durationMs: number;
  errors: string[];
}

/**
 * Run the full database migration: DDL, indexes, self-healing columns, seeds.
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
    seedsRun: [],
    durationMs: 0,
    errors: [],
  };

  // ── Core Tables ──
  const coreTableSQL = `
    CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, industry TEXT NOT NULL DEFAULT 'general', plan TEXT NOT NULL DEFAULT 'starter', status TEXT NOT NULL DEFAULT 'active', deployment_model TEXT NOT NULL DEFAULT 'saas', region TEXT NOT NULL DEFAULT 'af-south-1', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
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
    CREATE TABLE IF NOT EXISTS anomalies (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), metric TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'medium', expected_value REAL NOT NULL, actual_value REAL NOT NULL, deviation REAL NOT NULL, hypothesis TEXT, status TEXT NOT NULL DEFAULT 'open', detected_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT);
    CREATE TABLE IF NOT EXISTS process_flows (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]', variants INTEGER NOT NULL DEFAULT 1, avg_duration REAL NOT NULL DEFAULT 0, conformance_rate REAL NOT NULL DEFAULT 100, bottlenecks TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS correlation_events (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), source_system TEXT NOT NULL, source_event TEXT NOT NULL, target_system TEXT NOT NULL, target_impact TEXT NOT NULL, confidence REAL NOT NULL, lag_days REAL NOT NULL DEFAULT 0, detected_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS erp_adapters (id TEXT PRIMARY KEY, name TEXT NOT NULL, system TEXT NOT NULL, version TEXT, protocol TEXT NOT NULL DEFAULT 'REST', status TEXT NOT NULL DEFAULT 'available', operations TEXT NOT NULL DEFAULT '[]', auth_methods TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS erp_connections (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), adapter_id TEXT NOT NULL REFERENCES erp_adapters(id), name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'disconnected', config TEXT NOT NULL DEFAULT '{}', last_sync TEXT, sync_frequency TEXT DEFAULT 'realtime', records_synced INTEGER NOT NULL DEFAULT 0, connected_at TEXT);
    CREATE TABLE IF NOT EXISTS canonical_endpoints (id TEXT PRIMARY KEY, domain TEXT NOT NULL, path TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'GET', description TEXT, request_schema TEXT, response_schema TEXT, rate_limit INTEGER NOT NULL DEFAULT 100, version TEXT NOT NULL DEFAULT 'v1');
    CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT, action TEXT NOT NULL, layer TEXT NOT NULL, resource TEXT, details TEXT, outcome TEXT NOT NULL DEFAULT 'success', ip_address TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS mind_queries (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT, query TEXT NOT NULL, response TEXT, tier TEXT NOT NULL DEFAULT 'tier-1', tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0, citations TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), type TEXT NOT NULL DEFAULT 'system', title TEXT NOT NULL, message TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info', action_url TEXT, metadata TEXT, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), url TEXT NOT NULL, secret TEXT NOT NULL, events TEXT NOT NULL DEFAULT '["*"]', active INTEGER NOT NULL DEFAULT 1, retry_count INTEGER NOT NULL DEFAULT 0, last_triggered TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'document', mime_type TEXT NOT NULL DEFAULT 'application/octet-stream', size INTEGER NOT NULL DEFAULT 0, r2_key TEXT, uploaded_by TEXT, stored_in_r2 INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS email_queue (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), recipients TEXT NOT NULL, subject TEXT NOT NULL, html_body TEXT NOT NULL, text_body TEXT, status TEXT NOT NULL DEFAULT 'pending', sent_at TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS execution_logs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), action_id TEXT NOT NULL, step_number INTEGER NOT NULL, step_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', detail TEXT, duration_ms INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS managed_deployments (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, deployment_type TEXT NOT NULL DEFAULT 'hybrid', status TEXT NOT NULL DEFAULT 'pending', licence_key TEXT NOT NULL UNIQUE, licence_expires_at TEXT, agent_version TEXT, api_version TEXT, customer_api_url TEXT, region TEXT DEFAULT 'af-south-1', last_heartbeat TEXT, health_score REAL NOT NULL DEFAULT 0, config TEXT NOT NULL DEFAULT '{}', resource_usage TEXT NOT NULL DEFAULT '{}', error_log TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS assessments (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), prospect_name TEXT NOT NULL, prospect_industry TEXT NOT NULL, erp_connection_id TEXT REFERENCES erp_connections(id), status TEXT NOT NULL DEFAULT 'pending', config TEXT NOT NULL DEFAULT '{}', data_snapshot TEXT NOT NULL DEFAULT '{}', results TEXT NOT NULL DEFAULT '{}', business_report_key TEXT, technical_report_key TEXT, excel_model_key TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT);
    CREATE TABLE IF NOT EXISTS chat_conversations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL DEFAULT 'New Conversation', model_tier TEXT NOT NULL DEFAULT 'tier-1', messages TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS password_reset_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL, name TEXT NOT NULL, key_hash TEXT NOT NULL, key_prefix TEXT, permissions TEXT NOT NULL DEFAULT '["read"]', last_used TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT);
    CREATE TABLE IF NOT EXISTS user_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), tenant_id TEXT NOT NULL REFERENCES tenants(id), token_hash TEXT NOT NULL, ip_address TEXT, user_agent TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL);
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
    'CREATE INDEX IF NOT EXISTS idx_anomalies_tenant ON anomalies(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_mind_queries_tenant ON mind_queries(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(tenant_id, read)',
    'CREATE INDEX IF NOT EXISTS idx_webhooks_tenant ON webhooks(tenant_id)',
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
  const erpTables = [
    `CREATE TABLE IF NOT EXISTS erp_customers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), external_id TEXT, source_system TEXT NOT NULL DEFAULT 'manual', name TEXT NOT NULL, trading_name TEXT, registration_number TEXT, vat_number TEXT, customer_group TEXT, credit_limit REAL DEFAULT 0, credit_balance REAL DEFAULT 0, payment_terms TEXT DEFAULT 'Net 30', currency TEXT DEFAULT 'ZAR', address_line1 TEXT, address_line2 TEXT, city TEXT, province TEXT, postal_code TEXT, country TEXT DEFAULT 'ZA', contact_name TEXT, contact_email TEXT, contact_phone TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT)`,
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
    { table: 'catalyst_actions', column: 'escalation_level', definition: 'TEXT' },
    { table: 'catalyst_actions', column: 'retry_count', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'tenants', column: 'industry', definition: "TEXT NOT NULL DEFAULT 'general'" },
    { table: 'tenants', column: 'deployment_model', definition: "TEXT NOT NULL DEFAULT 'saas'" },
    { table: 'tenants', column: 'region', definition: "TEXT NOT NULL DEFAULT 'af-south-1'" },
    { table: 'users', column: 'password_hash', definition: 'TEXT' },
    { table: 'users', column: 'last_login', definition: 'TEXT' },
    { table: 'risk_alerts', column: 'probability', definition: 'REAL' },
    { table: 'risk_alerts', column: 'impact_unit', definition: "TEXT DEFAULT 'ZAR'" },
    { table: 'sso_configs', column: 'auto_provision', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'sso_configs', column: 'default_role', definition: "TEXT NOT NULL DEFAULT 'analyst'" },
    { table: 'sso_configs', column: 'domain_hint', definition: 'TEXT' },
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
    { table: 'tenant_entitlements', column: 'api_calls_used', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'tenant_entitlements', column: 'storage_used_gb', definition: 'REAL NOT NULL DEFAULT 0' },
  ];

  for (const col of selfHealColumns) {
    try {
      await db.prepare(`ALTER TABLE ${col.table} ADD COLUMN ${col.column} ${col.definition}`).run();
      result.columnsHealed++;
    } catch {
      // Column already exists — expected, skip silently
    }
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
    await db.prepare("INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES ('protea-user-6','protea','warehouse@protea-mfg.co.za','Mandla Sithole','operator','','[\"pulse.read\",\"catalysts.read\",\"catalysts.execute\",\"mind.query\"]','active')").run();
    await db.prepare("INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES ('protea-user-7','protea','intern@protea-mfg.co.za','Naledi Mahlangu','viewer','','[\"dashboard.read\"]','active')").run();
  } catch (err) {
    result.errors.push(`Seed users: ${(err as Error).message}`);
  }

  // ── Seed Data ──
  try {
    await seedDatabase(db);
    result.seedsRun.push('seedDatabase');
  } catch (err) {
    result.errors.push(`seedDatabase: ${(err as Error).message}`);
  }

  try {
    await seedSampleCompany(db);
    result.seedsRun.push('seedSampleCompany');
  } catch (err) {
    result.errors.push(`seedSampleCompany: ${(err as Error).message}`);
  }

  try {
    await seedTestCompanies(db);
    result.seedsRun.push('seedTestCompanies');
  } catch (err) {
    result.errors.push(`seedTestCompanies: ${(err as Error).message}`);
  }

  result.durationMs = Date.now() - t0;
  return result;
}
