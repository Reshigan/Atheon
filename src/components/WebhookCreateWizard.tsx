/**
 * WebhookCreateWizard — two-step create flow for webhooks.
 *
 * Step 1: form (URL, event types, optional description)
 * Step 2: secret-show-once reveal (via WebhookSecretReveal)
 *
 * The wizard owns the two-step state so the page can render a single modal and
 * route the user through create → reveal without risking a premature close before
 * the secret is saved.
 */
import { useEffect, useState } from "react";
import { Loader2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { WebhookCreateResponse } from "@/lib/api";
import { WebhookSecretReveal } from "./WebhookSecretReveal";
import { FormError } from "@/components/ui/state";

/**
 * Backend-documented event catalog. Kept in sync with PR #225 docs. If the
 * backend exposes `/api/v1/webhooks/event-types`, we prefer that; otherwise we
 * fall back to this curated list.
 */
const DEFAULT_EVENT_TYPES: string[] = [
  "catalyst.action.completed",
  "catalyst.action.failed",
  "catalyst.run.completed",
  "apex.briefing.generated",
  "apex.risk.detected",
  "erp.sync.completed",
  "erp.sync.failed",
  "pulse.anomaly.detected",
  "assessment.completed",
  "tenant.user.created",
];

interface WebhookCreateWizardProps {
  onCompleted: (webhookId: string) => void;
  onCancel: () => void;
}

export function WebhookCreateWizard({ onCompleted, onCancel }: WebhookCreateWizardProps) {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [availableEvents, setAvailableEvents] = useState<string[]>(DEFAULT_EVENT_TYPES);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<WebhookCreateResponse | null>(null);

  // Best-effort load of the backend-advertised event catalog.
  useEffect(() => {
    let cancelled = false;
    api.webhooks.eventTypes().then((res) => {
      if (cancelled) return;
      if (res?.event_types?.length) setAvailableEvents(res.event_types);
    }).catch(() => { /* fall back to defaults */ });
    return () => { cancelled = true; };
  }, []);

  const toggleEvent = (ev: string) => {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(ev)) next.delete(ev);
      else next.add(ev);
      return next;
    });
  };

  const validUrl = (() => {
    if (!url) return false;
    try {
      const u = new URL(url);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  })();

  const canSubmit = validUrl && selectedEvents.size > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.webhooks.create({
        url,
        event_types: Array.from(selectedEvents),
        description: description || undefined,
      });
      setCreated(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create webhook");
    }
    setSubmitting(false);
  };

  // Step 2: show-once secret reveal
  if (created) {
    return (
      <WebhookSecretReveal
        webhookId={created.id}
        url={created.url}
        secret={created.secret}
        eventTypes={created.event_types}
        onDone={() => onCompleted(created.id)}
      />
    );
  }

  // Step 1: creation form
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Input
          label="Delivery URL"
          type="url"
          placeholder="https://example.com/webhooks/atheon"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-invalid={url !== "" && !validUrl ? true : undefined}
        />
        {url && !validUrl && (
          <p className="text-caption text-neg">Must be a valid http(s) URL.</p>
        )}
        <p className="text-caption t-muted flex items-center gap-1">
          <Link2 size={10} /> We'll POST signed JSON payloads here.
        </p>
      </div>

      <div className="space-y-2">
        <Input
          label="Description (optional)"
          placeholder="e.g. Slack alerts, Zapier pipe, …"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium t-secondary">
            Event types <span className="t-muted">({selectedEvents.size} selected)</span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="text-caption t-muted hover:t-primary"
              onClick={() => setSelectedEvents(new Set(availableEvents))}
            >
              Select all
            </button>
            <button
              type="button"
              className="text-caption t-muted hover:t-primary"
              onClick={() => setSelectedEvents(new Set())}
            >
              Clear
            </button>
          </div>
        </div>
        <div
          className="max-h-56 overflow-y-auto rounded-md border p-2 space-y-1"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border-card)" }}
        >
          {availableEvents.map((ev) => {
            const checked = selectedEvents.has(ev);
            return (
              <label
                key={ev}
                className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-[var(--bg-card)] active:scale-[0.97]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleEvent(ev)}
                  aria-label={`Subscribe to ${ev}`}
                />
                <code className="text-xs font-mono t-primary">{ev}</code>
              </label>
            );
          })}
        </div>
        {selectedEvents.size === 0 && (
          <p className="text-caption text-neg">Select at least one event type.</p>
        )}
      </div>

      <FormError error={error} />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="md" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="primary" size="md" onClick={handleSubmit} disabled={!canSubmit}>
          {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
          Create webhook
        </Button>
      </div>
    </div>
  );
}
