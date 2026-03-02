/**
 * Industry Catalyst Templates
 * Pre-configured catalyst cluster templates with sub-catalysts for each supported industry.
 * Used when deploying catalysts from the Tenants page during company onboarding.
 */

export interface SubCatalystTemplate {
  name: string;
  enabled: boolean;
  description: string;
}

export interface CatalystTemplate {
  name: string;
  domain: string;
  description: string;
  autonomy_tier: string;
  sub_catalysts: SubCatalystTemplate[];
}

export interface IndustryTemplate {
  industry: string;
  label: string;
  description: string;
  clusters: CatalystTemplate[];
}

// ═══════════════════════════════════════════════════════════════════════════
// MINING / STEEL MANUFACTURING
// ═══════════════════════════════════════════════════════════════════════════
const miningClusters: CatalystTemplate[] = [
  {
    name: 'Equipment Health Catalyst', domain: 'mining-equipment',
    description: 'Predictive maintenance for blast furnaces, rolling mills, and cranes',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Predictive Maintenance', enabled: true, description: 'ML-based failure prediction for heavy equipment' },
      { name: 'Vibration Analysis', enabled: true, description: 'Real-time vibration monitoring on rotating equipment' },
      { name: 'Thermal Imaging', enabled: false, description: 'IR camera analysis for refractory and electrical systems' },
      { name: 'Lubrication Scheduling', enabled: true, description: 'Automated lubrication intervals based on operating hours and conditions' },
      { name: 'Spare Parts Forecasting', enabled: false, description: 'Demand prediction for critical spares to minimize downtime' },
    ],
  },
  {
    name: 'Safety Compliance Catalyst', domain: 'mining-safety',
    description: 'Real-time safety monitoring, incident prediction, and compliance tracking',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Incident Prediction', enabled: true, description: 'Near-miss and incident trend analysis' },
      { name: 'PPE Compliance', enabled: true, description: 'Computer vision PPE detection at entry points' },
      { name: 'Environmental Monitoring', enabled: true, description: 'Gas, dust, and noise level tracking' },
      { name: 'Fatigue Management', enabled: true, description: 'Shift pattern analysis and fatigue risk scoring' },
      { name: 'Emergency Response', enabled: false, description: 'Automated emergency protocol triggering and coordination' },
    ],
  },
  {
    name: 'Finance Operations Catalyst', domain: 'finance',
    description: 'Automated journal entries, variance analysis, and cost allocation',
    autonomy_tier: 'transactional',
    sub_catalysts: [
      { name: 'Accounts Receivable', enabled: true, description: 'Automated AR aging and collection workflows' },
      { name: 'Accounts Payable', enabled: true, description: 'Invoice matching and payment scheduling' },
      { name: 'Invoice Reconciliation', enabled: true, description: '3-way match: PO, GRN, Invoice' },
      { name: 'Cost Allocation', enabled: false, description: 'Activity-based costing across cost centers' },
      { name: 'Variance Analysis', enabled: true, description: 'Budget vs actual variance detection and reporting' },
    ],
  },
  {
    name: 'Procurement Catalyst', domain: 'procurement',
    description: 'Supplier evaluation, PO automation, and spend analytics',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Supplier Scoring', enabled: true, description: 'Automated supplier risk and performance rating' },
      { name: 'PO Automation', enabled: true, description: 'Purchase order creation and approval routing' },
      { name: 'Spend Analytics', enabled: false, description: 'Category-level spend analysis and savings identification' },
      { name: 'Contract Management', enabled: true, description: 'Automated contract renewal alerts and compliance tracking' },
    ],
  },
  {
    name: 'Supply Chain Catalyst', domain: 'supply-chain',
    description: 'Raw material logistics, inventory optimization, and demand planning',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Ore Inventory Management', enabled: true, description: 'Real-time iron ore, coke, and flux inventory tracking' },
      { name: 'Demand Forecasting', enabled: true, description: 'Steel demand prediction by product grade and customer' },
      { name: 'Inbound Logistics', enabled: true, description: 'Rail and truck scheduling for raw material delivery' },
      { name: 'Warehouse Optimization', enabled: false, description: 'Stockyard layout optimization and material flow' },
      { name: 'Supplier Lead Time Tracking', enabled: true, description: 'Monitor and predict supplier delivery performance' },
    ],
  },
  {
    name: 'Workforce Management Catalyst', domain: 'hr',
    description: 'Shift scheduling, skills tracking, safety training compliance',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Shift Scheduling', enabled: true, description: 'Automated roster generation considering skills, fatigue, and leave' },
      { name: 'Skills Matrix', enabled: true, description: 'Competency tracking and gap analysis for mining operations' },
      { name: 'Training Compliance', enabled: true, description: 'Safety certification tracking and renewal reminders' },
      { name: 'Overtime Management', enabled: false, description: 'Overtime pattern analysis and budget control' },
      { name: 'Succession Planning', enabled: false, description: 'Critical role identification and talent pipeline management' },
    ],
  },
  {
    name: 'Ore Processing Catalyst', domain: 'mining-ore',
    description: 'Smelting optimization, ore grade tracking, and yield maximization',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Grade Control', enabled: true, description: 'Real-time ore grade monitoring and blending optimization' },
      { name: 'Smelting Optimization', enabled: true, description: 'Blast furnace parameter tuning for yield maximization' },
      { name: 'Quality Prediction', enabled: true, description: 'ML-based steel quality prediction from input parameters' },
      { name: 'Energy Optimization', enabled: false, description: 'Minimize energy consumption per ton of steel produced' },
      { name: 'Slag Management', enabled: true, description: 'Slag chemistry optimization and recycling tracking' },
    ],
  },
  {
    name: 'Environmental Compliance Catalyst', domain: 'mining-environment',
    description: 'Emissions monitoring, water management, waste tracking',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Emissions Monitoring', enabled: true, description: 'CO2, SO2, and particulate matter continuous monitoring' },
      { name: 'Water Management', enabled: true, description: 'Cooling water quality, recycling rates, and discharge compliance' },
      { name: 'Waste Tracking', enabled: true, description: 'Hazardous and non-hazardous waste classification and disposal tracking' },
      { name: 'Regulatory Reporting', enabled: false, description: 'Automated DMRE and DWS regulatory report generation' },
      { name: 'Carbon Credit Tracking', enabled: false, description: 'Carbon offset calculation and trading opportunity identification' },
    ],
  },
  {
    name: 'Sales & Distribution Catalyst', domain: 'sales',
    description: 'Customer order management, pricing optimization, and delivery scheduling',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Order Management', enabled: true, description: 'Automated order intake, confirmation, and prioritization' },
      { name: 'Dynamic Pricing', enabled: false, description: 'Market-based pricing recommendation for steel grades' },
      { name: 'Delivery Scheduling', enabled: true, description: 'Optimized dispatch planning linked to production schedule' },
      { name: 'Customer Credit Scoring', enabled: true, description: 'Real-time credit limit monitoring and risk assessment' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// AGRICULTURE / ORGANIC FARMING
// ═══════════════════════════════════════════════════════════════════════════
const agricultureClusters: CatalystTemplate[] = [
  {
    name: 'Finance Catalyst', domain: 'finance',
    description: 'Automated invoicing, expense categorization, cash flow forecasting',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Accounts Receivable', enabled: true, description: 'Invoice generation and debtor management' },
      { name: 'Accounts Payable', enabled: true, description: 'Supplier payment scheduling' },
      { name: 'Cash Flow Forecast', enabled: true, description: '12-week rolling cash flow projection' },
      { name: 'Seasonal Budget Planning', enabled: true, description: 'Crop cycle-aligned budget forecasting and variance tracking' },
      { name: 'Grant & Subsidy Tracking', enabled: false, description: 'Agricultural grant applications and compliance monitoring' },
    ],
  },
  {
    name: 'Supply Chain Catalyst', domain: 'supply-chain',
    description: 'Harvest planning, cold chain monitoring, distributor coordination',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Harvest Planning', enabled: true, description: 'Seasonal yield forecasting and resource allocation' },
      { name: 'Cold Chain Monitor', enabled: true, description: 'Temperature and humidity tracking in transit' },
      { name: 'Distributor Coordination', enabled: false, description: 'Automated order fulfillment and delivery scheduling' },
      { name: 'Traceability', enabled: true, description: 'Field-to-fork traceability for organic certification and recalls' },
      { name: 'Packaging Optimization', enabled: false, description: 'Optimal pack size and material selection based on buyer requirements' },
    ],
  },
  {
    name: 'Crop Intelligence Catalyst', domain: 'agri-crop',
    description: 'Soil analysis, crop health monitoring, pest prediction, and yield optimization',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Soil Health Monitoring', enabled: true, description: 'Real-time soil moisture, pH, and nutrient level tracking' },
      { name: 'Pest & Disease Prediction', enabled: true, description: 'ML-based pest outbreak prediction using weather and historical data' },
      { name: 'Crop Rotation Planning', enabled: true, description: 'Optimal rotation schedules for soil health and yield maximization' },
      { name: 'Satellite Imagery Analysis', enabled: false, description: 'NDVI and multispectral analysis for crop health assessment' },
      { name: 'Weather Impact Modeling', enabled: true, description: 'Micro-climate forecasting and frost/hail risk assessment' },
    ],
  },
  {
    name: 'Irrigation Management Catalyst', domain: 'agri-irrigation',
    description: 'Smart irrigation scheduling, water usage optimization, and borehole management',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Smart Scheduling', enabled: true, description: 'Soil moisture-driven irrigation scheduling' },
      { name: 'Water Budget Management', enabled: true, description: 'Farm-level water allocation and usage tracking' },
      { name: 'Borehole Monitoring', enabled: true, description: 'Groundwater level tracking and pump efficiency monitoring' },
      { name: 'Drip System Health', enabled: false, description: 'Leak detection and pressure monitoring on drip irrigation lines' },
      { name: 'Rainwater Harvesting', enabled: false, description: 'Rainwater capture optimization and storage management' },
    ],
  },
  {
    name: 'Quality Assurance Catalyst', domain: 'agri-quality',
    description: 'Organic certification compliance, produce grading, and quality testing',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Organic Certification', enabled: true, description: 'SAOSO certification requirement tracking and documentation' },
      { name: 'Produce Grading', enabled: true, description: 'Automated visual grading and size classification' },
      { name: 'Pesticide Residue Testing', enabled: true, description: 'Lab test scheduling and result tracking for compliance' },
      { name: 'Shelf Life Prediction', enabled: false, description: 'ML model predicting shelf life based on harvest conditions' },
      { name: 'GAP Compliance', enabled: true, description: 'Good Agricultural Practices audit checklist automation' },
    ],
  },
  {
    name: 'Market Intelligence Catalyst', domain: 'agri-market',
    description: 'Fresh produce pricing, buyer demand signals, and market access',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Price Monitoring', enabled: true, description: 'Daily fresh produce market price tracking across major markets' },
      { name: 'Demand Forecasting', enabled: true, description: 'Retailer order pattern analysis and demand prediction' },
      { name: 'Export Opportunity', enabled: false, description: 'International market access and phytosanitary compliance' },
      { name: 'Competitor Benchmarking', enabled: false, description: 'Regional organic farm yield and pricing benchmarking' },
    ],
  },
  {
    name: 'Sales & Distribution Catalyst', domain: 'sales',
    description: 'Customer order management, route-to-market optimization',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Order Management', enabled: true, description: 'Automated order intake from retailers and distributors' },
      { name: 'Route-to-Market', enabled: true, description: 'Optimal delivery route and schedule planning' },
      { name: 'Retailer Scorecarding', enabled: false, description: 'Buyer performance tracking and relationship health scoring' },
      { name: 'Seasonal Promotions', enabled: true, description: 'Produce availability-linked promotional campaign coordination' },
    ],
  },
  {
    name: 'Farm Workforce Catalyst', domain: 'hr',
    description: 'Seasonal labor planning, worker safety, and skills tracking',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Seasonal Labor Planning', enabled: true, description: 'Harvest labor demand forecasting and recruitment scheduling' },
      { name: 'Worker Safety', enabled: true, description: 'Heat stress monitoring and chemical handling compliance' },
      { name: 'Skills & Certification', enabled: true, description: 'Pesticide applicator licenses and equipment operator certifications' },
      { name: 'Payroll Integration', enabled: false, description: 'Piece-rate and hourly payroll calculation automation' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// HEALTHCARE
// ═══════════════════════════════════════════════════════════════════════════
const healthcareClusters: CatalystTemplate[] = [
  {
    name: 'Patient Flow Catalyst', domain: 'health-patient',
    description: 'Patient scheduling, ward allocation, discharge planning, readmission prediction',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Scheduling', enabled: true, description: 'Automated patient appointment scheduling' },
      { name: 'Ward Allocation', enabled: true, description: 'Real-time bed management and allocation' },
      { name: 'Discharge Planning', enabled: true, description: 'Coordinated discharge with follow-up scheduling' },
      { name: 'Readmission Prediction', enabled: false, description: 'ML model predicting 30-day readmission risk' },
      { name: 'Triage Prioritization', enabled: true, description: 'AI-assisted triage scoring and queue optimization' },
      { name: 'Theatre Scheduling', enabled: false, description: 'Operating theatre slot optimization and conflict resolution' },
    ],
  },
  {
    name: 'Healthcare Compliance Catalyst', domain: 'health-compliance',
    description: 'NDoH reporting, POPIA compliance, clinical audit preparation',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'NDoH Reporting', enabled: true, description: 'Automated National Department of Health submissions' },
      { name: 'POPIA Compliance', enabled: true, description: 'Patient data privacy compliance checks' },
      { name: 'Clinical Audit', enabled: false, description: 'Automated clinical audit trail preparation' },
      { name: 'Infection Control', enabled: true, description: 'HAI tracking and prevention protocol compliance' },
      { name: 'HPCSA Compliance', enabled: true, description: 'Health Professions Council registration and CPD tracking' },
    ],
  },
  {
    name: 'Healthcare Finance Catalyst', domain: 'finance',
    description: 'Medical aid billing, claims management, revenue cycle optimization',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Medical Aid Billing', enabled: true, description: 'Automated medical aid claim submission' },
      { name: 'Claims Management', enabled: true, description: 'Claim tracking, follow-up, and rejection handling' },
      { name: 'Invoice Reconciliation', enabled: true, description: 'Statement vs claim reconciliation' },
      { name: 'Revenue Cycle', enabled: false, description: 'End-to-end revenue cycle optimization' },
      { name: 'Tariff Code Optimization', enabled: true, description: 'ICD-10 and NAPPI code accuracy checking and optimization' },
    ],
  },
  {
    name: 'Clinical Staffing Catalyst', domain: 'health-staffing',
    description: 'Nurse scheduling, locum management, skills-mix optimization',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Nurse Rostering', enabled: true, description: 'Automated shift scheduling considering skills, ward acuity, and leave' },
      { name: 'Locum Management', enabled: true, description: 'Temporary staff sourcing, onboarding, and cost tracking' },
      { name: 'Skills-Mix Optimization', enabled: true, description: 'Ward-level staff composition optimization for patient safety' },
      { name: 'Burnout Detection', enabled: false, description: 'Early warning system for staff burnout using work pattern analysis' },
      { name: 'Agency Cost Control', enabled: true, description: 'Locum agency spend tracking and rate benchmarking' },
    ],
  },
  {
    name: 'Medical Supply Chain Catalyst', domain: 'health-supply',
    description: 'Pharmaceutical inventory, medical device tracking, supply chain resilience',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Pharmaceutical Inventory', enabled: true, description: 'Drug stock level monitoring and expiry date management' },
      { name: 'Formulary Management', enabled: true, description: 'Preferred drug list compliance and generic substitution tracking' },
      { name: 'Medical Device Tracking', enabled: true, description: 'Equipment maintenance schedules and calibration tracking' },
      { name: 'Supplier Diversity', enabled: false, description: 'Multi-source procurement for supply chain resilience' },
      { name: 'Cold Chain Compliance', enabled: true, description: 'Temperature-sensitive medication storage and transport monitoring' },
    ],
  },
  {
    name: 'Patient Experience Catalyst', domain: 'health-experience',
    description: 'Patient satisfaction tracking, feedback analysis, service recovery',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Satisfaction Surveys', enabled: true, description: 'Automated post-visit survey distribution and scoring' },
      { name: 'Complaint Management', enabled: true, description: 'Patient complaint logging, routing, and resolution tracking' },
      { name: 'Service Recovery', enabled: false, description: 'Automated escalation and resolution for negative experiences' },
      { name: 'Wait Time Communication', enabled: true, description: 'Real-time patient wait time updates via SMS' },
      { name: 'Net Promoter Tracking', enabled: true, description: 'NPS trend analysis and detractor follow-up automation' },
    ],
  },
  {
    name: 'Healthcare HR Catalyst', domain: 'hr',
    description: 'Medical professional recruitment, credentialing, and CPD',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Recruitment Pipeline', enabled: true, description: 'Medical professional vacancy tracking and sourcing' },
      { name: 'Credentialing', enabled: true, description: 'License verification and practice number validation' },
      { name: 'CPD Management', enabled: true, description: 'Continuing professional development hour tracking' },
      { name: 'Performance Reviews', enabled: false, description: '360-degree feedback and competency assessment automation' },
      { name: 'Onboarding Workflow', enabled: true, description: 'New hire orientation, IT access, and compliance training checklist' },
    ],
  },
  {
    name: 'Healthcare Procurement Catalyst', domain: 'procurement',
    description: 'Medical supply procurement, tender management, and vendor evaluation',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Tender Management', enabled: true, description: 'Medical supply tender creation, evaluation, and awarding' },
      { name: 'Vendor Evaluation', enabled: true, description: 'Supplier quality, delivery, and pricing scorecarding' },
      { name: 'Contract Compliance', enabled: true, description: 'Supplier contract SLA monitoring and penalty tracking' },
      { name: 'Group Purchasing', enabled: false, description: 'Multi-clinic bulk purchasing coordination for volume discounts' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// LOGISTICS / TRANSPORT
// ═══════════════════════════════════════════════════════════════════════════
const logisticsClusters: CatalystTemplate[] = [
  {
    name: 'Route Optimization Catalyst', domain: 'supply-chain',
    description: 'Real-time route planning, fuel optimization, fleet scheduling',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Route Planning', enabled: true, description: 'Dynamic route optimization with traffic and weather' },
      { name: 'Fuel Optimization', enabled: true, description: 'Fuel consumption tracking and efficiency coaching' },
      { name: 'Fleet Scheduling', enabled: true, description: 'Vehicle and driver assignment optimization' },
      { name: 'Load Optimization', enabled: false, description: 'Weight distribution and capacity planning' },
      { name: 'Cross-Docking', enabled: true, description: 'Hub transfer optimization to minimize handling time' },
    ],
  },
  {
    name: 'Transport Finance Catalyst', domain: 'finance',
    description: 'Fuel cost tracking, trip costing, customer billing automation',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Trip Costing', enabled: true, description: 'Automated per-trip cost calculation' },
      { name: 'Customer Billing', enabled: true, description: 'POD-based automated invoice generation' },
      { name: 'Accounts Receivable', enabled: true, description: 'Debtor aging and follow-up automation' },
      { name: 'Fuel Surcharge Calculator', enabled: true, description: 'Automated fuel surcharge adjustment based on diesel price index' },
      { name: 'Fleet Depreciation', enabled: false, description: 'Vehicle depreciation tracking and replacement forecasting' },
    ],
  },
  {
    name: 'Fleet Maintenance Catalyst', domain: 'logistics-fleet',
    description: 'Predictive vehicle maintenance, tyre management, and compliance tracking',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Predictive Maintenance', enabled: true, description: 'Engine telemetry-based maintenance prediction and scheduling' },
      { name: 'Tyre Management', enabled: true, description: 'Tyre wear tracking, rotation scheduling, and retread optimization' },
      { name: 'COF Compliance', enabled: true, description: 'Certificate of Fitness expiry tracking and renewal management' },
      { name: 'Brake Testing', enabled: true, description: 'Automated brake performance tracking and replacement scheduling' },
      { name: 'Fuel System Health', enabled: false, description: 'Injector and pump performance monitoring for fuel efficiency' },
    ],
  },
  {
    name: 'Driver Management Catalyst', domain: 'hr',
    description: 'Driver scheduling, licensing compliance, fatigue management',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Driver Scheduling', enabled: true, description: 'Automated driver rostering considering hours-of-service regulations' },
      { name: 'License Tracking', enabled: true, description: 'Code 14 EC license expiry and renewal management' },
      { name: 'Fatigue Management', enabled: true, description: 'Drive time monitoring and mandatory rest enforcement' },
      { name: 'Performance Scorecarding', enabled: true, description: 'Driver safety, fuel efficiency, and on-time delivery scoring' },
      { name: 'Training & Certification', enabled: false, description: 'Hazmat, defensive driving, and first aid certification tracking' },
    ],
  },
  {
    name: 'Transport Compliance Catalyst', domain: 'logistics-compliance',
    description: 'RTMS compliance, cross-border permits, and regulatory reporting',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'RTMS Compliance', enabled: true, description: 'Road Transport Management System accreditation tracking' },
      { name: 'Cross-Border Permits', enabled: true, description: 'SADC cross-border permit management and customs documentation' },
      { name: 'Overload Prevention', enabled: true, description: 'Real-time axle weight monitoring and load compliance' },
      { name: 'Incident Reporting', enabled: true, description: 'Accident and incident regulatory reporting automation' },
      { name: 'Insurance Management', enabled: false, description: 'Fleet insurance policy tracking and claims management' },
    ],
  },
  {
    name: 'Warehouse Operations Catalyst', domain: 'logistics-warehouse',
    description: 'Depot operations optimization, inventory management, dock scheduling',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Dock Scheduling', enabled: true, description: 'Loading bay allocation and truck queuing optimization' },
      { name: 'Inventory Tracking', enabled: true, description: 'Cross-dock and break-bulk inventory visibility' },
      { name: 'Damage Prevention', enabled: false, description: 'Load securing compliance and damage trend analysis' },
      { name: 'Yard Management', enabled: true, description: 'Trailer parking, staging, and movement tracking' },
    ],
  },
  {
    name: 'Customer Service Catalyst', domain: 'sales',
    description: 'Customer SLA tracking, delivery visibility, and relationship management',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'SLA Monitoring', enabled: true, description: 'Real-time delivery SLA tracking per customer contract' },
      { name: 'Track & Trace', enabled: true, description: 'Customer-facing shipment visibility and ETA updates' },
      { name: 'Claims Management', enabled: true, description: 'Delivery damage and loss claim processing automation' },
      { name: 'Rate Management', enabled: false, description: 'Customer-specific rate card management and quoting' },
      { name: 'Contract Renewal', enabled: true, description: 'Contract expiry tracking and renewal opportunity alerts' },
    ],
  },
  {
    name: 'Procurement Catalyst', domain: 'procurement',
    description: 'Fuel procurement, parts purchasing, and vendor management',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Fuel Procurement', enabled: true, description: 'Bulk fuel purchasing and depot price optimization' },
      { name: 'Parts Purchasing', enabled: true, description: 'Automated spare parts reordering based on maintenance schedules' },
      { name: 'Vendor Scoring', enabled: true, description: 'Supplier reliability and pricing benchmarking' },
      { name: 'Tender Management', enabled: false, description: 'Fleet service provider tender creation and evaluation' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// TECHNOLOGY / SAAS
// ═══════════════════════════════════════════════════════════════════════════
const technologyClusters: CatalystTemplate[] = [
  {
    name: 'Revenue Operations Catalyst', domain: 'sales',
    description: 'Churn prediction, upsell identification, pipeline health, renewal management',
    autonomy_tier: 'transactional',
    sub_catalysts: [
      { name: 'Churn Prediction', enabled: true, description: 'ML model predicting customer churn probability' },
      { name: 'Upsell Engine', enabled: true, description: 'Cross-sell and upsell opportunity identification' },
      { name: 'Pipeline Health', enabled: true, description: 'Deal velocity and win-rate tracking' },
      { name: 'Renewal Management', enabled: false, description: 'Automated renewal reminders and processing' },
      { name: 'Win/Loss Analysis', enabled: true, description: 'Post-deal analysis to improve conversion strategies' },
      { name: 'Territory Planning', enabled: false, description: 'Account territory assignment optimization using revenue potential' },
    ],
  },
  {
    name: 'SaaS Finance Catalyst', domain: 'finance',
    description: 'Revenue recognition, ARR tracking, cash flow forecasting',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Revenue Recognition', enabled: true, description: 'ASC 606 compliant revenue recognition' },
      { name: 'ARR Tracking', enabled: true, description: 'Real-time ARR, MRR, and expansion metrics' },
      { name: 'Invoice Reconciliation', enabled: true, description: 'Subscription billing reconciliation' },
      { name: 'Cost Optimization', enabled: false, description: 'Cloud and vendor spend optimization' },
      { name: 'Unit Economics', enabled: true, description: 'CAC, LTV, and payback period tracking per cohort' },
    ],
  },
  {
    name: 'Talent Intelligence Catalyst', domain: 'hr',
    description: 'Retention prediction, compensation benchmarking, hiring pipeline',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Retention Prediction', enabled: true, description: 'Employee flight risk scoring' },
      { name: 'Compensation Benchmarking', enabled: true, description: 'Market rate comparison and equity analysis' },
      { name: 'Hiring Pipeline', enabled: false, description: 'Candidate funnel optimization and sourcing' },
      { name: 'Diversity Analytics', enabled: true, description: 'Workforce diversity metrics and inclusive hiring tracking' },
      { name: 'Engineering Capacity', enabled: true, description: 'Sprint capacity planning and allocation optimization' },
    ],
  },
  {
    name: 'DevOps Intelligence Catalyst', domain: 'tech-devops',
    description: 'CI/CD pipeline monitoring, deployment risk scoring, infrastructure cost optimization',
    autonomy_tier: 'transactional',
    sub_catalysts: [
      { name: 'Pipeline Monitoring', enabled: true, description: 'CI/CD pipeline health, build times, and failure rate tracking' },
      { name: 'Deployment Risk Scoring', enabled: true, description: 'ML-based deployment risk assessment before production releases' },
      { name: 'Infrastructure Cost', enabled: true, description: 'Cloud resource utilization and right-sizing recommendations' },
      { name: 'Incident Response', enabled: true, description: 'Automated incident detection, escalation, and runbook execution' },
      { name: 'SLA Monitoring', enabled: true, description: 'Service uptime, latency, and error rate tracking against SLAs' },
      { name: 'Capacity Planning', enabled: false, description: 'Predictive scaling based on usage trends and seasonal patterns' },
    ],
  },
  {
    name: 'Security Operations Catalyst', domain: 'tech-security',
    description: 'Vulnerability management, access control auditing, compliance monitoring',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Vulnerability Scanning', enabled: true, description: 'Automated dependency and infrastructure vulnerability detection' },
      { name: 'Access Audit', enabled: true, description: 'Permission review, orphaned account detection, and least-privilege enforcement' },
      { name: 'SOC 2 Compliance', enabled: true, description: 'Continuous SOC 2 Type II control monitoring and evidence collection' },
      { name: 'Threat Detection', enabled: false, description: 'Anomalous access pattern detection and threat intelligence correlation' },
      { name: 'Secret Rotation', enabled: true, description: 'API key and credential rotation scheduling and compliance' },
      { name: 'Penetration Testing', enabled: false, description: 'Automated security testing coordination and finding tracking' },
    ],
  },
  {
    name: 'Product Analytics Catalyst', domain: 'tech-product',
    description: 'Feature adoption tracking, user journey analysis, A/B testing',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Feature Adoption', enabled: true, description: 'Feature usage tracking and adoption funnel analysis' },
      { name: 'User Journey Mapping', enabled: true, description: 'Session flow analysis and drop-off point identification' },
      { name: 'A/B Test Management', enabled: true, description: 'Experiment lifecycle management and statistical significance tracking' },
      { name: 'Product-Led Growth', enabled: true, description: 'PQL scoring, activation rate, and time-to-value optimization' },
      { name: 'Feedback Loop', enabled: false, description: 'Customer feedback aggregation and feature request prioritization' },
    ],
  },
  {
    name: 'Customer Success Catalyst', domain: 'tech-customer-success',
    description: 'Customer health scoring, onboarding automation, support intelligence',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Health Scoring', enabled: true, description: 'Multi-signal customer health score combining usage, support, and payment data' },
      { name: 'Onboarding Automation', enabled: true, description: 'Guided onboarding workflow with milestone tracking and intervention triggers' },
      { name: 'Support Intelligence', enabled: true, description: 'Ticket classification, routing, and resolution time prediction' },
      { name: 'Expansion Detection', enabled: true, description: 'Usage-based expansion opportunity identification and timing' },
      { name: 'QBR Preparation', enabled: false, description: 'Automated quarterly business review deck generation with usage insights' },
      { name: 'Advocacy Program', enabled: false, description: 'NPS-based referral and case study candidate identification' },
    ],
  },
  {
    name: 'Procurement Catalyst', domain: 'procurement',
    description: 'SaaS vendor management, license optimization, technology spend governance',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'SaaS License Management', enabled: true, description: 'Software license utilization tracking and optimization' },
      { name: 'Vendor Consolidation', enabled: true, description: 'Overlapping tool identification and consolidation opportunities' },
      { name: 'Contract Negotiation', enabled: false, description: 'Benchmark-based pricing intelligence for vendor negotiations' },
      { name: 'Budget Forecasting', enabled: true, description: 'Technology spend forecasting by department and category' },
    ],
  },
  {
    name: 'Supply Chain Catalyst', domain: 'supply-chain',
    description: 'Hardware procurement, data center inventory, and resource planning',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Hardware Lifecycle', enabled: true, description: 'Employee device tracking, refresh cycles, and disposal management' },
      { name: 'License Compliance', enabled: true, description: 'Software audit readiness and entitlement tracking' },
      { name: 'Resource Planning', enabled: false, description: 'Professional services resource allocation and utilization optimization' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// MANUFACTURING
// ═══════════════════════════════════════════════════════════════════════════
const manufacturingClusters: CatalystTemplate[] = [
  {
    name: 'Production Line Catalyst', domain: 'mfg-production',
    description: 'Production scheduling, throughput optimization, and OEE monitoring',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Production Scheduling', enabled: true, description: 'Automated production order sequencing and machine allocation' },
      { name: 'OEE Monitoring', enabled: true, description: 'Overall Equipment Effectiveness tracking and loss categorization' },
      { name: 'Throughput Optimization', enabled: true, description: 'Bottleneck identification and line balancing recommendations' },
      { name: 'Changeover Reduction', enabled: false, description: 'SMED-based changeover time analysis and optimization' },
      { name: 'Batch Tracking', enabled: true, description: 'Full batch genealogy and material traceability' },
    ],
  },
  {
    name: 'Quality Control Catalyst', domain: 'mfg-quality',
    description: 'SPC monitoring, defect prediction, and non-conformance management',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'SPC Monitoring', enabled: true, description: 'Statistical process control charts and out-of-control detection' },
      { name: 'Defect Prediction', enabled: true, description: 'ML model predicting defect probability from process parameters' },
      { name: 'NCR Management', enabled: true, description: 'Non-conformance report workflow automation' },
      { name: 'Incoming Inspection', enabled: false, description: 'Raw material quality verification and supplier feedback' },
      { name: 'Customer Complaint Analysis', enabled: true, description: 'Root cause analysis and corrective action tracking' },
    ],
  },
  {
    name: 'Maintenance Catalyst', domain: 'mfg-maintenance',
    description: 'Preventive maintenance scheduling, spare parts management, and CMMS integration',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Preventive Scheduling', enabled: true, description: 'Time and usage-based maintenance schedule generation' },
      { name: 'Predictive Maintenance', enabled: true, description: 'Condition monitoring-based failure prediction' },
      { name: 'Spare Parts Management', enabled: true, description: 'Critical spare inventory optimization and reorder automation' },
      { name: 'Work Order Management', enabled: true, description: 'Maintenance work order lifecycle automation' },
      { name: 'MTBF/MTTR Analytics', enabled: false, description: 'Mean time between failures and repair time trend analysis' },
    ],
  },
  {
    name: 'Energy Management Catalyst', domain: 'mfg-energy',
    description: 'Energy consumption monitoring, load management, and sustainability reporting',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Consumption Monitoring', enabled: true, description: 'Real-time energy usage tracking by machine and production line' },
      { name: 'Load Management', enabled: true, description: 'Peak demand management and load shedding scheduling' },
      { name: 'Cost Allocation', enabled: true, description: 'Energy cost allocation per product and batch' },
      { name: 'Solar Integration', enabled: false, description: 'Renewable energy generation tracking and grid feedback optimization' },
      { name: 'Carbon Reporting', enabled: false, description: 'Scope 1 & 2 emissions calculation and reporting' },
    ],
  },
  {
    name: 'Finance Operations Catalyst', domain: 'finance',
    description: 'Production costing, inventory valuation, and variance analysis',
    autonomy_tier: 'transactional',
    sub_catalysts: [
      { name: 'Production Costing', enabled: true, description: 'Standard vs actual cost variance by product and work center' },
      { name: 'Inventory Valuation', enabled: true, description: 'FIFO/weighted average inventory valuation automation' },
      { name: 'Accounts Payable', enabled: true, description: 'Supplier invoice processing and 3-way matching' },
      { name: 'Budget Forecasting', enabled: false, description: 'Production volume-linked budget and cash flow forecasting' },
      { name: 'Accounts Receivable', enabled: true, description: 'Customer invoicing and collections management' },
    ],
  },
  {
    name: 'Supply Chain Catalyst', domain: 'supply-chain',
    description: 'Raw material procurement, inventory management, and supplier coordination',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'MRP Planning', enabled: true, description: 'Material requirements planning based on production schedule' },
      { name: 'Inventory Optimization', enabled: true, description: 'Safety stock calculation and reorder point optimization' },
      { name: 'Supplier Coordination', enabled: true, description: 'Supplier delivery scheduling and performance tracking' },
      { name: 'Demand Planning', enabled: false, description: 'Finished goods demand forecasting from sales orders and trends' },
      { name: 'Logistics Management', enabled: true, description: 'Inbound and outbound freight management and cost optimization' },
    ],
  },
  {
    name: 'Workforce Management Catalyst', domain: 'hr',
    description: 'Shift scheduling, skills tracking, and safety compliance',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Shift Scheduling', enabled: true, description: 'Multi-shift roster optimization considering skills and regulations' },
      { name: 'Skills Matrix', enabled: true, description: 'Operator competency tracking and training gap identification' },
      { name: 'Safety Compliance', enabled: true, description: 'PPE compliance, safety induction, and incident tracking' },
      { name: 'Overtime Analytics', enabled: false, description: 'Overtime cost tracking and authorization workflow' },
    ],
  },
  {
    name: 'Sales & Distribution Catalyst', domain: 'sales',
    description: 'Order management, pricing, and delivery coordination',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Order Management', enabled: true, description: 'Customer order intake, ATP check, and delivery scheduling' },
      { name: 'Pricing Engine', enabled: true, description: 'Volume-based and customer-specific pricing management' },
      { name: 'Delivery Coordination', enabled: true, description: 'Dispatch planning and proof of delivery tracking' },
      { name: 'Customer Portal', enabled: false, description: 'Self-service order tracking and invoice access' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// FINANCIAL SERVICES
// ═══════════════════════════════════════════════════════════════════════════
const financialServicesClusters: CatalystTemplate[] = [
  {
    name: 'Risk Management Catalyst', domain: 'finance',
    description: 'Credit risk scoring, market risk monitoring, and regulatory capital calculation',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Credit Risk Scoring', enabled: true, description: 'ML-based credit scoring and probability of default modeling' },
      { name: 'Market Risk', enabled: true, description: 'VaR calculation and market exposure monitoring' },
      { name: 'Regulatory Capital', enabled: true, description: 'Basel III/IV capital adequacy calculation' },
      { name: 'Stress Testing', enabled: false, description: 'Scenario-based portfolio stress testing automation' },
      { name: 'Concentration Risk', enabled: true, description: 'Portfolio concentration monitoring and limit management' },
    ],
  },
  {
    name: 'Compliance & Regulatory Catalyst', domain: 'finance',
    description: 'AML screening, KYC verification, and regulatory reporting automation',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'AML Screening', enabled: true, description: 'Automated anti-money laundering transaction screening' },
      { name: 'KYC Verification', enabled: true, description: 'Customer due diligence and identity verification' },
      { name: 'Regulatory Reporting', enabled: true, description: 'Automated SARB and FSB regulatory submissions' },
      { name: 'Sanctions Screening', enabled: true, description: 'Real-time sanctions list screening and alert management' },
      { name: 'FICA Compliance', enabled: false, description: 'Financial Intelligence Centre Act compliance monitoring' },
    ],
  },
  {
    name: 'Customer Intelligence Catalyst', domain: 'sales',
    description: 'Customer segmentation, product recommendation, and retention management',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Customer Segmentation', enabled: true, description: 'Behavioral and value-based customer segmentation' },
      { name: 'Product Recommendation', enabled: true, description: 'Next-best-product recommendation engine' },
      { name: 'Retention Management', enabled: true, description: 'Early warning churn detection and retention actions' },
      { name: 'Lifetime Value', enabled: false, description: 'Customer lifetime value prediction and optimization' },
      { name: 'Cross-Sell Analytics', enabled: true, description: 'Product affinity analysis and cross-sell opportunity scoring' },
    ],
  },
  {
    name: 'Operations Catalyst', domain: 'supply-chain',
    description: 'Process automation, SLA monitoring, and operational efficiency',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Process Automation', enabled: true, description: 'Straight-through processing rate monitoring and improvement' },
      { name: 'SLA Monitoring', enabled: true, description: 'Service level agreement tracking and breach alerting' },
      { name: 'Capacity Planning', enabled: false, description: 'Transaction volume forecasting and resource planning' },
      { name: 'Quality Assurance', enabled: true, description: 'Transaction accuracy monitoring and error rate tracking' },
    ],
  },
  {
    name: 'Workforce Catalyst', domain: 'hr',
    description: 'Branch staffing, compliance training, and performance management',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Branch Staffing', enabled: true, description: 'Optimal branch headcount planning based on transaction volumes' },
      { name: 'Compliance Training', enabled: true, description: 'Regulatory training completion tracking and certification management' },
      { name: 'Performance Management', enabled: true, description: 'KPI-based performance tracking and incentive calculation' },
      { name: 'Talent Pipeline', enabled: false, description: 'Succession planning and high-potential identification' },
    ],
  },
  {
    name: 'Procurement Catalyst', domain: 'procurement',
    description: 'IT vendor management, outsourcing governance, and cost optimization',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'IT Vendor Management', enabled: true, description: 'Technology vendor performance and contract management' },
      { name: 'Outsourcing Governance', enabled: true, description: 'BPO and outsourcing SLA monitoring and cost tracking' },
      { name: 'Cost Optimization', enabled: true, description: 'Operational cost benchmarking and reduction opportunity identification' },
      { name: 'RFP Management', enabled: false, description: 'Request for proposal lifecycle automation' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// FMCG (Fast-Moving Consumer Goods)
// ═══════════════════════════════════════════════════════════════════════════
const fmcgClusters: CatalystTemplate[] = [
  {
    name: 'Trade Promotion Catalyst', domain: 'fmcg-trade',
    description: 'Trade spend optimization, promotion ROI tracking, and retail execution',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Promotion Planning', enabled: true, description: 'Trade promotion calendar management and budget allocation' },
      { name: 'ROI Analysis', enabled: true, description: 'Post-promotion effectiveness and lift measurement' },
      { name: 'Retail Execution', enabled: true, description: 'In-store compliance monitoring and planogram adherence' },
      { name: 'Deduction Management', enabled: false, description: 'Retailer deduction dispute and recovery automation' },
      { name: 'Price Waterfall', enabled: true, description: 'Full price waterfall analysis from list to pocket price' },
    ],
  },
  {
    name: 'Distributor Management Catalyst', domain: 'fmcg-distributor',
    description: 'Distributor performance tracking, inventory visibility, and route-to-market',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Distributor Scorecarding', enabled: true, description: 'Multi-dimensional distributor performance rating' },
      { name: 'Inventory Visibility', enabled: true, description: 'Real-time distributor stock levels and days-of-stock tracking' },
      { name: 'Route-to-Market', enabled: true, description: 'Distribution channel optimization and cost-to-serve analysis' },
      { name: 'Secondary Sales Tracking', enabled: false, description: 'Distributor-to-retailer sales data capture and analytics' },
    ],
  },
  {
    name: 'Product Launch Catalyst', domain: 'fmcg-launch',
    description: 'New product introduction, market testing, and launch tracking',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Stage-Gate Tracking', enabled: true, description: 'NPD stage-gate process management and milestone tracking' },
      { name: 'Test Market Analysis', enabled: true, description: 'Regional test market performance monitoring' },
      { name: 'Launch Execution', enabled: true, description: 'Cross-functional launch readiness checklist and coordination' },
      { name: 'Cannibalization Analysis', enabled: false, description: 'Portfolio impact assessment of new product launches' },
    ],
  },
  {
    name: 'Shelf Intelligence Catalyst', domain: 'fmcg-shelf',
    description: 'Share of shelf tracking, planogram compliance, and competitive intelligence',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Share of Shelf', enabled: true, description: 'Shelf space measurement and share tracking by retailer' },
      { name: 'Planogram Compliance', enabled: true, description: 'In-store planogram adherence monitoring using image recognition' },
      { name: 'Competitive Intelligence', enabled: false, description: 'Competitor pricing, promotion, and product launch tracking' },
      { name: 'Out-of-Stock Detection', enabled: true, description: 'Real-time OOS detection and root cause analysis' },
    ],
  },
  {
    name: 'Finance Catalyst', domain: 'finance',
    description: 'Revenue management, cost optimization, and financial reporting',
    autonomy_tier: 'transactional',
    sub_catalysts: [
      { name: 'Revenue Management', enabled: true, description: 'Revenue recognition and category profitability analysis' },
      { name: 'Cost of Goods Sold', enabled: true, description: 'COGS tracking, material cost variance, and margin analysis' },
      { name: 'Accounts Receivable', enabled: true, description: 'Debtor management and collection optimization' },
      { name: 'Trade Spend Accounting', enabled: true, description: 'Accrual management and trade promotion accounting' },
      { name: 'Transfer Pricing', enabled: false, description: 'Intercompany transfer pricing compliance and documentation' },
    ],
  },
  {
    name: 'Supply Chain Catalyst', domain: 'supply-chain',
    description: 'Demand planning, production scheduling, and warehouse management',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Demand Planning', enabled: true, description: 'Statistical and promotional demand forecasting' },
      { name: 'Production Scheduling', enabled: true, description: 'Factory production plan optimization' },
      { name: 'Warehouse Management', enabled: true, description: 'DC inventory optimization and order fulfillment' },
      { name: 'Transportation', enabled: false, description: 'Route optimization and carrier management' },
      { name: 'S&OP Coordination', enabled: true, description: 'Sales and operations planning process automation' },
    ],
  },
  {
    name: 'Workforce Catalyst', domain: 'hr',
    description: 'Sales force management, merchandiser scheduling, and training',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Sales Force Effectiveness', enabled: true, description: 'Sales rep productivity and territory coverage analysis' },
      { name: 'Merchandiser Scheduling', enabled: true, description: 'Store visit scheduling and route optimization for merchandisers' },
      { name: 'Training Management', enabled: true, description: 'Product knowledge and selling skills training completion tracking' },
      { name: 'Incentive Calculation', enabled: false, description: 'Commission and bonus calculation automation' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// GENERAL (cross-industry baseline)
// ═══════════════════════════════════════════════════════════════════════════
const generalClusters: CatalystTemplate[] = [
  {
    name: 'Finance Catalyst', domain: 'finance',
    description: 'Accounts payable, receivable, reconciliation, and reporting',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Accounts Payable', enabled: true, description: 'Invoice processing and payment scheduling automation' },
      { name: 'Accounts Receivable', enabled: true, description: 'Invoicing and collections management' },
      { name: 'Reconciliation', enabled: true, description: 'Bank and account reconciliation automation' },
      { name: 'Financial Reporting', enabled: false, description: 'Automated financial statement generation' },
      { name: 'Budget Management', enabled: true, description: 'Budget tracking and variance reporting' },
    ],
  },
  {
    name: 'Procurement Catalyst', domain: 'procurement',
    description: 'Supplier management, purchase orders, and spend analytics',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Supplier Management', enabled: true, description: 'Vendor performance tracking and relationship management' },
      { name: 'PO Automation', enabled: true, description: 'Purchase order creation and approval workflows' },
      { name: 'Spend Analytics', enabled: false, description: 'Category spend analysis and savings identification' },
      { name: 'Contract Management', enabled: true, description: 'Contract lifecycle management and compliance tracking' },
    ],
  },
  {
    name: 'Supply Chain Catalyst', domain: 'supply-chain',
    description: 'Inventory management, logistics, and demand forecasting',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Inventory Management', enabled: true, description: 'Stock level monitoring and reorder optimization' },
      { name: 'Logistics Tracking', enabled: true, description: 'Shipment tracking and delivery management' },
      { name: 'Demand Forecasting', enabled: false, description: 'Statistical demand prediction and planning' },
      { name: 'Warehouse Operations', enabled: true, description: 'Warehouse efficiency and pick/pack optimization' },
    ],
  },
  {
    name: 'HR & Workforce Catalyst', domain: 'hr',
    description: 'Employee management, scheduling, and compliance',
    autonomy_tier: 'read-only',
    sub_catalysts: [
      { name: 'Leave Management', enabled: true, description: 'Leave request processing and balance tracking' },
      { name: 'Scheduling', enabled: true, description: 'Employee shift scheduling and availability management' },
      { name: 'Compliance Training', enabled: true, description: 'Mandatory training completion tracking' },
      { name: 'Performance Reviews', enabled: false, description: 'Review cycle management and goal tracking' },
    ],
  },
  {
    name: 'Sales Catalyst', domain: 'sales',
    description: 'Customer management, pipeline tracking, and order processing',
    autonomy_tier: 'assisted',
    sub_catalysts: [
      { name: 'Pipeline Management', enabled: true, description: 'Sales pipeline tracking and forecasting' },
      { name: 'Order Processing', enabled: true, description: 'Customer order intake and fulfillment tracking' },
      { name: 'Customer Scoring', enabled: false, description: 'Customer value scoring and segmentation' },
      { name: 'Quote Management', enabled: true, description: 'Quotation generation and follow-up automation' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE REGISTRY
// ═══════════════════════════════════════════════════════════════════════════
export const INDUSTRY_TEMPLATES: IndustryTemplate[] = [
  {
    industry: 'mining',
    label: 'Mining & Steel',
    description: 'Equipment maintenance, safety compliance, ore processing, and environmental monitoring',
    clusters: miningClusters,
  },
  {
    industry: 'agriculture',
    label: 'Agriculture',
    description: 'Crop intelligence, irrigation, quality assurance, and market access',
    clusters: agricultureClusters,
  },
  {
    industry: 'healthcare',
    label: 'Healthcare',
    description: 'Patient flow, clinical compliance, medical billing, and staffing',
    clusters: healthcareClusters,
  },
  {
    industry: 'logistics',
    label: 'Logistics & Transport',
    description: 'Route optimization, fleet maintenance, driver management, and compliance',
    clusters: logisticsClusters,
  },
  {
    industry: 'technology',
    label: 'Technology & SaaS',
    description: 'DevOps, security, product analytics, customer success, and revenue ops',
    clusters: technologyClusters,
  },
  {
    industry: 'manufacturing',
    label: 'Manufacturing',
    description: 'Production optimization, quality control, maintenance, and energy management',
    clusters: manufacturingClusters,
  },
  {
    industry: 'financial_services',
    label: 'Financial Services',
    description: 'Risk management, regulatory compliance, customer intelligence, and operations',
    clusters: financialServicesClusters,
  },
  {
    industry: 'fmcg',
    label: 'FMCG',
    description: 'Trade promotion, distributor management, shelf intelligence, and product launch',
    clusters: fmcgClusters,
  },
  {
    industry: 'general',
    label: 'General',
    description: 'Cross-industry baseline catalysts for finance, procurement, supply chain, HR, and sales',
    clusters: generalClusters,
  },
];

export function getTemplateForIndustry(industry: string): IndustryTemplate | undefined {
  return INDUSTRY_TEMPLATES.find(t => t.industry === industry);
}
