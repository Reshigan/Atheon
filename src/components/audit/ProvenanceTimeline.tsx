/**
 * `<ProvenanceTimeline>` — Stitch "Audit — Provenance Ledger" timeline.
 *
 * Replaces the flat table render with a chronological ledger:
 *   - Entries grouped by calendar day (relative-headed: "Today",
 *     "Yesterday", then ISO date)
 *   - Sage vertical rail with outcome-coloured dots
 *   - Each entry is a glass card with action / layer / resource / details
 *
 * The component is presentational — it accepts an already-filtered
 * AuditEntry[] and renders. Filter UI, search, CSV export etc. remain
 * on the page.
 */
import type { AuditEntry } from '@/lib/api';
import { LayerBadge } from '@/components/ui/layer-badge';

interface ProvenanceTimelineProps {
  entries: AuditEntry[];
  className?: string;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => {
    const c = new Date(x);
    c.setHours(0, 0, 0, 0);
    return c.getTime();
  };
  const diffDays = Math.floor((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface OutcomeStyle { dot: string; ring: string; label: string; symbol: string }
const OUTCOME_STYLES: Record<string, OutcomeStyle> = {
  success: { dot: 'var(--accent)', ring: 'rgb(var(--accent-rgb) / 0.25)', label: 'Success', symbol: 'check_circle' },
  pending: { dot: 'var(--warning)', ring: 'rgba(251, 191, 36, 0.25)', label: 'Pending', symbol: 'schedule' },
  failure: { dot: 'var(--neg)', ring: 'rgb(var(--neg-rgb) / 0.25)', label: 'Failed',  symbol: 'cancel' },
};
function outcomeStyle(outcome: string): OutcomeStyle {
  return OUTCOME_STYLES[outcome] ?? OUTCOME_STYLES.success;
}

export function ProvenanceTimeline({ entries, className = '' }: ProvenanceTimelineProps): JSX.Element {
  if (entries.length === 0) {
    return (
      <div
        className={`rounded-2xl p-10 text-center ${className}`}
        style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}
      >
        <p className="text-body-sm t-muted">No entries match the current filters.</p>
      </div>
    );
  }

  // Group by calendar day, descending — entries arrive descending from the
  // backend so we preserve that ordering.
  const groups: { label: string; items: AuditEntry[] }[] = [];
  let currentLabel = '';
  for (const e of entries) {
    const lbl = dayLabel(e.createdAt);
    if (lbl !== currentLabel) {
      groups.push({ label: lbl, items: [] });
      currentLabel = lbl;
    }
    groups[groups.length - 1].items.push(e);
  }

  return (
    <div className={`relative ${className}`}>
      {/* Vertical sage rail along the gutter */}
      <div
        aria-hidden="true"
        className="absolute top-0 bottom-0 w-px"
        style={{
          left: 14,
          background: 'linear-gradient(to bottom, var(--accent) 0%, rgb(var(--accent-rgb) / 0.10) 100%)',
          opacity: 0.45,
        }}
      />
      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.label} aria-labelledby={`day-${group.label}`}>
            <header className="flex items-center gap-3 mb-3 pl-9">
              <h3
                id={`day-${group.label}`}
                className="text-caption uppercase tracking-widest t-muted font-mono"
              >
                {group.label}
              </h3>
              <span className="text-caption t-muted">
                · {group.items.length} {group.items.length === 1 ? 'entry' : 'entries'}
              </span>
            </header>

            <ul className="space-y-2">
              {group.items.map((e) => {
                const os = outcomeStyle(e.outcome);
                const details = e.details
                  ? Object.entries(e.details).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')
                  : null;
                return (
                  <li key={e.id} className="relative pl-9">
                    {/* Outcome dot pinned to the rail */}
                    <span
                      aria-hidden="true"
                      className="absolute left-[10px] top-3 w-2.5 h-2.5 rounded-full"
                      style={{
                        background: os.dot,
                        boxShadow: `0 0 0 4px ${os.ring}`,
                      }}
                    />
                    <div
                      className="rounded-xl px-4 py-3 transition-colors hover:bg-[var(--bg-secondary)] active:scale-[0.97]"
                      style={{
                        background: 'var(--bg-card-solid)',
                        border: '1px solid var(--border-card)',
                      }}
                    >
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-body-sm font-semibold t-primary">{e.action}</span>
                        <LayerBadge layer={e.layer} />
                        <span
                          className="text-caption font-medium rounded-full px-2 py-0.5 inline-flex items-center gap-1"
                          style={{
                            color: os.dot,
                            background: os.ring,
                            border: `1px solid ${os.dot}40`,
                          }}
                        >
                          {os.label}
                        </span>
                        <span className="text-caption font-mono t-muted ml-auto">{timeOnly(e.createdAt)}</span>
                      </div>
                      {e.resource && (
                        <p className="text-caption font-mono t-muted mb-1 truncate" title={e.resource}>
                          Resource: <span className="t-secondary">{e.resource}</span>
                        </p>
                      )}
                      {details && (
                        <p className="text-caption t-muted leading-relaxed line-clamp-2" title={details}>
                          {details}
                        </p>
                      )}
                      {(e.userId || e.ipAddress) && (
                        <div className="flex flex-wrap items-center gap-3 mt-1 text-caption t-muted font-mono">
                          {e.userId && <span>user: {e.userId}</span>}
                          {e.ipAddress && <span>ip: {e.ipAddress}</span>}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
