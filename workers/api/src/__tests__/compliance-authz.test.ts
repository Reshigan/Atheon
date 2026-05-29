/**
 * Route-level authorization for the compliance evidence pack.
 *
 * The `auditor` role (level 30) is spec'd as read-only compliance access and
 * is redirected to /compliance on login (frontend App.tsx). That page — and its
 * Audit Log tab — is populated entirely by GET /api/v1/compliance/evidence-pack,
 * so an auditor MUST be able to read it for its own tenant. Lower-privilege
 * roles, and an auditor reaching across tenants, stay forbidden. The raw
 * /api/v1/audit/log endpoint remains admin-gated (see verification/rbac).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { env } from 'cloudflare:test';
import { createTestUser, loginUser, authedRequest } from './helpers';
import { ensureMigrated } from './setup';

const TENANT = `compliance-authz-${randomUUID().slice(0, 8)}`;
const OTHER_TENANT = `compliance-authz-other-${randomUUID().slice(0, 8)}`;

const auditor = {
  email: `authz-auditor-${randomUUID().slice(0, 8)}@vantax.co.za`,
  password: 'Auditor123!',
  name: 'Authz Auditor',
  role: 'auditor',
  tenantId: TENANT,
};
const viewer = {
  email: `authz-viewer-${randomUUID().slice(0, 8)}@vantax.co.za`,
  password: 'Viewer123!',
  name: 'Authz Viewer',
  role: 'viewer',
  tenantId: TENANT,
};

let auditorToken: string;
let viewerToken: string;

beforeAll(async () => {
  await ensureMigrated();
  for (const id of [TENANT, OTHER_TENANT]) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
    ).bind(id, id, id).run();
  }
  await createTestUser(auditor);
  await createTestUser(viewer);

  const at = await loginUser(auditor.email, auditor.password);
  const vt = await loginUser(viewer.email, viewer.password);
  if (!at || !vt) throw new Error('test user login failed');
  auditorToken = at;
  viewerToken = vt;
});

describe('GET /api/v1/compliance/evidence-pack role gate', () => {
  it('allows an auditor to read its own tenant evidence pack', async () => {
    const res = await authedRequest('/api/v1/compliance/evidence-pack', auditorToken);
    expect(res.status).toBe(200);
  });

  it('still forbids a viewer (non-privileged role)', async () => {
    const res = await authedRequest('/api/v1/compliance/evidence-pack', viewerToken);
    expect(res.status).toBe(403);
  });

  it('forbids an auditor from reading another tenant via ?tenant_id=', async () => {
    const res = await authedRequest(
      `/api/v1/compliance/evidence-pack?tenant_id=${OTHER_TENANT}`,
      auditorToken,
    );
    expect(res.status).toBe(403);
  });
});
