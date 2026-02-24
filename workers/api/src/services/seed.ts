import type { Env } from '../types';

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

  // Seed Health Scores
  await db.prepare('INSERT INTO health_scores (id, tenant_id, overall_score, dimensions) VALUES (?, ?, ?, ?)')
    .bind('hs-1', 'vantax', 78, JSON.stringify({
      financial_health: { score: 82, trend: 'up', delta: 3 },
      operational_efficiency: { score: 75, trend: 'down', delta: -2 },
      risk_exposure: { score: 68, trend: 'down', delta: -5 },
      talent_stability: { score: 85, trend: 'up', delta: 1 },
      market_position: { score: 79, trend: 'stable', delta: 0 },
      supply_chain_resilience: { score: 71, trend: 'up', delta: 4 },
      innovation_index: { score: 83, trend: 'up', delta: 2 },
      customer_satisfaction: { score: 81, trend: 'stable', delta: 0 },
    })).run();

  // Seed Risk Alerts
  const risks = [
    { id: 'risk-1', tenant_id: 'vantax', title: 'Durban Port Congestion Impact', description: 'Container dwell time at Durban port increased 340%. Estimated R2.3M impact on Q3 COGS if unresolved within 14 days.', severity: 'critical', category: 'supply-chain', probability: 0.87, impact_value: 2300000, recommended_actions: '["Activate alternative port routing via Cape Town","Pre-position 2 weeks safety stock for top 50 SKUs","Engage freight forwarder for air-freight contingency"]' },
    { id: 'risk-2', tenant_id: 'vantax', title: 'Key Supplier Financial Distress', description: 'Apex Trading (15% of procurement spend) shows deteriorating payment patterns. Credit rating downgraded to BB-.', severity: 'high', category: 'procurement', probability: 0.62, impact_value: 5200000, recommended_actions: '["Dual-source critical components within 30 days","Negotiate extended payment terms with backup suppliers","Monitor Apex weekly financial health via Pulse"]' },
    { id: 'risk-3', tenant_id: 'vantax', title: 'Talent Attrition in Data Engineering', description: 'Data engineering team attrition rate at 23% (industry avg 12%). Pipeline velocity declining.', severity: 'high', category: 'people', probability: 0.75, impact_value: 1800000, recommended_actions: '["Conduct retention interviews within 5 days","Benchmark compensation against market","Accelerate junior hiring pipeline"]' },
    { id: 'risk-4', tenant_id: 'vantax', title: 'IFRS 17 Compliance Gap', description: 'Insurance contract accounting transition 3 weeks behind schedule. Potential regulatory penalty.', severity: 'medium', category: 'compliance', probability: 0.45, impact_value: 800000, recommended_actions: '["Allocate additional finance resources","Engage external IFRS 17 specialist","Weekly compliance checkpoint meetings"]' },
    { id: 'risk-5', tenant_id: 'vantax', title: 'Currency Exposure ZAR/USD', description: 'Unhedged USD exposure of $4.2M. ZAR weakening trend could impact margins by 180bps.', severity: 'medium', category: 'financial', probability: 0.55, impact_value: 3200000, recommended_actions: '["Execute forward contracts for 60% of exposure","Review natural hedge opportunities","Adjust pricing model for import-heavy categories"]' },
  ];

  for (const r of risks) {
    await db.prepare('INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, probability, impact_value, recommended_actions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(r.id, r.tenant_id, r.title, r.description, r.severity, r.category, r.probability, r.impact_value, r.recommended_actions).run();
  }

  // Seed Executive Briefing
  await db.prepare('INSERT INTO executive_briefings (id, tenant_id, title, summary, risks, opportunities, kpi_movements, decisions_needed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind('brief-1', 'vantax', 'Daily Executive Briefing — 23 Feb 2026',
      'Overall business health stable at 78 (+2.3 pts). Supply chain risk elevated due to Durban port congestion. Revenue tracking 3.9% above forecast. Two catalyst escalations require executive attention.',
      JSON.stringify(['Durban port congestion — R2.3M exposure', 'Apex Trading credit downgrade — R5.2M at risk', 'Data engineering attrition at 23%']),
      JSON.stringify(['Q3 revenue trending 3.9% above forecast', 'New distributor onboarding ahead of schedule', 'Mining catalyst efficiency up 12%']),
      JSON.stringify([{ kpi: 'Revenue', movement: '+3.9%', period: 'MTD' }, { kpi: 'OTIF', movement: '-2.1%', period: '7d' }, { kpi: 'Cash Position', movement: '+R4.2M', period: 'WoW' }]),
      JSON.stringify(['Approve alternative port routing (R340K additional cost)', 'Review Apex Trading supplier risk mitigation plan'])
    ).run();

  // Seed Process Metrics
  const metrics = [
    { id: 'pm-1', tenant_id: 'vantax', name: 'Order-to-Cash Cycle', value: 4.2, unit: 'days', status: 'green', threshold_green: 5, threshold_amber: 7, threshold_red: 10, trend: '[4.5,4.3,4.4,4.2,4.1,4.2]', source_system: 'SAP S/4HANA' },
    { id: 'pm-2', tenant_id: 'vantax', name: 'Invoice Processing Time', value: 2.8, unit: 'hours', status: 'green', threshold_green: 4, threshold_amber: 8, threshold_red: 12, trend: '[3.1,2.9,3.0,2.8,2.7,2.8]', source_system: 'SAP S/4HANA' },
    { id: 'pm-3', tenant_id: 'vantax', name: 'OTIF Delivery Rate', value: 87.3, unit: '%', status: 'amber', threshold_green: 92, threshold_amber: 85, threshold_red: 75, trend: '[91.2,89.5,88.1,87.3,87.0,87.3]', source_system: 'Logistics TMS' },
    { id: 'pm-4', tenant_id: 'vantax', name: 'Procurement Cycle Time', value: 6.5, unit: 'days', status: 'green', threshold_green: 8, threshold_amber: 12, threshold_red: 15, trend: '[7.2,6.8,6.9,6.5,6.4,6.5]', source_system: 'SAP Ariba' },
    { id: 'pm-5', tenant_id: 'vantax', name: 'Cash Conversion Cycle', value: 42, unit: 'days', status: 'amber', threshold_green: 35, threshold_amber: 45, threshold_red: 60, trend: '[38,40,41,42,43,42]', source_system: 'SAP S/4HANA' },
    { id: 'pm-6', tenant_id: 'vantax', name: 'Employee Query Resolution', value: 1.5, unit: 'hours', status: 'green', threshold_green: 2, threshold_amber: 4, threshold_red: 8, trend: '[2.1,1.8,1.7,1.5,1.4,1.5]', source_system: 'ServiceNow' },
    { id: 'pm-7', tenant_id: 'vantax', name: 'Warehouse Pick Accuracy', value: 99.2, unit: '%', status: 'green', threshold_green: 98, threshold_amber: 95, threshold_red: 90, trend: '[98.8,99.0,99.1,99.2,99.3,99.2]', source_system: 'WMS' },
    { id: 'pm-8', tenant_id: 'vantax', name: 'Supplier Lead Time Variance', value: 12, unit: '%', status: 'red', threshold_green: 5, threshold_amber: 10, threshold_red: 15, trend: '[6,8,9,12,14,12]', source_system: 'SAP SRM' },
  ];

  for (const m of metrics) {
    await db.prepare('INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, trend, source_system) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(m.id, m.tenant_id, m.name, m.value, m.unit, m.status, m.threshold_green, m.threshold_amber, m.threshold_red, m.trend, m.source_system).run();
  }

  // Seed Anomalies
  const anomalyData = [
    { id: 'anom-1', tenant_id: 'vantax', metric: 'Product Returns — Electronics', severity: 'critical', expected_value: 2.1, actual_value: 9.3, deviation: 342, hypothesis: 'Batch quality issue in Q4 electronics shipment from Shenzhen supplier. Correlates with supplier change in October.' },
    { id: 'anom-2', tenant_id: 'vantax', metric: 'AP Processing Volume Spike', severity: 'high', expected_value: 450, actual_value: 892, deviation: 98, hypothesis: 'Month-end accrual catch-up combined with new vendor onboarding backlog.' },
    { id: 'anom-3', tenant_id: 'vantax', metric: 'Warehouse Dwell Time — Bay 7', severity: 'medium', expected_value: 4, actual_value: 11, deviation: 175, hypothesis: 'Forklift maintenance downtime in Bay 7. Alternative routing via Bay 3 available.' },
  ];

  for (const a of anomalyData) {
    await db.prepare('INSERT INTO anomalies (id, tenant_id, metric, severity, expected_value, actual_value, deviation, hypothesis) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(a.id, a.tenant_id, a.metric, a.severity, a.expected_value, a.actual_value, a.deviation, a.hypothesis).run();
  }

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
    { id: 'sso-1', tenant_id: 'vantax', provider: 'azure_ad', client_id: 'vantax-atheon-prod-001', issuer_url: 'https://login.microsoftonline.com/vantax-tenant-id/v2.0', enabled: 1, auto_provision: 1, default_role: 'analyst', domain_hint: 'vantax.co.za' },
    { id: 'sso-2', tenant_id: 'freshco', provider: 'okta', client_id: 'freshco-atheon-001', issuer_url: 'https://freshco.okta.com/oauth2/default', enabled: 1, auto_provision: 0, default_role: 'analyst', domain_hint: 'freshco.co.za' },
    { id: 'sso-3', tenant_id: 'deepmine', provider: 'azure_ad', client_id: 'deepmine-atheon-001', issuer_url: 'https://login.microsoftonline.com/deepmine-tenant-id/v2.0', enabled: 1, auto_provision: 1, default_role: 'operator', domain_hint: 'deepmine.co.za' },
  ];

  for (const s of ssoConfigs) {
    await db.prepare('INSERT INTO sso_configs (id, tenant_id, provider, client_id, issuer_url, enabled, auto_provision, default_role, domain_hint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(s.id, s.tenant_id, s.provider, s.client_id, s.issuer_url, s.enabled, s.auto_provision, s.default_role, s.domain_hint).run();
  }

  // Seed Process Flows
  const flows = [
    { id: 'pf-1', tenant_id: 'vantax', name: 'Procure-to-Pay', steps: JSON.stringify([
      { id: 's1', name: 'Requisition', avgDuration: 0.5, throughput: 120, status: 'healthy' },
      { id: 's2', name: 'Approval', avgDuration: 1.2, throughput: 110, status: 'healthy' },
      { id: 's3', name: 'PO Creation', avgDuration: 0.3, throughput: 108, status: 'healthy' },
      { id: 's4', name: 'Goods Receipt', avgDuration: 3.5, throughput: 95, status: 'bottleneck' },
      { id: 's5', name: 'Invoice Match', avgDuration: 0.8, throughput: 92, status: 'healthy' },
      { id: 's6', name: 'Payment', avgDuration: 1.0, throughput: 90, status: 'healthy' },
    ]), variants: 12, avg_duration: 7.3, conformance_rate: 78, bottlenecks: '["Goods Receipt — 3.5d avg, 52% of cycle time"]' },
    { id: 'pf-2', tenant_id: 'vantax', name: 'Order-to-Cash', steps: JSON.stringify([
      { id: 's1', name: 'Order Entry', avgDuration: 0.2, throughput: 200, status: 'healthy' },
      { id: 's2', name: 'Credit Check', avgDuration: 0.1, throughput: 198, status: 'healthy' },
      { id: 's3', name: 'Fulfilment', avgDuration: 1.5, throughput: 180, status: 'degraded' },
      { id: 's4', name: 'Shipping', avgDuration: 1.8, throughput: 170, status: 'healthy' },
      { id: 's5', name: 'Invoicing', avgDuration: 0.3, throughput: 168, status: 'healthy' },
      { id: 's6', name: 'Collection', avgDuration: 0.3, throughput: 165, status: 'healthy' },
    ]), variants: 8, avg_duration: 4.2, conformance_rate: 85, bottlenecks: '["Fulfilment — port congestion causing delays"]' },
  ];

  for (const f of flows) {
    await db.prepare('INSERT INTO process_flows (id, tenant_id, name, steps, variants, avg_duration, conformance_rate, bottlenecks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(f.id, f.tenant_id, f.name, f.steps, f.variants, f.avg_duration, f.conformance_rate, f.bottlenecks).run();
  }

  // Seed Correlation Events
  const correlations = [
    { id: 'ce-1', tenant_id: 'vantax', source_system: 'SAP MM', source_event: 'Supplier delivery delay > 3 days', target_system: 'SAP SD', target_impact: 'OTIF rate decline -2.3%', confidence: 0.89, lag_days: 5 },
    { id: 'ce-2', tenant_id: 'vantax', source_system: 'Salesforce', source_event: 'Large deal closure > R5M', target_system: 'SAP PP', target_impact: 'Production planning spike +40%', confidence: 0.76, lag_days: 3 },
    { id: 'ce-3', tenant_id: 'vantax', source_system: 'ServiceNow', source_event: 'IT outage > 2 hours', target_system: 'SAP FI', target_impact: 'Invoice processing backlog +65%', confidence: 0.92, lag_days: 1 },
  ];

  for (const c of correlations) {
    await db.prepare('INSERT INTO correlation_events (id, tenant_id, source_system, source_event, target_system, target_impact, confidence, lag_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(c.id, c.tenant_id, c.source_system, c.source_event, c.target_system, c.target_impact, c.confidence, c.lag_days).run();
  }

  // Seed Scenarios
  const scenarios = [
    { id: 'sc-1', tenant_id: 'vantax', title: 'Delay Limpopo Expansion 6 Months', description: 'Postpone the Limpopo distribution centre expansion by 6 months', input_query: 'What if we delay the Limpopo expansion by 6 months?', variables: '["capex_timing","logistics_capacity","market_share"]', results: JSON.stringify({ npv_impact: -4200000, risk_change: '+12%', opportunity_cost: 'R8.1M revenue delay', recommendation: 'Proceed with Phase 1 only, defer Phase 2' }), status: 'completed' },
    { id: 'sc-2', tenant_id: 'vantax', title: 'Dual-Source Critical Components', description: 'Add second supplier for top 10 critical components', input_query: 'What is the impact of dual-sourcing our top 10 critical components?', variables: '["procurement_cost","lead_time","supply_risk"]', results: JSON.stringify({ cost_increase: '+R1.8M/year', risk_reduction: '-45%', lead_time_impact: '+2 days avg', recommendation: 'Dual-source top 5 by volume, maintain single source for remaining' }), status: 'completed' },
  ];

  for (const s of scenarios) {
    await db.prepare('INSERT INTO scenarios (id, tenant_id, title, description, input_query, variables, results, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(s.id, s.tenant_id, s.title, s.description, s.input_query, s.variables, s.results, s.status).run();
  }
}
