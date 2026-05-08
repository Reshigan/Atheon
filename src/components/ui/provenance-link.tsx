/**
 * ProvenanceLink — every clickable number on the platform.
 *
 * Per UX audit §5.7 + system principle 3.1: every $-figure, every
 * record count, every KPI on the platform must trace back to its
 * source. Without provenance, the shared-savings billing case is
 * uncollectable.
 *
 * Usage:
 *
 *   <ProvenanceLink
 *     title="Total realised savings (last 12 periods)"
 *     subtitle="Aggregate of every billable_line_items row this period"
 *     sources={[
 *       { label: 'Source records', value: '128', linkTo: '/audit?layer=billing' },
 *       { label: 'Mapping confidence', value: '94%', tone: 'success' },
 *       { label: 'Provenance Merkle root', value: '0xa1…b3', linkTo: '/trust' },
 *     ]}
 *   >
 *     {formatCurrency(1_200_000)}
 *   </ProvenanceLink>
 *
 * The wrapped child is rendered as a button that, when clicked, slides
 * a panel in from the right showing the provenance trail. Callers can
 * pass extra rich content via `detail` for tables of records, sample
 * journal entries, etc.
 *
 * Design notes:
 *   - Inline + accessible: button renders inline (no layout shift) with
 *     a dotted underline so the affordance is visible without being noisy.
 *   - Cheap by default: no network call until click. Pre-rendered sources
 *     work without any async machinery.
 *   - Composable: `detail` accepts arbitrary JSX so rich call-sites
 *     (per-period billing, per-record drill) can render their own table.
 */
import { ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { X, Info, ExternalLink, ShieldCheck } from "lucide-react";
import { Portal } from "@/components/ui/portal";
import { Badge } from "@/components/ui/badge";

export interface ProvenanceSource {
  label: string;
  value: string | number;
  /** Internal route — opens with React Router (no full-page reload). */
  linkTo?: string;
  /** Optional tone for the value badge. */
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'outline';
  /** Optional helper text shown under the row. */
  hint?: string;
}

export interface ProvenanceLinkProps {
  /** Headline used at the top of the panel. */
  title: string;
  /** Optional subtitle / explanation under the headline. */
  subtitle?: string;
  /** Provenance rows shown in the panel body. */
  sources?: ProvenanceSource[];
  /** Optional rich content (table, code block, sample records) appended
   *  after the sources list. */
  detail?: ReactNode;
  /** Called when the panel opens — use to lazy-load expensive detail. */
  onOpen?: () => void;
  /** The number / value the user clicks. */
  children: ReactNode;
}

export function ProvenanceLink({
  title, subtitle, sources, detail, onOpen, children,
}: ProvenanceLinkProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) onOpen?.();
    // We intentionally only fire onOpen on the OPEN transition, not every
    // render of the children prop. Including onOpen in deps would re-fire
    // every render when callers pass an inline arrow function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Stop propagation so wrapping <Link> / clickable cards don't ALSO
          // navigate when the user just wants the provenance panel.
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        className="inline-flex items-baseline gap-1 underline decoration-dotted decoration-1 underline-offset-2 hover:decoration-solid hover:text-accent transition-colors"
        title="View provenance"
      >
        {children}
      </button>

      {open && (
        <Portal>
          <div
            className="fixed inset-0 z-[9000] flex justify-end"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setOpen(false)}
          >
            <div
              className="relative h-full overflow-y-auto shadow-2xl border-l flex flex-col"
              style={{
                width: 'min(480px, 100vw)',
                background: 'var(--bg-card-solid)',
                borderColor: 'var(--border-card)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--border-card)' }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={14} className="text-accent flex-shrink-0" />
                    <h2 className="text-sm font-semibold t-primary truncate">{title}</h2>
                  </div>
                  {subtitle && (
                    <p className="text-[11px] t-muted mt-1">{subtitle}</p>
                  )}
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1 rounded hover:bg-[var(--bg-secondary)] t-muted hover:t-primary"
                  aria-label="Close provenance panel"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {sources && sources.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-[10px] uppercase tracking-wide t-muted font-semibold">Sources</h3>
                    <ul className="divide-y" style={{ borderColor: 'var(--border-card)' }}>
                      {sources.map((s, i) => (
                        <li key={i} className="py-2 flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs t-secondary">{s.label}</div>
                            {s.hint && <div className="text-[10px] t-muted mt-0.5">{s.hint}</div>}
                          </div>
                          <div className="flex-shrink-0 flex items-center gap-2">
                            {s.tone ? (
                              <Badge variant={s.tone} size="sm">{String(s.value)}</Badge>
                            ) : (
                              <span className="text-xs font-mono t-primary">{String(s.value)}</span>
                            )}
                            {s.linkTo && (
                              <Link
                                to={s.linkTo}
                                className="text-accent hover:t-primary"
                                title="Open detail page"
                                onClick={() => setOpen(false)}
                              >
                                <ExternalLink size={12} />
                              </Link>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {detail && (
                  <div className="space-y-2">
                    <h3 className="text-[10px] uppercase tracking-wide t-muted font-semibold">Detail</h3>
                    <div className="text-xs t-secondary">{detail}</div>
                  </div>
                )}

                {(!sources || sources.length === 0) && !detail && (
                  <div className="flex items-center gap-2 text-xs t-muted">
                    <Info size={12} />
                    No provenance recorded for this figure yet.
                  </div>
                )}
              </div>

              <div className="px-5 py-3 border-t text-[10px] t-muted" style={{ borderColor: 'var(--border-card)' }}>
                Every claimed figure must trace to ERP record + field mapping + confidence.
                Use <Link to="/audit" className="text-accent hover:underline" onClick={() => setOpen(false)}>Audit</Link> for
                the full chain.
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}

export default ProvenanceLink;
