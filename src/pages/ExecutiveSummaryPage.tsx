/**
 * §11.8 Executive Summary / Briefing
 *
 * Single-endpoint view — pulls the pre-aggregated executive summary from
 * GET /api/executive-summary (backend: workers/api/src/routes/executive-summary.ts)
 * in one round-trip. Load target: < 2s.
 *
 * Route: /executive-summary | Role: superadmin, support_admin, admin, executive
 *
 * The endpoint is DB-backed (NOT LLM-backed), so it does not throw 429 budget
 * errors. We still handle generic ApiError with a requestId-aware toast.
 *
 * Scheduling / distribution (per audit notes): NOT YET IMPLEMENTED. We surface
 * a hint card where those would live, so the gap is visible in the UI rather
 * than a silent 404.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useAppStore } from '@/stores/appStore';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/status-pill';
import { HeroHeader } from '@/components/ui/hero-header';
import { ScoreRing } from '@/components/ui/score-ring';
import { Sparkline } from '@/components/ui/sparkline';
import type { ExecutiveSummaryResponse } from '@/lib/api';
import {
  Crown, Loader2, AlertTriangle, AlertCircle, TrendingUp,
  TrendingDown, Minus, RefreshCw, ArrowRight, FileText, Calendar,
} from 'lucide-react';

const formatCurrency = (value: number): string => {
  if (!value) return '$0';
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
};

const targetStatusColor = (s: string): 'success' | 'warning' | 'danger' | 'info' => {
  const v = (s || '').toLowerCase();
  if (v === 'on_track' || v === 'achieved' || v === 'active') return 'success';
  if (v === 'at_risk' || v === 'warning') return 'warning';
  if (v === 'off_track' || v === 'missed') return 'danger';
  return 'info';
};

export function ExecutiveSummaryPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const user = useAppStore((s) => s.user);
  const [data, setData] = useState<ExecutiveSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await api.executiveSummary.get();
      setData(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load executive summary';
      setError(message);
      toast.error('Failed to load executive summary', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <AlertTriangle className="w-8 h-8 text-red-400" />
        <p className="text-sm t-primary">{error}</p>
        <button
          onClick={() => load()}
          className="px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-xs hover:bg-accent/20 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const improvement = data.journey?.improvement;
  const improvementIcon = improvement === null || improvement === undefined
    ? <Minus className="w-4 h-4 text-gray-400" />
    : improvement > 0
      ? <TrendingUp className="w-4 h-4 text-emerald-500" />
      : improvement < 0
        ? <TrendingDown className="w-4 h-4 text-red-500" />
        : <Minus className="w-4 h-4 text-gray-400" />;

  const dimensionEntries = Object.entries(data.dimensions || {});
  const trendValues = (data.trend || []).map(t => t.score);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <HeroHeader
          icon={Crown}
          title="Executive Summary"
          subtitle={`One-page briefing for ${user?.name?.split(' ')[0] || 'executives'} — aggregated from Apex, ROI, diagnostics & signals`}
          accent="sage"
        />
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] text-xs t-muted hover:t-primary transition-colors"
          aria-label="Refresh executive summary"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Top row: Atheon Score + Health Score + Journey */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5 flex flex-col items-center justify-center">
          <p className="text-label mb-2">Atheon Score</p>
          <ScoreRing score={data.atheonScore} size="lg" />
          <p className="text-caption t-muted mt-3">Composite across 5 pillars</p>
        </Card>
        <Card className="p-5 flex flex-col items-center justify-center">
          <p className="text-label mb-2">Health Score</p>
          <ScoreRing score={data.healthScore} size="lg" />
          {trendValues.length > 1 && (
            <div className="mt-3 w-full">
              <Sparkline data={trendValues} width={120} height={28} />
              <p className="text-caption t-muted text-center mt-1">Last {trendValues.length} points</p>
            </div>
          )}
        </Card>
        <Card className="p-5">
          <p className="text-label mb-2">Journey</p>
          {data.journey?.baselineHealthScore !== null ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold t-primary">
                  {improvement !== null && improvement !== undefined && improvement > 0 ? '+' : ''}{improvement ?? 0}
                </span>
                {improvementIcon}
              </div>
              <p className="text-xs t-muted mt-1">vs baseline of {data.journey.baselineHealthScore}</p>
              {data.journey.baselineDate && (
                <p className="text-caption t-muted mt-1">
                  Day zero: {new Date(data.journey.baselineDate).toLocaleDateString()}
                </p>
              )}
            </>
          ) : (
            <>
              <Minus className="w-6 h-6 text-gray-400 mb-2" />
              <p className="text-xs t-muted">No baseline captured yet — the &ldquo;day zero&rdquo; snapshot will appear once onboarding completes.</p>
            </>
          )}
        </Card>
      </div>

      {/* Financial + Diagnostic KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-label">Value Recovered</p>
          <p className="text-xl font-bold t-primary">{formatCurrency(data.roi?.recovered || 0)}</p>
          <p className="text-caption t-muted mt-1">
            {data.roi?.multiple ? `${data.roi.multiple.toFixed(1)}× ROI` : 'Awaiting first catalyst'}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-label">Active RCAs</p>
          <p className="text-xl font-bold t-primary">{data.diagnostics?.activeRcas ?? 0}</p>
          <p className="text-caption t-muted mt-1">Root-cause investigations</p>
        </Card>
        <Card className="p-4">
          <p className="text-label">Pending Rx</p>
          <p className="text-xl font-bold t-primary">{data.diagnostics?.pendingPrescriptions ?? 0}</p>
          <p className="text-caption t-muted mt-1">Prescriptions awaiting action</p>
        </Card>
        <Card className="p-4">
          <p className="text-label">Signals (7d)</p>
          <p className="text-xl font-bold t-primary">{data.signals?.newThisWeek ?? 0}</p>
          <p className="text-caption t-muted mt-1">External radar signals</p>
        </Card>
      </div>

      {/* Dimensions */}
      {dimensionEntries.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold t-primary">Health Dimensions</h3>
            <button onClick={() => navigate('/apex')} className="text-caption text-accent hover:underline inline-flex items-center gap-1">
              Full breakdown <ArrowRight size={11} />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {dimensionEntries.map(([key, dim]) => (
              <button
                key={key}
                onClick={() => navigate('/apex')}
                className="text-left p-3 rounded-lg border border-[var(--border-card)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-primary)] transition-colors"
              >
                <p className="text-label">{key.replace(/[-_]/g, ' ')}</p>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-lg font-bold t-primary">{dim.score}</span>
                  {dim.trend === 'improving' || dim.trend === 'up' ? <TrendingUp size={12} className="text-emerald-400" />
                    : dim.trend === 'declining' || dim.trend === 'down' ? <TrendingDown size={12} className="text-red-400" />
                    : <Minus size={12} className="text-gray-400" />}
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Top Risks */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold t-primary">Top Risks</h3>
          <button onClick={() => navigate('/apex')} className="text-caption text-accent hover:underline inline-flex items-center gap-1">
            All risks <ArrowRight size={11} />
          </button>
        </div>
        {data.topRisks && data.topRisks.length > 0 ? (
          <div className="space-y-2">
            {data.topRisks.map((risk, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--bg-secondary)]">
                <AlertCircle size={14} className={
                  risk.severity === 'critical' ? 'text-red-500' :
                  risk.severity === 'high' ? 'text-orange-500' : 'text-amber-500'
                } />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium t-primary truncate">{risk.title}</p>
                    <StatusPill status={risk.severity} size="sm" />
                  </div>
                  {!!risk.impactValue && (
                    <p className="text-caption t-muted mt-0.5">Est. impact {formatCurrency(risk.impactValue)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs t-muted py-2">No active high-priority risks. Nice work.</p>
        )}
      </Card>

      {/* Targets */}
      {data.targets && data.targets.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold t-primary mb-3">Active Targets</h3>
          <div className="space-y-2">
            {data.targets.map((t, i) => {
              const pct = t.targetValue ? Math.min(100, Math.round((t.currentValue / t.targetValue) * 100)) : 0;
              return (
                <div key={i} className="p-3 rounded-lg bg-[var(--bg-secondary)]">
                  <div className="flex items-center justify-between">
                    <p className="text-sm t-primary">{t.targetName}</p>
                    <Badge variant={targetStatusColor(t.status)} className="text-caption">{t.status}</Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-primary)] overflow-hidden">
                      <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-caption t-muted tabular-nums">{t.currentValue} / {t.targetValue}</span>
                  </div>
                  <p className="text-caption t-muted mt-0.5">{t.targetType}</p>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Scheduling / Distribution — not yet implemented, called out so the gap is visible */}
      <Card className="p-5 border-amber-500/20 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <Calendar size={16} className="text-amber-400 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium t-primary">Scheduled distribution — not yet implemented</p>
            <p className="text-xs t-muted mt-0.5">
              Emailing this summary on a schedule (weekly/monthly) and broadcasting to board members requires a delivery backend that hasn&rsquo;t shipped yet.
              For now, use the board-report generator on Apex for a shareable one-pager.
            </p>
            <button
              onClick={() => navigate('/apex')}
              className="mt-2 inline-flex items-center gap-1 text-caption text-accent hover:underline"
            >
              <FileText size={11} /> Open board report generator
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
