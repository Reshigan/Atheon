/**
 * v48: Support Tickets — end-user page.
 * Lists the caller's tickets and lets them file a new one. Admins see every
 * ticket in the tenant; for triage they should use /support-triage instead.
 * Route: /support-tickets | Role: any authenticated user
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HeroHeader } from '@/components/ui/hero-header';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { SupportTicket, SupportTicketCategory, SupportTicketPriority } from '@/lib/api';
import { LifeBuoy, Plus, Loader2, X as XIcon } from 'lucide-react';

const CATEGORIES: Array<{ value: SupportTicketCategory; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'bug', label: 'Bug' },
  { value: 'billing', label: 'Billing' },
  { value: 'feature_request', label: 'Feature request' },
  { value: 'access', label: 'Access / login' },
  { value: 'other', label: 'Other' },
];

const PRIORITIES: SupportTicketPriority[] = ['low', 'normal', 'high', 'urgent'];

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  open: 'info',
  in_progress: 'warning',
  waiting_customer: 'warning',
  resolved: 'success',
  closed: 'default',
};

const PRIORITY_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  low: 'default',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
};

type FormState = {
  subject: string;
  body: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
};

const EMPTY_FORM: FormState = {
  subject: '',
  body: '',
  category: 'general',
  priority: 'normal',
};

export function SupportPage() {
  const toast = useToast();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const showError = useCallback((title: string, err: unknown, fallback: string) => {
    const message = err instanceof Error ? err.message : fallback;
    toast.error(title, {
      message,
      requestId: err instanceof ApiError ? err.requestId : null,
    });
  }, [toast]);

  const reload = useCallback(async () => {
    try {
      const res = await api.support.list({ limit: 50 });
      setTickets(res.tickets);
    } catch (err) {
      showError('Failed to load tickets', err, 'Network error');
    }
  }, [showError]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await api.support.list({ limit: 50 });
        if (!cancelled) setTickets(res.tickets);
      } catch (err) {
        if (!cancelled) showError('Failed to load tickets', err, 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showError]);

  const canSubmit = form.subject.trim().length > 0 && form.body.trim().length > 0 && !saving;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      await api.support.create({
        subject: form.subject.trim(),
        body: form.body,
        category: form.category,
        priority: form.priority,
      });
      toast.success('Ticket created', { message: 'Our team will respond shortly.' });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await reload();
    } catch (err) {
      showError('Could not create ticket', err, 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-5 max-w-5xl mx-auto space-y-5">
      <header className="flex items-start justify-between gap-4">
        <HeroHeader
          icon={LifeBuoy}
          title="Support"
          subtitle="File a ticket and track our response. For urgent outages, escalate via your CSM."
          accent="sage"
        />
        <Button
          variant="primary"
          size="md"
          onClick={() => { setForm(EMPTY_FORM); setShowForm(true); }}
          data-testid="support-new-ticket-btn"
        >
          <Plus size={14} />
          New ticket
        </Button>
      </header>

      {loading ? (
        <Card>
          <div className="flex items-center justify-center py-10 t-muted text-sm gap-2">
            <Loader2 size={16} className="animate-spin" />
            Loading tickets…
          </div>
        </Card>
      ) : tickets.length === 0 ? (
        <Card>
          <div className="text-center py-10">
            <LifeBuoy size={28} className="mx-auto t-muted mb-3" />
            <p className="text-sm t-secondary">You have no support tickets yet.</p>
            <p className="text-xs t-muted mt-1">Open one whenever something blocks you.</p>
            <Button className="mt-4" variant="secondary" size="sm" onClick={() => setShowForm(true)}>
              <Plus size={14} />
              New ticket
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="support-ticket-list">
          {tickets.map((t) => (
            <Link
              key={t.id}
              to={`/support-tickets/${t.id}`}
              className="block"
              data-testid="support-ticket-row"
            >
              <Card hover>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold t-primary truncate">{t.subject}</h3>
                      <Badge variant={STATUS_VARIANT[t.status] ?? 'default'}>{t.status.replace('_', ' ')}</Badge>
                      <Badge variant={PRIORITY_VARIANT[t.priority] ?? 'default'}>{t.priority}</Badge>
                      <Badge variant="default">{t.category.replace('_', ' ')}</Badge>
                    </div>
                    <p className="text-xs t-muted mt-1 line-clamp-2">{t.body}</p>
                  </div>
                  <div className="text-caption t-muted whitespace-nowrap">
                    {new Date(t.created_at).toLocaleDateString()}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowForm(false)}
          data-testid="support-new-ticket-modal"
        >
          <Card
            className="w-full max-w-lg"
            style={{ background: 'var(--bg-modal)', maxHeight: '90vh', overflow: 'auto' }}
            onClick={() => { /* stop close-on-inside-click */ }}
          >
            <div
              className="flex items-center justify-between mb-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-base font-semibold t-primary">New support ticket</h2>
              <button
                onClick={() => setShowForm(false)}
                className="p-1.5 rounded-md t-muted hover:t-primary hover:bg-[var(--bg-secondary)]"
                aria-label="Close"
              >
                <XIcon size={16} />
              </button>
            </div>

            <form
              onSubmit={handleCreate}
              onClick={(e) => e.stopPropagation()}
              className="space-y-3"
              data-testid="support-new-ticket-form"
            >
              <Input
                label="Subject"
                value={form.subject}
                maxLength={200}
                placeholder="Short summary of the issue"
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                data-testid="support-subject-input"
              />

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 block">
                  <span className="text-xs font-medium t-secondary">Category</span>
                  <select
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as SupportTicketCategory }))}
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)]"
                    style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
                    data-testid="support-category-select"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 block">
                  <span className="text-xs font-medium t-secondary">Priority</span>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as SupportTicketPriority }))}
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)]"
                    style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
                    data-testid="support-priority-select"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="space-y-1 block">
                <span className="text-xs font-medium t-secondary">Description</span>
                <textarea
                  value={form.body}
                  maxLength={10000}
                  rows={6}
                  placeholder="Steps to reproduce, expected vs actual, error messages..."
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)] resize-y"
                  style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
                  data-testid="support-body-textarea"
                />
                <span className="text-caption t-muted">{form.body.length} / 10000</span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowForm(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={!canSubmit}
                  data-testid="support-submit-btn"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  Create ticket
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
