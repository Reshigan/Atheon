/**
 * ActionEvidenceDrawer — full traceability chain for a single write-back action.
 *
 * Operator-facing drill-through that lifts the SAP-grade "review before approve"
 * loop into the Atheon Operator Queue. Every claimed Rand needs to trace back to
 * an ERP record + a field mapping + a confidence — this drawer makes that chain
 * visible at the moment of approval.
 *
 * The chain rendered top-to-bottom:
 *   1. Action header — id, status, value, catalyst, action_type
 *   2. Inference strength — confidence + sample_size + reasoning text
 *   3. Linked finding — title, severity, root cause, prescription
 *   4. Sample records — evidence.sample_records (ref, source/target, delta)
 *   5. Field mapping — what the action_type translates to in ERP terms,
 *      derived from input.payload
 *   6. Execution trace — per-step execution_logs
 *
 * The footer carries Approve / Reject CTAs so the operator can act without
 * leaving the chain of evidence. Both inherit the same fan-out behaviour as
 * the per-row buttons on the queue.
 */
import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { Numeric } from '@/components/ui/numeric';
import { LoadingState, ErrorState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import {
  AlertOctagon, Check, X as XIcon, FileText, Brain, Database, Workflow,
  Link2, Clock, ArrowRight, ListTree,
} from 'lucide-react';

type EvidenceResponse = Awaited<ReturnType<typeof api.erp.actionEvidence>>;

export interface ActionEvidenceDrawerProps {
  actionId: string | null;
  onClose: () => void;
  onActed: () => void;
}

// Severity → Stitch token. Used to tint the finding card border so high/critical
// findings pop without screaming.
const SEVERITY_TINT: Record<string, { border: string; bg: string; label: string }> = {
  critical: { border: 'rgba(248, 113, 113, 0.40)', bg: 'rgba(248, 113, 113, 0.08)', label: 'text-red-400' },
  high:     { border: 'rgba(249, 115, 22, 0.40)',  bg: 'rgba(249, 115, 22, 0.08)',  label: 'text-orange-400' },
  medium:   { border: 'rgba(251, 191, 36, 0.40)',  bg: 'rgba(251, 191, 36, 0.08)',  label: 'text-amber-400' },
  low:      { border: 'rgba(126, 179, 205, 0.40)', bg: 'rgba(126, 179, 205, 0.08)', label: 'text-sky-400' },
};

function pillKind(s: string): string {
  if (s === 'pending_approval' || s === 'pending') return 'pending';
  if (s === 'previewed') return 'in_progress';
  if (s === 'completed') return 'completed';
  if (s === 'failed') return 'failed';
  if (s === 'rejected') return 'rejected';
  return s;
}

function shortRef(id: string): string {
  return id.length > 10 ? id.slice(-10).toUpperCase() : id.toUpperCase();
}

// SAP-style confidence band: 0-1 → label + colour. We split the band the same
// way the inference engine does for its hard cutoff (<0.7 = "soft", forces
// human review per the platform's "inference must be strong" rule).
function confidenceBand(c: number): { label: string; tone: string } {
  if (c >= 0.9) return { label: 'High', tone: 'text-emerald-400' };
  if (c >= 0.7) return { label: 'Medium', tone: 'text-amber-400' };
  return { label: 'Low — review carefully', tone: 'text-red-400' };
}

export function ActionEvidenceDrawer({
  actionId,
  onClose,
  onActed,
}: ActionEvidenceDrawerProps): JSX.Element {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EvidenceResponse | null>(null);
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);

  useEffect(() => {
    if (!actionId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.erp.actionEvidence(actionId)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load evidence');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [actionId]);

  const action = data?.action ?? null;
  const finding = data?.finding ?? null;
  const logs = data?.execution_logs ?? [];

  const canAct = action && (action.status === 'pending_approval' || action.status === 'pending' || action.status === 'previewed');

  const handleApprove = async () => {
    if (!action || !action.connection_id) {
      toast.error('Cannot approve', 'Action has no connection_id.');
      return;
    }
    setActing('approve');
    try {
      await api.erp.approveAction(action.connection_id, action.id);
      toast.success(`Approved ${shortRef(action.id)}`);
      onActed();
      onClose();
    } catch (err) {
      toast.error('Approve failed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setActing(null);
    }
  };
  const handleReject = async () => {
    if (!action || !action.connection_id) {
      toast.error('Cannot reject', 'Action has no connection_id.');
      return;
    }
    const reason = window.prompt('Optional rejection reason:') ?? undefined;
    setActing('reject');
    try {
      await api.erp.rejectAction(action.connection_id, action.id, reason);
      toast.success(`Rejected ${shortRef(action.id)}`);
      onActed();
      onClose();
    } catch (err) {
      toast.error('Reject failed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setActing(null);
    }
  };

  // Field-mapping summary derived from input.payload. Real catalysts encode
  // their write-back as { table, key, field, old_value, new_value } — we
  // surface that as a single readable line so the operator sees what the
  // catalyst is about to mutate in the ERP.
  const renderFieldMapping = () => {
    if (!action?.input) return null;
    const payload = (action.input.payload ?? action.input) as Record<string, unknown>;
    const table = (payload.table ?? payload.entity) as string | undefined;
    const field = (payload.field ?? payload.attribute) as string | undefined;
    const oldVal = (payload.old_value ?? payload.from) as unknown;
    const newVal = (payload.new_value ?? payload.to ?? payload.value) as unknown;
    if (!table && !field && oldVal === undefined && newVal === undefined) return null;
    return (
      <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-card)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Database size={14} className="t-muted" />
          <span className="text-caption uppercase tracking-wider t-muted font-medium">Field mapping</span>
        </div>
        <div className="space-y-2 text-body-sm">
          {(table || field) && (
            <div className="flex items-center gap-2">
              <span className="t-muted">Target:</span>
              <code className="font-mono t-primary px-2 py-0.5 rounded" style={{ background: 'var(--bg-secondary)' }}>
                {[table, field].filter(Boolean).join('.')}
              </code>
            </div>
          )}
          {(oldVal !== undefined || newVal !== undefined) && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="t-muted">Change:</span>
              <code className="font-mono t-secondary px-2 py-0.5 rounded line-through opacity-60" style={{ background: 'var(--bg-secondary)' }}>
                {oldVal === undefined ? '∅' : String(oldVal)}
              </code>
              <ArrowRight size={12} className="t-muted" />
              <code className="font-mono t-primary px-2 py-0.5 rounded" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
                {newVal === undefined ? '∅' : String(newVal)}
              </code>
            </div>
          )}
        </div>
      </div>
    );
  };

  const sampleRecords = finding?.evidence?.sample_records ?? [];

  return (
    <Modal open={!!actionId} onClose={onClose} size="xl" labelledBy="action-evidence-title">
      <Modal.Header
        title={
          <span className="flex items-center gap-3">
            <Link2 size={16} className="t-muted" />
            <span>Action evidence</span>
            {action && (
              <span className="font-mono text-caption t-muted">{shortRef(action.id)}</span>
            )}
          </span>
        }
        description="Full chain of evidence for this write-back. Approve only when every link checks out."
        onClose={onClose}
        titleId="action-evidence-title"
      />
      <Modal.Body className="space-y-4">
        {loading && <LoadingState variant="cards" count={3} />}
        {error && !loading && <ErrorState error={error} onRetry={() => actionId && setData(null)} />}
        {!loading && !error && action && (
          <>
            {/* 1. Action header */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Status" value={<StatusPill status={pillKind(action.status)} size="sm" />} />
              <Stat label="Value" value={<Numeric value={action.value_zar} unit="ZAR" compact size="sm" />} />
              <Stat label="Catalyst" value={<span className="text-body-sm t-primary">{action.catalyst_name}</span>} />
              <Stat label="Type" value={<span className="text-body-sm t-secondary">{action.action_type.replace(/_/g, ' ')}</span>} />
            </div>

            {/* 2. Inference strength — confidence + sample size + reasoning */}
            <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-card)' }}>
              <div className="flex items-center gap-2 mb-3">
                <Brain size={14} className="t-muted" />
                <span className="text-caption uppercase tracking-wider t-muted font-medium">Inference</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                <div>
                  <div className="text-caption t-muted">Confidence</div>
                  {action.confidence == null ? (
                    <div className="text-body-sm t-muted italic">not reported</div>
                  ) : (
                    <>
                      <div className={`text-body-sm font-medium ${confidenceBand(action.confidence).tone}`}>
                        {Math.round(action.confidence * 100)}% · {confidenceBand(action.confidence).label}
                      </div>
                    </>
                  )}
                </div>
                <div>
                  <div className="text-caption t-muted">Sample size</div>
                  {action.sample_size == null ? (
                    <div className="text-body-sm t-muted italic">not reported</div>
                  ) : (
                    <div className="text-body-sm t-primary tabular-nums font-mono">
                      <Numeric value={action.sample_size} size="sm" /> records
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-caption t-muted">Dispatched</div>
                  <div className="text-body-sm t-primary">{new Date(action.created_at).toLocaleString()}</div>
                </div>
              </div>
              {action.reasoning ? (
                <div className="pt-3 border-t" style={{ borderColor: 'var(--border-card)' }}>
                  <div className="text-caption t-muted mb-1">Reasoning</div>
                  <p className="text-body-sm t-secondary whitespace-pre-line">{action.reasoning}</p>
                </div>
              ) : null}
            </div>

            {/* 3. Linked finding card (or info banner when none) */}
            {finding ? (
              (() => {
                const tint = SEVERITY_TINT[finding.severity] ?? SEVERITY_TINT.medium;
                return (
                  <div
                    className="rounded-xl border p-4"
                    style={{ borderColor: tint.border, background: tint.bg }}
                  >
                    <div className="flex items-start gap-2 mb-3">
                      <AlertOctagon size={14} className={`mt-0.5 ${tint.label}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-caption uppercase tracking-wider font-medium ${tint.label}`}>
                            {finding.severity}
                          </span>
                          <span className="text-caption t-muted">·</span>
                          <span className="text-caption t-muted">{finding.category.replace(/_/g, ' ')}</span>
                          <span className="text-caption t-muted">·</span>
                          <span className="text-caption t-muted">{finding.domain}</span>
                        </div>
                        <h4 className="text-body-sm font-semibold t-primary mt-1">{finding.title}</h4>
                        <p className="text-body-sm t-secondary mt-1">{finding.description}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t" style={{ borderColor: 'var(--border-card)' }}>
                      <SmallStat label="Financial impact" value={<Numeric value={finding.financial_impact} unit="ZAR" compact size="sm" />} />
                      <SmallStat label="Affected" value={<><Numeric value={finding.affected_records} size="sm" /> records</>} />
                      <SmallStat label="Immediate" value={<Numeric value={finding.immediate_value} unit="ZAR" compact size="sm" />} />
                      <SmallStat label="Monthly" value={<Numeric value={finding.ongoing_monthly_value} unit="ZAR" compact size="sm" />} />
                    </div>

                    {(finding.root_cause || finding.prescription) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border-card)' }}>
                        {finding.root_cause && (
                          <div>
                            <div className="text-caption uppercase tracking-wider t-muted mb-1">Root cause</div>
                            <p className="text-body-sm t-secondary">{finding.root_cause}</p>
                          </div>
                        )}
                        {finding.prescription && (
                          <div>
                            <div className="text-caption uppercase tracking-wider t-muted mb-1">Prescription</div>
                            <p className="text-body-sm t-secondary">{finding.prescription}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              <div className="rounded-xl border border-dashed p-4 flex items-start gap-2" style={{ borderColor: 'var(--border-card)' }}>
                <FileText size={14} className="t-muted mt-0.5" />
                <div className="text-body-sm t-muted">
                  No linked assessment finding. This action was dispatched without a source finding — confidence + sample size from the catalyst output are the only inference signals.
                </div>
              </div>
            )}

            {/* 4. Sample records — the actual ERP rows that justify the action */}
            {sampleRecords.length > 0 && (
              <div className="rounded-xl border" style={{ borderColor: 'var(--border-card)' }}>
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border-card)' }}>
                  <div className="flex items-center gap-2">
                    <Database size={14} className="t-muted" />
                    <span className="text-caption uppercase tracking-wider t-muted font-medium">Source records</span>
                  </div>
                  <span className="text-caption t-muted">{sampleRecords.length} sample{sampleRecords.length === 1 ? '' : 's'}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-body-sm">
                    <thead className="text-caption uppercase tracking-wider t-muted">
                      <tr className="border-b" style={{ borderColor: 'var(--border-card)' }}>
                        <th className="text-left px-4 py-2 font-medium">Ref</th>
                        <th className="text-left px-4 py-2 font-medium">Source</th>
                        <th className="text-left px-4 py-2 font-medium">Target</th>
                        <th className="text-right px-4 py-2 font-medium">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sampleRecords.map((r, i) => (
                        <tr key={i} className="border-b last:border-0" style={{ borderColor: 'var(--border-card)' }}>
                          <td className="px-4 py-2 font-mono t-primary">{r.ref ?? '—'}</td>
                          <td className="px-4 py-2 t-secondary">{r.source_value ?? '—'}</td>
                          <td className="px-4 py-2 t-secondary">{r.target_value ?? '—'}</td>
                          <td className="px-4 py-2 text-right font-mono">
                            {r.difference !== undefined ? <Numeric value={r.difference} unit="ZAR" compact size="sm" /> : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(finding?.evidence?.pattern || finding?.evidence?.first_occurrence || finding?.evidence?.frequency) && (
                  <div className="px-4 py-2 border-t flex items-center gap-4 flex-wrap text-caption t-muted" style={{ borderColor: 'var(--border-card)' }}>
                    {finding?.evidence?.pattern && <span>Pattern: {finding.evidence.pattern}</span>}
                    {finding?.evidence?.first_occurrence && <span>First: {finding.evidence.first_occurrence}</span>}
                    {finding?.evidence?.frequency && <span>Freq: {finding.evidence.frequency}</span>}
                  </div>
                )}
              </div>
            )}

            {/* 5. Field-mapping summary */}
            {renderFieldMapping()}

            {/* 6. Execution trace — per-step logs from execution_logs */}
            {logs.length > 0 && (
              <div className="rounded-xl border" style={{ borderColor: 'var(--border-card)' }}>
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border-card)' }}>
                  <div className="flex items-center gap-2">
                    <Workflow size={14} className="t-muted" />
                    <span className="text-caption uppercase tracking-wider t-muted font-medium">Execution trace</span>
                  </div>
                  <span className="text-caption t-muted">{logs.length} step{logs.length === 1 ? '' : 's'}</span>
                </div>
                <ol className="divide-y" style={{ borderColor: 'var(--border-card)' }}>
                  {logs.map((log) => (
                    <li key={log.id} className="px-4 py-2 flex items-start gap-3" style={{ borderColor: 'var(--border-card)' }}>
                      <span className="text-caption font-mono t-muted w-6 text-right pt-0.5">{log.step_number}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-body-sm t-primary font-medium">{log.step_name}</span>
                          <StatusPill status={pillKind(log.status)} size="sm" />
                          {log.duration_ms != null && (
                            <span className="text-caption t-muted inline-flex items-center gap-1">
                              <Clock size={10} /> {log.duration_ms}ms
                            </span>
                          )}
                        </div>
                        {log.detail && <p className="text-caption t-muted mt-0.5 break-words">{log.detail}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* 7. Raw payload — collapsed by default, available for debug */}
            {(action.input || action.output) && (
              <details className="rounded-xl border p-3" style={{ borderColor: 'var(--border-card)' }}>
                <summary className="cursor-pointer flex items-center gap-2 text-caption uppercase tracking-wider t-muted font-medium">
                  <ListTree size={14} /> Raw payload
                </summary>
                {action.input && (
                  <div className="mt-3">
                    <div className="text-caption t-muted mb-1">Input</div>
                    <pre className="text-caption font-mono p-3 rounded overflow-x-auto" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                      {JSON.stringify(action.input, null, 2)}
                    </pre>
                  </div>
                )}
                {action.output && (
                  <div className="mt-3">
                    <div className="text-caption t-muted mb-1">Output</div>
                    <pre className="text-caption font-mono p-3 rounded overflow-x-auto" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                      {JSON.stringify(action.output, null, 2)}
                    </pre>
                  </div>
                )}
              </details>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        {canAct ? (
          <>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={!!acting}>
              Close
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleReject()}
              disabled={!!acting}
            >
              <XIcon size={12} /> Reject
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleApprove()}
              disabled={!!acting}
            >
              <Check size={12} /> Approve & dispatch
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}>
      <div className="text-caption uppercase tracking-wider t-muted mb-1">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-caption uppercase tracking-wider t-muted">{label}</div>
      <div className="text-body-sm t-primary tabular-nums font-mono mt-0.5">{value}</div>
    </div>
  );
}

export default ActionEvidenceDrawer;
