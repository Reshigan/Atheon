/**
 * Phase 10-14a — Competitor source quality.
 *
 * Covers:
 *  Pure helpers
 *   1. extractHost handles full URLs, strips www., null on garbage
 *   2. qualityForHost: registry hits + subdomain walk-up + default
 *   3. adjustSeverity: high quality promotes 'info' on trouble
 *   4. adjustSeverity: low quality demotes critical → warning
 *
 *  End-to-end via competitor sweep
 *   5. High-quality outlet (reuters.com) on a 'trouble' headline →
 *      severity persisted as 'warning' (promoted from info)
 *   6. Low-quality outlet on 'market_expansion' (default critical) →
 *      severity persisted as 'warning' (demoted)
 *   7. Tenant override via tenant_settings replaces default quality
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  extractHost,
  qualityForHost,
  adjustSeverity,
  loadEffectiveSourceQuality,
} from '../services/competitor-source-quality';
import { sweepCompetitorIntel } from '../services/competitor-intel-source';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'csq-tenant';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}

async function seedCompetitor(id: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO competitors (id, tenant_id, name, industry, signals_count)
     VALUES (?, ?, ?, 'finance', 0)`
  ).bind(id, TENANT, name).run();
}

function rss(items: Array<{ title: string; link: string }>): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel>${
    items.map((i) => `<item>
      <title><![CDATA[${i.title}]]></title>
      <link>${i.link}</link>
      <pubDate>Fri, 02 May 2026 08:00:00 GMT</pubDate>
      <description>desc</description>
    </item>`).join('')
  }</channel></rss>`;
}

let fetchMock: ReturnType<typeof vi.fn>;

describe('Phase 10-14a — competitor source quality', () => {
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
    await env.DB.prepare(
      `DELETE FROM tenant_settings WHERE tenant_id = ? AND key = 'competitor_source_overrides'`
    ).bind(TENANT).run();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  describe('extractHost', () => {
    it('extracts host, strips www., lowercases', () => {
      expect(extractHost('https://www.Reuters.com/article/123')).toBe('reuters.com');
      expect(extractHost('http://m.bbc.co.uk/news')).toBe('m.bbc.co.uk');
    });
    it('returns null on garbage', () => {
      expect(extractHost('not a url')).toBeNull();
      expect(extractHost('')).toBeNull();
    });
  });

  describe('qualityForHost', () => {
    it('exact match in registry', () => {
      expect(qualityForHost('reuters.com')).toBeGreaterThan(0.9);
      expect(qualityForHost('businesslive.co.za')).toBeGreaterThan(0.8);
    });
    it('subdomain walks up to parent', () => {
      expect(qualityForHost('m.bbc.co.uk')).toBeGreaterThan(0.85);
    });
    it('unknown host → 0.5 default', () => {
      expect(qualityForHost('random-blog.example')).toBe(0.5);
    });
  });

  describe('adjustSeverity', () => {
    it('high-quality + info on trouble → warning', () => {
      expect(adjustSeverity('info', 'trouble', 0.95)).toBe('warning');
    });
    it('high-quality + info on non-trouble → unchanged', () => {
      expect(adjustSeverity('info', 'partnership', 0.95)).toBe('info');
    });
    it('low-quality demotes critical → warning', () => {
      expect(adjustSeverity('critical', 'market_expansion', 0.2)).toBe('warning');
    });
    it('low-quality demotes warning → info', () => {
      expect(adjustSeverity('warning', 'pricing', 0.2)).toBe('info');
    });
    it('mid-quality (0.5..0.85) → unchanged', () => {
      expect(adjustSeverity('critical', 'funding_or_ma', 0.6)).toBe('critical');
      expect(adjustSeverity('info', 'general', 0.6)).toBe('info');
    });
  });

  describe('end-to-end via sweep', () => {
    it('high-quality outlet on trouble headline → severity warning (promoted)', async () => {
      await seedCompetitor('c-1', 'Capitec Bank');
      fetchMock.mockResolvedValueOnce(new Response(rss([
        { title: 'Capitec hit with class-action lawsuit', link: 'https://www.reuters.com/article/abc' },
      ]), { status: 200 }));

      const r = await sweepCompetitorIntel(env.DB, TENANT, {});
      expect(r.itemsInserted).toBe(1);

      const row = await env.DB.prepare(
        `SELECT severity, raw_data FROM radar_signals WHERE tenant_id = ?`
      ).bind(TENANT).first<{ severity: string; raw_data: string }>();
      expect(row?.severity).toBe('warning');
      const raw = JSON.parse(row!.raw_data) as { source_host: string; source_quality: number; raw_severity: string };
      expect(raw.source_host).toBe('reuters.com');
      expect(raw.source_quality).toBeGreaterThan(0.9);
      expect(raw.raw_severity).toBe('info'); // trouble category default is 'info'
    });

    it('low-quality outlet on market_expansion (critical) → demoted to warning', async () => {
      await seedCompetitor('c-2', 'Some Bank');
      fetchMock.mockResolvedValueOnce(new Response(rss([
        { title: 'Some Bank opens its first branch in Botswana', link: 'https://random-blog.example/post/9' },
      ]), { status: 200 }));
      // Override random-blog.example to low-quality
      await env.DB.prepare(
        `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_at)
         VALUES (?, ?, 'competitor_source_overrides', ?, datetime('now'))`
      ).bind(crypto.randomUUID(), TENANT, JSON.stringify({ 'random-blog.example': 0.2 })).run();

      const r = await sweepCompetitorIntel(env.DB, TENANT, {});
      expect(r.itemsInserted).toBe(1);

      const row = await env.DB.prepare(
        `SELECT severity, raw_data FROM radar_signals WHERE tenant_id = ?`
      ).bind(TENANT).first<{ severity: string; raw_data: string }>();
      expect(row?.severity).toBe('warning'); // demoted from critical
      const raw = JSON.parse(row!.raw_data) as { raw_severity: string };
      expect(raw.raw_severity).toBe('critical');
    });

    it('tenant override via tenant_settings is loaded into effective registry', async () => {
      await env.DB.prepare(
        `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_at)
         VALUES (?, ?, 'competitor_source_overrides', ?, datetime('now'))`
      ).bind(crypto.randomUUID(), TENANT, JSON.stringify({ 'mytrustedblog.com': 0.92 })).run();

      const reg = await loadEffectiveSourceQuality(env.DB, TENANT);
      expect(reg['mytrustedblog.com']).toBe(0.92);
      // Defaults still present
      expect(reg['reuters.com']).toBeGreaterThan(0.9);
    });
  });
});
