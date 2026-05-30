/**
 * `<ExecutiveActionsCallout>` — the "Executive Actions Required" hero from the
 * Stitch Athens Executive Interface (Apex → Briefing tab).
 *
 * One amber-bordered card at the top of the briefing tab that surfaces the
 * top-N urgent risks with mitigation CTAs. Pulls the risk register that's
 * already loaded on the page — no extra fetch.
 *
 * Hidden when there are no critical / high severity risks. Critical actions use
 * var(--neg) for the must-act-now state; high severity uses var(--warning).
 */
import type { Risk } from '@/lib/api';
import { recommendForRisk, catalystDeployUrl } from '@/lib/catalyst-recommendation';
import { useNavigate } from 'react-router-dom';
import { Numeric } from '@/components/ui/numeric';

interface Props {
  risks: Risk[];
  /** Optional opener for the trace modal (Apex passes its own handler). */
  onTrace?: (riskId: string) => void;
}

export function ExecutiveActionsCallout({ risks, onTrace }: Props): JSX.Element | null {
  const navigate = useNavigate();
  const urgent = risks
    .filter((r) => r.severity === 'critical' || r.severity === 'high')
    .slice(0, 3);

  if (urgent.length === 0) return null;

  return (
    <section
      className="rounded-md border p-lg relative overflow-hidden bg-[var(--bg-card-solid)]"
      style={{ borderLeft: '3px solid var(--neg)' }}
      aria-labelledby="exec-actions-required"
    >
      <span
        className="material-symbols-outlined absolute opacity-10 pointer-events-none"
        style={{
          top: 4,
          right: 4,
          fontSize: 120,
          color: 'var(--neg)',
        }}
        aria-hidden="true"
      >
        warning
      </span>
      <div className="relative z-10 flex flex-col md:flex-row gap-6 md:items-start">
        <div
          className="shrink-0 w-12 h-12 rounded-full flex items-center justify-center border"
          style={{
            background: 'rgb(var(--neg-rgb) / 0.12)',
            borderColor: 'rgb(var(--neg-rgb) / 0.30)',
          }}
        >
          <span
            className="material-symbols-outlined text-neg"
            style={{ fontVariationSettings: "'FILL' 1" }}
            aria-hidden="true"
          >
            priority_high
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <h2
            id="exec-actions-required"
            className="text-headline-md font-bold mb-4 text-neg"
          >
            Executive Actions Required
          </h2>
          <div className="flex flex-col gap-3">
            {urgent.map((r) => {
              const rec = recommendForRisk({ category: r.category, title: r.title });
              const isCritical = r.severity === 'critical';
              const sevTone = isCritical ? 'var(--neg)' : 'var(--warning)';
              const sevBg = isCritical ? 'rgb(var(--neg-rgb) / 0.18)' : 'rgb(var(--warning-rgb) / 0.18)';
              const sevBorder = isCritical ? 'rgb(var(--neg-rgb) / 0.30)' : 'rgb(var(--warning-rgb) / 0.30)';
              return (
                <div
                  key={r.id}
                  className="bg-[var(--bg-card-solid)] border border-[var(--border-card)] rounded p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span
                      className="px-2 py-1 rounded font-mono text-[10px] font-semibold uppercase tracking-wider border whitespace-nowrap"
                      style={{ color: sevTone, background: sevBg, borderColor: sevBorder }}
                    >
                      {r.severity}
                    </span>
                    <div className="min-w-0">
                      <p className="text-body-base font-medium t-primary truncate">{r.title}</p>
                      <p className="text-caption t-muted mt-1 font-mono">
                        Impact:{' '}
                        {onTrace ? (
                          <button
                            type="button"
                            onClick={() => onTrace(r.id)}
                            className="t-primary underline decoration-dotted underline-offset-4 hover:text-accent transition-colors"
                          >
                            <Numeric
                              value={r.impactValue}
                              unit={r.impactUnit === 'currency' ? 'ZAR' : (r.impactUnit ?? undefined)}
                              compact
                              size="sm"
                            />
                          </button>
                        ) : (
                          <Numeric
                            value={r.impactValue}
                            unit={r.impactUnit === 'currency' ? 'ZAR' : (r.impactUnit ?? undefined)}
                            compact
                            size="sm"
                          />
                        )}
                      </p>
                    </div>
                  </div>
                  {rec ? (
                    <button
                      type="button"
                      onClick={() => navigate(catalystDeployUrl(rec))}
                      className="shrink-0 px-4 py-2 rounded-md text-body-sm font-medium transition-colors text-[var(--text-on-accent)] hover:opacity-90 active:scale-[0.97]"
                      style={{ background: 'var(--neg)' }}
                      title={`Open ${rec.catalyst} → ${rec.subCatalyst}`}
                    >
                      Mitigate Risk
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onTrace?.(r.id)}
                      className="shrink-0 px-4 py-2 rounded-md text-body-sm font-medium transition-colors border hover:opacity-90 active:scale-[0.97]"
                      style={{
                        borderColor: 'rgb(var(--neg-rgb) / 0.50)',
                        color: 'var(--neg)',
                        background: 'transparent',
                      }}
                    >
                      Review Analysis
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
