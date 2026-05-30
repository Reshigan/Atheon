/**
 * PeerInsightsBadge — DP-noised cross-tenant resolution pattern.
 *
 * Inline component for the AssessmentFindingsPanel. For each finding,
 * looks up the federated peer pattern (industry_bucket × finding_code)
 * and renders one line: "When companies like yours had this issue, the
 * median company resolved it in 18 days and recovered 4.2% of value-at-
 * risk (n=14, ε=1.0)."
 *
 * Privacy notes:
 *   - The pattern is published only when n >= 5 distinct contributors.
 *   - The mean is differentially-private (Laplace, ε=1.0). Re-querying
 *     does NOT re-noise.
 *   - Buckets below the threshold render nothing — no insight worth a
 *     misleading half-message.
 */
import { useEffect, useState } from 'react';
import { Sparkles, Lock } from 'lucide-react';
import { api } from '@/lib/api';
import type { FederatedPattern } from '@/lib/api';

interface Props {
  findingCode: string;
  industry?: string;
}

export function PeerInsightsBadge({ findingCode, industry = 'general' }: Props): JSX.Element | null {
  const [pattern, setPattern] = useState<FederatedPattern | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.peerPatterns.get(findingCode, industry);
        if (!cancelled) {
          setPattern(result.pattern);
          setLoaded(true);
        }
      } catch {
        // Endpoint might 404 / 403 in some test contexts — be silent and
        // render nothing rather than disrupting the parent finding card.
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [findingCode, industry]);

  // Below k-anonymity floor or unknown — render nothing rather than
  // expose privacy-violating partial data or a confusing empty card.
  if (!loaded || !pattern) return null;

  return (
    <div
      className="rounded-sm p-3 flex items-start gap-3"
      style={{
        background: 'rgb(var(--accent-rgb) / 0.06)',
        border: '1px solid rgb(var(--accent-rgb) / 0.18)',
      }}
      data-testid={`peer-insights-${findingCode}`}
    >
      <Sparkles size={14} className="text-accent flex-shrink-0 mt-[2px]" />
      <div className="flex-1 text-xs">
        <div className="t-primary mb-1">
          <strong>Peer pattern.</strong>{' '}
          When {pattern.n_contributors} similar companies in <em>{pattern.industry_bucket}</em> had this issue,
          they resolved it in a median of <strong>{Math.round(pattern.avg_resolved_days)} days</strong>{' '}
          and recovered <strong>{pattern.avg_recovery_pct.toFixed(1)}%</strong> of value-at-risk
          (cohort spread: {pattern.p25_recovery_pct.toFixed(0)}%–{pattern.p75_recovery_pct.toFixed(0)}%).
        </div>
        <div className="t-muted flex items-center gap-1 text-caption">
          <Lock size={10} />
          <span>
            Differential privacy ε={pattern.epsilon} · Laplace mechanism · refreshed{' '}
            {new Date(pattern.last_refreshed_at).toLocaleDateString()}
          </span>
        </div>
      </div>
    </div>
  );
}
