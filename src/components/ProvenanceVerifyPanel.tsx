/**
 * ProvenanceVerifyPanel — surfaces the cryptographic AI decision ledger.
 *
 * Lives on the AuditPage. Three things on screen:
 *   1. Current Merkle root (so an auditor can attest at a point in time).
 *   2. "Verify chain" button that re-derives every hash + signature in
 *      seq order and reports the first mismatch (or "all good").
 *   3. Recent entries, color-coded by payload type.
 *
 * The panel makes the chain tangible — most analytic tools have audit
 * logs; Atheon's are cryptographically tamper-evident, and this UI is
 * where that property becomes visible to the buyer.
 */
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ShieldCheck, AlertTriangle, RefreshCw, Lock, Loader2,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import type { ProvenanceEntry, ProvenanceVerifyResult } from '@/lib/api';

const TYPE_BADGE: Record<string, { label: string; variant: 'info' | 'success' | 'warning' | 'danger' | 'outline' }> = {
  'catalyst_run.completed': { label: 'Run', variant: 'info' },
  'catalyst_run.exception': { label: 'Run Exc.', variant: 'warning' },
  'hitl.approval': { label: 'Approved', variant: 'success' },
  'hitl.rejection': { label: 'Rejected', variant: 'danger' },
  'assessment.completed': { label: 'Assessment', variant: 'info' },
  'simulation.created': { label: 'Sim Created', variant: 'outline' },
  'simulation.outcome_recorded': { label: 'Sim Outcome', variant: 'outline' },
  'license.provisioned': { label: 'License: New', variant: 'success' },
  'license.suspended': { label: 'License: Susp.', variant: 'danger' },
  'license.renewed': { label: 'License: Renewed', variant: 'success' },
  'config.pushed': { label: 'Config', variant: 'outline' },
};

export function ProvenanceVerifyPanel(): JSX.Element {
  const toast = useToast();
  const [root, setRoot] = useState<{ root: string | null; seq: number; created_at: string | null } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<ProvenanceVerifyResult | null>(null);
  const [entries, setEntries] = useState<ProvenanceEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);

  async function loadEntries() {
    setEntriesLoading(true);
    try {
      const [rootResult, listResult] = await Promise.all([
        api.provenance.root(),
        api.provenance.list({ limit: 25 }),
      ]);
      setRoot(rootResult);
      setEntries(listResult.entries);
    } catch (err) {
      console.error('Failed to load provenance:', err);
      toast.error('Failed to load provenance chain', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setEntriesLoading(false);
    }
  }

  // Load once on mount. loadEntries is a stable closure for this
  // component and a re-render-driven re-fetch would defeat the
  // refresh-button UX we have below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadEntries(); }, []);

  async function runVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const result = await api.provenance.verify();
      setVerifyResult(result);
      if (result.valid) {
        toast.success('Chain verified', `${result.total_entries} entries — all hashes + signatures valid`);
      } else {
        toast.error('Chain verification failed', `Tampering detected at seq ${result.first_invalid_seq}`);
      }
    } catch (err) {
      toast.error('Verification failed', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setVerifying(false);
    }
  }

  const isEmpty = !root || root.seq === 0;

  return (
    <Card className="p-5 space-y-4" data-testid="provenance-verify-panel">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-5 h-5 text-accent" />
            <h3 className="text-lg font-semibold t-primary">AI Decision Provenance</h3>
            <Badge variant="info" className="text-label">Cryptographic</Badge>
          </div>
          <p className="text-sm t-muted max-w-2xl">
            Every AI decision the platform makes is appended to a hash-linked, HMAC-signed chain.
            Tampering with any historical entry breaks the Merkle root for every subsequent entry —
            verification re-derives every hash + signature in sequence and reports the first mismatch.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={loadEntries} variant="ghost" size="sm" disabled={entriesLoading}>
            <RefreshCw size={14} className={entriesLoading ? 'animate-spin' : ''} />
          </Button>
          <Button onClick={runVerify} variant="primary" disabled={verifying || isEmpty} data-testid="verify-button">
            {verifying ? <Loader2 size={14} className="animate-spin mr-2" /> : <ShieldCheck size={14} className="mr-2" />}
            Verify chain
          </Button>
        </div>
      </div>

      {/* Current root */}
      {root && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div>
              <div className="text-label mb-1">Current Merkle root</div>
              <div className="font-mono text-xs t-primary break-all" data-testid="provenance-root">
                {root.root ? root.root.slice(0, 32) + '…' : <span className="t-muted">empty chain</span>}
              </div>
            </div>
            <div>
              <div className="text-label mb-1">Sequence</div>
              <div className="text-xl font-semibold t-primary">{root.seq.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-label mb-1">Last appended</div>
              <div className="text-sm t-primary">
                {root.created_at ? new Date(root.created_at).toLocaleString() : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Verification result */}
      {verifyResult && (
        <div
          className="rounded-xl p-4 flex items-start gap-3"
          style={{
            background: verifyResult.valid ? 'rgba(20, 184, 166, 0.1)' : 'rgba(220, 38, 38, 0.1)',
            border: `1px solid ${verifyResult.valid ? 'rgba(20, 184, 166, 0.3)' : 'rgba(220, 38, 38, 0.3)'}`,
          }}
        >
          {verifyResult.valid
            ? <ShieldCheck className="w-5 h-5 text-teal-500 flex-shrink-0 mt-[2px]" />
            : <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-[2px]" />}
          <div className="flex-1">
            <div className="font-medium t-primary mb-1">
              {verifyResult.valid
                ? `Chain verified · ${verifyResult.total_entries} entries`
                : `Tampering detected at seq ${verifyResult.first_invalid_seq} of ${verifyResult.total_entries}`}
            </div>
            <div className="text-sm t-secondary">{verifyResult.reason}</div>
          </div>
        </div>
      )}

      {/* Recent entries */}
      <div>
        <div className="text-label mb-2">
          Recent entries ({entries.length})
        </div>
        {entriesLoading ? (
          <div className="text-sm t-muted text-center py-4">
            <Loader2 size={14} className="inline animate-spin mr-2" /> Loading…
          </div>
        ) : entries.length === 0 ? (
          <div className="text-sm t-muted text-center py-4">
            No entries yet. The chain will populate as catalysts execute, HITL approvals are recorded,
            assessments complete, and licenses change state.
          </div>
        ) : (
          <div className="rounded-md border border-[var(--border-card)] overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-secondary)]">
                <tr>
                  <th className="text-left px-3 py-2 t-muted font-medium">Seq</th>
                  <th className="text-left px-3 py-2 t-muted font-medium">Type</th>
                  <th className="text-left px-3 py-2 t-muted font-medium">Hash</th>
                  <th className="text-left px-3 py-2 t-muted font-medium">Signed by</th>
                  <th className="text-left px-3 py-2 t-muted font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => {
                  const t = TYPE_BADGE[e.payload_type] || { label: e.payload_type, variant: 'outline' as const };
                  return (
                    <tr key={e.id} className="border-t border-[var(--border-card)]">
                      <td className="px-3 py-2 t-primary font-mono">{e.seq}</td>
                      <td className="px-3 py-2">
                        <Badge variant={t.variant} className="text-caption">{t.label}</Badge>
                      </td>
                      <td className="px-3 py-2 t-secondary font-mono">{e.payload_hash.slice(0, 12)}…</td>
                      <td className="px-3 py-2 t-secondary">{e.signed_by_user_id || <span className="t-muted">system</span>}</td>
                      <td className="px-3 py-2 t-muted whitespace-nowrap">
                        {new Date(e.created_at).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
