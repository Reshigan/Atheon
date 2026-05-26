/**
 * §9.3 Data Freshness Indicators
 * Global freshness dot for header + per-section freshness labels.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { FreshnessResponse, FreshnessSection } from "@/lib/api";
import { Clock, RefreshCw } from "lucide-react";

function ageLabel(minutes: number | null): string {
  if (minutes === null) return 'No data';
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const statusDot: Record<string, string> = {
  fresh: 'bg-emerald-500',
  stale: 'bg-amber-500',
  unknown: 'bg-gray-400',
};

/** Compact dot for the header bar */
export function FreshnessDot() {
  const [data, setData] = useState<FreshnessResponse | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    api.freshness.get().then(setData).catch(() => { /* silent */ });
    const interval = setInterval(() => {
      api.freshness.get().then(setData).catch(() => { /* silent */ });
    }, 120000); // refresh every 2 min
    return () => clearInterval(interval);
  }, []);

  if (!data) return null;

  return (
    <div className="relative" onMouseEnter={() => setShowTooltip(true)} onMouseLeave={() => setShowTooltip(false)}>
      <div className="flex items-center gap-1 px-1.5 py-1 rounded-md cursor-default" title={`Data freshness: ${data.globalStatus}`}>
        <div className={`w-2 h-2 rounded-full ${statusDot[data.globalStatus]} animate-pulse`} />
        <span className="text-caption t-muted hidden sm:inline">
          {data.globalStatus === 'fresh' ? 'Fresh' : data.globalStatus === 'stale' ? 'Stale' : '—'}
        </span>
      </div>

      {showTooltip && (
        <div
          className="absolute right-0 top-full mt-1 w-64 rounded-lg z-50 p-3"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', boxShadow: 'var(--shadow-dropdown)' }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <Clock size={12} className="t-muted" />
            <span className="text-caption font-medium t-primary uppercase tracking-wider">Data Freshness</span>
          </div>
          <div className="space-y-1.5">
            {data.sections.map((s) => (
              <div key={s.section} className="flex items-center justify-between text-caption">
                <span className="t-secondary truncate flex-1">{s.section}</span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <div className={`w-1.5 h-1.5 rounded-full ${statusDot[s.status]}`} />
                  <span className="t-muted">{ageLabel(s.ageMinutes)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Per-section freshness badge for use inside page sections */
export function SectionFreshness({ section }: { section: string }) {
  const [sectionData, setSectionData] = useState<FreshnessSection | null>(null);

  const load = useCallback(() => {
    api.freshness.get().then((data) => {
      const match = data.sections.find(s => s.section.toLowerCase().includes(section.toLowerCase()));
      if (match) setSectionData(match);
    }).catch(() => { /* silent */ });
  }, [section]);

  useEffect(() => { load(); }, [load]);

  if (!sectionData) return null;

  return (
    <div className="inline-flex items-center gap-1 text-caption t-muted" title={`Last updated: ${sectionData.lastUpdated || 'Never'}`}>
      <div className={`w-1.5 h-1.5 rounded-full ${statusDot[sectionData.status]}`} />
      <span>{ageLabel(sectionData.ageMinutes)}</span>
      <button onClick={load} className="p-0.5 rounded hover:bg-[var(--bg-secondary)] transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]" title="Refresh freshness">
        <RefreshCw size={9} />
      </button>
    </div>
  );
}
