import { Hono } from 'hono';
import type { Env } from '../types';

const memory = new Hono<{ Bindings: Env }>();

// GET /api/memory/entities?tenant_id=&type=
memory.get('/entities', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';
  const entityType = c.req.query('type');
  const search = c.req.query('search');

  let query = 'SELECT * FROM graph_entities WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (entityType) { query += ' AND type = ?'; binds.push(entityType); }
  if (search) { query += ' AND (name LIKE ? OR type LIKE ?)'; binds.push(`%${search}%`, `%${search}%`); }

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
  const body = await c.req.json<{
    tenant_id: string; type: string; name: string; properties?: Record<string, unknown>; source?: string;
  }>();

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO graph_entities (id, tenant_id, type, name, properties, source) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, body.tenant_id, body.type, body.name, JSON.stringify(body.properties || {}), body.source || 'manual').run();

  return c.json({ id, type: body.type, name: body.name }, 201);
});

// GET /api/memory/relationships?tenant_id=
memory.get('/relationships', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';

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
  const body = await c.req.json<{
    tenant_id: string; source_id: string; target_id: string; type: string; properties?: Record<string, unknown>;
  }>();

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO graph_relationships (id, tenant_id, source_id, target_id, type, properties) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, body.tenant_id, body.source_id, body.target_id, body.type, JSON.stringify(body.properties || {})).run();

  return c.json({ id }, 201);
});

// GET /api/memory/graph?tenant_id= (full graph for visualization)
memory.get('/graph', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';

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

// POST /api/memory/query (GraphRAG query with AI-powered semantic search)
memory.post('/query', async (c) => {
  const body = await c.req.json<{ tenant_id?: string; query: string; depth?: number }>();
  const tenantId = body.tenant_id || 'vantax';
  const query = body.query.toLowerCase();

  // First: keyword-based graph traversal
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

  // Build context from matched entities
  const context = matchingEntities.results.map((e: Record<string, unknown>) =>
    `${e.type}: ${e.name} (${e.properties})`
  ).join('; ');

  // Use Workers AI to generate a contextual answer from the graph data
  let answer = `Found ${matchingEntities.results.length} entities matching "${body.query}" with ${relatedEntities.length} related entities in the knowledge graph.`;

  try {
    if (matchingEntities.results.length > 0) {
      const aiResult = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct' as Parameters<Ai['run']>[0], {
        messages: [
          {
            role: 'system',
            content: 'You are a knowledge graph query engine. Given entity data from a business knowledge graph, provide a concise, insightful answer to the user\'s query. Be specific and reference the entities by name.'
          },
          {
            role: 'user',
            content: `Query: ${body.query}\n\nGraph context:\n${context}\n\nRelated entities: ${relatedEntities.slice(0, 5).map((e: Record<string, unknown>) => `${e.type}: ${e.name}`).join(', ')}`
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
    // Keep the default answer
  }

  return c.json({
    query: body.query,
    directMatches: matchingEntities.results.map((e: Record<string, unknown>) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      properties: JSON.parse(e.properties as string || '{}'),
      confidence: e.confidence,
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

// GET /api/memory/stats?tenant_id=
memory.get('/stats', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';

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
