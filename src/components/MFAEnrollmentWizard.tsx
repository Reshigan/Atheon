/**
 * MFAEnrollmentWizard — 3-step TOTP enrollment flow.
 *
 * Steps:
 *   1. Install an authenticator app (skippable)
 *   2. Scan the QR code (or enter the secret manually)
 *   3. Enter the 6-digit verification code
 *  -> On success, shows the BackupCodesDisplay (shown-once recovery codes).
 *
 * QR rendering uses the `qrcode` npm package (MIT) to emit an inline SVG string from the
 * backend-provided `qr_uri` (otpauth://...). The secret is also shown in text form for manual
 * entry. If QR generation fails for any reason we fall back to the raw otpauth URI as a link.
 */
import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Shield, Smartphone, ScanLine, KeyRound, Copy, CheckCircle2, Loader2, ArrowRight, ArrowLeft, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { BackupCodesDisplay } from '@/components/BackupCodesDisplay';

type Step = 'install' | 'scan' | 'verify' | 'backup' | 'done';

export interface MFAEnrollmentWizardProps {
  onComplete: () => void;
  onCancel?: () => void;
}

export function MFAEnrollmentWizard({ onComplete, onCancel }: MFAEnrollmentWizardProps) {
  const [step, setStep] = useState<Step>('install');
  const [secret, setSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [qrSvg, setQrSvg] = useState<string>('');
  const [qrError, setQrError] = useState(false);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  // Kick off the setup call when user enters the scan step.
  const beginSetup = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.auth.mfaSetup();
      const uri = res.qr_uri || res.provisioning_uri || res.otpauthUri || '';
      setSecret(res.secret || '');
      setOtpauthUri(uri);
      setStep('scan');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize MFA setup');
    } finally {
      setLoading(false);
    }
  };

  // Generate QR SVG whenever we have a provisioning URI.
  useEffect(() => {
    if (!otpauthUri) {
      setQrSvg('');
      setQrError(false);
      return;
    }
    let cancelled = false;
    QRCode.toString(otpauthUri, { type: 'svg', width: 220, margin: 2, errorCorrectionLevel: 'M' })
      .then((svg) => {
        if (!cancelled) {
          setQrSvg(svg);
          setQrError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrSvg('');
          setQrError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [otpauthUri]);

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const verify = async () => {
    if (code.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.auth.mfaVerify(code);
      const codes = res.backupCodes || res.backup_codes || [];
      if (codes.length > 0) {
        setBackupCodes(codes);
        setStep('backup');
      } else {
        // Backend didn't return codes — still a successful enrollment, just no codes to show.
        setStep('done');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code. Please check your authenticator and try again.');
    } finally {
      setLoading(false);
    }
  };

  // Pretty-print the secret in groups of 4 for easier manual entry.
  const prettySecret = useMemo(() => {
    if (!secret) return '';
    return secret.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
  }, [secret]);

  const progressIndex = step === 'install' ? 0 : step === 'scan' ? 1 : step === 'verify' ? 2 : 3;
  const stepsForProgress = ['Install app', 'Scan QR', 'Verify', 'Backup codes'];

  return (
    <div className="space-y-5">
      {/* Step indicator */}
      {step !== 'done' && (
        <div className="flex items-center gap-2 text-caption t-muted" aria-label="Enrollment progress">
          {stepsForProgress.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-caption font-semibold transition-colors ${i <= progressIndex ? 'text-white' : ''}`}
                style={{
                  background: i <= progressIndex ? 'var(--accent)' : 'var(--bg-secondary)',
                  color: i <= progressIndex ? '#fff' : 'var(--text-muted)',
                  border: i <= progressIndex ? 'none' : '1px solid var(--border-card)',
                }}
              >
                {i + 1}
              </div>
              <span className={i <= progressIndex ? 't-primary font-medium' : ''}>{label}</span>
              {i < stepsForProgress.length - 1 && <span className="t-muted">·</span>}
            </div>
          ))}
        </div>
      )}

      {step === 'install' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-subtle)' }}>
              <Smartphone className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h3 className="text-sm font-semibold t-primary">Install an authenticator app</h3>
              <p className="text-xs t-muted mt-0.5">
                You&apos;ll need an authenticator app on your phone to generate time-based codes. Popular choices:
              </p>
            </div>
          </div>
          <ul className="text-xs t-secondary space-y-1 pl-4 list-disc">
            <li>Google Authenticator (iOS / Android)</li>
            <li>Microsoft Authenticator (iOS / Android)</li>
            <li>Authy (iOS / Android / desktop)</li>
            <li>1Password, Bitwarden, or any other TOTP-capable password manager</li>
          </ul>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex items-center justify-between pt-2">
            {onCancel ? (
              <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
            ) : <span />}
            <Button variant="primary" size="sm" onClick={beginSetup} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              I already have one <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {step === 'scan' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-subtle)' }}>
              <ScanLine className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h3 className="text-sm font-semibold t-primary">Scan this QR code</h3>
              <p className="text-xs t-muted mt-0.5">Open your authenticator app and scan the code, or add the secret manually.</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-5">
            <div className="flex-shrink-0 p-3 rounded-xl bg-white" style={{ minWidth: 240, minHeight: 240 }}>
              {qrSvg ? (
                <div
                  className="w-56 h-56 flex items-center justify-center"
                  // qrcode's SVG output is trusted — it only contains <svg>, <rect>, <path>
                  // (no user data injected beyond the otpauth URI we control).
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
              ) : qrError ? (
                <div className="w-56 h-56 flex flex-col items-center justify-center text-center px-2 text-gray-600">
                  <p className="text-xs">QR render failed — use the manual entry below.</p>
                </div>
              ) : (
                <div className="w-56 h-56 flex items-center justify-center">
                  <Loader2 size={24} className="animate-spin text-gray-400" />
                </div>
              )}
            </div>

            <div className="flex-1 space-y-3 w-full">
              <div>
                <p className="text-xs t-muted mb-1">Can&apos;t scan? Enter this key manually:</p>
                <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}>
                  <code className="text-xs font-mono t-primary flex-1 break-all tracking-wider select-all">{prettySecret || '—'}</code>
                  <button
                    type="button"
                    onClick={copySecret}
                    className="p-1.5 rounded hover:bg-[var(--bg-input)]"
                    title="Copy secret"
                    aria-label="Copy secret to clipboard"
                  >
                    {copiedSecret ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} className="t-muted" />}
                  </button>
                </div>
              </div>
              {otpauthUri && (
                <a
                  href={otpauthUri}
                  className="inline-flex items-center gap-1 text-xs font-medium"
                  style={{ color: 'var(--accent)' }}
                  title="Opens your authenticator app if installed"
                >
                  <ExternalLink size={12} /> Open in authenticator app
                </a>
              )}
              <p className="text-caption t-muted">Algorithm: TOTP · Digits: 6 · Period: 30s</p>
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" size="sm" onClick={() => setStep('install')}>
              <ArrowLeft size={14} /> Back
            </Button>
            <Button variant="primary" size="sm" onClick={() => { setStep('verify'); setError(null); }}>
              I&apos;ve added it <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {step === 'verify' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-subtle)' }}>
              <KeyRound className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h3 className="text-sm font-semibold t-primary">Enter the 6-digit code</h3>
              <p className="text-xs t-muted mt-0.5">Type the current code shown in your authenticator app to confirm enrollment.</p>
            </div>
          </div>

          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Six-digit verification code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6 && !loading) verify(); }}
            placeholder="000000"
            className="w-full px-3 py-3 text-center text-2xl font-mono tracking-[0.4em] rounded-lg outline-none"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
            maxLength={6}
            autoFocus
          />

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" size="sm" onClick={() => { setStep('scan'); setError(null); }}>
              <ArrowLeft size={14} /> Back
            </Button>
            <Button variant="primary" size="sm" onClick={verify} disabled={loading || code.length !== 6}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
              Verify &amp; enable
            </Button>
          </div>
        </div>
      )}

      {step === 'backup' && (
        <BackupCodesDisplay
          codes={backupCodes}
          heading="MFA enabled — here are your recovery codes"
          subheading="Store these somewhere safe. They're the only way back in if you lose your authenticator."
          onAcknowledge={() => { setStep('done'); onComplete(); }}
        />
      )}

      {step === 'done' && (
        <div className="p-4 rounded-xl flex items-start gap-3" style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
          <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold t-primary">Two-factor authentication enabled</p>
            <p className="text-xs t-muted mt-0.5">Your account is now protected. You&apos;ll be asked for a code from your authenticator the next time you sign in.</p>
          </div>
        </div>
      )}
    </div>
  );
}
