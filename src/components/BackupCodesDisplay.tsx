/**
 * BackupCodesDisplay — shows MFA recovery codes to the user EXACTLY ONCE.
 *
 * After MFA enrollment (or backup code regeneration), the backend returns 8 codes that the
 * user must save in a secure location. The backend will never show them again. This component
 * makes that crystal clear via:
 *  - Prominent warning banner at top
 *  - Grid of codes with click-to-copy per-code
 *  - "Copy all" and "Download .txt" helpers
 *  - A required "I have saved these codes" checkbox that gates the "Done" button
 *  - A confirm-on-dismiss guard so the user can't accidentally close the modal
 */
import { useState } from 'react';
import { AlertTriangle, Copy, CheckCircle2, Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface BackupCodesDisplayProps {
  codes: string[];
  /** Called once the user has acknowledged saving the codes. */
  onAcknowledge: () => void;
  /** Shown at the top — e.g. "Backup codes regenerated" vs "MFA enabled". */
  heading?: string;
  /** Optional subheading to contextualize the action. */
  subheading?: string;
}

export function BackupCodesDisplay({
  codes,
  onAcknowledge,
  heading = 'Save your recovery codes',
  subheading,
}: BackupCodesDisplayProps) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [saved, setSaved] = useState(false);

  const copyOne = async (code: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500);
    } catch {
      /* no-op — clipboard may be blocked in some contexts */
    }
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const downloadTxt = () => {
    const now = new Date().toISOString().slice(0, 10);
    const header = [
      'Atheon — MFA Recovery Codes',
      `Generated: ${new Date().toISOString()}`,
      '',
      'Keep these codes in a secure location (password manager, printed copy in a safe).',
      'Each code can be used ONCE to sign in if you lose access to your authenticator app.',
      '',
      ...codes,
      '',
    ].join('\n');
    const blob = new Blob([header], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atheon-mfa-recovery-codes-${now}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDownloaded(true);
  };

  const handleDone = () => {
    if (!saved) return;
    onAcknowledge();
  };

  const attemptDismiss = () => {
    if (saved) {
      onAcknowledge();
      return;
    }
    const confirmed = window.confirm(
      'Are you sure? You will NOT be able to see these codes again. Without them, you could be locked out of your account if you lose your authenticator app.',
    );
    if (confirmed) onAcknowledge();
  };

  return (
    <div className="space-y-4">
      {/* Big warning banner */}
      <div
        role="alert"
        className="flex items-start gap-3 p-4 rounded-md border-2"
        style={{ background: 'rgb(var(--warning-rgb) / 0.1)', borderColor: 'rgb(var(--warning-rgb) / 0.3)' }}
      >
        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
        <div className="flex-1 space-y-1">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--warning)' }}>Save these {codes.length} recovery codes NOW</h3>
          <p className="text-xs t-secondary">
            Atheon <strong>will not show them again</strong>. Each code can be used exactly once to sign in if you lose
            access to your authenticator app. Store them in a password manager or print them and keep in a secure place.
          </p>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium t-primary mb-1">{heading}</h4>
        {subheading && <p className="text-xs t-muted mb-3">{subheading}</p>}
      </div>

      {/* Grid of codes */}
      <div
        className="grid grid-cols-2 gap-2 p-3 rounded-md"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}
      >
        {codes.map((code, idx) => (
          <button
            key={code + idx}
            type="button"
            onClick={() => copyOne(code, idx)}
            className="group flex items-center justify-between gap-2 px-3 py-2 rounded-md font-mono text-sm t-primary transition-colors hover:bg-[var(--bg-input)] active:scale-[0.97]"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)' }}
            title="Click to copy"
          >
            <span className="select-all tracking-wider">{code}</span>
            {copiedIdx === idx ? (
              <CheckCircle2 size={14} className="text-accent flex-shrink-0" />
            ) : (
              <Copy size={14} className="t-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            )}
          </button>
        ))}
      </div>

      {/* Copy-all + download */}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={copyAll} title="Copy all codes to clipboard">
          {copiedAll ? <CheckCircle2 size={14} className="text-accent" /> : <Copy size={14} />}
          {copiedAll ? 'Copied all' : 'Copy all'}
        </Button>
        <Button variant="secondary" size="sm" onClick={downloadTxt} title="Download as a plain-text file">
          {downloaded ? <CheckCircle2 size={14} className="text-accent" /> : <Download size={14} />}
          {downloaded ? 'Downloaded' : 'Download .txt'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => window.print()} title="Open print dialog">
          <FileText size={14} />
          Print
        </Button>
      </div>

      {/* Acknowledgement gate */}
      <label className="flex items-start gap-2 p-3 rounded-md cursor-pointer select-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)' }}>
        <input
          type="checkbox"
          className="mt-0.5"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          aria-label="Confirm recovery codes saved"
        />
        <span className="text-xs t-primary">
          I have saved these codes in a secure location. I understand I will not be able to see them again.
        </span>
      </label>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={attemptDismiss} title="Close without saving acknowledgement">
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleDone} disabled={!saved} title={saved ? 'Finish' : 'Check the acknowledgement box first'}>
          I&apos;m done
        </Button>
      </div>
    </div>
  );
}
