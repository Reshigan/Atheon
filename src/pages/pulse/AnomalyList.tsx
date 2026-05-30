import { useCallback, useEffect, useRef, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Zap, KeyRound, Loader2, CheckCircle2, ExternalLink, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, isStepUpRequired, type AnomalyItem } from "@/lib/api";
import { recommendForAnomaly, catalystDeployUrl, type CatalystRecommendation } from "@/lib/catalyst-recommendation";

interface AnomalyListProps {
  anomalies: AnomalyItem[];
}

interface DispatchState {
  status: 'idle' | 'dispatching' | 'dispatched' | 'failed';
  actionId?: string;
  error?: string;
}

/**
 * Compact anomaly list for the Pulse Overview tab.
 *
 * B2 closed-loop: each row with a recognised catalyst recommendation shows
 * a "Dispatch" button that fires the catalyst in-place via
 * /api/catalysts/dispatch-from-pulse. The user no longer has to navigate
 * to /catalysts, find the cluster, and execute manually. After a successful
 * dispatch the row shows a "View in Approvals" link to follow through.
 *
 * Step-up MFA: writes require a fresh TOTP, so the first time the user
 * dispatches in a session we show a modal collecting their 6-digit code,
 * cache the success in KV server-side for 5 minutes, then proceed.
 */
export function AnomalyList({ anomalies }: AnomalyListProps) {
  const navigate = useNavigate();
  const [stateByIdx, setStateByIdx] = useState<Record<number, DispatchState>>({});
  const [mfaPrompt, setMfaPrompt] = useState<{ idx: number; rec: CatalystRecommendation; anomaly: AnomalyItem } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const mfaInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (mfaPrompt) {
      setMfaCode('');
      setMfaError(null);
      setMfaSubmitting(false);
      requestAnimationFrame(() => mfaInputRef.current?.focus());
    }
  }, [mfaPrompt]);

  const runDispatch = useCallback(async (idx: number, rec: CatalystRecommendation, anomaly: AnomalyItem, code?: string) => {
    setStateByIdx((s) => ({ ...s, [idx]: { status: 'dispatching' } }));
    try {
      const res = await api.catalysts.dispatchFromPulse(
        {
          catalystName: rec.catalyst,
          subCatalystName: rec.subCatalyst,
          anomalyMetric: anomaly.metric,
          severity: anomaly.severity,
          hypothesis: anomaly.hypothesis || undefined,
        },
        code,
      );
      setStateByIdx((s) => ({ ...s, [idx]: { status: 'dispatched', actionId: res.actionId } }));
      setMfaPrompt(null);
      return true;
    } catch (err) {
      if (isStepUpRequired(err) && !code) {
        setMfaPrompt({ idx, rec, anomaly });
        setStateByIdx((s) => ({ ...s, [idx]: { status: 'idle' } }));
        return false;
      }
      const message = err instanceof Error ? err.message : 'Dispatch failed';
      if (code) {
        setMfaError(message);
        setMfaSubmitting(false);
        return false;
      }
      setStateByIdx((s) => ({ ...s, [idx]: { status: 'failed', error: message } }));
      return false;
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
    await runDispatch(mfaPrompt.idx, mfaPrompt.rec, mfaPrompt.anomaly, trimmed);
  }, [mfaPrompt, mfaCode, runDispatch]);

  if (anomalies.length === 0) {
    return <p className="text-sm t-muted text-center py-6">No anomalies detected.</p>;
  }

  return (
    <>
      <div className="space-y-2">
        {anomalies.map((a, i) => {
          const rec = recommendForAnomaly(a.metric);
          const dispatch = stateByIdx[i] || { status: 'idle' };
          return (
            <div key={i} className="flex items-start gap-3 p-3 rounded-md bg-[var(--bg-card)] border border-[var(--border-card)]">
              <AlertTriangle size={16} className={a.severity === 'high' ? 'text-neg' : a.severity === 'medium' ? 'text-[var(--warning)]' : 't-muted'} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium t-primary">{a.metric}</p>
                <p className="text-xs t-secondary mt-0.5">{a.hypothesis || `Anomaly detected in ${a.metric}`}</p>
                {dispatch.status === 'dispatched' && dispatch.actionId && (
                  <p className="text-[11px] text-accent mt-1 flex items-center gap-1">
                    <CheckCircle2 size={11} /> Dispatched · action {dispatch.actionId.slice(0, 8)}
                    <button
                      type="button"
                      onClick={() => navigate('/catalysts?tab=approvals')}
                      className="ml-1 inline-flex items-center gap-0.5 underline decoration-dotted hover:opacity-70"
                      data-testid={`view-approvals-${i}`}
                    >
                      View in Approvals <ExternalLink size={10} />
                    </button>
                  </p>
                )}
                {dispatch.status === 'failed' && (
                  <p className="text-[11px] text-neg mt-1">Dispatch failed: {dispatch.error}</p>
                )}
              </div>
              <StatusPill status={a.severity} size="sm" />
              {rec && dispatch.status !== 'dispatched' && (
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => runDispatch(i, rec, a)}
                    disabled={dispatch.status === 'dispatching'}
                    title={`Dispatch ${rec.catalyst} → ${rec.subCatalyst} from this anomaly`}
                    data-testid={`dispatch-anomaly-${i}`}
                  >
                    {dispatch.status === 'dispatching' ? (
                      <>
                        <Loader2 size={12} className="mr-1 animate-spin" /> Dispatching
                      </>
                    ) : (
                      <>
                        <Zap size={12} className="mr-1" /> Dispatch
                      </>
                    )}
                  </Button>
                  <button
                    type="button"
                    onClick={() => navigate(catalystDeployUrl(rec))}
                    className="text-[11px] t-muted hover:t-primary underline decoration-dotted px-1 py-0.5 transition-colors"
                    title={`Open ${rec.catalyst} → ${rec.subCatalyst} in Catalysts`}
                    data-testid={`open-catalyst-${i}`}
                  >
                    Open
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {mfaPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dispatch-mfa-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMfaPrompt(null);
          }}
        >
          <div className="w-full max-w-md mx-4 rounded-md bg-[var(--bg-card)] border border-[var(--border-card)] p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <KeyRound size={16} style={{ color: 'var(--warning)' }} />
                <h3 id="dispatch-mfa-title" className="text-sm font-semibold t-primary">Step-up verification</h3>
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
              Dispatching <span className="t-primary font-medium">{mfaPrompt.rec.subCatalyst}</span> from
              "{mfaPrompt.anomaly.metric}". Enter your 6-digit authenticator code to confirm.
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
              className="w-full rounded-md bg-[var(--bg-base)] border border-[var(--border-card)] px-3 py-2 text-center text-lg tracking-[0.4em] font-mono t-primary focus:outline-none focus:ring-2 focus:ring-[var(--border-card)]"
              data-testid="dispatch-mfa-input"
            />
            {mfaError && <p className="text-xs text-neg mt-2" role="alert">{mfaError}</p>}
            <div className="flex items-center justify-end gap-2 mt-4">
              <Button variant="ghost" size="sm" onClick={() => setMfaPrompt(null)} disabled={mfaSubmitting}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={submitMfa}
                disabled={mfaSubmitting || mfaCode.length !== 6}
                data-testid="dispatch-mfa-submit"
              >
                {mfaSubmitting ? (
                  <>
                    <Loader2 size={12} className="mr-1 animate-spin" /> Verifying
                  </>
                ) : (
                  'Confirm dispatch'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
