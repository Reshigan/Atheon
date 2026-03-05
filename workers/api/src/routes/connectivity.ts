/**
 * Connectivity Routes - MCP Server + A2A Agent Communication
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';
import {
  handleMCPListTools,
  handleMCPListResources,
  handleMCPCallTool,
  handleMCPReadResource,
  getDefaultAgentCards,
  handleA2AMessage,
} from '../services/mcp-server';
import type { MCPContext, A2AMessage } from '../services/mcp-server';

const connectivity = new Hono<AppBindings>();

/** Superadmin/support_admin can override tenant via ?tenant_id= query param */
const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || 'vantax';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// ── MCP Protocol Endpoints ──

// GET /api/connectivity/mcp/tools - List available MCP tools
connectivity.get('/mcp/tools', (c) => {
  return c.json(handleMCPListTools());
});

// GET /api/connectivity/mcp/resources - List available MCP resources
connectivity.get('/mcp/resources', (c) => {
  const tenantId = getTenantId(c);
  return c.json(handleMCPListResources(tenantId));
});

// POST /api/connectivity/mcp/tools/call - Call an MCP tool
connectivity.post('/mcp/tools/call', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{ tool: string; arguments: Record<string, unknown> }>(c, [
    { field: 'tool', type: 'string', required: true, minLength: 1, maxLength: 100 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const context: MCPContext = {
    tenantId,
    db: c.env.DB,
    ai: c.env.AI,
  };

  const result = await handleMCPCallTool(body.tool, body.arguments || {}, context);
  return c.json(result, result.isError ? 500 : 200);
});

// POST /api/connectivity/mcp/resources/read - Read an MCP resource
connectivity.post('/mcp/resources/read', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{ uri: string }>(c, [
    { field: 'uri', type: 'string', required: true, minLength: 1, maxLength: 500 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const context: MCPContext = {
    tenantId,
    db: c.env.DB,
    ai: c.env.AI,
  };

  const result = await handleMCPReadResource(body.uri, context);
  return c.json(result);
});

// ── A2A Protocol Endpoints ──

// GET /api/connectivity/a2a/agents - List available agents (Agent Cards)
connectivity.get('/a2a/agents', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  const agents = getDefaultAgentCards(baseUrl);
  return c.json({ agents, total: agents.length, protocol: 'a2a/1.0' });
});

// GET /api/connectivity/a2a/agents/:agentId - Get specific agent card
connectivity.get('/a2a/agents/:agentId', (c) => {
  const agentId = c.req.param('agentId');
  const baseUrl = new URL(c.req.url).origin;
  const agents = getDefaultAgentCards(baseUrl);
  const agent = agents.find(a => a.id === agentId);

  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  return c.json(agent);
});

// POST /api/connectivity/a2a/messages - Send A2A message
connectivity.post('/a2a/messages', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    to: string; method: string; payload: Record<string, unknown>;
  }>(c, [
    { field: 'to', type: 'string', required: true, minLength: 1, maxLength: 100 },
    { field: 'method', type: 'string', required: true, minLength: 1, maxLength: 100 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const message: A2AMessage = {
    id: crypto.randomUUID(),
    from: 'client',
    to: body.to,
    type: 'request',
    method: body.method,
    payload: body.payload || {},
    timestamp: new Date().toISOString(),
  };

  const context: MCPContext = {
    tenantId,
    db: c.env.DB,
    ai: c.env.AI,
  };

  const response = await handleA2AMessage(message, context);

  // Log A2A communication
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), context.tenantId, 'a2a.message', 'connectivity',
    body.to, JSON.stringify({ method: body.method, messageId: message.id }),
    response.payload.error ? 'failure' : 'success',
  ).run().catch(() => {});

  return c.json(response);
});

// ── Connection Status (synthesized from ERP + agents) ──

connectivity.get('/status', async (c) => {
  const tenantId = getTenantId(c);

  const [erpConnections, agentDeployments, recentA2A] = await Promise.all([
    c.env.DB.prepare(
      'SELECT ec.status, COUNT(*) as count FROM erp_connections ec WHERE ec.tenant_id = ? GROUP BY ec.status'
    ).bind(tenantId).all(),
    c.env.DB.prepare(
      'SELECT status, COUNT(*) as count FROM agent_deployments WHERE tenant_id = ? GROUP BY status'
    ).bind(tenantId).all(),
    c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM audit_log WHERE tenant_id = ? AND action = ? AND created_at > datetime(\'now\', \'-1 hour\')'
    ).bind(tenantId, 'a2a.message').first<{ count: number }>(),
  ]);

  const baseUrl = new URL(c.req.url).origin;
  const agents = getDefaultAgentCards(baseUrl);

  return c.json({
    erp: {
      connections: erpConnections.results.reduce((acc: Record<string, unknown>, r: Record<string, unknown>) => {
        acc[r.status as string] = r.count; return acc;
      }, {}),
    },
    agents: {
      deployments: agentDeployments.results.reduce((acc: Record<string, unknown>, r: Record<string, unknown>) => {
        acc[r.status as string] = r.count; return acc;
      }, {}),
      availableAgents: agents.length,
    },
    a2a: {
      messagesLastHour: recentA2A?.count || 0,
      protocol: 'a2a/1.0',
    },
    mcp: {
      toolsAvailable: handleMCPListTools().tools.length,
      protocol: 'mcp/1.0',
    },
  });
});

export default connectivity;
