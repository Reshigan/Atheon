/**
 * Trust & Performance — buyer-facing aggregation of the three world-first
 * capabilities into one 60-second demo asset.
 *
 *   1. Closed-loop calibration   — predicted vs actual, accuracy %, MAE
 *   2. Cryptographic provenance  — Merkle root + verify button + chain length
 *   3. Federated peer patterns   — cross-tenant DP-noised benchmarks
 *
 * Each capability has its own dedicated UI elsewhere (CatalystSimulatorCard,
 * ProvenanceVerifyPanel, PeerInsightsBadge). This page is the consolidated
 * view a salesperson can demo without three navigations — moat surfaced in
 * one screen.
 */
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Target, Lock, Network, ShieldCheck, AlertTriangle, Loader2, RefreshCw,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import type { ProvenanceVerifyResult, FederatedPattern } from '@/lib/api';

type CalibrationSummary = Awaited<ReturnType<typeof api.catalysts.getCalibrationSummary>>;
type ProvenanceRoot = Awaited<ReturnType<typeof api.provenance.root>>;

function formatZAR(n: number): string {
  if (n >= 1_000_000) return `R${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `R${(n / 1_000).toFixed(1)}k`;
  return `R${Math.round(n).toLocaleString()}`;
}

export function TrustPerformancePage(): JSX.Element {
  const toast = useToast();
  const [calibration, setCalibration] = useState<CalibrationSummary | null>(null);
  const [root, setRoot] = useState<ProvenanceRoot | null>(null);
  const [verifyResult, setVerifyResult] = useState<ProvenanceVerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [patterns, setPatterns] = useState<FederatedPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [cal, prov, peerRes] = await Promise.all([
        api.catalysts.getCalibrationSummary(),
        api.provenance.root(),
        api.peerPatterns.list('general').catch(() => ({ industry_bucket: 'general', patterns: [], total: 0 })),
      ]);
      setCalibration(cal);
      setRoot(prov);
      setPatterns(peerRes.patterns);
    } catch (err) {
      console.error('Failed to load trust dashboard', err);
      toast.error('Failed to load Trust & Performance', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  }

  // Initial load — once-on-mount; the refresh button drives subsequent reloads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadAll(); }, []);

  async function refreshAll() {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }

  async function runVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const result = await api.provenance.verify();
      setVerifyResult(result);
      if (result.valid) {
        toast.success('Chain verified', `${result.total_entries} entries — every hash + signature valid`);
      } else {
        toast.error('Chain verification failed', `Tampering at seq ${result.first_invalid_seq}`);
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

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-3 t-muted">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading Trust & Performance…
      </div>
    );
  }

  const accuracyDisplay = calibration?.accuracyPct ?? 0;
  const accuracyTone = accuracyDisplay >= 80 ? 'success' : accuracyDisplay >= 60 ? 'warning' : 'info';
  const chainEmpty = !root || root.seq === 0;
  const peerActive = patterns.filter(p => (p.n_contributors || 0) >= 5).length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="trust-performance-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold t-primary mb-1">Trust &amp; Performance</h1>
          <p className="text-sm t-muted max-w-3xl">
            Three independent claims, three live verifications: predictions calibrated against
            real outcomes, AI decisions cryptographically chained and auditable, and
            cross-tenant benchmarks differentially-privatised before they ever leave the
            contributor.
          </p>
        </div>
        <Button onClick={refreshAll} variant="ghost" size="sm" disabled={refreshing}>
          <RefreshCw size={14} className={`mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── 1. Closed-loop calibration ── */}
        <Card className="p-5 space-y-3" data-testid="trust-calibration">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold t-primary">Calibration</h2>
            <Badge variant="info" className="text-label">Predicted vs Actual</Badge>
          </div>
          <div className="text-3xl font-semibold t-primary" data-testid="trust-accuracy">
            {accuracyDisplay.toFixed(1)}<span className="text-base t-muted">% accuracy</span>
          </div>
          <div className="text-xs t-muted">
            Mean residual deviation from 1.0 across {calibration?.simulationsWithOutcomes ?? 0} closed-loop observations.
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--border-card)]">
            <div>
              <div className="text-label">Predictions</div>
              <div className="text-xl font-semibold t-primary">{(calibration?.totalSimulations ?? 0).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-label">Outcomes recorded</div>
              <div className="text-xl font-semibold t-primary">{(calibration?.simulationsWithOutcomes ?? 0).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-label">Calibrated subs (n≥5)</div>
              <div className="text-xl font-semibold t-primary">{calibration?.calibratedSubCatalysts ?? 0}</div>
            </div>
            <div>
              <div className="text-label">Predicted value</div>
              <div className="text-xl font-semibold t-primary">{formatZAR(calibration?.totalPredictedValueZar ?? 0)}</div>
            </div>
          </div>
          <Badge variant={accuracyTone} className="text-caption">
            {accuracyDisplay >= 80 ? 'Calibrated' : accuracyDisplay >= 60 ? 'Warming up' : 'Cold-start'}
          </Badge>
        </Card>

        {/* ── 2. Cryptographic provenance ── */}
        <Card className="p-5 space-y-3" data-testid="trust-provenance">
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold t-primary">Provenance</h2>
            <Badge variant="info" className="text-label">Merkle + HMAC</Badge>
          </div>
          <div>
            <div className="text-label mb-1">Current root</div>
            <div className="font-mono text-xs t-primary break-all" data-testid="trust-root">
              {root?.root ? root.root.slice(0, 32) + '…' : <span className="t-muted">empty chain</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--border-card)]">
            <div>
              <div className="text-label">Sequence</div>
              <div className="text-xl font-semibold t-primary">{(root?.seq ?? 0).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-label">Last appended</div>
              <div className="text-sm t-primary">
                {root?.created_at ? new Date(root.created_at).toLocaleDateString() : '—'}
              </div>
            </div>
          </div>
          <Button
            onClick={runVerify}
            variant="primary"
            size="sm"
            disabled={verifying || chainEmpty}
            data-testid="trust-verify-button"
            className="w-full"
          >
            {verifying ? <Loader2 size={14} className="animate-spin mr-2" /> : <ShieldCheck size={14} className="mr-2" />}
            Verify chain
          </Button>
          {verifyResult && (
            <div
              className="rounded-md p-3 text-xs flex items-start gap-2"
              style={{
                background: verifyResult.valid ? 'rgba(20, 184, 166, 0.1)' : 'rgba(220, 38, 38, 0.1)',
                border: `1px solid ${verifyResult.valid ? 'rgba(20, 184, 166, 0.3)' : 'rgba(220, 38, 38, 0.3)'}`,
              }}
            >
              {verifyResult.valid
                ? <ShieldCheck className="w-4 h-4 text-teal-500 flex-shrink-0 mt-[1px]" />
                : <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-[1px]" />}
              <div className="t-secondary">
                {verifyResult.valid
                  ? `${verifyResult.total_entries} entries — all hashes + signatures valid`
                  : `Tampering at seq ${verifyResult.first_invalid_seq} of ${verifyResult.total_entries}`}
              </div>
            </div>
          )}
        </Card>

        {/* ── 3. Federated peer patterns ── */}
        <Card className="p-5 space-y-3" data-testid="trust-federation">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold t-primary">Peer benchmarks</h2>
            <Badge variant="info" className="text-label">DP ε = 1.0</Badge>
          </div>
          <div className="text-3xl font-semibold t-primary">
            {peerActive}<span className="text-base t-muted"> active patterns</span>
          </div>
          <div className="text-xs t-muted">
            Each pattern aggregates ≥5 contributing tenants in the same industry. Laplace noise
            added before publication; raw observations never leave the source tenant.
          </div>
          <div className="pt-2 border-t border-[var(--border-card)] space-y-2">
            {patterns.length === 0 ? (
              <div className="text-xs t-muted">
                No published patterns yet — federation activates after the first ε-private
                aggregate clears the k=5 contributor floor.
              </div>
            ) : (
              patterns.slice(0, 4).map(p => (
                <div key={p.finding_code} className="flex items-center justify-between text-xs">
                  <div className="t-primary truncate font-mono">{p.finding_code}</div>
                  <div className="t-muted ml-2 whitespace-nowrap">
                    {p.n_contributors}× · {Math.round(p.avg_resolved_days)}d · {Math.round(p.avg_recovery_pct)}%
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* ── Why this matters strip ── */}
      <Card className="p-5">
        <div className="text-label mb-3">Why this matters</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="font-medium t-primary mb-1">Predictions are checked</div>
            <div className="t-muted">
              Every catalyst run records what we predicted. Outcomes get fed back. The
              calibration factor self-corrects — if we're 12% high, the next prediction shifts
              12% lower automatically.
            </div>
          </div>
          <div>
            <div className="font-medium t-primary mb-1">Decisions are signed</div>
            <div className="t-muted">
              Every AI decision is appended to a hash-linked, HMAC-signed chain. Tampering with
              any historical entry breaks the Merkle root for every entry that follows. An
              auditor can re-derive the chain in seconds.
            </div>
          </div>
          <div>
            <div className="font-medium t-primary mb-1">Benchmarks are private</div>
            <div className="t-muted">
              Cross-tenant patterns publish only when ≥5 tenants contribute to the same
              industry bucket, and only with Laplace noise (ε = 1.0). Your raw operational data
              never leaves your tenant.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default TrustPerformancePage;
