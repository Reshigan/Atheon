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

  await db.prepare('INSERT OR IGNORE INTO tenant_entitlements (tenant_id,layers,catalyst_clusters,max_agents,max_users,autonomy_tiers,llm_tiers,features,sso_enabled,api_access,custom_branding,data_retention_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('highveld','["apex","pulse","catalysts","mind","memory"]','["finance","procurement","supply-chain","mining-equipment","mining-safety"]',40,150,'["read-only","assisted","transactional"]','["tier-1","tier-2","tier-3"]','["scenario-modelling","process-mining","graphrag","executive-briefings","risk-alerts"]',1,1,1,730).run();

  const hvUsers = [
    { id:'hv-admin', email:'admin@highveld-steel.co.za', name:'Thandi Mthembu', role:'admin' },
    { id:'hv-ceo',   email:'ceo@highveld-steel.co.za',   name:'Johan van der Merwe', role:'executive' },
    { id:'hv-ops',   email:'ops@highveld-steel.co.za',   name:'Sipho Ndlovu', role:'manager' },
    { id:'hv-analyst', email:'analyst@highveld-steel.co.za', name:'Lindiwe Khumalo', role:'analyst' },
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

  // Health Score
  await db.prepare('INSERT OR IGNORE INTO health_scores (id,tenant_id,overall_score,dimensions) VALUES (?,?,?,?)')
    .bind('hs-hv','highveld',72,JSON.stringify({
      financial_health:{score:68,trend:'down',delta:-4},
      operational_efficiency:{score:75,trend:'up',delta:2},
      risk_exposure:{score:62,trend:'down',delta:-8},
      safety_performance:{score:81,trend:'up',delta:3},
      equipment_reliability:{score:70,trend:'stable',delta:0},
      environmental_compliance:{score:78,trend:'up',delta:1},
    })).run();

  // Risk Alerts
  const hvRisks = [
    {id:'risk-hv-1',title:'Furnace #2 Refractory Degradation',description:'Blast furnace #2 refractory lining showing accelerated wear. Estimated 45 days to critical failure. R18M production loss if unplanned shutdown.',severity:'critical',category:'equipment',probability:0.82,impact:18000000},
    {id:'risk-hv-2',title:'Iron Ore Price Volatility',description:'Seaborne iron ore prices up 23% QoQ. No hedging in place for Q3 procurement (120k tons). R42M margin compression risk.',severity:'high',category:'financial',probability:0.71,impact:42000000},
    {id:'risk-hv-3',title:'Eskom Load Shedding Stage 4+',description:'National grid instability forecast for winter months. Steel production requires 180MW continuous. Diesel backup limited to 72 hours.',severity:'high',category:'operations',probability:0.65,impact:25000000},
    {id:'risk-hv-4',title:'Water Recycling Non-Compliance',description:'Cooling water discharge exceeding DWS limits for cadmium and lead. R5M penalty risk plus production stop order.',severity:'medium',category:'environment',probability:0.55,impact:5000000},
  ];
  for (const r of hvRisks) {
    await db.prepare('INSERT OR IGNORE INTO risk_alerts (id,tenant_id,title,description,severity,category,probability,impact_value,recommended_actions) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(r.id,'highveld',r.title,r.description,r.severity,r.category,r.probability,r.impact,'[]').run();
  }

  // Process Metrics
  const hvMetrics = [
    {id:'pm-hv-1',name:'Steel Production Volume',value:42500,unit:'tons/month',status:'amber',tg:50000,ta:40000,tr:35000},
    {id:'pm-hv-2',name:'Furnace Uptime',value:87.3,unit:'%',status:'amber',tg:92,ta:85,tr:80},
    {id:'pm-hv-3',name:'Safety Incident Rate',value:0.42,unit:'per 200k hrs',status:'green',tg:0.5,ta:1.0,tr:1.5},
    {id:'pm-hv-4',name:'Energy Cost per Ton',value:1850,unit:'ZAR',status:'red',tg:1500,ta:1700,tr:1900},
    {id:'pm-hv-5',name:'Iron Ore Inventory Days',value:18,unit:'days',status:'amber',tg:25,ta:15,tr:10},
    {id:'pm-hv-6',name:'CO2 Emissions per Ton',value:1.92,unit:'tCO2e',status:'amber',tg:1.5,ta:2.0,tr:2.5},
  ];
  for (const m of hvMetrics) {
    await db.prepare('INSERT OR IGNORE INTO process_metrics (id,tenant_id,name,value,unit,status,threshold_green,threshold_amber,threshold_red,trend,source_system) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(m.id,'highveld',m.name,m.value,m.unit,m.status,m.tg,m.ta,m.tr,'[]','SAP S/4HANA').run();
  }

  // Catalyst Clusters
  const hvClusters = [
    {id:'cc-hv-equip',name:'Equipment Health Catalyst',domain:'mining-equipment',desc:'Predictive maintenance for blast furnaces, rolling mills, and cranes',status:'active',agents:5,done:342,prog:8,rate:94.2,trust:91.5,tier:'assisted',subs:[{name:'Predictive Maintenance',enabled:true,description:'ML-based failure prediction for heavy equipment'},{name:'Vibration Analysis',enabled:true,description:'Real-time vibration monitoring on rotating equipment'},{name:'Thermal Imaging',enabled:false,description:'IR camera analysis for refractory and electrical systems'}]},
    {id:'cc-hv-safety',name:'Safety Compliance Catalyst',domain:'mining-safety',desc:'Real-time safety monitoring, incident prediction, and compliance tracking',status:'active',agents:3,done:187,prog:4,rate:97.8,trust:95.2,tier:'read-only',subs:[{name:'Incident Prediction',enabled:true,description:'Near-miss and incident trend analysis'},{name:'PPE Compliance',enabled:true,description:'Computer vision PPE detection at entry points'},{name:'Environmental Monitoring',enabled:true,description:'Gas, dust, and noise level tracking'}]},
    {id:'cc-hv-fin',name:'Finance Operations Catalyst',domain:'finance',desc:'Automated journal entries, variance analysis, and cost allocation',status:'active',agents:4,done:523,prog:12,rate:96.1,trust:93.8,tier:'transactional',subs:[{name:'Accounts Receivable',enabled:true,description:'Automated AR aging and collection workflows'},{name:'Accounts Payable',enabled:true,description:'Invoice matching and payment scheduling'},{name:'Invoice Reconciliation',enabled:true,description:'3-way match: PO, GRN, Invoice'},{name:'Cost Allocation',enabled:false,description:'Activity-based costing across cost centers'}]},
    {id:'cc-hv-proc',name:'Procurement Catalyst',domain:'procurement',desc:'Supplier evaluation, PO automation, and spend analytics',status:'active',agents:3,done:289,prog:6,rate:92.5,trust:89.3,tier:'assisted',subs:[{name:'Supplier Scoring',enabled:true,description:'Automated supplier risk and performance rating'},{name:'PO Automation',enabled:true,description:'Purchase order creation and approval routing'},{name:'Spend Analytics',enabled:false,description:'Category-level spend analysis and savings identification'}]},
  ];
  for (const c of hvClusters) {
    await db.prepare('INSERT OR IGNORE INTO catalyst_clusters (id,tenant_id,name,domain,description,status,agent_count,tasks_completed,tasks_in_progress,success_rate,trust_score,autonomy_tier,sub_catalysts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(c.id,'highveld',c.name,c.domain,c.desc,c.status,c.agents,c.done,c.prog,c.rate,c.trust,c.tier,JSON.stringify(c.subs)).run();
  }

  // Anomalies
  const hvAnomalies = [
    {id:'an-hv-1',metric:'Furnace Temperature',expected:1550,actual:1620,deviation:4.5,severity:'high',hypothesis:'Refractory degradation causing heat retention anomaly'},
    {id:'an-hv-2',metric:'Coke Consumption Rate',expected:480,actual:542,deviation:12.9,severity:'critical',hypothesis:'Suboptimal blast distribution — tuyere blockage suspected'},
  ];
  for (const a of hvAnomalies) {
    await db.prepare('INSERT OR IGNORE INTO anomalies (id,tenant_id,metric,expected_value,actual_value,deviation,severity,hypothesis) VALUES (?,?,?,?,?,?,?,?)')
      .bind(a.id,'highveld',a.metric,a.expected,a.actual,a.deviation,a.severity,a.hypothesis).run();
  }

  // Process Flows
  await db.prepare('INSERT OR IGNORE INTO process_flows (id,tenant_id,name,steps,variants,avg_duration,conformance_rate,bottlenecks) VALUES (?,?,?,?,?,?,?,?)')
    .bind('pf-hv-1','highveld','Ore-to-Steel Production',JSON.stringify([
      {id:'s1',name:'Ore Reception',avgDuration:0.5,throughput:200,status:'healthy'},
      {id:'s2',name:'Smelting',avgDuration:8.0,throughput:180,status:'bottleneck'},
      {id:'s3',name:'Casting',avgDuration:2.0,throughput:175,status:'healthy'},
      {id:'s4',name:'Rolling',avgDuration:1.5,throughput:170,status:'healthy'},
      {id:'s5',name:'Quality Testing',avgDuration:0.8,throughput:168,status:'healthy'},
      {id:'s6',name:'Dispatch',avgDuration:0.3,throughput:165,status:'healthy'},
    ]),6,13.1,82,'["Smelting — furnace capacity constraint, 8h avg cycle"]').run();

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

  // Scenarios
  await db.prepare('INSERT OR IGNORE INTO scenarios (id,tenant_id,title,description,input_query,variables,results,status) VALUES (?,?,?,?,?,?,?,?)')
    .bind('sc-hv-1','highveld','Furnace #2 Emergency Shutdown','Impact analysis of an emergency furnace #2 shutdown for refractory relining','What if we shut down Furnace #2 for emergency refractory repair?','["production_capacity","maintenance_cost","delivery_commitments"]',
      JSON.stringify({npv_impact:-28000000,risk_change:'-65%',opportunity_cost:'R45M production delay over 8 weeks',recommendation:'Schedule controlled shutdown in 30 days, pre-position inventory to cover 60% of commitments'}),'completed').run();

  // Correlation Events
  await db.prepare('INSERT OR IGNORE INTO correlation_events (id,tenant_id,source_system,source_event,target_system,target_impact,confidence,lag_days) VALUES (?,?,?,?,?,?,?,?)')
    .bind('ce-hv-1','highveld','SAP PP','Furnace temperature spike > 1600C','SAP QM','Steel quality rejection rate +3.2%',0.91,1).run();

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPANY 2: GREENLEAF ORGANICS — XERO — AGRICULTURE
  // ═══════════════════════════════════════════════════════════════════════════
  await db.prepare('INSERT OR IGNORE INTO tenants (id,name,slug,industry,plan,status,deployment_model,region) VALUES (?,?,?,?,?,?,?,?)')
    .bind('greenleaf','GreenLeaf Organics (Pty) Ltd','greenleaf','agriculture','professional','active','saas','af-south-1').run();

  await db.prepare('INSERT OR IGNORE INTO tenant_entitlements (tenant_id,layers,catalyst_clusters,max_agents,max_users,autonomy_tiers,llm_tiers,features,sso_enabled,api_access,custom_branding,data_retention_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('greenleaf','["apex","pulse","catalysts","mind"]','["finance","supply-chain","sales"]',20,50,'["read-only","assisted"]','["tier-1","tier-2"]','["executive-briefings","risk-alerts","process-mining"]',0,1,0,180).run();

  const glUsers = [
    {id:'gl-admin',email:'admin@greenleaf-organics.co.za',name:'Sarah van Niekerk',role:'admin'},
    {id:'gl-ops',  email:'ops@greenleaf-organics.co.za',  name:'Mandla Dube',role:'manager'},
    {id:'gl-fin',  email:'finance@greenleaf-organics.co.za',name:'Riana Pretorius',role:'analyst'},
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

  await db.prepare('INSERT OR IGNORE INTO health_scores (id,tenant_id,overall_score,dimensions) VALUES (?,?,?,?)')
    .bind('hs-gl','greenleaf',81,JSON.stringify({
      financial_health:{score:85,trend:'up',delta:4},
      operational_efficiency:{score:78,trend:'stable',delta:0},
      supply_chain_resilience:{score:82,trend:'up',delta:2},
      customer_satisfaction:{score:88,trend:'up',delta:3},
      sustainability_score:{score:92,trend:'up',delta:1},
    })).run();

  const glRisks = [
    {id:'risk-gl-1',title:'Drought Impact on Harvest Yield',description:'Western Cape drought conditions forecast for next 90 days. Estimated 18% yield reduction on winter crops. R2.8M revenue impact.',severity:'high',category:'operations',probability:0.68,impact:2800000},
    {id:'risk-gl-2',title:'Organic Certification Audit Gap',description:'Soil testing records incomplete for 3 farms. Certification body audit in 45 days. Risk of losing organic premium pricing.',severity:'medium',category:'compliance',probability:0.45,impact:1200000},
    {id:'risk-gl-3',title:'Cold Chain Logistics Failure',description:'Refrigerated truck fleet aging — 3 of 8 trucks showing compressor issues. Fresh produce spoilage risk during summer.',severity:'high',category:'operations',probability:0.52,impact:1800000},
  ];
  for (const r of glRisks) {
    await db.prepare('INSERT OR IGNORE INTO risk_alerts (id,tenant_id,title,description,severity,category,probability,impact_value,recommended_actions) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(r.id,'greenleaf',r.title,r.description,r.severity,r.category,r.probability,r.impact,'[]').run();
  }

  const glMetrics = [
    {id:'pm-gl-1',name:'Harvest Yield per Hectare',value:4.2,unit:'tons/ha',status:'green',tg:4.0,ta:3.5,tr:3.0},
    {id:'pm-gl-2',name:'Organic Certification Rate',value:98.5,unit:'%',status:'green',tg:95,ta:90,tr:85},
    {id:'pm-gl-3',name:'Customer Order Fulfillment',value:94.2,unit:'%',status:'green',tg:92,ta:85,tr:80},
    {id:'pm-gl-4',name:'Produce Waste Rate',value:3.8,unit:'%',status:'green',tg:5,ta:8,tr:12},
    {id:'pm-gl-5',name:'Revenue per Hectare',value:185000,unit:'ZAR',status:'green',tg:150000,ta:120000,tr:100000},
  ];
  for (const m of glMetrics) {
    await db.prepare('INSERT OR IGNORE INTO process_metrics (id,tenant_id,name,value,unit,status,threshold_green,threshold_amber,threshold_red,trend,source_system) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(m.id,'greenleaf',m.name,m.value,m.unit,m.status,m.tg,m.ta,m.tr,'[]','Xero').run();
  }

  const glClusters = [
    {id:'cc-gl-fin',name:'Finance Catalyst',domain:'finance',desc:'Automated invoicing, expense categorization, cash flow forecasting',status:'active',agents:2,done:456,prog:5,rate:95.3,trust:92.1,tier:'assisted',subs:[{name:'Accounts Receivable',enabled:true,description:'Invoice generation and debtor management'},{name:'Accounts Payable',enabled:true,description:'Supplier payment scheduling'},{name:'Cash Flow Forecast',enabled:true,description:'12-week rolling cash flow projection'}]},
    {id:'cc-gl-supply',name:'Supply Chain Catalyst',domain:'supply-chain',desc:'Harvest planning, cold chain monitoring, distributor coordination',status:'active',agents:3,done:234,prog:7,rate:91.8,trust:88.5,tier:'read-only',subs:[{name:'Harvest Planning',enabled:true,description:'Seasonal yield forecasting and resource allocation'},{name:'Cold Chain Monitor',enabled:true,description:'Temperature and humidity tracking in transit'},{name:'Distributor Coordination',enabled:false,description:'Automated order fulfillment and delivery scheduling'}]},
  ];
  for (const c of glClusters) {
    await db.prepare('INSERT OR IGNORE INTO catalyst_clusters (id,tenant_id,name,domain,description,status,agent_count,tasks_completed,tasks_in_progress,success_rate,trust_score,autonomy_tier,sub_catalysts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(c.id,'greenleaf',c.name,c.domain,c.desc,c.status,c.agents,c.done,c.prog,c.rate,c.trust,c.tier,JSON.stringify(c.subs)).run();
  }

  const glAnomalies = [
    {id:'an-gl-1',metric:'Water Usage per Hectare',expected:4500,actual:5800,deviation:28.9,severity:'high',hypothesis:'Irrigation system leak on Farm 3 — drip line damage from recent hail'},
  ];
  for (const a of glAnomalies) {
    await db.prepare('INSERT OR IGNORE INTO anomalies (id,tenant_id,metric,expected_value,actual_value,deviation,severity,hypothesis) VALUES (?,?,?,?,?,?,?,?)')
      .bind(a.id,'greenleaf',a.metric,a.expected,a.actual,a.deviation,a.severity,a.hypothesis).run();
  }

  await db.prepare('INSERT OR IGNORE INTO process_flows (id,tenant_id,name,steps,variants,avg_duration,conformance_rate,bottlenecks) VALUES (?,?,?,?,?,?,?,?)')
    .bind('pf-gl-1','greenleaf','Seed-to-Shelf',JSON.stringify([
      {id:'s1',name:'Planting',avgDuration:1,throughput:100,status:'healthy'},
      {id:'s2',name:'Growing',avgDuration:90,throughput:95,status:'healthy'},
      {id:'s3',name:'Harvesting',avgDuration:3,throughput:88,status:'healthy'},
      {id:'s4',name:'Packing',avgDuration:1,throughput:85,status:'degraded'},
      {id:'s5',name:'Cold Chain Transport',avgDuration:1,throughput:82,status:'healthy'},
      {id:'s6',name:'Retail Delivery',avgDuration:0.5,throughput:80,status:'healthy'},
    ]),4,96.5,88,'["Packing — labour shortage during peak harvest"]').run();

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

  await db.prepare('INSERT OR IGNORE INTO tenant_entitlements (tenant_id,layers,catalyst_clusters,max_agents,max_users,autonomy_tiers,llm_tiers,features,sso_enabled,api_access,custom_branding,data_retention_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('medibridge','["apex","pulse","catalysts","mind","memory"]','["finance","hr","health-patient","health-compliance","health-supply"]',35,120,'["read-only","assisted"]','["tier-1","tier-2","tier-3"]','["executive-briefings","risk-alerts","process-mining","graphrag"]',1,1,1,365).run();

  const mbUsers = [
    {id:'mb-admin',email:'admin@medibridge.co.za',name:'Dr. Priya Govender',role:'admin'},
    {id:'mb-ceo',  email:'ceo@medibridge.co.za',  name:'Dr. James Nkosi',role:'executive'},
    {id:'mb-ops',  email:'ops@medibridge.co.za',  name:'Sister Nomsa Zulu',role:'manager'},
    {id:'mb-fin',  email:'finance@medibridge.co.za',name:'Rajesh Naicker',role:'analyst'},
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

  await db.prepare('INSERT OR IGNORE INTO health_scores (id,tenant_id,overall_score,dimensions) VALUES (?,?,?,?)')
    .bind('hs-mb','medibridge',84,JSON.stringify({
      financial_health:{score:82,trend:'up',delta:2},
      operational_efficiency:{score:86,trend:'up',delta:3},
      patient_satisfaction:{score:91,trend:'up',delta:4},
      staff_retention:{score:78,trend:'down',delta:-3},
      regulatory_compliance:{score:95,trend:'stable',delta:0},
      clinical_quality:{score:89,trend:'up',delta:2},
    })).run();

  const mbRisks = [
    {id:'risk-mb-1',title:'Nursing Staff Shortage — Critical',description:'Nursing vacancy rate at 22% across 8 clinics. Patient-to-nurse ratio exceeding NDoH safe limits (1:8 vs target 1:6). Quality of care risk.',severity:'high',category:'people',probability:0.78,impact:4500000},
    {id:'risk-mb-2',title:'Medical Aid Reimbursement Delays',description:'Discovery Health and Bonitas reimbursement cycle extended from 14 to 28 days. R8.2M cash flow impact across all clinics.',severity:'medium',category:'financial',probability:0.62,impact:8200000},
    {id:'risk-mb-3',title:'POPIA Patient Data Compliance Gap',description:'Patient records digitization incomplete for 3 clinics. Data breach risk during paper-to-digital migration. R2M fine exposure.',severity:'high',category:'compliance',probability:0.42,impact:2000000},
  ];
  for (const r of mbRisks) {
    await db.prepare('INSERT OR IGNORE INTO risk_alerts (id,tenant_id,title,description,severity,category,probability,impact_value,recommended_actions) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(r.id,'medibridge',r.title,r.description,r.severity,r.category,r.probability,r.impact,'[]').run();
  }

  const mbMetrics = [
    {id:'pm-mb-1',name:'Patient Wait Time',value:18.5,unit:'minutes',status:'green',tg:20,ta:30,tr:45},
    {id:'pm-mb-2',name:'Bed Occupancy Rate',value:82.3,unit:'%',status:'green',tg:85,ta:90,tr:95},
    {id:'pm-mb-3',name:'Medical Aid Claims Rejection',value:3.2,unit:'%',status:'green',tg:5,ta:8,tr:12},
    {id:'pm-mb-4',name:'Patient Readmission Rate',value:4.1,unit:'%',status:'green',tg:5,ta:8,tr:12},
    {id:'pm-mb-5',name:'Average Length of Stay',value:3.2,unit:'days',status:'green',tg:4,ta:5,tr:7},
  ];
  for (const m of mbMetrics) {
    await db.prepare('INSERT OR IGNORE INTO process_metrics (id,tenant_id,name,value,unit,status,threshold_green,threshold_amber,threshold_red,trend,source_system) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(m.id,'medibridge',m.name,m.value,m.unit,m.status,m.tg,m.ta,m.tr,'[]','Sage Business Cloud').run();
  }

  const mbClusters = [
    {id:'cc-mb-patient',name:'Patient Flow Catalyst',domain:'health-patient',desc:'Patient scheduling, ward allocation, discharge planning, readmission prediction',status:'active',agents:4,done:678,prog:12,rate:96.5,trust:94.8,tier:'assisted',subs:[{name:'Scheduling',enabled:true,description:'Automated patient appointment scheduling'},{name:'Ward Allocation',enabled:true,description:'Real-time bed management and allocation'},{name:'Discharge Planning',enabled:true,description:'Coordinated discharge with follow-up scheduling'},{name:'Readmission Prediction',enabled:false,description:'ML model predicting 30-day readmission risk'}]},
    {id:'cc-mb-compliance',name:'Healthcare Compliance Catalyst',domain:'health-compliance',desc:'NDoH reporting, POPIA compliance, clinical audit preparation',status:'active',agents:2,done:234,prog:3,rate:98.2,trust:97.1,tier:'read-only',subs:[{name:'NDoH Reporting',enabled:true,description:'Automated National Department of Health submissions'},{name:'POPIA Compliance',enabled:true,description:'Patient data privacy compliance checks'},{name:'Clinical Audit',enabled:false,description:'Automated clinical audit trail preparation'}]},
    {id:'cc-mb-fin',name:'Healthcare Finance Catalyst',domain:'finance',desc:'Medical aid billing, claims management, revenue cycle optimization',status:'active',agents:3,done:892,prog:15,rate:94.1,trust:91.3,tier:'assisted',subs:[{name:'Medical Aid Billing',enabled:true,description:'Automated medical aid claim submission'},{name:'Claims Management',enabled:true,description:'Claim tracking, follow-up, and rejection handling'},{name:'Invoice Reconciliation',enabled:true,description:'Statement vs claim reconciliation'},{name:'Revenue Cycle',enabled:false,description:'End-to-end revenue cycle optimization'}]},
  ];
  for (const c of mbClusters) {
    await db.prepare('INSERT OR IGNORE INTO catalyst_clusters (id,tenant_id,name,domain,description,status,agent_count,tasks_completed,tasks_in_progress,success_rate,trust_score,autonomy_tier,sub_catalysts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(c.id,'medibridge',c.name,c.domain,c.desc,c.status,c.agents,c.done,c.prog,c.rate,c.trust,c.tier,JSON.stringify(c.subs)).run();
  }

  const mbAnomalies = [
    {id:'an-mb-1',metric:'ER Wait Time (Sandton Clinic)',expected:15,actual:38,deviation:153,severity:'critical',hypothesis:'Staff shortage combined with 3 multi-vehicle accident admissions'},
    {id:'an-mb-2',metric:'Pharmaceutical Spend',expected:450000,actual:612000,deviation:36,severity:'high',hypothesis:'Bulk order of antiretrovirals ahead of tender deadline'},
  ];
  for (const a of mbAnomalies) {
    await db.prepare('INSERT OR IGNORE INTO anomalies (id,tenant_id,metric,expected_value,actual_value,deviation,severity,hypothesis) VALUES (?,?,?,?,?,?,?,?)')
      .bind(a.id,'medibridge',a.metric,a.expected,a.actual,a.deviation,a.severity,a.hypothesis).run();
  }

  await db.prepare('INSERT OR IGNORE INTO process_flows (id,tenant_id,name,steps,variants,avg_duration,conformance_rate,bottlenecks) VALUES (?,?,?,?,?,?,?,?)')
    .bind('pf-mb-1','medibridge','Patient Admission-to-Discharge',JSON.stringify([
      {id:'s1',name:'Registration',avgDuration:0.25,throughput:120,status:'healthy'},
      {id:'s2',name:'Triage',avgDuration:0.5,throughput:115,status:'healthy'},
      {id:'s3',name:'Consultation',avgDuration:0.75,throughput:100,status:'degraded'},
      {id:'s4',name:'Treatment',avgDuration:2.0,throughput:95,status:'healthy'},
      {id:'s5',name:'Billing & Claims',avgDuration:0.5,throughput:90,status:'bottleneck'},
      {id:'s6',name:'Discharge',avgDuration:0.25,throughput:88,status:'healthy'},
    ]),8,4.25,76,'["Billing & Claims — medical aid pre-auth delays"]').run();

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

  await db.prepare('INSERT OR IGNORE INTO tenant_entitlements (tenant_id,layers,catalyst_clusters,max_agents,max_users,autonomy_tiers,llm_tiers,features,sso_enabled,api_access,custom_branding,data_retention_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('bluepeak','["apex","pulse","catalysts"]','["finance","supply-chain","sales"]',15,40,'["read-only","assisted"]','["tier-1"]','["executive-briefings","process-mining"]',0,0,0,90).run();

  const bpUsers = [
    {id:'bp-admin',email:'admin@bluepeak-logistics.co.za',name:'Pieter Botha',role:'admin'},
    {id:'bp-ops',  email:'ops@bluepeak-logistics.co.za',  name:'Kagiso Molefe',role:'manager'},
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

  await db.prepare('INSERT OR IGNORE INTO health_scores (id,tenant_id,overall_score,dimensions) VALUES (?,?,?,?)')
    .bind('hs-bp','bluepeak',76,JSON.stringify({
      financial_health:{score:74,trend:'stable',delta:0},
      operational_efficiency:{score:79,trend:'up',delta:2},
      fleet_utilization:{score:82,trend:'up',delta:3},
      customer_satisfaction:{score:71,trend:'down',delta:-4},
      safety_compliance:{score:85,trend:'up',delta:1},
    })).run();

  const bpRisks = [
    {id:'risk-bp-1',title:'Diesel Price Surge',description:'Diesel prices up 18% in 30 days. Fleet consumes 45,000 litres/month. R243k monthly cost increase with no fuel surcharge pass-through.',severity:'high',category:'financial',probability:0.85,impact:2900000},
    {id:'risk-bp-2',title:'Driver Shortage — Code 14 EC',description:'Professional driver vacancy rate at 15%. 8 of 52 routes understaffed. Delivery delays impacting SLA compliance on Shoprite contract.',severity:'medium',category:'people',probability:0.58,impact:1800000},
    {id:'risk-bp-3',title:'N3 Toll Road Closure',description:'SANRAL scheduled maintenance on N3 between Harrismith and Durban. 14-day partial closure. Alternative routes add 120km and 2 hours per trip.',severity:'medium',category:'operations',probability:0.92,impact:950000},
  ];
  for (const r of bpRisks) {
    await db.prepare('INSERT OR IGNORE INTO risk_alerts (id,tenant_id,title,description,severity,category,probability,impact_value,recommended_actions) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(r.id,'bluepeak',r.title,r.description,r.severity,r.category,r.probability,r.impact,'[]').run();
  }

  const bpMetrics = [
    {id:'pm-bp-1',name:'On-Time Delivery Rate',value:88.7,unit:'%',status:'amber',tg:92,ta:85,tr:80},
    {id:'pm-bp-2',name:'Fleet Utilization',value:82.1,unit:'%',status:'green',tg:80,ta:70,tr:60},
    {id:'pm-bp-3',name:'Fuel Efficiency',value:7.8,unit:'km/L',status:'green',tg:7.5,ta:7.0,tr:6.5},
    {id:'pm-bp-4',name:'Cost per Kilometre',value:12.45,unit:'ZAR',status:'amber',tg:11,ta:13,tr:15},
    {id:'pm-bp-5',name:'Vehicle Downtime',value:6.2,unit:'%',status:'green',tg:8,ta:12,tr:15},
  ];
  for (const m of bpMetrics) {
    await db.prepare('INSERT OR IGNORE INTO process_metrics (id,tenant_id,name,value,unit,status,threshold_green,threshold_amber,threshold_red,trend,source_system) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(m.id,'bluepeak',m.name,m.value,m.unit,m.status,m.tg,m.ta,m.tr,'[]','Sage Pastel').run();
  }

  const bpClusters = [
    {id:'cc-bp-supply',name:'Route Optimization Catalyst',domain:'supply-chain',desc:'Real-time route planning, fuel optimization, fleet scheduling',status:'active',agents:3,done:567,prog:9,rate:93.4,trust:90.2,tier:'assisted',subs:[{name:'Route Planning',enabled:true,description:'Dynamic route optimization with traffic and weather'},{name:'Fuel Optimization',enabled:true,description:'Fuel consumption tracking and efficiency coaching'},{name:'Fleet Scheduling',enabled:true,description:'Vehicle and driver assignment optimization'},{name:'Load Optimization',enabled:false,description:'Weight distribution and capacity planning'}]},
    {id:'cc-bp-fin',name:'Transport Finance Catalyst',domain:'finance',desc:'Fuel cost tracking, trip costing, customer billing automation',status:'active',agents:2,done:345,prog:4,rate:95.8,trust:93.1,tier:'assisted',subs:[{name:'Trip Costing',enabled:true,description:'Automated per-trip cost calculation'},{name:'Customer Billing',enabled:true,description:'POD-based automated invoice generation'},{name:'Accounts Receivable',enabled:true,description:'Debtor aging and follow-up automation'}]},
  ];
  for (const c of bpClusters) {
    await db.prepare('INSERT OR IGNORE INTO catalyst_clusters (id,tenant_id,name,domain,description,status,agent_count,tasks_completed,tasks_in_progress,success_rate,trust_score,autonomy_tier,sub_catalysts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(c.id,'bluepeak',c.name,c.domain,c.desc,c.status,c.agents,c.done,c.prog,c.rate,c.trust,c.tier,JSON.stringify(c.subs)).run();
  }

  await db.prepare('INSERT OR IGNORE INTO process_flows (id,tenant_id,name,steps,variants,avg_duration,conformance_rate,bottlenecks) VALUES (?,?,?,?,?,?,?,?)')
    .bind('pf-bp-1','bluepeak','Load-to-Delivery',JSON.stringify([
      {id:'s1',name:'Order Assignment',avgDuration:0.5,throughput:80,status:'healthy'},
      {id:'s2',name:'Loading',avgDuration:1.5,throughput:75,status:'degraded'},
      {id:'s3',name:'Transit',avgDuration:8.0,throughput:72,status:'healthy'},
      {id:'s4',name:'Delivery',avgDuration:1.0,throughput:70,status:'healthy'},
      {id:'s5',name:'POD & Invoicing',avgDuration:0.5,throughput:68,status:'bottleneck'},
    ]),5,11.5,84,'["Loading — dock congestion at JHB depot","POD & Invoicing — manual paperwork delays"]').run();

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

  await db.prepare('INSERT OR IGNORE INTO tenant_entitlements (tenant_id,layers,catalyst_clusters,max_agents,max_users,autonomy_tiers,llm_tiers,features,sso_enabled,api_access,custom_branding,data_retention_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('novatech','["apex","pulse","catalysts","mind","memory"]','["finance","hr","sales"]',50,200,'["read-only","assisted","transactional"]','["tier-1","tier-2","tier-3"]','["scenario-modelling","process-mining","graphrag","executive-briefings","risk-alerts"]',1,1,1,365).run();

  const ntUsers = [
    {id:'nt-admin',email:'admin@novatech.co.za',name:'Aisha Patel',role:'admin'},
    {id:'nt-cto',  email:'cto@novatech.co.za',  name:'Michael Chen',role:'executive'},
    {id:'nt-vpsales',email:'vpsales@novatech.co.za',name:'David Mabaso',role:'manager'},
    {id:'nt-analyst',email:'analyst@novatech.co.za',name:'Fatima Osman',role:'analyst'},
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

  await db.prepare('INSERT OR IGNORE INTO health_scores (id,tenant_id,overall_score,dimensions) VALUES (?,?,?,?)')
    .bind('hs-nt','novatech',88,JSON.stringify({
      financial_health:{score:92,trend:'up',delta:5},
      operational_efficiency:{score:85,trend:'up',delta:2},
      customer_retention:{score:94,trend:'up',delta:3},
      product_innovation:{score:87,trend:'stable',delta:0},
      talent_acquisition:{score:81,trend:'down',delta:-2},
      engineering_velocity:{score:89,trend:'up',delta:4},
    })).run();

  const ntRisks = [
    {id:'risk-nt-1',title:'Churn Risk — Enterprise Tier',description:'Top 3 enterprise customers (R12M ARR combined) showing usage decline -35% over 60 days. Contract renewals in Q3. Risk of losing 28% of enterprise revenue.',severity:'critical',category:'revenue',probability:0.72,impact:12000000},
    {id:'risk-nt-2',title:'Cloud Infrastructure Cost Overrun',description:'AWS spend tracking 42% above budget. Unoptimized EC2 instances and S3 lifecycle policies. R480k monthly overspend.',severity:'medium',category:'financial',probability:0.88,impact:5800000},
    {id:'risk-nt-3',title:'Key Engineer Retention Risk',description:'3 senior engineers (platform team) received competing offers. Departure would delay Q3 roadmap by 6-8 weeks.',severity:'high',category:'people',probability:0.55,impact:3200000},
  ];
  for (const r of ntRisks) {
    await db.prepare('INSERT OR IGNORE INTO risk_alerts (id,tenant_id,title,description,severity,category,probability,impact_value,recommended_actions) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(r.id,'novatech',r.title,r.description,r.severity,r.category,r.probability,r.impact,'[]').run();
  }

  const ntMetrics = [
    {id:'pm-nt-1',name:'Monthly Recurring Revenue',value:4250000,unit:'ZAR',status:'green',tg:4000000,ta:3500000,tr:3000000},
    {id:'pm-nt-2',name:'Customer Churn Rate',value:2.8,unit:'%',status:'green',tg:3.5,ta:5.0,tr:7.0},
    {id:'pm-nt-3',name:'System Uptime',value:99.97,unit:'%',status:'green',tg:99.9,ta:99.5,tr:99.0},
    {id:'pm-nt-4',name:'Net Promoter Score',value:72,unit:'NPS',status:'green',tg:60,ta:40,tr:20},
    {id:'pm-nt-5',name:'Sprint Velocity',value:84,unit:'story points',status:'green',tg:75,ta:60,tr:45},
    {id:'pm-nt-6',name:'Customer Acquisition Cost',value:18500,unit:'ZAR',status:'amber',tg:15000,ta:20000,tr:25000},
  ];
  for (const m of ntMetrics) {
    await db.prepare('INSERT OR IGNORE INTO process_metrics (id,tenant_id,name,value,unit,status,threshold_green,threshold_amber,threshold_red,trend,source_system) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(m.id,'novatech',m.name,m.value,m.unit,m.status,m.tg,m.ta,m.tr,'[]','Oracle Fusion').run();
  }

  const ntClusters = [
    {id:'cc-nt-sales',name:'Revenue Operations Catalyst',domain:'sales',desc:'Churn prediction, upsell identification, pipeline health, renewal management',status:'active',agents:5,done:1234,prog:18,rate:95.7,trust:93.4,tier:'transactional',subs:[{name:'Churn Prediction',enabled:true,description:'ML model predicting customer churn probability'},{name:'Upsell Engine',enabled:true,description:'Cross-sell and upsell opportunity identification'},{name:'Pipeline Health',enabled:true,description:'Deal velocity and win-rate tracking'},{name:'Renewal Management',enabled:false,description:'Automated renewal reminders and processing'}]},
    {id:'cc-nt-fin',name:'SaaS Finance Catalyst',domain:'finance',desc:'Revenue recognition, ARR tracking, cash flow forecasting, cost optimization',status:'active',agents:3,done:678,prog:8,rate:97.2,trust:95.8,tier:'assisted',subs:[{name:'Revenue Recognition',enabled:true,description:'ASC 606 compliant revenue recognition'},{name:'ARR Tracking',enabled:true,description:'Real-time ARR, MRR, and expansion metrics'},{name:'Invoice Reconciliation',enabled:true,description:'Subscription billing reconciliation'},{name:'Cost Optimization',enabled:false,description:'Cloud and vendor spend optimization'}]},
    {id:'cc-nt-hr',name:'Talent Intelligence Catalyst',domain:'hr',desc:'Retention prediction, compensation benchmarking, hiring pipeline optimization',status:'active',agents:2,done:234,prog:5,rate:92.1,trust:88.9,tier:'read-only',subs:[{name:'Retention Prediction',enabled:true,description:'Employee flight risk scoring'},{name:'Compensation Benchmarking',enabled:true,description:'Market rate comparison and equity analysis'},{name:'Hiring Pipeline',enabled:false,description:'Candidate funnel optimization and sourcing'}]},
  ];
  for (const c of ntClusters) {
    await db.prepare('INSERT OR IGNORE INTO catalyst_clusters (id,tenant_id,name,domain,description,status,agent_count,tasks_completed,tasks_in_progress,success_rate,trust_score,autonomy_tier,sub_catalysts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(c.id,'novatech',c.name,c.domain,c.desc,c.status,c.agents,c.done,c.prog,c.rate,c.trust,c.tier,JSON.stringify(c.subs)).run();
  }

  const ntAnomalies = [
    {id:'an-nt-1',metric:'API Response Time P99',expected:200,actual:850,deviation:325,severity:'critical',hypothesis:'Database connection pool exhaustion during peak — missing index on user_sessions table'},
    {id:'an-nt-2',metric:'Free-to-Paid Conversion',expected:8.5,actual:5.2,deviation:-38.8,severity:'high',hypothesis:'Onboarding flow regression after v2.4 deploy — step 3 completion dropped 40%'},
  ];
  for (const a of ntAnomalies) {
    await db.prepare('INSERT OR IGNORE INTO anomalies (id,tenant_id,metric,expected_value,actual_value,deviation,severity,hypothesis) VALUES (?,?,?,?,?,?,?,?)')
      .bind(a.id,'novatech',a.metric,a.expected,a.actual,a.deviation,a.severity,a.hypothesis).run();
  }

  await db.prepare('INSERT OR IGNORE INTO process_flows (id,tenant_id,name,steps,variants,avg_duration,conformance_rate,bottlenecks) VALUES (?,?,?,?,?,?,?,?)')
    .bind('pf-nt-1','novatech','Lead-to-Revenue',JSON.stringify([
      {id:'s1',name:'Lead Capture',avgDuration:0.1,throughput:500,status:'healthy'},
      {id:'s2',name:'Qualification',avgDuration:2.0,throughput:200,status:'healthy'},
      {id:'s3',name:'Demo & POC',avgDuration:14.0,throughput:80,status:'degraded'},
      {id:'s4',name:'Proposal',avgDuration:5.0,throughput:60,status:'healthy'},
      {id:'s5',name:'Negotiation',avgDuration:10.0,throughput:45,status:'bottleneck'},
      {id:'s6',name:'Closed Won',avgDuration:1.0,throughput:30,status:'healthy'},
    ]),12,32.1,68,'["Demo & POC — SE capacity constraint","Negotiation — legal review delays"]').run();

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
  const ntCustomers = [
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

  // Scenarios
  await db.prepare('INSERT OR IGNORE INTO scenarios (id,tenant_id,title,description,input_query,variables,results,status) VALUES (?,?,?,?,?,?,?,?)')
    .bind('sc-nt-1','novatech','AWS Cost Optimization Sprint','Rightsize EC2 instances and implement S3 lifecycle policies','What if we optimize our AWS infrastructure spend?','["ec2_instances","s3_storage","reserved_instances"]',
      JSON.stringify({npv_impact:3200000,risk_change:'-5%',opportunity_cost:'2 engineering weeks',recommendation:'Implement reserved instances for baseline, spot for burst. Expected 35% cost reduction.'}),'completed').run();

  // Correlation Events
  await db.prepare('INSERT OR IGNORE INTO correlation_events (id,tenant_id,source_system,source_event,target_system,target_impact,confidence,lag_days) VALUES (?,?,?,?,?,?,?,?)')
    .bind('ce-nt-1','novatech','Product Analytics','Feature adoption drop > 20% in 30d','CRM','Customer churn probability +18%',0.87,45).run();
}
