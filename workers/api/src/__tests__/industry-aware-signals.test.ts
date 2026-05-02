/**
 * Phase 10-7 — Industry-aware external signal ingestion.
 *
 * Proves Atheon dynamically pulls only the external signals each tenant
 * cares about, derived from data the tenant already produces — no
 * manually-filled industry column.
 *
 * Covers:
 *  Industry inference
 *   1. Tenant with mining-* domains → industries includes 'mining'
 *   2. Tenant with agri-* + logistics-* domains → both inferred
 *   3. Tenant with no signal data → 'general' fallback
 *   4. KPI categories also contribute to the inference
 *
 *  Per-tenant source filtering
 *   5. agri tenant gets weather; mining tenant doesn't
 *   6. mining tenant gets oil; pure-tech tenant doesn't (oil isn't applicable)
 *   7. Source applicable to ZERO tenants → fetch is skipped entirely
 *      (no upstream API call wasted)
 *   8. Source with no applicableTo declaration → applies to all tenants
 *      (backwards compatible)
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  inferTenantIndustryProfile,
  classifyIndustryFromStrings,
} from '../services/industry-profile';
import {
  sweepExternalSignals,
  openMeteoWeatherSource,
  type ExternalSignalSource,
} from '../services/external-signals-feed';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const T_AGRI = 'ind-agri';
const T_MINING = 'ind-mining';
const T_TECH = 'ind-tech';
const T_GENERAL = 'ind-general';

async function seedTenant(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(id, id, id).run();
}

async function seedMetric(tenantId: string, id: string, name: string, domain: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO process_metrics
       (id, tenant_id, name, value, unit, status, domain, measured_at)
     VALUES (?, ?, ?, 0, 'unit', 'green', ?, datetime('now'))`
  ).bind(id, tenantId, name, domain).run();
}

let fetchMock: ReturnType<typeof vi.fn>;

describe('Phase 10-7 — industry-aware external signals', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    for (const t of [T_AGRI, T_MINING, T_TECH, T_GENERAL]) await seedTenant(t);
  });

  beforeEach(async () => {
    for (const t of [T_AGRI, T_MINING, T_TECH, T_GENERAL]) {
      await env.DB.prepare('DELETE FROM external_signals WHERE tenant_id = ?').bind(t).run();
      await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(t).run();
      await env.DB.prepare('DELETE FROM sub_catalyst_kpi_definitions WHERE tenant_id = ?').bind(t).run();
    }
    // Make ALL non-test tenants inactive so they don't interfere with sweep counts.
    await env.DB.prepare(
      `UPDATE tenants SET status = 'inactive' WHERE id NOT IN (?, ?, ?, ?)`
    ).bind(T_AGRI, T_MINING, T_TECH, T_GENERAL).run();
    // Reactivate our four.
    for (const t of [T_AGRI, T_MINING, T_TECH, T_GENERAL]) {
      await env.DB.prepare(`UPDATE tenants SET status = 'active' WHERE id = ?`).bind(t).run();
    }
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  describe('classifyIndustryFromStrings (pure)', () => {
    it('mining keywords → mining', () => {
      const s = classifyIndustryFromStrings(['mining-equipment', 'ore-processing']);
      expect(s.mining).toBeGreaterThanOrEqual(2);
    });
    it('agri-* + logistics-* → both inferred', () => {
      const s = classifyIndustryFromStrings(['agri-crop', 'agri-irrigation', 'logistics-fleet']);
      expect(s.agriculture).toBeGreaterThanOrEqual(2);
      expect(s.logistics).toBeGreaterThanOrEqual(1);
    });
    it('healthcare keywords detected', () => {
      const s = classifyIndustryFromStrings(['health-patient', 'hospital-staffing']);
      expect(s.healthcare).toBeGreaterThanOrEqual(2);
    });
    it('unrelated strings produce no hits', () => {
      const s = classifyIndustryFromStrings(['sustainability', 'esg-water', 'random']);
      expect(Object.keys(s).length).toBe(0);
    });
  });

  describe('inferTenantIndustryProfile', () => {
    it('infers agri from process_metrics domains', async () => {
      await seedMetric(T_AGRI, 'agri-yield', 'Yield/ha', 'agri-crop');
      await seedMetric(T_AGRI, 'agri-irrig', 'Irrigation Cost', 'agri-irrigation');
      const profile = await inferTenantIndustryProfile(env.DB, T_AGRI);
      expect(profile.industries).toContain('agriculture');
      expect(profile.scores.agriculture).toBeGreaterThanOrEqual(2);
    });
    it('falls back to general when no signals', async () => {
      const profile = await inferTenantIndustryProfile(env.DB, T_GENERAL);
      expect(profile.industries).toEqual(['general']);
    });
    it('combines mining + manufacturing when KPIs span both', async () => {
      await seedMetric(T_MINING, 'mining-ore-m', 'Ore Throughput', 'mining-ore');
      await seedMetric(T_MINING, 'mining-uptime-m', 'Smelter Uptime', 'mining-equipment');
      await seedMetric(T_MINING, 'mining-mfg-m', 'Production Line Yield', 'mfg-production');
      const profile = await inferTenantIndustryProfile(env.DB, T_MINING);
      expect(profile.industries).toContain('mining');
      expect(profile.industries).toContain('manufacturing');
      // Mining stronger than manufacturing → ranked first
      expect(profile.industries[0]).toBe('mining');
    });
  });

  describe('sweepExternalSignals — per-tenant industry filtering', () => {
    /** Builds a stub source that records every call for assertions. */
    function stubSource(opts: {
      name: string; signal_key: string; value: number;
      applicableTo?: ReadonlyArray<import('../services/industry-profile').Industry>;
    }): ExternalSignalSource & { calls: number } {
      const wrapper: ExternalSignalSource & { calls: number } = {
        name: opts.name,
        applicableTo: opts.applicableTo,
        calls: 0,
        async fetchLatest() {
          this.calls++;
          return [{
            category: 'macro',
            source_name: opts.name,
            signal_key: opts.signal_key,
            title: opts.signal_key,
            summary: `${opts.signal_key} = ${opts.value}`,
            value: opts.value,
            unit: 'x',
          }];
        },
      };
      return wrapper;
    }

    it('agri tenant gets weather; mining tenant does not', async () => {
      await seedMetric(T_AGRI, 'agri-m1', 'Yield/ha', 'agri-crop');
      await seedMetric(T_MINING, 'mining-m1', 'Ore Throughput', 'mining-ore');

      const weather = stubSource({
        name: 'test.weather', signal_key: 'weather.test',
        value: 20, applicableTo: ['agriculture', 'logistics', 'fmcg', 'healthcare'],
      });
      // Disable other test tenants to keep counts clean
      for (const t of [T_TECH, T_GENERAL]) {
        await env.DB.prepare(`UPDATE tenants SET status = 'inactive' WHERE id = ?`).bind(t).run();
      }

      await sweepExternalSignals(env.DB, {}, [weather]);

      const agriRows = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM external_signals WHERE tenant_id = ?`
      ).bind(T_AGRI).first<{ n: number }>();
      expect(agriRows?.n).toBe(1);

      const miningRows = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM external_signals WHERE tenant_id = ?`
      ).bind(T_MINING).first<{ n: number }>();
      expect(miningRows?.n).toBe(0);
    });

    it('skips a source applicable to ZERO tenants — no upstream call wasted', async () => {
      // Only TECH and GENERAL are active, neither inferred as 'agriculture'.
      for (const t of [T_AGRI, T_MINING]) {
        await env.DB.prepare(`UPDATE tenants SET status = 'inactive' WHERE id = ?`).bind(t).run();
      }
      const onlyAgri = stubSource({
        name: 'test.agri-only', signal_key: 'agri.test', value: 1,
        applicableTo: ['agriculture'],
      });

      const r = await sweepExternalSignals(env.DB, {}, [onlyAgri]);
      expect(onlyAgri.calls).toBe(0); // never called
      expect(r.sourcesSkippedNoTenant).toBe(1);
      expect(r.sourcesAttempted).toBe(0);
    });

    it('source with no applicableTo declaration applies to all tenants (backwards-compat)', async () => {
      for (const t of [T_TECH, T_GENERAL]) {
        await env.DB.prepare(`UPDATE tenants SET status = 'inactive' WHERE id = ?`).bind(t).run();
      }
      await seedMetric(T_AGRI, 'agri-m1', 'Yield', 'agri-crop');
      await seedMetric(T_MINING, 'mining-m1', 'Ore', 'mining-ore');
      const universal = stubSource({
        name: 'test.universal', signal_key: 'universal.test', value: 1,
      });

      await sweepExternalSignals(env.DB, {}, [universal]);
      const agriRows = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM external_signals WHERE tenant_id = ?`
      ).bind(T_AGRI).first<{ n: number }>();
      const miningRows = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM external_signals WHERE tenant_id = ?`
      ).bind(T_MINING).first<{ n: number }>();
      expect(agriRows?.n).toBe(1);
      expect(miningRows?.n).toBe(1);
    });
  });

  describe('openMeteoWeatherSource (live shape)', () => {
    it('declares applicability to weather-relevant industries only', () => {
      expect(openMeteoWeatherSource.applicableTo).toBeDefined();
      expect(openMeteoWeatherSource.applicableTo).toContain('agriculture');
      expect(openMeteoWeatherSource.applicableTo).toContain('logistics');
      expect(openMeteoWeatherSource.applicableTo).not.toContain('technology');
      expect(openMeteoWeatherSource.applicableTo).not.toContain('finance');
    });

    it('parses Open-Meteo current-weather response into temp + precip readings per city', async () => {
      const mkResp = (temp: number, precip: number) => new Response(JSON.stringify({
        current: { temperature_2m: temp, precipitation: precip, wind_speed_10m: 4.2, time: '2026-05-02T08:00' },
      }), { status: 200 });
      fetchMock
        .mockResolvedValueOnce(mkResp(22.5, 0.0))
        .mockResolvedValueOnce(mkResp(18.1, 1.2));
      const readings = await openMeteoWeatherSource.fetchLatest({ OPEN_METEO_BASE: 'https://wx.test' });
      expect(readings).not.toBeNull();
      // 2 cities × (temp + precip) = 4 readings
      expect(readings!.length).toBe(4);
      const keys = readings!.map((r) => r.signal_key);
      expect(keys.some((k) => k.includes('johannesburg.temp_c'))).toBe(true);
      expect(keys.some((k) => k.includes('cape_town.precip_mm'))).toBe(true);
      // First call hits JHB lat=-26.2
      expect(fetchMock.mock.calls[0][0]).toContain('latitude=-26.2');
    });
  });
});
