/**
 * MetricSubscribeButton — Wave 4 polish.
 *
 * Lets the current user subscribe to a Pulse metric and get notified
 * when it crosses a threshold. Renders a bell icon button that opens
 * a small dialog with comparator + threshold inputs. Backed by
 * /api/pulse/subscriptions.
 *
 * Dropped into each metric card on PulsePage. Stops propagation on
 * click so it doesn't toggle the card expansion.
 */
import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, X } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';

type Comparator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
const COMPARATOR_LABELS: Record<Comparator, string> = {
  gt: 'greater than',
  gte: 'greater than or equal to',
  lt: 'less than',
  lte: 'less than or equal to',
  eq: 'equal to',
};

interface Props {
  metricId: string;
  metricName: string;
  metricUnit: string | null;
  currentValue: number;
}

export function MetricSubscribeButton({ metricId, metricName, metricUnit, currentValue }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const [hasSubscription, setHasSubscription] = useState<string | null>(null);
  const [comparator, setComparator] = useState<Comparator>('gt');
  // Pre-seed threshold at +/- 10% of current value so the form is one-click for
  // the most common "alert when it drifts" case.
  const [threshold, setThreshold] = useState<string>(() =>
    Number.isFinite(currentValue) ? (currentValue * 1.1).toFixed(2) : '0'
  );
  const [channel, setChannel] = useState<'email' | 'in_app' | 'both'>('email');
  const [cooldown, setCooldown] = useState<number>(60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  // Look up whether the caller already has a subscription on this metric so
  // we can show "Unsubscribe" instead of opening the create form.
  const refreshSubState = useCallback(async () => {
    try {
      const { subscriptions } = await api.pulse.listSubscriptions();
      const existing = subscriptions.find((s) => s.metric_id === metricId && s.active === 1);
      setHasSubscription(existing?.id ?? null);
    } catch {
      // Best-effort — a missing list shouldn't block the create flow.
    }
  }, [metricId]);

  useEffect(() => { void refreshSubState(); }, [refreshSubState]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const num = Number(threshold);
    if (!Number.isFinite(num)) {
      setError('Threshold must be a number');
      return;
    }
    setSaving(true);
    try {
      await api.pulse.createSubscription({
        metric_id: metricId,
        comparator,
        threshold_value: num,
        channel,
        cooldown_minutes: cooldown,
      });
      toast.show({
        variant: 'success',
        title: 'Subscription created',
        message: `You'll be alerted when ${metricName} is ${COMPARATOR_LABELS[comparator]} ${num}${metricUnit ? ' ' + metricUnit : ''}.`,
      });
      setOpen(false);
      await refreshSubState();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create subscription');
    } finally {
      setSaving(false);
    }
  };

  const handleUnsubscribe = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasSubscription) return;
    setSaving(true);
    try {
      await api.pulse.deleteSubscription(hasSubscription);
      toast.show({ variant: 'success', title: 'Unsubscribed', message: `No more alerts on ${metricName}.` });
      setHasSubscription(null);
    } catch (err) {
      toast.show({
        variant: 'error',
        title: 'Unsubscribe failed',
        message: err instanceof ApiError ? err.message : 'Try again',
      });
    } finally {
      setSaving(false);
    }
  };

  if (hasSubscription) {
    return (
      <button
        type="button"
        onClick={handleUnsubscribe}
        disabled={saving}
        className="text-accent hover:text-accent/80 transition-colors disabled:opacity-50"
        title="Unsubscribe from alerts"
        aria-label={`Unsubscribe from ${metricName}`}
      >
        <Bell size={12} className="fill-current" />
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="opacity-0 group-hover:opacity-100 t-muted hover:t-primary transition-[opacity,color,transform] duration-[var(--dur-press)]"
        title="Subscribe to alerts"
        aria-label={`Subscribe to ${metricName} alerts`}
      >
        <BellOff size={12} />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} size="sm">
        <form onSubmit={handleSubmit}>
          <Modal.Header
            title="Subscribe to alerts"
            onClose={() => setOpen(false)}
          />
          <Modal.Body>
            <div className="space-y-4">
              <div>
                <p className="text-caption uppercase tracking-wider t-muted mb-1">Metric</p>
                <p className="text-body t-primary font-medium">{metricName}</p>
                <p className="text-caption t-muted mt-0.5">
                  Currently {currentValue}{metricUnit ? ` ${metricUnit}` : ''}
                </p>
              </div>

              <div>
                <label htmlFor="comparator" className="text-caption uppercase tracking-wider t-muted block mb-1">
                  Alert when value is
                </label>
                <select
                  id="comparator"
                  value={comparator}
                  onChange={(e) => setComparator(e.target.value as Comparator)}
                  className="w-full px-3 py-2 rounded-lg text-sm t-primary"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}
                >
                  {(Object.keys(COMPARATOR_LABELS) as Comparator[]).map((c) => (
                    <option key={c} value={c}>{COMPARATOR_LABELS[c]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="threshold" className="text-caption uppercase tracking-wider t-muted block mb-1">
                  Threshold {metricUnit ? `(${metricUnit})` : ''}
                </label>
                <Input
                  id="threshold"
                  type="number"
                  step="any"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="channel" className="text-caption uppercase tracking-wider t-muted block mb-1">Channel</label>
                  <select
                    id="channel"
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as typeof channel)}
                    className="w-full px-3 py-2 rounded-lg text-sm t-primary"
                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}
                  >
                    <option value="email">Email</option>
                    <option value="in_app">In-app</option>
                    <option value="both">Both</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="cooldown" className="text-caption uppercase tracking-wider t-muted block mb-1">Cooldown (min)</label>
                  <Input
                    id="cooldown"
                    type="number"
                    min={5}
                    max={1440}
                    value={cooldown}
                    onChange={(e) => setCooldown(Number(e.target.value) || 60)}
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md text-body-sm pill-danger" role="alert">
                  <X size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Subscribe'}</Button>
          </Modal.Footer>
        </form>
      </Modal>
    </>
  );
}
