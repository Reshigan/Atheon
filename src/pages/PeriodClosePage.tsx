/**
 * Period Close — Phase 10-34.
 *
 * Live readiness view for the period-close orchestrator. Shows the
 * 8-signal checklist with pass/fail per step, last-12-period close
 * history, and a "re-evaluate now" trigger. Read-only — the
 * subcatalyst flips checklist status automatically when all 8 pass.
 *
 * Route: /period-close   |   Roles: PLATFORM_ADMIN_ROLES (close
 * controller / CFO / financial controller).
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { PeriodCloseStatus, PeriodCloseHistoryItem } from '@/lib/api';
import { Loader2, RefreshCw, CheckCircle2, XCircle, AlertCircle, Calendar } from 'lucide-react';

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

function shiftPeriod(period: string, deltaMonths: number): string {
  const [y, m] = period.split('-').map((n) => parseInt(n, 10));
  const d = new Date(Date.UTC(y, (m - 1) + deltaMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function statusBadge(status: string | undefined) {
  switch (status) {
    case 'closed':       return { variant: 'default' as const, label: 'Closed' };
    case 'in_progress':  return { variant: 'outline' as const, label: 'In progress' };
    case 'open':         return { variant: 'secondary' as const, label: 'Open' };
    default:             return { variant: 'secondary' as const, label: status ?? '—' };
  }
}

export function PeriodClosePage() {
  const toast = useToast();
  const [period, setPeriod] = useState<string>(currentPeriod());
  const [status, setStatus] = useState<PeriodCloseStatus | null>(null);
  const [history, setHistory] = useState<PeriodCloseHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([
        api.ingest.periodCloseStatus(period),
        api.ingest.periodCloseHistory(),
      ]);
      setStatus(s);
      setHistory(h.history);
    } catch (err) {
      toast.error('Failed to load period-close status', {
        message: err instanceof Error ? err.message : 'Unknown error',
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  }, [period, toast]);

  useEffect(() => { load(); }, [load]);

  const completedPct = status?.steps_total
    ? Math.round((status.steps_completed ?? 0) / status.steps_total * 100)
    : 0;
  const badge = statusBadge(status?.status);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Period Close</h1>
          <p className="text-sm text-muted-foreground">8-signal readiness checklist · auto-managed by gl-period-close-orchestrator</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPeriod(shiftPeriod(period, -1))}
            className="rounded border px-2 py-1 text-sm hover:bg-muted"
            title="Previous period"
          >‹</button>
          <div className="flex items-center gap-2 rounded border px-3 py-1 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono">{period}</span>
          </div>
          <button
            onClick={() => setPeriod(shiftPeriod(period, 1))}
            className="rounded border px-2 py-1 text-sm hover:bg-muted"
            title="Next period"
          >›</button>
          <button
            onClick={() => setPeriod(currentPeriod())}
            className="rounded border px-3 py-1 text-sm hover:bg-muted"
          >Today</button>
          <button onClick={load} className="flex items-center gap-1 rounded border px-3 py-1 text-sm hover:bg-muted">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Headline tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Status</div>
          <div className="mt-1"><Badge variant={badge.variant}>{badge.label}</Badge></div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Steps complete</div>
          <div className="text-2xl font-semibold">{status?.steps_completed ?? 0}/{status?.steps_total ?? 0}</div>
          <div className="text-xs text-muted-foreground">{completedPct}%</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Target close</div>
          <div className="text-sm font-medium">{status?.target_close_date ?? '—'}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Closed at</div>
          <div className="text-sm font-medium">{status?.completed_at ? new Date(status.completed_at).toLocaleString() : '—'}</div>
        </Card>
      </div>

      {/* Checklist */}
      <Card className="overflow-hidden">
        <div className="border-b p-3">
          <h2 className="text-sm font-semibold">8-signal checklist · {period}</h2>
          <p className="text-xs text-muted-foreground">Each row reflects the orchestrator's last evaluation (per-tick)</p>
        </div>
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !status?.exists ? (
          <div className="flex flex-col items-center justify-center gap-2 p-12 text-muted-foreground">
            <AlertCircle className="h-8 w-8" />
            <div className="text-sm">No close checklist exists for {period}.</div>
            <div className="text-xs">A row is created automatically when the orchestrator first runs for this period.</div>
          </div>
        ) : (
          <div className="divide-y">
            {(status.step_results || []).map((step) => (
              <div key={step.id} className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  {step.passed
                    ? <CheckCircle2 className="h-5 w-5 text-green-500" />
                    : <XCircle className="h-5 w-5 text-amber-500" />
                  }
                  <div>
                    <div className="text-sm font-medium">{step.label}</div>
                    <div className="text-xs text-muted-foreground font-mono">{step.id}</div>
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant={step.passed ? 'default' : 'outline'}>{step.passed ? 'Pass' : 'Open'}</Badge>
                  <div className="mt-1 text-xs text-muted-foreground">{step.evidence} signal{step.evidence === 1 ? '' : 's'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* History */}
      <Card>
        <div className="border-b p-3">
          <h2 className="text-sm font-semibold">Recent periods</h2>
        </div>
        {history.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No prior periods on record.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Period</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Steps</th>
                  <th className="px-3 py-2 text-left font-medium">Started</th>
                  <th className="px-3 py-2 text-left font-medium">Closed</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const b = statusBadge(h.status);
                  return (
                    <tr key={h.period} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => setPeriod(h.period)}>
                      <td className="px-3 py-2 font-mono">{h.period}</td>
                      <td className="px-3 py-2"><Badge variant={b.variant}>{b.label}</Badge></td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.steps_completed}/{h.steps_total}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(h.started_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{h.completed_at ? new Date(h.completed_at).toLocaleDateString() : '—'}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">click to view</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default PeriodClosePage;
