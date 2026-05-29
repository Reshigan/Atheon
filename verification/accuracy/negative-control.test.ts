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
/** Render one captured cell as a SQL literal: NULL, bare number, or quoted+escaped string. */
function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Build an INSERT that re-creates a single captured row in its origin table. */
function buildInsert(table: string, row: Record<string, unknown>): string {
  const cols = Object.keys(row);
  const vals = cols.map(c => sqlLiteral(row[c]));
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')})`;
}

describe('negative control — the accuracy harness can fail', () => {
  const client = new ApiClient();
  let tenantId = '';
  let deletedRow: Record<string, unknown> | null = null;

  beforeAll(async () => {
    await client.login();
    tenantId = readManifest().tenantId;
  });

  afterAll(async () => {
    // Surgically restore the one ISEG row we deleted rather than reseeding the
    // whole tenant. A full reseed writes thousands of rows in a single request,
    // routinely trips D1's per-request CPU limit, and — when it partially fails —
    // wipes the assessment's business_report_key that report.test.ts (which runs
    // after this file) depends on. Re-inserting the captured row is fast,
    // deterministic, and leaves every other table untouched.
    if (deletedRow) {
      await queryD1(buildInsert('sap_iseg', deletedRow));
    }
  });

  it('clean baseline matches the oracle (sanity)', () => {
    const matched = readManifest().runs.inventory.totals.matched;
    expect(matched).toBe(VANTAX_ORACLE.inventory.total);
  });

  it('perturbing one inventory record makes the live count diverge from the oracle', async () => {
    // tenantId feeds an interpolated query against remote D1 — fail closed unless
    // it is a safe identifier (alphanumerics, hyphen, underscore) rather than risk
    // a malformed/injected mutation. The vantax tenant id is the slug "vantax",
    // not a UUID, so a UUID-only guard wrongly rejects the real tenant; this
    // charset still admits no SQL metacharacters (quotes, semicolons, whitespace).
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tenantId)) {
      throw new Error(`refusing to mutate D1: tenantId is not a safe identifier (${tenantId})`);
    }
    // Capture the full row first so afterAll can restore exactly it, then orphan
    // its MARD source by deleting this ISEG counterpart.
    const [target] = await queryD1<Record<string, unknown>>(
      `SELECT * FROM sap_iseg WHERE tenant_id = '${tenantId}' ORDER BY MATNR LIMIT 1`,
    );
    expect(target, 'expected at least one sap_iseg row to perturb').toBeTruthy();
    deletedRow = target;
    await queryD1(`DELETE FROM sap_iseg WHERE tenant_id = '${tenantId}' AND id = ${sqlLiteral(target.id)}`);

    const { runId } = await client.executeSubCatalyst(RECON_SUBCATALYSTS.inventory);
    const t = await client.getRunItemTotals(runId);
    // The dropped match means matched is no longer the full product total.
    expect(t.matched).not.toBe(VANTAX_ORACLE.inventory.total);
  });
});
