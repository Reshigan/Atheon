import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { seedDatabase } from './services/seed';
import { apiRateLimiter, authRateLimiter, aiRateLimiter } from './middleware/ratelimit';
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

const app = new Hono<{ Bindings: Env }>();

// CORS - restricted to production and preview domains
const ALLOWED_ORIGINS = [
  'https://atheon.vantax.co.za',
  'https://atheon-33b.pages.dev',
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
  allowHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
  exposeHeaders: ['Content-Length', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
  maxAge: 86400,
  credentials: true,
}));

// Rate limiting
app.use('/api/auth/*', authRateLimiter);
app.use('/api/mind/*', aiRateLimiter);
app.use('/api/*', apiRateLimiter);

// Auto-seed database on first request
let seeded = false;
app.use('*', async (c, next) => {
  if (!seeded) {
    try {
      // Run migrations inline (create tables if not exist)
      const migrationSQL = `
        CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, industry TEXT NOT NULL DEFAULT 'general', plan TEXT NOT NULL DEFAULT 'starter', status TEXT NOT NULL DEFAULT 'active', deployment_model TEXT NOT NULL DEFAULT 'saas', region TEXT NOT NULL DEFAULT 'af-south-1', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE IF NOT EXISTS tenant_entitlements (tenant_id TEXT PRIMARY KEY REFERENCES tenants(id), layers TEXT NOT NULL DEFAULT '["apex","pulse"]', catalyst_clusters TEXT NOT NULL DEFAULT '["finance"]', max_agents INTEGER NOT NULL DEFAULT 5, max_users INTEGER NOT NULL DEFAULT 10, autonomy_tiers TEXT NOT NULL DEFAULT '["read-only"]', llm_tiers TEXT NOT NULL DEFAULT '["tier-1"]', features TEXT NOT NULL DEFAULT '[]', sso_enabled INTEGER NOT NULL DEFAULT 0, api_access INTEGER NOT NULL DEFAULT 0, custom_branding INTEGER NOT NULL DEFAULT 0, data_retention_days INTEGER NOT NULL DEFAULT 90);
        CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'analyst', password_hash TEXT, permissions TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active', last_login TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, email));
        CREATE TABLE IF NOT EXISTS iam_policies (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, description TEXT, type TEXT NOT NULL DEFAULT 'rbac', rules TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE IF NOT EXISTS sso_configs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), provider TEXT NOT NULL, client_id TEXT NOT NULL, issuer_url TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, auto_provision INTEGER NOT NULL DEFAULT 0, default_role TEXT NOT NULL DEFAULT 'analyst', domain_hint TEXT);
        CREATE TABLE IF NOT EXISTS catalyst_clusters (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, domain TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'inactive', agent_count INTEGER NOT NULL DEFAULT 0, tasks_completed INTEGER NOT NULL DEFAULT 0, tasks_in_progress INTEGER NOT NULL DEFAULT 0, success_rate REAL NOT NULL DEFAULT 0, trust_score REAL NOT NULL DEFAULT 0, autonomy_tier TEXT NOT NULL DEFAULT 'read-only', created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE IF NOT EXISTS catalyst_actions (id TEXT PRIMARY KEY, cluster_id TEXT NOT NULL REFERENCES catalyst_clusters(id), tenant_id TEXT NOT NULL REFERENCES tenants(id), catalyst_name TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', confidence REAL, input_data TEXT, output_data TEXT, reasoning TEXT, approved_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT);
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
      ];

      for (const idx of indexes) {
        await c.env.DB.prepare(idx).run();
      }

      // Seed with demo data
      await seedDatabase(c.env.DB);

      seeded = true;
    } catch (e) {
      console.error('Migration/seed error:', e);
      // Still mark as seeded to avoid repeated attempts
      seeded = true;
    }
  }
  await next();
});

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'Atheon™ Enterprise Intelligence Platform API',
    version: '1.0.0',
    status: 'operational',
    endpoints: {
      auth: '/api/auth',
      tenants: '/api/tenants',
      iam: '/api/iam',
      apex: '/api/apex',
      pulse: '/api/pulse',
      catalysts: '/api/catalysts',
      memory: '/api/memory',
      mind: '/api/mind',
      erp: '/api/erp',
      controlplane: '/api/controlplane',
      audit: '/api/audit',
    },
    documentation: 'https://atheon.vantax.co.za',
  });
});

// Health check
app.get('/healthz', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount route modules
app.route('/api/auth', auth);
app.route('/api/tenants', tenants);
app.route('/api/iam', iam);
app.route('/api/apex', apex);
app.route('/api/pulse', pulse);
app.route('/api/catalysts', catalysts);
app.route('/api/memory', memory);
app.route('/api/mind', mind);
app.route('/api/erp', erp);
app.route('/api/controlplane', controlplane);
app.route('/api/audit', audit);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found', path: c.req.path }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error', message: err.message }, 500);
});

export default app;
