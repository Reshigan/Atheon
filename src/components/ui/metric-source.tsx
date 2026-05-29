/**
 * MetricSource — source-of-measure popover for KPI cards.
 *
 * Every number on every card is a claim. SAP-grade transparency means
 * every claim must trace back to: the table it came from, the SQL/query
 * it ran, the window it covered, and how many records contributed.
 * This primitive renders a small ⓘ trigger next to a metric that opens
 * a popover showing those provenance facts so the operator can audit
 * any number without leaving the screen.
 *
 * Usage:
 *
 *   <div className="flex items-center gap-1">
 *     <span className="text-headline-lg">{count}</span>
 *     <MetricSource source={{
 *       label: 'Pending actions',
 *       definition: 'Catalyst write-back proposals awaiting human approval',
 *       table: 'catalyst_actions',
 *       endpoint: 'GET /api/erp/actions/summary',
 *       query: "COUNT(*) WHERE status = 'pending_approval'",
 *       window: 'All time',
 *       sample: count,
 *       refreshedAt: lastLoadedAt,
 *     }} />
 *   </div>
 *
 * Provenance shape is deliberately structured — every field is optional
 * but the more the card declares, the more transparent it is. Pages
 * that don't yet know their source can pass `{ label, definition }`
 * to ship the trigger without lying about provenance.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Info, X } from 'lucide-react';
import { Numeric } from '@/components/ui/numeric';

export interface MetricProvenance {
  /** Short human-readable name of the metric, e.g. "Pending actions" */
  label: string;
  /** One-line plain-English definition of what the number counts/sums */
  definition?: string;
  /** Source table or view — e.g. "catalyst_actions" or "v_pulse_throughput" */
  table?: string;
  /** Backend endpoint that returned it — e.g. "GET /api/erp/actions/summary" */
  endpoint?: string;
  /** SQL-ish query hint — e.g. "COUNT(*) WHERE status = 'pending_approval'" */
  query?: string;
  /** Time window the metric covers — e.g. "Last 30 days" or "All time" */
  window?: string;
  /** Number of records that contributed to the value */
  sample?: number;
  /** Inference confidence (0–1) for ML/heuristic-derived metrics */
  confidence?: number;
  /** ISO timestamp of when the metric was last recomputed/fetched */
  refreshedAt?: string | null;
  /** Optional drill-through path — e.g. "/action-layer?status=pending_approval" */
  drillTo?: string;
  /** Free-form extra rows for cases the structured fields don't capture */
  notes?: Array<{ label: string; value: ReactNode }>;
}

interface MetricSourceProps {
  source: MetricProvenance;
  className?: string;
  /** Render the trigger as a different element. Default: small ⓘ icon button. */
  triggerSize?: number;
}

export function MetricSource({ source, className = '', triggerSize = 12 }: MetricSourceProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Outside-click + ESC close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        popoverRef.current && !popoverRef.current.contains(t) &&
        triggerRef.current && !triggerRef.current.contains(t)
      ) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const hasAnyDetail = !!(
    source.definition || source.table || source.endpoint || source.query ||
    source.window || source.sample != null || source.confidence != null ||
    source.refreshedAt || source.drillTo || (source.notes && source.notes.length)
  );

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="inline-flex items-center justify-center rounded-full t-muted hover:t-primary transition-colors p-0.5"
        aria-label={`Source of ${source.label}`}
        aria-expanded={open}
        title={`Where ${source.label} comes from`}
      >
        <Info size={triggerSize} />
      </button>
      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`Source of ${source.label}`}
          className="absolute z-40 top-full right-0 mt-2 w-80 rounded-md p-3 text-left"
          style={{
            background: 'var(--bg-modal)',
            border: '1px solid var(--border-card)',
            boxShadow: 'var(--shadow-modal)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="text-caption uppercase tracking-wider t-muted font-medium">
              Source of measure
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="t-muted hover:t-primary p-0.5 rounded transition-colors"
              aria-label="Close"
            >
              <X size={12} />
            </button>
          </div>
          <div className="text-body-sm font-semibold t-primary mb-2">{source.label}</div>
          {!hasAnyDetail && (
            <p className="text-caption t-muted italic">No provenance declared.</p>
          )}
          <dl className="space-y-2">
            {source.definition && (
              <Row label="Definition">
                <span className="t-secondary">{source.definition}</span>
              </Row>
            )}
            {source.table && (
              <Row label="Table">
                <code className="font-mono text-caption px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                  {source.table}
                </code>
              </Row>
            )}
            {source.endpoint && (
              <Row label="Endpoint">
                <code className="font-mono text-caption px-1.5 py-0.5 rounded break-all" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                  {source.endpoint}
                </code>
              </Row>
            )}
            {source.query && (
              <Row label="Query">
                <code className="font-mono text-caption block whitespace-pre-wrap px-2 py-1.5 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                  {source.query}
                </code>
              </Row>
            )}
            {source.window && <Row label="Window"><span className="t-secondary">{source.window}</span></Row>}
            {source.sample != null && (
              <Row label="Sample">
                <span className="t-secondary tabular-nums font-mono">
                  <Numeric value={source.sample} size="sm" /> record{source.sample === 1 ? '' : 's'}
                </span>
              </Row>
            )}
            {source.confidence != null && (
              <Row label="Confidence">
                <span className="t-secondary tabular-nums font-mono">{Math.round(source.confidence * 100)}%</span>
              </Row>
            )}
            {source.refreshedAt && (
              <Row label="Refreshed">
                <span className="t-secondary" title={source.refreshedAt}>
                  {new Date(source.refreshedAt).toLocaleString()}
                </span>
              </Row>
            )}
            {source.notes?.map((n, i) => (
              <Row key={i} label={n.label}><span className="t-secondary">{n.value}</span></Row>
            ))}
          </dl>
          {source.drillTo && (
            <div className="mt-3 pt-2 border-t flex justify-end" style={{ borderColor: 'var(--border-card)' }}>
              <a
                href={source.drillTo}
                className="text-caption text-accent hover:underline inline-flex items-center gap-1"
              >
                Drill into source →
              </a>
            </div>
          )}
        </div>
      )}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="text-caption t-muted uppercase tracking-wider min-w-[80px] flex-shrink-0 pt-0.5">{label}</dt>
      <dd className="text-caption flex-1 min-w-0">{children}</dd>
    </div>
  );
}

export default MetricSource;
