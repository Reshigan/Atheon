/**
 * CatalystSimulatorCard — predicted vs actual + calibration trend.
 *
 * Renders the world-first "predict before execute, calibrate per-tenant"
 * loop on a catalyst sub-catalyst. Lives on the cluster detail page or
 * the catalyst run detail. The "Simulate now" button kicks the predictor;
 * the historical scatter shows calibration converging over time.
 *
 * Three states:
 *   - Cold-start (n_priors = 0): show the prediction with a wide ±30%
 *     CI and a copy line explaining the fixed band.
 *   - Warming (1 ≤ n_priors < 5): show observations accumulating, still
 *     fixed CI band.
 *   - Calibrated (n_priors ≥ 5): show the predicted-vs-actual scatter
 *     plus the calibration factor + residual std.
 */
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, Sparkles, AlertCircle, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import type {
  CatalystSimulationResult,
  CatalystCalibrationStats,
  CatalystSimulationHistoryRow,
} from '@/lib/api';

interface Props {
  clusterId: string;
  subCatalystName: string;
  /** Optional initial calibration stats (saves a round-trip if the parent already loaded them). */
  initialStats?: CatalystCalibrationStats;
  initialHistory?: CatalystSimulationHistoryRow[];
}

const MIN_PRIORS_FOR_CI = 5;

function formatZAR(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  return `R ${Math.round(amount).toLocaleString('en-ZA')}`;
}

export function CatalystSimulatorCard({ clusterId, subCatalystName, initialStats, initialHistory }: Props): JSX.Element {
  const toast = useToast();
  const [latest, setLatest] = useState<CatalystSimulationResult | null>(null);
  const [stats, setStats] = useState<CatalystCalibrationStats | null>(initialStats ?? null);
  const [history, setHistory] = useState<CatalystSimulationHistoryRow[]>(initialHistory ?? []);
  const [loading, setLoading] = useState(false);

  const phase: 'cold' | 'warming' | 'calibrated' =
    !stats || stats.n_observations === 0 ? 'cold'
    : stats.n_observations < MIN_PRIORS_FOR_CI ? 'warming'
    : 'calibrated';

  const phaseLabel: Record<typeof phase, string> = {
    cold: 'Cold start',
    warming: `Warming (${stats?.n_observations}/${MIN_PRIORS_FOR_CI})`,
    calibrated: 'Calibrated',
  };

  const phaseVariant: Record<typeof phase, 'info' | 'warning' | 'success'> = {
    cold: 'info', warming: 'warning', calibrated: 'success',
  };

  async function runSimulation() {
    setLoading(true);
    try {
      const result = await api.catalysts.simulate(clusterId, subCatalystName);
      setLatest(result);
      // Refresh stats + history to pick up the new prediction row.
      const fresh = await api.catalysts.getCalibration(clusterId, subCatalystName);
      setStats(fresh.stats);
      setHistory(fresh.history);
    } catch (err) {
      const requestId = err instanceof ApiError ? err.requestId : null;
      toast.error('Simulation failed', {
        message: err instanceof Error ? err.message : 'Unknown error',
        requestId,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-5 space-y-4" data-testid="catalyst-simulator-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-accent" />
            <h3 className="text-lg font-semibold t-primary">Catalyst Simulator</h3>
            <Badge variant={phaseVariant[phase]} className="text-label">
              {phaseLabel[phase]}
            </Badge>
          </div>
          <p className="text-sm t-muted max-w-xl">
            Predict the value-at-risk this catalyst would recover before running it. Each completed run
            updates the per-tenant calibration so the next prediction is more accurate.
          </p>
        </div>
        <Button onClick={runSimulation} disabled={loading} variant="primary" data-testid="simulate-button">
          {loading ? <Loader2 size={14} className="animate-spin mr-2" /> : <TrendingUp size={14} className="mr-2" />}
          Simulate now
        </Button>
      </div>

      {/* Latest prediction */}
      {latest && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}>
          <div className="text-label mb-2">Predicted recovery</div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-3xl font-semibold text-accent" data-testid="predicted-value">
              {formatZAR(latest.predicted_value_zar)}
            </span>
            <span className="text-xs t-muted">
              {latest.confidence_pct}% CI: {formatZAR(latest.lower_bound_zar)} – {formatZAR(latest.upper_bound_zar)}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs">
            <div>
              <div className="t-muted">Calibration factor</div>
              <div className="t-primary font-medium">×{latest.calibration_factor.toFixed(2)}</div>
            </div>
            <div>
              <div className="t-muted">Prior observations</div>
              <div className="t-primary font-medium">{latest.n_priors}</div>
            </div>
            <div>
              <div className="t-muted">Contributing findings</div>
              <div className="t-primary font-medium">{latest.methodology.contributing_finding_count}</div>
            </div>
            <div>
              <div className="t-muted">Raw prediction</div>
              <div className="t-primary font-medium">{formatZAR(latest.methodology.raw_prediction_zar)}</div>
            </div>
          </div>
          {latest.methodology.notes && (
            <div className="mt-3 text-xs t-muted flex items-start gap-2">
              <AlertCircle size={12} className="mt-[2px] flex-shrink-0" />
              <span>{latest.methodology.notes}</span>
            </div>
          )}
        </div>
      )}

      {/* Calibration history scatter */}
      {history.length > 0 && (
        <div>
          <div className="text-label mb-2">
            Predicted vs actual ({history.length} of last {history.length})
          </div>
          <div className="rounded-md border border-[var(--border-card)] overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-secondary)]">
                <tr>
                  <th className="text-left px-3 py-2 t-muted font-medium">When</th>
                  <th className="text-right px-3 py-2 t-muted font-medium">Predicted</th>
                  <th className="text-right px-3 py-2 t-muted font-medium">Actual</th>
                  <th className="text-right px-3 py-2 t-muted font-medium">Residual</th>
                  <th className="text-right px-3 py-2 t-muted font-medium">Factor used</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 10).map(h => (
                  <tr key={h.id} className="border-t border-[var(--border-card)]">
                    <td className="px-3 py-2 t-muted whitespace-nowrap">
                      {new Date(h.simulated_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-right t-primary whitespace-nowrap">
                      {formatZAR(h.predicted_value_zar)}
                    </td>
                    <td className="px-3 py-2 text-right t-primary whitespace-nowrap">
                      {h.actual_value_zar !== null ? formatZAR(h.actual_value_zar) : <span className="t-muted">pending</span>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {h.residual !== null ? (
                        <span className={h.residual >= 0.85 && h.residual <= 1.15 ? 'text-teal-500' : 'text-amber-500'}>
                          ×{h.residual.toFixed(2)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right t-secondary whitespace-nowrap">
                      ×{h.calibration_factor.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Calibration stats */}
      {stats && stats.n_observations > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-[var(--border-card)] text-xs">
          <div>
            <div className="t-muted">Observations</div>
            <div className="t-primary font-medium text-base">{stats.n_observations}</div>
          </div>
          <div>
            <div className="t-muted">Calibration factor</div>
            <div className="t-primary font-medium text-base">×{stats.calibration_factor.toFixed(3)}</div>
          </div>
          <div>
            <div className="t-muted">Residual σ</div>
            <div className="t-primary font-medium text-base">{stats.std_residual.toFixed(3)}</div>
          </div>
          <div>
            <div className="t-muted">Mean abs. error</div>
            <div className="t-primary font-medium text-base">{formatZAR(stats.mae_zar)}</div>
          </div>
        </div>
      )}
    </Card>
  );
}
