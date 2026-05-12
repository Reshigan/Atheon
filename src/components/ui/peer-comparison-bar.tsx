/**
 * §11.4 Peer Comparison Bar — Range bar showing position vs industry peers
 *
 * Shows the IQR range, your score, and the percentile rank. When the user
 * is below the median, a "Deploy [recommended catalyst]" CTA appears so
 * the buyer-grade benchmark connects directly to executable action.
 */
import { useNavigate } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { recommendForDimension, catalystDeployUrl } from '@/lib/catalyst-recommendation';
import type { PeerBenchmarkItem } from '@/lib/api';

export function PeerComparisonBar({ benchmark }: { benchmark: PeerBenchmarkItem }) {
  const navigate = useNavigate();
  const { dimension, p25Score, p50Score, p75Score, ownScore, percentileRank } = benchmark;
  const min = Math.max(0, p25Score - 10);
  const max = Math.min(100, p75Score + 10);
  const range = max - min || 1;

  const toPercent = (val: number) => Math.max(0, Math.min(100, ((val - min) / range) * 100));

  const rankColor = percentileRank === 'top_25' ? 'text-emerald-500' : percentileRank === 'above_median' ? 'text-blue-400' : percentileRank === 'below_median' ? 'text-amber-400' : 'text-red-400';
  const rankLabel = percentileRank === 'top_25' ? 'Top 25%' : percentileRank === 'above_median' ? 'Above Median' : percentileRank === 'below_median' ? 'Below Median' : percentileRank === 'bottom_25' ? 'Bottom 25%' : '—';

  // CTA shown when the tenant is below the median in this dimension and a
  // catalyst recommendation resolves. Connects the moat-grade benchmark to
  // a one-click action — exec sees the gap, deploys the resolver.
  const isBehind = ownScore !== null
    && (percentileRank === 'below_median' || percentileRank === 'bottom_25');
  const rec = isBehind ? recommendForDimension(dimension) : null;
  const gap = isBehind && ownScore !== null
    ? Math.round(p50Score - ownScore)
    : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium t-primary capitalize">{dimension}</span>
        <span className={`text-caption font-medium ${rankColor}`}>{rankLabel}</span>
      </div>
      <div className="relative h-3 rounded-full bg-[var(--bg-secondary)]">
        {/* IQR range bar (P25-P75) */}
        <div
          className="absolute h-full rounded-full opacity-30"
          style={{
            left: `${toPercent(p25Score)}%`,
            width: `${toPercent(p75Score) - toPercent(p25Score)}%`,
            background: '#7EB3CD',
          }}
        />
        {/* Median marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-[#7EB3CD]"
          style={{ left: `${toPercent(p50Score)}%` }}
        />
        {/* Own score marker */}
        {ownScore !== null && (
          <div
            className="absolute top-[-2px] w-4 h-4 rounded-full border-2 border-white shadow-md"
            style={{
              left: `calc(${toPercent(ownScore)}% - 8px)`,
              background: percentileRank === 'top_25' ? '#A3B18A' : percentileRank === 'above_median' ? '#60a5fa' : percentileRank === 'below_median' ? '#CDA37E' : '#ef4444',
            }}
          />
        )}
      </div>
      <div className="flex items-center justify-between text-caption t-muted">
        <span>P25: {p25Score}</span>
        <span>P50: {p50Score}</span>
        <span>P75: {p75Score}</span>
        {ownScore !== null && <span className="font-medium t-primary">You: {ownScore}</span>}
      </div>
      {rec && (
        <div className="flex items-center justify-between gap-2 mt-2 p-2 rounded-md bg-amber-500/5 border border-amber-500/20">
          <div className="text-caption t-secondary">
            You're <span className="font-semibold t-primary">{gap} pts</span> behind peer median.
            Deploy <span className="font-medium t-primary">{rec.catalyst}</span> → <span className="font-medium t-primary">{rec.subCatalyst}</span> to close the gap.
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate(catalystDeployUrl(rec))}
            data-testid={`peer-cta-${dimension.toLowerCase().replace(/\s+/g, '-')}`}
          >
            <Zap size={11} className="mr-1" /> Close gap
          </Button>
        </div>
      )}
    </div>
  );
}
