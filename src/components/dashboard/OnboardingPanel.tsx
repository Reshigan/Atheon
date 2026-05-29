/**
 * OnboardingPanel — per-connection setup checklist.
 *
 * Surfaces the customer-side steps needed to get full value from a
 * connection: sync, review mappings, set process profile rules, choose
 * autonomy tier, dispatch first action.
 *
 * Renders as a compact panel above the per-connection action buttons.
 * Once all steps are complete, the panel collapses to a one-line "all
 * set" success line.
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api, ApiError } from '@/lib/api';
import { Loader2, CheckCircle2, Circle } from 'lucide-react';
import { Link } from 'react-router-dom';

type Status = Awaited<ReturnType<typeof api.erp.onboardingStatus>>;

export function OnboardingPanel({ connectionId }: { connectionId: string }): JSX.Element | null {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.erp.onboardingStatus(connectionId);
      setStatus(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load onboarding status');
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="mt-3 p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)] text-xs t-muted flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" /> Checking setup status…
      </div>
    );
  }
  if (error || !status) return null;

  const allDone = status.complete_count === status.total_count;
  if (allDone && collapsed) {
    return (
      <div className="mt-3 p-2 rounded-sm text-xs flex items-center gap-2" style={{ background: 'rgb(var(--accent-rgb) / 0.1)', border: '1px solid rgb(var(--accent-rgb) / 0.2)', color: 'var(--accent)' }}>
        <CheckCircle2 size={12} /> Setup complete — every catalyst can run with your full configuration.
      </div>
    );
  }

  return (
    <div className="mt-3 p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)] animate-fadeIn">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold t-primary">Setup checklist</span>
          <Badge variant={allDone ? 'success' : 'warning'} size="sm">
            {status.complete_count} / {status.total_count}
          </Badge>
        </div>
        {allDone && (
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(true)}>Collapse</Button>
        )}
      </div>
      <ul className="space-y-1">
        {status.steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2 text-xs">
            {s.complete ? (
              <CheckCircle2 size={14} className="text-accent mt-0.5 flex-shrink-0" />
            ) : (
              <Circle size={14} className="t-muted mt-0.5 flex-shrink-0" />
            )}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className={s.complete ? 't-muted line-through' : 't-primary font-medium'}>{s.title}</span>
                {!s.complete && (
                  <Link to={s.action_path} className="text-accent hover:underline text-caption">
                    Start
                  </Link>
                )}
              </div>
              {!s.complete && <p className="t-muted mt-0.5">{s.description}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
