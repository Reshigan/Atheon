/**
 * AnomalyDetectionControls — trigger ML-based anomaly re-detection at a chosen
 * sensitivity (low | medium | high).
 *
 * Spec: FRONTEND_ENHANCEMENTS.md §2.2.2
 *  - Three buttons: Low / Medium / High
 *  - Loading spinner on the pressed button
 *  - Toast on success / error (handled by the parent — this component only
 *    emits the call and surfaces the loading state)
 */
import { Loader2, TrendingUp, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export type AnomalySensitivity = "low" | "medium" | "high";

interface AnomalyDetectionControlsProps {
  onDetect: (sensitivity: AnomalySensitivity) => void | Promise<void>;
  runningSensitivity: AnomalySensitivity | null;
  disabled?: boolean;
}

const OPTIONS: { value: AnomalySensitivity; label: string; hint: string }[] = [
  { value: "low", label: "Low", hint: "Z > 3.0 — only extreme outliers" },
  { value: "medium", label: "Medium", hint: "Z > 2.5 — balanced detection" },
  { value: "high", label: "High", hint: "Z > 2.0 — aggressive, more noise" },
];

export function AnomalyDetectionControls({
  onDetect,
  runningSensitivity,
  disabled = false,
}: AnomalyDetectionControlsProps) {
  const anyRunning = runningSensitivity !== null;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
      <div className="flex items-center gap-2">
        <TrendingUp size={14} className="text-accent flex-shrink-0" />
        <span className="text-sm font-medium t-primary">Run ML Detection</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {OPTIONS.map((opt) => {
          const isRunning = runningSensitivity === opt.value;
          return (
            <Button
              key={opt.value}
              variant={isRunning ? "primary" : "secondary"}
              size="sm"
              onClick={() => {
                if (disabled || anyRunning) return;
                void onDetect(opt.value);
              }}
              disabled={disabled || anyRunning}
              title={opt.hint}
              aria-label={`Detect anomalies at ${opt.label} sensitivity — ${opt.hint}`}
            >
              {isRunning ? (
                <>
                  <Loader2 size={12} className="animate-spin mr-1.5" />
                  {opt.label}…
                </>
              ) : (
                <>{opt.label} Sensitivity</>
              )}
            </Button>
          );
        })}
      </div>
      <div className="flex items-center gap-1 text-caption t-muted sm:ml-auto">
        <AlertCircle size={10} />
        <span>Requires ≥ 30 historical data points per metric</span>
      </div>
    </div>
  );
}
