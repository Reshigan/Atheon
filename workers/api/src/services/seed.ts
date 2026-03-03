export async function seedDatabase(db: D1Database) {
  // Check if already seeded
  const existing = await db.prepare('SELECT COUNT(*) as count FROM tenants').first<{ count: number }>();
  if (existing && existing.count > 0) return;

  // Seed Tenants
  const tenants = [
    { id: 'vantax', name: 'Vanta X', slug: 'vantax', industry: 'general', plan: 'enterprise', status: 'active', deployment_model: 'saas', region: 'af-south-1' },
    { id: 'freshco', name: 'FreshCo FMCG', slug: 'freshco', industry: 'fmcg', plan: 'enterprise', status: 'active', deployment_model: 'hybrid', region: 'af-south-1' },
    { id: 'deepmine', name: 'DeepMine Holdings', slug: 'deepmine', industry: 'mining', plan: 'enterprise', status: 'active', deployment_model: 'on-premise', region: 'af-south-1' },
    { id: 'medilife', name: 'MediLife Group', slug: 'medilife', industry: 'healthcare', plan: 'professional', status: 'active', deployment_model: 'saas', region: 'eu-west-1' },
    { id: 'acme', name: 'Acme Starter', slug: 'acme', industry: 'general', plan: 'starter', status: 'active', deployment_model: 'saas', region: 'us-east-1' },
  ];

  for (const t of tenants) {
    await db.prepare('INSERT INTO tenants (id, name, slug, industry, plan, status, deployment_model, region) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(t.id, t.name, t.slug, t.industry, t.plan, t.status, t.deployment_model, t.region).run();
  }

  // Seed Entitlements
  const entitlements = [
    { tenant_id: 'vantax', layers: '["apex","pulse","catalysts","mind","memory"]', catalyst_clusters: '["finance","procurement","supply-chain","hr","sales"]', max_agents: 50, max_users: 200, autonomy_tiers: '["read-only","assisted","transactional"]', llm_tiers: '["tier-1","tier-2","tier-3"]', features: '["scenario-modelling","process-mining","graphrag","executive-briefings","risk-alerts","conflict-resolution"]', sso_enabled: 1, api_access: 1, custom_branding: 1, data_retention_days: 365 },
    { tenant_id: 'freshco', layers: '["apex","pulse","catalysts","mind","memory"]', catalyst_clusters: '["finance","procurement","supply-chain","sales","fmcg-trade"]', max_agents: 40, max_users: 150, autonomy_tiers: '["read-only","assisted","transactional"]', llm_tiers: '["tier-1","tier-2","tier-3"]', features: '["scenario-modelling","process-mining","graphrag","executive-briefings","risk-alerts"]', sso_enabled: 1, api_access: 1, custom_branding: 1, data_retention_days: 365 },
    { tenant_id: 'deepmine', layers: '["apex","pulse","catalysts","mind","memory"]', catalyst_clusters: '["finance","hr","mining-equipment","mining-safety"]', max_agents: 30, max_users: 100, autonomy_tiers: '["read-only","assisted","transactional"]', llm_tiers: '["tier-1","tier-2","tier-3"]', features: '["scenario-modelling","process-mining","graphrag","executive-briefings","risk-alerts"]', sso_enabled: 1, api_access: 1, custom_branding: 0, data_retention_days: 730 },
    { tenant_id: 'medilife', layers: '["apex","pulse","catalysts","mind"]', catalyst_clusters: '["finance","hr","healthcare-patient","healthcare-compliance"]', max_agents: 25, max_users: 100, autonomy_tiers: '["read-only","assisted"]', llm_tiers: '["tier-1","tier-2"]', features: '["process-mining","executive-briefings","risk-alerts"]', sso_enabled: 1, api_access: 1, custom_branding: 0, data_retention_days: 180 },
    { tenant_id: 'acme', layers: '["apex","pulse"]', catalyst_clusters: '["finance"]', max_agents: 5, max_users: 10, autonomy_tiers: '["read-only"]', llm_tiers: '["tier-1"]', features: '["executive-briefings"]', sso_enabled: 0, api_access: 0, custom_branding: 0, data_retention_days: 90 },
  ];

  for (const e of entitlements) {
    await db.prepare('INSERT INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users, autonomy_tiers, llm_tiers, features, sso_enabled, api_access, custom_branding, data_retention_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(e.tenant_id, e.layers, e.catalyst_clusters, e.max_agents, e.max_users, e.autonomy_tiers, e.llm_tiers, e.features, e.sso_enabled, e.api_access, e.custom_branding, e.data_retention_days).run();
  }

  // Seed Users
  const users = [
    { id: 'user-1', tenant_id: 'vantax', email: 'admin@vantax.co.za', name: 'Reshigan', role: 'admin', permissions: '["*"]' },
    { id: 'user-2', tenant_id: 'vantax', email: 'exec@vantax.co.za', name: 'Sarah Chen', role: 'executive', permissions: '["apex.*","pulse.read","catalysts.approve"]' },
    { id: 'user-essen', tenant_id: 'vantax', email: 'essen@vantax.co.za', name: 'Essen', role: 'admin', permissions: '["*"]' },
    { id: 'user-system', tenant_id: 'vantax', email: 'atheon@vantax.co.za', name: 'Atheon System', role: 'admin', permissions: '["*"]' },
    { id: 'user-3', tenant_id: 'freshco', email: 'admin@freshco.co.za', name: 'James Mthembu', role: 'admin', permissions: '["*"]' },
    { id: 'user-4', tenant_id: 'deepmine', email: 'admin@deepmine.co.za', name: 'Pieter van der Berg', role: 'admin', permissions: '["*"]' },
    { id: 'user-5', tenant_id: 'medilife', email: 'admin@medilife.co.za', name: 'Dr. Aisha Patel', role: 'admin', permissions: '["*"]' },
  ];

  for (const u of users) {
    await db.prepare('INSERT INTO users (id, tenant_id, email, name, role, permissions) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(u.id, u.tenant_id, u.email, u.name, u.role, u.permissions).run();
  }

  // Seed Catalyst Clusters
  const clusters = [
    { id: 'cc-fin-vx', tenant_id: 'vantax', name: 'Finance Catalyst', domain: 'finance', description: 'Invoice processing, payment runs, month-end close, intercompany reconciliation', status: 'active', agent_count: 6, tasks_completed: 1247, tasks_in_progress: 12, success_rate: 97.2, trust_score: 94.5, autonomy_tier: 'transactional' },
    { id: 'cc-proc-vx', tenant_id: 'vantax', name: 'Procurement Catalyst', domain: 'procurement', description: 'PR to PO automation, supplier monitoring, contract lifecycle', status: 'active', agent_count: 4, tasks_completed: 892, tasks_in_progress: 8, success_rate: 95.8, trust_score: 91.3, autonomy_tier: 'assisted' },
    { id: 'cc-sc-vx', tenant_id: 'vantax', name: 'Supply Chain Catalyst', domain: 'supply-chain', description: 'Demand sensing, inventory optimisation, OTIF tracking', status: 'active', agent_count: 5, tasks_completed: 634, tasks_in_progress: 15, success_rate: 93.1, trust_score: 88.7, autonomy_tier: 'assisted' },
    { id: 'cc-hr-vx', tenant_id: 'vantax', name: 'HR Catalyst', domain: 'hr', description: 'Workforce planning, leave management, employee queries', status: 'active', agent_count: 3, tasks_completed: 445, tasks_in_progress: 5, success_rate: 98.1, trust_score: 96.2, autonomy_tier: 'transactional' },
    { id: 'cc-sales-vx', tenant_id: 'vantax', name: 'Sales Catalyst', domain: 'sales', description: 'Pipeline management, customer health, quote-to-cash', status: 'active', agent_count: 4, tasks_completed: 312, tasks_in_progress: 7, success_rate: 91.4, trust_score: 87.8, autonomy_tier: 'read-only' },
    { id: 'cc-trade-fc', tenant_id: 'freshco', name: 'Trade Promotion Catalyst', domain: 'fmcg-trade', description: 'Plan, execute, measure trade promotions with ROI tracking', status: 'active', agent_count: 5, tasks_completed: 523, tasks_in_progress: 11, success_rate: 94.7, trust_score: 90.1, autonomy_tier: 'assisted' },
    { id: 'cc-equip-dm', tenant_id: 'deepmine', name: 'Equipment Health Catalyst', domain: 'mining-equipment', description: 'Predictive maintenance using vibration and temperature data', status: 'active', agent_count: 4, tasks_completed: 287, tasks_in_progress: 6, success_rate: 96.3, trust_score: 93.8, autonomy_tier: 'assisted' },
    { id: 'cc-patient-ml', tenant_id: 'medilife', name: 'Patient Flow Catalyst', domain: 'healthcare-patient', description: 'Bed management, ADT optimisation, ED boarding alerts', status: 'active', agent_count: 3, tasks_completed: 198, tasks_in_progress: 4, success_rate: 97.5, trust_score: 95.1, autonomy_tier: 'read-only' },
  ];

  for (const c of clusters) {
    await db.prepare('INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, agent_count, tasks_completed, tasks_in_progress, success_rate, trust_score, autonomy_tier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(c.id, c.tenant_id, c.name, c.domain, c.description, c.status, c.agent_count, c.tasks_completed, c.tasks_in_progress, c.success_rate, c.trust_score, c.autonomy_tier).run();
  }

  // Apex/Pulse insights removed — populated dynamically by catalyst execution

  // Seed ERP Adapters
  const adapters = [
    { id: 'erp-sap-s4', name: 'SAP S/4HANA', system: 'SAP', version: '2023 FPS02', protocol: 'OData v4', status: 'available', operations: '["RFC","BAPI","OData","CDS Views","IDoc"]', auth_methods: '["OAuth 2.0","X.509 Certificate","Basic Auth"]' },
    { id: 'erp-sap-ecc', name: 'SAP ECC 6.0', system: 'SAP', version: 'EHP8', protocol: 'RFC/BAPI', status: 'available', operations: '["RFC","BAPI","IDoc","ALE"]', auth_methods: '["SNC","Basic Auth"]' },
    { id: 'erp-oracle', name: 'Oracle Fusion Cloud', system: 'Oracle', version: '24B', protocol: 'REST', status: 'available', operations: '["REST API","SOAP","BI Publisher","OTBI"]', auth_methods: '["OAuth 2.0","JWT Bearer"]' },
    { id: 'erp-d365', name: 'Microsoft Dynamics 365', system: 'Microsoft', version: '10.0.38', protocol: 'OData v4', status: 'available', operations: '["OData","Custom API","Power Automate","Dataverse"]', auth_methods: '["Azure AD OAuth","Service Principal"]' },
    { id: 'erp-sf', name: 'Salesforce', system: 'Salesforce', version: 'Spring 24', protocol: 'REST/SOAP', status: 'available', operations: '["REST API","Bulk API","Streaming API","Metadata API"]', auth_methods: '["OAuth 2.0","JWT Bearer","SAML"]' },
    { id: 'erp-wd', name: 'Workday', system: 'Workday', version: '2024R1', protocol: 'REST/SOAP', status: 'available', operations: '["REST API","SOAP API","RaaS","EIB"]', auth_methods: '["OAuth 2.0","X.509","API Key"]' },
    { id: 'erp-ns', name: 'NetSuite', system: 'Oracle', version: '2024.1', protocol: 'REST/SuiteTalk', status: 'available', operations: '["REST API","SuiteTalk SOAP","SuiteQL","RESTlets"]', auth_methods: '["OAuth 2.0","Token-Based Auth"]' },
    { id: 'erp-sage', name: 'Sage Intacct', system: 'Sage', version: 'R4 2024', protocol: 'REST/XML', status: 'available', operations: '["REST API","XML Gateway","Web Services"]', auth_methods: '["API Key","Session Auth"]' },
  ];

  for (const a of adapters) {
    await db.prepare('INSERT INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(a.id, a.name, a.system, a.version, a.protocol, a.status, a.operations, a.auth_methods).run();
  }

  // Seed ERP Connections
  const connections = [
    { id: 'conn-1', tenant_id: 'vantax', adapter_id: 'erp-sap-s4', name: 'Vanta X SAP S/4HANA Production', status: 'connected', config: '{"host":"s4hana.vantax.co.za","client":"100","system_id":"S4P"}', sync_frequency: 'realtime', records_synced: 2847291 },
    { id: 'conn-2', tenant_id: 'vantax', adapter_id: 'erp-sf', name: 'Vanta X Salesforce CRM', status: 'connected', config: '{"instance":"vantax.my.salesforce.com","api_version":"59.0"}', sync_frequency: '5min', records_synced: 156432 },
    { id: 'conn-3', tenant_id: 'freshco', adapter_id: 'erp-sap-s4', name: 'FreshCo SAP S/4HANA', status: 'connected', config: '{"host":"s4.freshco.co.za","client":"200","system_id":"FCP"}', sync_frequency: 'realtime', records_synced: 1523847 },
    { id: 'conn-4', tenant_id: 'deepmine', adapter_id: 'erp-sap-ecc', name: 'DeepMine SAP ECC', status: 'connected', config: '{"host":"ecc.deepmine.co.za","client":"300","system_id":"DMP"}', sync_frequency: '15min', records_synced: 892341 },
  ];

  for (const c of connections) {
    await db.prepare('INSERT INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))')
      .bind(c.id, c.tenant_id, c.adapter_id, c.name, c.status, c.config, c.sync_frequency, c.records_synced).run();
  }

  // Seed Canonical Endpoints
  const endpoints = [
    { id: 'ep-1', domain: 'finance', path: '/api/v1/finance/invoices', method: 'GET', description: 'List invoices with filtering, pagination, and status tracking', rate_limit: 100 },
    { id: 'ep-2', domain: 'finance', path: '/api/v1/finance/payments', method: 'GET', description: 'Payment runs, cash position, bank reconciliation', rate_limit: 100 },
    { id: 'ep-3', domain: 'procurement', path: '/api/v1/procurement/purchase-orders', method: 'GET', description: 'Purchase orders, requisitions, contract management', rate_limit: 100 },
    { id: 'ep-4', domain: 'supply-chain', path: '/api/v1/supply-chain/inventory', method: 'GET', description: 'Inventory levels, safety stock, reorder points', rate_limit: 200 },
    { id: 'ep-5', domain: 'hr', path: '/api/v1/hr/employees', method: 'GET', description: 'Employee records, org structure, headcount analytics', rate_limit: 50 },
    { id: 'ep-6', domain: 'sales', path: '/api/v1/sales/opportunities', method: 'GET', description: 'Sales pipeline, opportunity scoring, forecasts', rate_limit: 100 },
    { id: 'ep-7', domain: 'crm', path: '/api/v1/crm/customers', method: 'GET', description: 'Customer master data, health scores, interaction history', rate_limit: 100 },
    { id: 'ep-8', domain: 'inventory', path: '/api/v1/inventory/stock-levels', method: 'GET', description: 'Real-time stock levels across all warehouses', rate_limit: 200 },
  ];

  for (const e of endpoints) {
    await db.prepare('INSERT INTO canonical_endpoints (id, domain, path, method, description, rate_limit) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(e.id, e.domain, e.path, e.method, e.description, e.rate_limit).run();
  }

  // Seed Graph Entities
  const entities = [
    { id: 'ge-1', tenant_id: 'vantax', type: 'Organisation', name: 'Vanta X', properties: '{"revenue":"R2.4B","employees":1200,"hq":"Johannesburg"}', confidence: 1.0, source: 'system' },
    { id: 'ge-2', tenant_id: 'vantax', type: 'Department', name: 'Finance', properties: '{"headcount":45,"budget":"R12M"}', confidence: 1.0, source: 'sap' },
    { id: 'ge-3', tenant_id: 'vantax', type: 'Department', name: 'Supply Chain', properties: '{"headcount":120,"warehouses":5}', confidence: 1.0, source: 'sap' },
    { id: 'ge-4', tenant_id: 'vantax', type: 'Process', name: 'Order-to-Cash', properties: '{"avg_duration":"4.2 days","volume":"850/month"}', confidence: 0.95, source: 'process-mining' },
    { id: 'ge-5', tenant_id: 'vantax', type: 'System', name: 'SAP S/4HANA', properties: '{"version":"2023 FPS02","type":"ERP"}', confidence: 1.0, source: 'erp-adapter' },
    { id: 'ge-6', tenant_id: 'vantax', type: 'KPI', name: 'OTIF Rate', properties: '{"current":87.3,"target":95,"unit":"%"}', confidence: 0.98, source: 'pulse' },
    { id: 'ge-7', tenant_id: 'vantax', type: 'Risk', name: 'Port Congestion Risk', properties: '{"severity":"critical","probability":0.87}', confidence: 0.92, source: 'apex' },
    { id: 'ge-8', tenant_id: 'vantax', type: 'Person', name: 'Reshigan', properties: '{"role":"CEO","department":"Executive"}', confidence: 1.0, source: 'hr' },
    { id: 'ge-9', tenant_id: 'vantax', type: 'Document', name: 'Q3 Board Report', properties: '{"type":"board-report","date":"2026-01-15"}', confidence: 1.0, source: 'sharepoint' },
    { id: 'ge-10', tenant_id: 'vantax', type: 'Asset', name: 'Johannesburg Distribution Centre', properties: '{"type":"warehouse","capacity":"50000 sqm"}', confidence: 1.0, source: 'asset-register' },
  ];

  for (const e of entities) {
    await db.prepare('INSERT INTO graph_entities (id, tenant_id, type, name, properties, confidence, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(e.id, e.tenant_id, e.type, e.name, e.properties, e.confidence, e.source).run();
  }

  // Seed Graph Relationships
  const relationships = [
    { id: 'gr-1', tenant_id: 'vantax', source_id: 'ge-1', target_id: 'ge-2', type: 'owns', properties: '{}', confidence: 1.0 },
    { id: 'gr-2', tenant_id: 'vantax', source_id: 'ge-1', target_id: 'ge-3', type: 'owns', properties: '{}', confidence: 1.0 },
    { id: 'gr-3', tenant_id: 'vantax', source_id: 'ge-2', target_id: 'ge-4', type: 'executes', properties: '{}', confidence: 0.95 },
    { id: 'gr-4', tenant_id: 'vantax', source_id: 'ge-4', target_id: 'ge-5', type: 'depends-on', properties: '{"integration":"OData v4"}', confidence: 1.0 },
    { id: 'gr-5', tenant_id: 'vantax', source_id: 'ge-3', target_id: 'ge-6', type: 'produces', properties: '{}', confidence: 0.98 },
    { id: 'gr-6', tenant_id: 'vantax', source_id: 'ge-7', target_id: 'ge-3', type: 'impacts', properties: '{"severity":"critical"}', confidence: 0.92 },
    { id: 'gr-7', tenant_id: 'vantax', source_id: 'ge-8', target_id: 'ge-1', type: 'manages', properties: '{"role":"CEO"}', confidence: 1.0 },
    { id: 'gr-8', tenant_id: 'vantax', source_id: 'ge-9', target_id: 'ge-6', type: 'references', properties: '{}', confidence: 0.9 },
    { id: 'gr-9', tenant_id: 'vantax', source_id: 'ge-3', target_id: 'ge-10', type: 'operates', properties: '{}', confidence: 1.0 },
  ];

  for (const r of relationships) {
    await db.prepare('INSERT INTO graph_relationships (id, tenant_id, source_id, target_id, type, properties, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(r.id, r.tenant_id, r.source_id, r.target_id, r.type, r.properties, r.confidence).run();
  }

  // Seed Agent Deployments
  const deployments = [
    { id: 'ad-1', tenant_id: 'vantax', cluster_id: 'cc-fin-vx', name: 'Invoice Processor Alpha', agent_type: 'finance-invoice', status: 'running', deployment_model: 'saas', version: '2.1.0', health_score: 98.5, uptime: 99.97, tasks_executed: 12847 },
    { id: 'ad-2', tenant_id: 'vantax', cluster_id: 'cc-proc-vx', name: 'PO Automation Beta', agent_type: 'procurement-po', status: 'running', deployment_model: 'saas', version: '1.8.3', health_score: 95.2, uptime: 99.91, tasks_executed: 8923 },
    { id: 'ad-3', tenant_id: 'freshco', cluster_id: 'cc-trade-fc', name: 'Trade Promo Engine', agent_type: 'fmcg-trade-promo', status: 'running', deployment_model: 'hybrid', version: '1.5.0', health_score: 94.1, uptime: 99.85, tasks_executed: 5234 },
    { id: 'ad-4', tenant_id: 'deepmine', cluster_id: 'cc-equip-dm', name: 'Equipment Monitor', agent_type: 'mining-predictive-maintenance', status: 'running', deployment_model: 'on-premise', version: '2.0.1', health_score: 97.8, uptime: 99.99, tasks_executed: 2871 },
    { id: 'ad-5', tenant_id: 'medilife', cluster_id: 'cc-patient-ml', name: 'Patient Flow Optimizer', agent_type: 'healthcare-patient-flow', status: 'running', deployment_model: 'saas', version: '1.2.0', health_score: 96.3, uptime: 99.94, tasks_executed: 1983 },
  ];

  for (const d of deployments) {
    await db.prepare('INSERT INTO agent_deployments (id, tenant_id, cluster_id, name, agent_type, status, deployment_model, version, health_score, uptime, tasks_executed, last_heartbeat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))')
      .bind(d.id, d.tenant_id, d.cluster_id, d.name, d.agent_type, d.status, d.deployment_model, d.version, d.health_score, d.uptime, d.tasks_executed).run();
  }

  // Seed IAM Policies
  const policies = [
    { id: 'iam-1', tenant_id: 'vantax', name: 'Admin Full Access', description: 'Full platform access for tenant administrators', type: 'rbac', rules: '[{"id":"r1","resource":"*","actions":["*"],"effect":"allow","conditions":[]}]' },
    { id: 'iam-2', tenant_id: 'vantax', name: 'Executive Read + Approve', description: 'C-Suite view with approval authority', type: 'rbac', rules: '[{"id":"r2","resource":"apex.*","actions":["read","write"],"effect":"allow","conditions":[]},{"id":"r3","resource":"catalysts.*","actions":["read","approve"],"effect":"allow","conditions":[]}]' },
    { id: 'iam-3', tenant_id: 'vantax', name: 'Analyst Read Only', description: 'Read-only analytics access', type: 'rbac', rules: '[{"id":"r4","resource":"pulse.*","actions":["read"],"effect":"allow","conditions":[]},{"id":"r5","resource":"memory.*","actions":["read"],"effect":"allow","conditions":[]}]' },
    { id: 'iam-4', tenant_id: 'freshco', name: 'FMCG Operations', description: 'Operations team with trade promo management', type: 'abac', rules: '[{"id":"r6","resource":"catalysts.fmcg-trade","actions":["read","write","execute"],"effect":"allow","conditions":[{"attribute":"department","operator":"eq","value":"operations"}]}]' },
  ];

  for (const p of policies) {
    await db.prepare('INSERT INTO iam_policies (id, tenant_id, name, description, type, rules) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(p.id, p.tenant_id, p.name, p.description, p.type, p.rules).run();
  }

  // Seed SSO Configs
  const ssoConfigs = [
    { id: 'sso-1', tenant_id: 'vantax', provider: 'azure_ad', client_id: '0a0bcbd9-afcb-44b9-b0ad-16e1da612f98', issuer_url: 'https://login.microsoftonline.com/998b123c-e559-479d-bbb9-cf3330469a73/v2.0', enabled: 1, auto_provision: 1, default_role: 'admin', domain_hint: 'vantax.co.za' },
    { id: 'sso-2', tenant_id: 'freshco', provider: 'okta', client_id: 'freshco-atheon-001', issuer_url: 'https://freshco.okta.com/oauth2/default', enabled: 1, auto_provision: 0, default_role: 'analyst', domain_hint: 'freshco.co.za' },
    { id: 'sso-3', tenant_id: 'deepmine', provider: 'azure_ad', client_id: 'deepmine-atheon-001', issuer_url: 'https://login.microsoftonline.com/deepmine-tenant-id/v2.0', enabled: 1, auto_provision: 1, default_role: 'operator', domain_hint: 'deepmine.co.za' },
  ];

  for (const s of ssoConfigs) {
    await db.prepare('INSERT INTO sso_configs (id, tenant_id, provider, client_id, issuer_url, enabled, auto_provision, default_role, domain_hint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(s.id, s.tenant_id, s.provider, s.client_id, s.issuer_url, s.enabled, s.auto_provision, s.default_role, s.domain_hint).run();
  }

  // Process flows, correlations, and scenarios removed — populated dynamically by catalyst execution
}
