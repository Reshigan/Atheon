import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, AppBindings } from './types';
import { seedDatabase } from './services/seed';
import { seedSampleCompany } from './services/seed-sample-company';
import { seedTestCompanies } from './services/seed-test-companies';
import { apiRateLimiter, authRateLimiter, aiRateLimiter, demoAuthRateLimiter, contactRateLimiter } from './middleware/ratelimit';
import { hashPassword } from './middleware/auth';
import { auditEnrichment, requestSizeLimiter } from './middleware/validation';
import { tenantIsolation, requireRole } from './middleware/tenant';
import { DashboardRoom } from './services/realtime';
import { handleScheduled, handleQueueMessage } from './services/scheduled';
import type { CatalystQueueMessage } from './services/scheduled';
import auth from './routes/auth';
import tenants from './routes/tenants';
import iam from './routes/iam';
import apex from './routes/apex';
import pulse from './routes/pulse';
import catalysts from './routes/catalysts';
import memory from './routes/memory';
import mind from './routes/mind';
import erp from './routes/erp';
import controlplane from './routes/controlplane';
import audit from './routes/audit';
import connectivity from './routes/connectivity';
import notifications from './routes/notifications';
import storage from './routes/storage';
import realtime from './routes/realtime';
import deployments from './routes/deployments';
import assessments from './routes/assessments';
import agentRoutes from './routes/agent-routes';

// Export Durable Object class for Cloudflare runtime
export { DashboardRoom };

const app = new Hono<AppBindings>();

// CORS - restricted to production and preview domains
// Bug #10 fix: Add localhost origins for local development
const ALLOWED_ORIGINS = [
  'https://atheon.vantax.co.za',
  'https://atheon-33b.pages.dev',
  'http://localhost:5173',
  'http://localhost:3000',
];

app.use('*', cors({
  origin: (origin) => {
    if (!origin) return 'https://atheon.vantax.co.za';
    if (ALLOWED_ORIGINS.includes(origin)) return origin;
    // Allow Cloudflare Pages preview deployments
    if (origin.endsWith('.atheon-33b.pages.dev')) return origin;
    return null as unknown as string;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Licence-Key'],
  exposeHeaders: ['Content-Length', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-Request-ID'],
  maxAge: 86400,
  credentials: true,
}));

// Security S8: X-Request-ID correlation header + H6: Security headers (CSRF protection)
app.use('*', async (c, next) => {
  const requestId = c.req.header('X-Request-ID') || crypto.randomUUID();
  c.set('requestId' as never, requestId as never);
  await next();
  c.header('X-Request-ID', requestId);
  // H6: CSRF protection — enforce SameSite=Strict on any Set-Cookie headers
  const existingCookie = c.res.headers.get('Set-Cookie');
  if (existingCookie && !existingCookie.includes('SameSite')) {
    c.res.headers.set('Set-Cookie', `${existingCookie}; SameSite=Strict; Secure`);
  }
  // Additional security headers
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});

// Request size limiter (1MB max)
app.use('/api/*', requestSizeLimiter(1048576));

// Audit enrichment middleware (captures IP, user-agent, logs mutations)
app.use('/api/*', auditEnrichment());

// Rate limiting
app.use('/api/auth/demo-login', demoAuthRateLimiter);
app.use('/api/auth/*', authRateLimiter);
app.use('/api/mind/*', aiRateLimiter);
app.use('/api/contact', contactRateLimiter);
app.use('/api/*', apiRateLimiter);

// 4.4: Database migrations — canonical definitions live in /migrations/*.sql files
// At runtime, Workers can't read files, so CREATE TABLE IF NOT EXISTS ensures idempotent setup.
// New tables MUST be added to migrations/ files first, then mirrored here for runtime safety.
// Migration files: 0001_init.sql, 0002_erp_sample_data.sql, 0003_extended_tables.sql
const MIGRATION_VERSION = 'v21';
app.use('*', async (c, next) => {
  const migrationKey = `db:migrated:${MIGRATION_VERSION}`;
  const alreadyMigrated = await c.env.CACHE.get(migrationKey);
  if (!alreadyMigrated) {
    try {
      // Runtime migration (mirrors /migrations/*.sql files — see 4.4 audit fix)
      const migrationSQL = `
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
        CREATE TABLE IF NOT EXISTS assessments (id TEXT PRIMARY KEY, tenant_id TEXT, prospect_name TEXT NOT NULL, prospect_industry TEXT NOT NULL, erp_connection_id TEXT, status TEXT NOT NULL DEFAULT 'pending', config TEXT NOT NULL DEFAULT '{}', data_snapshot TEXT, results TEXT, business_report_key TEXT, technical_report_key TEXT, excel_model_key TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT);
      `;

      // Execute each CREATE TABLE separately
      const statements = migrationSQL.split(';').filter(s => s.trim().length > 0);
      for (const stmt of statements) {
        await c.env.DB.prepare(stmt.trim()).run();
      }

      // Create indexes
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
      ];

      for (const idx of indexes) {
        await c.env.DB.prepare(idx).run();
      }

      // Create canonical ERP data tables
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
        await c.env.DB.prepare(tbl).run();
      }

      // Create indexes for canonical ERP tables
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
      ];

      for (const idx of erpIndexes) {
        await c.env.DB.prepare(idx).run();
      }

      // Add sub_catalysts column to catalyst_clusters (v6 migration)
      try {
        await c.env.DB.prepare('ALTER TABLE catalyst_clusters ADD COLUMN sub_catalysts TEXT NOT NULL DEFAULT \'[]\'').run();
      } catch {
        // Column may already exist — ignore
      }

      // ═══════════════════════════════════════════════════════════════
      // SELF-HEALING SCHEMA MIGRATION (v18)
      // Auto-detect and add missing columns across all tables.
      // Uses ALTER TABLE ... ADD COLUMN wrapped in try/catch so existing
      // columns are silently skipped. This ensures any deployment that
      // missed an intermediate migration self-heals on first request.
      // ═══════════════════════════════════════════════════════════════
      const selfHealColumns: Array<{ table: string; column: string; definition: string }> = [
        // catalyst_clusters — sub_catalysts already handled above
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
      ];

      for (const col of selfHealColumns) {
        try {
          await c.env.DB.prepare(`ALTER TABLE ${col.table} ADD COLUMN ${col.column} ${col.definition}`).run();
        } catch {
          // Column already exists — skip
        }
      }

      // Insight data (health_scores, risk_alerts, etc.) is populated by catalyst execution only — not seeded

      // v15→v16: Upgrade platform owner users to correct roles (fixes PR #74 role split)
      // admin@vantax.co.za and essen@vantax.co.za are superadmins per platform owner requirement.
      // atheon@vantax.co.za is a system account → support_admin.
      // v16 also handles the case where v15 already ran and set essen to support_admin.
      try {
        await c.env.DB.prepare(
          "UPDATE users SET role = 'superadmin' WHERE email = 'admin@vantax.co.za' AND role IN ('admin','support_admin') AND tenant_id = 'vantax'"
        ).run();
        await c.env.DB.prepare(
          "UPDATE users SET role = 'superadmin' WHERE email = 'essen@vantax.co.za' AND role IN ('admin','support_admin') AND tenant_id = 'vantax'"
        ).run();
        await c.env.DB.prepare(
          "UPDATE users SET role = 'superadmin' WHERE email = 'essen.naidoo@agentum.com.au' AND role IN ('admin','support_admin') AND tenant_id = 'vantax'"
        ).run();
        await c.env.DB.prepare(
          "UPDATE users SET role = 'support_admin' WHERE email = 'atheon@vantax.co.za' AND role = 'admin' AND tenant_id = 'vantax'"
        ).run();
      } catch { /* users may not exist yet — seed will create them with correct roles */ }

      // v17: Seed missing role-tier users for existing databases
      // seedDatabase() uses plain INSERT (not OR IGNORE) so it aborts on duplicates.
      // seedSampleCompany() has an early-return guard if protea tenant exists.
      // These INSERT OR IGNORE statements ensure the new users get created on existing DBs.
      try {
        // Vantax platform tenant — new role tiers
        await c.env.DB.prepare("INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, permissions) VALUES ('user-mgr','vantax','manager@vantax.co.za','David Khumalo','manager','[\"pulse.*\",\"catalysts.read\",\"catalysts.execute\",\"mind.query\",\"memory.read\"]')").run();
        await c.env.DB.prepare("INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, permissions) VALUES ('user-analyst','vantax','analyst@vantax.co.za','Fatima Osman','analyst','[\"pulse.read\",\"mind.query\",\"apex.read\"]')").run();
        await c.env.DB.prepare("INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, permissions) VALUES ('user-operator','vantax','operator@vantax.co.za','Thabo Ndlovu','operator','[\"pulse.read\",\"catalysts.read\",\"catalysts.execute\",\"mind.query\"]')").run();
        await c.env.DB.prepare("INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, permissions) VALUES ('user-viewer','vantax','viewer@vantax.co.za','Lerato Mabaso','viewer','[\"dashboard.read\"]')").run();
        // New superadmin accounts
        await c.env.DB.prepare("INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, permissions) VALUES ('user-essen-ag','vantax','essen.naidoo@agentum.com.au','Essen Naidoo','superadmin','[\"*\"]')").run();
        await c.env.DB.prepare("INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, permissions) VALUES ('user-reshigan','vantax','reshigan@vantax.co.za','Reshigan','superadmin','[\"*\"]')").run();
        // Protea tenant — new role tiers
        await c.env.DB.prepare("INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES ('protea-user-6','protea','warehouse@protea-mfg.co.za','Mandla Sithole','operator','','[\"pulse.read\",\"catalysts.read\",\"catalysts.execute\",\"mind.query\"]','active')").run();
        await c.env.DB.prepare("INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES ('protea-user-7','protea','intern@protea-mfg.co.za','Naledi Mahlangu','viewer','','[\"dashboard.read\"]','active')").run();
      } catch { /* ignore — users may already exist from fresh seed */ }

      // v20: Force-set default passwords for superadmin accounts (overwrite any stale hashes)
      const superadminPasswordAccounts = [
        'admin@vantax.co.za',
        'essen.naidoo@agentum.com.au',
      ];
      for (const saEmail of superadminPasswordAccounts) {
        try {
          const sa = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(saEmail).first();
          if (sa) {
            const hash = await hashPassword('Admin123');
            await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, sa.id).run();
          }
        } catch (err) { console.error(`v20: failed to set password for ${saEmail}:`, err); }
      }

      // Seed with demo data
      await seedDatabase(c.env.DB);

      // Seed sample test company (Protea Manufacturing)
      await seedSampleCompany(c.env.DB);

      // Seed 5 test companies across different ERPs and industries
      await seedTestCompanies(c.env.DB);

      // Mark as migrated in KV (TTL 24h — re-checks daily)
      await c.env.CACHE.put(migrationKey, 'true', { expirationTtl: 86400 });
    } catch (e) {
      console.error('Migration/seed error:', e);
      // Mark in KV anyway to avoid thundering herd retries
      await c.env.CACHE.put(migrationKey, 'error', { expirationTtl: 300 });
    }
  }
  await next();
});

// Root endpoint — versioned
app.get('/', (c) => {
  return c.json({
    name: 'Atheon™ Enterprise Intelligence Platform API',
    version: '4.0.0',
    apiVersion: 'v1',
    status: 'operational',
    endpoints: {
      auth: '/api/v1/auth',
      tenants: '/api/v1/tenants',
      iam: '/api/v1/iam',
      apex: '/api/v1/apex',
      pulse: '/api/v1/pulse',
      catalysts: '/api/v1/catalysts',
      memory: '/api/v1/memory',
      mind: '/api/v1/mind',
      erp: '/api/v1/erp',
      controlplane: '/api/v1/controlplane',
      audit: '/api/v1/audit',
      connectivity: '/api/v1/connectivity',
      notifications: '/api/v1/notifications',
      storage: '/api/v1/storage',
      realtime: '/api/v1/realtime',
      assessments: '/api/v1/assessments',
    },
    protocols: {
      mcp: '/api/v1/connectivity/mcp',
      a2a: '/api/v1/connectivity/a2a',
      websocket: '/api/v1/realtime/ws',
    },
    documentation: 'https://atheon.vantax.co.za',
  });
});

// GAP-05: Enhanced health check with DB connectivity probe
app.get('/healthz', async (c) => {
  const t0 = Date.now();
  let dbStatus = 'ok';
  let dbLatencyMs = 0;
  try {
    const dbStart = Date.now();
    await c.env.DB.prepare('SELECT 1').first();
    dbLatencyMs = Date.now() - dbStart;
  } catch (err) {
    dbStatus = 'error';
    console.error('Healthz DB probe failed:', err);
  }

  let cacheStatus = 'ok';
  try {
    await c.env.CACHE.put('healthz:probe', '1', { expirationTtl: 60 });
    const val = await c.env.CACHE.get('healthz:probe');
    if (val !== '1') cacheStatus = 'degraded';
  } catch {
    cacheStatus = 'error';
  }

  const overall = dbStatus === 'ok' && cacheStatus === 'ok' ? 'healthy' : 'degraded';
  const statusCode = overall === 'healthy' ? 200 : 503;

  return c.json({
    status: overall,
    timestamp: new Date().toISOString(),
    uptime: Date.now() - t0,
    checks: {
      database: { status: dbStatus, latencyMs: dbLatencyMs },
      cache: { status: cacheStatus },
    },
  }, statusCode);
});

// Tenant isolation middleware for protected routes (supports both /api/ and /api/v1/ prefixes)
// Auth routes are excluded (login/register don't have JWT yet)
const protectedPrefixes = ['tenants', 'iam', 'apex', 'pulse', 'catalysts', 'memory', 'mind', 'erp', 'controlplane', 'audit', 'connectivity', 'notifications', 'storage', 'realtime', 'assessments', 'deployments'];
for (const prefix of protectedPrefixes) {
  app.use(`/api/${prefix}/*`, tenantIsolation());
  app.use(`/api/v1/${prefix}/*`, tenantIsolation());
}
// Agent routes are mounted at /api/agent — outside tenantIsolation (they use X-Licence-Key, not JWT)

// Bug #3 fix: Server-side role enforcement for admin-only routes
// superadmin: full platform access (tenants, IAM, controlplane, etc.)
// support_admin: configure catalysts, manage users, IAM, ERP, connectivity
// admin: company admin with full tenant access
const platformAdminPrefixes = ['tenants'];
for (const prefix of platformAdminPrefixes) {
  app.use(`/api/${prefix}/*`, requireRole('superadmin'));
  app.use(`/api/v1/${prefix}/*`, requireRole('superadmin'));
}
const platformAdminRoutePrefixes = ['iam', 'controlplane', 'erp', 'audit', 'connectivity'];
for (const prefix of platformAdminRoutePrefixes) {
  app.use(`/api/${prefix}/*`, requireRole('superadmin', 'support_admin', 'admin'));
  app.use(`/api/v1/${prefix}/*`, requireRole('superadmin', 'support_admin', 'admin'));
}

// Mount route modules (both /api/ and /api/v1/ for backward compatibility)
const routeModules: [string, typeof auth][] = [
  ['auth', auth], ['tenants', tenants], ['iam', iam], ['apex', apex],
  ['pulse', pulse], ['catalysts', catalysts], ['memory', memory], ['mind', mind],
  ['erp', erp], ['controlplane', controlplane], ['audit', audit],
  ['connectivity', connectivity], ['notifications', notifications],
  ['storage', storage], ['realtime', realtime],
  ['deployments', deployments], ['assessments', assessments],
];
for (const [name, handler] of routeModules) {
  app.route(`/api/${name}`, handler);
  app.route(`/api/v1/${name}`, handler);
}
// Agent routes mounted separately — no tenantIsolation middleware
app.route('/api/agent', agentRoutes);
app.route('/api/v1/agent', agentRoutes);

// HTML escape helper to prevent injection in email bodies
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// POST /api/contact - Contact form submission (sends email to atheon@vantax.co.za)
app.post('/api/contact', async (c) => {
  try {
    const body = await c.req.json<{ name: string; email: string; company?: string; message: string }>();
    if (!body.name || !body.email || !body.message) {
      return c.json({ error: 'Name, email, and message are required' }, 400);
    }

    // Sanitize all user input for HTML email body
    const safeName = escapeHtml(body.name);
    const safeEmail = escapeHtml(body.email);
    const safeCompany = escapeHtml(body.company || 'Not provided');
    const safeMessage = escapeHtml(body.message).replace(/\n/g, '<br>');

    // Try to send via Microsoft Graph API if configured
    const env = c.env as Env;
    if (env.MS_GRAPH_CLIENT_ID && env.MS_GRAPH_CLIENT_SECRET && env.MS_GRAPH_TENANT_ID) {
      try {
        const tokenRes = await fetch(`https://login.microsoftonline.com/${env.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: env.MS_GRAPH_CLIENT_ID,
            client_secret: env.MS_GRAPH_CLIENT_SECRET,
            scope: 'https://graph.microsoft.com/.default',
            grant_type: 'client_credentials',
          }),
        });
        const tokenData = await tokenRes.json() as { access_token?: string };
        if (tokenData.access_token) {
          await fetch('https://graph.microsoft.com/v1.0/users/atheon@vantax.co.za/sendMail', {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: {
                subject: `Atheon Contact: ${body.name} from ${body.company || 'Unknown'}`,
                body: { contentType: 'HTML', content: `<h3>New Contact Form Submission</h3><p><strong>Name:</strong> ${safeName}</p><p><strong>Email:</strong> ${safeEmail}</p><p><strong>Company:</strong> ${safeCompany}</p><p><strong>Message:</strong></p><p>${safeMessage}</p>` },
                toRecipients: [{ emailAddress: { address: 'atheon@vantax.co.za' } }],
                replyTo: [{ emailAddress: { address: body.email, name: body.name } }],
              },
            }),
          });
        }
      } catch (err) { console.error('BUG-20: contact form Graph email send failed:', err); }
    }

    // Always log to DB as a fallback
    try {
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), 'system', 'contact_form.submitted', 'marketing', 'contact',
        JSON.stringify({ name: body.name, email: body.email, company: body.company, message: body.message }),
        'success'
      ).run();
    } catch (err) { console.error('BUG-20: contact form DB log failed:', err); }

    return c.json({ success: true, message: 'Your message has been received. We will be in touch shortly.' });
  } catch (err) {
    console.error('Contact form handler failed:', err);
    return c.json({ error: 'Failed to process contact form' }, 500);
  }
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found', path: c.req.path }, 404);
});

// Error handler — consistent format, no stack traces in production
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  const isDev = c.env?.ENVIRONMENT !== 'production';
  return c.json({
    error: 'Internal server error',
    message: isDev ? err.message : 'An unexpected error occurred',
    ...(isDev ? { stack: err.stack } : {}),
  }, 500);
});

// Export the app as the default fetch handler
// Also export scheduled handler (Cron Triggers) and queue consumer
export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
  queue: handleQueueMessage,
} satisfies ExportedHandler<Env & { CATALYST_QUEUE?: Queue<CatalystQueueMessage> }>;
