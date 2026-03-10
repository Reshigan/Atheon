/**
 * Test helpers for Atheon API integration tests.
 * Provides utilities for authentication, request building, and data cleanup.
 */
import { env, SELF } from 'cloudflare:test';
import { ensureMigrated } from './setup';

/** Standard test user credentials */
export const TEST_USERS = {
  superadmin: {
    email: 'admin@vantax.co.za',
    password: 'Admin123!',
    role: 'superadmin',
    tenantId: 'vantax',
  },
  admin: {
    email: 'test-admin@test-tenant.co.za',
    password: 'TestAdmin123!',
    role: 'admin',
    tenantId: 'test-tenant',
  },
  analyst: {
    email: 'test-analyst@test-tenant.co.za',
    password: 'TestAnalyst123!',
    role: 'analyst',
    tenantId: 'test-tenant',
  },
  viewer: {
    email: 'test-viewer@test-tenant.co.za',
    password: 'TestViewer123!',
    role: 'viewer',
    tenantId: 'test-tenant',
  },
} as const;

/**
 * Make an HTTP request to the worker under test.
 * @param path - URL path (e.g. '/api/v1/auth/login')
 * @param options - Fetch options (method, headers, body, etc.)
 * @returns Response from the worker
 */
export async function request(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `http://localhost${path}`;
  return SELF.fetch(url, options);
}

/**
 * Make a JSON POST request to the worker.
 * @param path - URL path
 * @param body - JSON body object
 * @param headers - Additional headers
 * @returns Response from the worker
 */
export async function postJSON(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Make an authenticated JSON request.
 * @param path - URL path
 * @param token - JWT token
 * @param options - Additional fetch options
 * @returns Response from the worker
 */
export async function authedRequest(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  return request(path, { ...options, headers });
}

/**
 * Register a test user in the database.
 * @param user - User details
 * @returns The created user's ID
 */
export async function createTestUser(user: {
  email: string;
  password: string;
  name: string;
  role: string;
  tenantId: string;
}): Promise<string> {
  await ensureMigrated();

  const id = crypto.randomUUID();

  // Hash password using the same PBKDF2 approach as auth middleware
  const { hashPassword } = await import('../middleware/auth');
  const passwordHash = await hashPassword(user.password);

  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, user.tenantId, user.email, user.name, user.role, passwordHash,
    JSON.stringify(['*']), 'active'
  ).run();

  return id;
}

/**
 * Create a test tenant in the database.
 * @param tenantId - Tenant ID
 * @param name - Tenant name
 * @param industry - Industry type
 * @returns The tenant ID
 */
export async function createTestTenant(
  tenantId: string,
  name: string,
  industry: string = 'technology',
): Promise<string> {
  await ensureMigrated();

  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, industry, plan, status)
     VALUES (?, ?, ?, ?, 'enterprise', 'active')`
  ).bind(tenantId, name, tenantId, industry).run();

  // Also create entitlements
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users)
     VALUES (?, '["apex","pulse","mind","memory"]', '["finance","hr","operations"]', 50, 100)`
  ).bind(tenantId).run();

  return tenantId;
}

/**
 * Login a user and return the JWT token.
 * @param email - User email
 * @param password - User password
 * @returns JWT token string, or null if login failed
 */
export async function loginUser(
  email: string,
  password: string,
): Promise<string | null> {
  const res = await postJSON('/api/v1/auth/login', { email, password });
  if (res.status !== 200) return null;
  const data = await res.json() as { token?: string };
  return data.token ?? null;
}

/**
 * Clean up test data from all tables for a given tenant.
 * @param tenantId - Tenant ID to clean up
 */
export async function cleanupTenant(tenantId: string): Promise<void> {
  const tables = [
    'catalyst_actions', 'catalyst_clusters', 'agent_deployments',
    'graph_entities', 'graph_relationships', 'health_scores',
    'executive_briefings', 'risk_alerts', 'scenarios',
    'process_metrics', 'anomalies', 'process_flows',
    'correlation_events', 'erp_connections', 'mind_queries',
    'notifications', 'webhooks', 'documents', 'email_queue',
    'execution_logs', 'managed_deployments', 'assessments',
    'audit_log', 'users', 'tenant_entitlements', 'tenants',
  ];

  for (const table of tables) {
    try {
      await env.DB.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).bind(tenantId).run();
    } catch {
      // Table might not exist yet or have different schema — skip
    }
  }
}

/**
 * Parse a JSON response body with type safety.
 * @param res - Response object
 * @returns Parsed JSON data
 */
export async function parseJSON<T = Record<string, unknown>>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}
