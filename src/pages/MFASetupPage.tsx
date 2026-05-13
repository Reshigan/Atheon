/**
 * MFASetupPage — dedicated route (/settings/mfa) that hosts the enrollment wizard + management UI.
 *
 * The page consolidates:
 *  - Current MFA status (enabled/disabled, backup codes remaining).
 *  - Enrollment wizard (when disabled).
 *  - Backup-code regeneration (requires fresh TOTP).
 *  - Disable MFA (requires fresh TOTP, with a warning for admin roles under enforcement).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { HeroHeader } from '@/components/ui/hero-header';
import { Shield, Loader2, RefreshCw, XCircle, ArrowLeft, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { MFAEnrollmentWizard } from '@/components/MFAEnrollmentWizard';
import { BackupCodesDisplay } from '@/components/BackupCodesDisplay';

const ADMIN_ROLES = new Set(['superadmin', 'support_admin', 'admin']);

export function MFASetupPage() {
  const user = useAppStore((s) => s.user);
  const mfaEnforcementWarning = useAppStore((s) => s.mfaEnforcementWarning);
  const setMfaEnforcementWarning = useAppStore((s) => s.setMfaEnforcementWarning);
  const navigate = useNavigate();

  const [status, setStatus] = useState<{ enabled: boolean; backupCodesRemaining?: number } | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  // Regenerate backup codes flow
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCode, setRegenCode] = useState('');
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);

  // Disable MFA flow
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableLoading, setDisableLoading] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);

  const isAdminRole = useMemo(() => (user?.role ? ADMIN_ROLES.has(user.role) : false), [user?.role]);
  const graceExpired = isAdminRole && mfaEnforcementWarning && mfaEnforcementWarning.daysRemaining <= 0;

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await api.auth.mfaStatus();
      setStatus({ enabled: !!res.enabled, backupCodesRemaining: res.backupCodesRemaining });
      // Once MFA is enabled, clear any grace-period warning.
      if (res.enabled && mfaEnforcementWarning) setMfaEnforcementWarning(null);
    } catch {
      // Status endpoint may not exist in all deployments — gracefully fall back to "unknown".
      setStatus({ enabled: false });
    } finally {
      setStatusLoading(false);
    }
  // mfaEnforcementWarning/setter intentionally stable via zustand — include to satisfy lint but they don't change identity.
  }, [mfaEnforcementWarning, setMfaEnforcementWarning]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleWizardComplete = () => {
    setShowWizard(false);
    setMfaEnforcementWarning(null);
    loadStatus();
  };

  const handleRegenerate = async () => {
    if (regenCode.length !== 6) { setRegenError('Enter the 6-digit code from your authenticator'); return; }
    setRegenLoading(true);
    setRegenError(null);
    try {
      const res = await api.auth.mfaRegenerateBackupCodes(regenCode);
      const codes = res.backupCodes || res.backup_codes || [];
      if (codes.length === 0) {
        setRegenError('Server did not return new codes — please try again.');
      } else {
        setNewBackupCodes(codes);
        setRegenOpen(false);
        setRegenCode('');
      }
    } catch (err) {
      setRegenError(err instanceof Error ? err.message : 'Failed to regenerate codes');
    } finally {
      setRegenLoading(false);
    }
  };

  const handleDisable = async () => {
    if (disableCode.length !== 6) { setDisableError('Enter the 6-digit code from your authenticator'); return; }
    setDisableLoading(true);
    setDisableError(null);
    try {
      await api.auth.mfaDisable(disableCode);
      setDisableOpen(false);
      setDisableCode('');
      loadStatus();
    } catch (err) {
      setDisableError(err instanceof Error ? err.message : 'Failed to disable MFA');
    } finally {
      setDisableLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-3xl">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="w-8 h-8 rounded-lg flex items-center justify-center t-muted hover:t-primary transition-all"
          style={{ background: 'var(--bg-secondary)' }}
          title="Back to settings"
          aria-label="Back to settings"
        >
          <ArrowLeft size={14} />
        </button>
        <HeroHeader
          icon={Shield}
          title="Two-Factor Authentication"
          subtitle="Manage MFA & recovery codes for your account"
          accent="sage"
        />
      </div>

      {mfaEnforcementWarning && !status?.enabled && (
        <div
          role="alert"
          className="flex items-start gap-3 p-4 rounded-xl border"
          style={{
            background: graceExpired ? 'rgba(239, 68, 68, 0.08)' : 'rgba(245, 158, 11, 0.08)',
            borderColor: graceExpired ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.35)',
          }}
        >
          <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${graceExpired ? 'text-red-500' : 'text-amber-500'}`} />
          <div className="flex-1">
            <p className={`text-sm font-semibold ${graceExpired ? 'text-red-500' : 'text-amber-500'}`}>
              {graceExpired ? 'MFA is now required for your role' : `MFA required — ${mfaEnforcementWarning.daysRemaining} day${mfaEnforcementWarning.daysRemaining === 1 ? '' : 's'} remaining`}
            </p>
            <p className="text-xs t-secondary mt-0.5">
              {mfaEnforcementWarning.reason || `Your role requires two-factor authentication. Enable it ${graceExpired ? 'now to retain access.' : 'within the grace period to avoid losing access.'}`}
            </p>
          </div>
        </div>
      )}

      <Card>
        <h3 className="text-base font-semibold t-primary mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-accent" /> Status
        </h3>

        {statusLoading ? (
          <div className="flex items-center gap-2 text-xs t-muted"><Loader2 size={14} className="animate-spin" /> Loading status...</div>
        ) : status?.enabled ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
              <Shield className="w-5 h-5 text-emerald-500" />
              <div className="flex-1">
                <p className="text-sm font-medium text-emerald-500">MFA enabled</p>
                <p className="text-xs t-muted">Your account is protected with TOTP two-factor authentication.</p>
              </div>
              <Badge variant="success" size="sm">Active</Badge>
            </div>

            {typeof status.backupCodesRemaining === 'number' && (
              <div
                className="flex items-center justify-between gap-3 p-3 rounded-lg"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)' }}
              >
                <div>
                  <p className="text-sm t-primary">Recovery codes remaining</p>
                  <p className="text-xs t-muted">
                    {status.backupCodesRemaining} of 8 unused
                    {status.backupCodesRemaining < 3 && (
                      <span className="text-amber-500"> — consider regenerating soon</span>
                    )}
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setRegenOpen(true)} title="Regenerate recovery codes (invalidates old ones)">
                  <RefreshCw size={14} /> Regenerate
                </Button>
              </div>
            )}

            <div className="pt-2" style={{ borderTop: '1px solid var(--divider)' }}>
              <div className="flex items-center justify-between gap-3 mt-4">
                <div>
                  <p className="text-sm t-primary">Disable MFA</p>
                  <p className="text-xs t-muted">Remove two-factor authentication from your account.</p>
                </div>
                <Button variant="danger" size="sm" onClick={() => setDisableOpen(true)} title="Disable two-factor authentication">
                  <XCircle size={14} /> Disable
                </Button>
              </div>
              {isAdminRole && (
                <p className="text-caption text-amber-500 mt-2 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                  <span>
                    Your role requires MFA. Disabling it may revoke your access once the enforcement grace period expires.
                  </span>
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)' }}>
              <Shield className="w-5 h-5 t-muted" />
              <div className="flex-1">
                <p className="text-sm t-primary">MFA not enabled</p>
                <p className="text-xs t-muted">Add an extra layer of protection by enabling TOTP two-factor authentication.</p>
              </div>
              <Badge variant="warning" size="sm">Disabled</Badge>
            </div>
            {statusError && <p className="text-xs text-red-400">{statusError}</p>}
            {!showWizard && (
              <Button variant="primary" size="sm" onClick={() => setShowWizard(true)} title="Start MFA enrollment">
                <Shield size={14} /> Enable MFA
              </Button>
            )}
          </div>
        )}
      </Card>

      {showWizard && !status?.enabled && (
        <Card>
          <MFAEnrollmentWizard onComplete={handleWizardComplete} onCancel={() => setShowWizard(false)} />
        </Card>
      )}

      <div className="text-xs t-muted">
        Back to <Link to="/settings" className="font-medium" style={{ color: 'var(--accent)' }}>Settings</Link>
      </div>

      {/* Regenerate backup codes — uses canonical Modal primitive. */}
      <Modal
        open={regenOpen}
        onClose={() => { setRegenOpen(false); setRegenCode(''); setRegenError(null); }}
        size="sm"
        dismissible={!regenLoading}
      >
        <Modal.Header
          title={<><RefreshCw size={14} className="inline mr-2" />Regenerate recovery codes</>}
        />
        <Modal.Body>
          <p className="text-caption t-muted mb-3">
            Enter the current 6-digit code from your authenticator. Your existing recovery codes will be
            <strong> invalidated</strong> immediately and replaced with 8 new ones.
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-full px-3 py-2.5 rounded-lg text-center font-mono text-lg tracking-widest outline-none"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
            value={regenCode}
            onChange={(e) => setRegenCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            aria-label="Six-digit authenticator code"
            autoFocus
          />
          {regenError && <p className="text-caption text-red-400 mt-2">{regenError}</p>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" size="sm" onClick={() => { setRegenOpen(false); setRegenCode(''); setRegenError(null); }}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleRegenerate} disabled={regenLoading || regenCode.length !== 6}>
            {regenLoading ? <Loader2 size={14} className="animate-spin mr-1" /> : <RefreshCw size={14} className="mr-1" />}
            Regenerate
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Shown-once recovery codes — wider (lg) so the code grid breathes. */}
      <Modal
        open={!!newBackupCodes}
        onClose={() => { setNewBackupCodes(null); loadStatus(); }}
        size="lg"
      >
        <Modal.Body>
          {newBackupCodes && (
            <BackupCodesDisplay
              codes={newBackupCodes}
              heading="New recovery codes"
              subheading="Your previous recovery codes have been invalidated. Save these new codes now."
              onAcknowledge={() => { setNewBackupCodes(null); loadStatus(); }}
            />
          )}
        </Modal.Body>
      </Modal>

      {/* Disable MFA — destructive; the Modal handles ESC/backdrop blocking
          via dismissible={!disableLoading} while the API call is in flight. */}
      <Modal
        open={disableOpen}
        onClose={() => { setDisableOpen(false); setDisableCode(''); setDisableError(null); }}
        size="sm"
        dismissible={!disableLoading}
      >
        <Modal.Header
          title={<><XCircle size={14} className="inline mr-2 text-red-500" />Disable two-factor authentication</>}
        />
        <Modal.Body>
          {isAdminRole && (
            <div className="flex items-start gap-2 p-2 rounded-lg mb-3" style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.30)' }}>
              <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-caption text-amber-500">
                Your role <strong>{user?.role}</strong> requires MFA under the platform policy. Disabling it may lock you
                out once the enforcement grace period expires.
              </p>
            </div>
          )}
          <p className="text-caption t-muted mb-3">Confirm by entering the current 6-digit code from your authenticator.</p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-full px-3 py-2.5 rounded-lg text-center font-mono text-lg tracking-widest outline-none"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            aria-label="Six-digit authenticator code"
            autoFocus
          />
          {disableError && <p className="text-caption text-red-400 mt-2">{disableError}</p>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" size="sm" onClick={() => { setDisableOpen(false); setDisableCode(''); setDisableError(null); }}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={handleDisable} disabled={disableLoading || disableCode.length !== 6}>
            {disableLoading ? <Loader2 size={14} className="animate-spin mr-1" /> : <XCircle size={14} className="mr-1" />}
            Confirm disable
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
