import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isStepUpRequired, type ConfidenceThresholdRecord, type ConfidenceThresholdValues } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, KeyRound, Loader2, RotateCcw, Save, Trash2, X } from "lucide-react";

interface Draft extends ConfidenceThresholdValues {
  recordId?: string;
  clusterId: string | null;
  subCatalystName: string | null;
}

function recordToDraft(r: ConfidenceThresholdRecord): Draft {
  return {
    recordId: r.id,
    clusterId: r.clusterId,
    subCatalystName: r.subCatalystName,
    autoApproveMin: r.autoApproveMin,
    requireHumanBelow: r.requireHumanBelow,
    hardRejectBelow: r.hardRejectBelow,
    minSampleSize: r.minSampleSize,
    minModeShare: r.minModeShare,
  };
}

function defaultDraft(defaults: ConfidenceThresholdValues): Draft {
  return {
    clusterId: null,
    subCatalystName: null,
    ...defaults,
  };
}

function pct(n: number) {
  return `${(n * 100).toFixed(0)}%`;
}

function validate(d: Draft): string | null {
  if (d.autoApproveMin <= 0 || d.autoApproveMin > 1) return 'Auto-approve floor must be between 0% and 100%.';
  if (d.requireHumanBelow <= 0 || d.requireHumanBelow > 1) return 'Require-human floor must be between 0% and 100%.';
  if (d.hardRejectBelow < 0 || d.hardRejectBelow > 1) return 'Hard-reject floor must be between 0% and 100%.';
  if (d.hardRejectBelow >= d.requireHumanBelow) return 'Hard-reject floor must be lower than the require-human floor.';
  if (d.requireHumanBelow >= d.autoApproveMin) return 'Require-human floor must be lower than the auto-approve floor.';
  if (!Number.isInteger(d.minSampleSize) || d.minSampleSize < 1) return 'Minimum sample size must be a positive integer.';
  if (d.minModeShare <= 0 || d.minModeShare > 1) return 'Minimum mode share must be between 0% and 100%.';
  return null;
}

/**
 * Per-tenant confidence threshold tuning (roadmap B3).
 *
 * Exposes the inference-strength knobs as a single editable card. The
 * tenant default row is always present (auto-created if missing on
 * first save). Per-cluster / per-sub-catalyst overrides are loaded
 * read-only for now — full per-scope editing arrives in v3 once the
 * catalyst-status routing reads these values at runtime.
 */
export function ConfidenceThresholdsPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<ConfidenceThresholdValues | null>(null);
  const [records, setRecords] = useState<ConfidenceThresholdRecord[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [mfaPrompt, setMfaPrompt] = useState<null | 'save' | { recordId: string }>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const mfaInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.confidenceThresholds.list();
      setDefaults(res.defaults);
      setRecords(res.rows);
      const tenantDefault = res.rows.find((r) => r.clusterId === null && r.subCatalystName === null);
      setDraft(tenantDefault ? recordToDraft(tenantDefault) : defaultDraft(res.defaults));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load confidence thresholds.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (mfaPrompt) {
      setMfaCode('');
      setMfaError(null);
      setMfaSubmitting(false);
      requestAnimationFrame(() => mfaInputRef.current?.focus());
    }
  }, [mfaPrompt]);

  const overrides = useMemo(() => records.filter((r) => r.clusterId !== null || r.subCatalystName !== null), [records]);

  const setDraftField = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setDraftError(null);
  };

  const runSave = useCallback(async (code?: string) => {
    if (!draft) return;
    const err = validate(draft);
    if (err) {
      setDraftError(err);
      return;
    }
    setSaving(true);
    setDraftError(null);
    try {
      const res = await api.confidenceThresholds.upsert(
        {
          clusterId: draft.clusterId,
          subCatalystName: draft.subCatalystName,
          autoApproveMin: draft.autoApproveMin,
          requireHumanBelow: draft.requireHumanBelow,
          hardRejectBelow: draft.hardRejectBelow,
          minSampleSize: draft.minSampleSize,
          minModeShare: draft.minModeShare,
        },
        code,
      );
      setRecords((rs) => {
        const idx = rs.findIndex((r) => r.id === res.id);
        if (idx >= 0) {
          const copy = rs.slice();
          copy[idx] = res;
          return copy;
        }
        return [res, ...rs];
      });
      setDraft(recordToDraft(res));
      setMfaPrompt(null);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
    } catch (e) {
      if (isStepUpRequired(e) && !code) {
        setMfaPrompt('save');
        return;
      }
      const message = e instanceof Error ? e.message : 'Save failed.';
      if (code) {
        setMfaError(message);
        setMfaSubmitting(false);
      } else {
        setDraftError(message);
      }
    } finally {
      setSaving(false);
    }
  }, [draft]);

  const runRemove = useCallback(async (recordId: string, code?: string) => {
    try {
      await api.confidenceThresholds.remove(recordId, code);
      setRecords((rs) => rs.filter((r) => r.id !== recordId));
      setMfaPrompt(null);
    } catch (e) {
      if (isStepUpRequired(e) && !code) {
        setMfaPrompt({ recordId });
        return;
      }
      const message = e instanceof Error ? e.message : 'Delete failed.';
      if (code) {
        setMfaError(message);
        setMfaSubmitting(false);
      } else {
        setDraftError(message);
      }
    }
  }, []);

  const submitMfa = useCallback(async () => {
    if (!mfaPrompt) return;
    const trimmed = mfaCode.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setMfaError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setMfaError(null);
    setMfaSubmitting(true);
    if (mfaPrompt === 'save') {
      await runSave(trimmed);
    } else {
      await runRemove(mfaPrompt.recordId, trimmed);
    }
  }, [mfaPrompt, mfaCode, runSave, runRemove]);

  const resetToDefaults = () => {
    if (!defaults) return;
    setDraft((d) => (d ? { ...d, ...defaults } : null));
    setDraftError(null);
  };

  if (loading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-12 t-muted text-sm gap-2">
          <Loader2 className="animate-spin" size={14} /> Loading confidence thresholds…
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <div className="flex items-start gap-2 p-4 text-sm text-red-400">
          <AlertTriangle size={16} className="mt-0.5" />
          <div>
            <p className="font-medium">Couldn't load confidence thresholds.</p>
            <p className="t-secondary mt-1">{error}</p>
            <Button variant="ghost" size="sm" onClick={load} className="mt-2">Retry</Button>
          </div>
        </div>
      </Card>
    );
  }

  if (!draft || !defaults) return null;

  return (
    <div className="space-y-6">
      <Card>
        <header className="mb-4">
          <h3 className="text-base font-semibold t-primary flex items-center gap-2">
            <SliderIcon /> Tenant-default thresholds
          </h3>
          <p className="text-xs t-secondary mt-1 max-w-2xl">
            These knobs control how the inference engine routes catalyst actions. Atheon's principle:
            prefer false negatives — ask the customer rather than auto-applying a weak rule. Confidence
            below the hard-reject floor is dropped entirely; below the require-human floor is queued
            for review; at or above the auto-approve floor it lands directly in the value ledger.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <ThresholdSlider
            label="Auto-approve floor"
            help="Confidence ≥ this is recorded without human review."
            value={draft.autoApproveMin}
            onChange={(v) => setDraftField('autoApproveMin', v)}
            min={0.5}
            max={1}
            step={0.01}
            testId="threshold-auto-approve"
          />
          <ThresholdSlider
            label="Require-human floor"
            help="Confidence below this is queued for human review."
            value={draft.requireHumanBelow}
            onChange={(v) => setDraftField('requireHumanBelow', v)}
            min={0.2}
            max={0.95}
            step={0.01}
            testId="threshold-require-human"
          />
          <ThresholdSlider
            label="Hard-reject floor"
            help="Confidence below this is dropped as weak inference."
            value={draft.hardRejectBelow}
            onChange={(v) => setDraftField('hardRejectBelow', v)}
            min={0}
            max={0.6}
            step={0.01}
            testId="threshold-hard-reject"
          />
          <ThresholdSlider
            label="Minimum mode share"
            help="Modal value must dominate at least this share of the sample."
            value={draft.minModeShare}
            onChange={(v) => setDraftField('minModeShare', v)}
            min={0.4}
            max={1}
            step={0.01}
            testId="threshold-mode-share"
          />
          <div className="md:col-span-2">
            <label className="block text-xs font-medium t-secondary mb-1">
              Minimum sample size
              <span className="ml-2 t-muted">(supporting records before a rule can fire)</span>
            </label>
            <input
              type="number"
              min={1}
              step={1}
              value={draft.minSampleSize}
              onChange={(e) => setDraftField('minSampleSize', Math.max(1, parseInt(e.target.value || '1', 10)))}
              className="w-32 rounded-lg bg-[var(--bg-base)] border border-[var(--border-card)] px-3 py-2 text-sm t-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
              data-testid="threshold-sample-size"
            />
          </div>
        </div>

        {draftError && (
          <div className="mt-4 flex items-start gap-2 text-xs text-red-400">
            <AlertTriangle size={14} className="mt-0.5" />
            <span>{draftError}</span>
          </div>
        )}

        <footer className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-[var(--border-card)]">
          <button
            type="button"
            onClick={resetToDefaults}
            className="text-xs t-muted hover:t-primary underline decoration-dotted inline-flex items-center gap-1"
            title="Reset to platform defaults"
          >
            <RotateCcw size={12} /> Reset to platform defaults
          </button>
          <div className="flex items-center gap-2">
            {savedFlash && <span className="text-xs text-emerald-400">Saved.</span>}
            <Button
              variant="primary"
              size="sm"
              onClick={() => runSave()}
              disabled={saving}
              data-testid="threshold-save"
            >
              {saving ? (
                <>
                  <Loader2 size={12} className="mr-1 animate-spin" /> Saving
                </>
              ) : (
                <>
                  <Save size={12} className="mr-1" /> Save tenant default
                </>
              )}
            </Button>
          </div>
        </footer>
      </Card>

      <Card>
        <header className="mb-3">
          <h4 className="text-sm font-semibold t-primary">Cluster &amp; sub-catalyst overrides</h4>
          <p className="text-xs t-secondary mt-1">
            Per-scope overrides are read-only here for now — they're written by the catalyst engine
            during calibration runs. Use the Run Analytics tab to identify scopes that need tighter
            thresholds; full inline editing arrives once status routing reads these values at runtime.
          </p>
        </header>
        {overrides.length === 0 ? (
          <p className="text-xs t-muted py-3">No scope-level overrides. Tenant default applies to every catalyst.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="t-muted text-left">
                <th className="font-medium py-2">Scope</th>
                <th className="font-medium py-2">Auto-approve</th>
                <th className="font-medium py-2">Require human</th>
                <th className="font-medium py-2">Hard reject</th>
                <th className="font-medium py-2">Sample</th>
                <th className="font-medium py-2">Mode share</th>
                <th className="font-medium py-2"></th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((r) => (
                <tr key={r.id} className="border-t border-[var(--border-card)]">
                  <td className="py-2 t-primary">
                    {r.clusterId ?? '—'}
                    {r.subCatalystName ? <span className="t-muted"> / {r.subCatalystName}</span> : null}
                  </td>
                  <td className="py-2 t-primary">{pct(r.autoApproveMin)}</td>
                  <td className="py-2 t-primary">{pct(r.requireHumanBelow)}</td>
                  <td className="py-2 t-primary">{pct(r.hardRejectBelow)}</td>
                  <td className="py-2 t-primary">{r.minSampleSize}</td>
                  <td className="py-2 t-primary">{pct(r.minModeShare)}</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => runRemove(r.id)}
                      className="t-muted hover:text-red-400 inline-flex items-center gap-1"
                      title="Remove override (returns this scope to the tenant default)"
                      data-testid={`threshold-remove-${r.id}`}
                    >
                      <Trash2 size={12} /> Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {mfaPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="threshold-mfa-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMfaPrompt(null);
          }}
        >
          <div className="w-full max-w-md mx-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] p-5 shadow-2xl">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <KeyRound size={16} className="text-amber-400" />
                <h3 id="threshold-mfa-title" className="text-sm font-semibold t-primary">Step-up verification</h3>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setMfaPrompt(null)}
                className="t-muted hover:t-primary transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs t-secondary mb-3">
              Confidence thresholds decide what skips human review. Enter your 6-digit authenticator
              code to confirm.
            </p>
            <input
              ref={mfaInputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitMfa();
                if (e.key === 'Escape') setMfaPrompt(null);
              }}
              placeholder="000000"
              aria-label="Authenticator code"
              className="w-full rounded-lg bg-[var(--bg-base)] border border-[var(--border-card)] px-3 py-2 text-center text-lg tracking-[0.4em] font-mono t-primary focus:outline-none focus:ring-2 focus:ring-amber-400/40"
              data-testid="threshold-mfa-input"
            />
            {mfaError && <p className="text-xs text-red-400 mt-2" role="alert">{mfaError}</p>}
            <div className="flex items-center justify-end gap-2 mt-4">
              <Button variant="ghost" size="sm" onClick={() => setMfaPrompt(null)} disabled={mfaSubmitting}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={submitMfa}
                disabled={mfaSubmitting || mfaCode.length !== 6}
                data-testid="threshold-mfa-submit"
              >
                {mfaSubmitting ? (
                  <>
                    <Loader2 size={12} className="mr-1 animate-spin" /> Verifying
                  </>
                ) : (
                  'Confirm'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

interface ThresholdSliderProps {
  label: string;
  help: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  testId?: string;
}
function ThresholdSlider({ label, help, value, onChange, min, max, step, testId }: ThresholdSliderProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-medium t-secondary">{label}</label>
        <span className="text-xs font-mono t-primary tabular-nums">{pct(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full mt-1 accent-[var(--brand-mint)]"
        data-testid={testId}
        aria-label={label}
      />
      <p className="text-[11px] t-muted mt-0.5">{help}</p>
    </div>
  );
}

function SliderIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-accent">
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="10" cy="6" r="2" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="16" cy="12" r="2" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="8" cy="18" r="2" />
    </svg>
  );
}

