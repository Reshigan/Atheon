/**
 * Phase 10-12 — Regulatory feed (industry-aware).
 *
 * Covers:
 *  1. Tenant with no industry-relevant regulators → no-op (no fetches)
 *  2. Healthcare tenant gets SAHPRA but not DMRE
 *  3. Mining tenant gets DMRE but not SAHPRA
 *  4. Finance tenant gets FSCA + JSE + SARS + SARB
 *  5. Cross-industry tenant (mining + manufacturing) gets union of regulators
 *  6. RSS items → regulatory_events rows with jurisdiction set
 *  7. URL dedup over 30 days — second sweep doesn't insert duplicates
 *  8. Junk titles (too short) → skipped
 *  9. HTTP error on one regulator → others still processed
 * 10. Custom regulator with explicit feed URL is tried first
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  sweepRegulatoryFeeds,
  type RegulatorFeed,
} from '../services/regulatory-feed';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const T_HEALTH = 'reg-health';
const T_MINING = 'reg-mining';
const T_FIN = 'reg-fin';
const T_NONE = 'reg-none';
const T_MIXED = 'reg-mixed';

async function seedTenant(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(id, id, id).run();
}

async function seedMetric(tenantId: string, id: string, domain: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO process_metrics
       (id, tenant_id, name, value, unit, status, domain, measured_at)
     VALUES (?, ?, ?, 0, 'unit', 'green', ?, datetime('now'))`
  ).bind(id, tenantId, `m-${id}`, domain).run();
}

function rss(items: Array<{ title: string; link: string }>): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel>${
    items.map((i) => `
      <item>
        <title><![CDATA[${i.title}]]></title>
        <link>${i.link}</link>
        <pubDate>Fri, 02 May 2026 08:00:00 GMT</pubDate>
        <description>desc</description>
      </item>`).join('')
  }</channel></rss>`;
}

let fetchMock: ReturnType<typeof vi.fn>;

describe('Phase 10-12 — regulatory feed (industry-aware)', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    for (const t of [T_HEALTH, T_MINING, T_FIN, T_NONE, T_MIXED]) await seedTenant(t);
  });

  beforeEach(async () => {
    for (const t of [T_HEALTH, T_MINING, T_FIN, T_NONE, T_MIXED]) {
      await env.DB.prepare('DELETE FROM regulatory_events WHERE tenant_id = ?').bind(t).run();
      await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(t).run();
    }
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('healthcare tenant gets SAHPRA but not DMRE', async () => {
    await seedMetric(T_HEALTH, 'h1', 'health-patient');
    const sahpra: RegulatorFeed = {
      name: 'sahpra', jurisdiction: 'SAHPRA',
      queries: ['SAHPRA test'], applicableTo: ['healthcare'],
    };
    const dmre: RegulatorFeed = {
      name: 'dmre', jurisdiction: 'DMRE',
      queries: ['DMRE test'], applicableTo: ['mining'],
    };
    fetchMock.mockResolvedValueOnce(new Response(rss([
      { title: 'SAHPRA approves new vaccine guideline', link: 'https://news.test/s1' },
    ]), { status: 200 }));

    const r = await sweepRegulatoryFeeds(env.DB, T_HEALTH, {}, [sahpra, dmre]);
    expect(r.regulatorsScanned).toBe(1); // only SAHPRA applies
    expect(r.itemsInserted).toBe(1);
    expect(fetchMock.mock.calls.length).toBe(1);

    const row = await env.DB.prepare(
      `SELECT jurisdiction FROM regulatory_events WHERE tenant_id = ?`
    ).bind(T_HEALTH).first<{ jurisdiction: string }>();
    expect(row?.jurisdiction).toBe('SAHPRA');
  });

  it('mining tenant gets DMRE but not SAHPRA', async () => {
    await seedMetric(T_MINING, 'm1', 'mining-equipment');
    const sahpra: RegulatorFeed = {
      name: 'sahpra', jurisdiction: 'SAHPRA',
      queries: ['SAHPRA test'], applicableTo: ['healthcare'],
    };
    const dmre: RegulatorFeed = {
      name: 'dmre', jurisdiction: 'DMRE',
      queries: ['DMRE test'], applicableTo: ['mining'],
    };
    fetchMock.mockResolvedValueOnce(new Response(rss([
      { title: 'DMRE updates mining charter compliance dates', link: 'https://news.test/d1' },
    ]), { status: 200 }));

    const r = await sweepRegulatoryFeeds(env.DB, T_MINING, {}, [sahpra, dmre]);
    expect(r.regulatorsScanned).toBe(1);
    expect(r.itemsInserted).toBe(1);

    const row = await env.DB.prepare(
      `SELECT jurisdiction FROM regulatory_events WHERE tenant_id = ?`
    ).bind(T_MINING).first<{ jurisdiction: string }>();
    expect(row?.jurisdiction).toBe('DMRE');
  });

  it('tenant with no industry signal → general → universal regulators only', async () => {
    const universal: RegulatorFeed = {
      name: 'sars', jurisdiction: 'SARS',
      queries: ['SARS test'], applicableTo: ['general', 'finance'],
    };
    const finance: RegulatorFeed = {
      name: 'fsca', jurisdiction: 'FSCA',
      queries: ['FSCA test'], applicableTo: ['finance'],
    };
    fetchMock.mockResolvedValueOnce(new Response(rss([
      { title: 'SARS updates VAT thresholds for 2026 tax year', link: 'https://news.test/sars1' },
    ]), { status: 200 }));

    const r = await sweepRegulatoryFeeds(env.DB, T_NONE, {}, [universal, finance]);
    // Only universal applies (no industry signal → general)
    expect(r.regulatorsScanned).toBe(1);
    expect(r.itemsInserted).toBe(1);
  });

  it('cross-industry tenant gets union of regulators', async () => {
    await seedMetric(T_MIXED, 'm1', 'mining-ore');
    await seedMetric(T_MIXED, 'm2', 'mfg-production');
    const dmre: RegulatorFeed = {
      name: 'dmre', jurisdiction: 'DMRE',
      queries: ['DMRE test'], applicableTo: ['mining'],
    };
    const nrcs: RegulatorFeed = {
      name: 'nrcs', jurisdiction: 'NRCS',
      queries: ['NRCS test'], applicableTo: ['agriculture', 'fmcg', 'manufacturing'],
    };
    fetchMock
      .mockResolvedValueOnce(new Response(rss([{ title: 'DMRE charter update for 2026', link: 'https://news.test/d1' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(rss([{ title: 'NRCS new compulsory standard for steel', link: 'https://news.test/n1' }]), { status: 200 }));

    const r = await sweepRegulatoryFeeds(env.DB, T_MIXED, {}, [dmre, nrcs]);
    expect(r.regulatorsScanned).toBe(2);
    expect(r.itemsInserted).toBe(2);
  });

  it('URL dedup: second sweep with same items inserts nothing', async () => {
    await seedMetric(T_HEALTH, 'h2', 'health-patient');
    const reg: RegulatorFeed = {
      name: 'sahpra', jurisdiction: 'SAHPRA',
      queries: ['SAHPRA test'], applicableTo: ['healthcare'],
    };
    fetchMock
      .mockResolvedValueOnce(new Response(rss([{ title: 'SAHPRA bulletin May 2026 published', link: 'https://dup.test/1' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(rss([{ title: 'SAHPRA bulletin May 2026 published', link: 'https://dup.test/1' }]), { status: 200 }));

    const r1 = await sweepRegulatoryFeeds(env.DB, T_HEALTH, {}, [reg]);
    expect(r1.itemsInserted).toBe(1);
    const r2 = await sweepRegulatoryFeeds(env.DB, T_HEALTH, {}, [reg]);
    expect(r2.itemsInserted).toBe(0);
    expect(r2.itemsSkippedDuplicate).toBe(1);
  });

  it('junk titles (too short) → skipped', async () => {
    await seedMetric(T_HEALTH, 'h3', 'health-patient');
    const reg: RegulatorFeed = {
      name: 'sahpra', jurisdiction: 'SAHPRA',
      queries: ['SAHPRA test'], applicableTo: ['healthcare'],
    };
    fetchMock.mockResolvedValueOnce(new Response(rss([
      { title: 'short', link: 'https://j.test/1' },
    ]), { status: 200 }));
    const r = await sweepRegulatoryFeeds(env.DB, T_HEALTH, {}, [reg]);
    expect(r.itemsInserted).toBe(0);
    expect(r.itemsSkippedJunk).toBe(1);
  });

  it('HTTP error on one regulator → others still processed', async () => {
    await seedMetric(T_FIN, 'f1', 'finance');
    const reg1: RegulatorFeed = {
      name: 'broken', jurisdiction: 'BrokenReg',
      queries: ['Broken test'], applicableTo: ['finance'],
    };
    const reg2: RegulatorFeed = {
      name: 'working', jurisdiction: 'WorkingReg',
      queries: ['Working test'], applicableTo: ['finance'],
    };
    fetchMock
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response(rss([
        { title: 'WorkingReg announces new compliance window', link: 'https://w.test/1' },
      ]), { status: 200 }));

    const r = await sweepRegulatoryFeeds(env.DB, T_FIN, {}, [reg1, reg2]);
    expect(r.regulatorsScanned).toBe(2);
    expect(r.itemsInserted).toBe(1);
  });

  it('regulator with explicit feeds[] URL is tried first (no Google News query)', async () => {
    await seedMetric(T_HEALTH, 'h4', 'health-patient');
    const reg: RegulatorFeed = {
      name: 'sahpra', jurisdiction: 'SAHPRA',
      queries: ['SAHPRA test'], applicableTo: ['healthcare'],
      feeds: ['https://sahpra.test/rss'],
    };
    fetchMock.mockResolvedValueOnce(new Response(rss([
      { title: 'SAHPRA first-party feed item published today', link: 'https://sahpra.test/item/1' },
    ]), { status: 200 }));

    const r = await sweepRegulatoryFeeds(env.DB, T_HEALTH, {}, [reg]);
    expect(r.itemsInserted).toBe(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://sahpra.test/rss');
  });
});
