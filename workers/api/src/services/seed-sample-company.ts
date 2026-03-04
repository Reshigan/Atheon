/**
 * Sample SAP Test Company Seed Data
 * Company: Protea Manufacturing (Pty) Ltd
 * Industry: Manufacturing / FMCG
 * Location: Johannesburg, South Africa
 * 
 * This seeds a realistic test company with data that simulates
 * SAP S/4HANA, Xero, Sage, and Pastel ERP connections.
 * Includes: customers, suppliers, products, invoices, POs, GL accounts,
 * journal entries, employees, bank transactions, and tax entries.
 */

export async function seedSampleCompany(db: D1Database) {
  // Check if sample company already exists
  const existing = await db.prepare('SELECT id FROM tenants WHERE id = ?').bind('protea').first();
  if (existing) return;

  // ── Tenant ──
  await db.prepare(
    'INSERT INTO tenants (id, name, slug, industry, plan, status, deployment_model, region) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind('protea', 'Protea Manufacturing (Pty) Ltd', 'protea', 'manufacturing', 'enterprise', 'active', 'hybrid', 'af-south-1').run();

  // ── Entitlements ──
  await db.prepare(
    'INSERT INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users, autonomy_tiers, llm_tiers, features, sso_enabled, api_access, custom_branding, data_retention_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    'protea',
    '["apex","pulse","catalysts","mind","memory"]',
    '["finance","procurement","supply-chain","hr","sales"]',
    30, 100,
    '["read-only","assisted","transactional"]',
    '["tier-1","tier-2","tier-3"]',
    '["scenario-modelling","process-mining","graphrag","executive-briefings","risk-alerts"]',
    1, 1, 1, 365
  ).run();

  // ── Users ──
  // Default password hash for seeded users (password: "Atheon@2026")
  // Generated with PBKDF2 100000 iterations SHA-256
  const defaultPasswordHash = 'pbkdf2:100000:c2VlZC1zYWx0LXByb3RlYQ:placeholder';

  const users = [
    { id: 'protea-user-sa', email: 'atheon@vantax.co.za', name: 'Atheon System', role: 'admin', permissions: '["*"]' },
    { id: 'protea-user-admin', email: 'reshigan@vantax.co.za', name: 'Reshigan Naidoo', role: 'admin', permissions: '["*"]' },
    { id: 'protea-user-normal', email: 'essen@vantax.co.za', name: 'Essen Naidoo', role: 'analyst', permissions: '["pulse.read","apex.read","catalysts.read","memory.read","mind.query"]' },
    { id: 'protea-user-1', email: 'ceo@protea-mfg.co.za', name: 'Thabo Mokoena', role: 'admin', permissions: '["*"]' },
    { id: 'protea-user-2', email: 'cfo@protea-mfg.co.za', name: 'Lindiwe Nkosi', role: 'executive', permissions: '["apex.*","pulse.read","catalysts.approve"]' },
    { id: 'protea-user-3', email: 'ops@protea-mfg.co.za', name: 'Johan van Wyk', role: 'manager', permissions: '["pulse.*","catalysts.read","catalysts.execute"]' },
    { id: 'protea-user-4', email: 'finance@protea-mfg.co.za', name: 'Priya Govender', role: 'analyst', permissions: '["pulse.read","apex.read"]' },
    { id: 'protea-user-6', email: 'warehouse@protea-mfg.co.za', name: 'Mandla Sithole', role: 'operator', permissions: '["pulse.read","catalysts.read","catalysts.execute","mind.query"]' },
    { id: 'protea-user-7', email: 'intern@protea-mfg.co.za', name: 'Naledi Mahlangu', role: 'viewer', permissions: '["dashboard.read"]' },
    { id: 'protea-user-5', email: 'hr@protea-mfg.co.za', name: 'Sipho Dlamini', role: 'analyst', permissions: '["pulse.read"]' },
  ];
  for (const u of users) {
    await db.prepare('INSERT INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(u.id, 'protea', u.email, u.name, u.role, defaultPasswordHash, u.permissions, 'active').run();
  }

  // ── ERP Adapter Definitions (Xero, Sage Business Cloud, Sage Pastel) ──
  const newAdapters = [
    { id: 'erp-xero', name: 'Xero', system: 'Xero', version: '2.0', protocol: 'REST', status: 'available', operations: '["REST API","Webhooks","Bank Feeds","Payroll API"]', auth_methods: '["OAuth 2.0"]' },
    { id: 'erp-sage-bc', name: 'Sage Business Cloud Accounting', system: 'Sage', version: 'v3.1', protocol: 'REST', status: 'available', operations: '["REST API","Webhooks","Banking","Reporting"]', auth_methods: '["OAuth 2.0"]' },
    { id: 'erp-sage-pastel', name: 'Sage Pastel Partner', system: 'Pastel', version: '2024.1', protocol: 'REST/SDK', status: 'available', operations: '["REST API","SDK Integration","DDE","ODBC"]', auth_methods: '["API Key","Session Auth","Username/Password"]' },
    { id: 'erp-sage-50', name: 'Sage 50cloud Pastel', system: 'Pastel', version: '2024', protocol: 'REST/SDK', status: 'available', operations: '["REST API","SDK","Pastel Connector","CSV Import"]', auth_methods: '["API Key","OAuth 2.0"]' },
    { id: 'erp-sage-intacct', name: 'Sage Intacct', system: 'Sage', version: 'R4 2024', protocol: 'REST/XML', status: 'available', operations: '["REST API","XML Gateway","Web Services","Smart Events"]', auth_methods: '["API Key","Session Auth","OAuth 2.0"]' },
    { id: 'erp-sage-300', name: 'Sage 300 (Accpac)', system: 'Sage', version: '2024', protocol: 'REST/SOAP', status: 'available', operations: '["REST API","SOAP","Views API","Macros"]', auth_methods: '["API Key","Session Auth"]' },
    { id: 'erp-sage-x3', name: 'Sage X3', system: 'Sage', version: 'V12', protocol: 'REST/SOAP', status: 'available', operations: '["REST API","SOAP Web Services","Syracuse","Batch Server"]', auth_methods: '["OAuth 2.0","Basic Auth"]' },
  ];
  for (const a of newAdapters) {
    await db.prepare('INSERT OR IGNORE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(a.id, a.name, a.system, a.version, a.protocol, a.status, a.operations, a.auth_methods).run();
  }

  // ── ERP Connections for Protea ──
  const connections = [
    {
      id: 'conn-protea-sap', adapter_id: 'erp-sap-s4',
      name: 'Protea SAP S/4HANA Production',
      status: 'connected',
      config: JSON.stringify({
        host: 's4hana.protea-mfg.co.za', client: '100', system_id: 'PMP',
        sync_entities: ['business_partners', 'sales_orders', 'purchase_orders', 'materials', 'gl_accounts'],
        base_url: 'https://s4hana.protea-mfg.co.za',
      }),
      sync_frequency: 'realtime', records_synced: 1847293,
    },
    {
      id: 'conn-protea-xero', adapter_id: 'erp-xero',
      name: 'Protea Xero — Subsidiary Accounts',
      status: 'connected',
      config: JSON.stringify({
        xero_tenant_id: 'protea-xero-tenant-001',
        sync_entities: ['invoices', 'contacts', 'accounts', 'bank_transactions', 'payments'],
        base_url: 'https://api.xero.com',
      }),
      sync_frequency: '15min', records_synced: 234521,
    },
    {
      id: 'conn-protea-sage', adapter_id: 'erp-sage-bc',
      name: 'Protea Sage Business Cloud — Payroll',
      status: 'connected',
      config: JSON.stringify({
        region: 'za',
        sync_entities: ['contacts', 'sales_invoices', 'purchase_invoices', 'ledger_accounts', 'payments'],
        base_url: 'https://api.accounting.sage.com/v3.1',
      }),
      sync_frequency: '30min', records_synced: 89432,
    },
    {
      id: 'conn-protea-pastel', adapter_id: 'erp-sage-pastel',
      name: 'Protea Sage Pastel — Legacy GL',
      status: 'connected',
      config: JSON.stringify({
        host: 'pastel.protea-mfg.local',
        company_database: 'PROTEA_2025',
        sync_entities: ['customers', 'suppliers', 'invoices', 'gl_accounts', 'gl_transactions'],
        base_url: 'https://pastel.protea-mfg.co.za',
      }),
      sync_frequency: 'hourly', records_synced: 456123,
    },
    {
      id: 'conn-protea-sf', adapter_id: 'erp-sf',
      name: 'Protea Salesforce CRM',
      status: 'connected',
      config: JSON.stringify({
        instance: 'protea-mfg.my.salesforce.com', api_version: '59.0',
        sync_entities: ['accounts', 'contacts', 'opportunities', 'leads'],
        base_url: 'https://protea-mfg.my.salesforce.com',
      }),
      sync_frequency: '5min', records_synced: 67891,
    },
  ];
  for (const c of connections) {
    await db.prepare(
      'INSERT INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
    ).bind(c.id, 'protea', c.adapter_id, c.name, c.status, c.config, c.sync_frequency, c.records_synced).run();
  }

  // ══════════════════════════════════════════════════════════
  // CANONICAL ERP DATA — Realistic South African Business Data
  // ══════════════════════════════════════════════════════════

  // ── Customers ──
  const customers = [
    { id: 'cust-001', external_id: 'BP10001', source: 'sap', name: 'Shoprite Holdings Ltd', trading_name: 'Shoprite / Checkers', reg: '1936/007721/06', vat: '4010105461', group: 'retail-major', credit_limit: 5000000, credit_balance: 1234567, terms: 'Net 30', city: 'Cape Town', province: 'Western Cape', postal: '7441', contact: 'Pieter Engelbrecht', email: 'procurement@shoprite.co.za', phone: '+27 21 980 4000' },
    { id: 'cust-002', external_id: 'BP10002', source: 'sap', name: 'Pick n Pay Stores Ltd', trading_name: 'Pick n Pay', reg: '1968/008034/06', vat: '4220101753', group: 'retail-major', credit_limit: 4500000, credit_balance: 987654, terms: 'Net 30', city: 'Cape Town', province: 'Western Cape', postal: '7700', contact: 'Sean Summers', email: 'supply@picknpay.co.za', phone: '+27 21 658 1000' },
    { id: 'cust-003', external_id: 'BP10003', source: 'sap', name: 'Woolworths Holdings Ltd', trading_name: 'Woolworths', reg: '1981/009740/06', vat: '4400109822', group: 'retail-premium', credit_limit: 3500000, credit_balance: 567890, terms: 'Net 45', city: 'Cape Town', province: 'Western Cape', postal: '7405', contact: 'Roy Bagattini', email: 'sourcing@woolworths.co.za', phone: '+27 21 407 9111' },
    { id: 'cust-004', external_id: 'BP10004', source: 'sap', name: 'SPAR Group Ltd', trading_name: 'SPAR', reg: '1967/001572/06', vat: '4070183092', group: 'retail-major', credit_limit: 3000000, credit_balance: 432100, terms: 'Net 30', city: 'Pinetown', province: 'KwaZulu-Natal', postal: '3610', contact: 'Brett Sobey', email: 'buying@spar.co.za', phone: '+27 31 719 1900' },
    { id: 'cust-005', external_id: 'BP10005', source: 'sap', name: 'Massmart Holdings Ltd', trading_name: 'Game / Makro', reg: '1940/014066/06', vat: '4730188445', group: 'wholesale', credit_limit: 4000000, credit_balance: 876543, terms: 'Net 30', city: 'Sandton', province: 'Gauteng', postal: '2196', contact: 'Mitch Sobey', email: 'procurement@massmart.co.za', phone: '+27 11 517 0000' },
    { id: 'cust-006', external_id: 'BP10006', source: 'xero', name: 'Dis-Chem Pharmacies Ltd', trading_name: 'Dis-Chem', reg: '2005/009766/06', vat: '4890201543', group: 'pharmacy-retail', credit_limit: 2000000, credit_balance: 345678, terms: 'Net 30', city: 'Midrand', province: 'Gauteng', postal: '1685', contact: 'Ivan Saltzman', email: 'procurement@dischem.co.za', phone: '+27 11 589 2800' },
    { id: 'cust-007', external_id: 'BP10007', source: 'xero', name: 'Clicks Group Ltd', trading_name: 'Clicks', reg: '1996/000645/06', vat: '4120176890', group: 'pharmacy-retail', credit_limit: 2500000, credit_balance: 234567, terms: 'Net 30', city: 'Cape Town', province: 'Western Cape', postal: '7925', contact: 'Bertina Engelbrecht', email: 'supply@clicks.co.za', phone: '+27 21 460 1911' },
    { id: 'cust-008', external_id: 'C-100', source: 'sage', name: 'TFG (The Foschini Group)', trading_name: 'Foschini / Sportscene', reg: '1937/009504/06', vat: '4050112334', group: 'retail-fashion', credit_limit: 1500000, credit_balance: 123456, terms: 'Net 45', city: 'Cape Town', province: 'Western Cape', postal: '7550', contact: 'Anthony Memory', email: 'procurement@tfg.co.za', phone: '+27 21 938 1911' },
    { id: 'cust-009', external_id: 'C-101', source: 'pastel', name: 'Takealot Online (Pty) Ltd', trading_name: 'Takealot', reg: '2011/016501/07', vat: '4830234567', group: 'e-commerce', credit_limit: 3000000, credit_balance: 567890, terms: 'Net 14', city: 'Cape Town', province: 'Western Cape', postal: '7441', contact: 'Frederik Sobey', email: 'vendors@takealot.com', phone: '+27 87 362 8000' },
    { id: 'cust-010', external_id: 'C-102', source: 'pastel', name: 'Bidvest Group Ltd', trading_name: 'Bidvest Foodservice', reg: '1946/021180/06', vat: '4010134598', group: 'foodservice', credit_limit: 2500000, credit_balance: 456789, terms: 'Net 30', city: 'Johannesburg', province: 'Gauteng', postal: '2196', contact: 'Mpumi Madisa', email: 'procurement@bidvest.co.za', phone: '+27 11 772 8700' },
    { id: 'cust-011', external_id: 'BP10011', source: 'sap', name: 'Mr Price Group Ltd', trading_name: 'Mr Price / Sheet Street', reg: '1960/002550/06', vat: '4510198765', group: 'retail-value', credit_limit: 1800000, credit_balance: 210000, terms: 'Net 30', city: 'Durban', province: 'KwaZulu-Natal', postal: '4001', contact: 'Mark Blair', email: 'buying@mrprice.co.za', phone: '+27 31 310 8000' },
    { id: 'cust-012', external_id: 'BP10012', source: 'sap', name: 'Pepkor Holdings Ltd', trading_name: 'PEP / Ackermans', reg: '2017/221869/06', vat: '4920245678', group: 'retail-value', credit_limit: 2200000, credit_balance: 345000, terms: 'Net 30', city: 'Cape Town', province: 'Western Cape', postal: '7550', contact: 'Leon Lourens', email: 'supply@pepkor.co.za', phone: '+27 21 929 4800' },
  ];

  for (const c of customers) {
    await db.prepare(
      'INSERT INTO erp_customers (id, tenant_id, external_id, source_system, name, trading_name, registration_number, vat_number, customer_group, credit_limit, credit_balance, payment_terms, city, province, postal_code, contact_name, contact_email, contact_phone, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
    ).bind(c.id, 'protea', c.external_id, c.source, c.name, c.trading_name, c.reg, c.vat, c.group, c.credit_limit, c.credit_balance, c.terms, c.city, c.province, c.postal, c.contact, c.email, c.phone).run();
  }

  // ── Suppliers ──
  const suppliers = [
    { id: 'sup-001', external_id: 'V20001', source: 'sap', name: 'Sasol Chemicals (Pty) Ltd', group: 'raw-materials', terms: 'Net 30', city: 'Sandton', province: 'Gauteng', contact: 'Fleetwood Grobler', email: 'sales@sasol.com', phone: '+27 10 344 5000', risk: 12 },
    { id: 'sup-002', external_id: 'V20002', source: 'sap', name: 'Sappi Southern Africa', group: 'packaging', terms: 'Net 45', city: 'Johannesburg', province: 'Gauteng', contact: 'Steve Binnie', email: 'orders@sappi.com', phone: '+27 11 407 8111', risk: 8 },
    { id: 'sup-003', external_id: 'V20003', source: 'sap', name: 'Nampak Ltd', group: 'packaging', terms: 'Net 30', city: 'Johannesburg', province: 'Gauteng', contact: 'Erik Gillman', email: 'sales@nampak.co.za', phone: '+27 11 719 6300', risk: 15 },
    { id: 'sup-004', external_id: 'V20004', source: 'sap', name: 'AECI Ltd', group: 'chemicals', terms: 'Net 30', city: 'Johannesburg', province: 'Gauteng', contact: 'Mark Gillman', email: 'orders@aeci.co.za', phone: '+27 11 806 8700', risk: 10 },
    { id: 'sup-005', external_id: 'V20005', source: 'sap', name: 'Barloworld Logistics', group: 'logistics', terms: 'Net 15', city: 'Johannesburg', province: 'Gauteng', contact: 'Dominic Gillman', email: 'transport@barloworld.com', phone: '+27 11 445 1000', risk: 5 },
    { id: 'sup-006', external_id: 'V-3001', source: 'xero', name: 'Plascon SA (Pty) Ltd', group: 'coatings', terms: 'Net 30', city: 'Johannesburg', province: 'Gauteng', contact: 'Sales Team', email: 'orders@plascon.co.za', phone: '+27 11 951 4500', risk: 7 },
    { id: 'sup-007', external_id: 'V-3002', source: 'sage', name: 'Mpact Ltd', group: 'packaging', terms: 'Net 30', city: 'Johannesburg', province: 'Gauteng', contact: 'Bruce Strong', email: 'sales@mpact.co.za', phone: '+27 11 994 5500', risk: 11 },
    { id: 'sup-008', external_id: 'V-3003', source: 'pastel', name: 'Imperial Logistics SA', group: 'logistics', terms: 'Net 14', city: 'Johannesburg', province: 'Gauteng', contact: 'Mohammed Akoojee', email: 'transport@imperial.co.za', phone: '+27 11 321 2000', risk: 6 },
    { id: 'sup-009', external_id: 'V20009', source: 'sap', name: 'Eskom Holdings SOC Ltd', group: 'utilities', terms: 'Net 30', city: 'Johannesburg', province: 'Gauteng', contact: 'Energy Sales', email: 'accounts@eskom.co.za', phone: '+27 11 800 2000', risk: 25 },
    { id: 'sup-010', external_id: 'V20010', source: 'sap', name: 'Rand Water', group: 'utilities', terms: 'Net 30', city: 'Johannesburg', province: 'Gauteng', contact: 'Municipal Services', email: 'billing@randwater.co.za', phone: '+27 11 682 0911', risk: 5 },
  ];

  for (const s of suppliers) {
    await db.prepare(
      'INSERT INTO erp_suppliers (id, tenant_id, external_id, source_system, name, supplier_group, payment_terms, city, province, contact_name, contact_email, contact_phone, risk_score, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
    ).bind(s.id, 'protea', s.external_id, s.source, s.name, s.group, s.terms, s.city, s.province, s.contact, s.email, s.phone, s.risk).run();
  }

  // ── Products / Materials ──
  const products = [
    { id: 'prod-001', sku: 'PM-CLN-001', name: 'ProClean All-Purpose Cleaner 750ml', cat: 'Cleaning Products', group: 'Household', cost: 18.50, sell: 34.99, stock: 45000, reorder: 10000, warehouse: 'JHB-DC1' },
    { id: 'prod-002', sku: 'PM-CLN-002', name: 'ProClean Glass & Window Spray 500ml', cat: 'Cleaning Products', group: 'Household', cost: 14.20, sell: 27.99, stock: 32000, reorder: 8000, warehouse: 'JHB-DC1' },
    { id: 'prod-003', sku: 'PM-CLN-003', name: 'ProClean Floor Polish 1L', cat: 'Cleaning Products', group: 'Household', cost: 22.80, sell: 44.99, stock: 28000, reorder: 7000, warehouse: 'JHB-DC1' },
    { id: 'prod-004', sku: 'PM-CLN-004', name: 'ProClean Bleach 2L', cat: 'Cleaning Products', group: 'Household', cost: 12.50, sell: 24.99, stock: 55000, reorder: 15000, warehouse: 'JHB-DC1' },
    { id: 'prod-005', sku: 'PM-CLN-005', name: 'ProClean Dishwashing Liquid 750ml', cat: 'Cleaning Products', group: 'Household', cost: 16.30, sell: 31.99, stock: 41000, reorder: 12000, warehouse: 'JHB-DC1' },
    { id: 'prod-006', sku: 'PM-PER-001', name: 'NaturaGlow Hand Soap 250ml', cat: 'Personal Care', group: 'Personal Care', cost: 11.80, sell: 22.99, stock: 38000, reorder: 10000, warehouse: 'JHB-DC2' },
    { id: 'prod-007', sku: 'PM-PER-002', name: 'NaturaGlow Body Lotion 400ml', cat: 'Personal Care', group: 'Personal Care', cost: 25.50, sell: 49.99, stock: 22000, reorder: 6000, warehouse: 'JHB-DC2' },
    { id: 'prod-008', sku: 'PM-PER-003', name: 'NaturaGlow Shampoo 500ml', cat: 'Personal Care', group: 'Personal Care', cost: 20.10, sell: 39.99, stock: 26000, reorder: 7000, warehouse: 'JHB-DC2' },
    { id: 'prod-009', sku: 'PM-IND-001', name: 'ProClean Industrial Degreaser 5L', cat: 'Industrial', group: 'Industrial', cost: 85.00, sell: 159.99, stock: 8500, reorder: 2000, warehouse: 'JHB-DC3' },
    { id: 'prod-010', sku: 'PM-IND-002', name: 'ProClean Surface Sanitiser 5L', cat: 'Industrial', group: 'Industrial', cost: 65.00, sell: 124.99, stock: 12000, reorder: 3000, warehouse: 'JHB-DC3' },
    { id: 'prod-011', sku: 'PM-CLN-006', name: 'ProClean Laundry Detergent 2kg', cat: 'Cleaning Products', group: 'Household', cost: 28.50, sell: 54.99, stock: 35000, reorder: 10000, warehouse: 'JHB-DC1' },
    { id: 'prod-012', sku: 'PM-CLN-007', name: 'ProClean Toilet Cleaner 500ml', cat: 'Cleaning Products', group: 'Household', cost: 13.80, sell: 26.99, stock: 48000, reorder: 12000, warehouse: 'JHB-DC1' },
    { id: 'prod-013', sku: 'PM-PER-004', name: 'NaturaGlow Conditioner 500ml', cat: 'Personal Care', group: 'Personal Care', cost: 21.30, sell: 41.99, stock: 19000, reorder: 5000, warehouse: 'JHB-DC2' },
    { id: 'prod-014', sku: 'PM-CLN-008', name: 'ProClean Fabric Softener 2L', cat: 'Cleaning Products', group: 'Household', cost: 19.90, sell: 38.99, stock: 30000, reorder: 8000, warehouse: 'JHB-DC1' },
    { id: 'prod-015', sku: 'PM-IND-003', name: 'ProClean Hand Sanitiser 5L', cat: 'Industrial', group: 'Industrial', cost: 55.00, sell: 104.99, stock: 15000, reorder: 4000, warehouse: 'JHB-DC3' },
  ];

  for (const p of products) {
    await db.prepare(
      'INSERT INTO erp_products (id, tenant_id, source_system, sku, name, category, product_group, cost_price, selling_price, stock_on_hand, reorder_level, reorder_quantity, warehouse, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
    ).bind(p.id, 'protea', 'sap', p.sku, p.name, p.cat, p.group, p.cost, p.sell, p.stock, p.reorder, p.reorder * 2, p.warehouse).run();
  }

  // ── Sales Invoices ──
  const invoices = [
    { id: 'inv-001', num: 'INV-2026-0001', cust_id: 'cust-001', cust_name: 'Shoprite Holdings Ltd', date: '2026-02-01', due: '2026-03-03', subtotal: 487500, vat: 73125, total: 560625, paid: 560625, status: 'paid', source: 'sap' },
    { id: 'inv-002', num: 'INV-2026-0002', cust_id: 'cust-002', cust_name: 'Pick n Pay Stores Ltd', date: '2026-02-03', due: '2026-03-05', subtotal: 325000, vat: 48750, total: 373750, paid: 0, status: 'sent', source: 'sap' },
    { id: 'inv-003', num: 'INV-2026-0003', cust_id: 'cust-003', cust_name: 'Woolworths Holdings Ltd', date: '2026-02-05', due: '2026-03-22', subtotal: 678900, vat: 101835, total: 780735, paid: 780735, status: 'paid', source: 'sap' },
    { id: 'inv-004', num: 'INV-2026-0004', cust_id: 'cust-004', cust_name: 'SPAR Group Ltd', date: '2026-02-07', due: '2026-03-09', subtotal: 256800, vat: 38520, total: 295320, paid: 295320, status: 'paid', source: 'sap' },
    { id: 'inv-005', num: 'INV-2026-0005', cust_id: 'cust-005', cust_name: 'Massmart Holdings Ltd', date: '2026-02-10', due: '2026-03-12', subtotal: 412300, vat: 61845, total: 474145, paid: 0, status: 'sent', source: 'sap' },
    { id: 'inv-006', num: 'XRO-2026-0006', cust_id: 'cust-006', cust_name: 'Dis-Chem Pharmacies Ltd', date: '2026-02-10', due: '2026-03-12', subtotal: 189500, vat: 28425, total: 217925, paid: 217925, status: 'paid', source: 'xero' },
    { id: 'inv-007', num: 'XRO-2026-0007', cust_id: 'cust-007', cust_name: 'Clicks Group Ltd', date: '2026-02-12', due: '2026-03-14', subtotal: 234100, vat: 35115, total: 269215, paid: 0, status: 'sent', source: 'xero' },
    { id: 'inv-008', num: 'SG-2026-0008', cust_id: 'cust-008', cust_name: 'TFG (The Foschini Group)', date: '2026-02-14', due: '2026-03-31', subtotal: 156700, vat: 23505, total: 180205, paid: 0, status: 'draft', source: 'sage' },
    { id: 'inv-009', num: 'PST-2026-0009', cust_id: 'cust-009', cust_name: 'Takealot Online (Pty) Ltd', date: '2026-02-15', due: '2026-03-01', subtotal: 345600, vat: 51840, total: 397440, paid: 397440, status: 'paid', source: 'pastel' },
    { id: 'inv-010', num: 'PST-2026-0010', cust_id: 'cust-010', cust_name: 'Bidvest Group Ltd', date: '2026-02-18', due: '2026-03-20', subtotal: 289400, vat: 43410, total: 332810, paid: 166405, status: 'partial', source: 'pastel' },
    { id: 'inv-011', num: 'INV-2026-0011', cust_id: 'cust-011', cust_name: 'Mr Price Group Ltd', date: '2026-02-19', due: '2026-03-21', subtotal: 198700, vat: 29805, total: 228505, paid: 0, status: 'sent', source: 'sap' },
    { id: 'inv-012', num: 'INV-2026-0012', cust_id: 'cust-012', cust_name: 'Pepkor Holdings Ltd', date: '2026-02-20', due: '2026-03-22', subtotal: 367200, vat: 55080, total: 422280, paid: 0, status: 'sent', source: 'sap' },
    { id: 'inv-013', num: 'INV-2026-0013', cust_id: 'cust-001', cust_name: 'Shoprite Holdings Ltd', date: '2026-02-21', due: '2026-03-23', subtotal: 523400, vat: 78510, total: 601910, paid: 0, status: 'sent', source: 'sap' },
    { id: 'inv-014', num: 'XRO-2026-0014', cust_id: 'cust-006', cust_name: 'Dis-Chem Pharmacies Ltd', date: '2026-02-22', due: '2026-03-24', subtotal: 167800, vat: 25170, total: 192970, paid: 0, status: 'draft', source: 'xero' },
    { id: 'inv-015', num: 'INV-2026-0015', cust_id: 'cust-003', cust_name: 'Woolworths Holdings Ltd', date: '2026-02-23', due: '2026-04-09', subtotal: 445600, vat: 66840, total: 512440, paid: 0, status: 'sent', source: 'sap' },
  ];

  for (const i of invoices) {
    await db.prepare(
      'INSERT INTO erp_invoices (id, tenant_id, external_id, source_system, invoice_number, customer_id, customer_name, invoice_date, due_date, subtotal, vat_amount, total, amount_paid, amount_due, status, payment_status, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
    ).bind(i.id, 'protea', i.num, i.source, i.num, i.cust_id, i.cust_name, i.date, i.due, i.subtotal, i.vat, i.total, i.paid, i.total - i.paid, i.status, i.paid >= i.total ? 'paid' : i.paid > 0 ? 'partial' : 'unpaid').run();
  }

  // ── Purchase Orders ──
  const purchaseOrders = [
    { id: 'po-001', num: 'PO-2026-0001', sup_id: 'sup-001', sup_name: 'Sasol Chemicals (Pty) Ltd', date: '2026-01-15', delivery: '2026-02-15', subtotal: 890000, vat: 133500, total: 1023500, status: 'received', source: 'sap' },
    { id: 'po-002', num: 'PO-2026-0002', sup_id: 'sup-002', sup_name: 'Sappi Southern Africa', date: '2026-01-20', delivery: '2026-02-20', subtotal: 456000, vat: 68400, total: 524400, status: 'received', source: 'sap' },
    { id: 'po-003', num: 'PO-2026-0003', sup_id: 'sup-003', sup_name: 'Nampak Ltd', date: '2026-02-01', delivery: '2026-03-01', subtotal: 678500, vat: 101775, total: 780275, status: 'in-transit', source: 'sap' },
    { id: 'po-004', num: 'PO-2026-0004', sup_id: 'sup-004', sup_name: 'AECI Ltd', date: '2026-02-05', delivery: '2026-03-05', subtotal: 234500, vat: 35175, total: 269675, status: 'confirmed', source: 'sap' },
    { id: 'po-005', num: 'PO-2026-0005', sup_id: 'sup-005', sup_name: 'Barloworld Logistics', date: '2026-02-10', delivery: '2026-02-24', subtotal: 189000, vat: 28350, total: 217350, status: 'confirmed', source: 'sap' },
    { id: 'po-006', num: 'XPO-2026-0006', sup_id: 'sup-006', sup_name: 'Plascon SA (Pty) Ltd', date: '2026-02-12', delivery: '2026-03-12', subtotal: 123400, vat: 18510, total: 141910, status: 'sent', source: 'xero' },
    { id: 'po-007', num: 'SPO-2026-0007', sup_id: 'sup-007', sup_name: 'Mpact Ltd', date: '2026-02-14', delivery: '2026-03-14', subtotal: 345600, vat: 51840, total: 397440, status: 'confirmed', source: 'sage' },
    { id: 'po-008', num: 'PPO-2026-0008', sup_id: 'sup-008', sup_name: 'Imperial Logistics SA', date: '2026-02-18', delivery: '2026-03-04', subtotal: 167800, vat: 25170, total: 192970, status: 'sent', source: 'pastel' },
    { id: 'po-009', num: 'PO-2026-0009', sup_id: 'sup-009', sup_name: 'Eskom Holdings SOC Ltd', date: '2026-02-01', delivery: '2026-02-28', subtotal: 456000, vat: 68400, total: 524400, status: 'received', source: 'sap' },
    { id: 'po-010', num: 'PO-2026-0010', sup_id: 'sup-001', sup_name: 'Sasol Chemicals (Pty) Ltd', date: '2026-02-20', delivery: '2026-03-20', subtotal: 567800, vat: 85170, total: 652970, status: 'draft', source: 'sap' },
  ];

  for (const po of purchaseOrders) {
    await db.prepare(
      'INSERT INTO erp_purchase_orders (id, tenant_id, external_id, source_system, po_number, supplier_id, supplier_name, order_date, delivery_date, subtotal, vat_amount, total, status, delivery_status, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
    ).bind(po.id, 'protea', po.num, po.source, po.num, po.sup_id, po.sup_name, po.date, po.delivery, po.subtotal, po.vat, po.total, po.status, po.status === 'received' ? 'delivered' : po.status === 'in-transit' ? 'shipped' : 'pending').run();
  }

  // ── Chart of Accounts (GL) ──
  const glAccounts = [
    // Assets
    { id: 'gl-001', code: '1000', name: 'Bank - FNB Current Account', type: 'asset', class: 'current-asset', balance: 4567890 },
    { id: 'gl-002', code: '1010', name: 'Bank - Standard Bank Savings', type: 'asset', class: 'current-asset', balance: 2345000 },
    { id: 'gl-003', code: '1100', name: 'Accounts Receivable - Trade', type: 'asset', class: 'current-asset', balance: 3456789 },
    { id: 'gl-004', code: '1200', name: 'Inventory - Finished Goods', type: 'asset', class: 'current-asset', balance: 8901234 },
    { id: 'gl-005', code: '1210', name: 'Inventory - Raw Materials', type: 'asset', class: 'current-asset', balance: 5678901 },
    { id: 'gl-006', code: '1220', name: 'Inventory - Work in Progress', type: 'asset', class: 'current-asset', balance: 1234567 },
    { id: 'gl-007', code: '1300', name: 'VAT Input', type: 'asset', class: 'current-asset', balance: 567890 },
    { id: 'gl-008', code: '1500', name: 'Property, Plant & Equipment', type: 'asset', class: 'non-current-asset', balance: 45000000 },
    { id: 'gl-009', code: '1510', name: 'Accumulated Depreciation', type: 'asset', class: 'non-current-asset', balance: -12000000 },
    { id: 'gl-010', code: '1600', name: 'Intangible Assets', type: 'asset', class: 'non-current-asset', balance: 3500000 },
    // Liabilities
    { id: 'gl-011', code: '2000', name: 'Accounts Payable - Trade', type: 'liability', class: 'current-liability', balance: -2890123 },
    { id: 'gl-012', code: '2100', name: 'VAT Output', type: 'liability', class: 'current-liability', balance: -789012 },
    { id: 'gl-013', code: '2200', name: 'PAYE Payable', type: 'liability', class: 'current-liability', balance: -456789 },
    { id: 'gl-014', code: '2300', name: 'UIF Payable', type: 'liability', class: 'current-liability', balance: -123456 },
    { id: 'gl-015', code: '2400', name: 'SDL Payable', type: 'liability', class: 'current-liability', balance: -89012 },
    { id: 'gl-016', code: '2500', name: 'Accrued Expenses', type: 'liability', class: 'current-liability', balance: -678901 },
    { id: 'gl-017', code: '2800', name: 'Long-term Loan - Nedbank', type: 'liability', class: 'non-current-liability', balance: -15000000 },
    // Equity
    { id: 'gl-018', code: '3000', name: 'Share Capital', type: 'equity', class: 'equity', balance: -10000000 },
    { id: 'gl-019', code: '3100', name: 'Retained Earnings', type: 'equity', class: 'equity', balance: -25678901 },
    // Revenue
    { id: 'gl-020', code: '4000', name: 'Sales - Household Products', type: 'revenue', class: 'revenue', balance: -18500000 },
    { id: 'gl-021', code: '4010', name: 'Sales - Personal Care', type: 'revenue', class: 'revenue', balance: -8900000 },
    { id: 'gl-022', code: '4020', name: 'Sales - Industrial Products', type: 'revenue', class: 'revenue', balance: -4200000 },
    { id: 'gl-023', code: '4100', name: 'Sales Returns & Allowances', type: 'revenue', class: 'revenue', balance: 450000 },
    // Cost of Sales
    { id: 'gl-024', code: '5000', name: 'Cost of Sales - Raw Materials', type: 'expense', class: 'cost-of-sales', balance: 9800000 },
    { id: 'gl-025', code: '5010', name: 'Cost of Sales - Direct Labour', type: 'expense', class: 'cost-of-sales', balance: 4500000 },
    { id: 'gl-026', code: '5020', name: 'Cost of Sales - Manufacturing Overhead', type: 'expense', class: 'cost-of-sales', balance: 3200000 },
    { id: 'gl-027', code: '5030', name: 'Cost of Sales - Packaging', type: 'expense', class: 'cost-of-sales', balance: 2100000 },
    // Operating Expenses
    { id: 'gl-028', code: '6000', name: 'Salaries & Wages', type: 'expense', class: 'operating-expense', balance: 6800000 },
    { id: 'gl-029', code: '6100', name: 'Rent & Rates', type: 'expense', class: 'operating-expense', balance: 2400000 },
    { id: 'gl-030', code: '6200', name: 'Electricity & Water', type: 'expense', class: 'operating-expense', balance: 1890000 },
    { id: 'gl-031', code: '6300', name: 'Transport & Distribution', type: 'expense', class: 'operating-expense', balance: 1560000 },
    { id: 'gl-032', code: '6400', name: 'Marketing & Advertising', type: 'expense', class: 'operating-expense', balance: 980000 },
    { id: 'gl-033', code: '6500', name: 'Depreciation', type: 'expense', class: 'operating-expense', balance: 1200000 },
    { id: 'gl-034', code: '6600', name: 'Insurance', type: 'expense', class: 'operating-expense', balance: 560000 },
    { id: 'gl-035', code: '6700', name: 'Professional Fees', type: 'expense', class: 'operating-expense', balance: 340000 },
  ];

  for (const gl of glAccounts) {
    await db.prepare(
      'INSERT INTO erp_gl_accounts (id, tenant_id, source_system, account_code, account_name, account_type, account_class, balance, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
    ).bind(gl.id, 'protea', 'sap', gl.code, gl.name, gl.type, gl.class, gl.balance).run();
  }

  // ── Employees ──
  const employees = [
    { id: 'emp-001', num: 'E1001', first: 'Thabo', last: 'Mokoena', email: 'ceo@protea-mfg.co.za', dept: 'Executive', pos: 'Chief Executive Officer', cc: 'CC100', hire: '2010-03-15', type: 'permanent', salary: 185000 },
    { id: 'emp-002', num: 'E1002', first: 'Lindiwe', last: 'Nkosi', email: 'cfo@protea-mfg.co.za', dept: 'Finance', pos: 'Chief Financial Officer', cc: 'CC200', hire: '2012-06-01', type: 'permanent', salary: 145000 },
    { id: 'emp-003', num: 'E1003', first: 'Johan', last: 'van Wyk', email: 'ops@protea-mfg.co.za', dept: 'Operations', pos: 'Operations Director', cc: 'CC300', hire: '2014-01-10', type: 'permanent', salary: 125000 },
    { id: 'emp-004', num: 'E1004', first: 'Priya', last: 'Govender', email: 'finance@protea-mfg.co.za', dept: 'Finance', pos: 'Financial Manager', cc: 'CC200', hire: '2016-04-01', type: 'permanent', salary: 85000 },
    { id: 'emp-005', num: 'E1005', first: 'Sipho', last: 'Dlamini', email: 'hr@protea-mfg.co.za', dept: 'Human Resources', pos: 'HR Manager', cc: 'CC400', hire: '2015-08-15', type: 'permanent', salary: 78000 },
    { id: 'emp-006', num: 'E1006', first: 'Nomsa', last: 'Khumalo', email: 'n.khumalo@protea-mfg.co.za', dept: 'Sales', pos: 'Sales Director', cc: 'CC500', hire: '2013-11-01', type: 'permanent', salary: 110000 },
    { id: 'emp-007', num: 'E1007', first: 'David', last: 'Botha', email: 'd.botha@protea-mfg.co.za', dept: 'Manufacturing', pos: 'Plant Manager', cc: 'CC300', hire: '2011-07-20', type: 'permanent', salary: 95000 },
    { id: 'emp-008', num: 'E1008', first: 'Fatima', last: 'Ebrahim', email: 'f.ebrahim@protea-mfg.co.za', dept: 'Quality', pos: 'Quality Manager', cc: 'CC310', hire: '2017-02-01', type: 'permanent', salary: 72000 },
    { id: 'emp-009', num: 'E1009', first: 'Andile', last: 'Mthembu', email: 'a.mthembu@protea-mfg.co.za', dept: 'Supply Chain', pos: 'Supply Chain Manager', cc: 'CC320', hire: '2018-05-15', type: 'permanent', salary: 82000 },
    { id: 'emp-010', num: 'E1010', first: 'Anele', last: 'Zulu', email: 'a.zulu@protea-mfg.co.za', dept: 'IT', pos: 'IT Manager', cc: 'CC600', hire: '2019-09-01', type: 'permanent', salary: 88000 },
    { id: 'emp-011', num: 'E1011', first: 'Pieter', last: 'Pretorius', email: 'p.pretorius@protea-mfg.co.za', dept: 'Manufacturing', pos: 'Production Supervisor', cc: 'CC300', hire: '2015-03-10', type: 'permanent', salary: 45000 },
    { id: 'emp-012', num: 'E1012', first: 'Grace', last: 'Molefe', email: 'g.molefe@protea-mfg.co.za', dept: 'Finance', pos: 'Accounts Clerk', cc: 'CC200', hire: '2020-01-15', type: 'permanent', salary: 28000 },
    { id: 'emp-013', num: 'E1013', first: 'Bongani', last: 'Ndlovu', email: 'b.ndlovu@protea-mfg.co.za', dept: 'Supply Chain', pos: 'Warehouse Supervisor', cc: 'CC320', hire: '2016-07-01', type: 'permanent', salary: 38000 },
    { id: 'emp-014', num: 'E1014', first: 'Lerato', last: 'Mabaso', email: 'l.mabaso@protea-mfg.co.za', dept: 'Sales', pos: 'Key Account Manager', cc: 'CC500', hire: '2019-04-01', type: 'permanent', salary: 65000 },
    { id: 'emp-015', num: 'E1015', first: 'Jacques', last: 'du Plessis', email: 'j.duplessis@protea-mfg.co.za', dept: 'Manufacturing', pos: 'Chemical Engineer', cc: 'CC300', hire: '2021-06-01', type: 'permanent', salary: 58000 },
  ];

  for (const e of employees) {
    await db.prepare(
      'INSERT INTO erp_employees (id, tenant_id, source_system, employee_number, first_name, last_name, email, department, position, cost_centre, hire_date, employment_type, gross_salary, salary_frequency, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
    ).bind(e.id, 'protea', 'sage', e.num, e.first, e.last, e.email, e.dept, e.pos, e.cc, e.hire, e.type, e.salary, 'monthly').run();
  }

  // ── Bank Transactions ──
  const bankTxns = [
    { id: 'bt-001', account: 'FNB-62123456789', date: '2026-02-01', desc: 'Shoprite Holdings - Payment INV-2026-0001', ref: 'INV-2026-0001', debit: 0, credit: 560625, balance: 4567890 },
    { id: 'bt-002', account: 'FNB-62123456789', date: '2026-02-03', desc: 'Sasol Chemicals - PO-2026-0001 Payment', ref: 'PO-2026-0001', debit: 1023500, credit: 0, balance: 3544390 },
    { id: 'bt-003', account: 'FNB-62123456789', date: '2026-02-05', desc: 'Woolworths Holdings - Payment INV-2026-0003', ref: 'INV-2026-0003', debit: 0, credit: 780735, balance: 4325125 },
    { id: 'bt-004', account: 'FNB-62123456789', date: '2026-02-07', desc: 'SPAR Group - Payment INV-2026-0004', ref: 'INV-2026-0004', debit: 0, credit: 295320, balance: 4620445 },
    { id: 'bt-005', account: 'FNB-62123456789', date: '2026-02-10', desc: 'Sappi Southern Africa - PO-2026-0002 Payment', ref: 'PO-2026-0002', debit: 524400, credit: 0, balance: 4096045 },
    { id: 'bt-006', account: 'FNB-62123456789', date: '2026-02-10', desc: 'Dis-Chem Pharmacies - Payment XRO-2026-0006', ref: 'XRO-2026-0006', debit: 0, credit: 217925, balance: 4313970 },
    { id: 'bt-007', account: 'FNB-62123456789', date: '2026-02-14', desc: 'Salary Run - February 2026', ref: 'PAY-FEB-2026', debit: 1856000, credit: 0, balance: 2457970 },
    { id: 'bt-008', account: 'FNB-62123456789', date: '2026-02-15', desc: 'Takealot - Payment PST-2026-0009', ref: 'PST-2026-0009', debit: 0, credit: 397440, balance: 2855410 },
    { id: 'bt-009', account: 'FNB-62123456789', date: '2026-02-18', desc: 'SARS - VAT Payment Jan 2026', ref: 'VAT-JAN-2026', debit: 345678, credit: 0, balance: 2509732 },
    { id: 'bt-010', account: 'FNB-62123456789', date: '2026-02-20', desc: 'Eskom - Electricity Feb 2026', ref: 'ESKOM-FEB-2026', debit: 189000, credit: 0, balance: 2320732 },
    { id: 'bt-011', account: 'FNB-62123456789', date: '2026-02-20', desc: 'Bidvest Group - Partial Payment PST-2026-0010', ref: 'PST-2026-0010', debit: 0, credit: 166405, balance: 2487137 },
    { id: 'bt-012', account: 'FNB-62123456789', date: '2026-02-22', desc: 'Rand Water - Water Feb 2026', ref: 'RW-FEB-2026', debit: 45600, credit: 0, balance: 2441537 },
  ];

  for (const bt of bankTxns) {
    await db.prepare(
      'INSERT INTO erp_bank_transactions (id, tenant_id, source_system, bank_account, transaction_date, description, reference, debit, credit, balance, reconciled, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
    ).bind(bt.id, 'protea', 'sap', bt.account, bt.date, bt.desc, bt.ref, bt.debit, bt.credit, bt.balance, 1).run();
  }

  // ── Tax Entries ──
  const taxEntries = [
    { id: 'tax-001', period: '2026-01', output: 789012, input: 567890, net: 221122, status: 'submitted' },
    { id: 'tax-002', period: '2026-02', output: 832456, input: 612345, net: 220111, status: 'draft' },
    { id: 'tax-003', period: '2025-12', output: 756000, input: 534000, net: 222000, status: 'submitted' },
    { id: 'tax-004', period: '2025-11', output: 712000, input: 498000, net: 214000, status: 'submitted' },
  ];

  for (const t of taxEntries) {
    await db.prepare(
      'INSERT INTO erp_tax_entries (id, tenant_id, source_system, tax_period, tax_type, output_vat, input_vat, net_vat, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(t.id, 'protea', 'sap', t.period, 'VAT', t.output, t.input, t.net, t.status).run();
  }

  // ── Journal Entries ──
  const journals = [
    { id: 'je-001', num: 'JE-2026-0001', date: '2026-02-01', desc: 'Sales - Shoprite Feb Batch 1', debit: 560625, credit: 560625, status: 'posted' },
    { id: 'je-002', num: 'JE-2026-0002', date: '2026-02-05', desc: 'Depreciation - Feb 2026', debit: 100000, credit: 100000, status: 'posted' },
    { id: 'je-003', num: 'JE-2026-0003', date: '2026-02-10', desc: 'Raw Material Consumption - Week 6', debit: 345000, credit: 345000, status: 'posted' },
    { id: 'je-004', num: 'JE-2026-0004', date: '2026-02-14', desc: 'Payroll Accrual - Feb 2026', debit: 1856000, credit: 1856000, status: 'posted' },
    { id: 'je-005', num: 'JE-2026-0005', date: '2026-02-20', desc: 'Inventory Adjustment - Stocktake', debit: 23450, credit: 23450, status: 'posted' },
    { id: 'je-006', num: 'JE-2026-0006', date: '2026-02-22', desc: 'Provision for Bad Debts', debit: 45000, credit: 45000, status: 'draft' },
  ];

  for (const je of journals) {
    await db.prepare(
      'INSERT INTO erp_journal_entries (id, tenant_id, source_system, journal_number, journal_date, description, total_debit, total_credit, status, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
    ).bind(je.id, 'protea', 'sap', je.num, je.date, je.desc, je.debit, je.credit, je.status).run();
  }

  // ══════════════════════════════════════════════════════════
  // PROTEA — Dashboard Seed Data (Apex, Pulse, Memory, Catalysts)
  // ══════════════════════════════════════════════════════════

  // ── Health Score ──
  // ── Risk Alerts ──
  const risks = [
    { id: 'risk-protea-1', title: 'Raw Material Price Surge — Sasol Chemicals', desc: 'Petrochemical feedstock prices up 18% MoM. Estimated R1.8M impact on COGS if sustained through Q2. Current contracts expire in 45 days.', severity: 'critical', cat: 'procurement', prob: 0.82, impact: 1800000 },
    { id: 'risk-protea-2', title: 'Eskom Load Shedding — Stage 4+', desc: 'Load shedding at Stage 4+ for next 14 days. Manufacturing output reduced by 30%. Generator diesel costs up R120K/week.', severity: 'high', cat: 'operations', prob: 0.95, impact: 2400000 },
    { id: 'risk-protea-3', title: 'Shoprite Payment Delay', desc: 'Shoprite February batch payment 12 days overdue. R601K outstanding. Credit team contacted — dispute on 3 line items.', severity: 'high', cat: 'financial', prob: 0.45, impact: 601910 },
    { id: 'risk-protea-4', title: 'Nampak Packaging Delivery Delay', desc: 'PO-2026-0003 for packaging materials delayed by 2 weeks. May cause production line stoppage on Household range.', severity: 'medium', cat: 'supply-chain', prob: 0.60, impact: 890000 },
    { id: 'risk-protea-5', title: 'BBBEE Certificate Renewal', desc: 'BBBEE certificate expires in 30 days. Level 2 status at risk if skills development spend not met. R2.1M in government contracts at risk.', severity: 'medium', cat: 'compliance', prob: 0.35, impact: 2100000 },
  ];

  for (const r of risks) {
  }

  // ── Executive Briefing ──
  // ── Process Metrics ──
  const metrics = [
    { id: 'pm-protea-1', name: 'Order-to-Cash Cycle', value: 5.8, unit: 'days', status: 'green', tg: 7, ta: 10, tr: 14, trend: '[6.2,6.0,5.9,5.8,5.7,5.8]', source: 'SAP S/4HANA' },
    { id: 'pm-protea-2', name: 'Invoice Processing Time', value: 3.2, unit: 'hours', status: 'green', tg: 4, ta: 8, tr: 12, trend: '[3.8,3.5,3.3,3.2,3.1,3.2]', source: 'Sage / Pastel' },
    { id: 'pm-protea-3', name: 'OTIF Delivery Rate', value: 82.1, unit: '%', status: 'red', tg: 92, ta: 85, tr: 80, trend: '[89.3,87.5,85.2,82.1,81.0,82.1]', source: 'SAP S/4HANA' },
    { id: 'pm-protea-4', name: 'Manufacturing Yield', value: 94.5, unit: '%', status: 'amber', tg: 97, ta: 93, tr: 88, trend: '[96.1,95.8,95.2,94.5,94.0,94.5]', source: 'SAP S/4HANA' },
    { id: 'pm-protea-5', name: 'Cash Conversion Cycle', value: 48, unit: 'days', status: 'amber', tg: 40, ta: 50, tr: 65, trend: '[43,44,46,48,49,48]', source: 'Xero / SAP' },
    { id: 'pm-protea-6', name: 'Debtor Days', value: 38, unit: 'days', status: 'amber', tg: 30, ta: 40, tr: 50, trend: '[32,34,35,38,39,38]', source: 'Xero' },
    { id: 'pm-protea-7', name: 'Production Uptime', value: 71.2, unit: '%', status: 'red', tg: 90, ta: 80, tr: 70, trend: '[88.5,85.2,78.1,71.2,70.0,71.2]', source: 'SCADA / SAP' },
    { id: 'pm-protea-8', name: 'Inventory Turnover', value: 6.8, unit: 'turns/year', status: 'green', tg: 6, ta: 4, tr: 3, trend: '[6.2,6.4,6.5,6.8,6.9,6.8]', source: 'SAP S/4HANA' },
  ];

  for (const m of metrics) {
  }

  // ── Anomalies ──
  const anomalies = [
    { id: 'anom-protea-1', metric: 'Production Uptime', severity: 'critical', expected: 88.5, actual: 71.2, deviation: 19.5, hypothesis: 'Eskom load shedding Stage 4+ causing 6+ hour daily outages. Generator capacity insufficient for full production line. Correlates with national grid instability.' },
    { id: 'anom-protea-2', metric: 'Raw Material Cost — Chemicals', severity: 'high', expected: 18.50, actual: 21.83, deviation: 18.0, hypothesis: 'Sasol petrochemical price increase driven by global crude oil spike and maintenance shutdown at Secunda plant.' },
    { id: 'anom-protea-3', metric: 'OTIF to Shoprite — Household Range', severity: 'high', expected: 95.0, actual: 78.5, deviation: 17.4, hypothesis: 'Combination of production downtime (load shedding) and Nampak packaging delays. 3 delivery windows missed in last 7 days.' },
  ];

  for (const a of anomalies) {
  }

  // ── Catalyst Clusters ──
  const clusters = [
    { id: 'cc-fin-protea', name: 'Finance Catalyst', domain: 'finance', desc: 'Invoice processing, payment runs, month-end close, debtor management', status: 'active', agents: 4, done: 623, inprog: 8, success: 96.1, trust: 93.2, tier: 'transactional' },
    { id: 'cc-proc-protea', name: 'Procurement Catalyst', domain: 'procurement', desc: 'PR to PO automation, supplier monitoring, contract lifecycle', status: 'active', agents: 3, done: 412, inprog: 5, success: 94.8, trust: 90.5, tier: 'assisted' },
    { id: 'cc-sc-protea', name: 'Supply Chain Catalyst', domain: 'supply-chain', desc: 'Demand planning, inventory optimization, OTIF tracking', status: 'active', agents: 3, done: 289, inprog: 11, success: 91.2, trust: 86.9, tier: 'assisted' },
    { id: 'cc-hr-protea', name: 'HR Catalyst', domain: 'hr', desc: 'Leave management, employee queries, payroll validation', status: 'active', agents: 2, done: 198, inprog: 3, success: 97.8, trust: 95.1, tier: 'transactional' },
    { id: 'cc-sales-protea', name: 'Sales Catalyst', domain: 'sales', desc: 'Pipeline management, customer health, quote-to-cash', status: 'active', agents: 2, done: 156, inprog: 4, success: 93.5, trust: 89.4, tier: 'read-only' },
  ];

  for (const c of clusters) {
    await db.prepare('INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, agent_count, tasks_completed, tasks_in_progress, success_rate, trust_score, autonomy_tier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(c.id, 'protea', c.name, c.domain, c.desc, c.status, c.agents, c.done, c.inprog, c.success, c.trust, c.tier).run();
  }

  // ── Agent Deployments ──
  const deployments = [
    { id: 'ad-protea-1', cluster: 'cc-fin-protea', name: 'Invoice Processor', type: 'finance-invoice', version: '2.1.0', health: 97.2, uptime: 99.95, tasks: 6234 },
    { id: 'ad-protea-2', cluster: 'cc-proc-protea', name: 'PO Automation Agent', type: 'procurement-po', version: '1.8.3', health: 94.8, uptime: 99.89, tasks: 4123 },
    { id: 'ad-protea-3', cluster: 'cc-sc-protea', name: 'Demand Planner', type: 'supply-chain-demand', version: '1.5.0', health: 92.1, uptime: 99.82, tasks: 2891 },
    { id: 'ad-protea-4', cluster: 'cc-hr-protea', name: 'HR Assistant', type: 'hr-queries', version: '1.2.0', health: 98.5, uptime: 99.97, tasks: 1983 },
    { id: 'ad-protea-5', cluster: 'cc-sales-protea', name: 'Sales Intelligence', type: 'sales-pipeline', version: '1.0.1', health: 95.6, uptime: 99.91, tasks: 1567 },
  ];

  for (const d of deployments) {
    await db.prepare('INSERT INTO agent_deployments (id, tenant_id, cluster_id, name, agent_type, status, deployment_model, version, health_score, uptime, tasks_executed, last_heartbeat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))')
      .bind(d.id, 'protea', d.cluster, d.name, d.type, 'running', 'hybrid', d.version, d.health, d.uptime, d.tasks).run();
  }

  // ── Knowledge Graph Entities ──
  const graphEntities = [
    { id: 'ge-protea-1', type: 'Organisation', name: 'Protea Manufacturing', properties: '{"revenue":"R620M","employees":450,"hq":"Johannesburg","industry":"Manufacturing/FMCG"}', source: 'system' },
    { id: 'ge-protea-2', type: 'Department', name: 'Finance', properties: '{"headcount":12,"budget":"R4.5M","systems":["SAP","Xero","Sage"]}', source: 'sap' },
    { id: 'ge-protea-3', type: 'Department', name: 'Manufacturing', properties: '{"headcount":180,"plants":2,"capacity":"500 tonnes/month"}', source: 'sap' },
    { id: 'ge-protea-4', type: 'Department', name: 'Supply Chain', properties: '{"headcount":35,"warehouses":3,"locations":["JHB-DC1","JHB-DC2","JHB-DC3"]}', source: 'sap' },
    { id: 'ge-protea-5', type: 'System', name: 'SAP S/4HANA', properties: '{"version":"2023 FPS02","type":"ERP","role":"primary"}', source: 'erp-adapter' },
    { id: 'ge-protea-6', type: 'System', name: 'Xero', properties: '{"version":"2.0","type":"Accounting","role":"subsidiary"}', source: 'erp-adapter' },
    { id: 'ge-protea-7', type: 'System', name: 'Sage Business Cloud', properties: '{"version":"v3.1","type":"Payroll/HR","role":"payroll"}', source: 'erp-adapter' },
    { id: 'ge-protea-8', type: 'System', name: 'Sage Pastel', properties: '{"version":"2024.1","type":"Legacy GL","role":"legacy"}', source: 'erp-adapter' },
    { id: 'ge-protea-9', type: 'System', name: 'Salesforce', properties: '{"version":"Spring 24","type":"CRM","role":"sales"}', source: 'erp-adapter' },
    { id: 'ge-protea-10', type: 'Product', name: 'ProClean Range', properties: '{"skus":8,"category":"Household Cleaning","revenue":"R380M"}', source: 'sap' },
    { id: 'ge-protea-11', type: 'Product', name: 'NaturaGlow Range', properties: '{"skus":4,"category":"Personal Care","revenue":"R180M"}', source: 'sap' },
    { id: 'ge-protea-12', type: 'Product', name: 'Industrial Range', properties: '{"skus":3,"category":"Industrial","revenue":"R60M"}', source: 'sap' },
    { id: 'ge-protea-13', type: 'Customer', name: 'Shoprite Holdings', properties: '{"revenue_share":"22%","credit_limit":"R5M","payment_terms":"Net 30"}', source: 'sap' },
    { id: 'ge-protea-14', type: 'Supplier', name: 'Sasol Chemicals', properties: '{"spend_share":"35%","risk_score":"12","critical":"yes"}', source: 'sap' },
    { id: 'ge-protea-15', type: 'Risk', name: 'Load Shedding Impact', properties: '{"severity":"high","probability":0.95,"impact":"R2.4M/month"}', source: 'apex' },
    { id: 'ge-protea-16', type: 'Asset', name: 'Johannesburg Plant 1', properties: '{"type":"manufacturing","capacity":"300 tonnes/month","age":"12 years"}', source: 'asset-register' },
    { id: 'ge-protea-17', type: 'KPI', name: 'OTIF Rate', properties: '{"current":82.1,"target":92,"unit":"%"}', source: 'pulse' },
    { id: 'ge-protea-18', type: 'Person', name: 'Thabo Mokoena', properties: '{"role":"CEO","department":"Executive"}', source: 'hr' },
  ];

  for (const e of graphEntities) {
    await db.prepare('INSERT INTO graph_entities (id, tenant_id, type, name, properties, confidence, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(e.id, 'protea', e.type, e.name, e.properties, 1.0, e.source).run();
  }

  // ── Knowledge Graph Relationships ──
  const graphRelationships = [
    { id: 'gr-protea-1', source: 'ge-protea-1', target: 'ge-protea-2', type: 'owns' },
    { id: 'gr-protea-2', source: 'ge-protea-1', target: 'ge-protea-3', type: 'owns' },
    { id: 'gr-protea-3', source: 'ge-protea-1', target: 'ge-protea-4', type: 'owns' },
    { id: 'gr-protea-4', source: 'ge-protea-2', target: 'ge-protea-5', type: 'uses' },
    { id: 'gr-protea-5', source: 'ge-protea-2', target: 'ge-protea-6', type: 'uses' },
    { id: 'gr-protea-6', source: 'ge-protea-2', target: 'ge-protea-7', type: 'uses' },
    { id: 'gr-protea-7', source: 'ge-protea-2', target: 'ge-protea-8', type: 'uses' },
    { id: 'gr-protea-8', source: 'ge-protea-3', target: 'ge-protea-10', type: 'produces' },
    { id: 'gr-protea-9', source: 'ge-protea-3', target: 'ge-protea-11', type: 'produces' },
    { id: 'gr-protea-10', source: 'ge-protea-3', target: 'ge-protea-12', type: 'produces' },
    { id: 'gr-protea-11', source: 'ge-protea-13', target: 'ge-protea-10', type: 'purchases' },
    { id: 'gr-protea-12', source: 'ge-protea-14', target: 'ge-protea-3', type: 'supplies' },
    { id: 'gr-protea-13', source: 'ge-protea-15', target: 'ge-protea-3', type: 'impacts' },
    { id: 'gr-protea-14', source: 'ge-protea-15', target: 'ge-protea-17', type: 'degrades' },
    { id: 'gr-protea-15', source: 'ge-protea-18', target: 'ge-protea-1', type: 'manages' },
    { id: 'gr-protea-16', source: 'ge-protea-3', target: 'ge-protea-16', type: 'operates-at' },
    { id: 'gr-protea-17', source: 'ge-protea-1', target: 'ge-protea-9', type: 'uses' },
  ];

  for (const r of graphRelationships) {
    await db.prepare('INSERT INTO graph_relationships (id, tenant_id, source_id, target_id, type, properties, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(r.id, 'protea', r.source, r.target, r.type, '{}', 1.0).run();
  }

  // ── Process Flows ──
  // ── Correlation Events ──
  const correlations = [
    { id: 'ce-protea-1', source_sys: 'Eskom', source_evt: 'Load shedding Stage 4+', target_sys: 'SAP PP', target_impact: 'Production output -30%', confidence: 0.97, lag: 0 },
    { id: 'ce-protea-2', source_sys: 'SAP PP', source_evt: 'Production line stoppage > 4hrs', target_sys: 'SAP SD', target_impact: 'OTIF rate decline -4.5%', confidence: 0.91, lag: 2 },
    { id: 'ce-protea-3', source_sys: 'Sasol', source_evt: 'Chemical price increase > 15%', target_sys: 'SAP CO', target_impact: 'Gross margin decline -1.8%', confidence: 0.85, lag: 30 },
    { id: 'ce-protea-4', source_sys: 'Salesforce', source_evt: 'Large order > R500K', target_sys: 'SAP PP', target_impact: 'Production planning spike +25%', confidence: 0.78, lag: 5 },
  ];

  for (const c of correlations) {
  }

  // ── Scenarios ──
  // ── Catalyst Actions (Issues for manual processing — with exceptions) ──
  const catalystActions = [
    {
      id: 'ca-protea-1', cluster: 'cc-fin-protea', catalyst: 'Invoice Reconciliation', action: 'Match INV-2026-0107 to PO-2026-0003',
      status: 'exception', confidence: 0.42,
      input: JSON.stringify({ invoice_id: 'INV-2026-0107', po_id: 'PO-2026-0003', amount_invoice: 234500, amount_po: 198000, variance: 36500, variance_pct: 18.4 }),
      output: JSON.stringify({ exception_type: 'amount_mismatch', exception_detail: 'Invoice amount R234,500 exceeds PO amount R198,000 by R36,500 (18.4%). Exceeds 5% tolerance threshold.', suggested_action: 'Escalate to finance manager for manual review' }),
      reasoning: 'Three-way match failed: Invoice amount R234,500 does not match PO R198,000 — variance of 18.4% exceeds configured 5% tolerance. Nampak may have included expedited shipping surcharge not in original PO.',
    },
    {
      id: 'ca-protea-2', cluster: 'cc-fin-protea', catalyst: 'Payment Run Validation', action: 'Validate payment batch BATCH-2026-FEB-W3',
      status: 'exception', confidence: 0.38,
      input: JSON.stringify({ batch_id: 'BATCH-2026-FEB-W3', total_amount: 2890000, payment_count: 47, duplicate_detected: true }),
      output: JSON.stringify({ exception_type: 'duplicate_payment', exception_detail: 'Potential duplicate: Supplier Sasol Chemicals (SUP-001) has two payments of R445,000 in same batch. Previous payment cleared 3 days ago.', suggested_action: 'Remove duplicate payment, re-validate batch' }),
      reasoning: 'Duplicate payment detection triggered for Sasol Chemicals — R445,000 appears twice in batch. First payment was processed in BATCH-2026-FEB-W2 and cleared on 2026-02-20.',
    },
    {
      id: 'ca-protea-3', cluster: 'cc-proc-protea', catalyst: 'PO Auto-Generation', action: 'Create PO for depleted raw material stock',
      status: 'exception', confidence: 0.55,
      input: JSON.stringify({ material: 'Sodium Lauryl Sulfate', current_stock_kg: 450, reorder_point_kg: 2000, supplier: 'Sasol Chemicals', price_increase: 18 }),
      output: JSON.stringify({ exception_type: 'price_threshold_exceeded', exception_detail: 'Sasol Chemicals price increase of 18% exceeds auto-approval threshold of 10%. Current price R48.50/kg vs last PO R41.10/kg.', suggested_action: 'Seek alternative supplier quote or get management approval for price increase' }),
      reasoning: 'Auto-PO blocked: Material price from Sasol has increased 18% since last order. Company policy requires management approval for price increases above 10%.',
    },
    {
      id: 'ca-protea-4', cluster: 'cc-sc-protea', catalyst: 'Demand Forecast', action: 'Adjust Q2 demand forecast for ProClean range',
      status: 'pending', confidence: 0.78,
      input: JSON.stringify({ product_range: 'ProClean', current_forecast_units: 125000, suggested_adjustment: -15000, reason: 'Shoprite order reduction' }),
      output: null,
      reasoning: 'Shoprite communicated 12% reduction in Q2 ProClean orders due to shelf-space reallocation. Recommend reducing production forecast by 15,000 units to avoid overstock.',
    },
    {
      id: 'ca-protea-5', cluster: 'cc-fin-protea', catalyst: 'Debtor Management', action: 'Escalate overdue Shoprite account',
      status: 'exception', confidence: 0.65,
      input: JSON.stringify({ customer: 'Shoprite Holdings', overdue_amount: 601910, days_overdue: 12, disputed_items: 3, total_outstanding: 1234567 }),
      output: JSON.stringify({ exception_type: 'payment_dispute', exception_detail: 'Shoprite disputes 3 line items on INV-2026-0089: (1) Short delivery on ProClean 5L x 200 cases, (2) Damaged goods claim R45,000, (3) Pricing discrepancy on NaturaGlow promo.', suggested_action: 'Schedule meeting with Shoprite procurement, prepare credit notes for valid claims' }),
      reasoning: 'Debtor aging trigger: Shoprite payment 12 days overdue for R601,910. Dispute involves short delivery, damages, and pricing. Credit team needs to resolve before automated collection escalation.',
    },
    {
      id: 'ca-protea-6', cluster: 'cc-sc-protea', catalyst: 'Inventory Optimization', action: 'Rebalance warehouse stock JHB-DC1 to JHB-DC2',
      status: 'pending', confidence: 0.82,
      input: JSON.stringify({ sku: 'PC-5L-LEMON', dc1_stock: 8500, dc2_stock: 320, dc2_demand_weekly: 1200, transfer_cost: 12500 }),
      output: null,
      reasoning: 'JHB-DC2 has only 2 days of ProClean 5L Lemon stock remaining. JHB-DC1 has 3 weeks surplus. Recommend inter-warehouse transfer of 4,000 units at R12,500 cost.',
    },
    {
      id: 'ca-protea-7', cluster: 'cc-hr-protea', catalyst: 'Leave Management', action: 'Flag excessive absenteeism in Manufacturing',
      status: 'exception', confidence: 0.71,
      input: JSON.stringify({ department: 'Manufacturing', absenteeism_rate: 14.2, threshold: 8.0, affected_employees: 12, period: 'Feb 2026' }),
      output: JSON.stringify({ exception_type: 'hr_policy_breach', exception_detail: 'Manufacturing absenteeism at 14.2% (threshold 8%). 12 employees flagged — 8 with unverified sick leave, 4 with pattern absenteeism (Mondays/Fridays).', suggested_action: 'HR to schedule return-to-work interviews, review sick leave documentation' }),
      reasoning: 'Absenteeism rate in Manufacturing is 77.5% above the 8% threshold. Pattern analysis shows Monday/Friday concentration suggesting potential abuse. Load shedding may also be a contributing factor.',
    },
    {
      id: 'ca-protea-8', cluster: 'cc-fin-protea', catalyst: 'GL Reconciliation', action: 'Reconcile bank statement vs GL for Feb 2026',
      status: 'exception', confidence: 0.48,
      input: JSON.stringify({ period: '2026-02', bank_balance: 4521890, gl_balance: 4398234, difference: 123656, unmatched_items: 7 }),
      output: JSON.stringify({ exception_type: 'reconciliation_variance', exception_detail: 'Bank-to-GL variance of R123,656. 7 unmatched items: 3 bank charges not posted (R8,900), 2 direct deposits unidentified (R89,000), 2 stale cheques (R25,756).', suggested_action: 'Post bank charges, identify direct deposits, write off stale cheques per policy' }),
      reasoning: 'Month-end bank reconciliation has R123,656 variance with 7 unmatched items. Requires manual investigation of 2 unidentified direct deposits totaling R89,000.',
    },
    {
      id: 'ca-protea-9', cluster: 'cc-proc-protea', catalyst: 'Contract Lifecycle', action: 'Alert: Nampak contract renewal in 30 days',
      status: 'pending', confidence: 0.90,
      input: JSON.stringify({ supplier: 'Nampak', contract_end: '2026-03-25', annual_value: 3200000, performance_score: 72, delivery_issues: 4 }),
      output: null,
      reasoning: 'Nampak packaging contract expires in 30 days. Performance score 72/100 with 4 delivery issues in last quarter. Consider renegotiating terms or tendering alternative suppliers.',
    },
    {
      id: 'ca-protea-10', cluster: 'cc-sales-protea', catalyst: 'Customer Health Monitor', action: 'Woolworths order volume spike analysis',
      status: 'completed', confidence: 0.92,
      input: JSON.stringify({ customer: 'Woolworths', order_increase: 15, product_range: 'NaturaGlow', period: 'Q2 2026' }),
      output: JSON.stringify({ result: 'success', detail: 'Woolworths increasing NaturaGlow orders +15% for Q2. Production capacity confirmed. Raw material availability checked — sufficient except for shea butter (2 week lead time).', action_taken: 'Adjusted production schedule, raised PO for additional shea butter' }),
      reasoning: 'Woolworths buyer confirmed 15% volume increase for NaturaGlow range. Supply chain impact assessed: capacity OK, shea butter needs early procurement.',
    },
  ];

  for (const a of catalystActions) {
    await db.prepare(
      'INSERT INTO catalyst_actions (id, cluster_id, tenant_id, catalyst_name, action, status, confidence, input_data, output_data, reasoning, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\', \'-\' || abs(random() % 7) || \' days\'))'
    ).bind(a.id, a.cluster, 'protea', a.catalyst, a.action, a.status, a.confidence, a.input, a.output, a.reasoning).run();
  }

  // ── IAM Policies ──
  await db.prepare('INSERT INTO iam_policies (id, tenant_id, name, description, type, rules) VALUES (?, ?, ?, ?, ?, ?)').bind(
    'iam-protea-1', 'protea', 'Admin Full Access', 'Full platform access for tenant administrators', 'rbac',
    '[{"id":"r1","resource":"*","actions":["*"],"effect":"allow","conditions":[]}]'
  ).run();

  await db.prepare('INSERT INTO iam_policies (id, tenant_id, name, description, type, rules) VALUES (?, ?, ?, ?, ?, ?)').bind(
    'iam-protea-2', 'protea', 'Finance Team', 'Finance team access with ERP read and catalyst approval', 'rbac',
    '[{"id":"r2","resource":"apex.*","actions":["read"],"effect":"allow","conditions":[]},{"id":"r3","resource":"pulse.*","actions":["read"],"effect":"allow","conditions":[]},{"id":"r4","resource":"catalysts.finance","actions":["read","approve"],"effect":"allow","conditions":[]}]'
  ).run();
}
