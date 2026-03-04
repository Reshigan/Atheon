/**
 * Test Companies Seed Data
 * 5 companies across different ERP systems and industries for comprehensive testing
 *
 * Companies:
 * 1. Highveld Steel Works - SAP S/4HANA - Mining/Steel Manufacturing
 * 2. GreenLeaf Organics - Xero - Agriculture/Organic Farming
 * 3. MediBridge Clinics - Sage Business Cloud - Healthcare
 * 4. BluePeak Logistics - Sage Pastel - Logistics/Transport
 * 5. NovaTech Solutions - Oracle Fusion - Technology/SaaS
 *
 * Default password for all test users: Atheon@Test2026
 */

import { hashPassword } from '../middleware/auth';

export async function seedTestCompanies(db: D1Database) {
  // No early-return guard — INSERT OR IGNORE handles duplicates so partial
  // seeds from a previous failed run are filled in automatically.

  // Generate a real PBKDF2 hash for the default test password
  const pwHash = await hashPassword('Atheon@Test2026');

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPANY 1: HIGHVELD STEEL WORKS — SAP S/4HANA — MINING / STEEL
  // ═══════════════════════════════════════════════════════════════════════════
  await db.prepare('INSERT OR IGNORE INTO tenants (id,name,slug,industry,plan,status,deployment_model,region) VALUES (?,?,?,?,?,?,?,?)')
    .bind('highveld','Highveld Steel Works (Pty) Ltd','highveld','mining','enterprise','active','hybrid','af-south-1').run();

  await db.prepare('INSERT OR REPLACE INTO tenant_entitlements (tenant_id,layers,catalyst_clusters,max_agents,max_users,autonomy_tiers,llm_tiers,features,sso_enabled,api_access,custom_branding,data_retention_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('highveld','["apex","pulse","catalysts","mind","memory"]','["finance","procurement","supply-chain","hr","sales","mining-equipment","mining-safety","mining-ore","mining-environment"]',40,150,'["read-only","assisted","transactional"]','["tier-1","tier-2","tier-3"]','["scenario-modelling","process-mining","graphrag","executive-briefings","risk-alerts"]',1,1,1,730).run();

  const hvUsers = [
    { id:'hv-admin', email:'admin@highveld-steel.co.za', name:'Thandi Mthembu', role:'admin' },
    { id:'hv-ceo',   email:'ceo@highveld-steel.co.za',   name:'Johan van der Merwe', role:'executive' },
    { id:'hv-ops',   email:'ops@highveld-steel.co.za',   name:'Sipho Ndlovu', role:'manager' },
    { id:'hv-analyst', email:'analyst@highveld-steel.co.za', name:'Lindiwe Khumalo', role:'analyst' },
    { id:'hv-operator', email:'operator@highveld-steel.co.za', name:'Bongani Nkosi', role:'operator' },
    { id:'hv-viewer', email:'viewer@highveld-steel.co.za', name:'Nomvula Dlamini', role:'viewer' },
  ];
  for (const u of hvUsers) {
    await db.prepare('INSERT OR IGNORE INTO users (id,tenant_id,email,name,role,password_hash,permissions,status) VALUES (?,?,?,?,?,?,?,?)')
      .bind(u.id,'highveld',u.email,u.name,u.role,pwHash,'["*"]','active').run();
  }

  // ERP Connection
  await db.prepare(
    "INSERT OR IGNORE INTO erp_connections (id,tenant_id,adapter_id,name,status,config,sync_frequency,records_synced,connected_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))"
  ).bind('conn-hv-sap','highveld','erp-sap-s4','Highveld SAP S/4HANA Production','connected',
    '{"host":"s4hana.highveld-steel.co.za","client":"100","system_id":"HVS","base_url":"https://s4hana.highveld-steel.co.za"}',
    'realtime',2145678).run();

  // Catalyst Clusters
  const hvClusters = [
    {id:'cc-hv-equip',name:'Equipment Health Catalyst',domain:'mining-equipment',desc:'Predictive maintenance for blast furnaces, rolling mills, and cranes',status:'active',agents:5,done:342,prog:8,rate:94.2,trust:91.5,tier:'assisted',subs:[{name:'Predictive Maintenance',enabled:true,description:'ML-based failure prediction for heavy equipment'},{name:'Vibration Analysis',enabled:true,description:'Real-time vibration monitoring on rotating equipment'},{name:'Thermal Imaging',enabled:false,description:'IR camera analysis for refractory and electrical systems'},{name:'Lubrication Scheduling',enabled:true,description:'Automated lubrication intervals based on operating hours and conditions'},{name:'Spare Parts Forecasting',enabled:false,description:'Demand prediction for critical spares to minimize downtime'}]},
    {id:'cc-hv-safety',name:'Safety Compliance Catalyst',domain:'mining-safety',desc:'Real-time safety monitoring, incident prediction, and compliance tracking',status:'active',agents:3,done:187,prog:4,rate:97.8,trust:95.2,tier:'read-only',subs:[{name:'Incident Prediction',enabled:true,description:'Near-miss and incident trend analysis'},{name:'PPE Compliance',enabled:true,description:'Computer vision PPE detection at entry points'},{name:'Environmental Monitoring',enabled:true,description:'Gas, dust, and noise level tracking'},{name:'Fatigue Management',enabled:true,description:'Shift pattern analysis and fatigue risk scoring'},{name:'Emergency Response',enabled:false,description:'Automated emergency protocol triggering and coordination'}]},
    {id:'cc-hv-fin',name:'Finance Operations Catalyst',domain:'finance',desc:'Automated journal entries, variance analysis, and cost allocation',status:'active',agents:4,done:523,prog:12,rate:96.1,trust:93.8,tier:'transactional',subs:[{name:'Accounts Receivable',enabled:true,description:'Automated AR aging and collection workflows'},{name:'Accounts Payable',enabled:true,description:'Invoice matching and payment scheduling'},{name:'Invoice Reconciliation',enabled:true,description:'3-way match: PO, GRN, Invoice'},{name:'Cost Allocation',enabled:false,description:'Activity-based costing across cost centers'},{name:'Variance Analysis',enabled:true,description:'Budget vs actual variance detection and reporting'}]},
    {id:'cc-hv-proc',name:'Procurement Catalyst',domain:'procurement',desc:'Supplier evaluation, PO automation, and spend analytics',status:'active',agents:3,done:289,prog:6,rate:92.5,trust:89.3,tier:'assisted',subs:[{name:'Supplier Scoring',enabled:true,description:'Automated supplier risk and performance rating'},{name:'PO Automation',enabled:true,description:'Purchase order creation and approval routing'},{name:'Spend Analytics',enabled:false,description:'Category-level spend analysis and savings identification'},{name:'Contract Management',enabled:true,description:'Automated contract renewal alerts and compliance tracking'}]},
    {id:'cc-hv-supply',name:'Supply Chain Catalyst',domain:'supply-chain',desc:'Raw material logistics, inventory optimization, and demand planning for ore-to-steel pipeline',status:'active',agents:4,done:198,prog:7,rate:91.3,trust:88.7,tier:'assisted',subs:[{name:'Ore Inventory Management',enabled:true,description:'Real-time iron ore, coke, and flux inventory tracking'},{name:'Demand Forecasting',enabled:true,description:'Steel demand prediction by product grade and customer'},{name:'Inbound Logistics',enabled:true,description:'Rail and truck scheduling for raw material delivery'},{name:'Warehouse Optimization',enabled:false,description:'Stockyard layout optimization and material flow'},{name:'Supplier Lead Time Tracking',enabled:true,description:'Monitor and predict supplier delivery performance'}]},
    {id:'cc-hv-hr',name:'Workforce Management Catalyst',domain:'hr',desc:'Shift scheduling, skills tracking, safety training compliance, and workforce analytics',status:'active',agents:2,done:145,prog:3,rate:93.6,trust:90.1,tier:'read-only',subs:[{name:'Shift Scheduling',enabled:true,description:'Automated roster generation considering skills, fatigue, and leave'},{name:'Skills Matrix',enabled:true,description:'Competency tracking and gap analysis for mining operations'},{name:'Training Compliance',enabled:true,description:'Safety certification tracking and renewal reminders'},{name:'Overtime Management',enabled:false,description:'Overtime pattern analysis and budget control'},{name:'Succession Planning',enabled:false,description:'Critical role identification and talent pipeline management'}]},
    {id:'cc-hv-ore',name:'Ore Processing Catalyst',domain:'mining-ore',desc:'Smelting optimization, ore grade tracking, and yield maximization across the production line',status:'active',agents:3,done:267,prog:5,rate:93.1,trust:89.5,tier:'assisted',subs:[{name:'Grade Control',enabled:true,description:'Real-time ore grade monitoring and blending optimization'},{name:'Smelting Optimization',enabled:true,description:'Blast furnace parameter tuning for yield maximization'},{name:'Quality Prediction',enabled:true,description:'ML-based steel quality prediction from input parameters'},{name:'Energy Optimization',enabled:false,description:'Minimize energy consumption per ton of steel produced'},{name:'Slag Management',enabled:true,description:'Slag chemistry optimization and recycling tracking'}]},
    {id:'cc-hv-env',name:'Environmental Compliance Catalyst',domain:'mining-environment',desc:'Emissions monitoring, water management, waste tracking, and regulatory reporting',status:'active',agents:2,done:156,prog:2,rate:96.4,trust:94.2,tier:'read-only',subs:[{name:'Emissions Monitoring',enabled:true,description:'CO2, SO2, and particulate matter continuous monitoring'},{name:'Water Management',enabled:true,description:'Cooling water quality, recycling rates, and discharge compliance'},{name:'Waste Tracking',enabled:true,description:'Hazardous and non-hazardous waste classification and disposal tracking'},{name:'Regulatory Reporting',enabled:false,description:'Automated DMRE and DWS regulatory report generation'},{name:'Carbon Credit Tracking',enabled:false,description:'Carbon offset calculation and trading opportunity identification'}]},
    {id:'cc-hv-sales',name:'Sales & Distribution Catalyst',domain:'sales',desc:'Customer order management, pricing optimization, and delivery scheduling for steel products',status:'active',agents:2,done:178,prog:4,rate:94.8,trust:91.2,tier:'assisted',subs:[{name:'Order Management',enabled:true,description:'Automated order intake, confirmation, and prioritization'},{name:'Dynamic Pricing',enabled:false,description:'Market-based pricing recommendation for steel grades'},{name:'Delivery Scheduling',enabled:true,description:'Optimized dispatch planning linked to production schedule'},{name:'Customer Credit Scoring',enabled:true,description:'Real-time credit limit monitoring and risk assessment'}]},
  ];
  for (const c of hvClusters) {
    await db.prepare('INSERT OR REPLACE INTO catalyst_clusters (id,tenant_id,name,domain,description,status,agent_count,tasks_completed,tasks_in_progress,success_rate,trust_score,autonomy_tier,sub_catalysts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(c.id,'highveld',c.name,c.domain,c.desc,c.status,c.agents,c.done,c.prog,c.rate,c.trust,c.tier,JSON.stringify(c.subs)).run();
  }

  // Graph Entities
  const hvEntities = [
    {id:'ge-hv-1',type:'organisation',name:'Highveld Steel Works',props:'{"employees":1850,"revenue":"R4.2B","founded":1968}'},
    {id:'ge-hv-2',type:'department',name:'Smelting Operations',props:'{"headcount":320,"location":"Emalahleni"}'},
    {id:'ge-hv-3',type:'system',name:'SAP S/4HANA',props:'{"version":"2023","modules":["MM","PP","FI","CO","QM"]}'},
    {id:'ge-hv-4',type:'asset',name:'Blast Furnace #2',props:'{"capacity":"3500 tpd","commissioned":2005,"status":"degraded"}'},
    {id:'ge-hv-5',type:'kpi',name:'Steel Output',props:'{"target":50000,"actual":42500,"unit":"tons/month"}'},
    {id:'ge-hv-6',type:'risk',name:'Refractory Failure Risk',props:'{"probability":0.82,"impact":"R18M"}'},
  ];
  for (const e of hvEntities) {
    await db.prepare('INSERT OR IGNORE INTO graph_entities (id,tenant_id,type,name,properties,confidence,source) VALUES (?,?,?,?,?,?,?)')
      .bind(e.id,'highveld',e.type,e.name,e.props,0.95,'SAP S/4HANA').run();
  }

  // Graph Relationships
  const hvRels = [
    {id:'gr-hv-1',src:'ge-hv-1',tgt:'ge-hv-2',type:'owns',props:'{"since":"1968"}'},
    {id:'gr-hv-2',src:'ge-hv-2',tgt:'ge-hv-4',type:'manages',props:'{"responsibility":"production"}'},
    {id:'gr-hv-3',src:'ge-hv-3',tgt:'ge-hv-5',type:'produces',props:'{"frequency":"daily"}'},
    {id:'gr-hv-4',src:'ge-hv-4',tgt:'ge-hv-6',type:'escalates-to',props:'{"threshold":"refractory_wear > 60%"}'},
  ];
  for (const r of hvRels) {
    await db.prepare('INSERT OR IGNORE INTO graph_relationships (id,tenant_id,source_id,target_id,type,properties,confidence) VALUES (?,?,?,?,?,?,?)')
      .bind(r.id,'highveld',r.src,r.tgt,r.type,r.props,0.92).run();
  }

  // Agent Deployments
  const hvDeploys = [
    {id:'ad-hv-1',cluster:'cc-hv-equip',name:'Furnace Predictor',type:'predictive-maintenance',status:'running',model:'hybrid',ver:'2.1.0',health:94.2,uptime:99.91,tasks:342},
    {id:'ad-hv-2',cluster:'cc-hv-safety',name:'Safety Sentinel',type:'safety-monitor',status:'running',model:'hybrid',ver:'1.8.0',health:97.8,uptime:99.99,tasks:187},
  ];
  for (const d of hvDeploys) {
    await db.prepare("INSERT OR IGNORE INTO agent_deployments (id,tenant_id,cluster_id,name,agent_type,status,deployment_model,version,health_score,uptime,tasks_executed,last_heartbeat) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))")
      .bind(d.id,'highveld',d.cluster,d.name,d.type,d.status,d.model,d.ver,d.health,d.uptime,d.tasks).run();
  }

  // ERP Canonical Data — Customers
  const hvCustomers = [
    {id:'cust-hv-1',name:'ArcelorMittal SA',code:'ARCELOR-001',email:'procurement@arcelormittal.co.za',phone:'+27115551001',currency:'ZAR',balance:12500000},
    {id:'cust-hv-2',name:'Murray & Roberts',code:'M&R-001',email:'buying@murrob.co.za',phone:'+27115551002',currency:'ZAR',balance:8200000},
    {id:'cust-hv-3',name:'Group Five Construction',code:'GRP5-001',email:'steel@groupfive.co.za',phone:'+27115551003',currency:'ZAR',balance:5800000},
  ];
  for (const c of hvCustomers) {
    await db.prepare('INSERT OR IGNORE INTO erp_customers (id,tenant_id,external_id,source_system,name,contact_email,contact_phone,currency,credit_balance) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(c.id,'highveld',c.code,'SAP S/4HANA',c.name,c.email,c.phone,c.currency,c.balance).run();
  }

  // Suppliers
  const hvSuppliers = [
    {id:'sup-hv-1',name:'Kumba Iron Ore',code:'KUMBA-001',email:'sales@kumba.co.za',currency:'ZAR',balance:28000000,lead:14,rating:4.2},
    {id:'sup-hv-2',name:'Sasol Energy',code:'SASOL-001',email:'industrial@sasol.co.za',currency:'ZAR',balance:15000000,lead:3,rating:4.5},
  ];
  for (const s of hvSuppliers) {
    await db.prepare('INSERT OR IGNORE INTO erp_suppliers (id,tenant_id,external_id,source_system,name,contact_email,currency,risk_score) VALUES (?,?,?,?,?,?,?,?)')
      .bind(s.id,'highveld',s.code,'SAP S/4HANA',s.name,s.email,s.currency,s.rating).run();
  }

  // Products
  const hvProducts = [
    {id:'prod-hv-1',name:'Structural Steel H-Beam',sku:'STEEL-HB-254',category:'Structural',price:18500,stock:2400,unit:'ton'},
    {id:'prod-hv-2',name:'Flat Sheet 3mm',sku:'STEEL-FS-3MM',category:'Flat Products',price:22000,stock:1800,unit:'ton'},
  ];
  for (const p of hvProducts) {
    await db.prepare('INSERT OR IGNORE INTO erp_products (id,tenant_id,source_system,sku,name,category,selling_price,stock_on_hand) VALUES (?,?,?,?,?,?,?,?)')
      .bind(p.id,'highveld','SAP S/4HANA',p.sku,p.name,p.category,p.price,p.stock).run();
  }

  // GL Accounts
  const hvGL = [
    {id:'gl-hv-1',code:'1000',name:'Cash and Bank',type:'asset',balance:45000000},
    {id:'gl-hv-2',code:'4000',name:'Revenue - Steel Sales',type:'revenue',balance:280000000},
    {id:'gl-hv-3',code:'5000',name:'Cost of Raw Materials',type:'expense',balance:165000000},
    {id:'gl-hv-4',code:'5100',name:'Energy Costs',type:'expense',balance:42000000},
  ];
  for (const g of hvGL) {
    await db.prepare('INSERT OR IGNORE INTO erp_gl_accounts (id,tenant_id,source_system,account_code,account_name,account_type,balance) VALUES (?,?,?,?,?,?,?)')
      .bind(g.id,'highveld','SAP S/4HANA',g.code,g.name,g.type,g.balance).run();
  }

  // Employees
  const hvEmps = [
    {id:'emp-hv-1',empNum:'HVS-001',first:'Johan',last:'van der Merwe',dept:'Executive',pos:'CEO'},
    {id:'emp-hv-2',empNum:'HVS-042',first:'Sipho',last:'Ndlovu',dept:'Smelting Operations',pos:'Operations Manager'},
    {id:'emp-hv-3',empNum:'HVS-105',first:'Lindiwe',last:'Khumalo',dept:'Finance',pos:'Senior Analyst'},
  ];
  for (const e of hvEmps) {
    await db.prepare('INSERT OR IGNORE INTO erp_employees (id,tenant_id,source_system,employee_number,first_name,last_name,department,position) VALUES (?,?,?,?,?,?,?,?)')
      .bind(e.id,'highveld','SAP S/4HANA',e.empNum,e.first,e.last,e.dept,e.pos).run();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPANY 2: GREENLEAF ORGANICS — XERO — AGRICULTURE
  // ═══════════════════════════════════════════════════════════════════════════
  await db.prepare('INSERT OR IGNORE INTO tenants (id,name,slug,industry,plan,status,deployment_model,region) VALUES (?,?,?,?,?,?,?,?)')
    .bind('greenleaf','GreenLeaf Organics (Pty) Ltd','greenleaf','agriculture','professional','active','saas','af-south-1').run();

  await db.prepare('INSERT OR REPLACE INTO tenant_entitlements (tenant_id,layers,catalyst_clusters,max_agents,max_users,autonomy_tiers,llm_tiers,features,sso_enabled,api_access,custom_branding,data_retention_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('greenleaf','["apex","pulse","catalysts","mind"]','["finance","supply-chain","sales","hr","agri-crop","agri-irrigation","agri-quality","agri-market"]',20,50,'["read-only","assisted"]','["tier-1","tier-2"]','["executive-briefings","risk-alerts","process-mining"]',0,1,0,180).run();

  const glUsers = [
    {id:'gl-admin',email:'admin@greenleaf-organics.co.za',name:'Sarah van Niekerk',role:'admin'},
    {id:'gl-exec', email:'ceo@greenleaf-organics.co.za',   name:'Jan du Plessis',role:'executive'},
    {id:'gl-ops',  email:'ops@greenleaf-organics.co.za',   name:'Mandla Dube',role:'manager'},
    {id:'gl-fin',  email:'finance@greenleaf-organics.co.za',name:'Riana Pretorius',role:'analyst'},
    {id:'gl-operator',email:'operator@greenleaf-organics.co.za',name:'Themba Moyo',role:'operator'},
    {id:'gl-viewer',email:'viewer@greenleaf-organics.co.za',name:'Anele Sithole',role:'viewer'},
  ];
  for (const u of glUsers) {
    await db.prepare('INSERT OR IGNORE INTO users (id,tenant_id,email,name,role,password_hash,permissions,status) VALUES (?,?,?,?,?,?,?,?)')
      .bind(u.id,'greenleaf',u.email,u.name,u.role,pwHash,'["*"]','active').run();
  }

  await db.prepare(
    "INSERT OR IGNORE INTO erp_connections (id,tenant_id,adapter_id,name,status,config,sync_frequency,records_synced,connected_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))"
  ).bind('conn-gl-xero','greenleaf','erp-xero','GreenLeaf Xero Accounting','connected',
    '{"xero_tenant_id":"gl-xero-tenant-001","base_url":"https://api.xero.com","oauth_scope":"accounting.transactions accounting.contacts"}',
    '15min',45678).run();

  const glClusters = [
    {id:'cc-gl-fin',name:'Finance Catalyst',domain:'finance',desc:'Automated invoicing, expense categorization, cash flow forecasting',status:'active',agents:2,done:456,prog:5,rate:95.3,trust:92.1,tier:'assisted',subs:[{name:'Accounts Receivable',enabled:true,description:'Invoice generation and debtor management'},{name:'Accounts Payable',enabled:true,description:'Supplier payment scheduling'},{name:'Cash Flow Forecast',enabled:true,description:'12-week rolling cash flow projection'},{name:'Seasonal Budget Planning',enabled:true,description:'Crop cycle-aligned budget forecasting and variance tracking'},{name:'Grant & Subsidy Tracking',enabled:false,description:'Agricultural grant applications and compliance monitoring'}]},
    {id:'cc-gl-supply',name:'Supply Chain Catalyst',domain:'supply-chain',desc:'Harvest planning, cold chain monitoring, distributor coordination',status:'active',agents:3,done:234,prog:7,rate:91.8,trust:88.5,tier:'read-only',subs:[{name:'Harvest Planning',enabled:true,description:'Seasonal yield forecasting and resource allocation'},{name:'Cold Chain Monitor',enabled:true,description:'Temperature and humidity tracking in transit'},{name:'Distributor Coordination',enabled:false,description:'Automated order fulfillment and delivery scheduling'},{name:'Traceability',enabled:true,description:'Field-to-fork traceability for organic certification and recalls'},{name:'Packaging Optimization',enabled:false,description:'Optimal pack size and material selection based on buyer requirements'}]},
    {id:'cc-gl-crop',name:'Crop Intelligence Catalyst',domain:'agri-crop',desc:'Soil analysis, crop health monitoring, pest prediction, and yield optimization using satellite and IoT data',status:'active',agents:3,done:312,prog:6,rate:92.7,trust:89.4,tier:'assisted',subs:[{name:'Soil Health Monitoring',enabled:true,description:'Real-time soil moisture, pH, and nutrient level tracking'},{name:'Pest & Disease Prediction',enabled:true,description:'ML-based pest outbreak prediction using weather and historical data'},{name:'Crop Rotation Planning',enabled:true,description:'Optimal rotation schedules for soil health and yield maximization'},{name:'Satellite Imagery Analysis',enabled:false,description:'NDVI and multispectral analysis for crop health assessment'},{name:'Weather Impact Modeling',enabled:true,description:'Micro-climate forecasting and frost/hail risk assessment'}]},
    {id:'cc-gl-irrigation',name:'Irrigation Management Catalyst',domain:'agri-irrigation',desc:'Smart irrigation scheduling, water usage optimization, and borehole management',status:'active',agents:2,done:189,prog:3,rate:94.5,trust:91.8,tier:'assisted',subs:[{name:'Smart Scheduling',enabled:true,description:'Soil moisture-driven irrigation scheduling'},{name:'Water Budget Management',enabled:true,description:'Farm-level water allocation and usage tracking'},{name:'Borehole Monitoring',enabled:true,description:'Groundwater level tracking and pump efficiency monitoring'},{name:'Drip System Health',enabled:false,description:'Leak detection and pressure monitoring on drip irrigation lines'},{name:'Rainwater Harvesting',enabled:false,description:'Rainwater capture optimization and storage management'}]},
    {id:'cc-gl-quality',name:'Quality Assurance Catalyst',domain:'agri-quality',desc:'Organic certification compliance, produce grading, and quality testing automation',status:'active',agents:2,done:145,prog:2,rate:97.8,trust:96.1,tier:'read-only',subs:[{name:'Organic Certification',enabled:true,description:'SAOSO certification requirement tracking and documentation'},{name:'Produce Grading',enabled:true,description:'Automated visual grading and size classification'},{name:'Pesticide Residue Testing',enabled:true,description:'Lab test scheduling and result tracking for compliance'},{name:'Shelf Life Prediction',enabled:false,description:'ML model predicting shelf life based on harvest conditions'},{name:'GAP Compliance',enabled:true,description:'Good Agricultural Practices audit checklist automation'}]},
    {id:'cc-gl-market',name:'Market Intelligence Catalyst',domain:'agri-market',desc:'Fresh produce pricing, buyer demand signals, and market access optimization',status:'active',agents:2,done:98,prog:4,rate:90.2,trust:86.5,tier:'read-only',subs:[{name:'Price Monitoring',enabled:true,description:'Daily fresh produce market price tracking across major markets'},{name:'Demand Forecasting',enabled:true,description:'Retailer order pattern analysis and demand prediction'},{name:'Export Opportunity',enabled:false,description:'International market access and phytosanitary compliance'},{name:'Competitor Benchmarking',enabled:false,description:'Regional organic farm yield and pricing benchmarking'}]},
    {id:'cc-gl-sales',name:'Sales & Distribution Catalyst',domain:'sales',desc:'Customer order management, route-to-market optimization, and retailer relationship management',status:'active',agents:2,done:167,prog:3,rate:93.1,trust:90.3,tier:'assisted',subs:[{name:'Order Management',enabled:true,description:'Automated order intake from retailers and distributors'},{name:'Route-to-Market',enabled:true,description:'Optimal delivery route and schedule planning'},{name:'Retailer Scorecarding',enabled:false,description:'Buyer performance tracking and relationship health scoring'},{name:'Seasonal Promotions',enabled:true,description:'Produce availability-linked promotional campaign coordination'}]},
    {id:'cc-gl-hr',name:'Farm Workforce Catalyst',domain:'hr',desc:'Seasonal labor planning, worker safety, and skills tracking for agricultural operations',status:'active',agents:1,done:87,prog:2,rate:91.5,trust:88.2,tier:'read-only',subs:[{name:'Seasonal Labor Planning',enabled:true,description:'Harvest labor demand forecasting and recruitment scheduling'},{name:'Worker Safety',enabled:true,description:'Heat stress monitoring and chemical handling compliance'},{name:'Skills & Certification',enabled:true,description:'Pesticide applicator licenses and equipment operator certifications'},{name:'Payroll Integration',enabled:false,description:'Piece-rate and hourly payroll calculation automation'}]},
  ];
  for (const c of glClusters) {
    await db.prepare('INSERT OR REPLACE INTO catalyst_clusters (id,tenant_id,name,domain,description,status,agent_count,tasks_completed,tasks_in_progress,success_rate,trust_score,autonomy_tier,sub_catalysts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(c.id,'greenleaf',c.name,c.domain,c.desc,c.status,c.agents,c.done,c.prog,c.rate,c.trust,c.tier,JSON.stringify(c.subs)).run();
  }

  // Graph Entities
  const glEntities = [
    {id:'ge-gl-1',type:'organisation',name:'GreenLeaf Organics',props:'{"employees":85,"revenue":"R42M","farms":5}'},
    {id:'ge-gl-2',type:'process',name:'Organic Certification',props:'{"certifier":"SAOSO","valid_until":"2027-03-15"}'},
    {id:'ge-gl-3',type:'system',name:'Xero Accounting',props:'{"plan":"Premium","connected":"2024-01-15"}'},
  ];
  for (const e of glEntities) {
    await db.prepare('INSERT OR IGNORE INTO graph_entities (id,tenant_id,type,name,properties,confidence,source) VALUES (?,?,?,?,?,?,?)')
      .bind(e.id,'greenleaf',e.type,e.name,e.props,0.93,'Xero').run();
  }

  // ERP Data
  const glCustomers = [
    {id:'cust-gl-1',name:'Woolworths Food',code:'WW-001',email:'produce@woolworths.co.za',currency:'ZAR',balance:1250000},
    {id:'cust-gl-2',name:'Checkers FreshX',code:'CHK-001',email:'fresh@checkers.co.za',currency:'ZAR',balance:890000},
    {id:'cust-gl-3',name:'Food Lovers Market',code:'FLM-001',email:'buying@foodlovers.co.za',currency:'ZAR',balance:650000},
  ];
  for (const c of glCustomers) {
    await db.prepare('INSERT OR IGNORE INTO erp_customers (id,tenant_id,external_id,source_system,name,contact_email,currency,credit_balance) VALUES (?,?,?,?,?,?,?,?)')
      .bind(c.id,'greenleaf',c.code,'Xero',c.name,c.email,c.currency,c.balance).run();
  }

  const glSuppliers = [
    {id:'sup-gl-1',name:'Starke Ayres Seeds',code:'SA-001',email:'orders@starkeayres.co.za',currency:'ZAR',balance:320000,lead:7,rating:4.6},
    {id:'sup-gl-2',name:'Omnia Fertilizer',code:'OMN-001',email:'agri@omnia.co.za',currency:'ZAR',balance:185000,lead:5,rating:4.3},
  ];
  for (const s of glSuppliers) {
    await db.prepare('INSERT OR IGNORE INTO erp_suppliers (id,tenant_id,external_id,source_system,name,contact_email,currency,risk_score) VALUES (?,?,?,?,?,?,?,?)')
      .bind(s.id,'greenleaf',s.code,'Xero',s.name,s.email,s.currency,s.rating).run();
  }

  const glProducts = [
    {id:'prod-gl-1',name:'Organic Baby Spinach 200g',sku:'GL-SPIN-200',category:'Leafy Greens',price:28.99,stock:4500,unit:'pack'},
    {id:'prod-gl-2',name:'Organic Avocados (6-pack)',sku:'GL-AVO-6PK',category:'Fruit',price:69.99,stock:2800,unit:'pack'},
    {id:'prod-gl-3',name:'Heritage Tomatoes 500g',sku:'GL-TOM-500',category:'Vegetables',price:34.99,stock:3200,unit:'pack'},
  ];
  for (const p of glProducts) {
    await db.prepare('INSERT OR IGNORE INTO erp_products (id,tenant_id,source_system,sku,name,category,selling_price,stock_on_hand) VALUES (?,?,?,?,?,?,?,?)')
      .bind(p.id,'greenleaf','Xero',p.sku,p.name,p.category,p.price,p.stock).run();
  }

  const glGL = [
    {id:'gl-gl-1',code:'1000',name:'Business Bank Account',type:'asset',balance:2800000},
    {id:'gl-gl-2',code:'4000',name:'Revenue - Produce Sales',type:'revenue',balance:28000000},
    {id:'gl-gl-3',code:'5000',name:'Cost of Seeds & Inputs',type:'expense',balance:4200000},
  ];
  for (const g of glGL) {
    await db.prepare('INSERT OR IGNORE INTO erp_gl_accounts (id,tenant_id,source_system,account_code,account_name,account_type,balance) VALUES (?,?,?,?,?,?,?)')
      .bind(g.id,'greenleaf','Xero',g.code,g.name,g.type,g.balance).run();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPANY 3: MEDIBRIDGE CLINICS — SAGE BUSINESS CLOUD — HEALTHCARE
  // ═══════════════════════════════════════════════════════════════════════════
  await db.prepare('INSERT OR IGNORE INTO tenants (id,name,slug,industry,plan,status,deployment_model,region) VALUES (?,?,?,?,?,?,?,?)')
    .bind('medibridge','MediBridge Clinics Group','medibridge','healthcare','enterprise','active','saas','af-south-1').run();

  await db.prepare('INSERT OR REPLACE INTO tenant_entitlements (tenant_id,layers,catalyst_clusters,max_agents,max_users,autonomy_tiers,llm_tiers,features,sso_enabled,api_access,custom_branding,data_retention_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('medibridge','["apex","pulse","catalysts","mind","memory"]','["finance","procurement","hr","health-patient","health-compliance","health-supply","health-staffing","health-experience"]',35,120,'["read-only","assisted"]','["tier-1","tier-2","tier-3"]','["executive-briefings","risk-alerts","process-mining","graphrag"]',1,1,1,365).run();

  const mbUsers = [
    {id:'mb-admin',email:'admin@medibridge.co.za',name:'Dr. Priya Govender',role:'admin'},
    {id:'mb-ceo',  email:'ceo@medibridge.co.za',  name:'Dr. James Nkosi',role:'executive'},
    {id:'mb-ops',  email:'ops@medibridge.co.za',  name:'Sister Nomsa Zulu',role:'manager'},
    {id:'mb-fin',  email:'finance@medibridge.co.za',name:'Rajesh Naicker',role:'analyst'},
    {id:'mb-operator',email:'operator@medibridge.co.za',name:'Precious Mthethwa',role:'operator'},
    {id:'mb-viewer',email:'viewer@medibridge.co.za',name:'Dr. Zanele Mkhize',role:'viewer'},
  ];
  for (const u of mbUsers) {
    await db.prepare('INSERT OR IGNORE INTO users (id,tenant_id,email,name,role,password_hash,permissions,status) VALUES (?,?,?,?,?,?,?,?)')
      .bind(u.id,'medibridge',u.email,u.name,u.role,pwHash,'["*"]','active').run();
  }

  await db.prepare(
    "INSERT OR IGNORE INTO erp_connections (id,tenant_id,adapter_id,name,status,config,sync_frequency,records_synced,connected_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))"
  ).bind('conn-mb-sage','medibridge','erp-sage-bc','MediBridge Sage Business Cloud','connected',
    '{"region":"za","company_id":"medibridge-001","base_url":"https://api.accounting.sage.com/v3.1"}',
    '30min',123456).run();

  const mbClusters = [
    {id:'cc-mb-patient',name:'Patient Flow Catalyst',domain:'health-patient',desc:'Patient scheduling, ward allocation, discharge planning, readmission prediction',status:'active',agents:4,done:678,prog:12,rate:96.5,trust:94.8,tier:'assisted',subs:[{name:'Scheduling',enabled:true,description:'Automated patient appointment scheduling'},{name:'Ward Allocation',enabled:true,description:'Real-time bed management and allocation'},{name:'Discharge Planning',enabled:true,description:'Coordinated discharge with follow-up scheduling'},{name:'Readmission Prediction',enabled:false,description:'ML model predicting 30-day readmission risk'},{name:'Triage Prioritization',enabled:true,description:'AI-assisted triage scoring and queue optimization'},{name:'Theatre Scheduling',enabled:false,description:'Operating theatre slot optimization and conflict resolution'}]},
    {id:'cc-mb-compliance',name:'Healthcare Compliance Catalyst',domain:'health-compliance',desc:'NDoH reporting, POPIA compliance, clinical audit preparation',status:'active',agents:2,done:234,prog:3,rate:98.2,trust:97.1,tier:'read-only',subs:[{name:'NDoH Reporting',enabled:true,description:'Automated National Department of Health submissions'},{name:'POPIA Compliance',enabled:true,description:'Patient data privacy compliance checks'},{name:'Clinical Audit',enabled:false,description:'Automated clinical audit trail preparation'},{name:'Infection Control',enabled:true,description:'HAI tracking and prevention protocol compliance'},{name:'HPCSA Compliance',enabled:true,description:'Health Professions Council registration and CPD tracking'}]},
    {id:'cc-mb-fin',name:'Healthcare Finance Catalyst',domain:'finance',desc:'Medical aid billing, claims management, revenue cycle optimization',status:'active',agents:3,done:892,prog:15,rate:94.1,trust:91.3,tier:'assisted',subs:[{name:'Medical Aid Billing',enabled:true,description:'Automated medical aid claim submission'},{name:'Claims Management',enabled:true,description:'Claim tracking, follow-up, and rejection handling'},{name:'Invoice Reconciliation',enabled:true,description:'Statement vs claim reconciliation'},{name:'Revenue Cycle',enabled:false,description:'End-to-end revenue cycle optimization'},{name:'Tariff Code Optimization',enabled:true,description:'ICD-10 and NAPPI code accuracy checking and optimization'}]},
    {id:'cc-mb-staffing',name:'Clinical Staffing Catalyst',domain:'health-staffing',desc:'Nurse scheduling, locum management, skills-mix optimization, and workforce analytics',status:'active',agents:2,done:198,prog:5,rate:93.4,trust:90.6,tier:'assisted',subs:[{name:'Nurse Rostering',enabled:true,description:'Automated shift scheduling considering skills, ward acuity, and leave'},{name:'Locum Management',enabled:true,description:'Temporary staff sourcing, onboarding, and cost tracking'},{name:'Skills-Mix Optimization',enabled:true,description:'Ward-level staff composition optimization for patient safety'},{name:'Burnout Detection',enabled:false,description:'Early warning system for staff burnout using work pattern analysis'},{name:'Agency Cost Control',enabled:true,description:'Locum agency spend tracking and rate benchmarking'}]},
    {id:'cc-mb-supply',name:'Medical Supply Chain Catalyst',domain:'health-supply',desc:'Pharmaceutical inventory, medical device tracking, and supply chain resilience',status:'active',agents:3,done:312,prog:8,rate:95.2,trust:93.1,tier:'assisted',subs:[{name:'Pharmaceutical Inventory',enabled:true,description:'Drug stock level monitoring and expiry date management'},{name:'Formulary Management',enabled:true,description:'Preferred drug list compliance and generic substitution tracking'},{name:'Medical Device Tracking',enabled:true,description:'Equipment maintenance schedules and calibration tracking'},{name:'Supplier Diversity',enabled:false,description:'Multi-source procurement for supply chain resilience'},{name:'Cold Chain Compliance',enabled:true,description:'Temperature-sensitive medication storage and transport monitoring'}]},
    {id:'cc-mb-experience',name:'Patient Experience Catalyst',domain:'health-experience',desc:'Patient satisfaction tracking, feedback analysis, and service recovery automation',status:'active',agents:2,done:134,prog:3,rate:91.8,trust:88.5,tier:'read-only',subs:[{name:'Satisfaction Surveys',enabled:true,description:'Automated post-visit survey distribution and scoring'},{name:'Complaint Management',enabled:true,description:'Patient complaint logging, routing, and resolution tracking'},{name:'Service Recovery',enabled:false,description:'Automated escalation and resolution for negative experiences'},{name:'Wait Time Communication',enabled:true,description:'Real-time patient wait time updates via SMS'},{name:'Net Promoter Tracking',enabled:true,description:'NPS trend analysis and detractor follow-up automation'}]},
    {id:'cc-mb-hr',name:'Healthcare HR Catalyst',domain:'hr',desc:'Medical professional recruitment, credentialing, and continuing professional development',status:'active',agents:1,done:87,prog:2,rate:92.6,trust:89.4,tier:'read-only',subs:[{name:'Recruitment Pipeline',enabled:true,description:'Medical professional vacancy tracking and sourcing'},{name:'Credentialing',enabled:true,description:'License verification and practice number validation'},{name:'CPD Management',enabled:true,description:'Continuing professional development hour tracking'},{name:'Performance Reviews',enabled:false,description:'360-degree feedback and competency assessment automation'},{name:'Onboarding Workflow',enabled:true,description:'New hire orientation, IT access, and compliance training checklist'}]},
    {id:'cc-mb-proc',name:'Healthcare Procurement Catalyst',domain:'procurement',desc:'Medical supply procurement, tender management, and vendor evaluation',status:'active',agents:2,done:156,prog:4,rate:94.7,trust:92.3,tier:'assisted',subs:[{name:'Tender Management',enabled:true,description:'Medical supply tender creation, evaluation, and awarding'},{name:'Vendor Evaluation',enabled:true,description:'Supplier quality, delivery, and pricing scorecarding'},{name:'Contract Compliance',enabled:true,description:'Supplier contract SLA monitoring and penalty tracking'},{name:'Group Purchasing',enabled:false,description:'Multi-clinic bulk purchasing coordination for volume discounts'}]},
  ];
  for (const c of mbClusters) {
    await db.prepare('INSERT OR REPLACE INTO catalyst_clusters (id,tenant_id,name,domain,description,status,agent_count,tasks_completed,tasks_in_progress,success_rate,trust_score,autonomy_tier,sub_catalysts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(c.id,'medibridge',c.name,c.domain,c.desc,c.status,c.agents,c.done,c.prog,c.rate,c.trust,c.tier,JSON.stringify(c.subs)).run();
  }

  // Graph Entities
  const mbEntities = [
    {id:'ge-mb-1',type:'organisation',name:'MediBridge Clinics Group',props:'{"clinics":8,"employees":420,"beds":320}'},
    {id:'ge-mb-2',type:'department',name:'Sandton Day Clinic',props:'{"beds":45,"specialties":["GP","Ortho","Gynae"]}'},
    {id:'ge-mb-3',type:'system',name:'Sage Business Cloud',props:'{"modules":["Accounting","Payroll"]}'},
    {id:'ge-mb-4',type:'kpi',name:'Patient Satisfaction Score',props:'{"target":90,"actual":91,"unit":"%"}'},
    {id:'ge-mb-5',type:'risk',name:'Staffing Risk',props:'{"vacancy_rate":"22%","impact":"quality of care"}'},
  ];
  for (const e of mbEntities) {
    await db.prepare('INSERT OR IGNORE INTO graph_entities (id,tenant_id,type,name,properties,confidence,source) VALUES (?,?,?,?,?,?,?)')
      .bind(e.id,'medibridge',e.type,e.name,e.props,0.94,'Sage Business Cloud').run();
  }

  // ERP Data
  const mbCustomers = [
    {id:'cust-mb-1',name:'Discovery Health',code:'DISC-001',email:'providers@discovery.co.za',currency:'ZAR',balance:5200000},
    {id:'cust-mb-2',name:'Bonitas Medical Fund',code:'BON-001',email:'claims@bonitas.co.za',currency:'ZAR',balance:3100000},
    {id:'cust-mb-3',name:'Momentum Health',code:'MOM-001',email:'network@momentum.co.za',currency:'ZAR',balance:2800000},
  ];
  for (const c of mbCustomers) {
    await db.prepare('INSERT OR IGNORE INTO erp_customers (id,tenant_id,external_id,source_system,name,contact_email,currency,credit_balance) VALUES (?,?,?,?,?,?,?,?)')
      .bind(c.id,'medibridge',c.code,'Sage Business Cloud',c.name,c.email,c.currency,c.balance).run();
  }

  const mbSuppliers = [
    {id:'sup-mb-1',name:'Adcock Ingram Pharmaceuticals',code:'ADI-001',email:'orders@adcock.co.za',currency:'ZAR',balance:1800000,lead:5,rating:4.4},
    {id:'sup-mb-2',name:'Medtronic SA',code:'MDT-001',email:'orders@medtronic.co.za',currency:'ZAR',balance:2400000,lead:21,rating:4.7},
  ];
  for (const s of mbSuppliers) {
    await db.prepare('INSERT OR IGNORE INTO erp_suppliers (id,tenant_id,external_id,source_system,name,contact_email,currency,risk_score) VALUES (?,?,?,?,?,?,?,?)')
      .bind(s.id,'medibridge',s.code,'Sage Business Cloud',s.name,s.email,s.currency,s.rating).run();
  }

  const mbGL = [
    {id:'gl-mb-1',code:'1000',name:'Operating Account',type:'asset',balance:8500000},
    {id:'gl-mb-2',code:'4000',name:'Revenue - Patient Fees',type:'revenue',balance:125000000},
    {id:'gl-mb-3',code:'4100',name:'Revenue - Medical Aid Claims',type:'revenue',balance:95000000},
    {id:'gl-mb-4',code:'5000',name:'Pharmaceutical Costs',type:'expense',balance:28000000},
    {id:'gl-mb-5',code:'5100',name:'Staff Costs',type:'expense',balance:65000000},
  ];
  for (const g of mbGL) {
    await db.prepare('INSERT OR IGNORE INTO erp_gl_accounts (id,tenant_id,source_system,account_code,account_name,account_type,balance) VALUES (?,?,?,?,?,?,?)')
      .bind(g.id,'medibridge','Sage Business Cloud',g.code,g.name,g.type,g.balance).run();
  }

  const mbEmps = [
    {id:'emp-mb-1',empNum:'MB-001',first:'James',last:'Nkosi',dept:'Executive',pos:'CEO'},
    {id:'emp-mb-2',empNum:'MB-015',first:'Nomsa',last:'Zulu',dept:'Nursing',pos:'Head of Nursing'},
    {id:'emp-mb-3',empNum:'MB-042',first:'Priya',last:'Govender',dept:'Clinical',pos:'Medical Director'},
  ];
  for (const e of mbEmps) {
    await db.prepare('INSERT OR IGNORE INTO erp_employees (id,tenant_id,source_system,employee_number,first_name,last_name,department,position) VALUES (?,?,?,?,?,?,?,?)')
      .bind(e.id,'medibridge','Sage Business Cloud',e.empNum,e.first,e.last,e.dept,e.pos).run();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPANY 4: BLUEPEAK LOGISTICS — SAGE PASTEL — LOGISTICS / TRANSPORT
  // ═══════════════════════════════════════════════════════════════════════════
  await db.prepare('INSERT OR IGNORE INTO tenants (id,name,slug,industry,plan,status,deployment_model,region) VALUES (?,?,?,?,?,?,?,?)')
    .bind('bluepeak','BluePeak Logistics (Pty) Ltd','bluepeak','logistics','professional','active','saas','af-south-1').run();

  await db.prepare('INSERT OR REPLACE INTO tenant_entitlements (tenant_id,layers,catalyst_clusters,max_agents,max_users,autonomy_tiers,llm_tiers,features,sso_enabled,api_access,custom_branding,data_retention_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('bluepeak','["apex","pulse","catalysts"]','["finance","procurement","supply-chain","hr","sales","logistics-fleet","logistics-compliance","logistics-warehouse"]',20,40,'["read-only","assisted"]','["tier-1"]','["executive-briefings","process-mining"]',0,0,0,90).run();

  const bpUsers = [
    {id:'bp-admin',email:'admin@bluepeak-logistics.co.za',name:'Pieter Botha',role:'admin'},
    {id:'bp-exec', email:'ceo@bluepeak-logistics.co.za',   name:'Francois du Toit',role:'executive'},
    {id:'bp-ops',  email:'ops@bluepeak-logistics.co.za',   name:'Kagiso Molefe',role:'manager'},
    {id:'bp-analyst',email:'analyst@bluepeak-logistics.co.za',name:'Zandile Mkhwanazi',role:'analyst'},
    {id:'bp-operator',email:'operator@bluepeak-logistics.co.za',name:'Tshepo Motaung',role:'operator'},
    {id:'bp-viewer',email:'viewer@bluepeak-logistics.co.za',name:'Lerato Phiri',role:'viewer'},
  ];
  for (const u of bpUsers) {
    await db.prepare('INSERT OR IGNORE INTO users (id,tenant_id,email,name,role,password_hash,permissions,status) VALUES (?,?,?,?,?,?,?,?)')
      .bind(u.id,'bluepeak',u.email,u.name,u.role,pwHash,'["*"]','active').run();
  }

  await db.prepare(
    "INSERT OR IGNORE INTO erp_connections (id,tenant_id,adapter_id,name,status,config,sync_frequency,records_synced,connected_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))"
  ).bind('conn-bp-pastel','bluepeak','erp-sage-pastel','BluePeak Sage Pastel Partner','connected',
    '{"host":"pastel.bluepeak.local","company_database":"BLUEPEAK_2026","base_url":"https://pastel.bluepeak-logistics.co.za"}',
    'hourly',67890).run();

  const bpClusters = [
    {id:'cc-bp-supply',name:'Route Optimization Catalyst',domain:'supply-chain',desc:'Real-time route planning, fuel optimization, fleet scheduling',status:'active',agents:3,done:567,prog:9,rate:93.4,trust:90.2,tier:'assisted',subs:[{name:'Route Planning',enabled:true,description:'Dynamic route optimization with traffic and weather'},{name:'Fuel Optimization',enabled:true,description:'Fuel consumption tracking and efficiency coaching'},{name:'Fleet Scheduling',enabled:true,description:'Vehicle and driver assignment optimization'},{name:'Load Optimization',enabled:false,description:'Weight distribution and capacity planning'},{name:'Cross-Docking',enabled:true,description:'Hub transfer optimization to minimize handling time'}]},
    {id:'cc-bp-fin',name:'Transport Finance Catalyst',domain:'finance',desc:'Fuel cost tracking, trip costing, customer billing automation',status:'active',agents:2,done:345,prog:4,rate:95.8,trust:93.1,tier:'assisted',subs:[{name:'Trip Costing',enabled:true,description:'Automated per-trip cost calculation'},{name:'Customer Billing',enabled:true,description:'POD-based automated invoice generation'},{name:'Accounts Receivable',enabled:true,description:'Debtor aging and follow-up automation'},{name:'Fuel Surcharge Calculator',enabled:true,description:'Automated fuel surcharge adjustment based on diesel price index'},{name:'Fleet Depreciation',enabled:false,description:'Vehicle depreciation tracking and replacement forecasting'}]},
    {id:'cc-bp-fleet',name:'Fleet Maintenance Catalyst',domain:'logistics-fleet',desc:'Predictive vehicle maintenance, tyre management, and compliance tracking for the truck fleet',status:'active',agents:3,done:289,prog:6,rate:94.1,trust:91.5,tier:'assisted',subs:[{name:'Predictive Maintenance',enabled:true,description:'Engine telemetry-based maintenance prediction and scheduling'},{name:'Tyre Management',enabled:true,description:'Tyre wear tracking, rotation scheduling, and retread optimization'},{name:'COF Compliance',enabled:true,description:'Certificate of Fitness expiry tracking and renewal management'},{name:'Brake Testing',enabled:true,description:'Automated brake performance tracking and replacement scheduling'},{name:'Fuel System Health',enabled:false,description:'Injector and pump performance monitoring for fuel efficiency'}]},
    {id:'cc-bp-hr',name:'Driver Management Catalyst',domain:'hr',desc:'Driver scheduling, licensing compliance, fatigue management, and performance tracking',status:'active',agents:2,done:178,prog:3,rate:92.8,trust:89.7,tier:'read-only',subs:[{name:'Driver Scheduling',enabled:true,description:'Automated driver rostering considering hours-of-service regulations'},{name:'License Tracking',enabled:true,description:'Code 14 EC license expiry and renewal management'},{name:'Fatigue Management',enabled:true,description:'Drive time monitoring and mandatory rest enforcement'},{name:'Performance Scorecarding',enabled:true,description:'Driver safety, fuel efficiency, and on-time delivery scoring'},{name:'Training & Certification',enabled:false,description:'Hazmat, defensive driving, and first aid certification tracking'}]},
    {id:'cc-bp-compliance',name:'Transport Compliance Catalyst',domain:'logistics-compliance',desc:'RTMS compliance, cross-border permits, and regulatory reporting for road freight',status:'active',agents:2,done:145,prog:2,rate:96.7,trust:94.5,tier:'read-only',subs:[{name:'RTMS Compliance',enabled:true,description:'Road Transport Management System accreditation tracking'},{name:'Cross-Border Permits',enabled:true,description:'SADC cross-border permit management and customs documentation'},{name:'Overload Prevention',enabled:true,description:'Real-time axle weight monitoring and load compliance'},{name:'Incident Reporting',enabled:true,description:'Accident and incident regulatory reporting automation'},{name:'Insurance Management',enabled:false,description:'Fleet insurance policy tracking and claims management'}]},
    {id:'cc-bp-warehouse',name:'Warehouse Operations Catalyst',domain:'logistics-warehouse',desc:'Depot operations optimization, inventory management, and loading dock scheduling',status:'active',agents:2,done:123,prog:4,rate:91.5,trust:88.3,tier:'assisted',subs:[{name:'Dock Scheduling',enabled:true,description:'Loading bay allocation and truck queuing optimization'},{name:'Inventory Tracking',enabled:true,description:'Cross-dock and break-bulk inventory visibility'},{name:'Damage Prevention',enabled:false,description:'Load securing compliance and damage trend analysis'},{name:'Yard Management',enabled:true,description:'Trailer parking, staging, and movement tracking'}]},
    {id:'cc-bp-sales',name:'Customer Service Catalyst',domain:'sales',desc:'Customer SLA tracking, delivery visibility, and relationship management for logistics clients',status:'active',agents:2,done:198,prog:5,rate:93.2,trust:90.1,tier:'assisted',subs:[{name:'SLA Monitoring',enabled:true,description:'Real-time delivery SLA tracking per customer contract'},{name:'Track & Trace',enabled:true,description:'Customer-facing shipment visibility and ETA updates'},{name:'Claims Management',enabled:true,description:'Delivery damage and loss claim processing automation'},{name:'Rate Management',enabled:false,description:'Customer-specific rate card management and quoting'},{name:'Contract Renewal',enabled:true,description:'Contract expiry tracking and renewal opportunity alerts'}]},
    {id:'cc-bp-proc',name:'Procurement Catalyst',domain:'procurement',desc:'Fuel procurement, parts purchasing, and vendor management for fleet operations',status:'active',agents:1,done:89,prog:2,rate:94.5,trust:91.8,tier:'read-only',subs:[{name:'Fuel Procurement',enabled:true,description:'Bulk fuel purchasing and depot price optimization'},{name:'Parts Purchasing',enabled:true,description:'Automated spare parts reordering based on maintenance schedules'},{name:'Vendor Scoring',enabled:true,description:'Supplier reliability and pricing benchmarking'},{name:'Tender Management',enabled:false,description:'Fleet service provider tender creation and evaluation'}]},
  ];
  for (const c of bpClusters) {
    await db.prepare('INSERT OR REPLACE INTO catalyst_clusters (id,tenant_id,name,domain,description,status,agent_count,tasks_completed,tasks_in_progress,success_rate,trust_score,autonomy_tier,sub_catalysts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(c.id,'bluepeak',c.name,c.domain,c.desc,c.status,c.agents,c.done,c.prog,c.rate,c.trust,c.tier,JSON.stringify(c.subs)).run();
  }

  // Graph Entities
  const bpEntities = [
    {id:'ge-bp-1',type:'organisation',name:'BluePeak Logistics',props:'{"employees":180,"fleet_size":52,"depots":3}'},
    {id:'ge-bp-2',type:'asset',name:'Fleet - Long Haul',props:'{"vehicles":28,"avg_age":"4.2 years","type":"34-ton interlink"}'},
    {id:'ge-bp-3',type:'system',name:'Sage Pastel Partner',props:'{"modules":["Invoicing","Payroll","Inventory"]}'},
  ];
  for (const e of bpEntities) {
    await db.prepare('INSERT OR IGNORE INTO graph_entities (id,tenant_id,type,name,properties,confidence,source) VALUES (?,?,?,?,?,?,?)')
      .bind(e.id,'bluepeak',e.type,e.name,e.props,0.91,'Sage Pastel').run();
  }

  // ERP Data
  const bpCustomers = [
    {id:'cust-bp-1',name:'Shoprite Holdings',code:'SHP-001',email:'logistics@shoprite.co.za',currency:'ZAR',balance:3200000},
    {id:'cust-bp-2',name:'Massmart (Walmart)',code:'MASS-001',email:'transport@massmart.co.za',currency:'ZAR',balance:2100000},
  ];
  for (const c of bpCustomers) {
    await db.prepare('INSERT OR IGNORE INTO erp_customers (id,tenant_id,external_id,source_system,name,contact_email,currency,credit_balance) VALUES (?,?,?,?,?,?,?,?)')
      .bind(c.id,'bluepeak',c.code,'Sage Pastel',c.name,c.email,c.currency,c.balance).run();
  }

  const bpSuppliers = [
    {id:'sup-bp-1',name:'Engen Fleet',code:'ENG-001',email:'fleet@engen.co.za',currency:'ZAR',balance:890000,lead:0,rating:4.1},
    {id:'sup-bp-2',name:'Bridgestone SA',code:'BS-001',email:'fleet@bridgestone.co.za',currency:'ZAR',balance:420000,lead:7,rating:4.5},
  ];
  for (const s of bpSuppliers) {
    await db.prepare('INSERT OR IGNORE INTO erp_suppliers (id,tenant_id,external_id,source_system,name,contact_email,currency,risk_score) VALUES (?,?,?,?,?,?,?,?)')
      .bind(s.id,'bluepeak',s.code,'Sage Pastel',s.name,s.email,s.currency,s.rating).run();
  }

  const bpGL = [
    {id:'gl-bp-1',code:'1000',name:'Business Account',type:'asset',balance:1800000},
    {id:'gl-bp-2',code:'4000',name:'Revenue - Transport Fees',type:'revenue',balance:45000000},
    {id:'gl-bp-3',code:'5000',name:'Fuel Costs',type:'expense',balance:18000000},
    {id:'gl-bp-4',code:'5100',name:'Driver Salaries',type:'expense',balance:12000000},
  ];
  for (const g of bpGL) {
    await db.prepare('INSERT OR IGNORE INTO erp_gl_accounts (id,tenant_id,source_system,account_code,account_name,account_type,balance) VALUES (?,?,?,?,?,?,?)')
      .bind(g.id,'bluepeak','Sage Pastel',g.code,g.name,g.type,g.balance).run();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPANY 5: NOVATECH SOLUTIONS — ORACLE FUSION — TECHNOLOGY / SAAS
  // ═══════════════════════════════════════════════════════════════════════════
  await db.prepare('INSERT OR IGNORE INTO tenants (id,name,slug,industry,plan,status,deployment_model,region) VALUES (?,?,?,?,?,?,?,?)')
    .bind('novatech','NovaTech Solutions (Pty) Ltd','novatech','technology','enterprise','active','saas','af-south-1').run();

  await db.prepare('INSERT OR REPLACE INTO tenant_entitlements (tenant_id,layers,catalyst_clusters,max_agents,max_users,autonomy_tiers,llm_tiers,features,sso_enabled,api_access,custom_branding,data_retention_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('novatech','["apex","pulse","catalysts","mind","memory"]','["finance","procurement","supply-chain","hr","sales","tech-devops","tech-security","tech-product","tech-customer-success"]',50,200,'["read-only","assisted","transactional"]','["tier-1","tier-2","tier-3"]','["scenario-modelling","process-mining","graphrag","executive-briefings","risk-alerts"]',1,1,1,365).run();

  const ntUsers = [
    {id:'nt-admin',email:'admin@novatech.co.za',name:'Aisha Patel',role:'admin'},
    {id:'nt-cto',  email:'cto@novatech.co.za',  name:'Michael Chen',role:'executive'},
    {id:'nt-vpsales',email:'vpsales@novatech.co.za',name:'David Mabaso',role:'manager'},
    {id:'nt-analyst',email:'analyst@novatech.co.za',name:'Fatima Osman',role:'analyst'},
    {id:'nt-operator',email:'operator@novatech.co.za',name:'Siyanda Cele',role:'operator'},
    {id:'nt-viewer',email:'viewer@novatech.co.za',name:'Hlengiwe Zwane',role:'viewer'},
  ];
  for (const u of ntUsers) {
    await db.prepare('INSERT OR IGNORE INTO users (id,tenant_id,email,name,role,password_hash,permissions,status) VALUES (?,?,?,?,?,?,?,?)')
      .bind(u.id,'novatech',u.email,u.name,u.role,pwHash,'["*"]','active').run();
  }

  await db.prepare(
    "INSERT OR IGNORE INTO erp_connections (id,tenant_id,adapter_id,name,status,config,sync_frequency,records_synced,connected_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))"
  ).bind('conn-nt-oracle','novatech','erp-oracle','NovaTech Oracle Fusion Cloud','connected',
    '{"instance":"novatech.oraclecloud.com","api_version":"24B","base_url":"https://novatech.oraclecloud.com","modules":["Financials","HCM","SCM"]}',
    '5min',345678).run();

  const ntClusters = [
    {id:'cc-nt-sales',name:'Revenue Operations Catalyst',domain:'sales',desc:'Churn prediction, upsell identification, pipeline health, renewal management',status:'active',agents:5,done:1234,prog:18,rate:95.7,trust:93.4,tier:'transactional',subs:[{name:'Churn Prediction',enabled:true,description:'ML model predicting customer churn probability'},{name:'Upsell Engine',enabled:true,description:'Cross-sell and upsell opportunity identification'},{name:'Pipeline Health',enabled:true,description:'Deal velocity and win-rate tracking'},{name:'Renewal Management',enabled:false,description:'Automated renewal reminders and processing'},{name:'Win/Loss Analysis',enabled:true,description:'Post-deal analysis to improve conversion strategies'},{name:'Territory Planning',enabled:false,description:'Account territory assignment optimization using revenue potential'}]},
    {id:'cc-nt-fin',name:'SaaS Finance Catalyst',domain:'finance',desc:'Revenue recognition, ARR tracking, cash flow forecasting, cost optimization',status:'active',agents:3,done:678,prog:8,rate:97.2,trust:95.8,tier:'assisted',subs:[{name:'Revenue Recognition',enabled:true,description:'ASC 606 compliant revenue recognition'},{name:'ARR Tracking',enabled:true,description:'Real-time ARR, MRR, and expansion metrics'},{name:'Invoice Reconciliation',enabled:true,description:'Subscription billing reconciliation'},{name:'Cost Optimization',enabled:false,description:'Cloud and vendor spend optimization'},{name:'Unit Economics',enabled:true,description:'CAC, LTV, and payback period tracking per cohort'}]},
    {id:'cc-nt-hr',name:'Talent Intelligence Catalyst',domain:'hr',desc:'Retention prediction, compensation benchmarking, hiring pipeline optimization',status:'active',agents:2,done:234,prog:5,rate:92.1,trust:88.9,tier:'read-only',subs:[{name:'Retention Prediction',enabled:true,description:'Employee flight risk scoring'},{name:'Compensation Benchmarking',enabled:true,description:'Market rate comparison and equity analysis'},{name:'Hiring Pipeline',enabled:false,description:'Candidate funnel optimization and sourcing'},{name:'Diversity Analytics',enabled:true,description:'Workforce diversity metrics and inclusive hiring tracking'},{name:'Engineering Capacity',enabled:true,description:'Sprint capacity planning and allocation optimization'}]},
    {id:'cc-nt-devops',name:'DevOps Intelligence Catalyst',domain:'tech-devops',desc:'CI/CD pipeline monitoring, deployment risk scoring, infrastructure cost optimization, and incident management',status:'active',agents:4,done:567,prog:11,rate:96.3,trust:94.1,tier:'transactional',subs:[{name:'Pipeline Monitoring',enabled:true,description:'CI/CD pipeline health, build times, and failure rate tracking'},{name:'Deployment Risk Scoring',enabled:true,description:'ML-based deployment risk assessment before production releases'},{name:'Infrastructure Cost',enabled:true,description:'Cloud resource utilization and right-sizing recommendations'},{name:'Incident Response',enabled:true,description:'Automated incident detection, escalation, and runbook execution'},{name:'SLA Monitoring',enabled:true,description:'Service uptime, latency, and error rate tracking against SLAs'},{name:'Capacity Planning',enabled:false,description:'Predictive scaling based on usage trends and seasonal patterns'}]},
    {id:'cc-nt-security',name:'Security Operations Catalyst',domain:'tech-security',desc:'Vulnerability management, access control auditing, compliance monitoring, and threat detection',status:'active',agents:3,done:345,prog:7,rate:97.8,trust:96.2,tier:'read-only',subs:[{name:'Vulnerability Scanning',enabled:true,description:'Automated dependency and infrastructure vulnerability detection'},{name:'Access Audit',enabled:true,description:'Permission review, orphaned account detection, and least-privilege enforcement'},{name:'SOC 2 Compliance',enabled:true,description:'Continuous SOC 2 Type II control monitoring and evidence collection'},{name:'Threat Detection',enabled:false,description:'Anomalous access pattern detection and threat intelligence correlation'},{name:'Secret Rotation',enabled:true,description:'API key and credential rotation scheduling and compliance'},{name:'Penetration Testing',enabled:false,description:'Automated security testing coordination and finding tracking'}]},
    {id:'cc-nt-product',name:'Product Analytics Catalyst',domain:'tech-product',desc:'Feature adoption tracking, user journey analysis, A/B testing, and product-led growth metrics',status:'active',agents:3,done:456,prog:9,rate:93.5,trust:90.8,tier:'assisted',subs:[{name:'Feature Adoption',enabled:true,description:'Feature usage tracking and adoption funnel analysis'},{name:'User Journey Mapping',enabled:true,description:'Session flow analysis and drop-off point identification'},{name:'A/B Test Management',enabled:true,description:'Experiment lifecycle management and statistical significance tracking'},{name:'Product-Led Growth',enabled:true,description:'PQL scoring, activation rate, and time-to-value optimization'},{name:'Feedback Loop',enabled:false,description:'Customer feedback aggregation and feature request prioritization'}]},
    {id:'cc-nt-cs',name:'Customer Success Catalyst',domain:'tech-customer-success',desc:'Customer health scoring, onboarding automation, support ticket intelligence, and expansion opportunity detection',status:'active',agents:3,done:389,prog:8,rate:94.2,trust:91.5,tier:'assisted',subs:[{name:'Health Scoring',enabled:true,description:'Multi-signal customer health score combining usage, support, and payment data'},{name:'Onboarding Automation',enabled:true,description:'Guided onboarding workflow with milestone tracking and intervention triggers'},{name:'Support Intelligence',enabled:true,description:'Ticket classification, routing, and resolution time prediction'},{name:'Expansion Detection',enabled:true,description:'Usage-based expansion opportunity identification and timing'},{name:'QBR Preparation',enabled:false,description:'Automated quarterly business review deck generation with usage insights'},{name:'Advocacy Program',enabled:false,description:'NPS-based referral and case study candidate identification'}]},
    {id:'cc-nt-proc',name:'Procurement Catalyst',domain:'procurement',desc:'SaaS vendor management, license optimization, and technology spend governance',status:'active',agents:2,done:123,prog:3,rate:95.1,trust:92.4,tier:'assisted',subs:[{name:'SaaS License Management',enabled:true,description:'Software license utilization tracking and optimization'},{name:'Vendor Consolidation',enabled:true,description:'Overlapping tool identification and consolidation opportunities'},{name:'Contract Negotiation',enabled:false,description:'Benchmark-based pricing intelligence for vendor negotiations'},{name:'Budget Forecasting',enabled:true,description:'Technology spend forecasting by department and category'}]},
    {id:'cc-nt-supply',name:'Supply Chain Catalyst',domain:'supply-chain',desc:'Hardware procurement, data center inventory, and professional services resource planning',status:'active',agents:1,done:67,prog:2,rate:91.8,trust:88.3,tier:'read-only',subs:[{name:'Hardware Lifecycle',enabled:true,description:'Employee device tracking, refresh cycles, and disposal management'},{name:'License Compliance',enabled:true,description:'Software audit readiness and entitlement tracking'},{name:'Resource Planning',enabled:false,description:'Professional services resource allocation and utilization optimization'}]},
  ];
  for (const c of ntClusters) {
    await db.prepare('INSERT OR REPLACE INTO catalyst_clusters (id,tenant_id,name,domain,description,status,agent_count,tasks_completed,tasks_in_progress,success_rate,trust_score,autonomy_tier,sub_catalysts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(c.id,'novatech',c.name,c.domain,c.desc,c.status,c.agents,c.done,c.prog,c.rate,c.trust,c.tier,JSON.stringify(c.subs)).run();
  }

  // Graph Entities
  const ntEntities = [
    {id:'ge-nt-1',type:'organisation',name:'NovaTech Solutions',props:'{"employees":220,"ARR":"R51M","customers":340}'},
    {id:'ge-nt-2',type:'department',name:'Product Engineering',props:'{"headcount":85,"teams":["Platform","Frontend","Data","DevOps"]}'},
    {id:'ge-nt-3',type:'system',name:'Oracle Fusion Cloud',props:'{"modules":["Financials","HCM","SCM"],"go_live":"2024-06-01"}'},
    {id:'ge-nt-4',type:'kpi',name:'Annual Recurring Revenue',props:'{"target":"R55M","actual":"R51M","growth":"24% YoY"}'},
    {id:'ge-nt-5',type:'risk',name:'Enterprise Churn Risk',props:'{"at_risk_arr":"R12M","customers":3}'},
    {id:'ge-nt-6',type:'process',name:'CI/CD Pipeline',props:'{"deploys_per_day":12,"success_rate":"98.5%"}'},
  ];
  for (const e of ntEntities) {
    await db.prepare('INSERT OR IGNORE INTO graph_entities (id,tenant_id,type,name,properties,confidence,source) VALUES (?,?,?,?,?,?,?)')
      .bind(e.id,'novatech',e.type,e.name,e.props,0.96,'Oracle Fusion').run();
  }

  const ntRels = [
    {id:'gr-nt-1',src:'ge-nt-1',tgt:'ge-nt-2',type:'owns',props:'{"cost_center":"ENG-001"}'},
    {id:'gr-nt-2',src:'ge-nt-2',tgt:'ge-nt-6',type:'executes',props:'{"frequency":"continuous"}'},
    {id:'gr-nt-3',src:'ge-nt-3',tgt:'ge-nt-4',type:'produces',props:'{"report":"monthly"}'},
  ];
  for (const r of ntRels) {
    await db.prepare('INSERT OR IGNORE INTO graph_relationships (id,tenant_id,source_id,target_id,type,properties,confidence) VALUES (?,?,?,?,?,?,?)')
      .bind(r.id,'novatech',r.src,r.tgt,r.type,r.props,0.94).run();
  }

  // Agent Deployments
  const ntDeploys = [
    {id:'ad-nt-1',cluster:'cc-nt-sales',name:'Churn Predictor',type:'churn-prediction',status:'running',model:'saas',ver:'3.1.0',health:95.7,uptime:99.98,tasks:1234},
    {id:'ad-nt-2',cluster:'cc-nt-fin',name:'Revenue Recognizer',type:'rev-rec',status:'running',model:'saas',ver:'2.4.0',health:97.2,uptime:99.99,tasks:678},
  ];
  for (const d of ntDeploys) {
    await db.prepare("INSERT OR IGNORE INTO agent_deployments (id,tenant_id,cluster_id,name,agent_type,status,deployment_model,version,health_score,uptime,tasks_executed,last_heartbeat) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))")
      .bind(d.id,'novatech',d.cluster,d.name,d.type,d.status,d.model,d.ver,d.health,d.uptime,d.tasks).run();
  }

  // ERP Data
  const ntCustomers= [
    {id:'cust-nt-1',name:'Standard Bank',code:'STDB-001',email:'digital@standardbank.co.za',currency:'ZAR',balance:4200000},
    {id:'cust-nt-2',name:'Vodacom Business',code:'VODA-001',email:'enterprise@vodacom.co.za',currency:'ZAR',balance:3800000},
    {id:'cust-nt-3',name:'Sanlam Group',code:'SAN-001',email:'innovation@sanlam.co.za',currency:'ZAR',balance:2900000},
    {id:'cust-nt-4',name:'MTN Group',code:'MTN-001',email:'tech@mtn.co.za',currency:'ZAR',balance:1800000},
  ];
  for (const c of ntCustomers) {
    await db.prepare('INSERT OR IGNORE INTO erp_customers (id,tenant_id,external_id,source_system,name,contact_email,currency,credit_balance) VALUES (?,?,?,?,?,?,?,?)')
      .bind(c.id,'novatech',c.code,'Oracle Fusion',c.name,c.email,c.currency,c.balance).run();
  }

  const ntSuppliers = [
    {id:'sup-nt-1',name:'AWS South Africa',code:'AWS-001',email:'enterprise@aws.com',currency:'USD',balance:480000,lead:0,rating:4.8},
    {id:'sup-nt-2',name:'Offerzen Talent',code:'OFZ-001',email:'enterprise@offerzen.com',currency:'ZAR',balance:350000,lead:14,rating:4.3},
  ];
  for (const s of ntSuppliers) {
    await db.prepare('INSERT OR IGNORE INTO erp_suppliers (id,tenant_id,external_id,source_system,name,contact_email,currency,risk_score) VALUES (?,?,?,?,?,?,?,?)')
      .bind(s.id,'novatech',s.code,'Oracle Fusion',s.name,s.email,s.currency,s.rating).run();
  }

  const ntProducts = [
    {id:'prod-nt-1',name:'NovaTech Platform - Enterprise',sku:'NT-ENT-001',category:'SaaS Subscription',price:45000,stock:0,unit:'license/month'},
    {id:'prod-nt-2',name:'NovaTech Platform - Professional',sku:'NT-PRO-001',category:'SaaS Subscription',price:12000,stock:0,unit:'license/month'},
    {id:'prod-nt-3',name:'Implementation Services',sku:'NT-IMP-001',category:'Professional Services',price:2500,stock:0,unit:'day'},
  ];
  for (const p of ntProducts) {
    await db.prepare('INSERT OR IGNORE INTO erp_products (id,tenant_id,source_system,sku,name,category,selling_price,stock_on_hand) VALUES (?,?,?,?,?,?,?,?)')
      .bind(p.id,'novatech','Oracle Fusion',p.sku,p.name,p.category,p.price,p.stock).run();
  }

  const ntGL = [
    {id:'gl-nt-1',code:'1000',name:'Operating Account',type:'asset',balance:12500000},
    {id:'gl-nt-2',code:'4000',name:'Revenue - SaaS Subscriptions',type:'revenue',balance:42000000},
    {id:'gl-nt-3',code:'4100',name:'Revenue - Professional Services',type:'revenue',balance:9000000},
    {id:'gl-nt-4',code:'5000',name:'Cloud Infrastructure Costs',type:'expense',balance:8500000},
    {id:'gl-nt-5',code:'5100',name:'Engineering Salaries',type:'expense',balance:22000000},
    {id:'gl-nt-6',code:'5200',name:'Sales & Marketing',type:'expense',balance:6800000},
  ];
  for (const g of ntGL) {
    await db.prepare('INSERT OR IGNORE INTO erp_gl_accounts (id,tenant_id,source_system,account_code,account_name,account_type,balance) VALUES (?,?,?,?,?,?,?)')
      .bind(g.id,'novatech','Oracle Fusion',g.code,g.name,g.type,g.balance).run();
  }

  const ntEmps = [
    {id:'emp-nt-1',empNum:'NT-001',first:'Aisha',last:'Patel',dept:'Executive',pos:'CEO & Founder'},
    {id:'emp-nt-2',empNum:'NT-002',first:'Michael',last:'Chen',dept:'Technology',pos:'CTO'},
    {id:'emp-nt-3',empNum:'NT-015',first:'David',last:'Mabaso',dept:'Sales',pos:'VP Sales'},
    {id:'emp-nt-4',empNum:'NT-042',first:'Fatima',last:'Osman',dept:'Product',pos:'Product Analyst'},
  ];
  for (const e of ntEmps) {
    await db.prepare('INSERT OR IGNORE INTO erp_employees (id,tenant_id,source_system,employee_number,first_name,last_name,department,position) VALUES (?,?,?,?,?,?,?,?)')
      .bind(e.id,'novatech','Oracle Fusion',e.empNum,e.first,e.last,e.dept,e.pos).run();
  }

}
