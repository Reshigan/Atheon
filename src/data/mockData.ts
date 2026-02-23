import type {
  BusinessHealthScore, ExecutiveBriefing, RiskAlert, Scenario,
  ProcessMetric, Anomaly, ProcessFlow, CorrelationEvent,
  CatalystCluster, CatalystAction, ChatThread, MCPServer, AuditEntry,
} from '@/types';

export const businessHealthScore: BusinessHealthScore = {
  overall: 78,
  trend: 'up',
  dimensions: [
    { name: 'Financial Health', key: 'finance', score: 82, weight: 0.25, trend: 'up', change: 3.2, sparkline: [70, 72, 74, 76, 78, 80, 82] },
    { name: 'Operational Efficiency', key: 'operations', score: 75, weight: 0.20, trend: 'stable', change: 0.5, sparkline: [73, 74, 75, 74, 75, 75, 75] },
    { name: 'Risk Exposure', key: 'risk', score: 68, weight: 0.20, trend: 'down', change: -2.1, sparkline: [74, 73, 72, 71, 70, 69, 68] },
    { name: 'Talent Stability', key: 'people', score: 85, weight: 0.15, trend: 'up', change: 1.8, sparkline: [80, 81, 82, 83, 83, 84, 85] },
    { name: 'Market Position', key: 'market', score: 79, weight: 0.10, trend: 'up', change: 2.5, sparkline: [72, 73, 75, 76, 77, 78, 79] },
    { name: 'Safety Index', key: 'safety', score: 91, weight: 0.05, trend: 'up', change: 1.0, sparkline: [87, 88, 89, 89, 90, 90, 91] },
    { name: 'Quality Score', key: 'quality', score: 73, weight: 0.03, trend: 'stable', change: 0.2, sparkline: [72, 73, 73, 72, 73, 73, 73] },
    { name: 'Environmental', key: 'environment', score: 88, weight: 0.02, trend: 'up', change: 1.5, sparkline: [84, 85, 86, 86, 87, 87, 88] },
  ],
  updatedAt: new Date().toISOString(),
};

export const executiveBriefing: ExecutiveBriefing = {
  id: 'brief-001',
  date: new Date().toISOString(),
  topRisks: [
    { id: 'r1', title: 'Supply chain disruption in Eastern Cape', description: 'Port congestion at Durban expected to delay Q1 shipments by 5-7 days.', severity: 'high', source: 'pulse', confidence: 0.87 },
    { id: 'r2', title: 'Currency exposure exceeding hedge cover', description: 'ZAR/USD volatility increased 23%. Hedge cover only extends to March.', severity: 'critical', source: 'catalysts', confidence: 0.92 },
    { id: 'r3', title: 'Talent attrition in engineering division', description: '3 senior engineers resigned in 2 weeks. Automation team at critical threshold.', severity: 'medium', source: 'catalysts', confidence: 0.78 },
  ],
  topOpportunities: [
    { id: 'o1', title: 'Cross-sell opportunity in healthcare vertical', description: '12 accounts with high upsell propensity. Estimated revenue uplift: R2.4M.', severity: 'high', source: 'apex', confidence: 0.85 },
    { id: 'o2', title: 'Process automation savings identified', description: 'Invoice processing automation could save 340 hours/month. ROI in 4 months.', severity: 'medium', source: 'pulse', confidence: 0.91 },
    { id: 'o3', title: 'Supplier consolidation opportunity', description: '23% overlap in vendors. Consolidation could save R890K annually.', severity: 'medium', source: 'catalysts', confidence: 0.88 },
  ],
  anomalies: [
    { id: 'a1', title: 'Unusual spike in return rates - Western Cape', description: 'Returns up 340% vs baseline in 48 hours. Possible quality issue Batch WC-2024-0892.', severity: 'high', source: 'pulse', confidence: 0.94 },
  ],
  kpiMovements: [
    { kpi: 'Revenue', value: 42.8, previousValue: 41.2, change: 3.9, unit: 'M ZAR', trend: 'up' },
    { kpi: 'OTIF', value: 94.2, previousValue: 95.1, change: -0.9, unit: '%', trend: 'down' },
    { kpi: 'Cash Position', value: 18.5, previousValue: 17.8, change: 3.9, unit: 'M ZAR', trend: 'up' },
    { kpi: 'Employee NPS', value: 72, previousValue: 70, change: 2.9, unit: '', trend: 'up' },
    { kpi: 'Customer Churn', value: 2.1, previousValue: 2.3, change: -8.7, unit: '%', trend: 'up' },
    { kpi: 'Gross Margin', value: 34.5, previousValue: 33.8, change: 2.1, unit: '%', trend: 'up' },
  ],
  requiredDecisions: [
    { id: 'd1', title: 'Approve emergency stock reorder for Gauteng DC', description: 'Safety stock breach detected. Recommended reorder of 15,000 units.', deadline: '2026-02-24T17:00:00Z', options: [{ id: 'o1', label: 'Approve full reorder', impact: 'Restores stock in 3 days, cost R1.2M', confidence: 0.92 }, { id: 'o2', label: 'Partial reorder (8,000 units)', impact: 'Restores critical SKUs in 2 days, cost R650K', confidence: 0.85 }], recommendedOption: 'o1' },
  ],
  narrative: 'Overall business health improved 2.3 points to 78, driven by strong financial performance and talent stability. Key concern: risk exposure deteriorated due to supply chain disruptions and currency volatility. Immediate attention needed on Durban port situation and Q2 hedge coverage gap.',
};

export const riskAlerts: RiskAlert[] = [
  { id: 'risk-001', title: 'Durban Port Congestion Impact', description: 'Container dwell times increased 45% over 7 days. 87% probability of supply chain disruption within 14 days.', severity: 'critical', probability: 0.87, impact: 0.9, detectedAt: '2026-02-22T08:30:00Z', predictedDate: '2026-03-08T00:00:00Z', category: 'Supply Chain', recommendedActions: ['Activate alternative routing via Cape Town port', 'Pre-position safety stock at Gauteng DC', 'Notify top 10 customers of potential delays'], status: 'active', confidence: 0.87 },
  { id: 'risk-002', title: 'FX Hedge Gap - Q2 Exposure', description: 'Hedge cover expires March 31. Unhedged USD exposure of $4.2M for Q2.', severity: 'high', probability: 0.75, impact: 0.7, detectedAt: '2026-02-20T14:00:00Z', predictedDate: '2026-04-01T00:00:00Z', category: 'Financial', recommendedActions: ['Extend forward contracts to June', 'Evaluate natural hedging options', 'Review pricing for USD products'], status: 'active', confidence: 0.92 },
  { id: 'risk-003', title: 'Batch Quality Anomaly - WC-2024-0892', description: 'Return rate 340% above baseline. 12 complaints in 48 hours.', severity: 'high', probability: 0.92, impact: 0.6, detectedAt: '2026-02-23T06:00:00Z', predictedDate: '2026-02-25T00:00:00Z', category: 'Quality', recommendedActions: ['Initiate recall investigation', 'Isolate remaining batch', 'Deploy quality team to WC facility'], status: 'active', confidence: 0.94 },
  { id: 'risk-004', title: 'Engineering Skills Gap Critical', description: '3 senior engineers resigned. Automation project at risk of 6-week delay.', severity: 'medium', probability: 0.65, impact: 0.5, detectedAt: '2026-02-21T10:00:00Z', predictedDate: '2026-03-15T00:00:00Z', category: 'People', recommendedActions: ['Accelerate hiring', 'Engage contract resources', 'Implement retention package'], status: 'active', confidence: 0.78 },
  { id: 'risk-005', title: 'POPIA Compliance Audit', description: '3 data processing agreements pending renewal before audit in 6 weeks.', severity: 'medium', probability: 0.55, impact: 0.4, detectedAt: '2026-02-19T09:00:00Z', predictedDate: '2026-04-06T00:00:00Z', category: 'Compliance', recommendedActions: ['Expedite DPA renewals', 'Complete data mapping', 'Schedule mock audit'], status: 'active', confidence: 0.85 },
];

export const scenarios: Scenario[] = [
  { id: 'scen-001', name: 'Delay Limpopo Expansion by 6 Months', description: 'Evaluate impact of postponing Limpopo facility expansion.', variables: [{ name: 'Capital Expenditure', baseValue: 45, adjustedValue: 0, unit: 'M ZAR' }, { name: 'Revenue Impact', baseValue: 12, adjustedValue: 8, unit: 'M ZAR' }, { name: 'Headcount Delay', baseValue: 120, adjustedValue: 0, unit: 'FTE' }], results: { revenue: -4.2, cost: -38.5, profit: 34.3, risk: 15, probability: 0.72, timeline: [{ month: 'Mar', value: 0 }, { month: 'Apr', value: -0.5 }, { month: 'May', value: -1.2 }, { month: 'Jun', value: -1.8 }, { month: 'Jul', value: -2.5 }, { month: 'Aug', value: -3.2 }, { month: 'Sep', value: -4.2 }] }, createdAt: '2026-02-22T10:00:00Z', status: 'completed' },
  { id: 'scen-002', name: 'Accelerate Digital Transformation', description: 'Double investment in automation and AI capabilities.', variables: [{ name: 'Additional Investment', baseValue: 0, adjustedValue: 15, unit: 'M ZAR' }, { name: 'FTE Reallocation', baseValue: 0, adjustedValue: 25, unit: 'FTE' }], results: { revenue: 8.5, cost: 15, profit: -6.5, risk: -20, probability: 0.68, timeline: [{ month: 'Mar', value: -5 }, { month: 'Apr', value: -3 }, { month: 'May', value: -1 }, { month: 'Jun', value: 1 }, { month: 'Jul', value: 4 }, { month: 'Aug', value: 7 }, { month: 'Sep', value: 8.5 }] }, createdAt: '2026-02-21T14:00:00Z', status: 'completed' },
];

export const processMetrics: ProcessMetric[] = [
  { id: 'pm-001', name: 'Invoice Processing Time', value: 4.2, unit: 'hours', threshold: { green: 6, amber: 8, red: 12 }, trend: [6.5, 6.1, 5.8, 5.4, 5.0, 4.6, 4.2], status: 'green', lastUpdated: new Date().toISOString() },
  { id: 'pm-002', name: 'Order Fulfilment OTIF', value: 94.2, unit: '%', threshold: { green: 95, amber: 90, red: 85 }, trend: [96.1, 95.8, 95.5, 95.2, 94.8, 94.5, 94.2], status: 'amber', lastUpdated: new Date().toISOString() },
  { id: 'pm-003', name: 'PO Cycle Time', value: 2.1, unit: 'days', threshold: { green: 3, amber: 5, red: 7 }, trend: [3.2, 3.0, 2.8, 2.6, 2.4, 2.2, 2.1], status: 'green', lastUpdated: new Date().toISOString() },
  { id: 'pm-004', name: 'Cash Conversion Cycle', value: 45, unit: 'days', threshold: { green: 40, amber: 50, red: 60 }, trend: [52, 50, 48, 47, 46, 46, 45], status: 'amber', lastUpdated: new Date().toISOString() },
  { id: 'pm-005', name: 'First Call Resolution', value: 87, unit: '%', threshold: { green: 85, amber: 75, red: 65 }, trend: [80, 82, 83, 84, 85, 86, 87], status: 'green', lastUpdated: new Date().toISOString() },
  { id: 'pm-006', name: 'Recruitment Time-to-Fill', value: 38, unit: 'days', threshold: { green: 30, amber: 45, red: 60 }, trend: [42, 41, 40, 39, 39, 38, 38], status: 'amber', lastUpdated: new Date().toISOString() },
  { id: 'pm-007', name: 'Catalyst Throughput', value: 1247, unit: 'tasks/hr', threshold: { green: 1000, amber: 750, red: 500 }, trend: [980, 1020, 1080, 1120, 1180, 1210, 1247], status: 'green', lastUpdated: new Date().toISOString() },
  { id: 'pm-008', name: 'System Availability', value: 99.97, unit: '%', threshold: { green: 99.9, amber: 99.5, red: 99 }, trend: [99.95, 99.96, 99.97, 99.96, 99.97, 99.97, 99.97], status: 'green', lastUpdated: new Date().toISOString() },
];

export const anomalies: Anomaly[] = [
  { id: 'anom-001', metric: 'Product Returns - Western Cape', expectedValue: 2.1, actualValue: 9.3, deviation: 342, severity: 'critical', detectedAt: '2026-02-23T06:15:00Z', hypothesis: 'Quality defect in Batch WC-2024-0892. Correlated with production run on Feb 18.' },
  { id: 'anom-002', metric: 'AP Invoice Volume', expectedValue: 450, actualValue: 680, deviation: 51, severity: 'medium', detectedAt: '2026-02-23T09:00:00Z', hypothesis: 'Month-end accrual batch triggered early. Volume higher than historical.' },
  { id: 'anom-003', metric: 'Login Failures - SAP', expectedValue: 12, actualValue: 89, deviation: 641, severity: 'high', detectedAt: '2026-02-23T11:30:00Z', hypothesis: 'Credential rotation issue after maintenance. Correlates with AD sync failure.' },
];

export const processFlows: ProcessFlow[] = [
  { id: 'pf-001', name: 'Procure-to-Pay', steps: [{ id: 's1', name: 'Requisition', avgDuration: 0.5, throughput: 150, status: 'healthy' }, { id: 's2', name: 'Approval', avgDuration: 1.2, throughput: 142, status: 'healthy' }, { id: 's3', name: 'PO Creation', avgDuration: 0.3, throughput: 140, status: 'healthy' }, { id: 's4', name: 'Goods Receipt', avgDuration: 3.5, throughput: 135, status: 'bottleneck' }, { id: 's5', name: 'Invoice Match', avgDuration: 0.8, throughput: 130, status: 'healthy' }, { id: 's6', name: 'Payment', avgDuration: 2.0, throughput: 128, status: 'healthy' }], variants: 14, conformanceRate: 78, avgDuration: 8.3, bottlenecks: ['Goods Receipt - 3.5 day average delay'] },
  { id: 'pf-002', name: 'Order-to-Cash', steps: [{ id: 's1', name: 'Order Entry', avgDuration: 0.2, throughput: 200, status: 'healthy' }, { id: 's2', name: 'Credit Check', avgDuration: 0.5, throughput: 195, status: 'healthy' }, { id: 's3', name: 'Fulfilment', avgDuration: 2.1, throughput: 190, status: 'degraded' }, { id: 's4', name: 'Shipping', avgDuration: 1.8, throughput: 185, status: 'healthy' }, { id: 's5', name: 'Invoicing', avgDuration: 0.3, throughput: 183, status: 'healthy' }, { id: 's6', name: 'Collection', avgDuration: 28, throughput: 178, status: 'bottleneck' }], variants: 8, conformanceRate: 85, avgDuration: 32.9, bottlenecks: ['Collection - 28 day average'] },
];

export const correlationEvents: CorrelationEvent[] = [
  { id: 'ce-001', sourceSystem: 'Supply Chain', targetSystem: 'Sales', sourceEvent: 'Durban port delay (Feb 15)', targetImpact: 'OTIF drop 0.9% (Feb 20)', lag: 5, confidence: 0.89, detectedAt: '2026-02-22T08:00:00Z' },
  { id: 'ce-002', sourceSystem: 'HR', targetSystem: 'Operations', sourceEvent: 'Engineering resignations (Feb 10-21)', targetImpact: 'Automation project velocity -35%', lag: 7, confidence: 0.82, detectedAt: '2026-02-23T10:00:00Z' },
  { id: 'ce-003', sourceSystem: 'Finance', targetSystem: 'Procurement', sourceEvent: 'Q1 budget freeze (Feb 5)', targetImpact: 'PO approval backlog +45%', lag: 10, confidence: 0.91, detectedAt: '2026-02-22T14:00:00Z' },
];

export const catalystClusters: CatalystCluster[] = [
  { id: 'cc-001', name: 'Finance Catalyst', type: 'finance', description: 'Invoice processing, payment runs, month-end close, intercompany reconciliation, budget variance', autonomyTier: 'transactional', trustScore: 94, activeAgents: 8, tasksCompleted: 12450, tasksInProgress: 23, accuracy: 98.2, status: 'active' },
  { id: 'cc-002', name: 'Procurement Catalyst', type: 'procurement', description: 'PR-to-PO automation, supplier monitoring, contract lifecycle, spend analytics', autonomyTier: 'assisted', trustScore: 89, activeAgents: 5, tasksCompleted: 8320, tasksInProgress: 15, accuracy: 96.8, status: 'active' },
  { id: 'cc-003', name: 'Supply Chain Catalyst', type: 'supply-chain', description: 'Demand sensing, inventory optimisation, order fulfilment, logistics', autonomyTier: 'assisted', trustScore: 87, activeAgents: 6, tasksCompleted: 6780, tasksInProgress: 31, accuracy: 95.4, status: 'active' },
  { id: 'cc-004', name: 'HR / People Catalyst', type: 'hr', description: 'Workforce planning, leave management, employee queries, recruitment', autonomyTier: 'read-only', trustScore: 91, activeAgents: 4, tasksCompleted: 4560, tasksInProgress: 8, accuracy: 97.1, status: 'active' },
  { id: 'cc-005', name: 'Sales / CRM Catalyst', type: 'sales', description: 'Pipeline management, customer health, quote-to-cash, territory performance', autonomyTier: 'assisted', trustScore: 86, activeAgents: 5, tasksCompleted: 5890, tasksInProgress: 19, accuracy: 94.6, status: 'active' },
  { id: 'cc-006', name: 'Trade Promotion (FMCG)', type: 'fmcg-trade', description: 'Plan, execute, measure, optimise trade promotions with ROI tracking', autonomyTier: 'assisted', trustScore: 83, activeAgents: 3, tasksCompleted: 2340, tasksInProgress: 7, accuracy: 92.8, status: 'active', industry: 'fmcg' },
  { id: 'cc-007', name: 'Equipment Health (Mining)', type: 'mining-equipment', description: 'Predictive maintenance using vibration, temperature, operating data', autonomyTier: 'read-only', trustScore: 90, activeAgents: 4, tasksCompleted: 3120, tasksInProgress: 12, accuracy: 96.3, status: 'active', industry: 'mining' },
  { id: 'cc-008', name: 'Patient Flow (Healthcare)', type: 'health-patient', description: 'Bed management, ADT optimisation, ED boarding alerts', autonomyTier: 'assisted', trustScore: 88, activeAgents: 3, tasksCompleted: 1890, tasksInProgress: 5, accuracy: 95.7, status: 'active', industry: 'healthcare' },
];

export const catalystActions: CatalystAction[] = [
  { id: 'ca-001', clusterId: 'cc-001', clusterName: 'Finance Catalyst', action: 'Invoice Processing', description: 'Auto-matched 47 invoices to POs with 3-way match. 3 exceptions parked.', status: 'completed', confidence: 0.96, autonomyTier: 'transactional', requestedAt: '2026-02-23T08:00:00Z', completedAt: '2026-02-23T08:12:00Z', reasoning: 'All 47 invoices matched within 2% tolerance. 3 exceeded and parked per policy.', dataSources: ['SAP S/4HANA - FI', 'SAP S/4HANA - MM'], lobCalls: ['BAPI_INCOMINGINVOICE_CREATE', 'BAPI_ACC_DOCUMENT_POST'] },
  { id: 'ca-002', clusterId: 'cc-003', clusterName: 'Supply Chain Catalyst', action: 'Safety Stock Reorder', description: 'Safety stock breach for 3 SKUs at Gauteng DC. Proposing 15,000 unit reorder.', status: 'pending', confidence: 0.92, autonomyTier: 'transactional', requestedAt: '2026-02-23T10:30:00Z', reasoning: 'Current: 2,100 units. Threshold: 5,000. Stockout predicted in 4 days.', dataSources: ['SAP S/4HANA - MM', 'Demand Sensing Model'], lobCalls: ['BAPI_PO_CREATE'] },
  { id: 'ca-003', clusterId: 'cc-002', clusterName: 'Procurement Catalyst', action: 'Contract Renewal Alert', description: '5 supplier contracts expiring in 60 days. Draft renewal terms prepared.', status: 'approved', confidence: 0.88, autonomyTier: 'assisted', requestedAt: '2026-02-23T07:00:00Z', approvedBy: 'Sarah Chen', reasoning: 'Analysed spend data, supplier scores, and market benchmarks.', dataSources: ['SAP S/4HANA - MM', 'Supplier Scorecard DB'], lobCalls: ['ME31K - Outline Agreement'] },
  { id: 'ca-004', clusterId: 'cc-005', clusterName: 'Sales / CRM Catalyst', action: 'Pipeline Risk Alert', description: '3 high-value opportunities with declining engagement. Next-best-actions generated.', status: 'completed', confidence: 0.85, autonomyTier: 'read-only', requestedAt: '2026-02-23T09:00:00Z', completedAt: '2026-02-23T09:05:00Z', reasoning: 'Email response rates -40% in 2 weeks. Pattern preceded 78% of lost deals.', dataSources: ['Salesforce CRM', 'Email Analytics'], lobCalls: ['Salesforce REST API'] },
];

export const chatThreads: ChatThread[] = [
  {
    id: 'thread-001',
    title: 'Supply Chain Risk Analysis',
    messages: [
      { id: 'm1', role: 'user', content: 'Why is OTIF declining?', timestamp: '2026-02-23T10:00:00Z' },
      { id: 'm2', role: 'assistant', content: 'Based on my analysis across Pulse telemetry and Supply Chain Catalyst data, OTIF has declined 0.9pp over 7 days.\n\n**Primary Cause: Durban Port Congestion**\nContainer dwell times up 45% since Feb 15, causing cascading delays affecting 23% of Gauteng DC inbound.\n\n**Secondary Cause: Goods Receipt Bottleneck**\nProcure-to-Pay process mining shows GR averaging 3.5 days (40% above target).\n\n**Temporal Correlation:**\n- Feb 15: Durban port delay begins\n- Feb 18: Delays hit Gauteng DC\n- Feb 20: OTIF drops 95.1% to 94.2%\n\nSupply Chain Catalyst has proposed emergency safety stock reorder (awaiting approval).', layer: 'pulse', citations: [{ id: 'c1', source: 'Pulse - Cross-LOB Correlation Engine', text: 'Durban port congestion to OTIF decline (89% confidence)', confidence: 0.89, retrievedAt: '2026-02-23T10:00:05Z' }], timestamp: '2026-02-23T10:00:05Z' },
    ],
    layer: 'pulse',
    createdAt: '2026-02-23T10:00:00Z',
    updatedAt: '2026-02-23T10:00:05Z',
    bookmarked: true,
  },
];

export const mcpServers: MCPServer[] = [
  { id: 'mcp-001', name: 'SAP S/4HANA', system: 'SAP', status: 'connected', tools: [{ name: 'read_invoice', description: 'Read invoice details from FI module', inputSchema: {}, permissions: ['fi.read'] }, { name: 'create_po', description: 'Create purchase order in MM module', inputSchema: {}, permissions: ['mm.write'] }, { name: 'read_stock', description: 'Read material stock levels', inputSchema: {}, permissions: ['mm.read'] }], lastHeartbeat: new Date().toISOString() },
  { id: 'mcp-002', name: 'Salesforce CRM', system: 'Salesforce', status: 'connected', tools: [{ name: 'read_opportunity', description: 'Read opportunity details', inputSchema: {}, permissions: ['crm.read'] }, { name: 'update_opportunity', description: 'Update opportunity stage/value', inputSchema: {}, permissions: ['crm.write'] }], lastHeartbeat: new Date().toISOString() },
  { id: 'mcp-003', name: 'Workday HCM', system: 'Workday', status: 'connected', tools: [{ name: 'read_employee', description: 'Read employee profile', inputSchema: {}, permissions: ['hr.read'] }, { name: 'read_absence', description: 'Read absence records', inputSchema: {}, permissions: ['hr.read'] }], lastHeartbeat: new Date().toISOString() },
  { id: 'mcp-004', name: 'ServiceNow ITSM', system: 'ServiceNow', status: 'disconnected', tools: [{ name: 'create_incident', description: 'Create IT incident', inputSchema: {}, permissions: ['it.write'] }], lastHeartbeat: '2026-02-23T08:00:00Z' },
];

export const auditEntries: AuditEntry[] = [
  { id: 'audit-001', timestamp: '2026-02-23T12:00:00Z', userId: '1', action: 'Invoice batch processed (47 items)', layer: 'catalysts', details: { cluster: 'Finance', matched: 44, parked: 3 }, outcome: 'success' },
  { id: 'audit-002', timestamp: '2026-02-23T11:30:00Z', userId: '1', action: 'Risk alert generated - Durban Port', layer: 'apex', details: { severity: 'critical', confidence: 0.87 }, outcome: 'success' },
  { id: 'audit-003', timestamp: '2026-02-23T10:30:00Z', userId: '1', action: 'Safety stock reorder proposed', layer: 'catalysts', details: { cluster: 'Supply Chain', units: 15000 }, outcome: 'pending' },
  { id: 'audit-004', timestamp: '2026-02-23T09:00:00Z', userId: '1', action: 'Contract renewal terms drafted', layer: 'catalysts', details: { cluster: 'Procurement', contracts: 5 }, outcome: 'success' },
  { id: 'audit-005', timestamp: '2026-02-23T08:00:00Z', userId: '1', action: 'Executive briefing generated', layer: 'apex', details: { type: 'daily' }, outcome: 'success' },
];
