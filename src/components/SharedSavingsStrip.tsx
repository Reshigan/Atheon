/**
 * SharedSavingsStrip — persistent CFO-facing "R0 until you save R1" banner.
 *
 * Phase AV sales-unblocker: the shared-savings revenue model IS the entire
 * no-brainer purchase decision, but today it lives only on /roi-dashboard.
 * Executives (CFO, COO) land on /dashboard and rarely visit /roi-dashboard
 * voluntarily — so the headline financial proof is invisible at the moment
 * they're framing the program internally.
 *
 * This component renders a slim, dismissible-per-session strip with three
 * facts: cumulative recovered, billed to date, ROI multiple. It sits at the
 * very top of the executive surfaces (Dashboard, Apex, ROI) and quietly
 * reinforces the framing on every glance.
 *
 * Design choices:
 *   - Sage accent-subtle background (same token used elsewhere for
 *     positive-affirmation surfaces), keeps it on-brand
 *   - Dismissible via sessionStorage so it stays out of the way once the
 *     exec acknowledges it (per-session, not per-account — they should see
 *     it fresh each working day)
 *   - Drill-through link → /roi-dashboard for the auditable detail
 *   - Hidden entirely if no billing data exists yet (fresh tenants don't
 *     need a "you've recovered R0" banner — that's noise)
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, X, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import type { BillingSummary } from '@/lib/api';

const DISMISS_KEY = 'atheon:savings-strip-dismissed';

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString()}`;
  }
}

export function SharedSavingsStrip(): JSX.Element | null {
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    let cancelled = false;
    api.insightsStats.billingSummary()
      .then((b) => { if (!cancelled) setBilling(b); })
      .catch(() => { /* missing billing is a normal state for fresh tenants */ });
    return () => { cancelled = true; };
  }, []);

  // Skip rendering for fresh tenants (no realised savings yet) and for users
  // who've dismissed it this session.
  if (dismissed) return null;
  if (!billing) return null;
  if ((billing.total_realised_savings ?? 0) <= 0) return null;

  const recovered = billing.total_realised_savings;
  const billed = billing.total_atheon_revenue ?? 0;
  const multiple = billed > 0 ? recovered / billed : 0;
  const currency = billing.currency || 'ZAR';

  const handleDismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* private browsing */ }
    setDismissed(true);
  };

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 rounded-xl text-body-sm flex-wrap"
      style={{
        background: 'rgba(163, 177, 138, 0.08)',
        border: '1px solid rgba(163, 177, 138, 0.30)',
      }}
      data-testid="shared-savings-strip"
    >
      <div className="flex items-center gap-3 flex-wrap min-w-0">
        <TrendingUp size={14} style={{ color: 'var(--accent)' }} aria-hidden="true" />
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <span className="t-secondary">
            <strong className="t-primary font-semibold tabular-nums font-mono">{formatCurrency(recovered, currency)}</strong> recovered
          </span>
          <span className="t-muted">•</span>
          <span className="t-secondary">
            Atheon billed <strong className="t-primary font-semibold tabular-nums font-mono">{formatCurrency(billed, currency)}</strong>
          </span>
          {multiple > 0 && (
            <>
              <span className="t-muted">•</span>
              <span className="t-secondary">
                <strong className="text-emerald-500 font-semibold tabular-nums font-mono">{multiple.toFixed(1)}x</strong> return
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link
          to="/roi-dashboard"
          className="text-caption text-accent hover:underline inline-flex items-center gap-1 font-medium"
        >
          Detail <ArrowRight size={11} />
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          className="t-muted hover:t-primary p-0.5 rounded transition-colors"
          aria-label="Dismiss savings summary for this session"
          title="Dismiss for this session"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

export default SharedSavingsStrip;
