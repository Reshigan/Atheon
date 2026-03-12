/**
 * ERP Token Manager
 *
 * Manages OAuth token lifecycle for ERP connections:
 * - Auto-refresh expired tokens
 * - KV caching for fast retrieval
 * - Mutex to prevent concurrent refresh races
 * - Encryption at rest in D1
 */

import { encrypt, decrypt, isEncrypted } from './encryption';

// ═══ Types ═══

export interface TokenState {
  access_token: string;
  refresh_token: string | null;
  token_type: string;
  expires_at: string; // ISO timestamp
}

interface StoredTokenRecord {
  encrypted_config: string | null;
  config: string | null;
  adapter_system: string;
}

interface RefreshConfig {
  client_id: string;
  client_secret: string;
  token_url: string;
  base_url: string;
}

// ═══ Constants ═══

const TOKEN_CACHE_PREFIX = 'erp_token:';
const TOKEN_CACHE_TTL = 3500; // ~58 minutes (tokens typically last 60 min)
const REFRESH_BUFFER_SECONDS = 60; // Refresh 60s before expiry
const MUTEX_PREFIX = 'erp_token_mutex:';
const MUTEX_TTL = 15; // 15 seconds max lock

// ═══ Token Retrieval ═══

/**
 * Get a valid (non-expired) token for a given ERP connection.
 * Check order: KV cache -> DB -> refresh if expired.
 */
export async function getValidToken(
  db: D1Database,
  cache: KVNamespace,
  connectionId: string,
  tenantId: string,
  encryptionKey: string,
): Promise<TokenState | null> {
  // 1. Try KV cache first (fastest)
  const cacheKey = `${TOKEN_CACHE_PREFIX}${tenantId}:${connectionId}`;
  const cached = await cache.get(cacheKey);
  if (cached) {
    try {
      const state = JSON.parse(cached) as TokenState;
      if (!isExpiringSoon(state.expires_at)) {
        return state;
      }
      // Token expiring soon — fall through to refresh
    } catch { /* parse failed, fall through */ }
  }

  // 2. Load from DB
  const conn = await db.prepare(
    'SELECT encrypted_config, config, ea.system as adapter_system FROM erp_connections ec JOIN erp_adapters ea ON ec.adapter_id = ea.id WHERE ec.id = ? AND ec.tenant_id = ?'
  ).bind(connectionId, tenantId).first<StoredTokenRecord>();

  if (!conn) return null;

  const config = await decryptConfig(conn, encryptionKey);
  if (!config.access_token) return null;

  const state: TokenState = {
    access_token: config.access_token as string,
    refresh_token: (config.refresh_token as string) || null,
    token_type: (config.token_type as string) || 'Bearer',
    expires_at: (config.token_expires_at as string) || '',
  };

  // 3. Check if expired / expiring soon
  if (isExpiringSoon(state.expires_at) && state.refresh_token) {
    const refreshCfg: RefreshConfig = {
      client_id: (config.client_id as string) || '',
      client_secret: (config.client_secret as string) || '',
      token_url: (config.token_url as string) || '',
      base_url: (config.base_url as string) || '',
    };
    const systemType = conn.adapter_system || '';
    const refreshed = await refreshAndStore(
      db, cache, connectionId, tenantId, encryptionKey,
      state, refreshCfg, systemType,
    );
    if (refreshed) return refreshed;
  }

  // 4. Cache the current (valid) token
  if (!isExpiringSoon(state.expires_at)) {
    await cache.put(cacheKey, JSON.stringify(state), { expirationTtl: TOKEN_CACHE_TTL });
  }

  return state;
}

/**
 * Invalidate a cached token (e.g. after OAuth revocation).
 */
export async function invalidateToken(
  cache: KVNamespace, connectionId: string, tenantId: string,
): Promise<void> {
  const cacheKey = `${TOKEN_CACHE_PREFIX}${tenantId}:${connectionId}`;
  await cache.delete(cacheKey);
}

// ═══ Token Refresh with Mutex ═══

/**
 * Refresh an expired token, store updated tokens in DB + KV.
 * Uses a KV-based mutex to prevent concurrent refreshes.
 */
export async function refreshAndStore(
  db: D1Database,
  cache: KVNamespace,
  connectionId: string,
  tenantId: string,
  encryptionKey: string,
  currentToken: TokenState,
  refreshConfig: RefreshConfig,
  systemType: string,
): Promise<TokenState | null> {
  const mutexKey = `${MUTEX_PREFIX}${tenantId}:${connectionId}`;

  // Acquire mutex
  const existing = await cache.get(mutexKey);
  if (existing) {
    // Another worker is refreshing — wait briefly and retry from cache
    await new Promise(r => setTimeout(r, 2000));
    const cacheKey = `${TOKEN_CACHE_PREFIX}${tenantId}:${connectionId}`;
    const refreshed = await cache.get(cacheKey);
    if (refreshed) {
      try { return JSON.parse(refreshed) as TokenState; } catch { /* fall through */ }
    }
    return null;
  }

  // Set mutex
  await cache.put(mutexKey, 'refreshing', { expirationTtl: MUTEX_TTL });

  try {
    // Determine token URL
    const tokenUrl = resolveTokenUrl(refreshConfig, systemType);
    if (!tokenUrl || !currentToken.refresh_token) {
      return null;
    }

    // Call token endpoint
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: currentToken.refresh_token,
      client_id: refreshConfig.client_id,
      client_secret: refreshConfig.client_secret,
    });

    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!resp.ok) {
      console.error(`Token refresh failed for ${connectionId}: HTTP ${resp.status}`);
      return null;
    }

    const data = await resp.json() as {
      access_token: string;
      refresh_token?: string;
      token_type?: string;
      expires_in?: number;
    };

    const newState: TokenState = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || currentToken.refresh_token,
      token_type: data.token_type || 'Bearer',
      expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
    };

    // Update DB with encrypted tokens
    const conn = await db.prepare(
      'SELECT encrypted_config, config FROM erp_connections WHERE id = ? AND tenant_id = ?'
    ).bind(connectionId, tenantId).first<{ encrypted_config: string | null; config: string | null }>();

    if (conn) {
      let existingConfig: Record<string, unknown> = {};
      if (conn.encrypted_config && isEncrypted(conn.encrypted_config)) {
        const dec = await decrypt(conn.encrypted_config, encryptionKey);
        existingConfig = dec ? JSON.parse(dec) : {};
      } else {
        existingConfig = JSON.parse(conn.config || '{}');
      }

      const updatedConfig = {
        ...existingConfig,
        access_token: newState.access_token,
        refresh_token: newState.refresh_token,
        token_type: newState.token_type,
        token_expires_at: newState.expires_at,
      };

      const encryptedBlob = await encrypt(JSON.stringify(updatedConfig), encryptionKey);
      await db.prepare(
        'UPDATE erp_connections SET encrypted_config = ?, config = ? WHERE id = ? AND tenant_id = ?'
      ).bind(encryptedBlob, '{}', connectionId, tenantId).run();
    }

    // Update KV cache
    const cacheKey = `${TOKEN_CACHE_PREFIX}${tenantId}:${connectionId}`;
    await cache.put(cacheKey, JSON.stringify(newState), { expirationTtl: TOKEN_CACHE_TTL });

    return newState;
  } catch (err) {
    console.error(`Token refresh error for ${connectionId}:`, err);
    return null;
  } finally {
    // Release mutex
    await cache.delete(mutexKey);
  }
}

// ═══ Helpers ═══

function isExpiringSoon(expiresAt: string): boolean {
  if (!expiresAt) return true;
  try {
    const expiry = new Date(expiresAt).getTime();
    return Date.now() >= expiry - REFRESH_BUFFER_SECONDS * 1000;
  } catch {
    return true;
  }
}

async function decryptConfig(
  conn: StoredTokenRecord, encryptionKey: string,
): Promise<Record<string, unknown>> {
  if (conn.encrypted_config && isEncrypted(conn.encrypted_config)) {
    const dec = await decrypt(conn.encrypted_config, encryptionKey);
    return dec ? JSON.parse(dec) : {};
  }
  return JSON.parse(conn.config || '{}');
}

function resolveTokenUrl(config: RefreshConfig, systemType: string): string {
  if (config.token_url) return config.token_url;

  const sys = systemType.toLowerCase();
  if (sys.includes('xero')) return 'https://identity.xero.com/connect/token';
  if (sys.includes('sage')) return 'https://oauth.accounting.sage.com/token';
  if (sys.includes('quickbooks') || sys.includes('qbo')) return 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
  if (sys.includes('dynamics')) return `https://login.microsoftonline.com/common/oauth2/v2.0/token`;
  if (sys.includes('salesforce') || sys.includes('sfdc')) return 'https://login.salesforce.com/services/oauth2/token';
  if (sys.includes('oracle')) return `${config.base_url}/oauth2/v1/token`;
  if (sys.includes('workday')) return `${config.base_url}/oauth2/token`;
  if (sys.includes('netsuite')) return `${config.base_url}/services/rest/auth/oauth2/v1/token`;

  return '';
}
