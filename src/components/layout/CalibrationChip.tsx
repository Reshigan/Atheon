/**
 * Calibration accuracy chip — header-resident moat indicator.
 *
 * Shows the tenant's tenant-wide calibration accuracy % from
 * /api/v1/catalysts/calibrations/summary as a small pill in the header.
 * Click navigates to /trust where the full breakdown lives.
 *
 * Hidden when no observations exist yet (cold-start tenant). Refreshes on
 * mount + every 5 min while the tab is visible.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Target } from "lucide-react";
import { api } from "@/lib/api";

const REFRESH_INTERVAL_MS = 5 * 60_000;

export function CalibrationChip(): JSX.Element | null {
  const navigate = useNavigate();
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [observations, setObservations] = useState(0);

  async function refresh() {
    try {
      const res = await api.catalysts.getCalibrationSummary();
      setAccuracy(res.accuracyPct);
      setObservations(res.simulationsWithOutcomes);
    } catch {
      // Quiet failure — calibration chip should never block the header.
    }
  }

  useEffect(() => {
    refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  if (accuracy === null || observations === 0) return null;

  // Tone follows the same thresholds as the Trust page card.
  const tone = accuracy >= 80
    ? 'text-accent border-[var(--border-card)] bg-[rgb(var(--accent-rgb)/0.1)]'
    : accuracy >= 60
      ? 'text-[var(--warning)] border-[var(--border-card)] bg-[rgb(var(--warning-rgb)/0.1)]'
      : 'text-neg border-[var(--border-card)] bg-[rgb(var(--neg-rgb)/0.1)]';

  return (
    <button
      onClick={() => navigate('/trust')}
      className={`hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md text-caption font-medium border transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] hover:scale-[1.02] ${tone}`}
      title={`Tenant-wide calibration: ${accuracy.toFixed(1)}% across ${observations} observed outcomes — click for the Trust page`}
      data-testid="calibration-chip"
    >
      <Target size={11} />
      <span>{accuracy.toFixed(1)}%</span>
      <span className="opacity-60">calibrated</span>
    </button>
  );
}
