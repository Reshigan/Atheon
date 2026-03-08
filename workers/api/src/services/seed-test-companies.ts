/**
 * Test Companies Seed Data
 * 7 companies across different ERP systems and industries for comprehensive testing
 *
 * Companies:
 * 1. Highveld Steel Works - SAP S/4HANA - Mining/Steel Manufacturing
 * 2. GreenLeaf Organics - Xero - Agriculture/Organic Farming
 * 3. MediBridge Clinics - Sage Business Cloud - Healthcare
 * 4. BluePeak Logistics - Sage Pastel - Logistics/Transport
 * 5. NovaTech Solutions - Oracle Fusion - Technology/SaaS
 * 6. Protea Manufacturing (Medium) - Sage 300 - Manufacturing (100 employees)
 * 7. Kapstadt Global Holdings (Large MNC) - SAP S/4HANA - Diversified Conglomerate (500+ employees, multi-currency)
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
    {id:'emp-hv-1',empNum:'HVS-001',first:'Johan',last:'van der Merwe',dept:'Executive',pos:'CEO',salary:180000},
    {id:'emp-hv-2',empNum:'HVS-042',first:'Sipho',last:'Ndlovu',dept:'Smelting Operations',pos:'Operations Manager',salary:95000},
    {id:'emp-hv-3',empNum:'HVS-105',first:'Lindiwe',last:'Khumalo',dept:'Finance',pos:'Senior Analyst',salary:72000},
    {id:'emp-hv-4',empNum:'HVS-010',first:'Pieter',last:'Botha',dept:'Executive',pos:'CFO',salary:160000},
    {id:'emp-hv-5',empNum:'HVS-020',first:'Thabo',last:'Mokoena',dept:'Smelting Operations',pos:'Furnace Supervisor',salary:65000},
    {id:'emp-hv-6',empNum:'HVS-021',first:'David',last:'Pretorius',dept:'Smelting Operations',pos:'Furnace Operator',salary:38000},
    {id:'emp-hv-7',empNum:'HVS-022',first:'Solomon',last:'Mahlangu',dept:'Smelting Operations',pos:'Furnace Operator',salary:38000},
    {id:'emp-hv-8',empNum:'HVS-030',first:'Andries',last:'Nel',dept:'Rolling Mill',pos:'Mill Supervisor',salary:62000},
    {id:'emp-hv-9',empNum:'HVS-031',first:'Bongani',last:'Zwane',dept:'Rolling Mill',pos:'Mill Operator',salary:36000},
    {id:'emp-hv-10',empNum:'HVS-032',first:'Mandla',last:'Sithole',dept:'Rolling Mill',pos:'Mill Operator',salary:36000},
    {id:'emp-hv-11',empNum:'HVS-040',first:'Grace',last:'Maseko',dept:'Quality Control',pos:'QC Manager',salary:75000},
    {id:'emp-hv-12',empNum:'HVS-041',first:'Johannes',last:'van Wyk',dept:'Quality Control',pos:'Lab Technician',salary:42000},
    {id:'emp-hv-13',empNum:'HVS-050',first:'Kagiso',last:'Molefe',dept:'Maintenance',pos:'Chief Engineer',salary:88000},
    {id:'emp-hv-14',empNum:'HVS-051',first:'Tshepo',last:'Motaung',dept:'Maintenance',pos:'Electrician',salary:45000},
    {id:'emp-hv-15',empNum:'HVS-052',first:'Jacob',last:'Erasmus',dept:'Maintenance',pos:'Fitter & Turner',salary:45000},
    {id:'emp-hv-16',empNum:'HVS-060',first:'Nomsa',last:'Dlamini',dept:'HR',pos:'HR Manager',salary:68000},
    {id:'emp-hv-17',empNum:'HVS-061',first:'Palesa',last:'Tau',dept:'HR',pos:'Payroll Clerk',salary:28000},
    {id:'emp-hv-18',empNum:'HVS-070',first:'Rudi',last:'Smit',dept:'Safety',pos:'SHE Officer',salary:55000},
    {id:'emp-hv-19',empNum:'HVS-080',first:'William',last:'Mabasa',dept:'Logistics',pos:'Dispatch Manager',salary:52000},
    {id:'emp-hv-20',empNum:'HVS-081',first:'Daniel',last:'Fourie',dept:'Logistics',pos:'Warehouse Foreman',salary:35000},
    {id:'emp-hv-21',empNum:'HVS-090',first:'Lerato',last:'Phiri',dept:'Procurement',pos:'Buyer',salary:48000},
    {id:'emp-hv-22',empNum:'HVS-100',first:'Samuel',last:'Khumalo',dept:'Finance',pos:'Accountant',salary:55000},
    {id:'emp-hv-23',empNum:'HVS-101',first:'Zandile',last:'Mkhwanazi',dept:'Finance',pos:'Cost Accountant',salary:52000},
    {id:'emp-hv-24',empNum:'HVS-110',first:'Hendrik',last:'Venter',dept:'Sales',pos:'Sales Manager',salary:75000},
    {id:'emp-hv-25',empNum:'HVS-111',first:'Themba',last:'Mthembu',dept:'Sales',pos:'Key Account Exec',salary:55000},
    {id:'emp-hv-26',empNum:'HVS-120',first:'Michael',last:'Nkosi',dept:'Mining',pos:'Mine Foreman',salary:68000},
    {id:'emp-hv-27',empNum:'HVS-121',first:'Francois',last:'du Toit',dept:'Mining',pos:'Blasting Specialist',salary:52000},
    {id:'emp-hv-28',empNum:'HVS-122',first:'Aisha',last:'Patel',dept:'Mining',pos:'Geologist',salary:72000},
    {id:'emp-hv-29',empNum:'HVS-130',first:'Siyanda',last:'Cele',dept:'IT',pos:'Systems Admin',salary:48000},
    {id:'emp-hv-30',empNum:'HVS-140',first:'Hlengiwe',last:'Zwane',dept:'Admin',pos:'Office Manager',salary:35000},
  ];
  for (const e of hvEmps) {
    await db.prepare("INSERT OR IGNORE INTO erp_employees (id,tenant_id,source_system,employee_number,first_name,last_name,department,position,gross_salary,salary_frequency,status,hire_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(e.id,'highveld','SAP S/4HANA',e.empNum,e.first,e.last,e.dept,e.pos,e.salary,'monthly','active','2023-06-01').run();
  }

  // ── Highveld Invoices (steel sales — 12 months, ~40/month) ──
  const hvInvoices: {id:string;num:string;cust:string;cname:string;date:string;due:string;total:number;paid:number;status:string;pstatus:string}[] = [];
  const hvInvCustomers = [
    {id:'cust-hv-1',name:'Aveng Group'},
    {id:'cust-hv-2',name:'Murray & Roberts'},
  ];
  let hvInvIdx = 1;
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    const dateStr = `${year}-${month}-15`;
    const dueStr = `${year}-${month}-28`;
    for (let j = 0; j < 40; j++) {
      const cust = hvInvCustomers[j % 2];
      const amount = 180000 + Math.round(Math.sin(hvInvIdx * 0.5) * 120000 + hvInvIdx * 500);
      const isPaid = mo < 9;
      const isOverdue = !isPaid && mo < 11;
      hvInvoices.push({ id:`inv-hv-${hvInvIdx}`, num:`INV-HV-${String(hvInvIdx).padStart(5,'0')}`, cust:cust.id, cname:cust.name, date:dateStr, due:dueStr, total:amount, paid:isPaid?amount:0, status:'approved', pstatus:isPaid?'paid':(isOverdue?'overdue':'unpaid') });
      hvInvIdx++;
    }
  }
  for (const inv of hvInvoices) {
    await db.prepare("INSERT OR IGNORE INTO erp_invoices (id,tenant_id,source_system,invoice_number,customer_id,customer_name,invoice_date,due_date,total,amount_paid,amount_due,status,payment_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(inv.id,'highveld','SAP S/4HANA',inv.num,inv.cust,inv.cname,inv.date,inv.due,inv.total,inv.paid,inv.total-inv.paid,inv.status,inv.pstatus).run();
  }

  // ── Highveld Purchase Orders (ore, energy, consumables — 12 months, ~25/month) ──
  const hvPOs: {id:string;num:string;sup:string;sname:string;date:string;del:string;total:number;status:string}[] = [];
  const hvPOSuppliers = [{id:'sup-hv-1',name:'Kumba Iron Ore'},{id:'sup-hv-2',name:'Eskom Holdings'}];
  let hvPOIdx = 1;
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let j = 0; j < 25; j++) {
      const sup = hvPOSuppliers[j % 2];
      const amount = j % 2 === 0 ? 2500000 + Math.round(Math.sin(hvPOIdx) * 800000) : 850000 + Math.round(Math.sin(hvPOIdx) * 200000);
      hvPOs.push({ id:`po-hv-${hvPOIdx}`, num:`PO-HV-${String(hvPOIdx).padStart(5,'0')}`, sup:sup.id, sname:sup.name, date:`${year}-${month}-05`, del:`${year}-${month}-20`, total:amount, status:mo<10?'received':'open' });
      hvPOIdx++;
    }
  }
  for (const po of hvPOs) {
    await db.prepare("INSERT OR IGNORE INTO erp_purchase_orders (id,tenant_id,source_system,po_number,supplier_id,supplier_name,order_date,delivery_date,total,status) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(po.id,'highveld','SAP S/4HANA',po.num,po.sup,po.sname,po.date,po.del,po.total,po.status).run();
  }

  // ── Highveld Journal Entries (20/month × 12) ──
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let j = 1; j <= 20; j++) {
      const jid = `je-hv-${mo * 20 + j}`;
      const amt = 500000 + mo * 50000 + j * 10000;
      await db.prepare("INSERT OR IGNORE INTO erp_journal_entries (id,tenant_id,source_system,journal_number,journal_date,description,total_debit,total_credit,status) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(jid,'highveld','SAP S/4HANA',`JE-HV-${String(mo*20+j).padStart(4,'0')}`,`${year}-${month}-28`,`Month-end closing entry ${j}`,amt,amt,'posted').run();
    }
  }

  // ── Highveld Bank Transactions (30/month × 12) ──
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let d = 1; d <= 30; d++) {
      const day = String(Math.min(d, 28)).padStart(2, '0');
      const btId = `bt-hv-${mo * 30 + d}`;
      if (d % 4 === 0) {
        await db.prepare("INSERT OR IGNORE INTO erp_bank_transactions (id,tenant_id,source_system,bank_account,transaction_date,description,reference,credit,debit,balance) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(btId,'highveld','SAP S/4HANA','ABSA-001',`${year}-${month}-${day}`,`Steel sales receipt`,`REC-HV-${mo}-${d}`,850000+d*10000,0,45000000).run();
      } else {
        await db.prepare("INSERT OR IGNORE INTO erp_bank_transactions (id,tenant_id,source_system,bank_account,transaction_date,description,reference,debit,credit,balance) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(btId,'highveld','SAP S/4HANA','ABSA-001',`${year}-${month}-${day}`,d%3===0?'Eskom electricity':'Iron ore payment',`PAY-HV-${mo}-${d}`,d%3===0?420000:1200000,0,45000000).run();
      }
    }
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

  // ── GreenLeaf Employees (85 staff: farm workers, supervisors, sales, admin) ──
  const glEmps = [
    {id:'emp-gl-1',num:'GL001',first:'Jan',last:'du Plessis',dept:'Executive',pos:'CEO & Founder',salary:95000},
    {id:'emp-gl-2',num:'GL002',first:'Sarah',last:'van Niekerk',dept:'Executive',pos:'Operations Director',salary:82000},
    {id:'emp-gl-3',num:'GL003',first:'Mandla',last:'Dube',dept:'Farm Operations',pos:'Farm Manager - Stellenbosch',salary:55000},
    {id:'emp-gl-4',num:'GL004',first:'Riana',last:'Pretorius',dept:'Finance',pos:'Financial Manager',salary:65000},
    {id:'emp-gl-5',num:'GL005',first:'Themba',last:'Moyo',dept:'Farm Operations',pos:'Irrigation Specialist',salary:38000},
    {id:'emp-gl-6',num:'GL006',first:'Anele',last:'Sithole',dept:'Farm Operations',pos:'Harvest Supervisor',salary:35000},
    {id:'emp-gl-7',num:'GL007',first:'Pieter',last:'Joubert',dept:'Farm Operations',pos:'Tractor Operator',salary:22000},
    {id:'emp-gl-8',num:'GL008',first:'Nomsa',last:'Nkosi',dept:'Farm Operations',pos:'Farm Worker',salary:18000},
    {id:'emp-gl-9',num:'GL009',first:'Sipho',last:'Mthembu',dept:'Farm Operations',pos:'Farm Worker',salary:18000},
    {id:'emp-gl-10',num:'GL010',first:'Grace',last:'Ndlovu',dept:'Farm Operations',pos:'Farm Worker',salary:18000},
    {id:'emp-gl-11',num:'GL011',first:'Johannes',last:'Botha',dept:'Quality',pos:'QC Manager',salary:52000},
    {id:'emp-gl-12',num:'GL012',first:'Lindiwe',last:'Khumalo',dept:'Quality',pos:'Lab Technician',salary:32000},
    {id:'emp-gl-13',num:'GL013',first:'David',last:'van Wyk',dept:'Packhouse',pos:'Packhouse Manager',salary:45000},
    {id:'emp-gl-14',num:'GL014',first:'Bongani',last:'Zwane',dept:'Packhouse',pos:'Packing Supervisor',salary:28000},
    {id:'emp-gl-15',num:'GL015',first:'Palesa',last:'Tau',dept:'Sales',pos:'Sales Manager',salary:58000},
    {id:'emp-gl-16',num:'GL016',first:'Hendrik',last:'Erasmus',dept:'Sales',pos:'Key Account Manager',salary:48000},
    {id:'emp-gl-17',num:'GL017',first:'Zandile',last:'Mkhwanazi',dept:'Sales',pos:'Sales Coordinator',salary:32000},
    {id:'emp-gl-18',num:'GL018',first:'Andries',last:'Nel',dept:'Logistics',pos:'Distribution Manager',salary:48000},
    {id:'emp-gl-19',num:'GL019',first:'Solomon',last:'Mahlangu',dept:'Logistics',pos:'Delivery Driver',salary:22000},
    {id:'emp-gl-20',num:'GL020',first:'Lerato',last:'Phiri',dept:'Admin',pos:'Office Manager',salary:30000},
  ];
  for (const e of glEmps) {
    await db.prepare("INSERT OR IGNORE INTO erp_employees (id,tenant_id,source_system,employee_number,first_name,last_name,department,position,gross_salary,salary_frequency,status,hire_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(e.id,'greenleaf','Xero',e.num,e.first,e.last,e.dept,e.pos,e.salary,'monthly','active','2024-02-01').run();
  }

  // ── GreenLeaf Invoices (produce sales — 12 months, ~30/month) ──
  const glInvoices: {id:string;num:string;cust:string;cname:string;date:string;due:string;total:number;paid:number;status:string;pstatus:string}[] = [];
  const glInvCustomers = [
    {id:'cust-gl-1',name:'Woolworths Food'},
    {id:'cust-gl-2',name:'Checkers FreshX'},
    {id:'cust-gl-3',name:'Food Lovers Market'},
  ];
  let glInvIdx = 1;
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    const dateStr = `${year}-${month}-15`;
    const dueStr = `${year}-${month}-28`;
    for (let j = 0; j < 30; j++) {
      const cust = glInvCustomers[j % 3];
      const amount = 8000 + Math.round(Math.sin(glInvIdx * 0.8) * 5000 + glInvIdx * 50);
      const isPaid = mo < 9;
      const isOverdue = !isPaid && mo < 11;
      glInvoices.push({ id:`inv-gl-${glInvIdx}`, num:`INV-GL-${String(glInvIdx).padStart(5,'0')}`, cust:cust.id, cname:cust.name, date:dateStr, due:dueStr, total:amount, paid:isPaid?amount:0, status:'approved', pstatus:isPaid?'paid':(isOverdue?'overdue':'unpaid') });
      glInvIdx++;
    }
  }
  for (const inv of glInvoices) {
    await db.prepare("INSERT OR IGNORE INTO erp_invoices (id,tenant_id,source_system,invoice_number,customer_id,customer_name,invoice_date,due_date,total,amount_paid,amount_due,status,payment_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(inv.id,'greenleaf','Xero',inv.num,inv.cust,inv.cname,inv.date,inv.due,inv.total,inv.paid,inv.total-inv.paid,inv.status,inv.pstatus).run();
  }

  // ── GreenLeaf Purchase Orders (seeds, fertilizer, packaging — 12 months, ~18/month) ──
  const glPOs: {id:string;num:string;sup:string;sname:string;date:string;del:string;total:number;status:string}[] = [];
  const glPOSuppliers = [{id:'sup-gl-1',name:'Starke Ayres Seeds'},{id:'sup-gl-2',name:'Omnia Fertilizer'}];
  let glPOIdx = 1;
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let j = 0; j < 18; j++) {
      const sup = glPOSuppliers[j % 2];
      const amount = j % 2 === 0 ? 25000 + Math.round(Math.sin(glPOIdx) * 12000) : 18000 + Math.round(Math.sin(glPOIdx) * 8000);
      glPOs.push({ id:`po-gl-${glPOIdx}`, num:`PO-GL-${String(glPOIdx).padStart(5,'0')}`, sup:sup.id, sname:sup.name, date:`${year}-${month}-05`, del:`${year}-${month}-12`, total:amount, status:mo<10?'received':'open' });
      glPOIdx++;
    }
  }
  for (const po of glPOs) {
    await db.prepare("INSERT OR IGNORE INTO erp_purchase_orders (id,tenant_id,source_system,po_number,supplier_id,supplier_name,order_date,delivery_date,total,status) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(po.id,'greenleaf','Xero',po.num,po.sup,po.sname,po.date,po.del,po.total,po.status).run();
  }

  // ── GreenLeaf Journal Entries (12/month × 12) ──
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let j = 1; j <= 12; j++) {
      const jid = `je-gl-${mo * 12 + j}`;
      const amt = 15000 + mo * 2000 + j * 500;
      await db.prepare("INSERT OR IGNORE INTO erp_journal_entries (id,tenant_id,source_system,journal_number,journal_date,description,total_debit,total_credit,status) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(jid,'greenleaf','Xero',`JE-GL-${String(mo*12+j).padStart(4,'0')}`,`${year}-${month}-28`,`Month-end closing entry ${j}`,amt,amt,'posted').run();
    }
  }

  // ── GreenLeaf Bank Transactions (22/month × 12) ──
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let d = 1; d <= 22; d++) {
      const day = String(Math.min(d, 28)).padStart(2, '0');
      const btId = `bt-gl-${mo * 22 + d}`;
      if (d % 3 === 0) {
        await db.prepare("INSERT OR IGNORE INTO erp_bank_transactions (id,tenant_id,source_system,bank_account,transaction_date,description,reference,credit,debit,balance) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(btId,'greenleaf','Xero','NED-001',`${year}-${month}-${day}`,`Produce sales receipt`,`REC-GL-${mo}-${d}`,35000+d*500,0,2800000).run();
      } else {
        await db.prepare("INSERT OR IGNORE INTO erp_bank_transactions (id,tenant_id,source_system,bank_account,transaction_date,description,reference,debit,credit,balance) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(btId,'greenleaf','Xero','NED-001',`${year}-${month}-${day}`,d%2===0?'Seed supplier payment':'Fertilizer purchase',`PAY-GL-${mo}-${d}`,d%2===0?12000:8500,0,2800000).run();
      }
    }
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
    {id:'emp-mb-1',empNum:'MB-001',first:'James',last:'Nkosi',dept:'Executive',pos:'CEO',salary:165000},
    {id:'emp-mb-2',empNum:'MB-015',first:'Nomsa',last:'Zulu',dept:'Nursing',pos:'Head of Nursing',salary:85000},
    {id:'emp-mb-3',empNum:'MB-042',first:'Priya',last:'Govender',dept:'Clinical',pos:'Medical Director',salary:180000},
    {id:'emp-mb-4',empNum:'MB-002',first:'Rajesh',last:'Naicker',dept:'Finance',pos:'CFO',salary:145000},
    {id:'emp-mb-5',empNum:'MB-010',first:'Dr. Thabo',last:'Mokoena',dept:'Clinical',pos:'GP - Sandton Clinic',salary:120000},
    {id:'emp-mb-6',empNum:'MB-011',first:'Dr. Sarah',last:'van der Berg',dept:'Clinical',pos:'GP - Rosebank Clinic',salary:120000},
    {id:'emp-mb-7',empNum:'MB-012',first:'Dr. Fatima',last:'Khan',dept:'Clinical',pos:'GP - Centurion Clinic',salary:115000},
    {id:'emp-mb-8',empNum:'MB-016',first:'Sister Grace',last:'Maseko',dept:'Nursing',pos:'Registered Nurse',salary:42000},
    {id:'emp-mb-9',empNum:'MB-017',first:'Sister Lerato',last:'Phiri',dept:'Nursing',pos:'Registered Nurse',salary:42000},
    {id:'emp-mb-10',empNum:'MB-018',first:'Sister Palesa',last:'Tau',dept:'Nursing',pos:'Registered Nurse',salary:42000},
    {id:'emp-mb-11',empNum:'MB-019',first:'Bongani',last:'Zwane',dept:'Nursing',pos:'Enrolled Nurse',salary:28000},
    {id:'emp-mb-12',empNum:'MB-020',first:'Mandla',last:'Sithole',dept:'Nursing',pos:'Enrolled Nurse',salary:28000},
    {id:'emp-mb-13',empNum:'MB-025',first:'Sipho',last:'Ndlovu',dept:'Pharmacy',pos:'Pharmacist',salary:65000},
    {id:'emp-mb-14',empNum:'MB-026',first:'Zandile',last:'Mkhwanazi',dept:'Pharmacy',pos:'Pharmacy Assistant',salary:22000},
    {id:'emp-mb-15',empNum:'MB-030',first:'Johannes',last:'van Wyk',dept:'Radiology',pos:'Radiographer',salary:55000},
    {id:'emp-mb-16',empNum:'MB-035',first:'David',last:'Pretorius',dept:'Pathology',pos:'Lab Technologist',salary:48000},
    {id:'emp-mb-17',empNum:'MB-040',first:'Precious',last:'Mthethwa',dept:'Admin',pos:'Practice Manager - Sandton',salary:52000},
    {id:'emp-mb-18',empNum:'MB-041',first:'Lindiwe',last:'Khumalo',dept:'Admin',pos:'Practice Manager - Rosebank',salary:52000},
    {id:'emp-mb-19',empNum:'MB-043',first:'Kagiso',last:'Molefe',dept:'Billing',pos:'Medical Aid Claims Manager',salary:48000},
    {id:'emp-mb-20',empNum:'MB-044',first:'Solomon',last:'Mahlangu',dept:'Billing',pos:'Claims Clerk',salary:25000},
    {id:'emp-mb-21',empNum:'MB-045',first:'Nomsa',last:'Dlamini',dept:'Billing',pos:'Claims Clerk',salary:25000},
    {id:'emp-mb-22',empNum:'MB-050',first:'Andries',last:'Nel',dept:'Finance',pos:'Accountant',salary:55000},
    {id:'emp-mb-23',empNum:'MB-055',first:'Hlengiwe',last:'Zwane',dept:'Reception',pos:'Receptionist',salary:18000},
    {id:'emp-mb-24',empNum:'MB-056',first:'Thandi',last:'Cele',dept:'Reception',pos:'Receptionist',salary:18000},
    {id:'emp-mb-25',empNum:'MB-060',first:'Michael',last:'Chen',dept:'IT',pos:'Systems Administrator',salary:52000},
  ];
  for (const e of mbEmps) {
    await db.prepare("INSERT OR IGNORE INTO erp_employees (id,tenant_id,source_system,employee_number,first_name,last_name,department,position,gross_salary,salary_frequency,status,hire_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(e.id,'medibridge','Sage Business Cloud',e.empNum,e.first,e.last,e.dept,e.pos,e.salary,'monthly','active','2024-03-01').run();
  }

  // ── MediBridge Products (medical supplies, pharmaceuticals) ──
  const mbProducts = [
    {id:'prod-mb-1',sku:'MED-SYRINGE-10',name:'Disposable Syringe 10ml',cat:'Medical Supplies',price:8,stock:5000},
    {id:'prod-mb-2',sku:'MED-GLOVES-L',name:'Nitrile Gloves Large (Box 100)',cat:'Medical Supplies',price:180,stock:200},
    {id:'prod-mb-3',sku:'MED-MASK-N95',name:'N95 Respirator Mask',cat:'PPE',price:45,stock:1000},
    {id:'prod-mb-4',sku:'PHARM-AMOX-500',name:'Amoxicillin 500mg (30 caps)',cat:'Pharmaceuticals',price:85,stock:300},
    {id:'prod-mb-5',sku:'PHARM-PARA-500',name:'Paracetamol 500mg (100 tabs)',cat:'Pharmaceuticals',price:42,stock:500},
    {id:'prod-mb-6',sku:'PHARM-OMEP-20',name:'Omeprazole 20mg (28 caps)',cat:'Pharmaceuticals',price:120,stock:250},
    {id:'prod-mb-7',sku:'DIAG-XRAY-FILM',name:'X-Ray Film 14x17',cat:'Diagnostics',price:350,stock:100},
    {id:'prod-mb-8',sku:'DIAG-BLOOD-CBC',name:'CBC Blood Test Kit',cat:'Diagnostics',price:95,stock:400},
    {id:'prod-mb-9',sku:'MED-BANDAGE-5',name:'Crepe Bandage 5cm',cat:'Medical Supplies',price:15,stock:800},
    {id:'prod-mb-10',sku:'EQUIP-BP-MONITOR',name:'Digital BP Monitor',cat:'Equipment',price:2800,stock:15},
  ];
  for (const p of mbProducts) {
    await db.prepare('INSERT OR IGNORE INTO erp_products (id,tenant_id,source_system,sku,name,category,selling_price,stock_on_hand) VALUES (?,?,?,?,?,?,?,?)')
      .bind(p.id,'medibridge','Sage Business Cloud',p.sku,p.name,p.cat,p.price,p.stock).run();
  }

  // ── MediBridge Invoices (patient consultations + medical aid claims — 12 months, ~35/month) ──
  const mbInvoices: {id:string;num:string;cust:string;cname:string;date:string;due:string;total:number;paid:number;status:string;pstatus:string}[] = [];
  const mbInvCustomers = [
    {id:'cust-mb-1',name:'Discovery Health'},
    {id:'cust-mb-2',name:'Momentum Medical Scheme'},
    {id:'cust-mb-3',name:'GEMS (Government)'},
  ];
  let mbInvIdx = 1;
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    const dateStr = `${year}-${month}-15`;
    const dueStr = `${year}-${month}-28`;
    for (let j = 0; j < 35; j++) {
      const cust = mbInvCustomers[j % 3];
      const amount = 1200 + Math.round(Math.sin(mbInvIdx * 0.6) * 800 + mbInvIdx * 20);
      const isPaid = mo < 8;
      const isOverdue = !isPaid && mo < 11;
      mbInvoices.push({ id:`inv-mb-${mbInvIdx}`, num:`INV-MB-${String(mbInvIdx).padStart(5,'0')}`, cust:cust.id, cname:cust.name, date:dateStr, due:dueStr, total:amount, paid:isPaid?amount:0, status:'approved', pstatus:isPaid?'paid':(isOverdue?'overdue':'unpaid') });
      mbInvIdx++;
    }
  }
  for (const inv of mbInvoices) {
    await db.prepare("INSERT OR IGNORE INTO erp_invoices (id,tenant_id,source_system,invoice_number,customer_id,customer_name,invoice_date,due_date,total,amount_paid,amount_due,status,payment_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(inv.id,'medibridge','Sage Business Cloud',inv.num,inv.cust,inv.cname,inv.date,inv.due,inv.total,inv.paid,inv.total-inv.paid,inv.status,inv.pstatus).run();
  }

  // ── MediBridge Purchase Orders (pharma, supplies, equipment — 12 months, ~22/month) ──
  const mbPOs: {id:string;num:string;sup:string;sname:string;date:string;del:string;total:number;status:string}[] = [];
  const mbPOSuppliers = [{id:'sup-mb-1',name:'Adcock Ingram'},{id:'sup-mb-2',name:'Cipla Medpro'},{id:'sup-mb-3',name:'Surgical Innovations'}];
  let mbPOIdx = 1;
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let j = 0; j < 22; j++) {
      const sup = mbPOSuppliers[j % 3];
      const amount = 8000 + Math.round(Math.sin(mbPOIdx) * 5000 + mbPOIdx * 100);
      mbPOs.push({ id:`po-mb-${mbPOIdx}`, num:`PO-MB-${String(mbPOIdx).padStart(5,'0')}`, sup:sup.id, sname:sup.name, date:`${year}-${month}-05`, del:`${year}-${month}-10`, total:amount, status:mo<10?'received':'open' });
      mbPOIdx++;
    }
  }
  for (const po of mbPOs) {
    await db.prepare("INSERT OR IGNORE INTO erp_purchase_orders (id,tenant_id,source_system,po_number,supplier_id,supplier_name,order_date,delivery_date,total,status) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(po.id,'medibridge','Sage Business Cloud',po.num,po.sup,po.sname,po.date,po.del,po.total,po.status).run();
  }

  // ── MediBridge Journal Entries (15/month × 12) ──
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let j = 1; j <= 15; j++) {
      const jid = `je-mb-${mo * 15 + j}`;
      const amt = 25000 + mo * 3000 + j * 800;
      await db.prepare("INSERT OR IGNORE INTO erp_journal_entries (id,tenant_id,source_system,journal_number,journal_date,description,total_debit,total_credit,status) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(jid,'medibridge','Sage Business Cloud',`JE-MB-${String(mo*15+j).padStart(4,'0')}`,`${year}-${month}-28`,`Month-end closing entry ${j}`,amt,amt,'posted').run();
    }
  }

  // ── MediBridge Bank Transactions (28/month × 12) ──
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let d = 1; d <= 28; d++) {
      const day = String(d).padStart(2, '0');
      const btId = `bt-mb-${mo * 28 + d}`;
      if (d % 4 === 0) {
        await db.prepare("INSERT OR IGNORE INTO erp_bank_transactions (id,tenant_id,source_system,bank_account,transaction_date,description,reference,credit,debit,balance) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(btId,'medibridge','Sage Business Cloud','STD-001',`${year}-${month}-${day}`,`Medical aid payment received`,`REC-MB-${mo}-${d}`,45000+d*500,0,8500000).run();
      } else {
        await db.prepare("INSERT OR IGNORE INTO erp_bank_transactions (id,tenant_id,source_system,bank_account,transaction_date,description,reference,debit,credit,balance) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(btId,'medibridge','Sage Business Cloud','STD-001',`${year}-${month}-${day}`,d%3===0?'Pharmaceutical supplier':'Medical supplies payment',`PAY-MB-${mo}-${d}`,d%3===0?18000:8500,0,8500000).run();
      }
    }
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

  // ── BluePeak Employees (180 staff: drivers, mechanics, admin, warehouse) ──
  const bpEmployees = [
    {id:'emp-bp-1',num:'BP001',first:'Pieter',last:'Botha',dept:'Management',pos:'Operations Director',salary:85000},
    {id:'emp-bp-2',num:'BP002',first:'Francois',last:'du Toit',dept:'Management',pos:'CEO',salary:120000},
    {id:'emp-bp-3',num:'BP003',first:'Kagiso',last:'Molefe',dept:'Operations',pos:'Fleet Manager',salary:55000},
    {id:'emp-bp-4',num:'BP004',first:'Tshepo',last:'Motaung',dept:'Driving',pos:'Long-Haul Driver',salary:28000},
    {id:'emp-bp-5',num:'BP005',first:'Sipho',last:'Ndlovu',dept:'Driving',pos:'Long-Haul Driver',salary:28000},
    {id:'emp-bp-6',num:'BP006',first:'Johannes',last:'van Wyk',dept:'Driving',pos:'Long-Haul Driver',salary:28000},
    {id:'emp-bp-7',num:'BP007',first:'Thabo',last:'Mokoena',dept:'Driving',pos:'Long-Haul Driver',salary:26000},
    {id:'emp-bp-8',num:'BP008',first:'Mandla',last:'Sithole',dept:'Driving',pos:'Long-Haul Driver',salary:26000},
    {id:'emp-bp-9',num:'BP009',first:'David',last:'Pretorius',dept:'Driving',pos:'Local Delivery Driver',salary:22000},
    {id:'emp-bp-10',num:'BP010',first:'William',last:'Mabasa',dept:'Driving',pos:'Local Delivery Driver',salary:22000},
    {id:'emp-bp-11',num:'BP011',first:'Jacob',last:'Erasmus',dept:'Workshop',pos:'Head Mechanic',salary:45000},
    {id:'emp-bp-12',num:'BP012',first:'Samuel',last:'Khumalo',dept:'Workshop',pos:'Mechanic',salary:32000},
    {id:'emp-bp-13',num:'BP013',first:'Daniel',last:'Fourie',dept:'Workshop',pos:'Mechanic',salary:32000},
    {id:'emp-bp-14',num:'BP014',first:'Michael',last:'Nkosi',dept:'Workshop',pos:'Tyre Specialist',salary:28000},
    {id:'emp-bp-15',num:'BP015',first:'Zandile',last:'Mkhwanazi',dept:'Finance',pos:'Financial Controller',salary:65000},
    {id:'emp-bp-16',num:'BP016',first:'Lerato',last:'Phiri',dept:'Finance',pos:'Accounts Clerk',salary:25000},
    {id:'emp-bp-17',num:'BP017',first:'Nomsa',last:'Dlamini',dept:'Finance',pos:'Accounts Clerk',salary:25000},
    {id:'emp-bp-18',num:'BP018',first:'Hendrik',last:'Venter',dept:'Warehouse',pos:'Depot Manager - JHB',salary:48000},
    {id:'emp-bp-19',num:'BP019',first:'Solomon',last:'Mahlangu',dept:'Warehouse',pos:'Warehouse Operative',salary:18000},
    {id:'emp-bp-20',num:'BP020',first:'Bongani',last:'Zwane',dept:'Warehouse',pos:'Warehouse Operative',salary:18000},
    {id:'emp-bp-21',num:'BP021',first:'Andries',last:'Nel',dept:'Warehouse',pos:'Depot Manager - CPT',salary:48000},
    {id:'emp-bp-22',num:'BP022',first:'Grace',last:'Maseko',dept:'Admin',pos:'HR Administrator',salary:30000},
    {id:'emp-bp-23',num:'BP023',first:'Palesa',last:'Tau',dept:'Sales',pos:'Key Account Manager',salary:52000},
    {id:'emp-bp-24',num:'BP024',first:'Themba',last:'Mthembu',dept:'Sales',pos:'Business Development',salary:45000},
    {id:'emp-bp-25',num:'BP025',first:'Rudi',last:'Smit',dept:'Compliance',pos:'Compliance Officer',salary:42000},
  ];
  for (const e of bpEmployees) {
    await db.prepare("INSERT OR IGNORE INTO erp_employees (id,tenant_id,source_system,employee_number,first_name,last_name,department,position,gross_salary,salary_frequency,status,hire_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(e.id,'bluepeak','Sage Pastel',e.num,e.first,e.last,e.dept,e.pos,e.salary,'monthly','active','2024-01-15').run();
  }

  // ── BluePeak Products (fleet parts, fuel, consumables) ──
  const bpProducts = [
    {id:'prod-bp-1',sku:'FUEL-DIESEL-50',name:'Diesel 50ppm',cat:'Fuel',cost:22.50,sell:0,stock:45000,uom:'litre'},
    {id:'prod-bp-2',sku:'TYRE-STEER-315',name:'Steer Tyre 315/80R22.5',cat:'Tyres',cost:6800,sell:0,stock:24,uom:'EA'},
    {id:'prod-bp-3',sku:'TYRE-DRIVE-315',name:'Drive Tyre 315/80R22.5',cat:'Tyres',cost:7200,sell:0,stock:36,uom:'EA'},
    {id:'prod-bp-4',sku:'OIL-15W40-20L',name:'Engine Oil 15W-40 20L',cat:'Lubricants',cost:1850,sell:0,stock:60,uom:'EA'},
    {id:'prod-bp-5',sku:'FILTER-OIL-HV',name:'Oil Filter Heavy Vehicle',cat:'Filters',cost:380,sell:0,stock:80,uom:'EA'},
    {id:'prod-bp-6',sku:'FILTER-FUEL-HV',name:'Fuel Filter Heavy Vehicle',cat:'Filters',cost:420,sell:0,stock:60,uom:'EA'},
    {id:'prod-bp-7',sku:'BRAKE-PAD-HV',name:'Brake Pad Set Heavy Vehicle',cat:'Brakes',cost:2800,sell:0,stock:20,uom:'set'},
    {id:'prod-bp-8',sku:'CLUTCH-KIT-HV',name:'Clutch Kit Heavy Vehicle',cat:'Drivetrain',cost:18500,sell:0,stock:4,uom:'EA'},
    {id:'prod-bp-9',sku:'ADBLUE-1000L',name:'AdBlue 1000L IBC',cat:'Consumables',cost:4200,sell:0,stock:8,uom:'EA'},
    {id:'prod-bp-10',sku:'PALLET-STD',name:'Standard Pallet 1200x1000',cat:'Warehouse',cost:280,sell:0,stock:500,uom:'EA'},
    {id:'prod-bp-11',sku:'STRAP-RATCHET',name:'Ratchet Strap 10m',cat:'Equipment',cost:350,sell:0,stock:120,uom:'EA'},
    {id:'prod-bp-12',sku:'TARP-SIDE-13M',name:'Side Curtain Tarp 13.6m',cat:'Equipment',cost:28000,sell:0,stock:6,uom:'EA'},
  ];
  for (const p of bpProducts) {
    await db.prepare('INSERT OR IGNORE INTO erp_products (id,tenant_id,source_system,sku,name,category,cost_price,selling_price,stock_on_hand,uom,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(p.id,'bluepeak','Sage Pastel',p.sku,p.name,p.cat,p.cost,p.sell,p.stock,p.uom,1).run();
  }

  // ── BluePeak Invoices (transport services billed to customers — 12 months) ──
  const bpInvoices: {id:string;num:string;cust:string;cname:string;date:string;due:string;total:number;paid:number;status:string;pstatus:string}[] = [];
  const bpInvCustomers = [
    {id:'cust-bp-1',name:'Shoprite Holdings'},
    {id:'cust-bp-2',name:'Massmart (Walmart)'},
  ];
  let bpInvIdx = 1;
  for (let mo = 0; mo < 12; mo++) {
    const m = String(mo + 1).padStart(2, '0');
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    const dateStr = `${year}-${month}-15`;
    const dueStr = `${year}-${month}-28`;
    // ~35 invoices/month across 2 major customers + smaller ones
    for (let j = 0; j < 35; j++) {
      const cust = bpInvCustomers[j % 2];
      const amount = 25000 + Math.round(Math.sin(bpInvIdx * 0.7) * 15000 + bpInvIdx * 100);
      const isPaid = mo < 9; // last 3 months unpaid
      const isOverdue = !isPaid && mo < 11;
      bpInvoices.push({
        id: `inv-bp-${bpInvIdx}`,
        num: `INV-BP-${String(bpInvIdx).padStart(5, '0')}`,
        cust: cust.id,
        cname: cust.name,
        date: dateStr,
        due: dueStr,
        total: amount,
        paid: isPaid ? amount : 0,
        status: 'approved',
        pstatus: isPaid ? 'paid' : (isOverdue ? 'overdue' : 'unpaid'),
      });
      bpInvIdx++;
    }
  }
  for (const inv of bpInvoices) {
    await db.prepare("INSERT OR IGNORE INTO erp_invoices (id,tenant_id,source_system,invoice_number,customer_id,customer_name,invoice_date,due_date,total,amount_paid,amount_due,status,payment_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(inv.id,'bluepeak','Sage Pastel',inv.num,inv.cust,inv.cname,inv.date,inv.due,inv.total,inv.paid,inv.total-inv.paid,inv.status,inv.pstatus).run();
  }

  // ── BluePeak Purchase Orders (fuel, parts, services — 12 months) ──
  const bpPOs: {id:string;num:string;sup:string;sname:string;date:string;del:string;total:number;status:string}[] = [];
  const bpPOSuppliers = [
    {id:'sup-bp-1',name:'Engen Fleet'},
    {id:'sup-bp-2',name:'Bridgestone SA'},
  ];
  let bpPOIdx = 1;
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    const dateStr = `${year}-${month}-05`;
    const delStr = `${year}-${month}-10`;
    // ~20 POs/month (fuel deliveries, parts, service contracts)
    for (let j = 0; j < 20; j++) {
      const sup = bpPOSuppliers[j % 2];
      const amount = j % 2 === 0 ? 180000 + Math.round(Math.sin(bpPOIdx) * 40000) : 15000 + Math.round(Math.sin(bpPOIdx) * 8000);
      bpPOs.push({
        id: `po-bp-${bpPOIdx}`,
        num: `PO-BP-${String(bpPOIdx).padStart(5, '0')}`,
        sup: sup.id,
        sname: sup.name,
        date: dateStr,
        del: delStr,
        total: amount,
        status: mo < 10 ? 'received' : 'open',
      });
      bpPOIdx++;
    }
  }
  for (const po of bpPOs) {
    await db.prepare("INSERT OR IGNORE INTO erp_purchase_orders (id,tenant_id,source_system,po_number,supplier_id,supplier_name,order_date,delivery_date,total,status) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(po.id,'bluepeak','Sage Pastel',po.num,po.sup,po.sname,po.date,po.del,po.total,po.status).run();
  }

  // ── BluePeak Journal Entries (monthly closing journals) ──
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    const dateStr = `${year}-${month}-28`;
    for (let j = 1; j <= 15; j++) {
      const jid = `je-bp-${mo * 15 + j}`;
      const jnum = `JE-BP-${String(mo * 15 + j).padStart(4, '0')}`;
      const amt = 50000 + mo * 5000 + j * 1000;
      await db.prepare("INSERT OR IGNORE INTO erp_journal_entries (id,tenant_id,source_system,journal_number,journal_date,description,total_debit,total_credit,status) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(jid,'bluepeak','Sage Pastel',jnum,dateStr,`Month-end closing entry ${j}`,amt,amt,'posted').run();
    }
  }

  // ── BluePeak Bank Transactions (fuel, tolls, maintenance, customer receipts) ──
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let d = 1; d <= 25; d++) {
      const day = String(d).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const btId = `bt-bp-${mo * 25 + d}`;
      // Alternate debits and credits
      if (d % 3 === 0) {
        await db.prepare("INSERT OR IGNORE INTO erp_bank_transactions (id,tenant_id,source_system,bank_account,transaction_date,description,reference,credit,debit,balance) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(btId,'bluepeak','Sage Pastel','FNB-001',dateStr,'Customer payment received',`REC-${mo}-${d}`,85000 + d * 1000,0,1800000).run();
      } else {
        await db.prepare("INSERT OR IGNORE INTO erp_bank_transactions (id,tenant_id,source_system,bank_account,transaction_date,description,reference,debit,credit,balance) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(btId,'bluepeak','Sage Pastel','FNB-001',dateStr,d % 2 === 0 ? 'Fuel purchase - Engen' : 'Toll fees - N3 corridor',`PAY-${mo}-${d}`,d % 2 === 0 ? 45000 : 3500,0,1800000).run();
      }
    }
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
    {id:'emp-nt-1',empNum:'NT-001',first:'Aisha',last:'Patel',dept:'Executive',pos:'CEO & Founder',salary:200000},
    {id:'emp-nt-2',empNum:'NT-002',first:'Michael',last:'Chen',dept:'Technology',pos:'CTO',salary:175000},
    {id:'emp-nt-3',empNum:'NT-015',first:'David',last:'Mabaso',dept:'Sales',pos:'VP Sales',salary:145000},
    {id:'emp-nt-4',empNum:'NT-042',first:'Fatima',last:'Osman',dept:'Product',pos:'Product Analyst',salary:65000},
    {id:'emp-nt-5',empNum:'NT-003',first:'Rajesh',last:'Naicker',dept:'Executive',pos:'CFO',salary:160000},
    {id:'emp-nt-6',empNum:'NT-004',first:'Siyanda',last:'Cele',dept:'Executive',pos:'COO',salary:155000},
    {id:'emp-nt-7',empNum:'NT-010',first:'Pieter',last:'Joubert',dept:'Engineering',pos:'VP Engineering',salary:145000},
    {id:'emp-nt-8',empNum:'NT-011',first:'Thabo',last:'Mokoena',dept:'Engineering',pos:'Senior Backend Dev',salary:95000},
    {id:'emp-nt-9',empNum:'NT-012',first:'Grace',last:'Maseko',dept:'Engineering',pos:'Senior Frontend Dev',salary:92000},
    {id:'emp-nt-10',empNum:'NT-013',first:'Bongani',last:'Zwane',dept:'Engineering',pos:'Full-Stack Dev',salary:78000},
    {id:'emp-nt-11',empNum:'NT-014',first:'Mandla',last:'Sithole',dept:'Engineering',pos:'Full-Stack Dev',salary:78000},
    {id:'emp-nt-12',empNum:'NT-020',first:'Lindiwe',last:'Khumalo',dept:'Engineering',pos:'DevOps Engineer',salary:88000},
    {id:'emp-nt-13',empNum:'NT-021',first:'Johannes',last:'van Wyk',dept:'Engineering',pos:'QA Engineer',salary:72000},
    {id:'emp-nt-14',empNum:'NT-022',first:'Sipho',last:'Ndlovu',dept:'Engineering',pos:'Data Engineer',salary:92000},
    {id:'emp-nt-15',empNum:'NT-023',first:'Daniel',last:'Fourie',dept:'Engineering',pos:'ML Engineer',salary:98000},
    {id:'emp-nt-16',empNum:'NT-030',first:'Palesa',last:'Tau',dept:'Product',pos:'Head of Product',salary:120000},
    {id:'emp-nt-17',empNum:'NT-031',first:'Hendrik',last:'Erasmus',dept:'Product',pos:'UX Designer',salary:72000},
    {id:'emp-nt-18',empNum:'NT-040',first:'Zandile',last:'Mkhwanazi',dept:'Sales',pos:'Enterprise AE',salary:85000},
    {id:'emp-nt-19',empNum:'NT-041',first:'Themba',last:'Mthembu',dept:'Sales',pos:'Enterprise AE',salary:85000},
    {id:'emp-nt-20',empNum:'NT-043',first:'Andries',last:'Nel',dept:'Sales',pos:'SDR Manager',salary:68000},
    {id:'emp-nt-21',empNum:'NT-050',first:'Solomon',last:'Mahlangu',dept:'Customer Success',pos:'VP CS',salary:120000},
    {id:'emp-nt-22',empNum:'NT-051',first:'Lerato',last:'Phiri',dept:'Customer Success',pos:'CSM',salary:65000},
    {id:'emp-nt-23',empNum:'NT-052',first:'Nomsa',last:'Dlamini',dept:'Customer Success',pos:'CSM',salary:65000},
    {id:'emp-nt-24',empNum:'NT-060',first:'Hlengiwe',last:'Zwane',dept:'Support',pos:'Support Lead',salary:58000},
    {id:'emp-nt-25',empNum:'NT-061',first:'Jacob',last:'Erasmus',dept:'Support',pos:'Support Engineer',salary:45000},
    {id:'emp-nt-26',empNum:'NT-070',first:'Riana',last:'Pretorius',dept:'Finance',pos:'Financial Controller',salary:85000},
    {id:'emp-nt-27',empNum:'NT-071',first:'William',last:'Mabasa',dept:'Finance',pos:'Accounts Manager',salary:58000},
    {id:'emp-nt-28',empNum:'NT-080',first:'Sarah',last:'van Niekerk',dept:'HR',pos:'People Ops Manager',salary:72000},
    {id:'emp-nt-29',empNum:'NT-090',first:'Rudi',last:'Smit',dept:'Marketing',pos:'Head of Marketing',salary:110000},
    {id:'emp-nt-30',empNum:'NT-091',first:'Anele',last:'Dube',dept:'Marketing',pos:'Content Manager',salary:55000},
  ];
  for (const e of ntEmps) {
    await db.prepare("INSERT OR IGNORE INTO erp_employees (id,tenant_id,source_system,employee_number,first_name,last_name,department,position,gross_salary,salary_frequency,status,hire_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(e.id,'novatech','Oracle Fusion',e.empNum,e.first,e.last,e.dept,e.pos,e.salary,'monthly','active','2024-01-15').run();
  }

  // ── NovaTech Invoices (SaaS subscriptions + services — 12 months, ~38/month) ──
  const ntInvoices: {id:string;num:string;cust:string;cname:string;date:string;due:string;total:number;paid:number;status:string;pstatus:string}[] = [];
  const ntInvCustomers = [
    {id:'cust-nt-1',name:'Standard Bank'},
    {id:'cust-nt-2',name:'Vodacom Business'},
    {id:'cust-nt-3',name:'Sanlam Group'},
    {id:'cust-nt-4',name:'MTN Group'},
  ];
  let ntInvIdx = 1;
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    const dateStr = `${year}-${month}-01`;
    const dueStr = `${year}-${month}-15`;
    for (let j = 0; j < 38; j++) {
      const cust = ntInvCustomers[j % 4];
      const amount = 45000 + Math.round(Math.sin(ntInvIdx * 0.4) * 25000 + ntInvIdx * 200);
      const isPaid = mo < 9;
      const isOverdue = !isPaid && mo < 11;
      ntInvoices.push({ id:`inv-nt-${ntInvIdx}`, num:`INV-NT-${String(ntInvIdx).padStart(5,'0')}`, cust:cust.id, cname:cust.name, date:dateStr, due:dueStr, total:amount, paid:isPaid?amount:0, status:'approved', pstatus:isPaid?'paid':(isOverdue?'overdue':'unpaid') });
      ntInvIdx++;
    }
  }
  for (const inv of ntInvoices) {
    await db.prepare("INSERT OR IGNORE INTO erp_invoices (id,tenant_id,source_system,invoice_number,customer_id,customer_name,invoice_date,due_date,total,amount_paid,amount_due,status,payment_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(inv.id,'novatech','Oracle Fusion',inv.num,inv.cust,inv.cname,inv.date,inv.due,inv.total,inv.paid,inv.total-inv.paid,inv.status,inv.pstatus).run();
  }

  // ── NovaTech Purchase Orders (cloud infra, SaaS tools, talent — 12 months, ~24/month) ──
  const ntPOs: {id:string;num:string;sup:string;sname:string;date:string;del:string;total:number;status:string}[] = [];
  const ntPOSuppliers = [{id:'sup-nt-1',name:'AWS South Africa'},{id:'sup-nt-2',name:'Offerzen Talent'}];
  let ntPOIdx = 1;
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let j = 0; j < 24; j++) {
      const sup = ntPOSuppliers[j % 2];
      const amount = j % 2 === 0 ? 380000 + Math.round(Math.sin(ntPOIdx) * 80000) : 65000 + Math.round(Math.sin(ntPOIdx) * 20000);
      ntPOs.push({ id:`po-nt-${ntPOIdx}`, num:`PO-NT-${String(ntPOIdx).padStart(5,'0')}`, sup:sup.id, sname:sup.name, date:`${year}-${month}-05`, del:`${year}-${month}-10`, total:amount, status:mo<10?'received':'open' });
      ntPOIdx++;
    }
  }
  for (const po of ntPOs) {
    await db.prepare("INSERT OR IGNORE INTO erp_purchase_orders (id,tenant_id,source_system,po_number,supplier_id,supplier_name,order_date,delivery_date,total,status) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(po.id,'novatech','Oracle Fusion',po.num,po.sup,po.sname,po.date,po.del,po.total,po.status).run();
  }

  // ── NovaTech Journal Entries (18/month × 12) ──
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let j = 1; j <= 18; j++) {
      const jid = `je-nt-${mo * 18 + j}`;
      const amt = 120000 + mo * 10000 + j * 5000;
      await db.prepare("INSERT OR IGNORE INTO erp_journal_entries (id,tenant_id,source_system,journal_number,journal_date,description,total_debit,total_credit,status) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(jid,'novatech','Oracle Fusion',`JE-NT-${String(mo*18+j).padStart(4,'0')}`,`${year}-${month}-28`,`Month-end closing entry ${j}`,amt,amt,'posted').run();
    }
  }

  // ── NovaTech Bank Transactions (30/month × 12) ──
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let d = 1; d <= 30; d++) {
      const day = String(Math.min(d, 28)).padStart(2, '0');
      const btId = `bt-nt-${mo * 30 + d}`;
      if (d % 3 === 0) {
        await db.prepare("INSERT OR IGNORE INTO erp_bank_transactions (id,tenant_id,source_system,bank_account,transaction_date,description,reference,credit,debit,balance) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(btId,'novatech','Oracle Fusion','INV-001',`${year}-${month}-${day}`,`SaaS subscription payment`,`REC-NT-${mo}-${d}`,125000+d*2000,0,12500000).run();
      } else {
        await db.prepare("INSERT OR IGNORE INTO erp_bank_transactions (id,tenant_id,source_system,bank_account,transaction_date,description,reference,debit,credit,balance) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(btId,'novatech','Oracle Fusion','INV-001',`${year}-${month}-${day}`,d%2===0?'AWS cloud infrastructure':'Engineering salaries',`PAY-NT-${mo}-${d}`,d%2===0?95000:280000,0,12500000).run();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPANY 6: PROTEA MANUFACTURING — SAGE 300 — MEDIUM MANUFACTURER (~100 employees)
  // ═══════════════════════════════════════════════════════════════════════════
  await db.prepare('INSERT OR IGNORE INTO tenants (id,name,slug,industry,plan,status,deployment_model,region) VALUES (?,?,?,?,?,?,?,?)')
    .bind('protea','Protea Manufacturing (Pty) Ltd','protea','manufacturing','professional','active','saas','af-south-1').run();

  await db.prepare('INSERT OR REPLACE INTO tenant_entitlements (tenant_id,layers,catalyst_clusters,max_agents,max_users,autonomy_tiers,llm_tiers,features,sso_enabled,api_access,custom_branding,data_retention_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('protea','["apex","pulse","catalysts","mind","memory"]','["finance","procurement","supply-chain","hr","sales","manufacturing-quality","manufacturing-production"]',20,100,'["read-only","assisted","transactional"]','["tier-1","tier-2"]','["scenario-modelling","process-mining","risk-alerts"]',0,1,0,365).run();

  const pmUsers = [
    { id:'pm-admin', email:'admin@protea-mfg.co.za', name:'Johan Botha', role:'admin' },
    { id:'pm-ceo',   email:'ceo@protea-mfg.co.za',   name:'Pieter Venter', role:'executive' },
    { id:'pm-ops',   email:'ops@protea-mfg.co.za',   name:'Sello Mahlangu', role:'manager' },
    { id:'pm-fin',   email:'finance@protea-mfg.co.za', name:'Anita de Villiers', role:'analyst' },
    { id:'pm-qa',    email:'quality@protea-mfg.co.za', name:'Themba Nkosi', role:'operator' },
    { id:'pm-viewer', email:'viewer@protea-mfg.co.za', name:'Lerato Molefe', role:'viewer' },
  ];
  for (const u of pmUsers) {
    await db.prepare('INSERT OR IGNORE INTO users (id,tenant_id,email,name,role,password_hash,permissions,status) VALUES (?,?,?,?,?,?,?,?)')
      .bind(u.id,'protea',u.email,u.name,u.role,pwHash,'["*"]','active').run();
  }

  // ERP Connection
  await db.prepare(
    "INSERT OR IGNORE INTO erp_connections (id,tenant_id,adapter_id,name,status,config,sync_frequency,records_synced,connected_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))"
  ).bind('conn-pm-sage','protea','erp-sage-300','Protea Sage 300 Production','connected',
    '{"host":"sage300.protea-mfg.co.za","company":"PROTEA","database":"PROTEA_PROD","base_url":"https://sage300.protea-mfg.co.za"}',
    'hourly',856420).run();

  // Catalyst Clusters
  const pmClusters = [
    {id:'cc-pm-fin',name:'Finance Operations Catalyst',domain:'finance',desc:'Invoice processing, AR/AP automation, financial close optimization',status:'active',agents:4,done:412,prog:8,rate:95.2,trust:92.1,tier:'transactional',subs:[{name:'Accounts Receivable',enabled:true,description:'Automated AR aging and collection workflows'},{name:'Accounts Payable',enabled:true,description:'Invoice matching and payment scheduling'},{name:'Invoice Reconciliation',enabled:true,description:'3-way match: PO, GRN, Invoice'},{name:'Financial Close',enabled:true,description:'Automated month-end closing journal entries'},{name:'Cash Flow Forecasting',enabled:false,description:'AI-driven cash position prediction'}]},
    {id:'cc-pm-proc',name:'Procurement Catalyst',domain:'procurement',desc:'Raw material sourcing, supplier evaluation, PO automation',status:'active',agents:3,done:287,prog:5,rate:93.8,trust:90.5,tier:'assisted',subs:[{name:'Supplier Scoring',enabled:true,description:'Automated supplier risk and performance rating'},{name:'PO Automation',enabled:true,description:'Purchase order creation and approval routing'},{name:'Spend Analytics',enabled:true,description:'Category-level spend analysis and savings identification'},{name:'Raw Material Sourcing',enabled:true,description:'Optimal sourcing recommendation based on price and quality'}]},
    {id:'cc-pm-supply',name:'Supply Chain Catalyst',domain:'supply-chain',desc:'Inventory optimization, demand planning, warehouse management',status:'active',agents:3,done:198,prog:6,rate:91.5,trust:88.3,tier:'assisted',subs:[{name:'Inventory Optimization',enabled:true,description:'Safety stock and reorder point calculation'},{name:'Demand Forecasting',enabled:true,description:'ML-based demand prediction by product line'},{name:'Warehouse Management',enabled:true,description:'Pick path optimization and layout recommendation'},{name:'Supplier Lead Time',enabled:true,description:'Delivery performance tracking and prediction'}]},
    {id:'cc-pm-hr',name:'Workforce Management Catalyst',domain:'hr',desc:'Shift scheduling, payroll automation, skills tracking',status:'active',agents:2,done:145,prog:3,rate:94.1,trust:91.2,tier:'read-only',subs:[{name:'Shift Scheduling',enabled:true,description:'Production line roster optimization'},{name:'Payroll Automation',enabled:true,description:'Automated payroll calculation and submission'},{name:'Skills Matrix',enabled:true,description:'Competency tracking and training gap analysis'},{name:'Leave Management',enabled:true,description:'Leave balance tracking and approval workflows'}]},
    {id:'cc-pm-sales',name:'Sales & Distribution Catalyst',domain:'sales',desc:'Order management, pricing, delivery scheduling for manufactured products',status:'active',agents:2,done:167,prog:4,rate:93.4,trust:89.8,tier:'assisted',subs:[{name:'Order Management',enabled:true,description:'Automated order intake and production scheduling link'},{name:'Dynamic Pricing',enabled:false,description:'Market-based pricing recommendation'},{name:'Delivery Scheduling',enabled:true,description:'Optimized dispatch based on production capacity'},{name:'Customer Credit',enabled:true,description:'Real-time credit limit monitoring'}]},
    {id:'cc-pm-quality',name:'Quality Control Catalyst',domain:'manufacturing-quality',desc:'Product quality monitoring, defect detection, batch traceability',status:'active',agents:3,done:234,prog:5,rate:96.3,trust:93.7,tier:'assisted',subs:[{name:'Defect Detection',enabled:true,description:'ML-based visual and statistical defect detection'},{name:'Batch Traceability',enabled:true,description:'Full raw material to finished product traceability'},{name:'Quality Metrics',enabled:true,description:'SPC charts, Cp/Cpk tracking and alerting'},{name:'Non-Conformance Management',enabled:true,description:'NCR workflow automation and root cause analysis'}]},
    {id:'cc-pm-prod',name:'Production Planning Catalyst',domain:'manufacturing-production',desc:'Production scheduling, OEE optimization, downtime prediction',status:'active',agents:3,done:189,prog:4,rate:92.8,trust:89.6,tier:'assisted',subs:[{name:'Production Scheduling',enabled:true,description:'Capacity-constrained scheduling across work centers'},{name:'OEE Optimization',enabled:true,description:'Real-time OEE tracking with improvement recommendations'},{name:'Downtime Prediction',enabled:true,description:'ML-based equipment failure prediction'},{name:'Material Requirements',enabled:true,description:'MRP calculation and component shortage alerts'}]},
  ];
  for (const c of pmClusters) {
    await db.prepare('INSERT OR REPLACE INTO catalyst_clusters (id,tenant_id,name,domain,description,status,agent_count,tasks_completed,tasks_in_progress,success_rate,trust_score,autonomy_tier,sub_catalysts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(c.id,'protea',c.name,c.domain,c.desc,c.status,c.agents,c.done,c.prog,c.rate,c.trust,c.tier,JSON.stringify(c.subs)).run();
  }

  // Graph Entities
  const pmEntities = [
    {id:'ge-pm-1',type:'organisation',name:'Protea Manufacturing',props:'{"employees":102,"revenue":"R280M","founded":2001}'},
    {id:'ge-pm-2',type:'department',name:'Production Floor',props:'{"headcount":45,"location":"Epping, Cape Town"}'},
    {id:'ge-pm-3',type:'system',name:'Sage 300',props:'{"version":"2024.1","modules":["IC","OE","PO","AP","AR","GL"]}'},
    {id:'ge-pm-4',type:'kpi',name:'Production Output',props:'{"target":15000,"actual":13200,"unit":"units/month"}'},
  ];
  for (const e of pmEntities) {
    await db.prepare('INSERT OR IGNORE INTO graph_entities (id,tenant_id,type,name,properties,confidence,source) VALUES (?,?,?,?,?,?,?)')
      .bind(e.id,'protea',e.type,e.name,e.props,0.93,'Sage 300').run();
  }

  // Customers
  const pmCustomers = [
    {id:'cust-pm-1',name:'Builders Warehouse',code:'BW-001',email:'procurement@builderswarehouse.co.za',phone:'+27215551001',currency:'ZAR',balance:3500000},
    {id:'cust-pm-2',name:'Massmart Holdings',code:'MASS-001',email:'buying@massmart.co.za',phone:'+27215551002',currency:'ZAR',balance:4200000},
    {id:'cust-pm-3',name:'Italtile',code:'ITAL-001',email:'orders@italtile.co.za',phone:'+27215551003',currency:'ZAR',balance:2800000},
    {id:'cust-pm-4',name:'PG Bison',code:'PGB-001',email:'purchasing@pgbison.co.za',phone:'+27215551004',currency:'ZAR',balance:1900000},
    {id:'cust-pm-5',name:'Cashbuild',code:'CASH-001',email:'orders@cashbuild.co.za',phone:'+27215551005',currency:'ZAR',balance:2100000},
  ];
  for (const c of pmCustomers) {
    await db.prepare('INSERT OR IGNORE INTO erp_customers (id,tenant_id,external_id,source_system,name,contact_email,contact_phone,currency,credit_balance) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(c.id,'protea',c.code,'Sage 300',c.name,c.email,c.phone,c.currency,c.balance).run();
  }

  // Suppliers
  const pmSuppliers = [
    {id:'sup-pm-1',name:'SAPPI Southern Africa',code:'SAPPI-001',email:'sales@sappi.co.za',currency:'ZAR',rating:4.5},
    {id:'sup-pm-2',name:'Hulamin Aluminium',code:'HULA-001',email:'sales@hulamin.co.za',currency:'ZAR',rating:4.2},
    {id:'sup-pm-3',name:'PPC Cement',code:'PPC-001',email:'industrial@ppc.co.za',currency:'ZAR',rating:4.0},
    {id:'sup-pm-4',name:'Foskor Chemicals',code:'FOSK-001',email:'trade@foskor.co.za',currency:'ZAR',rating:3.8},
  ];
  for (const s of pmSuppliers) {
    await db.prepare('INSERT OR IGNORE INTO erp_suppliers (id,tenant_id,external_id,source_system,name,contact_email,currency,risk_score) VALUES (?,?,?,?,?,?,?,?)')
      .bind(s.id,'protea',s.code,'Sage 300',s.name,s.email,s.currency,s.rating).run();
  }

  // Products
  const pmProducts = [
    {id:'prod-pm-1',name:'Aluminium Window Frame 1500mm',sku:'AWF-1500',category:'Window Frames',price:2850,stock:1200,unit:'unit'},
    {id:'prod-pm-2',name:'Steel Security Gate Standard',sku:'SSG-STD',category:'Security Products',price:4200,stock:800,unit:'unit'},
    {id:'prod-pm-3',name:'Composite Roof Tile Classic',sku:'CRT-CLS',category:'Roofing',price:185,stock:25000,unit:'unit'},
    {id:'prod-pm-4',name:'PVC Gutter 4m Length',sku:'PVC-G4M',category:'Rainwater',price:320,stock:5000,unit:'length'},
    {id:'prod-pm-5',name:'Pressed Steel Door Frame',sku:'PSDF-01',category:'Door Frames',price:1650,stock:2000,unit:'unit'},
    {id:'prod-pm-6',name:'Aluminium Sliding Door 2.4m',sku:'ASD-240',category:'Doors',price:8500,stock:400,unit:'unit'},
    {id:'prod-pm-7',name:'Burglar Bar Set 900mm',sku:'BBS-900',category:'Security Products',price:980,stock:3000,unit:'set'},
    {id:'prod-pm-8',name:'Galvanised Steel Palisade Panel',sku:'GSP-180',category:'Fencing',price:1450,stock:1500,unit:'panel'},
  ];
  for (const p of pmProducts) {
    await db.prepare('INSERT OR IGNORE INTO erp_products (id,tenant_id,source_system,sku,name,category,unit_price,stock_on_hand,unit_of_measure) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(p.id,'protea','Sage 300',p.sku,p.name,p.category,p.price,p.stock,p.unit).run();
  }

  // GL Accounts
  const pmGL = [
    {id:'gl-pm-1',code:'1000',name:'Bank - FNB Current',type:'asset',balance:4200000},
    {id:'gl-pm-2',code:'1100',name:'Trade Debtors',type:'asset',balance:8500000},
    {id:'gl-pm-3',code:'1200',name:'Raw Material Inventory',type:'asset',balance:12000000},
    {id:'gl-pm-4',code:'2000',name:'Trade Creditors',type:'liability',balance:-6800000},
    {id:'gl-pm-5',code:'4000',name:'Sales Revenue',type:'revenue',balance:-280000000},
    {id:'gl-pm-6',code:'5000',name:'Cost of Sales',type:'expense',balance:185000000},
    {id:'gl-pm-7',code:'6000',name:'Operating Expenses',type:'expense',balance:62000000},
  ];
  for (const g of pmGL) {
    await db.prepare('INSERT OR IGNORE INTO erp_journal_entries (id,tenant_id,source_system,journal_number,journal_date,description,total_debit,total_credit,status) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(g.id,'protea','Sage 300',g.code,`2026-01-31`,`GL Balance: ${g.name}`,Math.abs(g.balance),Math.abs(g.balance),'posted').run();
  }

  // Employees (100 staff — manufacturing workforce)
  const pmEmps: {id:string;empNum:string;first:string;last:string;dept:string;pos:string;salary:number}[] = [
    {id:'emp-pm-1',empNum:'PM-001',first:'Pieter',last:'Venter',dept:'Executive',pos:'Managing Director',salary:125000},
    {id:'emp-pm-2',empNum:'PM-002',first:'Anita',last:'de Villiers',dept:'Finance',pos:'Financial Manager',salary:95000},
    {id:'emp-pm-3',empNum:'PM-003',first:'Sello',last:'Mahlangu',dept:'Production',pos:'Operations Manager',salary:88000},
    {id:'emp-pm-4',empNum:'PM-004',first:'Themba',last:'Nkosi',dept:'Quality',pos:'QC Manager',salary:78000},
    {id:'emp-pm-5',empNum:'PM-005',first:'Riaan',last:'Botha',dept:'Sales',pos:'Sales Director',salary:110000},
    {id:'emp-pm-6',empNum:'PM-006',first:'Zanele',last:'Mthembu',dept:'HR',pos:'HR Manager',salary:72000},
    {id:'emp-pm-7',empNum:'PM-010',first:'Johan',last:'Erasmus',dept:'Production',pos:'Production Supervisor - Line A',salary:55000},
    {id:'emp-pm-8',empNum:'PM-011',first:'Bongani',last:'Dlamini',dept:'Production',pos:'Production Supervisor - Line B',salary:55000},
    {id:'emp-pm-9',empNum:'PM-012',first:'Mandla',last:'Zwane',dept:'Production',pos:'Machine Operator',salary:28000},
    {id:'emp-pm-10',empNum:'PM-013',first:'Sipho',last:'Ndlovu',dept:'Production',pos:'Machine Operator',salary:28000},
    {id:'emp-pm-11',empNum:'PM-014',first:'Thabo',last:'Mokoena',dept:'Production',pos:'Machine Operator',salary:28000},
    {id:'emp-pm-12',empNum:'PM-015',first:'Lucky',last:'Chabalala',dept:'Production',pos:'Machine Operator',salary:28000},
    {id:'emp-pm-13',empNum:'PM-016',first:'Joseph',last:'Sithole',dept:'Production',pos:'Welder',salary:32000},
    {id:'emp-pm-14',empNum:'PM-017',first:'David',last:'Khumalo',dept:'Production',pos:'Welder',salary:32000},
    {id:'emp-pm-15',empNum:'PM-018',first:'Patrick',last:'Tau',dept:'Production',pos:'CNC Operator',salary:35000},
    {id:'emp-pm-16',empNum:'PM-019',first:'Simon',last:'Phiri',dept:'Production',pos:'CNC Operator',salary:35000},
    {id:'emp-pm-17',empNum:'PM-020',first:'Moses',last:'Mahlangu',dept:'Production',pos:'Assembler',salary:25000},
    {id:'emp-pm-18',empNum:'PM-021',first:'Isaac',last:'Dube',dept:'Production',pos:'Assembler',salary:25000},
    {id:'emp-pm-19',empNum:'PM-022',first:'Daniel',last:'Mkhize',dept:'Production',pos:'Assembler',salary:25000},
    {id:'emp-pm-20',empNum:'PM-023',first:'Samuel',last:'Mbatha',dept:'Production',pos:'Assembler',salary:25000},
    {id:'emp-pm-21',empNum:'PM-024',first:'Peter',last:'Motaung',dept:'Production',pos:'Spray Painter',salary:30000},
    {id:'emp-pm-22',empNum:'PM-025',first:'James',last:'Ngcobo',dept:'Production',pos:'Spray Painter',salary:30000},
    {id:'emp-pm-23',empNum:'PM-026',first:'William',last:'Cele',dept:'Production',pos:'Quality Inspector',salary:32000},
    {id:'emp-pm-24',empNum:'PM-027',first:'Thomas',last:'Mabaso',dept:'Production',pos:'Quality Inspector',salary:32000},
    {id:'emp-pm-25',empNum:'PM-028',first:'Robert',last:'Nene',dept:'Production',pos:'Forklift Operator',salary:26000},
    {id:'emp-pm-26',empNum:'PM-029',first:'Michael',last:'Zulu',dept:'Production',pos:'Forklift Operator',salary:26000},
    {id:'emp-pm-27',empNum:'PM-030',first:'Paul',last:'Radebe',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-28',empNum:'PM-031',first:'George',last:'Sibiya',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-29',empNum:'PM-032',first:'Andrew',last:'Majola',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-30',empNum:'PM-033',first:'Steven',last:'Vilakazi',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-31',empNum:'PM-034',first:'Philip',last:'Ngwenya',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-32',empNum:'PM-035',first:'Emmanuel',last:'Tshabalala',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-33',empNum:'PM-036',first:'Vincent',last:'Shabangu',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-34',empNum:'PM-037',first:'Chris',last:'Maluleke',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-35',empNum:'PM-038',first:'Albert',last:'Mahlobo',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-36',empNum:'PM-039',first:'Richard',last:'Moloi',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-37',empNum:'PM-040',first:'Kenneth',last:'Langa',dept:'Warehouse',pos:'Warehouse Supervisor',salary:42000},
    {id:'emp-pm-38',empNum:'PM-041',first:'Norman',last:'Buthelezi',dept:'Warehouse',pos:'Storeman',salary:26000},
    {id:'emp-pm-39',empNum:'PM-042',first:'Leonard',last:'Gumede',dept:'Warehouse',pos:'Storeman',salary:26000},
    {id:'emp-pm-40',empNum:'PM-043',first:'Gerald',last:'Masango',dept:'Warehouse',pos:'Picker/Packer',salary:22000},
    {id:'emp-pm-41',empNum:'PM-044',first:'Dennis',last:'Mpanza',dept:'Warehouse',pos:'Picker/Packer',salary:22000},
    {id:'emp-pm-42',empNum:'PM-045',first:'Brian',last:'Khoza',dept:'Warehouse',pos:'Picker/Packer',salary:22000},
    {id:'emp-pm-43',empNum:'PM-046',first:'Raymond',last:'Nkabinde',dept:'Warehouse',pos:'Driver',salary:28000},
    {id:'emp-pm-44',empNum:'PM-047',first:'Arthur',last:'Mofokeng',dept:'Warehouse',pos:'Driver',salary:28000},
    {id:'emp-pm-45',empNum:'PM-050',first:'Hendrik',last:'Pretorius',dept:'Maintenance',pos:'Maintenance Manager',salary:65000},
    {id:'emp-pm-46',empNum:'PM-051',first:'Jan',last:'du Plessis',dept:'Maintenance',pos:'Electrician',salary:42000},
    {id:'emp-pm-47',empNum:'PM-052',first:'Frikkie',last:'Fourie',dept:'Maintenance',pos:'Fitter & Turner',salary:42000},
    {id:'emp-pm-48',empNum:'PM-053',first:'Danie',last:'van Wyk',dept:'Maintenance',pos:'Maintenance Assistant',salary:25000},
    {id:'emp-pm-49',empNum:'PM-060',first:'Riana',last:'Kruger',dept:'Finance',pos:'Bookkeeper',salary:42000},
    {id:'emp-pm-50',empNum:'PM-061',first:'Elna',last:'Jacobs',dept:'Finance',pos:'Debtors Clerk',salary:32000},
    {id:'emp-pm-51',empNum:'PM-062',first:'Marie',last:'Steyn',dept:'Finance',pos:'Creditors Clerk',salary:32000},
    {id:'emp-pm-52',empNum:'PM-063',first:'Susan',last:'Marais',dept:'Finance',pos:'Payroll Officer',salary:38000},
    {id:'emp-pm-53',empNum:'PM-070',first:'Louis',last:'Coetzee',dept:'Sales',pos:'Sales Manager',salary:75000},
    {id:'emp-pm-54',empNum:'PM-071',first:'Charl',last:'Bester',dept:'Sales',pos:'Account Executive',salary:55000},
    {id:'emp-pm-55',empNum:'PM-072',first:'Pierre',last:'Roux',dept:'Sales',pos:'Account Executive',salary:55000},
    {id:'emp-pm-56',empNum:'PM-073',first:'Kobus',last:'Swanepoel',dept:'Sales',pos:'Sales Admin',salary:32000},
    {id:'emp-pm-57',empNum:'PM-074',first:'Tanya',last:'Nel',dept:'Sales',pos:'Customer Service',salary:28000},
    {id:'emp-pm-58',empNum:'PM-075',first:'Charmaine',last:'Potgieter',dept:'Sales',pos:'Customer Service',salary:28000},
    {id:'emp-pm-59',empNum:'PM-080',first:'Mpho',last:'Masemola',dept:'Quality',pos:'QC Technician',salary:38000},
    {id:'emp-pm-60',empNum:'PM-081',first:'Lesego',last:'Matlala',dept:'Quality',pos:'QC Technician',salary:38000},
    {id:'emp-pm-61',empNum:'PM-082',first:'Calvin',last:'Mtshali',dept:'Quality',pos:'Lab Assistant',salary:28000},
    {id:'emp-pm-62',empNum:'PM-090',first:'Lydia',last:'Motha',dept:'HR',pos:'HR Officer',salary:38000},
    {id:'emp-pm-63',empNum:'PM-091',first:'Grace',last:'Sethole',dept:'Admin',pos:'Receptionist',salary:22000},
    {id:'emp-pm-64',empNum:'PM-092',first:'Prudence',last:'Mkhwanazi',dept:'Admin',pos:'Office Admin',salary:25000},
    {id:'emp-pm-65',empNum:'PM-093',first:'Nomvula',last:'Thwala',dept:'Admin',pos:'Cleaner',salary:18000},
    {id:'emp-pm-66',empNum:'PM-094',first:'Florence',last:'Nzimande',dept:'Admin',pos:'Cleaner',salary:18000},
    {id:'emp-pm-67',empNum:'PM-095',first:'Thandi',last:'Mazibuko',dept:'Admin',pos:'Security Guard',salary:20000},
    {id:'emp-pm-68',empNum:'PM-096',first:'Sbusiso',last:'Hlongwane',dept:'Admin',pos:'Security Guard',salary:20000},
    // Additional production workers to reach ~100
    {id:'emp-pm-69',empNum:'PM-100',first:'Musa',last:'Mguni',dept:'Production',pos:'Apprentice Welder',salary:18000},
    {id:'emp-pm-70',empNum:'PM-101',first:'Themba',last:'Ngubane',dept:'Production',pos:'Apprentice Welder',salary:18000},
    {id:'emp-pm-71',empNum:'PM-102',first:'Nhlanhla',last:'Mthethwa',dept:'Production',pos:'Machine Operator',salary:28000},
    {id:'emp-pm-72',empNum:'PM-103',first:'Sibusiso',last:'Shezi',dept:'Production',pos:'Machine Operator',salary:28000},
    {id:'emp-pm-73',empNum:'PM-104',first:'Vusi',last:'Mkhwanazi',dept:'Production',pos:'CNC Operator',salary:35000},
    {id:'emp-pm-74',empNum:'PM-105',first:'Alfred',last:'Mchunu',dept:'Production',pos:'Assembly Lead',salary:38000},
    {id:'emp-pm-75',empNum:'PM-106',first:'Frank',last:'Kunene',dept:'Production',pos:'Assembler',salary:25000},
    {id:'emp-pm-76',empNum:'PM-107',first:'Henry',last:'Zondi',dept:'Production',pos:'Assembler',salary:25000},
    {id:'emp-pm-77',empNum:'PM-108',first:'Martin',last:'Simelane',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-78',empNum:'PM-109',first:'Ernest',last:'Xaba',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-79',empNum:'PM-110',first:'Eddie',last:'Mthiyane',dept:'Warehouse',pos:'Picker/Packer',salary:22000},
    {id:'emp-pm-80',empNum:'PM-111',first:'Victor',last:'Mvelase',dept:'Warehouse',pos:'Driver',salary:28000},
    {id:'emp-pm-81',empNum:'PM-112',first:'Edgar',last:'Phungula',dept:'Maintenance',pos:'Maintenance Assistant',salary:25000},
    {id:'emp-pm-82',empNum:'PM-113',first:'Winston',last:'Shabane',dept:'Production',pos:'Spray Painter',salary:30000},
    {id:'emp-pm-83',empNum:'PM-114',first:'Solomon',last:'Miya',dept:'Production',pos:'Quality Inspector',salary:32000},
    {id:'emp-pm-84',empNum:'PM-115',first:'Aaron',last:'Madonsela',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-85',empNum:'PM-116',first:'Jacob',last:'Myeni',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-86',empNum:'PM-117',first:'Elias',last:'Fakude',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-87',empNum:'PM-118',first:'Walter',last:'Mabuza',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-88',empNum:'PM-119',first:'Petrus',last:'Kubheka',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-89',empNum:'PM-120',first:'Abraham',last:'Maphanga',dept:'Sales',pos:'Telesales',salary:25000},
    {id:'emp-pm-90',empNum:'PM-121',first:'Jeremiah',last:'Ntshalintshali',dept:'IT',pos:'IT Technician',salary:38000},
    {id:'emp-pm-91',empNum:'PM-122',first:'Lucas',last:'Hlatshwayo',dept:'Production',pos:'Shift Supervisor - Night',salary:48000},
    {id:'emp-pm-92',empNum:'PM-123',first:'Charles',last:'Mthombeni',dept:'Production',pos:'Machine Operator',salary:28000},
    {id:'emp-pm-93',empNum:'PM-124',first:'Enoch',last:'Mabena',dept:'Production',pos:'Machine Operator',salary:28000},
    {id:'emp-pm-94',empNum:'PM-125',first:'Cornelius',last:'Malinga',dept:'Production',pos:'Assembler',salary:25000},
    {id:'emp-pm-95',empNum:'PM-126',first:'Alexander',last:'Zwane',dept:'Production',pos:'General Worker',salary:22000},
    {id:'emp-pm-96',empNum:'PM-127',first:'Timothy',last:'Ndaba',dept:'Warehouse',pos:'Storeman',salary:26000},
    {id:'emp-pm-97',empNum:'PM-128',first:'Benedict',last:'Naidoo',dept:'Finance',pos:'Cost Accountant',salary:55000},
    {id:'emp-pm-98',empNum:'PM-129',first:'Lawrence',last:'Govender',dept:'Production',pos:'Production Planner',salary:52000},
    {id:'emp-pm-99',empNum:'PM-130',first:'Gregory',last:'Pillay',dept:'Procurement',pos:'Buyer',salary:48000},
    {id:'emp-pm-100',empNum:'PM-131',first:'Cedric',last:'van der Walt',dept:'Procurement',pos:'Buyer',salary:48000},
  ];
  for (const e of pmEmps) {
    await db.prepare("INSERT OR IGNORE INTO erp_employees (id,tenant_id,source_system,employee_number,first_name,last_name,department,position,gross_salary,salary_frequency,status,hire_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(e.id,'protea','Sage 300',e.empNum,e.first,e.last,e.dept,e.pos,e.salary,'monthly','active','2023-06-01').run();
  }

  // ── Protea Invoices (building products — 12 months, ~45/month) ──
  const pmInvCustomers = [{id:'cust-pm-1',name:'Builders Warehouse'},{id:'cust-pm-2',name:'Massmart Holdings'},{id:'cust-pm-3',name:'Italtile'},{id:'cust-pm-4',name:'PG Bison'},{id:'cust-pm-5',name:'Cashbuild'}];
  let pmInvIdx = 1;
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let j = 0; j < 45; j++) {
      const cust = pmInvCustomers[j % 5];
      const amount = 35000 + Math.round(Math.sin(pmInvIdx * 0.3) * 15000 + pmInvIdx * 100);
      const isPaid = mo < 9;
      const isOverdue = !isPaid && mo < 11;
      await db.prepare("INSERT OR IGNORE INTO erp_invoices (id,tenant_id,source_system,invoice_number,customer_id,customer_name,invoice_date,due_date,total,amount_paid,amount_due,status,payment_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(`inv-pm-${pmInvIdx}`,'protea','Sage 300',`INV-PM-${String(pmInvIdx).padStart(5,'0')}`,cust.id,cust.name,`${year}-${month}-01`,`${year}-${month}-30`,amount,isPaid?amount:0,isPaid?0:amount,'approved',isPaid?'paid':(isOverdue?'overdue':'unpaid')).run();
      pmInvIdx++;
    }
  }

  // ── Protea Purchase Orders (raw materials — 12 months, ~30/month) ──
  const pmPOSuppliers = [{id:'sup-pm-1',name:'SAPPI Southern Africa'},{id:'sup-pm-2',name:'Hulamin Aluminium'},{id:'sup-pm-3',name:'PPC Cement'},{id:'sup-pm-4',name:'Foskor Chemicals'}];
  let pmPOIdx = 1;
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let j = 0; j < 30; j++) {
      const sup = pmPOSuppliers[j % 4];
      const amount = 45000 + Math.round(Math.sin(pmPOIdx) * 20000);
      await db.prepare("INSERT OR IGNORE INTO erp_purchase_orders (id,tenant_id,source_system,po_number,supplier_id,supplier_name,order_date,delivery_date,total,status) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(`po-pm-${pmPOIdx}`,'protea','Sage 300',`PO-PM-${String(pmPOIdx).padStart(5,'0')}`,sup.id,sup.name,`${year}-${month}-03`,`${year}-${month}-12`,amount,mo<10?'received':'open').run();
      pmPOIdx++;
    }
  }

  // ── Protea Journal Entries (20/month × 12) ──
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let j = 1; j <= 20; j++) {
      const jid = `je-pm-${mo * 20 + j}`;
      const amt = 85000 + mo * 5000 + j * 3000;
      await db.prepare("INSERT OR IGNORE INTO erp_journal_entries (id,tenant_id,source_system,journal_number,journal_date,description,total_debit,total_credit,status) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(jid,'protea','Sage 300',`JE-PM-${String(mo*20+j).padStart(4,'0')}`,`${year}-${month}-28`,`Month-end closing entry ${j}`,amt,amt,'posted').run();
    }
  }

  // ── Protea Bank Transactions (35/month × 12) ──
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let d = 1; d <= 28; d++) {
      const day = String(d).padStart(2, '0');
      const btId = `bt-pm-${mo * 28 + d}`;
      if (d % 3 === 0) {
        await db.prepare("INSERT OR IGNORE INTO erp_bank_transactions (id,tenant_id,source_system,bank_account,transaction_date,description,reference,credit,debit,balance) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(btId,'protea','Sage 300','FNB-001',`${year}-${month}-${day}`,`Customer payment received`,`REC-PM-${mo}-${d}`,85000+d*2000,0,4200000).run();
      } else {
        await db.prepare("INSERT OR IGNORE INTO erp_bank_transactions (id,tenant_id,source_system,bank_account,transaction_date,description,reference,debit,credit,balance) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(btId,'protea','Sage 300','FNB-001',`${year}-${month}-${day}`,d%2===0?'Raw material supplier payment':'Production wages',`PAY-PM-${mo}-${d}`,d%2===0?65000:180000,0,4200000).run();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPANY 7: KAPSTADT GLOBAL HOLDINGS — SAP S/4HANA — LARGE MULTINATIONAL (~500+ employees, multi-currency)
  // ═══════════════════════════════════════════════════════════════════════════
  await db.prepare('INSERT OR IGNORE INTO tenants (id,name,slug,industry,plan,status,deployment_model,region) VALUES (?,?,?,?,?,?,?,?)')
    .bind('kapstadt','Kapstadt Global Holdings Ltd','kapstadt','conglomerate','enterprise','active','hybrid','af-south-1').run();

  await db.prepare('INSERT OR REPLACE INTO tenant_entitlements (tenant_id,layers,catalyst_clusters,max_agents,max_users,autonomy_tiers,llm_tiers,features,sso_enabled,api_access,custom_branding,data_retention_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('kapstadt','["apex","pulse","catalysts","mind","memory"]','["finance","procurement","supply-chain","hr","sales","treasury","compliance","logistics","intercompany"]',80,500,'["read-only","assisted","transactional","autonomous"]','["tier-1","tier-2","tier-3","tier-4"]','["scenario-modelling","process-mining","graphrag","executive-briefings","risk-alerts","multi-currency","intercompany-recon","transfer-pricing"]',1,1,1,1095).run();

  const kgUsers = [
    { id:'kg-admin', email:'admin@kapstadt-global.com', name:'Heinrich Müller', role:'admin' },
    { id:'kg-ceo',   email:'ceo@kapstadt-global.com',   name:'Francois du Toit', role:'executive' },
    { id:'kg-cfo',   email:'cfo@kapstadt-global.com',   name:'Priya Naidoo', role:'executive' },
    { id:'kg-coo',   email:'coo@kapstadt-global.com',   name:'James Mokoena', role:'executive' },
    { id:'kg-fin',   email:'finance@kapstadt-global.com', name:'Christiaan van der Berg', role:'manager' },
    { id:'kg-treasury', email:'treasury@kapstadt-global.com', name:'Nomsa Dladla', role:'manager' },
    { id:'kg-analyst', email:'analyst@kapstadt-global.com', name:'Sipho Mahlangu', role:'analyst' },
    { id:'kg-viewer', email:'viewer@kapstadt-global.com', name:'Lerato Moseneke', role:'viewer' },
  ];
  for (const u of kgUsers) {
    await db.prepare('INSERT OR IGNORE INTO users (id,tenant_id,email,name,role,password_hash,permissions,status) VALUES (?,?,?,?,?,?,?,?)')
      .bind(u.id,'kapstadt',u.email,u.name,u.role,pwHash,'["*"]','active').run();
  }

  // ERP Connection
  await db.prepare(
    "INSERT OR IGNORE INTO erp_connections (id,tenant_id,adapter_id,name,status,config,sync_frequency,records_synced,connected_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))"
  ).bind('conn-kg-sap','kapstadt','erp-sap-s4','Kapstadt SAP S/4HANA Central','connected',
    '{"host":"s4hana.kapstadt-global.com","client":"200","system_id":"KGH","base_url":"https://s4hana.kapstadt-global.com","company_codes":["ZA01","NG01","KE01","UK01","DE01"]}',
    'realtime',12450000).run();

  // Catalyst Clusters
  const kgClusters = [
    {id:'cc-kg-fin',name:'Group Finance Catalyst',domain:'finance',desc:'Consolidated financial reporting, intercompany elimination, multi-currency AR/AP across 5 entities',status:'active',agents:8,done:2340,prog:24,rate:96.8,trust:94.5,tier:'transactional',subs:[{name:'Accounts Receivable',enabled:true,description:'Multi-entity AR aging and collection workflows'},{name:'Accounts Payable',enabled:true,description:'Cross-entity invoice matching and payment scheduling'},{name:'Invoice Reconciliation',enabled:true,description:'Intercompany 3-way match with FX handling'},{name:'Financial Consolidation',enabled:true,description:'Automated multi-entity consolidation with IFRS/GAAP compliance'},{name:'Intercompany Elimination',enabled:true,description:'Automated IC transaction matching and elimination entries'},{name:'Multi-Currency Revaluation',enabled:true,description:'Month-end FX revaluation across all currencies'}]},
    {id:'cc-kg-treasury',name:'Treasury & Cash Management Catalyst',domain:'treasury',desc:'Global cash pooling, FX risk management, investment optimization',status:'active',agents:4,done:876,prog:12,rate:95.4,trust:93.2,tier:'assisted',subs:[{name:'Cash Pooling',enabled:true,description:'Notional and physical cash pooling across entities'},{name:'FX Hedging',enabled:true,description:'Forward contract recommendation and hedge accounting'},{name:'Cash Flow Forecasting',enabled:true,description:'AI-driven 13-week rolling cash forecast per entity'},{name:'Bank Reconciliation',enabled:true,description:'Multi-bank automated reconciliation across 12 banks'},{name:'Investment Management',enabled:false,description:'Short-term investment optimization for surplus cash'}]},
    {id:'cc-kg-proc',name:'Strategic Procurement Catalyst',domain:'procurement',desc:'Group-level supplier consolidation, category management, and compliance across regions',status:'active',agents:5,done:1560,prog:18,rate:94.2,trust:91.8,tier:'assisted',subs:[{name:'Supplier Consolidation',enabled:true,description:'Group-wide supplier rationalization and volume aggregation'},{name:'Category Management',enabled:true,description:'Strategic sourcing by category across entities'},{name:'Contract Management',enabled:true,description:'Enterprise contract lifecycle management'},{name:'Spend Analytics',enabled:true,description:'Cross-entity spend visibility and savings tracking'},{name:'Compliance Monitoring',enabled:true,description:'BBBEE, local content, and regulatory compliance tracking'}]},
    {id:'cc-kg-supply',name:'Global Supply Chain Catalyst',domain:'supply-chain',desc:'Multi-site inventory, cross-border logistics, demand planning across African and European operations',status:'active',agents:6,done:1890,prog:20,rate:93.5,trust:90.7,tier:'assisted',subs:[{name:'Multi-Site Inventory',enabled:true,description:'Real-time inventory visibility across 8 warehouses and 3 continents'},{name:'Cross-Border Logistics',enabled:true,description:'International shipping, customs, and duty optimization'},{name:'Demand Planning',enabled:true,description:'Regional demand forecasting with seasonal adjustments'},{name:'Distribution Network',enabled:true,description:'Optimal distribution center allocation and routing'},{name:'Supplier Lead Time',enabled:true,description:'Cross-border supplier performance and risk monitoring'}]},
    {id:'cc-kg-hr',name:'Group HR & Workforce Catalyst',domain:'hr',desc:'Multi-jurisdiction payroll, expatriate management, talent pipeline across 5 countries',status:'active',agents:4,done:1234,prog:14,rate:95.1,trust:92.3,tier:'read-only',subs:[{name:'Multi-Country Payroll',enabled:true,description:'Automated payroll processing in ZAR, NGN, KES, GBP, EUR'},{name:'Expatriate Management',enabled:true,description:'Cross-border assignment tracking, tax equalization'},{name:'Talent Pipeline',enabled:true,description:'Group-wide succession planning and talent mobility'},{name:'Compliance & Labour Law',enabled:true,description:'Multi-jurisdiction labour law compliance monitoring'},{name:'Workforce Analytics',enabled:true,description:'Headcount, cost, and productivity analytics across regions'}]},
    {id:'cc-kg-compliance',name:'Regulatory Compliance Catalyst',domain:'compliance',desc:'Multi-jurisdiction regulatory reporting, transfer pricing, BBBEE, IFRS, and tax compliance',status:'active',agents:3,done:678,prog:8,rate:97.2,trust:95.8,tier:'read-only',subs:[{name:'Transfer Pricing',enabled:true,description:'Arms-length testing and TP documentation automation'},{name:'BBBEE Compliance',enabled:true,description:'Annual scorecard calculation and certificate tracking'},{name:'Tax Compliance',enabled:true,description:'Multi-jurisdiction corporate tax computation and filing'},{name:'Regulatory Reporting',enabled:true,description:'Country-specific regulatory report generation (SARB, CBN, CBK)'},{name:'IFRS/GAAP Compliance',enabled:true,description:'Automated accounting standard compliance checking'}]},
    {id:'cc-kg-sales',name:'Revenue Intelligence Catalyst',domain:'sales',desc:'Enterprise sales forecasting, customer lifetime value, pricing optimization across markets',status:'active',agents:4,done:1456,prog:16,rate:94.6,trust:91.9,tier:'assisted',subs:[{name:'Sales Forecasting',enabled:true,description:'AI-driven revenue prediction by region and product line'},{name:'Customer Lifetime Value',enabled:true,description:'CLV scoring and segment-based growth strategies'},{name:'Pricing Optimization',enabled:true,description:'Market-specific pricing recommendation engine'},{name:'Deal Intelligence',enabled:true,description:'Win/loss analysis and competitive positioning'},{name:'Territory Management',enabled:true,description:'Optimal territory design and quota setting'}]},
    {id:'cc-kg-logistics',name:'Logistics & Freight Catalyst',domain:'logistics',desc:'Multi-modal transport optimization, customs management, and fleet tracking',status:'active',agents:4,done:987,prog:10,rate:93.8,trust:90.5,tier:'assisted',subs:[{name:'Route Optimization',enabled:true,description:'Multi-modal transport route and cost optimization'},{name:'Customs Management',enabled:true,description:'Automated HS code classification and duty calculation'},{name:'Fleet Tracking',enabled:true,description:'Real-time vehicle and container tracking across Africa'},{name:'Freight Cost Management',enabled:true,description:'Freight audit and cost allocation by entity'}]},
    {id:'cc-kg-ic',name:'Intercompany Catalyst',domain:'intercompany',desc:'Automated intercompany invoicing, netting, and reconciliation across all group entities',status:'active',agents:3,done:2100,prog:22,rate:97.5,trust:96.1,tier:'transactional',subs:[{name:'IC Invoice Automation',enabled:true,description:'Automated intercompany invoice creation and matching'},{name:'IC Netting',enabled:true,description:'Multi-lateral netting to minimize cross-border payments'},{name:'IC Reconciliation',enabled:true,description:'Real-time intercompany balance reconciliation with FX'},{name:'IC Pricing',enabled:true,description:'Transfer pricing policy enforcement on IC transactions'}]},
  ];
  for (const c of kgClusters) {
    await db.prepare('INSERT OR REPLACE INTO catalyst_clusters (id,tenant_id,name,domain,description,status,agent_count,tasks_completed,tasks_in_progress,success_rate,trust_score,autonomy_tier,sub_catalysts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(c.id,'kapstadt',c.name,c.domain,c.desc,c.status,c.agents,c.done,c.prog,c.rate,c.trust,c.tier,JSON.stringify(c.subs)).run();
  }

  // Graph Entities
  const kgEntities = [
    {id:'ge-kg-1',type:'organisation',name:'Kapstadt Global Holdings',props:'{"employees":520,"revenue":"R4.8B","founded":1992,"hq":"Cape Town","subsidiaries":5}'},
    {id:'ge-kg-2',type:'subsidiary',name:'Kapstadt SA (Pty) Ltd',props:'{"employees":180,"revenue":"R2.1B","country":"South Africa","company_code":"ZA01"}'},
    {id:'ge-kg-3',type:'subsidiary',name:'Kapstadt Nigeria Ltd',props:'{"employees":120,"revenue":"₦18B","country":"Nigeria","company_code":"NG01"}'},
    {id:'ge-kg-4',type:'subsidiary',name:'Kapstadt East Africa Ltd',props:'{"employees":85,"revenue":"KES 3.2B","country":"Kenya","company_code":"KE01"}'},
    {id:'ge-kg-5',type:'subsidiary',name:'Kapstadt UK Ltd',props:'{"employees":75,"revenue":"£28M","country":"United Kingdom","company_code":"UK01"}'},
    {id:'ge-kg-6',type:'subsidiary',name:'Kapstadt GmbH',props:'{"employees":60,"revenue":"€24M","country":"Germany","company_code":"DE01"}'},
    {id:'ge-kg-7',type:'system',name:'SAP S/4HANA Central',props:'{"version":"2025","modules":["FI","CO","MM","SD","PP","HR","TRM","IC"],"company_codes":5}'},
    {id:'ge-kg-8',type:'kpi',name:'Group Revenue',props:'{"target":5200000000,"actual":4800000000,"unit":"ZAR/year","currencies":["ZAR","NGN","KES","GBP","EUR"]}'},
  ];
  for (const e of kgEntities) {
    await db.prepare('INSERT OR IGNORE INTO graph_entities (id,tenant_id,type,name,properties,confidence,source) VALUES (?,?,?,?,?,?,?)')
      .bind(e.id,'kapstadt',e.type,e.name,e.props,0.96,'SAP S/4HANA').run();
  }

  // Customers (enterprise-level, multi-country)
  const kgCustomers = [
    {id:'cust-kg-1',name:'Shoprite Holdings',code:'SHP-001',email:'procurement@shoprite.co.za',phone:'+27215551001',currency:'ZAR',balance:45000000},
    {id:'cust-kg-2',name:'Dangote Group',code:'DAN-001',email:'purchasing@dangote.com.ng',phone:'+23412345678',currency:'NGN',balance:2800000000},
    {id:'cust-kg-3',name:'Safaricom PLC',code:'SAF-001',email:'procurement@safaricom.co.ke',phone:'+254201234567',currency:'KES',balance:850000000},
    {id:'cust-kg-4',name:'Tesco PLC',code:'TES-001',email:'buying@tesco.co.uk',phone:'+442071234567',currency:'GBP',balance:12000000},
    {id:'cust-kg-5',name:'REWE Group',code:'REWE-001',email:'einkauf@rewe-group.de',phone:'+492211234567',currency:'EUR',balance:8500000},
    {id:'cust-kg-6',name:'Pick n Pay',code:'PNP-001',email:'procurement@pnp.co.za',phone:'+27215552001',currency:'ZAR',balance:38000000},
    {id:'cust-kg-7',name:'Woolworths Holdings',code:'WHL-001',email:'sourcing@woolworths.co.za',phone:'+27215553001',currency:'ZAR',balance:32000000},
    {id:'cust-kg-8',name:'MTN Group',code:'MTN-001',email:'procurement@mtn.com',phone:'+27115554001',currency:'ZAR',balance:18000000},
  ];
  for (const c of kgCustomers) {
    await db.prepare('INSERT OR IGNORE INTO erp_customers (id,tenant_id,external_id,source_system,name,contact_email,contact_phone,currency,credit_balance) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(c.id,'kapstadt',c.code,'SAP S/4HANA',c.name,c.email,c.phone,c.currency,c.balance).run();
  }

  // Suppliers (global supply chain)
  const kgSuppliers = [
    {id:'sup-kg-1',name:'Mondi Group',code:'MONDI-001',email:'sales@mondi.com',currency:'ZAR',rating:4.6},
    {id:'sup-kg-2',name:'BASF SE',code:'BASF-001',email:'vertrieb@basf.de',currency:'EUR',rating:4.8},
    {id:'sup-kg-3',name:'Olam International',code:'OLAM-001',email:'trade@olamgroup.com',currency:'USD',rating:4.3},
    {id:'sup-kg-4',name:'Unilever Supply',code:'UNI-001',email:'supply@unilever.co.uk',currency:'GBP',rating:4.7},
    {id:'sup-kg-5',name:'Bidvest Group',code:'BID-001',email:'corporate@bidvest.co.za',currency:'ZAR',rating:4.4},
    {id:'sup-kg-6',name:'Maersk Logistics',code:'MAER-001',email:'logistics@maersk.com',currency:'USD',rating:4.5},
  ];
  for (const s of kgSuppliers) {
    await db.prepare('INSERT OR IGNORE INTO erp_suppliers (id,tenant_id,external_id,source_system,name,contact_email,currency,risk_score) VALUES (?,?,?,?,?,?,?,?)')
      .bind(s.id,'kapstadt',s.code,'SAP S/4HANA',s.name,s.email,s.currency,s.rating).run();
  }

  // Products
  const kgProducts = [
    {id:'prod-kg-1',name:'Premium Maize Meal 10kg',sku:'KG-MM-10',category:'Staples',price:120,stock:250000,unit:'bag'},
    {id:'prod-kg-2',name:'Sunflower Cooking Oil 5L',sku:'KG-SO-5L',category:'Oils',price:185,stock:180000,unit:'bottle'},
    {id:'prod-kg-3',name:'Industrial Cleaning Solution 25L',sku:'KG-IC-25',category:'Industrial',price:450,stock:45000,unit:'drum'},
    {id:'prod-kg-4',name:'Premium Tea Blend 500g',sku:'KG-TB-500',category:'Beverages',price:95,stock:320000,unit:'box'},
    {id:'prod-kg-5',name:'Organic Rooibos Export 1kg',sku:'KG-RB-1K',category:'Export',price:280,stock:85000,unit:'pack'},
    {id:'prod-kg-6',name:'Bottled Spring Water 6-pack',sku:'KG-BW-6P',category:'Beverages',price:65,stock:500000,unit:'6-pack'},
    {id:'prod-kg-7',name:'Grain Sorghum Flour 5kg',sku:'KG-GS-5K',category:'Staples',price:78,stock:120000,unit:'bag'},
    {id:'prod-kg-8',name:'Palm Oil Industrial 200L',sku:'KG-PO-200',category:'Industrial',price:8500,stock:5000,unit:'drum'},
    {id:'prod-kg-9',name:'Frozen Vegetables Mixed 1kg',sku:'KG-FV-1K',category:'Frozen',price:42,stock:400000,unit:'pack'},
    {id:'prod-kg-10',name:'Sugar Cane Refined 50kg',sku:'KG-SC-50',category:'Staples',price:680,stock:75000,unit:'bag'},
  ];
  for (const p of kgProducts) {
    await db.prepare('INSERT OR IGNORE INTO erp_products (id,tenant_id,source_system,sku,name,category,unit_price,stock_on_hand,unit_of_measure) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(p.id,'kapstadt','SAP S/4HANA',p.sku,p.name,p.category,p.price,p.stock,p.unit).run();
  }

  // Employees (520 staff across 5 countries — seed representative sample of 80)
  const kgEmps: {id:string;empNum:string;first:string;last:string;dept:string;pos:string;salary:number}[] = [
    // C-Suite & Group Leadership
    {id:'emp-kg-1',empNum:'KG-001',first:'Francois',last:'du Toit',dept:'Executive',pos:'Group CEO',salary:450000},
    {id:'emp-kg-2',empNum:'KG-002',first:'Priya',last:'Naidoo',dept:'Executive',pos:'Group CFO',salary:380000},
    {id:'emp-kg-3',empNum:'KG-003',first:'James',last:'Mokoena',dept:'Executive',pos:'Group COO',salary:350000},
    {id:'emp-kg-4',empNum:'KG-004',first:'Heinrich',last:'Müller',dept:'Executive',pos:'Group CIO',salary:320000},
    {id:'emp-kg-5',empNum:'KG-005',first:'Nomsa',last:'Dladla',dept:'Treasury',pos:'Group Treasurer',salary:280000},
    // SA Operations
    {id:'emp-kg-6',empNum:'KG-010',first:'Willem',last:'Steenkamp',dept:'SA Operations',pos:'MD South Africa',salary:250000},
    {id:'emp-kg-7',empNum:'KG-011',first:'Thandi',last:'Maseko',dept:'SA Finance',pos:'SA Financial Director',salary:200000},
    {id:'emp-kg-8',empNum:'KG-012',first:'Pieter',last:'Viljoen',dept:'SA Operations',pos:'SA Operations Director',salary:185000},
    {id:'emp-kg-9',empNum:'KG-013',first:'Sipho',last:'Zulu',dept:'SA Sales',pos:'SA Sales Director',salary:175000},
    {id:'emp-kg-10',empNum:'KG-014',first:'Lindiwe',last:'Nkosi',dept:'SA HR',pos:'SA HR Manager',salary:120000},
    {id:'emp-kg-11',empNum:'KG-015',first:'Bongani',last:'Dlamini',dept:'SA Operations',pos:'Plant Manager',salary:130000},
    {id:'emp-kg-12',empNum:'KG-016',first:'Mandla',last:'Sithole',dept:'SA Operations',pos:'Production Manager',salary:95000},
    {id:'emp-kg-13',empNum:'KG-017',first:'Zanele',last:'Mthembu',dept:'SA Finance',pos:'SA Management Accountant',salary:95000},
    {id:'emp-kg-14',empNum:'KG-018',first:'Johan',last:'Botha',dept:'SA Supply Chain',pos:'SA Logistics Manager',salary:110000},
    {id:'emp-kg-15',empNum:'KG-019',first:'Riaan',last:'Erasmus',dept:'SA Procurement',pos:'SA Procurement Manager',salary:105000},
    // Nigeria Operations
    {id:'emp-kg-16',empNum:'KG-100',first:'Chukwuma',last:'Okonkwo',dept:'NG Operations',pos:'MD Nigeria',salary:220000},
    {id:'emp-kg-17',empNum:'KG-101',first:'Amara',last:'Ibrahim',dept:'NG Finance',pos:'NG Financial Controller',salary:160000},
    {id:'emp-kg-18',empNum:'KG-102',first:'Emeka',last:'Nwosu',dept:'NG Operations',pos:'NG Operations Manager',salary:130000},
    {id:'emp-kg-19',empNum:'KG-103',first:'Funke',last:'Adeyemi',dept:'NG Sales',pos:'NG Sales Manager',salary:120000},
    {id:'emp-kg-20',empNum:'KG-104',first:'Babajide',last:'Ogundimu',dept:'NG Logistics',pos:'NG Distribution Manager',salary:100000},
    // Kenya Operations
    {id:'emp-kg-21',empNum:'KG-200',first:'Daniel',last:'Kamau',dept:'KE Operations',pos:'MD East Africa',salary:200000},
    {id:'emp-kg-22',empNum:'KG-201',first:'Grace',last:'Wanjiku',dept:'KE Finance',pos:'KE Financial Controller',salary:145000},
    {id:'emp-kg-23',empNum:'KG-202',first:'Peter',last:'Odhiambo',dept:'KE Operations',pos:'KE Factory Manager',salary:110000},
    {id:'emp-kg-24',empNum:'KG-203',first:'Faith',last:'Muthoni',dept:'KE Sales',pos:'KE Sales Manager',salary:105000},
    {id:'emp-kg-25',empNum:'KG-204',first:'Joseph',last:'Kipchirchir',dept:'KE Logistics',pos:'KE Logistics Coordinator',salary:80000},
    // UK Operations
    {id:'emp-kg-26',empNum:'KG-300',first:'Edward',last:'Thompson',dept:'UK Operations',pos:'MD United Kingdom',salary:380000},
    {id:'emp-kg-27',empNum:'KG-301',first:'Sarah',last:'Williams',dept:'UK Finance',pos:'UK Finance Director',salary:280000},
    {id:'emp-kg-28',empNum:'KG-302',first:'Michael',last:'Davies',dept:'UK Sales',pos:'UK Commercial Director',salary:250000},
    {id:'emp-kg-29',empNum:'KG-303',first:'Emma',last:'Robinson',dept:'UK Operations',pos:'UK Supply Chain Manager',salary:180000},
    {id:'emp-kg-30',empNum:'KG-304',first:'David',last:'Taylor',dept:'UK HR',pos:'UK HR Manager',salary:160000},
    // Germany Operations
    {id:'emp-kg-31',empNum:'KG-400',first:'Klaus',last:'Schmidt',dept:'DE Operations',pos:'MD Germany',salary:350000},
    {id:'emp-kg-32',empNum:'KG-401',first:'Anna',last:'Fischer',dept:'DE Finance',pos:'DE Finanzleiter',salary:260000},
    {id:'emp-kg-33',empNum:'KG-402',first:'Thomas',last:'Weber',dept:'DE Operations',pos:'DE Betriebsleiter',salary:220000},
    {id:'emp-kg-34',empNum:'KG-403',first:'Sabine',last:'Hoffmann',dept:'DE Sales',pos:'DE Vertriebsleiter',salary:200000},
    {id:'emp-kg-35',empNum:'KG-404',first:'Stefan',last:'Becker',dept:'DE Logistics',pos:'DE Logistikleiter',salary:180000},
    // Group Functions
    {id:'emp-kg-36',empNum:'KG-500',first:'Christiaan',last:'van der Berg',dept:'Group Finance',pos:'Group Financial Controller',salary:220000},
    {id:'emp-kg-37',empNum:'KG-501',first:'Ayanda',last:'Ngcobo',dept:'Group Finance',pos:'Consolidation Manager',salary:150000},
    {id:'emp-kg-38',empNum:'KG-502',first:'Themba',last:'Khoza',dept:'Group Finance',pos:'Treasury Analyst',salary:110000},
    {id:'emp-kg-39',empNum:'KG-503',first:'Lerato',last:'Moseneke',dept:'Group Finance',pos:'Tax Manager',salary:140000},
    {id:'emp-kg-40',empNum:'KG-504',first:'Sipho',last:'Mahlangu',dept:'Group Finance',pos:'Transfer Pricing Analyst',salary:120000},
    {id:'emp-kg-41',empNum:'KG-510',first:'Werner',last:'Pretorius',dept:'Group IT',pos:'Group IT Director',salary:220000},
    {id:'emp-kg-42',empNum:'KG-511',first:'Nhlanhla',last:'Mthethwa',dept:'Group IT',pos:'SAP Basis Manager',salary:150000},
    {id:'emp-kg-43',empNum:'KG-512',first:'Marco',last:'Ferreira',dept:'Group IT',pos:'Integration Architect',salary:160000},
    {id:'emp-kg-44',empNum:'KG-520',first:'Palesa',last:'Motaung',dept:'Group HR',pos:'Group HR Director',salary:200000},
    {id:'emp-kg-45',empNum:'KG-521',first:'Mbali',last:'Zondo',dept:'Group HR',pos:'Expat Management Lead',salary:130000},
    {id:'emp-kg-46',empNum:'KG-530',first:'André',last:'Pretorius',dept:'Group Procurement',pos:'Group CPO',salary:250000},
    {id:'emp-kg-47',empNum:'KG-531',first:'Nosipho',last:'Dlamini',dept:'Group Procurement',pos:'Category Manager',salary:110000},
    {id:'emp-kg-48',empNum:'KG-540',first:'Ruhan',last:'van Rooyen',dept:'Group Legal',pos:'Group Legal Counsel',salary:250000},
    {id:'emp-kg-49',empNum:'KG-541',first:'Kelebogile',last:'Kgosana',dept:'Group Compliance',pos:'Compliance Officer',salary:130000},
    {id:'emp-kg-50',empNum:'KG-550',first:'Jacques',last:'du Plessis',dept:'Group Strategy',pos:'Group Strategy Director',salary:230000},
    // Additional SA production/warehouse staff
    {id:'emp-kg-51',empNum:'KG-020',first:'Lucky',last:'Chabalala',dept:'SA Operations',pos:'Shift Supervisor A',salary:65000},
    {id:'emp-kg-52',empNum:'KG-021',first:'Joseph',last:'Mahlangu',dept:'SA Operations',pos:'Shift Supervisor B',salary:65000},
    {id:'emp-kg-53',empNum:'KG-022',first:'Samuel',last:'Nkosi',dept:'SA Operations',pos:'Machine Operator',salary:35000},
    {id:'emp-kg-54',empNum:'KG-023',first:'Isaac',last:'Khumalo',dept:'SA Operations',pos:'Machine Operator',salary:35000},
    {id:'emp-kg-55',empNum:'KG-024',first:'Moses',last:'Cele',dept:'SA Operations',pos:'Machine Operator',salary:35000},
    {id:'emp-kg-56',empNum:'KG-025',first:'Aaron',last:'Mabaso',dept:'SA Operations',pos:'Machine Operator',salary:35000},
    {id:'emp-kg-57',empNum:'KG-026',first:'Philip',last:'Zwane',dept:'SA Operations',pos:'Packing Operator',salary:28000},
    {id:'emp-kg-58',empNum:'KG-027',first:'Stephen',last:'Ngwenya',dept:'SA Operations',pos:'Packing Operator',salary:28000},
    {id:'emp-kg-59',empNum:'KG-028',first:'Vincent',last:'Radebe',dept:'SA Warehouse',pos:'Warehouse Supervisor',salary:55000},
    {id:'emp-kg-60',empNum:'KG-029',first:'Martin',last:'Sibiya',dept:'SA Warehouse',pos:'Forklift Driver',salary:30000},
    {id:'emp-kg-61',empNum:'KG-030',first:'Frank',last:'Mvelase',dept:'SA Warehouse',pos:'Forklift Driver',salary:30000},
    {id:'emp-kg-62',empNum:'KG-031',first:'Albert',last:'Phungula',dept:'SA Warehouse',pos:'Storeman',salary:28000},
    {id:'emp-kg-63',empNum:'KG-032',first:'Dennis',last:'Myeni',dept:'SA Quality',pos:'QC Lab Technician',salary:45000},
    {id:'emp-kg-64',empNum:'KG-033',first:'Ernest',last:'Fakude',dept:'SA Quality',pos:'QC Inspector',salary:38000},
    {id:'emp-kg-65',empNum:'KG-034',first:'Walter',last:'Shabangu',dept:'SA Maintenance',pos:'Maintenance Supervisor',salary:65000},
    {id:'emp-kg-66',empNum:'KG-035',first:'Petrus',last:'Kubheka',dept:'SA Maintenance',pos:'Millwright',salary:55000},
    {id:'emp-kg-67',empNum:'KG-036',first:'Cornelius',last:'Maphanga',dept:'SA Maintenance',pos:'Electrician',salary:52000},
    {id:'emp-kg-68',empNum:'KG-037',first:'Gregory',last:'Langa',dept:'SA Finance',pos:'Debtors Clerk',salary:32000},
    {id:'emp-kg-69',empNum:'KG-038',first:'Benedict',last:'Nzimande',dept:'SA Finance',pos:'Creditors Clerk',salary:32000},
    {id:'emp-kg-70',empNum:'KG-039',first:'Cedric',last:'Mazibuko',dept:'SA Finance',pos:'Payroll Administrator',salary:38000},
    // Nigeria additional staff
    {id:'emp-kg-71',empNum:'KG-105',first:'Oluwaseun',last:'Afolabi',dept:'NG Operations',pos:'Production Supervisor',salary:75000},
    {id:'emp-kg-72',empNum:'KG-106',first:'Chidinma',last:'Eze',dept:'NG Finance',pos:'NG Accountant',salary:80000},
    {id:'emp-kg-73',empNum:'KG-107',first:'Tunde',last:'Bakare',dept:'NG Sales',pos:'NG Account Manager',salary:70000},
    // Kenya additional
    {id:'emp-kg-74',empNum:'KG-205',first:'John',last:'Mutua',dept:'KE Operations',pos:'KE Production Lead',salary:65000},
    {id:'emp-kg-75',empNum:'KG-206',first:'Mary',last:'Njeri',dept:'KE Finance',pos:'KE Bookkeeper',salary:55000},
    // UK additional
    {id:'emp-kg-76',empNum:'KG-305',first:'James',last:'Cooper',dept:'UK Sales',pos:'UK Key Account Manager',salary:200000},
    {id:'emp-kg-77',empNum:'KG-306',first:'Lucy',last:'Evans',dept:'UK Operations',pos:'UK Warehouse Manager',salary:150000},
    // Germany additional
    {id:'emp-kg-78',empNum:'KG-405',first:'Michael',last:'König',dept:'DE Sales',pos:'DE Großkundenmanager',salary:180000},
    {id:'emp-kg-79',empNum:'KG-406',first:'Laura',last:'Schneider',dept:'DE Operations',pos:'DE Qualitätsmanagerin',salary:160000},
    {id:'emp-kg-80',empNum:'KG-407',first:'Markus',last:'Braun',dept:'DE Logistics',pos:'DE Transportkoordinator',salary:140000},
  ];
  for (const e of kgEmps) {
    await db.prepare("INSERT OR IGNORE INTO erp_employees (id,tenant_id,source_system,employee_number,first_name,last_name,department,position,gross_salary,salary_frequency,status,hire_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(e.id,'kapstadt','SAP S/4HANA',e.empNum,e.first,e.last,e.dept,e.pos,e.salary,'monthly','active','2022-01-01').run();
  }

  // ── Kapstadt Invoices (large enterprise volumes — 12 months, ~80/month across entities) ──
  const kgInvCustomers = [
    {id:'cust-kg-1',name:'Shoprite Holdings'},{id:'cust-kg-2',name:'Dangote Group'},
    {id:'cust-kg-3',name:'Safaricom PLC'},{id:'cust-kg-4',name:'Tesco PLC'},
    {id:'cust-kg-5',name:'REWE Group'},{id:'cust-kg-6',name:'Pick n Pay'},
    {id:'cust-kg-7',name:'Woolworths Holdings'},{id:'cust-kg-8',name:'MTN Group'},
  ];
  let kgInvIdx = 1;
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let j = 0; j < 80; j++) {
      const cust = kgInvCustomers[j % 8];
      const amount = 150000 + Math.round(Math.sin(kgInvIdx * 0.2) * 80000 + kgInvIdx * 500);
      const isPaid = mo < 9;
      const isOverdue = !isPaid && mo < 11;
      await db.prepare("INSERT OR IGNORE INTO erp_invoices (id,tenant_id,source_system,invoice_number,customer_id,customer_name,invoice_date,due_date,total,amount_paid,amount_due,status,payment_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(`inv-kg-${kgInvIdx}`,'kapstadt','SAP S/4HANA',`INV-KG-${String(kgInvIdx).padStart(6,'0')}`,cust.id,cust.name,`${year}-${month}-01`,`${year}-${month}-30`,amount,isPaid?amount:0,isPaid?0:amount,'approved',isPaid?'paid':(isOverdue?'overdue':'unpaid')).run();
      kgInvIdx++;
    }
  }

  // ── Kapstadt Purchase Orders (global supply chain — 12 months, ~50/month) ──
  const kgPOSuppliers = [
    {id:'sup-kg-1',name:'Mondi Group'},{id:'sup-kg-2',name:'BASF SE'},
    {id:'sup-kg-3',name:'Olam International'},{id:'sup-kg-4',name:'Unilever Supply'},
    {id:'sup-kg-5',name:'Bidvest Group'},{id:'sup-kg-6',name:'Maersk Logistics'},
  ];
  let kgPOIdx = 1;
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let j = 0; j < 50; j++) {
      const sup = kgPOSuppliers[j % 6];
      const amount = 200000 + Math.round(Math.sin(kgPOIdx) * 100000);
      await db.prepare("INSERT OR IGNORE INTO erp_purchase_orders (id,tenant_id,source_system,po_number,supplier_id,supplier_name,order_date,delivery_date,total,status) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(`po-kg-${kgPOIdx}`,'kapstadt','SAP S/4HANA',`PO-KG-${String(kgPOIdx).padStart(6,'0')}`,sup.id,sup.name,`${year}-${month}-02`,`${year}-${month}-15`,amount,mo<10?'received':'open').run();
      kgPOIdx++;
    }
  }

  // ── Kapstadt Journal Entries (40/month × 12 — complex multi-entity) ──
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let j = 1; j <= 40; j++) {
      const jid = `je-kg-${mo * 40 + j}`;
      const amt = 500000 + mo * 30000 + j * 10000;
      const desc = j <= 10 ? `ZA01 month-end closing ${j}` : j <= 18 ? `NG01 month-end closing ${j}` : j <= 25 ? `KE01 month-end closing ${j}` : j <= 32 ? `UK01 month-end closing ${j}` : `DE01 month-end closing ${j}`;
      await db.prepare("INSERT OR IGNORE INTO erp_journal_entries (id,tenant_id,source_system,journal_number,journal_date,description,total_debit,total_credit,status) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(jid,'kapstadt','SAP S/4HANA',`JE-KG-${String(mo*40+j).padStart(5,'0')}`,`${year}-${month}-28`,desc,amt,amt,'posted').run();
    }
  }

  // ── Kapstadt Bank Transactions (60/month × 12 — multi-bank, multi-currency) ──
  for (let mo = 0; mo < 12; mo++) {
    const year = mo < 10 ? '2025' : '2026';
    const month = mo < 10 ? String(mo + 3).padStart(2, '0') : String(mo - 9).padStart(2, '0');
    for (let d = 1; d <= 28; d++) {
      const day = String(d).padStart(2, '0');
      // ZAR account
      const btZar = `bt-kg-zar-${mo * 28 + d}`;
      if (d % 3 === 0) {
        await db.prepare("INSERT OR IGNORE INTO erp_bank_transactions (id,tenant_id,source_system,bank_account,transaction_date,description,reference,credit,debit,balance) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(btZar,'kapstadt','SAP S/4HANA','ABSA-ZAR-001',`${year}-${month}-${day}`,`Customer payment - ZA entity`,`REC-KG-ZA-${mo}-${d}`,450000+d*8000,0,85000000).run();
      } else {
        await db.prepare("INSERT OR IGNORE INTO erp_bank_transactions (id,tenant_id,source_system,bank_account,transaction_date,description,reference,debit,credit,balance) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(btZar,'kapstadt','SAP S/4HANA','ABSA-ZAR-001',`${year}-${month}-${day}`,d%2===0?'Supplier payment - ZA':'Salary run - ZA',`PAY-KG-ZA-${mo}-${d}`,d%2===0?280000:520000,0,85000000).run();
      }
      // GBP account (fewer transactions)
      if (d <= 14) {
        const btGbp = `bt-kg-gbp-${mo * 14 + d}`;
        await db.prepare("INSERT OR IGNORE INTO erp_bank_transactions (id,tenant_id,source_system,bank_account,transaction_date,description,reference,credit,debit,balance) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(btGbp,'kapstadt','SAP S/4HANA','HSBC-GBP-001',`${year}-${month}-${day}`,d%2===0?'UK customer payment':'UK operations funding',`REC-KG-UK-${mo}-${d}`,d%2===0?85000:0,d%2===0?0:65000,12000000).run();
      }
    }
  }

}
