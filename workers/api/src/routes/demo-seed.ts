/**
 * Demo Seed Routes — Phase 10-26.
 *
 * POST /api/v1/admin/seed-sap-ecc-demo
 *   Header: X-Setup-Secret: <SETUP_SECRET>
 *   Body: { tenant_id?, admin_email?, run_chain?: boolean }
 *   Returns: { seed: SeedResult, chain_result?: Phase10RunResult }
 *
 * Used for repeatable deploy validation and demo environments.
 * Idempotent — re-running deletes prior demo data and re-seeds.
 *
 * Auth: gated on the SETUP_SECRET shared secret (same gate as
 * /admin/migrate). Intentionally NOT behind tenant auth — this is a
 * deploy-time tool.
 */

import { Hono } from 'hono';
import type { Env, AppBindings } from '../types';
import { seedSapEccDemo, type SeedResult } from '../services/demo-sap-ecc-seeder';
import { runPhase10ChainForTenant, type Phase10RunResult } from '../services/phase-10-analytics-runner';

const demoSeed = new Hono<AppBindings>();

interface SeedBody {
  tenant_id?: string;
  admin_email?: string;
  run_chain?: boolean;
}

demoSeed.post('/seed-sap-ecc-demo', async (c) => {
  const env = c.env as Env;
  const secret = c.req.header('X-Setup-Secret');
  if (!env.SETUP_SECRET || !secret || secret !== env.SETUP_SECRET) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  let body: SeedBody = {};
  try { body = await c.req.json<SeedBody>(); } catch { /* empty body OK */ }

  const seed: SeedResult = await seedSapEccDemo(env.DB, {
    tenantId: body.tenant_id, adminEmail: body.admin_email,
  });

  let chainResult: Phase10RunResult | null = null;
  if (body.run_chain !== false) {
    chainResult = await runPhase10ChainForTenant(env.DB, seed.tenantId, { encryptionKey: env.ENCRYPTION_KEY });
  }

  return c.json({ seed, chain_result: chainResult });
});

export default demoSeed;
