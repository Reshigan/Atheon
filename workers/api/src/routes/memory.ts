import { Hono } from 'hono';
import type { AppBindings } from '../types';
import type { AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';
import { semanticSearch, indexGraphEntities } from '../services/vectorize';

const memory = new Hono<AppBindings>();

// BUG-09: Escape user input for SQL LIKE patterns
function escapeLike(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

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

// GET /api/memory/entities
memory.get('/entities', async (c) => {
  const tenantId = getTenantId(c);
  const entityType = c.req.query('type');
  const search = c.req.query('search');

  let query = 'SELECT * FROM graph_entities WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (entityType) { query += ' AND type = ?'; binds.push(entityType); }
  if (search) {
    const escaped = escapeLike(search);
    query += " AND (name LIKE ? ESCAPE '\\' OR type LIKE ? ESCAPE '\\')";
    binds.push(`%${escaped}%`, `%${escaped}%`);
  }

  query += ' ORDER BY name ASC LIMIT 100';

  const results = await c.env.DB.prepare(query).bind(...binds).all();

  const formatted = results.results.map((e: Record<string, unknown>) => ({
    id: e.id,
    type: e.type,
    name: e.name,
    properties: JSON.parse(e.properties as string || '{}'),
    confidence: e.confidence,
    source: e.source,
    validFrom: e.valid_from,
    validTo: e.valid_to,
  }));

  return c.json({ entities: formatted, total: formatted.length });
});

// GET /api/memory/entities/:id
memory.get('/entities/:id', async (c) => {
  const id = c.req.param('id');
  const entity = await c.env.DB.prepare('SELECT * FROM graph_entities WHERE id = ?').bind(id).first();

  if (!entity) return c.json({ error: 'Entity not found' }, 404);

  // Get relationships
  const outgoing = await c.env.DB.prepare(
    'SELECT r.*, ge.name as target_name, ge.type as target_type FROM graph_relationships r JOIN graph_entities ge ON r.target_id = ge.id WHERE r.source_id = ?'
  ).bind(id).all();

  const incoming = await c.env.DB.prepare(
    'SELECT r.*, ge.name as source_name, ge.type as source_type FROM graph_relationships r JOIN graph_entities ge ON r.source_id = ge.id WHERE r.target_id = ?'
  ).bind(id).all();

  return c.json({
    id: entity.id,
    type: entity.type,
    name: entity.name,
    properties: JSON.parse(entity.properties as string || '{}'),
    confidence: entity.confidence,
    source: entity.source,
    relationships: {
      outgoing: outgoing.results.map((r: Record<string, unknown>) => ({
        id: r.id,
        type: r.type,
        targetId: r.target_id,
        targetName: r.target_name,
        targetType: r.target_type,
        properties: JSON.parse(r.properties as string || '{}'),
        confidence: r.confidence,
      })),
      incoming: incoming.results.map((r: Record<string, unknown>) => ({
        id: r.id,
        type: r.type,
        sourceId: r.source_id,
        sourceName: r.source_name,
        sourceType: r.source_type,
        properties: JSON.parse(r.properties as string || '{}'),
        confidence: r.confidence,
      })),
    },
  });
});

// POST /api/memory/entities
memory.post('/entities', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    type: string; name: string; properties?: Record<string, unknown>; source?: string;
  }>(c, [
    { field: 'type', type: 'string', required: true, minLength: 1, maxLength: 64 },
    { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'source', type: 'string', required: false, maxLength: 64 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO graph_entities (id, tenant_id, type, name, properties, source) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.type, body.name, JSON.stringify(body.properties || {}), body.source || 'manual').run();

  return c.json({ id, type: body.type, name: body.name }, 201);
});

// GET /api/memory/relationships
memory.get('/relationships', async (c) => {
  const tenantId = getTenantId(c);

  const results = await c.env.DB.prepare(
    `SELECT r.*, 
      s.name as source_name, s.type as source_type, 
      t.name as target_name, t.type as target_type 
    FROM graph_relationships r 
    JOIN graph_entities s ON r.source_id = s.id 
    JOIN graph_entities t ON r.target_id = t.id 
    WHERE r.tenant_id = ? 
    ORDER BY r.confidence DESC LIMIT 100`
  ).bind(tenantId).all();

  const formatted = results.results.map((r: Record<string, unknown>) => ({
    id: r.id,
    type: r.type,
    sourceId: r.source_id,
    sourceName: r.source_name,
    sourceType: r.source_type,
    targetId: r.target_id,
    targetName: r.target_name,
    targetType: r.target_type,
    properties: JSON.parse(r.properties as string || '{}'),
    confidence: r.confidence,
  }));

  return c.json({ relationships: formatted, total: formatted.length });
});

// POST /api/memory/relationships
memory.post('/relationships', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    source_id: string; target_id: string; type: string; properties?: Record<string, unknown>;
  }>(c, [
    { field: 'source_id', type: 'string', required: true, minLength: 1 },
    { field: 'target_id', type: 'string', required: true, minLength: 1 },
    { field: 'type', type: 'string', required: true, minLength: 1, maxLength: 64 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO graph_relationships (id, tenant_id, source_id, target_id, type, properties) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.source_id, body.target_id, body.type, JSON.stringify(body.properties || {})).run();

  return c.json({ id }, 201);
});

// GET /api/memory/graph (full graph for visualization)
memory.get('/graph', async (c) => {
  const tenantId = getTenantId(c);

  const entities = await c.env.DB.prepare(
    'SELECT id, type, name, properties, confidence FROM graph_entities WHERE tenant_id = ? LIMIT 200'
  ).bind(tenantId).all();

  const relationships = await c.env.DB.prepare(
    'SELECT id, source_id, target_id, type, confidence FROM graph_relationships WHERE tenant_id = ? LIMIT 500'
  ).bind(tenantId).all();

  return c.json({
    nodes: entities.results.map((e: Record<string, unknown>) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      properties: JSON.parse(e.properties as string || '{}'),
      confidence: e.confidence,
    })),
    edges: relationships.results.map((r: Record<string, unknown>) => ({
      id: r.id,
      source: r.source_id,
      target: r.target_id,
      type: r.type,
      confidence: r.confidence,
    })),
  });
});

// POST /api/memory/query (GraphRAG query with semantic + keyword search)
memory.post('/query', async (c) => {
  const { data: body, errors } = await getValidatedJsonBody<{ query: string; depth?: number }>(c, [
    { field: 'query', type: 'string', required: true, minLength: 1, maxLength: 500 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);
  const tenantId = getTenantId(c);
  const query = body.query.toLowerCase();

  // Try Vectorize semantic search first (if available)
  let vectorResults: { id: string; score: number; metadata: Record<string, unknown> }[] = [];
  if (c.env.VECTORIZE) {
    try {
      vectorResults = await semanticSearch(c.env.VECTORIZE, c.env.AI, body.query, tenantId, { topK: 10 });
    } catch (err) {
      console.error('Vectorize search failed, falling back to keyword:', err);
    }
  }

  // Keyword-based graph traversal (always run as fallback/supplement)
  const matchingEntities = await c.env.DB.prepare(
    'SELECT * FROM graph_entities WHERE tenant_id = ? AND (LOWER(name) LIKE ? OR LOWER(type) LIKE ?) LIMIT 10'
  ).bind(tenantId, `%${query}%`, `%${query}%`).all();

  // Get related entities via relationships
  const entityIds = matchingEntities.results.map((e: Record<string, unknown>) => e.id as string);
  let relatedEntities: Record<string, unknown>[] = [];

  if (entityIds.length > 0) {
    for (const eid of entityIds.slice(0, 5)) {
      const related = await c.env.DB.prepare(
        `SELECT DISTINCT ge.* FROM graph_entities ge 
         JOIN graph_relationships gr ON (ge.id = gr.target_id OR ge.id = gr.source_id) 
         WHERE (gr.source_id = ? OR gr.target_id = ?) AND ge.id != ? AND ge.tenant_id = ?
         LIMIT 10`
      ).bind(eid, eid, eid, tenantId).all();
      relatedEntities = [...relatedEntities, ...related.results];
    }
  }

  // Build context from both vector and keyword matches
  const context = matchingEntities.results.map((e: Record<string, unknown>) =>
    `${e.type}: ${e.name} (${e.properties})`
  ).join('; ');

  const vectorContext = vectorResults.map(r =>
    `[${(r.score * 100).toFixed(0)}%] ${r.metadata.type || 'entity'}: ${r.metadata.name || r.id}`
  ).join('; ');

  // Use Workers AI to generate a contextual answer from the graph data
  let answer = `Found ${matchingEntities.results.length} keyword matches and ${vectorResults.length} semantic matches for "${body.query}".`;

  try {
    const combinedContext = [context, vectorContext].filter(Boolean).join('\n\nSemantic matches: ');
    if (matchingEntities.results.length > 0 || vectorResults.length > 0) {
      const aiResult = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct' as Parameters<Ai['run']>[0], {
        messages: [
          {
            role: 'system',
            content: 'You are a knowledge graph query engine. Given entity data from a business knowledge graph (keyword and semantic search results), provide a concise, insightful answer to the user\'s query. Be specific and reference the entities by name.'
          },
          {
            role: 'user',
            content: `Query: ${body.query}\n\nGraph context:\n${combinedContext}\n\nRelated entities: ${relatedEntities.slice(0, 5).map((e: Record<string, unknown>) => `${e.type}: ${e.name}`).join(', ')}`
          },
        ],
        max_tokens: 512,
        temperature: 0.5,
      });
      const result = aiResult as { response?: string };
      if (result.response) {
        answer = result.response;
      }
    }
  } catch (err) {
    console.error('AI query augmentation failed:', err);
  }

  return c.json({
    query: body.query,
    searchMode: vectorResults.length > 0 ? 'semantic+keyword' : 'keyword',
    directMatches: matchingEntities.results.map((e: Record<string, unknown>) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      properties: JSON.parse(e.properties as string || '{}'),
      confidence: e.confidence,
    })),
    semanticMatches: vectorResults.map(r => ({
      id: r.id,
      score: r.score,
      type: r.metadata.type,
      name: r.metadata.name,
    })),
    relatedEntities: relatedEntities.slice(0, 10).map((e: Record<string, unknown>) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      properties: JSON.parse(e.properties as string || '{}'),
    })),
    context,
    answer,
  });
});

// POST /api/memory/index - Index graph entities into Vectorize for semantic search
memory.post('/index', async (c) => {
  const tenantId = getTenantId(c);

  if (!c.env.VECTORIZE) {
    return c.json({ error: 'Vectorize not configured', message: 'Vector index not available' }, 503);
  }

  const result = await indexGraphEntities(c.env.VECTORIZE, c.env.AI, c.env.DB, tenantId);
  return c.json({ ...result, tenantId });
});

// GET /api/memory/stats
memory.get('/stats', async (c) => {
  const tenantId = getTenantId(c);

  const entityCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM graph_entities WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>();
  const relationshipCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM graph_relationships WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>();

  const typeBreakdown = await c.env.DB.prepare(
    'SELECT type, COUNT(*) as count FROM graph_entities WHERE tenant_id = ? GROUP BY type ORDER BY count DESC'
  ).bind(tenantId).all();

  const relTypeBreakdown = await c.env.DB.prepare(
    'SELECT type, COUNT(*) as count FROM graph_relationships WHERE tenant_id = ? GROUP BY type ORDER BY count DESC'
  ).bind(tenantId).all();

  return c.json({
    entities: entityCount?.count || 0,
    relationships: relationshipCount?.count || 0,
    entityTypes: typeBreakdown.results,
    relationshipTypes: relTypeBreakdown.results,
  });
});

export default memory;
