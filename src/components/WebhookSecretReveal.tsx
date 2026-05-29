/**
 * WebhookSecretReveal — show-once display of a freshly-created webhook signing secret.
 *
 * Mirrors the "MFA backup codes" pattern: large monospace secret, copy + download
 * buttons, a required "I saved it" checkbox, and a hard-confirm if the user tries
 * to dismiss before acknowledging. Backend only returns the raw secret on creation,
 * so losing it here means rotating (deleting + recreating) the webhook.
 *
 * TODO(DRY): consolidate with the MFA BackupCodesDisplay landed by the parallel
 * worktree. These are duplicated deliberately to keep parallel worktrees isolated.
 */
import { useState } from "react";
import { AlertTriangle, Copy, CheckCircle2, Download, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WebhookSecretRevealProps {
  webhookId: string;
  url: string;
  secret: string;
  eventTypes: string[];
  onDone: () => void;
}

/** Build the download file contents (text, with brief operator notes). */
function buildSecretFile(args: { webhookId: string; url: string; secret: string; eventTypes: string[] }) {
  const { webhookId, url, secret, eventTypes } = args;
  return [
    "Atheon Webhook Signing Secret",
    "=============================",
    "",
    `Webhook ID: ${webhookId}`,
    `Delivery URL: ${url}`,
    `Event Types: ${eventTypes.join(", ") || "(none)"}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Signing Secret (store securely — Atheon cannot retrieve it again):",
    secret,
    "",
    "Signature Verification",
    "----------------------",
    "Every delivery carries these headers:",
    "  X-Atheon-Signature: sha256=<hex>",
    "  X-Atheon-Timestamp: <unix_seconds>",
    "  X-Atheon-Event: <event_type>",
    "  X-Atheon-Webhook-Id: <webhook_id>",
    "",
    "Compute the expected signature as:",
    "  HMAC-SHA256(secret, timestamp + '.' + raw_body)",
    "and compare in constant time to the value after 'sha256='.",
    "",
  ].join("\n");
}

export function WebhookSecretReveal({ webhookId, url, secret, eventTypes, onDone }: WebhookSecretRevealProps) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked — user can still select the secret manually
    }
  };

  const handleDownload = () => {
    const blob = new Blob([buildSecretFile({ webhookId, url, secret, eventTypes })], { type: "text/plain" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `atheon-webhook-${webhookId}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  const handleDone = () => {
    if (!acknowledged) return;
    onDone();
  };

  /** Hard confirmation if user tries to close without checking the box. */
  const handleAttemptClose = () => {
    if (acknowledged) {
      onDone();
      return;
    }
    const ok = window.confirm(
      "Are you sure you have saved the secret? It cannot be retrieved later — you would need to revoke this webhook and create a new one."
    );
    if (ok) onDone();
  };

  return (
    <div className="space-y-5">
      {/* Amber alert banner */}
      <div
        role="alert"
        className="flex items-start gap-3 p-4 rounded-md border"
        style={{ background: 'rgb(var(--warning-rgb) / 0.1)', borderColor: 'rgb(var(--warning-rgb) / 0.3)' }}
      >
        <AlertTriangle size={20} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--warning)' }} />
        <div className="space-y-1">
          <p className="text-sm font-semibold" style={{ color: 'var(--warning)' }}>
            This is the only time you will see this secret.
          </p>
          <p className="text-xs t-secondary">
            Atheon stores only a hash — we cannot show it to you again. Save it in your
            secret manager now. If lost, revoke this webhook and create a new one.
          </p>
        </div>
      </div>

      {/* Monospace secret display */}
      <div className="space-y-2">
        <label className="text-xs font-medium t-secondary flex items-center gap-1.5">
          <ShieldAlert size={12} style={{ color: 'var(--warning)' }} /> Signing secret
        </label>
        <div
          className="p-4 rounded-md border font-mono text-sm break-all select-all"
          style={{
            background: "var(--bg-secondary)",
            borderColor: "var(--border-card)",
            color: "var(--text-primary)",
            letterSpacing: "0.02em",
          }}
          data-testid="webhook-secret-value"
        >
          {secret}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={handleCopy}>
            {copied ? (
              <>
                <CheckCircle2 size={14} className="text-accent" /> Copied!
              </>
            ) : (
              <>
                <Copy size={14} /> Copy
              </>
            )}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleDownload}>
            <Download size={14} /> Download .txt
          </Button>
        </div>
      </div>

      {/* Webhook summary */}
      <div className="p-3 rounded-md text-xs space-y-1" style={{ background: "var(--bg-secondary)" }}>
        <div className="flex gap-2">
          <span className="t-muted w-20">Webhook ID</span>
          <span className="t-primary font-mono">{webhookId}</span>
        </div>
        <div className="flex gap-2">
          <span className="t-muted w-20">URL</span>
          <span className="t-primary break-all">{url}</span>
        </div>
        <div className="flex gap-2">
          <span className="t-muted w-20">Events</span>
          <span className="t-primary">{eventTypes.join(", ") || "(none)"}</span>
        </div>
      </div>

      {/* Acknowledgement checkbox */}
      <label className="flex items-start gap-2 cursor-pointer select-none p-3 rounded-md border border-[var(--border-card)]">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5"
          aria-label="I have saved this secret"
        />
        <span className="text-xs t-primary">
          I have saved this secret in a secure location (secret manager, vault, or
          equivalent). I understand Atheon cannot retrieve it again.
        </span>
      </label>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="md" onClick={handleAttemptClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={handleDone}
          disabled={!acknowledged}
          title={acknowledged ? "Dismiss" : "Check the box above to continue"}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
