import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getERPAdapter, listERPAdapters, withCircuitBreaker, getCircuitBreakerState, resolveCompanyId } from '../services/erp-connector';
import { getValidatedJsonBody } from '../middleware/validation';
import type { ERPCredentials, SyncResult } from '../services/erp-connector';
import { encrypt, decrypt, isEncrypted } from '../services/encryption';
import { mapRecord, canonicalTableName, extractCompanyKey } from '../services/erp-data-mapper';
import { indexDocument } from '../services/vectorize';
import { logError, logInfo } from '../services/logger';
import { profileEntityRecords, getDiscoveredSchemas } from '../services/erp-schema-profiler';
import { runAutoMapper, listAllMappings, persistSuggestions, getActiveMappings } from '../services/erp-auto-mapper';
import { invalidateMappingCache } from '../services/erp-field-resolver';
import { suggestUnmappedWithLlm } from '../services/erp-mapping-llm';
import { inferProcessProfile, getProcessProfile, setProcessProfileOverrides, loadProcessProfile, type ProcessProfile } from '../services/erp-process-profile';
import {
  getVendorBaseline,
  listSupportedVendors,
  compareProfileToBaseline,
  compareSchemaToBaseline,
  calculateAlignmentScore,
} from '../services/erp-vendor-baselines';
import {
  dispatchWriteAction,
  approveQueuedAction,
  rejectQueuedAction,
  type ActionType,
  type ActionAutonomyTier,
  type CatalystWriteAction,
} from '../services/erp-write-actions';
import '../services/erp-write-adapters'; // side-effect: registers default adapters

const erp = new Hono<AppBindings>();

/** Superadmin/support_admin can override tenant via ?tenant_id= query param */
const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

/** Credential-bearing config fields. If any of these appear in a body, we must encrypt. */
const SENSITIVE_CONFIG_FIELDS = ['client_secret', 'api_key', 'password', 'access_token', 'refresh_token'] as const;

function hasCredentials(config: Record<string, unknown> | undefined | null): boolean {
  if (!config) return false;
  return SENSITIVE_CONFIG_FIELDS.some((f) => typeof config[f] === 'string' && (config[f] as string).length > 0);
}

/**
 * §8.3: Persist an ERP config blob. If an ENCRYPTION_KEY is configured, the config
 * is encrypted with AES-256-GCM and stored in `encrypted_config` (plaintext `config`
 * column is blanked). If no key is configured — test envs with sensitive credentials
 * stripped, on-prem with BYOK pending — we fall back to plaintext + audit a warning.
 *
 * Returns the pair of columns to write, plus a flag indicating whether encryption ran.
 */
async function persistErpConfig(
  config: Record<string, unknown>,
  encryptionKey: string | undefined,
): Promise<{ config: string; encryptedConfig: string | null; encrypted: boolean; skipReason?: string }> {
  const configStr = JSON.stringify(config);
  if (encryptionKey && encryptionKey.length >= 16) {
    try {
      const encryptedConfig = await encrypt(configStr, encryptionKey);
      return { config: '{}', encryptedConfig, encrypted: true };
    } catch (err) {
      console.error('[encryption] ERP config encryption failed, falling back to plaintext:', err);
      return { config: configStr, encryptedConfig: null, encrypted: false, skipReason: 'encryption_error' };
    }
  }
  // No key configured — store plaintext with loud warning. Callers should audit this.
  if (hasCredentials(config)) {
    console.warn('[encryption] ENCRYPTION_KEY not configured — storing ERP credentials as plaintext. Set ENCRYPTION_KEY secret to enable encryption at rest.');
  }
  return { config: configStr, encryptedConfig: null, encrypted: false, skipReason: 'no_encryption_key' };
}

async function auditEncryptionSkipped(
  db: D1Database, tenantId: string, connectionId: string, skipReason: string, where: string,
): Promise<void> {
  try {
    await db.prepare(
      'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), tenantId, 'erp.credentials.encryption_skipped', 'security', 'erp_connections',
      JSON.stringify({ connectionId, skipReason, where }),
      'warning',
    ).run();
  } catch { /* non-fatal */ }
}

/**
 * 3.12: Write synced ERP records to canonical tables
 * Maps adapter entity types to canonical table inserts
 */
async function writeToCanonicalTables(
  db: D1Database, tenantId: string, sourceSystem: string, result: SyncResult,
  vectorize?: VectorizeIndex, ai?: Ai, connectionId?: string, kv?: KVNamespace,
): Promise<void> {
  // Multi-company: cache resolved companyIds by vendor-company-key for the
  // duration of this sync run so a 10k-record sync does one lookup per
  // unique source company, not per record.
  const companyCache = new Map<string, string>();

  for (const entity of result.entities) {
    if (entity.count === 0) continue;
    const records = entity.records || [];

    // v57 schema discovery — profile the raw fields BEFORE mapping so we
    // capture the actual ERP schema (including custom Z-fields, Odoo custom
    // modules, NetSuite custom segments). Best-effort, never throws.
    if (connectionId && records.length > 0) {
      await profileEntityRecords(db, tenantId, connectionId, sourceSystem, entity.type, records);

      // v58 auto-mapper — refresh suggestions for this entity. The
      // resolver caches mappings for 5 minutes, so we also invalidate
      // the cache so the very next catalyst extraction sees the updated
      // active set. Best-effort: any mapper failure is logged and
      // ignored — sync ingestion must not be aborted by a mapping
      // refresh.
      try {
        await runAutoMapper(db, tenantId, connectionId, entity.type);

        // v59 LLM fallback — for canonical fields the rule-based mapper
        // could not place at all (no active or suggested mapping after
        // runAutoMapper), call an LLM with field-name + sample values
        // and persist as 'suggested' (always lands in review queue,
        // never auto-applied — billing artefacts must trust only
        // human-confirmed LLM output).
        if (ai) {
          try {
            const active = await getActiveMappings(db, tenantId, connectionId, entity.type);
            const allMapped = new Set<string>();
            for (const fields of Object.values(active)) for (const f of fields) allMapped.add(f);
            // Also exclude already-suggested fields so we don't pay for the same call twice
            const suggested = await listAllMappings(db, tenantId, connectionId, entity.type);
            for (const s of suggested) allMapped.add(s.source_field);

            const profiles = await getDiscoveredSchemas(db, tenantId, connectionId, entity.type);
            const unmapped = profiles
              .filter((p) => !allMapped.has(p.source_field))
              .map((p) => ({
                source_field: p.source_field,
                inferred_type: p.inferred_type,
                sample_values: p.sample_values,
                null_rate: p.null_rate,
              }));
            if (unmapped.length > 0) {
              const llmSugs = await suggestUnmappedWithLlm(
                db, ai, tenantId, connectionId, entity.type, sourceSystem, unmapped, kv,
              );
              if (llmSugs.length > 0) {
                await persistSuggestions(db, tenantId, connectionId, entity.type, llmSugs);
              }
            }
          } catch (llmErr) {
            logError('erp.mapping.llm.fallback_failed', llmErr, { tenantId }, {
              connectionId, entityType: entity.type,
            });
          }
        }

        await invalidateMappingCache({ tenantId, connectionId, entityType: entity.type }, kv);
      } catch (err) {
        logError('erp.auto_mapper.run_failed', err, { tenantId }, {
          connectionId, entityType: entity.type,
        });
      }
    }

    try {
      for (const raw of records) {
        // Resolve the canonical company_id for this record from the vendor's
        // company identifier (SAP BUKRS, Odoo company_id, Xero TenantId, …).
        // resolveCompanyId falls back to the tenant's '__primary__' company
        // when the source record carries no company key.
        const companyKey = extractCompanyKey(sourceSystem, raw);
        const companyId = await resolveCompanyId(db, tenantId, sourceSystem, companyKey, undefined, companyCache);
        const mapped = mapRecord(sourceSystem, entity.type, raw, tenantId, { companyId });
        if (!mapped) continue;
        const table = canonicalTableName(entity.type);
        if (!table) continue;

        // v60: tag the canonical row with its source connection so the
        // shared-savings attribution layer can roll up per-connection (not
        // just per-source-system). Old rows pre-v60 stay NULL and the
        // attribution code falls back to source_system grouping for them.
        const mappedObj = mapped as unknown as Record<string, unknown>;
        if (connectionId) mappedObj.connection_id = connectionId;
        const sourceId = mappedObj.source_id as string;
        const existing = await db.prepare(
          `SELECT id FROM ${table} WHERE tenant_id = ? AND source_system = ? AND source_id = ?`
        ).bind(tenantId, sourceSystem, sourceId).first<{ id: string }>();

        if (existing) {
          // UPDATE existing record
          const cols = Object.keys(mappedObj).filter(k => !['id', 'tenant_id', 'source_system', 'source_id', 'created_at'].includes(k));
          const sets = cols.map(c => `${c} = ?`).join(', ');
          const vals = cols.map(c => mappedObj[c]);
          await db.prepare(`UPDATE ${table} SET ${sets}, synced_at = datetime('now') WHERE id = ?`)
            .bind(...vals, existing.id).run();
        } else {
          // INSERT new record
          const cols = Object.keys(mappedObj);
          const placeholders = cols.map(() => '?').join(', ');
          const vals = cols.map(c => mappedObj[c]);
          await db.prepare(`INSERT INTO ${table} (${cols.join(', ')}, synced_at) VALUES (${placeholders}, datetime('now'))`)
            .bind(...vals).run();
        }

        // Embed into Vectorize for RAG
        if (vectorize && ai) {
          try {
            const name = mappedObj.name as string || sourceId;
            const content = Object.entries(mappedObj)
              .filter(([k]) => !['id', 'tenant_id'].includes(k))
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ');
            await indexDocument(vectorize, ai, {
              id: mappedObj.id as string,
              tenantId, type: entity.type, name, content,
              metadata: { source_system: sourceSystem, source_id: sourceId },
            });
          } catch (vecErr) {
            console.error(`Vectorize indexing failed for ${entity.type}/${sourceId}:`, vecErr);
          }
        }
      }

      // If no raw records but we have a count, update synced_at for existing records
      if (records.length === 0 && entity.count > 0) {
        const table = canonicalTableName(entity.type);
        if (table) {
          await db.prepare(
            `UPDATE ${table} SET synced_at = datetime('now') WHERE tenant_id = ? AND source_system = ?`
          ).bind(tenantId, sourceSystem).run();
        }
      }
    } catch (err) {
      console.error(`Failed to write ${entity.type} to canonical table:`, err);
    }
  }
}

// GET /api/erp/adapters
erp.get('/adapters', async (c) => {
  const results = await c.env.DB.prepare('SELECT * FROM erp_adapters ORDER BY name ASC').all();

  const formatted = results.results.map((a: Record<string, unknown>) => ({
    id: a.id,
    name: a.name,
    system: a.system,
    version: a.version,
    protocol: a.protocol,
    status: a.status,
    operations: JSON.parse(a.operations as string || '[]'),
    authMethods: JSON.parse(a.auth_methods as string || '[]'),
  }));

  return c.json({ adapters: formatted, total: formatted.length });
});

// GET /api/erp/adapters/:id
erp.get('/adapters/:id', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const adapter = await c.env.DB.prepare('SELECT * FROM erp_adapters WHERE id = ?').bind(id).first();

  if (!adapter) return c.json({ error: 'Adapter not found' }, 404);

  // Get connections using this adapter
  const connections = await c.env.DB.prepare(
    'SELECT ec.*, t.name as tenant_name FROM erp_connections ec JOIN tenants t ON ec.tenant_id = t.id WHERE ec.adapter_id = ? AND ec.tenant_id = ?'
  ).bind(id, tenantId).all();

  return c.json({
    id: adapter.id,
    name: adapter.name,
    system: adapter.system,
    version: adapter.version,
    protocol: adapter.protocol,
    status: adapter.status,
    operations: JSON.parse(adapter.operations as string || '[]'),
    authMethods: JSON.parse(adapter.auth_methods as string || '[]'),
    connections: connections.results.map((conn: Record<string, unknown>) => ({
      id: conn.id,
      tenantId: conn.tenant_id,
      tenantName: conn.tenant_name,
      name: conn.name,
      status: conn.status,
      lastSync: conn.last_sync,
      recordsSynced: conn.records_synced,
    })),
  });
});

// GET /api/erp/connections
erp.get('/connections', async (c) => {
  const tenantId = getTenantId(c);

  const results = await c.env.DB.prepare(
    'SELECT ec.*, ea.name as adapter_name, ea.system as adapter_system, ea.protocol as adapter_protocol FROM erp_connections ec JOIN erp_adapters ea ON ec.adapter_id = ea.id WHERE ec.tenant_id = ? ORDER BY ec.name ASC'
  ).bind(tenantId).all();

  // Phase 1.1: Decrypt config on read
  const formatted = await Promise.all(results.results.map(async (conn: Record<string, unknown>) => {
    let config: Record<string, unknown> = {};
    // Try encrypted_config first, fallback to config
    const encCfg = conn.encrypted_config as string | null;
    if (encCfg && isEncrypted(encCfg)) {
      const decrypted = await decrypt(encCfg, c.env.ENCRYPTION_KEY);
      config = decrypted ? JSON.parse(decrypted) : {};
    } else {
      config = JSON.parse(conn.config as string || '{}');
    }
    // Redact secrets from response
    const safeConfig = { ...config };
    if (safeConfig.client_secret) safeConfig.client_secret = '***';
    if (safeConfig.access_token) safeConfig.access_token = '***';
    if (safeConfig.refresh_token) safeConfig.refresh_token = '***';
    if (safeConfig.password) safeConfig.password = '***';
    if (safeConfig.api_key) safeConfig.api_key = '***';

    return {
      id: conn.id,
      adapterId: conn.adapter_id,
      adapterName: conn.adapter_name,
      adapterSystem: conn.adapter_system,
      adapterProtocol: conn.adapter_protocol,
      name: conn.name,
      status: conn.status,
      config: safeConfig,
      lastSync: conn.last_sync,
      syncFrequency: conn.sync_frequency,
      recordsSynced: conn.records_synced,
      connectedAt: conn.connected_at,
    };
  }));

  return c.json({ connections: formatted, total: formatted.length });
});

// POST /api/erp/connections
erp.post('/connections', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    adapter_id: string; name: string; config?: Record<string, unknown>; sync_frequency?: string;
  }>(c, [
    { field: 'adapter_id', type: 'string', required: true, minLength: 1 },
    { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'sync_frequency', type: 'string', required: false, maxLength: 32 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const id = crypto.randomUUID();
  // §8.3: Encrypt entire config blob at rest. If any credential-bearing field is
  // supplied but ENCRYPTION_KEY is not configured, we log + audit a warning.
  const rawConfig = body.config || {};
  const { config: plaintextCol, encryptedConfig, encrypted, skipReason } =
    await persistErpConfig(rawConfig, c.env.ENCRYPTION_KEY);

  await c.env.DB.prepare(
    'INSERT INTO erp_connections (id, tenant_id, adapter_id, name, config, encrypted_config, sync_frequency, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
  ).bind(id, tenantId, body.adapter_id, body.name, plaintextCol, encryptedConfig, body.sync_frequency || 'realtime').run();

  if (!encrypted && hasCredentials(rawConfig) && skipReason) {
    await auditEncryptionSkipped(c.env.DB, tenantId, id, skipReason, 'POST /connections');
  }

  return c.json({ id, status: 'connected', encrypted }, 201);
});

// PUT /api/erp/connections/:id
erp.put('/connections/:id', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{ status?: string; sync_frequency?: string; name?: string; config?: Record<string, unknown> }>();

  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.status) { updates.push('status = ?'); values.push(body.status); }
  if (body.sync_frequency) { updates.push('sync_frequency = ?'); values.push(body.sync_frequency); }
  if (body.name) { updates.push('name = ?'); values.push(body.name); }
  if (body.status === 'connected') { updates.push('last_sync = datetime(\'now\')'); }

  // §8.3: Update encrypted config if provided. Uses the same persistErpConfig helper
  // so the fallback path (no ENCRYPTION_KEY) matches insertion behavior.
  if (body.config && Object.keys(body.config).length > 0) {
    // Read existing config and merge
    const conn = await c.env.DB.prepare('SELECT encrypted_config, config FROM erp_connections WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
    if (!conn) return c.json({ error: 'Connection not found' }, 404);

    let existingConfig: Record<string, unknown> = {};
    const encCfg = conn.encrypted_config as string | null;
    if (encCfg && isEncrypted(encCfg)) {
      const decrypted = await decrypt(encCfg, c.env.ENCRYPTION_KEY);
      existingConfig = decrypted ? JSON.parse(decrypted) : {};
    } else {
      existingConfig = JSON.parse(conn.config as string || '{}');
    }

    const mergedConfig = { ...existingConfig, ...body.config };
    const persisted = await persistErpConfig(mergedConfig, c.env.ENCRYPTION_KEY);
    updates.push('encrypted_config = ?');
    values.push(persisted.encryptedConfig);
    updates.push('config = ?');
    values.push(persisted.config);

    if (!persisted.encrypted && hasCredentials(mergedConfig) && persisted.skipReason) {
      await auditEncryptionSkipped(c.env.DB, tenantId, id, persisted.skipReason, 'PUT /connections/:id');
    }
  }

  if (updates.length > 0) {
    values.push(id, tenantId);
    await c.env.DB.prepare(`UPDATE erp_connections SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  }

  return c.json({ success: true });
});

// DELETE /api/erp/connections/:id
erp.delete('/connections/:id', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM erp_connections WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return c.json({ success: true });
});

// GET /api/erp/connections/:id/schemas — discovered field schemas for a
// connection, optionally filtered to one entity type via ?entity=invoices.
// Phase 1 of dynamic ERP-mapping intelligence: a customer can connect any
// supported ERP/subsystem and Atheon profiles the actual fields it sends
// (including custom Z-fields, Odoo modules, NetSuite custom segments).
// Phase 2 will use these profiles to drive the auto-mapper.
erp.get('/connections/:id/schemas', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const entity = c.req.query('entity');

  // Tenant ownership check — never expose another tenant's schema discovery.
  const conn = await c.env.DB.prepare(
    'SELECT id FROM erp_connections WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  const rows = await getDiscoveredSchemas(c.env.DB, tenantId, id, entity);

  // Group by entity_type for easier UI rendering.
  const byEntity: Record<string, typeof rows> = {};
  for (const r of rows) {
    if (!byEntity[r.entity_type]) byEntity[r.entity_type] = [];
    byEntity[r.entity_type].push(r);
  }

  return c.json({
    connectionId: id,
    entityCount: Object.keys(byEntity).length,
    fieldCount: rows.length,
    schemas: byEntity,
  });
});

// GET /api/erp/connections/:id/mappings — auto-mapper resolved field
// mappings for this connection (canonical → source). Optional ?entity=
// filter and ?status=active|suggested|all (default: all). Powers the
// review UI in Phase 3 and the read-back path here for Phase 2.
erp.get('/connections/:id/mappings', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const entity = c.req.query('entity');
  const status = (c.req.query('status') || 'all').toLowerCase();

  const conn = await c.env.DB.prepare(
    'SELECT id FROM erp_connections WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  let rows = await listAllMappings(c.env.DB, tenantId, id, entity);
  if (status === 'active' || status === 'suggested') {
    rows = rows.filter((r) => r.status === status);
  }

  // Group by canonical_field for the UI — under shared-savings, customers
  // need to see at a glance which canonical fields are mapped vs which
  // need attention.
  const byCanonical: Record<string, typeof rows> = {};
  for (const r of rows) {
    if (!byCanonical[r.canonical_field]) byCanonical[r.canonical_field] = [];
    byCanonical[r.canonical_field].push(r);
  }

  const activeCount = rows.filter((r) => r.status === 'active').length;
  const suggestedCount = rows.filter((r) => r.status === 'suggested').length;

  return c.json({
    connectionId: id,
    activeCount,
    suggestedCount,
    fieldCount: rows.length,
    mappings: byCanonical,
  });
});

// POST /api/erp/connections/:id/mappings/refresh — re-run the auto-mapper
// for a connection. Used after a customer adds new ERP fields and wants
// suggestions regenerated immediately rather than waiting for the next sync.
// Optional body { entity_type?: string } to scope to one entity.
erp.post('/connections/:id/mappings/refresh', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{ entity_type?: string }>().catch(() => ({} as { entity_type?: string }));
  const entityType = body.entity_type;

  const conn = await c.env.DB.prepare(
    'SELECT id FROM erp_connections WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  // Discover which entity types we have profiles for, then auto-map each.
  const entities = entityType
    ? [{ entity_type: entityType }]
    : (await c.env.DB.prepare(
        `SELECT DISTINCT entity_type FROM erp_connection_schemas
          WHERE tenant_id = ? AND connection_id = ?`
      ).bind(tenantId, id).all<{ entity_type: string }>()).results || [];

  let totalAuto = 0, totalSuggested = 0;
  for (const e of entities) {
    const r = await runAutoMapper(c.env.DB, tenantId, id, e.entity_type);
    totalAuto += r.autoApplied;
    totalSuggested += r.suggested;
    await invalidateMappingCache({ tenantId, connectionId: id, entityType: e.entity_type });
  }

  return c.json({
    connectionId: id,
    entitiesProcessed: entities.length,
    autoApplied: totalAuto,
    suggested: totalSuggested,
  });
});

// POST /api/erp/connections/:id/mappings/confirm — human confirms a mapping.
// Sets learned_from='human', status='active', confidence=1.0. Auto-mapper
// can no longer overwrite this mapping on subsequent runs (the ON CONFLICT
// guard in persistSuggestions protects 'human' rows).
//
// Body: { entity_type: string, canonical_field: string, source_field: string }
//
// Under shared-savings: this is the trust signal. A confirmed mapping flows
// directly into assessment + report numbers; the customer is on record
// agreeing this is the right field for this canonical value.
erp.post('/connections/:id/mappings/confirm', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const { data: body, errors } = await getValidatedJsonBody<{
    entity_type: string; canonical_field: string; source_field: string;
  }>(c, [
    { field: 'entity_type', type: 'string', required: true, minLength: 1 },
    { field: 'canonical_field', type: 'string', required: true, minLength: 1 },
    { field: 'source_field', type: 'string', required: true, minLength: 1 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const conn = await c.env.DB.prepare(
    'SELECT id FROM erp_connections WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  await persistSuggestions(c.env.DB, tenantId, id, body.entity_type, [{
    canonical_field: body.canonical_field as 'amount',
    source_field: body.source_field,
    confidence: 1.0,
    rationale: 'human-confirmed',
    learned_from: 'human',
  }]);
  await invalidateMappingCache({ tenantId, connectionId: id, entityType: body.entity_type }, c.env.CACHE);

  // Audit — under shared-savings, who confirmed which mapping is part of the
  // trail a customer can demand on dispute.
  const auth = c.get('auth') as AuthContext | undefined;
  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), tenantId, auth?.userId || null, 'erp.mapping.confirmed', 'erp', 'erp_field_mappings',
      JSON.stringify({ connectionId: id, ...body }), 'success',
    ).run();
  } catch { /* non-fatal */ }

  return c.json({ ok: true });
});

// POST /api/erp/connections/:id/mappings/reject — human rejects a mapping.
// Marks status='rejected' and learned_from='human' so the auto-mapper can't
// re-suggest the same (canonical, source) pair on subsequent runs.
erp.post('/connections/:id/mappings/reject', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const { data: body, errors } = await getValidatedJsonBody<{
    entity_type: string; canonical_field: string; source_field: string;
  }>(c, [
    { field: 'entity_type', type: 'string', required: true, minLength: 1 },
    { field: 'canonical_field', type: 'string', required: true, minLength: 1 },
    { field: 'source_field', type: 'string', required: true, minLength: 1 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const conn = await c.env.DB.prepare(
    'SELECT id FROM erp_connections WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  // Either the row exists and we mark it rejected, or it doesn't and we
  // insert a sentinel rejected row so the auto-mapper stops suggesting it.
  await c.env.DB.prepare(
    `INSERT INTO erp_field_mappings (
       id, tenant_id, connection_id, entity_type, canonical_field,
       source_field, confidence, learned_from, rationale, status
     ) VALUES (?, ?, ?, ?, ?, ?, 0, 'human', 'human-rejected', 'rejected')
     ON CONFLICT(tenant_id, connection_id, entity_type, canonical_field, source_field)
     DO UPDATE SET
       status = 'rejected', learned_from = 'human',
       rationale = 'human-rejected', updated_at = datetime('now')`
  ).bind(
    crypto.randomUUID(), tenantId, id, body.entity_type, body.canonical_field, body.source_field,
  ).run();
  await invalidateMappingCache({ tenantId, connectionId: id, entityType: body.entity_type }, c.env.CACHE);

  const auth = c.get('auth') as AuthContext | undefined;
  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), tenantId, auth?.userId || null, 'erp.mapping.rejected', 'erp', 'erp_field_mappings',
      JSON.stringify({ connectionId: id, ...body }), 'success',
    ).run();
  } catch { /* non-fatal */ }

  return c.json({ ok: true });
});

// GET /api/erp/connections/:id/process-profile — load (or first-time infer)
// the resolved process profile for a connection. The profile drives
// catalyst behaviour: 3-way-match flag, AP tolerance %, payment terms days,
// fiscal year start, etc. — so the same catalyst running for two customers
// uses each customer's actual rules instead of universal defaults.
//
// Under shared-savings: the customer can audit which rules each catalyst
// applied to compute their savings.
erp.get('/connections/:id/process-profile', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const conn = await c.env.DB.prepare(
    'SELECT id FROM erp_connections WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  let prof = await getProcessProfile(c.env.DB, tenantId, id);
  if (!prof) {
    const inferred = await inferProcessProfile(c.env.DB, tenantId, id);
    prof = { profile: inferred.profile, evidence: inferred.evidence, updatedAt: new Date().toISOString() };
  }
  return c.json({ connectionId: id, ...prof });
});

// POST /api/erp/connections/:id/process-profile/refresh — re-run inference.
// Customer may trigger after a config change in their ERP that wasn't yet
// reflected in the synced data.
erp.post('/connections/:id/process-profile/refresh', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const conn = await c.env.DB.prepare(
    'SELECT id FROM erp_connections WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);
  const inferred = await inferProcessProfile(c.env.DB, tenantId, id);
  return c.json({ connectionId: id, ...inferred });
});

// PUT /api/erp/connections/:id/process-profile — apply customer overrides.
// Each provided field is marked source='human' and protected from being
// overwritten by future inference runs. Audit-logged.
erp.put('/connections/:id/process-profile', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const conn = await c.env.DB.prepare(
    'SELECT id FROM erp_connections WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  const body = await c.req.json<Partial<ProcessProfile>>().catch(() => ({} as Partial<ProcessProfile>));
  const auth = c.get('auth') as AuthContext | undefined;
  const updated = await setProcessProfileOverrides(c.env.DB, tenantId, id, body, auth?.email || auth?.userId);

  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), tenantId, auth?.userId || null, 'erp.process_profile.override',
      'erp', 'erp_process_profiles', JSON.stringify({ connectionId: id, fields: Object.keys(body) }), 'success',
    ).run();
  } catch { /* non-fatal */ }

  return c.json({ connectionId: id, ...updated });
});

// GET /api/erp/connections/:id/baseline-comparison — diff the customer's
// process profile + discovered schema against the vanilla vendor baseline
// (SAP / Odoo / Xero supported in v1). Surfaces:
//   * profile deviations: where customer's tolerance/payment-terms/matching
//     mode differs from vendor recommendation, with rationale + source.
//   * schema deviations: vendor-standard fields the customer is NOT sending
//     (likely missing data) + custom fields that aren't in the vendor schema.
//   * alignment_score: 0-1 headline for the executive summary.
//
// This moves catalysts from "here's your data" to "here's how it compares to
// the vendor recommendation, and what to do about it".
erp.get('/connections/:id/baseline-comparison', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');

  const conn = await c.env.DB.prepare(
    `SELECT ec.id, ea.system as source_system FROM erp_connections ec
     JOIN erp_adapters ea ON ec.adapter_id = ea.id
     WHERE ec.id = ? AND ec.tenant_id = ?`
  ).bind(id, tenantId).first<{ id: string; source_system: string }>();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  const baseline = getVendorBaseline(conn.source_system);
  if (!baseline) {
    return c.json({
      connectionId: id,
      vendor: null,
      reason: `No vendor baseline available for "${conn.source_system}" — supported vendors: ${listSupportedVendors().join(', ')}`,
    });
  }

  // Pull current process profile (or default if absent)
  const profile = await loadProcessProfile(c.env.DB, tenantId, id);

  // Pull discovered schema grouped by entity → fields list
  const schemaRows = await getDiscoveredSchemas(c.env.DB, tenantId, id);
  const discoveredByEntity: Record<string, string[]> = {};
  for (const r of schemaRows) {
    if (!discoveredByEntity[r.entity_type]) discoveredByEntity[r.entity_type] = [];
    discoveredByEntity[r.entity_type].push(r.source_field);
  }

  const profileDeviations = compareProfileToBaseline(profile, baseline);
  const schemaDeviations = compareSchemaToBaseline(discoveredByEntity, baseline);
  const recCount = Object.keys(baseline.profile_recommendations).length;
  const alignmentScore = calculateAlignmentScore(profileDeviations, recCount);

  return c.json({
    connectionId: id,
    vendor: baseline.vendor,
    product: baseline.product,
    profile_deviations: profileDeviations,
    schema_deviations: schemaDeviations,
    flows: baseline.flows,
    alignment_score: Number(alignmentScore.toFixed(2)),
  });
});

// POST /api/erp/connections/:id/actions — dispatch a write-back action.
// Honours the catalyst's autonomy_tier — read-only blocks; assisted +
// transactional queue for HITL approval; autonomous executes (with
// safety threshold for high-value actions). Always supports a
// `previewOnly` flag so customers can see exactly what would be sent
// to their ERP before authorizing.
//
// Body: {
//   idempotency_key, type, catalyst_name, cluster_id,
//   payload, value_zar?, source_finding_id?, previewOnly?, reasoning?
// }
erp.post('/connections/:id/actions', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');

  const conn = await c.env.DB.prepare(
    `SELECT ec.id, ea.system as vendor FROM erp_connections ec
     JOIN erp_adapters ea ON ec.adapter_id = ea.id
     WHERE ec.id = ? AND ec.tenant_id = ?`
  ).bind(id, tenantId).first<{ id: string; vendor: string }>();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  type ActionPostBody = {
    idempotency_key?: string; type?: string;
    catalyst_name?: string; cluster_id?: string;
    payload?: Record<string, unknown>;
    value_zar?: number; source_finding_id?: string;
    previewOnly?: boolean; reasoning?: string;
    autonomy_tier?: string;
  };
  const body = await c.req.json<ActionPostBody>().catch(() => ({} as ActionPostBody));

  if (!body.idempotency_key || !body.type || !body.catalyst_name || !body.cluster_id || !body.payload) {
    return c.json({ error: 'Missing required fields: idempotency_key, type, catalyst_name, cluster_id, payload' }, 400);
  }

  const action: CatalystWriteAction = {
    idempotency_key: body.idempotency_key,
    type: body.type as ActionType,
    tenantId,
    connectionId: id,
    catalystName: body.catalyst_name,
    clusterId: body.cluster_id,
    payload: body.payload,
    value_zar: body.value_zar,
    source_finding_id: body.source_finding_id,
    previewOnly: body.previewOnly === true,
    reasoning: body.reasoning,
  };

  // Autonomy tier defaults to 'assisted' when not supplied — safe default
  // (queue for approval). Real production callers (catalyst handlers)
  // pass the cluster's configured tier.
  const tier: ActionAutonomyTier = (body.autonomy_tier as ActionAutonomyTier) || 'assisted';

  const outcome = await dispatchWriteAction(c.env.DB, conn.vendor, tier, action, { db: c.env.DB });
  return c.json(outcome);
});

// GET /api/erp/connections/:id/actions — list write-back actions
// (pending, approved, completed, rejected). Filter via ?status= and ?limit=.
erp.get('/connections/:id/actions', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const conn = await c.env.DB.prepare(
    'SELECT id FROM erp_connections WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  const status = c.req.query('status');
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10) || 100, 500);

  const where = status
    ? `WHERE tenant_id = ? AND input_data LIKE ? AND status = ?`
    : `WHERE tenant_id = ? AND input_data LIKE ?`;
  const stmt = status
    ? c.env.DB.prepare(`SELECT id, catalyst_name, action, status, input_data, output_data, reasoning, approved_by, created_at, completed_at FROM catalyst_actions ${where} ORDER BY created_at DESC LIMIT ?`).bind(tenantId, `%"connectionId":"${id}"%`, status, limit)
    : c.env.DB.prepare(`SELECT id, catalyst_name, action, status, input_data, output_data, reasoning, approved_by, created_at, completed_at FROM catalyst_actions ${where} ORDER BY created_at DESC LIMIT ?`).bind(tenantId, `%"connectionId":"${id}"%`, limit);

  const res = await stmt.all<{
    id: string; catalyst_name: string; action: string; status: string;
    input_data: string; output_data: string | null; reasoning: string | null;
    approved_by: string | null; created_at: string; completed_at: string | null;
  }>();
  const rows = (res.results || []).map((r) => {
    let parsedInput: Partial<CatalystWriteAction> = {};
    try { parsedInput = JSON.parse(r.input_data); } catch { /* tolerate */ }
    let parsedOutput: unknown = null;
    try { if (r.output_data) parsedOutput = JSON.parse(r.output_data); } catch { /* tolerate */ }
    return {
      id: r.id,
      catalyst_name: r.catalyst_name,
      action_type: r.action,
      status: r.status,
      value_zar: parsedInput.value_zar || 0,
      idempotency_key: parsedInput.idempotency_key,
      payload: parsedInput.payload,
      reasoning: r.reasoning,
      output: parsedOutput,
      approved_by: r.approved_by,
      created_at: r.created_at,
      completed_at: r.completed_at,
    };
  });
  return c.json({ connectionId: id, total: rows.length, actions: rows });
});

// POST /api/erp/connections/:id/actions/:actionId/approve — approve a
// queued action and execute it. Audit-logged with the approving user.
erp.post('/connections/:id/actions/:actionId/approve', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const actionId = c.req.param('actionId');

  const conn = await c.env.DB.prepare(
    `SELECT ec.id, ea.system as vendor FROM erp_connections ec
     JOIN erp_adapters ea ON ec.adapter_id = ea.id
     WHERE ec.id = ? AND ec.tenant_id = ?`
  ).bind(id, tenantId).first<{ id: string; vendor: string }>();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  const auth = c.get('auth') as AuthContext | undefined;
  const approver = auth?.email || auth?.userId || 'unknown';
  const outcome = await approveQueuedAction(c.env.DB, actionId, tenantId, approver, conn.vendor, { db: c.env.DB });

  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), tenantId, auth?.userId || null, 'erp.write_action.approved', 'erp', 'catalyst_actions',
      JSON.stringify({ actionId, status: outcome.status }), 'success',
    ).run();
  } catch { /* non-fatal */ }

  return c.json(outcome);
});

// POST /api/erp/connections/:id/actions/:actionId/reject — reject a queued action.
erp.post('/connections/:id/actions/:actionId/reject', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const actionId = c.req.param('actionId');
  const conn = await c.env.DB.prepare(
    'SELECT id FROM erp_connections WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
  const auth = c.get('auth') as AuthContext | undefined;
  const rejector = auth?.email || auth?.userId || 'unknown';
  const outcome = await rejectQueuedAction(c.env.DB, actionId, tenantId, rejector, body.reason);

  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), tenantId, auth?.userId || null, 'erp.write_action.rejected', 'erp', 'catalyst_actions',
      JSON.stringify({ actionId, reason: body.reason }), 'success',
    ).run();
  } catch { /* non-fatal */ }

  return c.json(outcome);
});

// GET /api/erp/actions — tenant-wide list of write-back actions across
// all connections. Powers the Dashboard pending-action count, the Apex
// briefing's "actions awaiting your approval" card, and the Pulse
// throughput metric. Filterable by ?status= and ?limit=.
erp.get('/actions', async (c) => {
  const tenantId = getTenantId(c);
  const status = c.req.query('status');
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 500);

  const where = status ? `WHERE tenant_id = ? AND status = ?` : `WHERE tenant_id = ?`;
  const stmt = status
    ? c.env.DB.prepare(`SELECT id, catalyst_name, action, status, action_type, value_zar, source_finding_id, idempotency_key, connection_id, output_data, reasoning, approved_by, created_at, completed_at FROM catalyst_actions ${where} ORDER BY created_at DESC LIMIT ?`).bind(tenantId, status, limit)
    : c.env.DB.prepare(`SELECT id, catalyst_name, action, status, action_type, value_zar, source_finding_id, idempotency_key, connection_id, output_data, reasoning, approved_by, created_at, completed_at FROM catalyst_actions ${where} ORDER BY created_at DESC LIMIT ?`).bind(tenantId, limit);
  const res = await stmt.all<{
    id: string; catalyst_name: string; action: string; status: string;
    action_type: string | null; value_zar: number | null; source_finding_id: string | null;
    idempotency_key: string | null; connection_id: string | null;
    output_data: string | null; reasoning: string | null;
    approved_by: string | null; created_at: string; completed_at: string | null;
  }>();
  const rows = (res.results || []).map((r) => {
    let parsedOutput: unknown = null;
    try { if (r.output_data) parsedOutput = JSON.parse(r.output_data); } catch { /* tolerate */ }
    return {
      id: r.id,
      catalyst_name: r.catalyst_name,
      action_type: r.action_type || r.action,
      status: r.status,
      value_zar: r.value_zar || 0,
      source_finding_id: r.source_finding_id,
      idempotency_key: r.idempotency_key,
      connection_id: r.connection_id,
      output: parsedOutput,
      reasoning: r.reasoning,
      approved_by: r.approved_by,
      created_at: r.created_at,
      completed_at: r.completed_at,
    };
  });
  return c.json({ tenantId, total: rows.length, actions: rows });
});

// GET /api/erp/actions/summary — aggregate counts + values per status.
// Designed for Dashboard / Apex headline numbers.
erp.get('/actions/summary', async (c) => {
  const tenantId = getTenantId(c);
  const result = await c.env.DB.prepare(
    `SELECT status, COUNT(*) as count, COALESCE(SUM(value_zar), 0) as value_zar
       FROM catalyst_actions
      WHERE tenant_id = ?
      GROUP BY status`
  ).bind(tenantId).all<{ status: string; count: number; value_zar: number }>();
  const summary = {
    pending_approval_count: 0,
    pending_approval_value_zar: 0,
    completed_count: 0,
    completed_value_zar: 0,
    rejected_count: 0,
    rejected_value_zar: 0,
    failed_count: 0,
    failed_value_zar: 0,
    previewed_count: 0,
    previewed_value_zar: 0,
    total_count: 0,
    total_value_zar: 0,
  };
  for (const r of result.results || []) {
    const key = r.status as keyof typeof summary;
    summary.total_count += r.count;
    summary.total_value_zar += r.value_zar || 0;
    const countKey = `${r.status}_count` as keyof typeof summary;
    const valueKey = `${r.status}_value_zar` as keyof typeof summary;
    if (countKey in summary) {
      (summary[countKey] as number) = r.count;
      (summary[valueKey] as number) = r.value_zar || 0;
    }
    void key; // type-only marker
  }
  return c.json({ tenantId, summary });
});

// GET /api/erp/companies — list ERP companies for the authenticated tenant.
// Used by the frontend company-switcher (PR #219/#220/#232). Read-only.
erp.get('/companies', async (c) => {
  const tenantId = getTenantId(c);
  const result = await c.env.DB.prepare(
    "SELECT id, external_id, source_system, code, name, legal_name, currency, country, is_primary, status FROM erp_companies WHERE tenant_id = ? AND status = 'active' ORDER BY is_primary DESC, name ASC"
  ).bind(tenantId).all();
  return c.json({ companies: result.results, total: result.results.length });
});

// GET /api/erp/canonical - list canonical API endpoints
erp.get('/canonical', async (c) => {
  const domain = c.req.query('domain');

  let query = 'SELECT * FROM canonical_endpoints';
  const binds: unknown[] = [];

  if (domain) { query += ' WHERE domain = ?'; binds.push(domain); }
  query += ' ORDER BY domain, path';

  const results = binds.length > 0
    ? await c.env.DB.prepare(query).bind(...binds).all()
    : await c.env.DB.prepare(query).all();

  const formatted = results.results.map((ep: Record<string, unknown>) => ({
    id: ep.id,
    domain: ep.domain,
    path: ep.path,
    method: ep.method,
    description: ep.description,
    rateLimit: ep.rate_limit,
    version: ep.version,
  }));

  return c.json({ endpoints: formatted, total: formatted.length });
});

// POST /api/erp/sync/:connection_id (trigger sync)
erp.post('/sync/:connection_id', async (c) => {
  const tenantId = getTenantId(c);
  const connectionId = c.req.param('connection_id');

  const conn = await c.env.DB.prepare(
    'SELECT ec.*, ea.system as adapter_system FROM erp_connections ec JOIN erp_adapters ea ON ec.adapter_id = ea.id WHERE ec.id = ? AND ec.tenant_id = ?'
  ).bind(connectionId, tenantId).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  // Read from encrypted_config first, fallback to config
  const encCfgSync = conn.encrypted_config as string | null;
  let config: Record<string, unknown> = {};
  if (encCfgSync && isEncrypted(encCfgSync)) {
    const decrypted = await decrypt(encCfgSync, c.env.ENCRYPTION_KEY);
    config = decrypted ? JSON.parse(decrypted) : {};
  } else {
    config = JSON.parse(conn.config as string || '{}');
  }
  const adapter = getERPAdapter(conn.adapter_system as string);

  if (adapter) {
    // Decrypt stored credentials
    const decryptedPassword = config.password && isEncrypted(config.password as string)
      ? (await decrypt(config.password as string, c.env.ENCRYPTION_KEY)) || ''
      : (config.password as string) || '';
    const decryptedSecret = config.client_secret && isEncrypted(config.client_secret as string)
      ? (await decrypt(config.client_secret as string, c.env.ENCRYPTION_KEY)) || ''
      : (config.client_secret as string) || '';

    // Real sync via ERP adapter
    const credentials: ERPCredentials = {
      clientId: (config.client_id as string) || '',
      clientSecret: decryptedSecret,
      baseUrl: (config.base_url as string) || '',
      username: (config.username as string) || '',
      password: decryptedPassword,
      apiKey: (config.api_key as string) || '',
    };

    let decryptedToken = '';
    if (config.access_token) {
      decryptedToken = isEncrypted(config.access_token as string)
        ? (await decrypt(config.access_token as string, c.env.ENCRYPTION_KEY)) || ''
        : config.access_token as string;
    } else if (credentials.username && credentials.password && credentials.baseUrl) {
      // Session-based auth (e.g. Odoo): authenticate on-the-fly
      try {
        const tokenResp = await adapter.exchangeToken(credentials, '');
        decryptedToken = tokenResp.access_token;
      } catch (err) {
        return c.json({ error: `Authentication failed: ${(err as Error).message}` }, 401);
      }
    } else {
      return c.json({ error: 'No access token or credentials configured' }, 400);
    }

    const defaultEntities = (conn.adapter_system as string).toLowerCase() === 'odoo'
      ? ['customers', 'suppliers', 'invoices', 'sales_orders', 'purchase_orders', 'products', 'employees', 'gl_accounts']
      : ['accounts', 'contacts'];
    const entities = (config.sync_entities as string[]) || defaultEntities;
    // Spec 7 CIRCUIT-2: Wrap syncData with circuit breaker
    let result: SyncResult;
    try {
      result = await withCircuitBreaker(c.env.CACHE, connectionId, () => adapter.syncData(credentials, decryptedToken, entities));
    } catch (err) {
      const msg = (err as Error).message;
      logError('erp.sync.failed', err, {
        requestId: c.get('requestId'),
        tenantId,
        layer: 'erp',
        action: 'erp.sync.failed',
      }, { connectionId, adapterSystem: conn.adapter_system, circuitBreakerOpen: msg.includes('Circuit breaker OPEN') });
      if (msg.includes('Circuit breaker OPEN')) {
        return c.json({ error: msg, circuitBreaker: 'OPEN' }, 503);
      }
      return c.json({ error: `Sync failed: ${msg}` }, 500);
    }

    // Structured observability log for successful sync (partial or full)
    logInfo('erp.sync.completed', {
      requestId: c.get('requestId'),
      tenantId,
      layer: 'erp',
      action: 'erp.sync.completed',
    }, {
      connectionId,
      adapterSystem: conn.adapter_system,
      recordsSynced: result.recordsSynced,
      recordsFailed: result.recordsFailed,
      errorCount: result.errors.length,
      durationMs: result.duration,
    });

    // 3.12: Write synced records to canonical tables (with Vectorize + AI for RAG embedding)
    // v57: pass connectionId so the schema profiler can attribute discovered
    // fields back to this specific ERP/subsystem instance (a customer can
    // have N connections active at once).
    // v59: pass KV so the LLM mapping fallback can cache per-field suggestions
    // and skip re-querying the LLM when sample values haven't changed.
    await writeToCanonicalTables(c.env.DB, tenantId, conn.adapter_system as string, result, c.env.VECTORIZE, c.env.AI, connectionId, c.env.CACHE);

    await c.env.DB.prepare(
      'UPDATE erp_connections SET last_sync = datetime(\'now\'), records_synced = records_synced + ?, status = ? WHERE id = ? AND tenant_id = ?'
    ).bind(result.recordsSynced, result.errors.length > 0 ? 'partial' : 'connected', connectionId, tenantId).run();

    return c.json({
      connectionId,
      recordsSynced: result.recordsSynced,
      recordsFailed: result.recordsFailed,
      entities: result.entities,
      errors: result.errors,
      duration: result.duration,
      syncedAt: new Date().toISOString(),
      status: result.errors.length > 0 ? 'partial' : 'completed',
    });
  }

  // No adapter or credentials available — return an error instead of faking data
  return c.json({
    error: 'No ERP adapter or credentials configured for this connection. Please configure credentials on the Integrations page before syncing.',
    connectionId,
    status: 'failed',
  }, 400);
});

// POST /api/erp/connections/:id/test - Test ERP connection
erp.post('/connections/:id/test', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');

  const conn = await c.env.DB.prepare(
    'SELECT ec.*, ea.system as adapter_system FROM erp_connections ec JOIN erp_adapters ea ON ec.adapter_id = ea.id WHERE ec.id = ? AND ec.tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  // Read from encrypted_config first, fallback to config
  const encCfgTest = conn.encrypted_config as string | null;
  let testConfig: Record<string, unknown> = {};
  if (encCfgTest && isEncrypted(encCfgTest)) {
    const decrypted = await decrypt(encCfgTest, c.env.ENCRYPTION_KEY);
    testConfig = decrypted ? JSON.parse(decrypted) : {};
  } else {
    testConfig = JSON.parse(conn.config as string || '{}');
  }
  const adapter = getERPAdapter(conn.adapter_system as string);

  if (!adapter) {
    return c.json({ connected: false, message: `No adapter found for system: ${conn.adapter_system}` });
  }

  // Decrypt stored credentials
  const decryptedPassword = testConfig.password && isEncrypted(testConfig.password as string)
    ? (await decrypt(testConfig.password as string, c.env.ENCRYPTION_KEY)) || ''
    : (testConfig.password as string) || '';
  const decryptedSecret = testConfig.client_secret && isEncrypted(testConfig.client_secret as string)
    ? (await decrypt(testConfig.client_secret as string, c.env.ENCRYPTION_KEY)) || ''
    : (testConfig.client_secret as string) || '';

  const credentials: ERPCredentials = {
    clientId: (testConfig.client_id as string) || '',
    clientSecret: decryptedSecret,
    baseUrl: (testConfig.base_url as string) || '',
    username: (testConfig.username as string) || '',
    password: decryptedPassword,
    apiKey: (testConfig.api_key as string) || '',
  };

  let decryptedToken = '';
  if (testConfig.access_token) {
    decryptedToken = isEncrypted(testConfig.access_token as string)
      ? (await decrypt(testConfig.access_token as string, c.env.ENCRYPTION_KEY)) || ''
      : testConfig.access_token as string;
  } else if (credentials.username && credentials.password && credentials.baseUrl) {
    // Session-based auth (e.g. Odoo): pass credentials directly to testConnection
    // which handles its own authentication internally — no need to call exchangeToken first
    decryptedToken = '';
  } else {
    return c.json({ connected: false, message: 'No access token or credentials configured. Complete OAuth flow or provide credentials.' });
  }

  // Spec 7 CIRCUIT-2: Wrap testConnection with circuit breaker
  let result: { connected: boolean; version?: string; message: string };
  try {
    result = await withCircuitBreaker(c.env.CACHE, id, () => adapter.testConnection(credentials, decryptedToken));
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Circuit breaker OPEN')) {
      return c.json({ connected: false, message: msg, circuitBreaker: 'OPEN' });
    }
    result = { connected: false, message: msg };
  }

  // Update connection status
  await c.env.DB.prepare(
    'UPDATE erp_connections SET status = ? WHERE id = ? AND tenant_id = ?'
  ).bind(result.connected ? 'connected' : 'error', id, tenantId).run();

  return c.json(result);
});

// POST /api/erp/oauth/authorize - Start OAuth flow for an ERP
erp.post('/oauth/authorize', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    connection_id: string; client_id: string; client_secret: string; base_url: string;
    auth_url?: string; token_url?: string; scope?: string;
  }>(c, [
    { field: 'connection_id', type: 'string', required: true, minLength: 1 },
    { field: 'client_id', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'client_secret', type: 'string', required: true, minLength: 1 },
    { field: 'base_url', type: 'url', required: true },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const conn = await c.env.DB.prepare(
    'SELECT ec.*, ea.system as adapter_system FROM erp_connections ec JOIN erp_adapters ea ON ec.adapter_id = ea.id WHERE ec.id = ? AND ec.tenant_id = ?'
  ).bind(body.connection_id, tenantId).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  const adapter = getERPAdapter(conn.adapter_system as string);
  if (!adapter) return c.json({ error: `No adapter for system: ${conn.adapter_system}` }, 400);

  const state = crypto.randomUUID();
  const credentials: ERPCredentials = {
    clientId: body.client_id,
    clientSecret: body.client_secret,
    baseUrl: body.base_url,
    authUrl: body.auth_url,
    tokenUrl: body.token_url,
    scope: body.scope,
  };

  const authUrl = adapter.getAuthUrl(credentials, state);

  // Store OAuth state for callback verification
  await c.env.CACHE.put(`oauth_state:${state}`, JSON.stringify({
    connectionId: body.connection_id,
    credentials,
    system: conn.adapter_system,
  }), { expirationTtl: 600 });

  // Store credentials in connection config (encrypted)
  // Read from encrypted_config first, fallback to config
  const encCfgOauth = conn.encrypted_config as string | null;
  let existingOauthConfig: Record<string, unknown> = {};
  if (encCfgOauth && isEncrypted(encCfgOauth)) {
    const decrypted = await decrypt(encCfgOauth, c.env.ENCRYPTION_KEY);
    existingOauthConfig = decrypted ? JSON.parse(decrypted) : {};
  } else {
    existingOauthConfig = JSON.parse(conn.config as string || '{}');
  }
  const mergedOauthConfig = {
    ...existingOauthConfig,
    client_id: body.client_id,
    client_secret: body.client_secret,
    base_url: body.base_url,
    auth_url: body.auth_url,
    token_url: body.token_url,
  };
  // §8.3: Encrypt the entire config blob so isEncrypted() returns true on read.
  // Falls back to plaintext + audit if ENCRYPTION_KEY is missing.
  const persistedOauth = await persistErpConfig(mergedOauthConfig, c.env.ENCRYPTION_KEY);
  await c.env.DB.prepare(
    'UPDATE erp_connections SET encrypted_config = ?, config = ?, status = ? WHERE id = ? AND tenant_id = ?'
  ).bind(persistedOauth.encryptedConfig, persistedOauth.config, 'authorizing', body.connection_id, tenantId).run();

  if (!persistedOauth.encrypted && persistedOauth.skipReason) {
    await auditEncryptionSkipped(c.env.DB, tenantId, body.connection_id, persistedOauth.skipReason, 'POST /oauth/authorize');
  }

  return c.json({ authUrl, state });
});

// POST /api/erp/oauth/callback - Complete OAuth token exchange
erp.post('/oauth/callback', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{ code: string; state: string }>(c, [
    { field: 'code', type: 'string', required: true, minLength: 1, maxLength: 4096 },
    { field: 'state', type: 'string', required: true, minLength: 1, maxLength: 4096 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const stateData = await c.env.CACHE.get(`oauth_state:${body.state}`);
  if (!stateData) return c.json({ error: 'Invalid or expired OAuth state' }, 400);

  const { connectionId, credentials, system } = JSON.parse(stateData) as {
    connectionId: string; credentials: ERPCredentials; system: string;
  };

  const adapter = getERPAdapter(system);
  if (!adapter) return c.json({ error: `No adapter for system: ${system}` }, 400);

  try {
    const tokenResponse = await adapter.exchangeToken(credentials, body.code);

    // Update connection with tokens — read from encrypted_config first
    const conn = await c.env.DB.prepare('SELECT encrypted_config, config FROM erp_connections WHERE id = ? AND tenant_id = ?').bind(connectionId, tenantId).first();
    const encCfgCallback = conn?.encrypted_config as string | null;
    let existingConfig: Record<string, unknown> = {};
    if (encCfgCallback && isEncrypted(encCfgCallback)) {
      const decrypted = await decrypt(encCfgCallback, c.env.ENCRYPTION_KEY);
      existingConfig = decrypted ? JSON.parse(decrypted) : {};
    } else {
      existingConfig = JSON.parse(conn?.config as string || '{}');
    }

    // Merge tokens into config and encrypt entire blob (§8.3 fallback-safe)
    const mergedTokenConfig = {
      ...existingConfig,
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token || undefined,
      token_type: tokenResponse.token_type,
      token_expires_at: new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString(),
    };
    const persistedToken = await persistErpConfig(mergedTokenConfig, c.env.ENCRYPTION_KEY);

    await c.env.DB.prepare(
      'UPDATE erp_connections SET encrypted_config = ?, config = ?, status = ?, connected_at = datetime(\'now\') WHERE id = ? AND tenant_id = ?'
    ).bind(persistedToken.encryptedConfig, persistedToken.config, 'connected', connectionId, tenantId).run();

    if (!persistedToken.encrypted && persistedToken.skipReason) {
      await auditEncryptionSkipped(c.env.DB, tenantId, connectionId, persistedToken.skipReason, 'POST /oauth/callback');
    }

    // Clean up state
    await c.env.CACHE.delete(`oauth_state:${body.state}`);

    return c.json({ success: true, connectionId, status: 'connected' });
  } catch (err) {
    return c.json({ error: `Token exchange failed: ${(err as Error).message}` }, 500);
  }
});

// Spec 7 CIRCUIT-3: GET /api/erp/connections/:id/circuit - Get circuit breaker state
erp.get('/connections/:id/circuit', async (c) => {
  const id = c.req.param('id');
  const state = await getCircuitBreakerState(c.env.CACHE, id);
  return c.json(state);
});

// GET /api/v1/erp/connections/health — per-connection sync health aggregation
// ═══
// Read-only aggregation over existing erp_connections + audit_log + circuit
// breaker KV state. Admin+ only (enforced by the platform-admin route prefix
// middleware in index.ts). Scoped to the caller's tenant (superadmin may cross
// tenants via ?tenant_id=).
erp.get('/connections/health', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'No tenant context' }, 400);

  try {
    const results = await c.env.DB.prepare(
      'SELECT ec.id, ec.name, ec.status, ec.last_sync, ec.records_synced, ec.connected_at, ea.name as adapter_name, ea.system as adapter_system FROM erp_connections ec LEFT JOIN erp_adapters ea ON ec.adapter_id = ea.id WHERE ec.tenant_id = ? ORDER BY ec.name ASC',
    ).bind(tenantId).all();

    const connections = await Promise.all(((results.results || []) as Array<Record<string, unknown>>).map(async (conn) => {
      const connId = String(conn.id);
      // Circuit breaker state — from KV, per-connection.
      const circuit = await getCircuitBreakerState(c.env.CACHE, connId).catch(() => ({ state: 'CLOSED', failures: 0, openedAt: null, lastAttempt: null }));

      // Error count from audit_log over the last 30 days.
      let errorsLast30d = 0;
      try {
        const errRow = await c.env.DB.prepare(
          "SELECT COUNT(*) as count FROM audit_log WHERE tenant_id = ? AND action LIKE 'erp.sync.failed%' AND resource = ? AND created_at > datetime('now', '-30 days')",
        ).bind(tenantId, connId).first();
        errorsLast30d = Number((errRow as Record<string, unknown>)?.count || 0);
      } catch { /* non-fatal */ }

      // Freshness score from last_sync age in hours.
      const lastSync = conn.last_sync ? String(conn.last_sync) : null;
      let freshness: 'fresh' | 'stale' | 'cold' = 'cold';
      let hoursSinceSync: number | null = null;
      if (lastSync) {
        const syncMs = new Date(lastSync).getTime();
        if (!Number.isNaN(syncMs)) {
          hoursSinceSync = (Date.now() - syncMs) / (1000 * 60 * 60);
          if (hoursSinceSync <= 1) freshness = 'fresh';
          else if (hoursSinceSync <= 24) freshness = 'stale';
          else freshness = 'cold';
        }
      }

      return {
        id: connId,
        name: conn.name ? String(conn.name) : '',
        adapter_name: conn.adapter_name ? String(conn.adapter_name) : null,
        adapter_system: conn.adapter_system ? String(conn.adapter_system) : null,
        status: conn.status ? String(conn.status) : 'unknown',
        lastSync,
        recordsSynced: Number(conn.records_synced || 0),
        circuitState: circuit.state,
        circuitFailures: circuit.failures,
        errorsLast30d,
        hoursSinceSync,
        freshness,
        connectedAt: conn.connected_at ? String(conn.connected_at) : null,
      };
    }));

    return c.json({ connections, timestamp: new Date().toISOString() });
  } catch (err) {
    logError('erp.connections.health', err as Error);
    return c.json({ error: 'Failed to aggregate integration health', details: (err as Error).message }, 500);
  }
});

// GET /api/erp/systems - List available ERP systems (from connector registry)
erp.get('/systems', (c) => {
  const systems = listERPAdapters();
  return c.json({ systems });
});

// ══════════════════════════════════════════════════════════
// Canonical ERP Data APIs — Query synced data across all ERP systems
// ══════════════════════════════════════════════════════════

// GET /api/erp/data/customers
erp.get('/data/customers', async (c) => {
  const tenantId = getTenantId(c);
  const source = c.req.query('source_system');
  const group = c.req.query('customer_group');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  let query = 'SELECT * FROM erp_customers WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];
  if (source) { query += ' AND source_system = ?'; binds.push(source); }
  if (group) { query += ' AND customer_group = ?'; binds.push(group); }
  query += ' ORDER BY name ASC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const results = await c.env.DB.prepare(query).bind(...binds).all();
  const countQuery = source
    ? await c.env.DB.prepare('SELECT COUNT(*) as total FROM erp_customers WHERE tenant_id = ? AND source_system = ?').bind(tenantId, source).first<{ total: number }>()
    : await c.env.DB.prepare('SELECT COUNT(*) as total FROM erp_customers WHERE tenant_id = ?').bind(tenantId).first<{ total: number }>();

  return c.json({ customers: results.results, total: countQuery?.total || 0, limit, offset });
});

// GET /api/erp/data/suppliers
erp.get('/data/suppliers', async (c) => {
  const tenantId = getTenantId(c);
  const source = c.req.query('source_system');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  let query = 'SELECT * FROM erp_suppliers WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];
  if (source) { query += ' AND source_system = ?'; binds.push(source); }
  query += ' ORDER BY name ASC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const results = await c.env.DB.prepare(query).bind(...binds).all();
  const total = await c.env.DB.prepare('SELECT COUNT(*) as total FROM erp_suppliers WHERE tenant_id = ?').bind(tenantId).first<{ total: number }>();

  return c.json({ suppliers: results.results, total: total?.total || 0, limit, offset });
});

// GET /api/erp/data/products
erp.get('/data/products', async (c) => {
  const tenantId = getTenantId(c);
  const category = c.req.query('category');
  const warehouse = c.req.query('warehouse');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  let query = 'SELECT * FROM erp_products WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];
  if (category) { query += ' AND category = ?'; binds.push(category); }
  if (warehouse) { query += ' AND warehouse = ?'; binds.push(warehouse); }
  query += ' ORDER BY sku ASC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const results = await c.env.DB.prepare(query).bind(...binds).all();
  const total = await c.env.DB.prepare('SELECT COUNT(*) as total FROM erp_products WHERE tenant_id = ?').bind(tenantId).first<{ total: number }>();

  return c.json({ products: results.results, total: total?.total || 0, limit, offset });
});

// GET /api/erp/data/invoices
erp.get('/data/invoices', async (c) => {
  const tenantId = getTenantId(c);
  const status = c.req.query('status');
  const source = c.req.query('source_system');
  const customerId = c.req.query('customer_id');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  let query = 'SELECT * FROM erp_invoices WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];
  if (status) { query += ' AND status = ?'; binds.push(status); }
  if (source) { query += ' AND source_system = ?'; binds.push(source); }
  if (customerId) { query += ' AND customer_id = ?'; binds.push(customerId); }
  query += ' ORDER BY invoice_date DESC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const results = await c.env.DB.prepare(query).bind(...binds).all();
  const total = await c.env.DB.prepare('SELECT COUNT(*) as total FROM erp_invoices WHERE tenant_id = ?').bind(tenantId).first<{ total: number }>();

  // Summary stats
  const stats = await c.env.DB.prepare(`
    SELECT 
      COUNT(*) as invoice_count,
      SUM(total) as total_value,
      SUM(amount_paid) as total_paid,
      SUM(amount_due) as total_outstanding,
      SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent_count,
      SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft_count,
      SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partial_count
    FROM erp_invoices WHERE tenant_id = ?
  `).bind(tenantId).first();

  return c.json({ invoices: results.results, total: total?.total || 0, stats, limit, offset });
});

// GET /api/erp/data/purchase-orders
erp.get('/data/purchase-orders', async (c) => {
  const tenantId = getTenantId(c);
  const status = c.req.query('status');
  const supplierId = c.req.query('supplier_id');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  let query = 'SELECT * FROM erp_purchase_orders WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];
  if (status) { query += ' AND status = ?'; binds.push(status); }
  if (supplierId) { query += ' AND supplier_id = ?'; binds.push(supplierId); }
  query += ' ORDER BY order_date DESC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const results = await c.env.DB.prepare(query).bind(...binds).all();
  const total = await c.env.DB.prepare('SELECT COUNT(*) as total FROM erp_purchase_orders WHERE tenant_id = ?').bind(tenantId).first<{ total: number }>();

  return c.json({ purchaseOrders: results.results, total: total?.total || 0, limit, offset });
});

// GET /api/erp/data/gl-accounts
erp.get('/data/gl-accounts', async (c) => {
  const tenantId = getTenantId(c);
  const accountType = c.req.query('account_type');

  let query = 'SELECT * FROM erp_gl_accounts WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];
  if (accountType) { query += ' AND account_type = ?'; binds.push(accountType); }
  query += ' ORDER BY account_code ASC';

  const results = binds.length > 1
    ? await c.env.DB.prepare(query).bind(...binds).all()
    : await c.env.DB.prepare(query).bind(tenantId).all();

  // Calculate totals by type
  const summary = await c.env.DB.prepare(`
    SELECT account_type, COUNT(*) as count, SUM(balance) as total_balance
    FROM erp_gl_accounts WHERE tenant_id = ?
    GROUP BY account_type ORDER BY account_type
  `).bind(tenantId).all();

  return c.json({ accounts: results.results, total: results.results.length, summary: summary.results });
});

// GET /api/erp/data/journal-entries
erp.get('/data/journal-entries', async (c) => {
  const tenantId = getTenantId(c);
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  const results = await c.env.DB.prepare(
    'SELECT * FROM erp_journal_entries WHERE tenant_id = ? ORDER BY journal_date DESC LIMIT ? OFFSET ?'
  ).bind(tenantId, limit, offset).all();
  const total = await c.env.DB.prepare('SELECT COUNT(*) as total FROM erp_journal_entries WHERE tenant_id = ?').bind(tenantId).first<{ total: number }>();

  return c.json({ journalEntries: results.results, total: total?.total || 0, limit, offset });
});

/**
 * Phase 1.2: PII masking helper — mask sensitive strings (show last 4 chars)
 */
function maskPII(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '****';
  if (value.length <= 4) return '****';
  return '****' + value.slice(-4);
}

/**
 * Phase 1.2: Salary range masking — show salary as a range bracket
 */
function maskSalary(salary: unknown): string {
  const val = typeof salary === 'number' ? salary : 0;
  if (val <= 0) return 'Not disclosed';
  if (val < 10000) return 'R0 - R10,000';
  if (val < 25000) return 'R10,000 - R25,000';
  if (val < 50000) return 'R25,000 - R50,000';
  if (val < 100000) return 'R50,000 - R100,000';
  if (val < 250000) return 'R100,000 - R250,000';
  return 'R250,000+';
}

// GET /api/erp/data/employees
erp.get('/data/employees', async (c) => {
  const tenantId = getTenantId(c);
  const department = c.req.query('department');
  // Phase 1.2: Only superadmin can view unmasked sensitive data
  const auth = c.get('auth') as AuthContext | undefined;
  const includeSensitive = c.req.query('include_sensitive') === 'true' && auth?.role === 'superadmin';

  let query = 'SELECT * FROM erp_employees WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];
  if (department) { query += ' AND department = ?'; binds.push(department); }
  query += ' ORDER BY last_name, first_name ASC';

  const results = binds.length > 1
    ? await c.env.DB.prepare(query).bind(...binds).all()
    : await c.env.DB.prepare(query).bind(tenantId).all();

  // Phase 1.2: Mask PII fields unless superadmin requests full data
  const maskedEmployees = results.results.map((emp: Record<string, unknown>) => {
    if (includeSensitive) return emp;
    return {
      ...emp,
      id_number: maskPII(emp.id_number),
      tax_number: maskPII(emp.tax_number),
      bank_account: maskPII(emp.bank_account),
      gross_salary: maskSalary(emp.gross_salary),
    };
  });

  // Department summary
  const deptSummary = await c.env.DB.prepare(`
    SELECT department, COUNT(*) as headcount, SUM(gross_salary) as total_salary, AVG(gross_salary) as avg_salary
    FROM erp_employees WHERE tenant_id = ? AND status = 'active'
    GROUP BY department ORDER BY department
  `).bind(tenantId).all();

  return c.json({ employees: maskedEmployees, total: maskedEmployees.length, departmentSummary: deptSummary.results });
});

// GET /api/erp/data/bank-transactions
erp.get('/data/bank-transactions', async (c) => {
  const tenantId = getTenantId(c);
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  const results = await c.env.DB.prepare(
    'SELECT * FROM erp_bank_transactions WHERE tenant_id = ? ORDER BY transaction_date DESC LIMIT ? OFFSET ?'
  ).bind(tenantId, limit, offset).all();

  const summary = await c.env.DB.prepare(`
    SELECT SUM(debit) as total_debits, SUM(credit) as total_credits,
    (SELECT balance FROM erp_bank_transactions WHERE tenant_id = ? ORDER BY transaction_date DESC, id DESC LIMIT 1) as closing_balance
    FROM erp_bank_transactions WHERE tenant_id = ?
  `).bind(tenantId, tenantId).first();

  return c.json({ transactions: results.results, total: results.results.length, summary, limit, offset });
});

// GET /api/erp/data/tax
erp.get('/data/tax', async (c) => {
  const tenantId = getTenantId(c);

  const results = await c.env.DB.prepare(
    'SELECT * FROM erp_tax_entries WHERE tenant_id = ? ORDER BY tax_period DESC'
  ).bind(tenantId).all();

  return c.json({ taxEntries: results.results, total: results.results.length });
});

// GET /api/erp/data/summary - Financial summary across all ERP data
erp.get('/data/summary', async (c) => {
  const tenantId = getTenantId(c);

  const [customers, suppliers, products, invoices, pos, employees, bankBalance] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM erp_customers WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM erp_suppliers WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count, SUM(stock_on_hand * cost_price) as inventory_value FROM erp_products WHERE tenant_id = ?').bind(tenantId).first<{ count: number; inventory_value: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count, SUM(total) as total_value, SUM(amount_due) as total_outstanding FROM erp_invoices WHERE tenant_id = ?').bind(tenantId).first<{ count: number; total_value: number; total_outstanding: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count, SUM(total) as total_value FROM erp_purchase_orders WHERE tenant_id = ?').bind(tenantId).first<{ count: number; total_value: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count, SUM(gross_salary) as monthly_payroll FROM erp_employees WHERE tenant_id = ? AND status = ?').bind(tenantId, 'active').first<{ count: number; monthly_payroll: number }>(),
    c.env.DB.prepare('SELECT balance FROM erp_bank_transactions WHERE tenant_id = ? ORDER BY transaction_date DESC, id DESC LIMIT 1').bind(tenantId).first<{ balance: number }>(),
  ]);

  return c.json({
    tenantId,
    summary: {
      customers: { count: customers?.count || 0 },
      suppliers: { count: suppliers?.count || 0 },
      products: { count: products?.count || 0, inventoryValue: products?.inventory_value || 0 },
      invoices: { count: invoices?.count || 0, totalValue: invoices?.total_value || 0, outstanding: invoices?.total_outstanding || 0 },
      purchaseOrders: { count: pos?.count || 0, totalValue: pos?.total_value || 0 },
      employees: { count: employees?.count || 0, monthlyPayroll: employees?.monthly_payroll || 0 },
      bankBalance: bankBalance?.balance || 0,
    },
  });
});

export default erp;
