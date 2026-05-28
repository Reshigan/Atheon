import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApiClient, RECON_SUBCATALYSTS } from '../lib/client';
import { queryD1 } from '../lib/d1';
import { readManifest } from '../lib/manifest';
import { VANTAX_ORACLE } from '../../workers/api/src/services/vantax-demo';

/**
 * Self-test: prove the accuracy harness actually reflects ground truth and is
 * not a no-op. We take the clean baseline globalSetup recorded, deliberately
 * break one inventory source record, re-run the same pipeline, and confirm the
 * count now DIVERGES from the oracle. afterAll reseeds to restore clean state.
 *
 * The inventory sub-catalyst reconciles sap_mard.LABST (source) against
 * sap_iseg.MENGE (target) on MATNR — so deleting one ISEG row orphans its MARD
 * source, dropping `matched` below the oracle's product total.
 */
describe('negative control — the accuracy harness can fail', () => {
  const client = new ApiClient();
  let tenantId = '';

  beforeAll(async () => {
    await client.login();
    tenantId = readManifest().tenantId;
  });

  afterAll(async () => {
    // Always restore the tenant to a clean, correct state for downstream runs.
    if (client.token) await client.reseed();
  });

  it('clean baseline matches the oracle (sanity)', () => {
    const matched = readManifest().runs.inventory.totals.matched;
    expect(matched).toBe(VANTAX_ORACLE.inventory.total);
  });

  it('perturbing one inventory record makes the live count diverge from the oracle', async () => {
    // Orphan one MARD source row by deleting its ISEG counterpart.
    await queryD1(
      `DELETE FROM sap_iseg WHERE tenant_id = '${tenantId}'
         AND id = (SELECT id FROM sap_iseg WHERE tenant_id = '${tenantId}'
                   ORDER BY MATNR LIMIT 1)`,
    );

    const { runId } = await client.executeSubCatalyst(RECON_SUBCATALYSTS.inventory);
    const t = await client.getRunItemTotals(runId);
    // The dropped match means matched is no longer the full product total.
    expect(t.matched).not.toBe(VANTAX_ORACLE.inventory.total);
  });
});
