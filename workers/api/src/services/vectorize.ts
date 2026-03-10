/**
 * Vectorize Integration Service
 * True vector embeddings and semantic search using Cloudflare Vectorize.
 * Generates embeddings via Workers AI and stores/queries in Vectorize index.
 */

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const VECTOR_DIMENSIONS = 768; // bge-base-en-v1.5 output dimensions
const DEFAULT_TOP_K = 10;

export interface VectorDocument {
  id: string;
  tenantId: string;
  type: string;
  name: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

// ── Generate Embeddings via Workers AI ──

export async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run(EMBEDDING_MODEL as Parameters<Ai['run']>[0], {
    text: [text],
  });
  const embedResult = result as { data?: number[][] };
  if (embedResult.data && embedResult.data.length > 0) {
    return embedResult.data[0];
  }
  throw new Error('Failed to generate embedding');
}

// ── Index a document into Vectorize ──

export async function indexDocument(
  vectorize: VectorizeIndex,
  ai: Ai,
  doc: VectorDocument,
): Promise<{ id: string; indexed: boolean }> {
  try {
    // Generate embedding from document content
    const textToEmbed = `${doc.type}: ${doc.name}. ${doc.content}`;
    const values = await generateEmbedding(ai, textToEmbed);

    // Upsert into Vectorize
    await vectorize.upsert([{
      id: doc.id,
      values,
      metadata: {
        tenantId: doc.tenantId,
        type: doc.type,
        name: doc.name,
        ...(doc.metadata || {}),
      },
    }]);

    return { id: doc.id, indexed: true };
  } catch (err) {
    console.error('Vectorize indexing error:', err);
    return { id: doc.id, indexed: false };
  }
}

// ── Semantic Search via Vectorize ──

export async function semanticSearch(
  vectorize: VectorizeIndex,
  ai: Ai,
  query: string,
  tenantId: string,
  options?: { topK?: number; type?: string },
): Promise<SearchResult[]> {
  try {
    const queryVector = await generateEmbedding(ai, query);

    const filter: VectorizeVectorMetadataFilter = {
      tenantId: tenantId,
    };
    if (options?.type) {
      filter.type = options.type;
    }

    const results = await vectorize.query(queryVector, {
      topK: options?.topK || DEFAULT_TOP_K,
      filter,
      returnMetadata: 'all',
    });

    return results.matches.map(match => ({
      id: match.id,
      score: match.score,
      metadata: (match.metadata || {}) as Record<string, unknown>,
    }));
  } catch (err) {
    console.error('Vectorize search error:', err);
    return [];
  }
}

// ── Batch index graph entities for a tenant ──

export async function indexGraphEntities(
  vectorize: VectorizeIndex,
  ai: Ai,
  db: D1Database,
  tenantId: string,
): Promise<{ indexed: number; failed: number }> {
  let indexed = 0;
  let failed = 0;

  // Fetch all entities for the tenant
  const entities = await db.prepare(
    'SELECT id, type, name, properties FROM graph_entities WHERE tenant_id = ? LIMIT 500'
  ).bind(tenantId).all();

  // Process in batches of 10 (Workers AI rate limits)
  const batchSize = 10;
  for (let i = 0; i < entities.results.length; i += batchSize) {
    const batch = entities.results.slice(i, i + batchSize);

    for (const entity of batch) {
      const props = JSON.parse(entity.properties as string || '{}');
      const propsText = Object.entries(props).map(([k, v]) => `${k}: ${v}`).join(', ');
      const content = `${entity.type} entity named ${entity.name}. Properties: ${propsText}`;

      const result = await indexDocument(vectorize, ai, {
        id: entity.id as string,
        tenantId,
        type: entity.type as string,
        name: entity.name as string,
        content,
        metadata: { source: 'graph_entity', properties: propsText },
      });

      if (result.indexed) indexed++;
      else failed++;
    }
  }

  // Also index relationships
  const relationships = await db.prepare(
    `SELECT r.id, r.type, s.name as source_name, s.type as source_type, t.name as target_name, t.type as target_type
     FROM graph_relationships r
     JOIN graph_entities s ON r.source_id = s.id
     JOIN graph_entities t ON r.target_id = t.id
     WHERE r.tenant_id = ? LIMIT 500`
  ).bind(tenantId).all();

  for (let i = 0; i < relationships.results.length; i += batchSize) {
    const batch = relationships.results.slice(i, i + batchSize);

    for (const rel of batch) {
      const content = `${rel.source_type} "${rel.source_name}" ${rel.type} ${rel.target_type} "${rel.target_name}"`;

      const result = await indexDocument(vectorize, ai, {
        id: rel.id as string,
        tenantId,
        type: 'relationship',
        name: `${rel.source_name} → ${rel.target_name}`,
        content,
        metadata: {
          source: 'graph_relationship',
          relationType: rel.type,
          sourceType: rel.source_type,
          targetType: rel.target_type,
        },
      });

      if (result.indexed) indexed++;
      else failed++;
    }
  }

  return { indexed, failed };
}

// ── Delete vectors for a tenant ──

export async function deleteByIds(
  vectorize: VectorizeIndex,
  ids: string[],
): Promise<{ deleted: number }> {
  try {
    await vectorize.deleteByIds(ids);
    return { deleted: ids.length };
  } catch (err) {
    console.error('Vectorize delete error:', err);
    return { deleted: 0 };
  }
}

// ── RAG Pipeline: Query with Citations ──

export interface RAGCitation {
  documentId: string;
  documentName: string;
  documentType: string;
  relevanceScore: number;
  snippet: string;
}

export interface RAGResponse {
  answer: string;
  citations: RAGCitation[];
  model: string;
  tokensUsed: number;
}

/**
 * Perform a RAG (Retrieval-Augmented Generation) query.
 * 1. Embeds the user query via Workers AI
 * 2. Searches Vectorize for semantically similar documents
 * 3. Constructs a prompt with retrieved context
 * 4. Generates an answer using Workers AI LLM with inline citations
 * @param vectorize - Vectorize index binding
 * @param ai - Workers AI binding
 * @param db - D1 database for fetching full document content
 * @param tenantId - Tenant scope for the query
 * @param query - Natural language query from the user
 * @param options - Optional top-k and type filter
 * @returns RAGResponse with answer text and citation metadata
 */
export async function ragQuery(
  vectorize: VectorizeIndex,
  ai: Ai,
  db: D1Database,
  tenantId: string,
  query: string,
  options?: { topK?: number; type?: string },
): Promise<RAGResponse> {
  const topK = options?.topK || 5;

  // Step 1: Semantic search for relevant documents
  const searchResults = await semanticSearch(vectorize, ai, query, tenantId, { topK, type: options?.type });

  // Step 2: Build context from search results
  const citations: RAGCitation[] = [];
  const contextParts: string[] = [];

  for (const result of searchResults) {
    const meta = result.metadata;
    const docName = (meta.name as string) || 'Unknown';
    const docType = (meta.type as string) || 'document';
    const snippet = (meta.properties as string) || (meta.source as string) || docName;

    citations.push({
      documentId: result.id,
      documentName: docName,
      documentType: docType,
      relevanceScore: result.score,
      snippet: snippet.substring(0, 200),
    });

    contextParts.push(`[Source ${citations.length}: ${docType} "${docName}"] ${snippet}`);
  }

  // Step 3: If no results found, return empty answer
  if (contextParts.length === 0) {
    return {
      answer: 'No relevant documents were found for your query. Please try rephrasing or ensure data has been indexed.',
      citations: [],
      model: EMBEDDING_MODEL,
      tokensUsed: 0,
    };
  }

  // Step 4: Generate answer with LLM using retrieved context
  const systemPrompt = `You are Atheon, an enterprise intelligence assistant. Answer the user's question based ONLY on the provided context documents. When referencing information, cite the source using [Source N] notation. If the context doesn't contain enough information to fully answer, say so clearly. Be concise and professional.`;

  const contextBlock = contextParts.join('\n\n');
  const userPrompt = `Context:\n${contextBlock}\n\nQuestion: ${query}\n\nAnswer with citations:`;

  try {
    const llmResult = await ai.run('@cf/meta/llama-3.1-8b-instruct' as Parameters<Ai['run']>[0], {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    });

    const llmResponse = llmResult as { response?: string };
    const answer = llmResponse.response || 'Unable to generate an answer.';

    return {
      answer,
      citations,
      model: '@cf/meta/llama-3.1-8b-instruct',
      tokensUsed: answer.length, // Approximate
    };
  } catch (err) {
    console.error('RAG LLM error:', err);
    return {
      answer: `Based on ${citations.length} retrieved documents, I found relevant information but could not generate a synthesized answer. Please review the cited sources directly.`,
      citations,
      model: '@cf/meta/llama-3.1-8b-instruct',
      tokensUsed: 0,
    };
  }
}

/**
 * Index insight data from catalyst execution into Vectorize for RAG queries.
 * This enables the AI to cite specific health scores, risk alerts, and executive briefings.
 * @param vectorize - Vectorize index binding
 * @param ai - Workers AI binding
 * @param db - D1 database
 * @param tenantId - Tenant scope
 * @returns Count of indexed and failed documents
 */
export async function indexInsightsForRAG(
  vectorize: VectorizeIndex,
  ai: Ai,
  db: D1Database,
  tenantId: string,
): Promise<{ indexed: number; failed: number }> {
  let indexed = 0;
  let failed = 0;

  // Index health scores
  const healthScores = await db.prepare(
    'SELECT * FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 100'
  ).bind(tenantId).all();

  for (const hs of healthScores.results) {
    // health_scores schema: id, tenant_id, overall_score, dimensions (JSON), calculated_at
    let dimensionsSummary = 'N/A';
    try {
      const dims = JSON.parse(hs.dimensions as string || '{}');
      dimensionsSummary = Object.entries(dims).map(([k, v]) => `${k}: ${v}`).join(', ');
    } catch { /* ignore parse errors */ }
    const content = `Health Score: ${hs.overall_score}/100. Dimensions: ${dimensionsSummary}. Calculated at: ${hs.calculated_at || 'N/A'}`;
    const result = await indexDocument(vectorize, ai, {
      id: `hs-${hs.id}`,
      tenantId,
      type: 'health_score',
      name: `Overall Health Score (${hs.overall_score})`,
      content,
      metadata: {
        source: 'health_scores',
        overall_score: hs.overall_score,
        calculated_at: hs.calculated_at,
      },
    });
    if (result.indexed) indexed++;
    else failed++;
  }

  // Index risk alerts
  const riskAlerts = await db.prepare(
    'SELECT * FROM risk_alerts WHERE tenant_id = ? ORDER BY detected_at DESC LIMIT 100'
  ).bind(tenantId).all();

  for (const ra of riskAlerts.results) {
    // risk_alerts schema: id, tenant_id, title, description, severity, category, probability, impact_value, impact_unit, recommended_actions, status, detected_at, resolved_at
    const content = `Risk Alert: ${ra.title}. Severity: ${ra.severity}. Category: ${ra.category}. Description: ${ra.description}. Recommended Actions: ${ra.recommended_actions || 'N/A'}`;
    const result = await indexDocument(vectorize, ai, {
      id: `ra-${ra.id}`,
      tenantId,
      type: 'risk_alert',
      name: ra.title as string,
      content,
      metadata: {
        source: 'risk_alerts',
        severity: ra.severity,
        category: ra.category,
      },
    });
    if (result.indexed) indexed++;
    else failed++;
  }

  // Index executive briefings
  const briefings = await db.prepare(
    'SELECT * FROM executive_briefings WHERE tenant_id = ? ORDER BY generated_at DESC LIMIT 50'
  ).bind(tenantId).all();

  for (const eb of briefings.results) {
    // executive_briefings schema: id, tenant_id, title, summary, risks, opportunities, kpi_movements, decisions_needed, generated_at
    const content = `Executive Briefing: ${eb.title}. Summary: ${eb.summary}. Risks: ${eb.risks || '[]'}. Opportunities: ${eb.opportunities || '[]'}. Decisions Needed: ${eb.decisions_needed || '[]'}`;
    const result = await indexDocument(vectorize, ai, {
      id: `eb-${eb.id}`,
      tenantId,
      type: 'executive_briefing',
      name: eb.title as string,
      content,
      metadata: {
        source: 'executive_briefings',
        generated_at: eb.generated_at,
      },
    });
    if (result.indexed) indexed++;
    else failed++;
  }

  return { indexed, failed };
}

// ── Export constants for wrangler config ──
export { VECTOR_DIMENSIONS, EMBEDDING_MODEL };
