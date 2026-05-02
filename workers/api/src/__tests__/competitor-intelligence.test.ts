/**
 * Phase 10-8 — Competitor intelligence (news + strategy).
 *
 * Covers:
 *  Strategy classifier
 *   1. Pricing keywords trigger 'pricing' / 'warning'
 *   2. Product launch keywords → 'product_launch'
 *   3. Market expansion → 'market_expansion' / 'critical'
 *   4. M&A / funding → 'funding_or_ma' / 'critical'
 *   5. Hiring keywords → 'hiring'
 *   6. Trouble keywords (lawsuit, breach) → 'trouble'
 *   7. Unknown headline falls through to 'general'
 *   8. HTML entities in headlines decoded before classification
 *
 *  RSS parser
 *   9. Parses multiple <item> blocks with title/link/pubDate/description
 *  10. Handles <![CDATA[...]]> wrapping
 *
 *  Sweep
 *  11. Tenant with no competitors → no-op
 *  12. 1 competitor + 2 RSS items → both persisted with classified categories
 *  13. Re-running same items → dedup by URL (no duplicate inserts)
 *  14. Junk title (too short) → skipped
 *  15. HTTP error on one competitor → others still processed
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  classifyStrategy,
  decodeBasicEntities,
} from '../services/competitor-strategy-classifier';
import {
  parseRssItems,
  sweepCompetitorIntel,
} from '../services/competitor-intel-source';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'comp-intel-tenant';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}

async function seedCompetitor(id: string, name: string, industry = 'general'): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO competitors
       (id, tenant_id, name, industry, signals_count)
     VALUES (?, ?, ?, ?, 0)`
  ).bind(id, TENANT, name, industry).run();
}

function rssXml(items: Array<{ title: string; link: string; pubDate?: string; description?: string }>): string {
  const itemBlocks = items.map((i) => `
    <item>
      <title><![CDATA[${i.title}]]></title>
      <link>${i.link}</link>
      <pubDate>${i.pubDate ?? 'Fri, 02 May 2026 08:00:00 GMT'}</pubDate>
      <description><![CDATA[${i.description ?? i.title}]]></description>
    </item>`).join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel>${itemBlocks}</channel></rss>`;
}

let fetchMock: ReturnType<typeof vi.fn>;

describe('Phase 10-8 — competitor intelligence', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM radar_signals WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM competitors WHERE tenant_id = ?').bind(TENANT).run();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  describe('classifyStrategy', () => {
    it('pricing keywords → pricing/warning', () => {
      const r = classifyStrategy('Capitec cuts prices on transaction fees');
      expect(r.category).toBe('pricing');
      expect(r.severity).toBe('warning');
      expect(r.matched.length).toBeGreaterThan(0);
    });
    it('product launch → product_launch', () => {
      const r = classifyStrategy('Discovery Bank launches new digital wallet app');
      expect(r.category).toBe('product_launch');
    });
    it('market expansion → market_expansion/critical', () => {
      const r = classifyStrategy('Shoprite opens its first store in Kenya');
      expect(r.category).toBe('market_expansion');
      expect(r.severity).toBe('critical');
    });
    it('M&A → funding_or_ma/critical', () => {
      const r = classifyStrategy('Standard Bank acquires fintech startup for $200M');
      expect(r.category).toBe('funding_or_ma');
      expect(r.severity).toBe('critical');
    });
    it('hiring → hiring', () => {
      const r = classifyStrategy('Pick n Pay names new CEO from Walmart');
      expect(r.category).toBe('hiring');
    });
    it('trouble keywords → trouble', () => {
      const r = classifyStrategy('Old Mutual hit with class-action lawsuit');
      expect(r.category).toBe('trouble');
    });
    it('unknown headline → general', () => {
      const r = classifyStrategy('Company announces quarterly earnings');
      expect(r.category).toBe('general');
      expect(r.severity).toBe('info');
    });
    it('decodes HTML entities before classifying', () => {
      const decoded = decodeBasicEntities('Foo &amp; Bar slash&#39;es prices');
      expect(decoded).toBe("Foo & Bar slash'es prices");
    });
  });

  describe('parseRssItems', () => {
    it('parses multiple item blocks with all fields', () => {
      const xml = rssXml([
        { title: 'A', link: 'https://a.example' },
        { title: 'B', link: 'https://b.example', pubDate: 'Sat, 03 May 2026 10:00:00 GMT' },
      ]);
      const items = parseRssItems(xml);
      expect(items.length).toBe(2);
      expect(items[0].title).toBe('A');
      expect(items[0].link).toBe('https://a.example');
      expect(items[1].pubDate).toContain('03 May 2026');
    });
    it('handles CDATA wrapping', () => {
      const xml = `<rss><channel><item><title><![CDATA[Hello & welcome]]></title><link>https://x</link></item></channel></rss>`;
      const items = parseRssItems(xml);
      expect(items[0].title).toBe('Hello & welcome');
    });
    it('returns empty array on malformed input', () => {
      expect(parseRssItems('<not-rss/>')).toEqual([]);
    });
  });

  describe('sweepCompetitorIntel', () => {
    it('tenant with no competitors → no-op', async () => {
      const r = await sweepCompetitorIntel(env.DB, TENANT, {});
      expect(r.competitorsScanned).toBe(0);
      expect(r.itemsInserted).toBe(0);
      expect(fetchMock.mock.calls.length).toBe(0);
    });

    it('1 competitor + 2 RSS items → both persisted with classified categories', async () => {
      await seedCompetitor('comp-1', 'Capitec Bank');
      const xml = rssXml([
        { title: 'Capitec cuts prices on bank fees', link: 'https://news.test/1' },
        { title: 'Capitec opens first branch in Cape Town', link: 'https://news.test/2' },
      ]);
      fetchMock.mockResolvedValueOnce(new Response(xml, { status: 200 }));

      const r = await sweepCompetitorIntel(env.DB, TENANT,
        { GOOGLE_NEWS_BASE: 'https://gnews.test/search' });
      expect(r.competitorsScanned).toBe(1);
      expect(r.itemsFetched).toBe(2);
      expect(r.itemsInserted).toBe(2);

      // First call hits the test base URL with quoted competitor name
      expect(fetchMock.mock.calls[0][0]).toContain('gnews.test/search');
      expect(fetchMock.mock.calls[0][0]).toContain('Capitec');

      const rows = await env.DB.prepare(
        `SELECT title, severity, raw_data FROM radar_signals
          WHERE tenant_id = ? AND signal_type = 'competitor'
          ORDER BY title ASC`
      ).bind(TENANT).all<{ title: string; severity: string; raw_data: string }>();
      expect(rows.results?.length).toBe(2);
      const cats = rows.results!.map((r) => JSON.parse(r.raw_data).strategy_category);
      expect(cats).toContain('pricing');
      expect(cats).toContain('market_expansion');
      // Market expansion is critical, pricing is warning
      const sevByCat = new Map(rows.results!.map((row) => [
        JSON.parse(row.raw_data).strategy_category, row.severity,
      ]));
      expect(sevByCat.get('market_expansion')).toBe('critical');
      expect(sevByCat.get('pricing')).toBe('warning');
    });

    it('re-running same items → dedup by URL', async () => {
      await seedCompetitor('comp-1', 'Discovery');
      const xml = rssXml([{ title: 'Discovery Bank launches new wallet app', link: 'https://dup.test/1' }]);
      fetchMock
        .mockResolvedValueOnce(new Response(xml, { status: 200 }))
        .mockResolvedValueOnce(new Response(xml, { status: 200 }));

      const r1 = await sweepCompetitorIntel(env.DB, TENANT, {});
      expect(r1.itemsInserted).toBe(1);

      const r2 = await sweepCompetitorIntel(env.DB, TENANT, {});
      expect(r2.itemsInserted).toBe(0);
      expect(r2.itemsSkippedDuplicate).toBe(1);

      const cnt = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM radar_signals WHERE tenant_id = ? AND signal_type = 'competitor'`
      ).bind(TENANT).first<{ n: number }>();
      expect(cnt?.n).toBe(1);
    });

    it('junk title (too short) → skipped', async () => {
      await seedCompetitor('comp-1', 'X-Co');
      const xml = rssXml([{ title: 'short', link: 'https://j.test/1' }]);
      fetchMock.mockResolvedValueOnce(new Response(xml, { status: 200 }));

      const r = await sweepCompetitorIntel(env.DB, TENANT, {});
      expect(r.itemsInserted).toBe(0);
      expect(r.itemsSkippedJunk).toBe(1);
    });

    it('HTTP error on one competitor → others still processed', async () => {
      await seedCompetitor('comp-1', 'BrokenCo');
      await seedCompetitor('comp-2', 'WorkingCo');
      fetchMock
        .mockResolvedValueOnce(new Response('boom', { status: 500 }))
        .mockResolvedValueOnce(new Response(rssXml([
          { title: 'WorkingCo opens new market in Durban', link: 'https://w.test/1' },
        ]), { status: 200 }));

      const r = await sweepCompetitorIntel(env.DB, TENANT, {});
      expect(r.competitorsScanned).toBe(2);
      expect(r.competitorsFailed).toBe(1);
      expect(r.itemsInserted).toBe(1);
    });
  });
});
