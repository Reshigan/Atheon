/**
 * Action Queue widget — header dropdown showing the user's open commitments
 * across the platform, with click-through to each. Turns the multi-tab IA
 * from a reporting surface into a workflow surface.
 *
 * Three sources, all already exposed by existing endpoints:
 *
 *   1. Pending HITL approvals  → /catalysts (Exceptions tab)
 *   2. Critical/high open anomalies → /pulse (Anomalies tab)
 *   3. High/critical open risks → /apex (Risk Overview tab)
 *
 * Refresh on mount + every 60 s while the page is visible. Hidden when no
 * actions exist (quiet ops → quiet UI).
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckSquare, AlertTriangle, ShieldAlert, ArrowRight, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

type ApprovalRow = {
  id: string;
  clusterName: string;
  catalystName: string;
  action: string;
  confidence: number;
  createdAt: string;
};

type AnomalyRow = {
  id: string;
  metric: string;
  severity: string;
};

type RiskRow = {
  id: string;
  title: string;
  severity: string;
  category?: string;
};

type Snapshot = {
  approvals: ApprovalRow[];
  anomalies: AnomalyRow[];
  risks: RiskRow[];
};

const REFRESH_INTERVAL_MS = 60_000;

export function ActionQueueWidget(): JSX.Element | null {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState<Snapshot>({ approvals: [], anomalies: [], risks: [] });
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      const [appRes, anomRes, riskRes] = await Promise.allSettled([
        api.catalysts.pendingApprovals(),
        api.pulse.anomalies(undefined, undefined, undefined),
        api.apex.risks(undefined, undefined),
      ]);
      const approvals = appRes.status === 'fulfilled'
        ? appRes.value.approvals.slice(0, 25)
        : [];
      const anomalies = anomRes.status === 'fulfilled'
        ? anomRes.value.anomalies
            .filter(a => (a.status === 'open' || !a.status) && (a.severity === 'critical' || a.severity === 'high'))
            .slice(0, 25)
            .map(a => ({ id: a.id, metric: a.metric, severity: a.severity }))
        : [];
      const risks = riskRes.status === 'fulfilled'
        ? riskRes.value.risks
            .filter(r => r.severity === 'critical' || r.severity === 'high')
            .slice(0, 25)
            .map(r => ({ id: r.id, title: r.title, severity: r.severity, category: r.category }))
        : [];
      setSnap({ approvals, anomalies, risks });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const interval = window.setInterval(() => {
      // Avoid hammering the API when the tab is hidden.
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  // Click-outside handler.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const total = snap.approvals.length + snap.anomalies.length + snap.risks.length;

  function jump(path: string): void {
    setOpen(false);
    navigate(path);
  }

  // Hidden when nothing is actionable (matches Pulse Action Required strip).
  if (loading || total === 0) return null;

  return (
    <div className="relative" ref={dropdownRef} data-testid="action-queue">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[var(--bg-secondary)] transition-colors active:scale-[0.97]"
        title={`${total} action${total === 1 ? '' : 's'} pending`}
        aria-label={`Action queue — ${total} pending`}
      >
        <CheckSquare size={18} className="t-secondary" />
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-caption font-semibold flex items-center justify-center">
          {total > 99 ? '99+' : total}
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-96 rounded-xl shadow-lg z-50 max-h-[80vh] overflow-y-auto"
          style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}
        >
          <div className="px-4 py-3 border-b border-[var(--border-card)] flex items-center justify-between">
            <h3 className="text-sm font-semibold t-primary">Action Queue</h3>
            <span className="text-caption t-muted">{total} pending</span>
          </div>

          {/* Approvals */}
          {snap.approvals.length > 0 && (
            <Section
              icon={<CheckSquare size={14} className="text-accent" />}
              title="HITL approvals"
              count={snap.approvals.length}
              onJumpAll={() => jump('/catalysts')}
            >
              {snap.approvals.slice(0, 4).map(a => (
                <button
                  key={a.id}
                  onClick={() => jump('/catalysts')}
                  className="w-full text-left px-3 py-2 hover:bg-[var(--bg-secondary)] transition-colors"
                >
                  <div className="text-xs font-medium t-primary truncate">{a.action}</div>
                  <div className="text-caption t-muted truncate">
                    {a.clusterName} · {a.catalystName} · confidence {(a.confidence * 100).toFixed(0)}%
                  </div>
                </button>
              ))}
            </Section>
          )}

          {/* Anomalies */}
          {snap.anomalies.length > 0 && (
            <Section
              icon={<AlertTriangle size={14} className="text-amber-400" />}
              title="Critical anomalies"
              count={snap.anomalies.length}
              onJumpAll={() => jump('/pulse')}
            >
              {snap.anomalies.slice(0, 4).map(a => (
                <button
                  key={a.id}
                  onClick={() => jump('/pulse')}
                  className="w-full text-left px-3 py-2 hover:bg-[var(--bg-secondary)] transition-colors"
                >
                  <div className="text-xs font-medium t-primary truncate">{a.metric}</div>
                  <div className="text-caption t-muted">{a.severity}</div>
                </button>
              ))}
            </Section>
          )}

          {/* Risks */}
          {snap.risks.length > 0 && (
            <Section
              icon={<ShieldAlert size={14} className="text-red-400" />}
              title="Open risks"
              count={snap.risks.length}
              onJumpAll={() => jump('/apex')}
            >
              {snap.risks.slice(0, 4).map(r => (
                <button
                  key={r.id}
                  onClick={() => jump('/apex')}
                  className="w-full text-left px-3 py-2 hover:bg-[var(--bg-secondary)] transition-colors"
                >
                  <div className="text-xs font-medium t-primary truncate">{r.title}</div>
                  <div className="text-caption t-muted">{r.severity}{r.category ? ` · ${r.category}` : ''}</div>
                </button>
              ))}
            </Section>
          )}

          <div className="px-3 py-2 border-t border-[var(--border-card)] text-caption t-muted text-center">
            Auto-refreshes every minute
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  icon, title, count, onJumpAll, children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  onJumpAll: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="border-b border-[var(--border-card)] last:border-b-0">
      <div className="px-4 py-2 flex items-center justify-between bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs font-medium t-primary">{title}</span>
          <span className="text-caption t-muted">{count}</span>
        </div>
        <button
          onClick={onJumpAll}
          className="text-caption t-muted hover:t-primary flex items-center gap-1 transition-colors"
        >
          View all <ArrowRight size={10} />
        </button>
      </div>
      <div className="divide-y divide-[var(--border-card)]">{children}</div>
    </div>
  );
}

ActionQueueWidget.LoaderIcon = Loader2;
