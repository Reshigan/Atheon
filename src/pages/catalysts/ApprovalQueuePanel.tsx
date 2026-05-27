import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/status-pill';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/state';
import { ShieldCheck, CheckCircle2, XCircle, RefreshCw, KeyRound, ChevronDown, ChevronUp } from 'lucide-react';
import { api, ApiError, isStepUpRequired } from '@/lib/api';

type ApprovalsResp = Awaited<ReturnType<typeof api.catalysts.pendingApprovals>>;
type Approval = ApprovalsResp['approvals'][number];

type Pending = {
  approvalId: string;
  action: 'approve' | 'reject';
  reason?: string;
};

function confidencePill(confidence: number): React.ReactNode {
  if (confidence >= 0.85) return <StatusPill status="completed" label={`${(confidence * 100).toFixed(0)}% conf.`} />;
  if (confidence >= 0.65) return <StatusPill status="amber" label={`${(confidence * 100).toFixed(0)}% conf.`} />;
  return <StatusPill status="failed" label={`${(confidence * 100).toFixed(0)}% conf.`} />;
}

export function ApprovalQueuePanel() {
  const [data, setData] = useState<ApprovalsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState<Pending | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const mfaInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.catalysts.pendingApprovals();
      setData(resp);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load approval queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (stepUp && mfaInputRef.current) mfaInputRef.current.focus();
  }, [stepUp]);

  const handleAction = useCallback(async (approvalId: string, action: 'approve' | 'reject', reason?: string, code?: string) => {
    setBusyId(approvalId);
    setMfaError(null);
    try {
      if (action === 'approve') {
        await api.catalysts.approveAction(approvalId, 'ui', code);
      } else {
        await api.catalysts.rejectAction(approvalId, 'ui', reason || 'Rejected by reviewer', code);
      }
      setStepUp(null);
      setMfaCode('');
      await load();
    } catch (e) {
      if (isStepUpRequired(e)) {
        setStepUp({ approvalId, action, reason });
        setMfaError(null);
      } else if (e instanceof ApiError && e.status === 401 && code) {
        setMfaError('Invalid TOTP code. Try again.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Action failed');
      }
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const onConfirmStepUp = useCallback(async () => {
    if (!stepUp || mfaCode.length !== 6) return;
    await handleAction(stepUp.approvalId, stepUp.action, stepUp.reason, mfaCode);
  }, [stepUp, mfaCode, handleAction]);

  const onCancelStepUp = useCallback(() => {
    setStepUp(null);
    setMfaCode('');
    setMfaError(null);
  }, []);

  const grouped = useMemo(() => {
    if (!data) return [] as Approval[];
    return [...data.approvals].sort((a, b) => {
      if (a.confidence === b.confidence) return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return a.confidence - b.confidence;
    });
  }, [data]);

  if (loading) return <LoadingState variant="cards" count={3} />;
  if (error) return <Card><ErrorState error={error} onRetry={load} /></Card>;
  if (!data || data.approvals.length === 0) {
    return (
      <Card>
        <div className="flex items-center gap-1.5 mb-3">
          <ShieldCheck size={14} className="text-accent" />
          <h3 className="text-sm font-semibold t-primary">Approval queue</h3>
        </div>
        <EmptyState
          title="Nothing waiting on you"
          description="Catalyst actions below the confidence threshold or escalated by HITL rules will appear here for sign-off."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-accent" />
          <h3 className="text-sm font-semibold t-primary">Approval queue · {data.total}</h3>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-[background-color,color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="space-y-3">
        {grouped.map((ap) => {
          const isOpen = expanded === ap.id;
          const isBusy = busyId === ap.id;
          return (
            <Card key={ap.id}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold t-primary truncate">{ap.catalystName}</h4>
                    <span className="text-caption t-muted">·</span>
                    <span className="text-caption t-secondary capitalize">{ap.domain || ap.clusterName}</span>
                  </div>
                  <p className="text-caption t-muted mt-0.5">
                    Action: <span className="t-secondary font-mono">{ap.action}</span> · {new Date(ap.createdAt).toLocaleString('en-ZA', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusPill status={ap.status === 'escalated' ? 'high' : 'pending'} label={ap.status === 'escalated' ? 'Escalated' : 'Pending'} />
                  {confidencePill(ap.confidence)}
                </div>
              </div>

              {ap.reasoning && (
                <p className="text-caption t-secondary mb-2 italic border-l-2 border-accent/30 pl-2">{ap.reasoning}</p>
              )}

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <button
                  onClick={() => setExpanded(isOpen ? null : ap.id)}
                  className="flex items-center gap-1 text-caption t-muted hover:t-primary transition-[color] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
                >
                  {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  Evidence
                </button>
                <div className="flex items-center gap-1.5">
                  <button
                    disabled={isBusy}
                    onClick={() => handleAction(ap.id, 'reject')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-[background-color,color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:opacity-50"
                  >
                    <XCircle size={12} /> Reject
                  </button>
                  <button
                    disabled={isBusy}
                    onClick={() => handleAction(ap.id, 'approve')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-500/90 transition-[background-color,color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:opacity-50"
                  >
                    <CheckCircle2 size={12} /> Approve
                  </button>
                </div>
              </div>

              {isOpen && (
                <pre className="mt-3 p-2.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-card)] text-caption t-secondary overflow-x-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(ap.inputData, null, 2)}
                </pre>
              )}
            </Card>
          );
        })}
      </div>

      {stepUp && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="stepup-title"
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-sm animate-fadeIn"
          onClick={onCancelStepUp}
        >
          <div
            className="w-[min(92vw,420px)] rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card-solid)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: 'pop 200ms cubic-bezier(0.23,1,0.32,1)' }}
          >
            <div className="flex items-center gap-2 mb-2">
              <KeyRound size={16} className="text-accent" />
              <h3 id="stepup-title" className="text-base font-semibold t-primary">Re-confirm with TOTP</h3>
            </div>
            <p className="text-caption t-muted mb-3">
              {stepUp.action === 'approve' ? 'Approving' : 'Rejecting'} this catalyst action releases a write-back. Enter the current 6-digit code from your authenticator.
            </p>
            <input
              ref={mfaInputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter' && mfaCode.length === 6) onConfirmStepUp(); }}
              className="w-full h-11 px-3 rounded-lg border border-[var(--border-card)] bg-[var(--bg-card-solid)] t-primary font-mono text-lg tabular-nums tracking-[0.4em] text-center focus:outline-none focus:ring-2 focus:ring-accent/50"
              placeholder="000000"
              aria-label="One-time code"
            />
            {mfaError && <p className="text-caption text-red-500 mt-2">{mfaError}</p>}
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={onCancelStepUp}
                className="px-3 py-1.5 rounded-lg text-xs font-medium t-secondary hover:t-primary transition-[color] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
              >Cancel</button>
              <button
                disabled={mfaCode.length !== 6 || busyId !== null}
                onClick={onConfirmStepUp}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent/90 transition-[background-color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:opacity-50"
              >Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
