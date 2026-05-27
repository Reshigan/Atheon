import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/status-pill';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/state';
import { Wallet, RefreshCw, TrendingUp, TrendingDown, Minus, FileSearch, Receipt, ShieldCheck, FileText, Download, KeyRound, Loader2 } from 'lucide-react';
import { api, ApiError, isStepUpRequired } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';

type LedgerResp = Awaited<ReturnType<typeof api.catalysts.valueLedger>>;
type LedgerCatalyst = LedgerResp['catalysts'][number];
type LedgerLineItem = LedgerResp['lineItems'][number];
type LedgerBillingPeriod = LedgerResp['billingPeriods'][number];

type PeriodKey = 'last_30d' | 'last_90d' | 'last_180d' | 'ytd';

const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'last_30d', label: '30 days' },
  { key: 'last_90d', label: '90 days' },
  { key: 'last_180d', label: '180 days' },
  { key: 'ytd', label: 'YTD' },
];

function fmtZar(n: number): string {
  if (!Number.isFinite(n)) return 'R 0';
  if (Math.abs(n) >= 1_000_000) return `R ${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `R ${(n / 1_000).toFixed(1)}k`;
  return `R ${Math.round(n).toLocaleString('en-ZA')}`;
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '0%';
  return `${n.toFixed(1)}%`;
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function confidencePill(confidence: number): React.ReactNode {
  if (confidence >= 0.85) return <StatusPill status="completed" label={`${(confidence * 100).toFixed(0)}%`} />;
  if (confidence >= 0.65) return <StatusPill status="amber" label={`${(confidence * 100).toFixed(0)}%`} />;
  return <StatusPill status="failed" label={`${(confidence * 100).toFixed(0)}%`} />;
}

function trendIcon(pct: number): React.ReactNode {
  if (pct > 0.5) return <TrendingUp size={12} className="text-emerald-500" />;
  if (pct < -0.5) return <TrendingDown size={12} className="text-red-500" />;
  return <Minus size={12} className="t-muted" />;
}

type PackTarget = { kind: 'period'; id: string } | { kind: 'line-item'; id: string };
type PackToast = { hash: string; sizeBytes: number; sourceLabel: string } | null;

export function ValueLedgerPanel() {
  const companyId = useAppStore((s) => s.selectedCompanyId);
  const [data, setData] = useState<LedgerResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodKey>('last_90d');
  const [packBusy, setPackBusy] = useState<string | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [packToast, setPackToast] = useState<PackToast>(null);
  const [stepUp, setStepUp] = useState<PackTarget | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const mfaInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.catalysts.valueLedger(period, companyId || undefined);
      setData(resp);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load value ledger');
    } finally {
      setLoading(false);
    }
  }, [companyId, period]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (stepUp && mfaInputRef.current) mfaInputRef.current.focus();
  }, [stepUp]);

  useEffect(() => {
    if (!packToast) return;
    const t = setTimeout(() => setPackToast(null), 6000);
    return () => clearTimeout(t);
  }, [packToast]);

  const triggerDownload = useCallback((packId: string, kindLabel: string, sourceId: string) => {
    const url = api.catalysts.auditPackDownloadUrl(packId);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atheon-audit-pack-${kindLabel}-${sourceId}-${packId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const runPack = useCallback(async (target: PackTarget, code?: string): Promise<void> => {
    setPackBusy(target.id);
    setPackError(null);
    setMfaError(null);
    try {
      const record = target.kind === 'period'
        ? await api.catalysts.generatePeriodAuditPack(target.id, code)
        : await api.catalysts.generateLineItemAuditPack(target.id, code);
      setStepUp(null);
      setMfaCode('');
      triggerDownload(record.packId, target.kind === 'period' ? 'billable-period' : 'billable-line-item', record.sourceId);
      setPackToast({
        hash: record.hash,
        sizeBytes: record.sizeBytes,
        sourceLabel: target.kind === 'period' ? 'billing period' : 'line item',
      });
    } catch (e) {
      if (isStepUpRequired(e)) {
        setStepUp(target);
      } else if (e instanceof ApiError && e.status === 401 && code) {
        setMfaError('Invalid TOTP code. Try again.');
      } else {
        setPackError(e instanceof ApiError ? e.message : 'Audit pack generation failed');
      }
    } finally {
      setPackBusy(null);
    }
  }, [triggerDownload]);

  const onConfirmStepUp = useCallback(async () => {
    if (!stepUp || mfaCode.length !== 6) return;
    await runPack(stepUp, mfaCode);
  }, [stepUp, mfaCode, runPack]);

  const onCancelStepUp = useCallback(() => {
    setStepUp(null);
    setMfaCode('');
    setMfaError(null);
  }, []);

  const sortedCatalysts = useMemo(() => {
    if (!data) return [] as LedgerCatalyst[];
    return [...data.catalysts].sort((a, b) => b.realizedSavingsZar - a.realizedSavingsZar);
  }, [data]);

  const recentLineItems = useMemo(() => {
    if (!data) return [] as LedgerLineItem[];
    return [...data.lineItems]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 12);
  }, [data]);

  if (loading) return <LoadingState variant="cards" count={4} />;
  if (error) return <Card><ErrorState error={error} onRetry={load} /></Card>;
  if (!data || data.summary.totalRuns === 0) {
    return (
      <Card>
        <div className="flex items-center gap-1.5 mb-3">
          <Wallet size={14} className="text-accent" />
          <h3 className="text-sm font-semibold t-primary">Value Ledger</h3>
        </div>
        <EmptyState
          title="No catalyst value recorded yet"
          description="Once catalysts execute, realized savings, billable line items and Atheon revenue share will surface here."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Period + refresh controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs t-muted font-medium mr-1">Period:</span>
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setPeriod(opt.key)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-[background-color,color] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] ${period === opt.key ? 'bg-accent text-white' : 'bg-[var(--bg-secondary)] t-muted hover:t-primary'}`}
            >{opt.label}</button>
          ))}
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-[background-color,color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile
          label="Realized savings"
          value={fmtZar(data.summary.totalRealizedSavingsZar)}
          icon={<Wallet size={14} className="text-emerald-500" />}
          accent="#10b981"
          big
        />
        <SummaryTile
          label="Atheon revenue"
          value={fmtZar(data.summary.atheonRevenueZar)}
          sub={`${data.summary.atheonSharePct.toFixed(0)}% share`}
          icon={<Receipt size={14} className="text-accent" />}
        />
        <SummaryTile
          label="Catalyst runs"
          value={data.summary.totalRuns.toLocaleString('en-ZA')}
          sub={`${data.summary.catalystsCount} sub-catalysts`}
          icon={<ShieldCheck size={14} className="text-accent" />}
        />
        <SummaryTile
          label="Avg ROI"
          value={fmtPct(data.summary.avgRoiPct)}
          icon={trendIcon(data.summary.avgRoiPct)}
        />
      </div>

      {/* Per-catalyst table */}
      <Card>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-1.5">
            <Wallet size={14} className="text-accent" />
            <h3 className="text-sm font-semibold t-primary">Realized savings by catalyst</h3>
          </div>
          <span className="text-caption t-muted">{sortedCatalysts.length} catalysts · sorted by realized R</span>
        </div>

        {sortedCatalysts.length === 0 ? (
          <EmptyState title="No catalyst aggregates" description="No effectiveness records in the selected period." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-caption t-muted uppercase tracking-wider">
                  <th className="py-2 pr-3 font-medium">Catalyst</th>
                  <th className="py-2 pr-3 font-medium">Domain</th>
                  <th className="py-2 pr-3 font-medium text-right">Runs</th>
                  <th className="py-2 pr-3 font-medium text-right">Value processed</th>
                  <th className="py-2 pr-3 font-medium text-right">Realized savings</th>
                  <th className="py-2 pr-3 font-medium text-right">Success</th>
                  <th className="py-2 pr-3 font-medium text-right">ROI</th>
                  <th className="py-2 pr-3 font-medium text-right">Trend</th>
                </tr>
              </thead>
              <tbody>
                {sortedCatalysts.map((c) => (
                  <tr
                    key={`${c.clusterId}::${c.subCatalystName}`}
                    className="border-t border-[var(--border-card)] hover:bg-[var(--bg-secondary)] transition-[background-color] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
                  >
                    <td className="py-2.5 pr-3">
                      <div className="font-medium t-primary">{c.subCatalystName}</div>
                      <div className="text-caption t-muted">{c.clusterName}</div>
                    </td>
                    <td className="py-2.5 pr-3 t-secondary capitalize">{c.domain || '—'}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-mono t-secondary">{c.runsCount.toLocaleString('en-ZA')}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-mono t-secondary">{fmtZar(c.valueProcessedZar)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-mono font-semibold" style={{ color: '#10b981' }}>{fmtZar(c.realizedSavingsZar)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-mono t-secondary">{fmtPct(c.successRatePct)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-mono t-secondary">{fmtPct(c.roiEstimatePct)}</td>
                    <td className="py-2.5 pr-3 text-right">
                      <span className="inline-flex items-center gap-1 tabular-nums font-mono text-caption">
                        {trendIcon(c.improvementTrendPct)}
                        <span className={c.improvementTrendPct > 0.5 ? 'text-emerald-500' : c.improvementTrendPct < -0.5 ? 'text-red-500' : 't-muted'}>
                          {c.improvementTrendPct === 0 ? '0' : `${c.improvementTrendPct > 0 ? '+' : ''}${c.improvementTrendPct.toFixed(1)}%`}
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Recent line items + billing periods */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-1.5">
              <FileSearch size={14} className="text-accent" />
              <h3 className="text-sm font-semibold t-primary">Recent billable line items</h3>
            </div>
            <span className="text-caption t-muted">trace via rcaId</span>
          </div>
          {recentLineItems.length === 0 ? (
            <EmptyState title="No line items" description="Catalyst-attributed savings will appear here once finalised." />
          ) : (
            <ul className="space-y-2">
              {recentLineItems.map((li) => (
                <LineItemRow
                  key={li.id}
                  item={li}
                  onAuditPack={() => runPack({ kind: 'line-item', id: li.id })}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-1.5">
              <Receipt size={14} className="text-accent" />
              <h3 className="text-sm font-semibold t-primary">Billing periods</h3>
            </div>
            <span className="text-caption t-muted">{data.billingPeriods.length} period{data.billingPeriods.length === 1 ? '' : 's'}</span>
          </div>
          {data.billingPeriods.length === 0 ? (
            <EmptyState title="No billing periods" description="Periods are finalised at month-end and will surface here." />
          ) : (
            <ul className="space-y-2">
              {data.billingPeriods.map((bp) => (
                <BillingPeriodRow
                  key={bp.id}
                  period={bp}
                  onAuditPack={() => runPack({ kind: 'period', id: bp.id })}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Audit-pack error banner */}
      {packError && (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-red-500">{packError}</p>
            <button onClick={() => setPackError(null)} className="text-caption t-muted hover:t-primary">Dismiss</button>
          </div>
        </Card>
      )}

      {/* Pack-ready toast */}
      {packToast && (
        <div className="fixed bottom-6 right-6 z-40 w-[min(92vw,420px)] rounded-2xl border border-emerald-500/30 bg-[var(--bg-card-solid)] p-4 shadow-2xl animate-fadeIn">
          <div className="flex items-start gap-2.5">
            <Download size={18} className="text-emerald-500 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold t-primary">Audit pack signed &amp; downloaded</p>
              <p className="text-caption t-muted mt-0.5">
                {packToast.sourceLabel} · {(packToast.sizeBytes / 1024).toFixed(1)} KB · SHA-256
              </p>
              <p className="text-[10px] font-mono t-muted mt-1 break-all">{packToast.hash}</p>
            </div>
            <button onClick={() => setPackToast(null)} className="text-caption t-muted hover:t-primary">×</button>
          </div>
        </div>
      )}

      {/* Step-up MFA modal */}
      {stepUp && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-pack-stepup-title"
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
              <h3 id="audit-pack-stepup-title" className="text-base font-semibold t-primary">Re-confirm with TOTP</h3>
            </div>
            <p className="text-caption t-muted mb-3">
              Generating a signed audit pack is a billing-grade action. Enter the current 6-digit code from your authenticator.
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
                disabled={mfaCode.length !== 6 || packBusy !== null}
                onClick={onConfirmStepUp}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent/90 transition-[background-color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:opacity-50"
              >
                {packBusy ? <Loader2 size={12} className="animate-spin" /> : null}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LineItemRow({ item, onAuditPack }: { item: LedgerLineItem; onAuditPack: () => void }) {
  return (
    <li className="flex items-start justify-between gap-3 p-2.5 rounded-md border border-[var(--border-card)] bg-[var(--bg-card-solid)] hover:bg-[var(--bg-secondary)] transition-[background-color] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium t-primary truncate">{item.metricName}</div>
        <div className="text-caption t-muted mt-0.5 flex items-center gap-2 flex-wrap">
          <span className="font-mono">rca:{item.rcaId.slice(0, 8)}</span>
          <span>·</span>
          <span>{fmtDate(item.createdAt)}</span>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-sm font-semibold tabular-nums font-mono" style={{ color: '#10b981' }}>{fmtZar(item.attributedSavingsZar)}</div>
        <div className="mt-1 flex justify-end">{confidencePill(item.confidence)}</div>
        <button
          onClick={onAuditPack}
          className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-[background-color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
          title="Generate signed audit pack"
        >
          <FileText size={10} /> Audit pack
        </button>
      </div>
    </li>
  );
}

function BillingPeriodRow({ period, onAuditPack }: { period: LedgerBillingPeriod; onAuditPack: () => void }) {
  const statusVariant: 'completed' | 'amber' | 'failed' | 'pending' =
    period.status === 'finalized' || period.status === 'invoiced' ? 'completed'
    : period.status === 'pending' ? 'amber'
    : period.status === 'rejected' || period.status === 'cancelled' ? 'failed'
    : 'pending';

  return (
    <li className="flex items-start justify-between gap-3 p-2.5 rounded-md border border-[var(--border-card)] bg-[var(--bg-card-solid)]">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium t-primary">{fmtDate(period.periodStart)} → {fmtDate(period.periodEnd)}</div>
        <div className="text-caption t-muted mt-0.5">Atheon share {period.atheonSharePct.toFixed(0)}% · generated {fmtDate(period.generatedAt)}</div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-sm font-semibold tabular-nums font-mono t-primary">{fmtZar(period.atheonRevenueZar)}</div>
        <div className="text-caption t-muted tabular-nums font-mono">of {fmtZar(period.totalRealisedSavingsZar)}</div>
        <div className="mt-1 flex justify-end"><StatusPill status={statusVariant} label={period.status} /></div>
        <button
          onClick={onAuditPack}
          className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-accent text-white hover:bg-accent/90 transition-[background-color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
          title="Generate signed audit pack for this billing period"
        >
          <FileText size={10} /> Audit pack
        </button>
      </div>
    </li>
  );
}

function SummaryTile({ label, value, sub, icon, accent, big = false }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; accent?: string; big?: boolean;
}) {
  return (
    <div
      className="p-3 rounded-lg border"
      style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)' }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-caption font-medium t-muted uppercase tracking-wider">{label}</span>
      </div>
      <div
        className={`font-bold t-primary tabular-nums font-mono ${big ? 'text-xl' : 'text-body-md'}`}
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      {sub && <div className="text-caption t-muted mt-0.5">{sub}</div>}
    </div>
  );
}
