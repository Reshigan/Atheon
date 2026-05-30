/**
 * v48: Support Ticket Detail — thread view + reply composer.
 * Admins see all replies; regular users only see their own tickets (server
 * enforces this — 403 on other users' tickets, 404 across tenants).
 * Route: /support-tickets/:id | Role: any authenticated user
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { SupportTicket, SupportTicketReply } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { ArrowLeft, Loader2, Send } from 'lucide-react';

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

export function SupportTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const currentUser = useAppStore((s) => s.user);

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [replies, setReplies] = useState<SupportTicketReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);

  const showError = useCallback((title: string, err: unknown, fallback: string) => {
    const message = err instanceof Error ? err.message : fallback;
    toast.error(title, {
      message,
      requestId: err instanceof ApiError ? err.requestId : null,
    });
  }, [toast]);

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.support.get(id);
      setTicket(res.ticket);
      setReplies(res.replies);
    } catch (err) {
      showError('Failed to load ticket', err, 'Network error');
    }
  }, [id, showError]);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const res = await api.support.get(id);
        if (!cancelled) {
          setTicket(res.ticket);
          setReplies(res.replies);
        }
      } catch (err) {
        if (!cancelled) showError('Failed to load ticket', err, 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, showError]);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !replyBody.trim() || sending) return;
    setSending(true);
    try {
      await api.support.addReply(id, replyBody);
      setReplyBody('');
      await reload();
    } catch (err) {
      showError('Could not send reply', err, 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="p-5 max-w-4xl mx-auto">
        <Card>
          <div className="flex items-center justify-center py-10 t-muted text-sm gap-2">
            <Loader2 size={16} className="animate-spin" />
            Loading ticket…
          </div>
        </Card>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="p-5 max-w-4xl mx-auto space-y-4">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-xs t-muted hover:t-primary"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <Card>
          <div className="text-center py-8">
            <p className="text-sm t-secondary">Ticket not found.</p>
            <Link to="/support-tickets" className="text-xs text-accent hover:underline mt-2 inline-block">
              Back to tickets
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const isClosed = ticket.status === 'closed';
  const canReply = !isClosed;

  return (
    <div className="p-5 max-w-4xl mx-auto space-y-4">
      <Link
        to="/support-tickets"
        className="inline-flex items-center gap-1 text-xs t-muted hover:t-primary"
      >
        <ArrowLeft size={14} />
        All tickets
      </Link>

      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-headline-xl font-bold t-primary tracking-tight leading-tight">{ticket.subject}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Badge variant={STATUS_VARIANT[ticket.status] ?? 'default'}>{ticket.status.replace('_', ' ')}</Badge>
              <Badge variant={PRIORITY_VARIANT[ticket.priority] ?? 'default'}>{ticket.priority}</Badge>
              <Badge variant="default">{ticket.category.replace('_', ' ')}</Badge>
              <span className="text-caption t-muted">Opened {new Date(ticket.created_at).toLocaleString()}</span>
            </div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-card)' }}>
          <p className="text-sm t-primary whitespace-pre-wrap">{ticket.body}</p>
        </div>
      </Card>

      <div className="space-y-2" data-testid="support-reply-thread">
        {replies.map((r) => {
          const isMine = currentUser && r.user_id === currentUser.id;
          return (
            <Card key={r.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge variant={isMine ? 'info' : 'default'}>
                    {isMine ? 'You' : 'Agent'}
                  </Badge>
                  <span className="text-caption t-muted">{new Date(r.created_at).toLocaleString()}</span>
                </div>
              </div>
              <p className="text-sm t-primary mt-2 whitespace-pre-wrap">{r.body}</p>
            </Card>
          );
        })}
      </div>

      {canReply ? (
        <Card>
          <form onSubmit={handleReply} className="space-y-3" data-testid="support-reply-form">
            <label className="space-y-1 block">
              <span className="text-xs font-medium t-secondary">Reply</span>
              <textarea
                value={replyBody}
                maxLength={10000}
                rows={4}
                placeholder="Add more context, screenshots links, or acknowledge the resolution..."
                onChange={(e) => setReplyBody(e.target.value)}
                className="w-full rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)] resize-y"
                style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
                data-testid="support-reply-textarea"
              />
              <span className="text-caption t-muted">{replyBody.length} / 10000</span>
            </label>
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!replyBody.trim() || sending}
                data-testid="support-send-reply-btn"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Send reply
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Card>
          <p className="text-xs t-muted text-center py-2">
            This ticket is closed. Open a new ticket if you need further assistance.
          </p>
        </Card>
      )}
    </div>
  );
}
