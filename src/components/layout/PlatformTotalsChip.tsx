/**
 * Platform totals chip — header-resident lifetime aggregate.
 *
 * Surfaces the tenant's lifetime shared-savings revenue + run/exception
 * counts as a small pill in the header so the user can see "what has
 * Atheon done for me this year" at a glance, without having to navigate
 * to the ROI dashboard. Click navigates to /roi-dashboard where the full
 * breakdown lives.
 *
 * Hidden when nothing has ever been processed (cold-start tenant); the
 * header should not show "0 runs" or "R0 saved" — that's noise.
 *
 * Refreshes on mount + every 5 min while the tab is visible (same cadence
 * as CalibrationChip — these are slow-moving aggregates).
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Coins } from "lucide-react";
import { api } from "@/lib/api";
import type { PlatformTotals } from "@/lib/api";

const REFRESH_INTERVAL_MS = 5 * 60_000;

/** Compact value formatter: 12 345 678 → "R12.3M" / "R823k" / "R450".
 *  Keeps the chip readable at any tenant size. */
function formatCompactCurrency(value: number, currency: string): string {
  const sym = currency === 'ZAR' ? 'R' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sym}${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sym}${(value / 1_000).toFixed(0)}k`;
  return `${sym}${Math.round(value)}`;
}

export function PlatformTotalsChip(): JSX.Element | null {
  const navigate = useNavigate();
  const [totals, setTotals] = useState<PlatformTotals | null>(null);

  async function refresh() {
    try {
      const res = await api.insightsStats.platformTotals();
      setTotals(res);
    } catch {
      // Quiet failure — chip never blocks the header.
    }
  }

  useEffect(() => {
    refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  // Cold-start guard: nothing has ever happened, hide.
  if (!totals || totals.runs.total === 0) return null;

  const realised = totals.savings.total_realised;
  const hasSavings = realised > 0;

  // Pick the headline metric: realised savings if we have any, else
  // run count (catalysts have run but billing hasn't materialised yet).
  const headline = hasSavings
    ? formatCompactCurrency(realised, totals.savings.currency)
    : `${totals.runs.total.toLocaleString()}`;
  const headlineLabel = hasSavings ? 'realised' : 'runs';

  const tone = hasSavings
    ? 'text-accent border-[var(--border-card)] bg-[rgb(var(--accent-rgb)/0.1)]'
    : 'text-accent border-[var(--border-card)] bg-[rgb(var(--accent-rgb)/0.1)]';

  // Tooltip carries the full breakdown so an operator can hover for the
  // detail without clicking through to the ROI dashboard.
  const tooltipLines = [
    `Lifetime platform totals — click for ROI dashboard`,
    `Runs: ${totals.runs.total.toLocaleString()} (${totals.runs.matched.toLocaleString()} matched, ${totals.runs.discrepancies.toLocaleString()} disc, ${totals.runs.exceptions.toLocaleString()} exc)`,
    `Items processed: ${totals.items.total.toLocaleString()} · value ${formatCompactCurrency(totals.items.processed_value, totals.savings.currency)}`,
    hasSavings
      ? `Realised savings: ${formatCompactCurrency(realised, totals.savings.currency)} · Atheon revenue ${formatCompactCurrency(totals.savings.atheon_revenue, totals.savings.currency)}`
      : 'No billable period has been materialised yet.',
  ];
  if (totals.risks.critical + totals.risks.high > 0) {
    tooltipLines.push(`Open risks: ${totals.risks.critical} critical · ${totals.risks.high} high`);
  }
  if (totals.anomalies.open > 0) {
    tooltipLines.push(`Open anomalies: ${totals.anomalies.open}`);
  }

  return (
    <button
      onClick={() => navigate('/roi-dashboard')}
      className={`hidden lg:flex items-center gap-1.5 px-2 py-1 rounded-md text-caption font-medium border transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] hover:scale-[1.02] ${tone}`}
      title={tooltipLines.join('\n')}
      data-testid="platform-totals-chip"
      aria-label={`Platform totals: ${headline} ${headlineLabel}. Click for ROI dashboard.`}
    >
      <Coins size={11} />
      <span>{headline}</span>
      <span className="opacity-60">{headlineLabel}</span>
    </button>
  );
}
