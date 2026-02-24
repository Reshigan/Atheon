/**
 * MCP (Model Context Protocol) + A2A (Agent-to-Agent) Service
 * Implements MCP server for tool/resource exposure and A2A for agent discovery/communication
 */

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, context: MCPContext) => Promise<MCPToolResult>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface MCPToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

export interface MCPContext {
  tenantId: string;
  userId?: string;
  db: D1Database;
  ai: Ai;
}

export interface A2AAgentCard {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  endpoint: string;
  protocol: string;
  status: 'online' | 'offline' | 'degraded';
  lastSeen: string;
}

export interface A2AMessage {
  id: string;
  from: string;
  to: string;
  type: 'request' | 'response' | 'notification';
  method: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  timestamp: string;
}

// ── MCP Tool Registry ──

const mcpTools: MCPTool[] = [
  {
    name: 'query_knowledge_graph',
    description: 'Search the Atheon knowledge graph for entities and relationships',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        entity_type: { type: 'string', description: 'Filter by entity type' },
        limit: { type: 'number', description: 'Max results', default: 10 },
      },
      required: ['query'],
    },
    async handler(args, context) {
      const query = (args.query as string).toLowerCase();
      const entityType = args.entity_type as string | undefined;
      const limit = (args.limit as number) || 10;

      let sql = 'SELECT * FROM graph_entities WHERE tenant_id = ? AND (LOWER(name) LIKE ? OR LOWER(type) LIKE ?)';
      const binds: unknown[] = [context.tenantId, `%${query}%`, `%${query}%`];
      if (entityType) { sql += ' AND type = ?'; binds.push(entityType); }
      sql += ` LIMIT ${limit}`;

      const results = await context.db.prepare(sql).bind(...binds).all();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            entities: results.results.map((e: Record<string, unknown>) => ({
              id: e.id, type: e.type, name: e.name,
              properties: JSON.parse(e.properties as string || '{}'),
              confidence: e.confidence,
            })),
            total: results.results.length,
          }),
        }],
      };
    },
  },
  {
    name: 'get_health_score',
    description: 'Get the current enterprise health score for a tenant',
    inputSchema: {
      type: 'object',
      properties: {
        tenant_id: { type: 'string', description: 'Tenant identifier' },
      },
    },
    async handler(args, context) {
      const tenantId = (args.tenant_id as string) || context.tenantId;
      const health = await context.db.prepare(
        'SELECT * FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
      ).bind(tenantId).first();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(health ? {
            score: health.overall_score,
            dimensions: JSON.parse(health.dimensions as string || '{}'),
            calculatedAt: health.calculated_at,
          } : { score: null, message: 'No health score available' }),
        }],
      };
    },
  },
  {
    name: 'list_risk_alerts',
    description: 'Get active risk alerts for the enterprise',
    inputSchema: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        limit: { type: 'number', default: 10 },
      },
    },
    async handler(args, context) {
      let sql = 'SELECT * FROM risk_alerts WHERE tenant_id = ? AND status = ?';
      const binds: unknown[] = [context.tenantId, 'active'];
      if (args.severity) { sql += ' AND severity = ?'; binds.push(args.severity); }
      sql += ` ORDER BY detected_at DESC LIMIT ${(args.limit as number) || 10}`;

      const results = await context.db.prepare(sql).bind(...binds).all();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            alerts: results.results.map((r: Record<string, unknown>) => ({
              id: r.id, title: r.title, severity: r.severity,
              category: r.category, probability: r.probability,
              impactValue: r.impact_value, detectedAt: r.detected_at,
            })),
          }),
        }],
      };
    },
  },
  {
    name: 'execute_catalyst_action',
    description: 'Submit an action for a Catalyst agent to execute',
    inputSchema: {
      type: 'object',
      properties: {
        cluster_id: { type: 'string', description: 'Target cluster ID' },
        catalyst_name: { type: 'string', description: 'Name of the catalyst' },
        action: { type: 'string', description: 'Action to perform' },
        input_data: { type: 'object', description: 'Input parameters' },
      },
      required: ['cluster_id', 'catalyst_name', 'action'],
    },
    async handler(args, context) {
      const actionId = crypto.randomUUID();
      await context.db.prepare(
        'INSERT INTO catalyst_actions (id, cluster_id, tenant_id, catalyst_name, action, status, confidence, input_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        actionId, args.cluster_id, context.tenantId,
        args.catalyst_name, args.action, 'pending', 0.85,
        args.input_data ? JSON.stringify(args.input_data) : null,
      ).run();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ actionId, status: 'pending', message: 'Action submitted for execution' }),
        }],
      };
    },
  },
  {
    name: 'query_process_metrics',
    description: 'Get process intelligence metrics and anomalies',
    inputSchema: {
      type: 'object',
      properties: {
        metric_name: { type: 'string', description: 'Filter by metric name' },
        status: { type: 'string', enum: ['green', 'amber', 'red'] },
      },
    },
    async handler(args, context) {
      let sql = 'SELECT * FROM process_metrics WHERE tenant_id = ?';
      const binds: unknown[] = [context.tenantId];
      if (args.metric_name) { sql += ' AND LOWER(name) LIKE ?'; binds.push(`%${(args.metric_name as string).toLowerCase()}%`); }
      if (args.status) { sql += ' AND status = ?'; binds.push(args.status); }
      sql += ' ORDER BY measured_at DESC LIMIT 20';

      const results = await context.db.prepare(sql).bind(...binds).all();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            metrics: results.results.map((m: Record<string, unknown>) => ({
              name: m.name, value: m.value, unit: m.unit, status: m.status,
              sourceSystem: m.source_system, measuredAt: m.measured_at,
            })),
          }),
        }],
      };
    },
  },
  {
    name: 'ai_query',
    description: 'Ask Atheon Mind a question using Workers AI',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The question to ask' },
        tier: { type: 'string', enum: ['tier-1', 'tier-2', 'tier-3'], default: 'tier-1' },
      },
      required: ['query'],
    },
    async handler(args, context) {
      const tierModels: Record<string, string> = {
        'tier-1': '@cf/meta/llama-3.1-8b-instruct',
        'tier-2': '@cf/meta/llama-3.1-70b-instruct',
        'tier-3': '@cf/meta/llama-3.1-70b-instruct',
      };
      const model = tierModels[(args.tier as string) || 'tier-1'];
      try {
        const result = await context.ai.run(model as Parameters<Ai['run']>[0], {
          messages: [
            { role: 'system', content: 'You are Atheon Mind, an enterprise intelligence AI. Provide concise, data-driven answers.' },
            { role: 'user', content: args.query as string },
          ],
          max_tokens: 1024,
        });
        const aiResult = result as { response?: string };
        return { content: [{ type: 'text', text: aiResult.response || 'No response generated.' }] };
      } catch {
        return { content: [{ type: 'text', text: 'AI service temporarily unavailable.' }], isError: true };
      }
    },
  },
];

// ── MCP Resource Registry ──

export function getMCPResources(tenantId: string): MCPResource[] {
  return [
    { uri: `atheon://${tenantId}/health`, name: 'Enterprise Health Score', description: 'Current enterprise health metrics', mimeType: 'application/json' },
    { uri: `atheon://${tenantId}/risks`, name: 'Risk Alerts', description: 'Active risk alerts and mitigations', mimeType: 'application/json' },
    { uri: `atheon://${tenantId}/catalysts`, name: 'Catalyst Clusters', description: 'Autonomous agent cluster status', mimeType: 'application/json' },
    { uri: `atheon://${tenantId}/graph`, name: 'Knowledge Graph', description: 'Entity and relationship data', mimeType: 'application/json' },
    { uri: `atheon://${tenantId}/metrics`, name: 'Process Metrics', description: 'Real-time process intelligence metrics', mimeType: 'application/json' },
    { uri: `atheon://${tenantId}/briefings`, name: 'Executive Briefings', description: 'AI-generated executive briefings', mimeType: 'application/json' },
  ];
}

// ── MCP Server Methods ──

export function handleMCPListTools(): { tools: { name: string; description: string; inputSchema: Record<string, unknown> }[] } {
  return {
    tools: mcpTools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
}

export function handleMCPListResources(tenantId: string): { resources: MCPResource[] } {
  return { resources: getMCPResources(tenantId) };
}

export async function handleMCPCallTool(
  toolName: string,
  args: Record<string, unknown>,
  context: MCPContext,
): Promise<MCPToolResult> {
  const tool = mcpTools.find(t => t.name === toolName);
  if (!tool) {
    return { content: [{ type: 'text', text: `Tool not found: ${toolName}` }], isError: true };
  }
  return tool.handler(args, context);
}

export async function handleMCPReadResource(
  uri: string,
  context: MCPContext,
): Promise<{ contents: { uri: string; mimeType: string; text: string }[] }> {
  const parts = uri.replace('atheon://', '').split('/');
  const resourceType = parts[1];

  let data: unknown = null;
  switch (resourceType) {
    case 'health': {
      const h = await context.db.prepare('SELECT * FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1').bind(context.tenantId).first();
      data = h ? { score: h.overall_score, dimensions: JSON.parse(h.dimensions as string || '{}') } : null;
      break;
    }
    case 'risks': {
      const r = await context.db.prepare('SELECT * FROM risk_alerts WHERE tenant_id = ? AND status = ? LIMIT 20').bind(context.tenantId, 'active').all();
      data = r.results;
      break;
    }
    case 'catalysts': {
      const c = await context.db.prepare('SELECT * FROM catalyst_clusters WHERE tenant_id = ?').bind(context.tenantId).all();
      data = c.results;
      break;
    }
    case 'graph': {
      const e = await context.db.prepare('SELECT * FROM graph_entities WHERE tenant_id = ? LIMIT 100').bind(context.tenantId).all();
      data = e.results;
      break;
    }
    case 'metrics': {
      const m = await context.db.prepare('SELECT * FROM process_metrics WHERE tenant_id = ? ORDER BY measured_at DESC LIMIT 20').bind(context.tenantId).all();
      data = m.results;
      break;
    }
    case 'briefings': {
      const b = await context.db.prepare('SELECT * FROM executive_briefings WHERE tenant_id = ? ORDER BY generated_at DESC LIMIT 5').bind(context.tenantId).all();
      data = b.results;
      break;
    }
    default:
      data = { error: 'Unknown resource' };
  }

  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(data),
    }],
  };
}

// ── A2A Agent Registry ──

export function getDefaultAgentCards(baseUrl: string): A2AAgentCard[] {
  return [
    {
      id: 'atheon-mind', name: 'Atheon Mind', description: 'Domain LLM for enterprise intelligence queries',
      capabilities: ['natural_language_query', 'data_analysis', 'report_generation', 'scenario_modeling'],
      endpoint: `${baseUrl}/api/a2a/agents/atheon-mind`, protocol: 'a2a/1.0', status: 'online', lastSeen: new Date().toISOString(),
    },
    {
      id: 'atheon-memory', name: 'Atheon Memory', description: 'GraphRAG knowledge graph with semantic search',
      capabilities: ['entity_search', 'relationship_traversal', 'semantic_query', 'knowledge_extraction'],
      endpoint: `${baseUrl}/api/a2a/agents/atheon-memory`, protocol: 'a2a/1.0', status: 'online', lastSeen: new Date().toISOString(),
    },
    {
      id: 'atheon-apex', name: 'Atheon Apex', description: 'Executive intelligence and strategic decision support',
      capabilities: ['health_scoring', 'risk_assessment', 'scenario_analysis', 'executive_briefing'],
      endpoint: `${baseUrl}/api/a2a/agents/atheon-apex`, protocol: 'a2a/1.0', status: 'online', lastSeen: new Date().toISOString(),
    },
    {
      id: 'atheon-pulse', name: 'Atheon Pulse', description: 'Process intelligence and anomaly detection',
      capabilities: ['metric_monitoring', 'anomaly_detection', 'process_mining', 'correlation_analysis'],
      endpoint: `${baseUrl}/api/a2a/agents/atheon-pulse`, protocol: 'a2a/1.0', status: 'online', lastSeen: new Date().toISOString(),
    },
    {
      id: 'catalyst-finance', name: 'Finance Catalyst', description: 'Autonomous finance operations agent',
      capabilities: ['invoice_processing', 'payment_reconciliation', 'budget_analysis', 'financial_reporting'],
      endpoint: `${baseUrl}/api/a2a/agents/catalyst-finance`, protocol: 'a2a/1.0', status: 'online', lastSeen: new Date().toISOString(),
    },
    {
      id: 'catalyst-procurement', name: 'Procurement Catalyst', description: 'Autonomous procurement operations agent',
      capabilities: ['vendor_evaluation', 'po_generation', 'contract_analysis', 'spend_optimization'],
      endpoint: `${baseUrl}/api/a2a/agents/catalyst-procurement`, protocol: 'a2a/1.0', status: 'online', lastSeen: new Date().toISOString(),
    },
  ];
}

export async function handleA2AMessage(
  message: A2AMessage,
  context: MCPContext,
): Promise<A2AMessage> {
  const responseId = crypto.randomUUID();

  // Route to the appropriate agent handler
  switch (message.to) {
    case 'atheon-mind': {
      const query = (message.payload.query as string) || JSON.stringify(message.payload);
      const toolResult = await handleMCPCallTool('ai_query', { query, tier: message.payload.tier || 'tier-1' }, context);
      return {
        id: responseId, from: message.to, to: message.from, type: 'response',
        method: message.method, correlationId: message.id,
        payload: { result: toolResult.content[0]?.text, isError: toolResult.isError },
        timestamp: new Date().toISOString(),
      };
    }
    case 'atheon-memory': {
      const toolResult = await handleMCPCallTool('query_knowledge_graph', message.payload, context);
      return {
        id: responseId, from: message.to, to: message.from, type: 'response',
        method: message.method, correlationId: message.id,
        payload: { result: JSON.parse(toolResult.content[0]?.text || '{}') },
        timestamp: new Date().toISOString(),
      };
    }
    case 'atheon-apex': {
      const toolResult = await handleMCPCallTool('get_health_score', message.payload, context);
      return {
        id: responseId, from: message.to, to: message.from, type: 'response',
        method: message.method, correlationId: message.id,
        payload: { result: JSON.parse(toolResult.content[0]?.text || '{}') },
        timestamp: new Date().toISOString(),
      };
    }
    default: {
      return {
        id: responseId, from: 'system', to: message.from, type: 'response',
        method: message.method, correlationId: message.id,
        payload: { error: `Agent not found: ${message.to}` },
        timestamp: new Date().toISOString(),
      };
    }
  }
}
