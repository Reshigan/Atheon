import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Building2, Loader2, ShieldCheck, UserPlus } from "lucide-react";
import { api, setToken, getToken, setTenantOverride, setRememberMe as setApiRememberMe } from "@/lib/api";
import type { IndustryVertical, UserRole } from "@/types";

type AuthMode= 'login' | 'register';

/**
 * The MFA challenge input accepts either a 6-digit TOTP or a backup code in xxxx-xxxx format.
 * Returns the parsed code (normalized) plus its format type, or null if invalid.
 */
function parseMfaInput(raw: string): { code: string; kind: 'totp' | 'backup' } | null {
  const trimmed = raw.trim();
  if (/^\d{6}$/.test(trimmed)) return { code: trimmed, kind: 'totp' };
  // Backup code: 4 alphanumeric + dash + 4 alphanumeric (case-insensitive).
  const backupMatch = trimmed.match(/^([a-zA-Z0-9]{4})-?([a-zA-Z0-9]{4})$/);
  if (backupMatch) return { code: `${backupMatch[1].toLowerCase()}-${backupMatch[2].toLowerCase()}`, kind: 'backup' };
  return null;
}

export function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Remember me" controls whether the auth token survives a browser close.
  // Default reads the existing preference (true on first visit for backwards
  // compatibility); toggling here writes through to api.setRememberMe BEFORE
  // setToken runs so the token lands in the right storage scope.
  const [rememberMe, setRememberMeState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('atheon_remember_me') !== 'false';
  });
  const [tenantOptions, setTenantOptions] = useState<{ slug: string; name: string }[] | null>(null);
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setUser = useAppStore((s) => s.setUser);
  const setIndustry = useAppStore((s) => s.setIndustry);
  const setActiveTenant = useAppStore((s) => s.setActiveTenant);
  const setMfaEnforcementWarning = useAppStore((s) => s.setMfaEnforcementWarning);
  const existingUser = useAppStore((s) => s.user);

  // MFA challenge state — shown after primary credentials succeed but before session is issued.
  const [mfaChallengeActive, setMfaChallengeActive] = useState(false);
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaInput, setMfaInput] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [backupCodesRemaining, setBackupCodesRemaining] = useState<number | null>(null);

  const handleAuthResult = (res: {
    token: string;
    refreshToken?: string;
    user: { id: string; email: string; name: string; role: string; tenantId: string; tenantName?: string; tenantIndustry?: string; permissions: string[] };
    mfaEnforcementWarning?: { daysRemaining: number; reason?: string; mfaSetupUrl?: string };
    backupCodesRemaining?: number;
  }) => {
    setToken(res.token, res.refreshToken || null);
    // Clear any stale tenant override from a previous session
    setTenantOverride(null);
    setActiveTenant(null, null, null);
    setUser({ id: res.user.id, email: res.user.email, name: res.user.name, role: res.user.role as UserRole, tenantId: res.user.tenantId, tenantName: res.user.tenantName, permissions: res.user.permissions });
    // Set industry from the user's tenant (default to 'general' if not provided)
    setIndustry((res.user.tenantIndustry || 'general') as IndustryVertical);
    // Persist MFA grace-period warning (if any) so the Dashboard / Settings pages can surface it.
    setMfaEnforcementWarning(res.mfaEnforcementWarning ?? null);
    // Role-aware landing — scoped read-only roles land on their own home
    // (auditor → /compliance, board_member → /board-digest); everyone
    // else gets the operational dashboard as before.
    const landing =
      res.user.role === 'auditor' ? '/compliance'
      : res.user.role === 'board_member' ? '/board-digest'
      : '/dashboard';
    navigate(landing);
  };

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    if (code && state) {
      setLoading(true);
      setError(null);
      api.auth.ssoCallback(code, state)
        .then((res) => handleAuthResult(res))
        .catch((err) => { setError(err instanceof Error ? err.message : 'SSO authentication failed'); window.history.replaceState({}, '', '/login'); })
        .finally(() => setLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase AY: SAML callback returns the user via a fragment token to keep
  // the secret out of server access logs. Persist the token, fetch the
  // user via /auth/me, then scrub the URL bar so reloads don't replay it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash.startsWith('#sso-token=')) return;
    const token = decodeURIComponent(hash.slice('#sso-token='.length));
    if (!token) return;
    setLoading(true);
    setToken(token, null);
    api.auth.me()
      .then((user) => {
        setTenantOverride(null);
        setActiveTenant(null, null, null);
        setUser({ id: user.id, email: user.email, name: user.name, role: user.role as UserRole, tenantId: user.tenantId, tenantName: user.tenantName, permissions: user.permissions });
        window.history.replaceState({}, '', window.location.pathname);
        const landing =
          user.role === 'auditor' ? '/compliance'
          : user.role === 'board_member' ? '/board-digest'
          : '/dashboard';
        navigate(landing);
      })
      .catch((err) => {
        setToken('', null);
        setError(err instanceof Error ? err.message : 'SAML login failed');
        window.history.replaceState({}, '', window.location.pathname);
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (existingUser && getToken()) {
      const landing =
        existingUser.role === 'auditor' ? '/compliance'
        : existingUser.role === 'board_member' ? '/board-digest'
        : '/dashboard';
      navigate(landing, { replace: true });
    }
  }, [existingUser, navigate]);

  useEffect(() => {
    const token = searchParams.get('token');
    if (token && window.location.pathname.startsWith('/reset-password')) {
      setResetToken(token);
      setShowResetPw(true);
      window.history.replaceState({}, '', '/reset-password');
    }
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === 'register') {
        if (!name.trim()) { setError('Name is required'); setLoading(false); return; }
        if (password.length < 10) { setError('Password must be at least 10 characters'); setLoading(false); return; }
        const res = await api.auth.register(email, password, name);
        handleAuthResult(res);
      } else {
        try {
          const res = await api.auth.login(email, password, selectedTenant || undefined);
          const mfaRequired = res.mfaRequired ?? res.mfa_required ?? false;
          if (mfaRequired) {
            // Session is not issued until the MFA challenge is satisfied.
            setMfaChallengeActive(true);
            setMfaChallengeToken(res.challengeToken ?? res.challenge_token ?? null);
            setMfaError(null);
            setLoading(false);
            return;
          }
          handleAuthResult(res);
        } catch (loginErr: unknown) {
          // Check if this is a tenant selection required response
          const errMsg = loginErr instanceof Error ? loginErr.message : '';
          if (errMsg.includes('Tenant selection required')) {
            // Re-fetch with raw fetch to get tenant list from response body
            const rawRes = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/auth/login`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password }),
            });
            const body = await rawRes.json() as { tenantSelectionRequired?: boolean; tenants?: { slug: string; name: string }[] };
            if (body.tenantSelectionRequired && body.tenants) {
              setTenantOptions(body.tenants);
              setError(null);
              setLoading(false);
              return;
            }
          }
          throw loginErr;
        }
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Authentication failed'); }
    finally { setLoading(false); }
  };

  const submitMfaChallenge = async () => {
    const parsed = parseMfaInput(mfaInput);
    if (!parsed) {
      setMfaError('Enter a 6-digit code or a backup code in xxxx-xxxx format');
      return;
    }
    setLoading(true);
    setMfaError(null);
    try {
      const res = await api.auth.mfaValidate(parsed.code, mfaChallengeToken ?? undefined);
      if (typeof res.backupCodesRemaining === 'number') {
        setBackupCodesRemaining(res.backupCodesRemaining);
      }
      handleAuthResult(res);
    } catch (err) {
      setMfaError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  const cancelMfaChallenge = () => {
    setMfaChallengeActive(false);
    setMfaChallengeToken(null);
    setMfaInput('');
    setMfaError(null);
    setBackupCodesRemaining(null);
  };

  const [showForgotPw, setShowForgotPw] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  // Password reset functionality - token parsed from URL params
  const [showResetPw, setShowResetPw] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetDone, setResetDone] = useState(false);

  const handleSSO = async (provider: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.auth.ssoAuthorize(provider === 'azure' ? 'azure_ad' : provider);
      if (res.redirect_url) { window.location.href = res.redirect_url; return; }
      setError('SSO configuration not available');
    } catch (err) { setError(err instanceof Error ? err.message : 'SSO login failed.'); }
    finally { setLoading(false); }
  };

  // Phase AY: WorkOS-brokered SAML. The user types their work email; we
  // look up their tenant's WorkOS Connection ID and redirect to WorkOS,
  // which then forwards to Okta / Azure AD / Ping / etc.
  const handleSamlSSO = async () => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      setError('Enter your work email above, then click SAML SSO.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.auth.samlStart(trimmed);
      if (res.authorizationUrl) {
        window.location.href = res.authorizationUrl;
        return;
      }
      setError('SAML configuration not available for this tenant.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SAML login failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!forgotEmail.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api.auth.forgotPassword(forgotEmail);
      setForgotSent(true);
    } catch (err) {
      console.error('Forgot password request failed:', err);
      // Security: Don't reveal if email exists, but inform user of technical issues
      setError('Unable to process your request at this time. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetToken) {
      setError('Reset token missing. Please request a new password reset link.');
      return;
    }
    if (resetNewPassword.length < 10) {
      setError('Password must be at least 10 characters');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await api.auth.resetPassword(resetToken, resetNewPassword);
      setResetDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 py-10"
      style={{
        background: 'var(--bg-primary)',
        backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(163, 177, 138, 0.06) 0%, transparent 70%)',
        backgroundAttachment: 'fixed',
      }}
    >
      <div className="w-full max-w-md">
        {/* Centered brand header — lifted from the Stitch Login screen.
            Replaces the previous 2-column brand-panel-left + form-right
            layout with a single centred stack that matches the design 1:1. */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 relative"
            style={{
              background: 'linear-gradient(135deg, #06090d, #0e151c)',
              boxShadow: '0 8px 32px rgba(163, 177, 138, 0.25), 0 0 0 1px rgba(163, 177, 138, 0.15)',
            }}
            aria-hidden="true"
          >
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <path d="M16 4L27 27H5L16 4Z" fill="none" stroke="#A3B18A" strokeWidth="1.5" />
              <line x1="9" y1="20" x2="23" y2="20" stroke="#A3B18A" strokeWidth=".8" opacity=".6" />
              <line x1="11.5" y1="14.5" x2="20.5" y2="14.5" stroke="#7EB3CD" strokeWidth=".8" opacity=".5" />
              <circle cx="16" cy="9" r="1.5" fill="#CDA37E" />
            </svg>
          </div>
          <h1 className="text-headline-xl font-bold t-primary tracking-tight leading-tight">Atheon AI</h1>
          <p className="text-caption t-muted uppercase tracking-widest mt-1">Enterprise Intelligence &amp; Provenance</p>
        </div>

        {/* Form card — single column, all sub-states render below the header */}
        <div
          className="w-full rounded-2xl p-6 sm:p-7"
          style={{
            background: 'var(--bg-card-solid)',
            border: '1px solid var(--border-card)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <h2 className="text-xl font-semibold t-primary mb-1">{mode === 'register' ? 'Create your account' : 'Welcome back'}</h2>
          <p className="text-xs t-muted mb-6">{mode === 'register' ? 'Register for your Atheon workspace' : 'Sign in to your Atheon workspace'}</p>
          {error && <div className="mb-4 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-500">{error}</div>}
          {mfaChallengeActive && (
            <div className="mb-5 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} style={{ color: 'var(--accent)' }} />
                <h3 className="text-sm font-semibold t-primary">Two-factor authentication</h3>
              </div>
              <p className="text-xs t-secondary">
                Enter the 6-digit code from your authenticator app, or a backup code in <code className="text-caption">xxxx-xxxx</code> format.
              </p>
              <input
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                aria-label="Authenticator code or backup code"
                value={mfaInput}
                onChange={(e) => setMfaInput(e.target.value.slice(0, 12))}
                onKeyDown={(e) => { if (e.key === 'Enter' && !loading) submitMfaChallenge(); }}
                placeholder="123456 or xxxx-xxxx"
                className="w-full px-3 py-2.5 rounded-lg text-center font-mono text-lg tracking-widest outline-none"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
                autoFocus
              />
              {mfaError && <p className="text-xs text-red-400">{mfaError}</p>}
              {backupCodesRemaining !== null && backupCodesRemaining < 3 && (
                <p className="text-caption text-amber-500">
                  You have {backupCodesRemaining} backup code{backupCodesRemaining === 1 ? '' : 's'} left. Consider regenerating them from Settings &rarr; MFA after you sign in.
                </p>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={cancelMfaChallenge} type="button">Back to sign in</Button>
                <Button variant="primary" size="sm" onClick={submitMfaChallenge} disabled={loading || parseMfaInput(mfaInput) === null} type="button">
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                  Verify
                </Button>
              </div>
            </div>
          )}
          {tenantOptions && !mfaChallengeActive && (
            <div className="mb-5 space-y-3">
              <p className="text-xs t-secondary">This email exists in multiple workspaces. Please select one:</p>
              <div className="space-y-2">
                {tenantOptions.map((t) => (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={async () => {
                      setSelectedTenant(t.slug);
                      setTenantOptions(null);
                      setLoading(true);
                      setError(null);
                      try {
                        const res = await api.auth.login(email, password, t.slug);
                        const mfaRequired = res.mfaRequired ?? res.mfa_required ?? false;
                        if (mfaRequired) {
                          setMfaChallengeActive(true);
                          setMfaChallengeToken(res.challengeToken ?? res.challenge_token ?? null);
                          setMfaError(null);
                          setLoading(false);
                          return;
                        }
                        handleAuthResult(res);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Authentication failed');
                      } finally {
                        setLoading(false);
                      }
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium t-secondary transition-all hover:bg-[var(--bg-secondary)]"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)' }}
                  >
                    <Building2 size={14} className="t-muted flex-shrink-0" />
                    <span className="t-primary">{t.name}</span>
                    <span className="t-muted ml-auto text-caption">{t.slug}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {selectedTenant && (
            <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent-border)' }}>
              <Building2 size={12} style={{ color: 'var(--accent)' }} />
              <span className="t-secondary">Workspace: <strong className="t-primary">{selectedTenant}</strong></span>
              <button type="button" onClick={() => setSelectedTenant(null)} className="ml-auto text-caption t-muted hover:t-primary">&times;</button>
            </div>
          )}
          {!tenantOptions && !mfaChallengeActive && mode === 'login' && (
            <div className="space-y-2 mb-5">
              <button onClick={() => handleSSO('azure')} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium t-secondary transition-all hover:bg-[var(--bg-secondary)]" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)' }}>
                <div className="w-4 h-4 rounded bg-sky-600 flex items-center justify-center text-[8px] font-bold text-white">M</div>Continue with Azure AD
              </button>
              {/* Phase AY: SAML SSO. Enabled when the tenant has set a
                  WorkOS connection_id; backend returns 404 + a clear
                  message if not configured. Requires the email field
                  filled so we can route to the right WorkOS connection. */}
              <button
                onClick={() => void handleSamlSSO()}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium t-secondary transition-all hover:bg-[var(--bg-secondary)]"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)' }}
                title="Use your organisation's SAML identity provider (Okta, Azure AD, Ping, etc.)"
              >
                <div className="w-4 h-4 rounded bg-emerald-600 flex items-center justify-center text-[8px] font-bold text-white">S</div>
                Continue with SAML SSO
                <span className="ml-auto text-[10px] t-muted">enter email first</span>
              </button>
            </div>
          )}
          {!tenantOptions && !mfaChallengeActive && mode === 'login' && (
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px" style={{ background: 'var(--divider)' }} /><span className="text-caption t-muted">or sign in with email</span><div className="flex-1 h-px" style={{ background: 'var(--divider)' }} />
            </div>
          )}
          {!tenantOptions && !mfaChallengeActive && <form onSubmit={handleLogin} className="space-y-3" data-testid="login-form">
            {mode === 'register' && <Input label="Full Name" type="text" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} data-testid="name" />}
            <Input label="Email" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="email" />
            <Input label="Password" type="password" placeholder={mode === 'register' ? 'Min 10 characters' : '••••••••'} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="password" />
            {mode === 'login' && (
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-caption t-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border-card)' }}
                    checked={rememberMe}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setRememberMeState(next);
                      // Persist preference immediately so it applies when
                      // setToken() runs after sign-in.
                      setApiRememberMe(next);
                    }}
                    data-testid="remember-me"
                  />
                  Remember me
                </label>
                <button type="button" onClick={() => setShowForgotPw(true)} className="text-caption font-medium" style={{ color: 'var(--accent)' }} data-testid="forgot-password">Forgot password?</button>
              </div>
            )}
            <Button variant="primary" size="md" className="w-full mt-1" type="submit" disabled={loading} data-testid="login-button">
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              {mode === 'register' ? <><UserPlus size={14} /> Create Account</> : <>Sign In <ArrowRight size={14} /></>}
            </Button>
          </form>}
          {/* Set-new-password modal — uses the canonical Modal primitive.
              `dismissible={!loading}` blocks ESC / backdrop / X while the
              reset POST is in flight so the user can't dismiss mid-submit. */}
          <Modal
            open={showResetPw}
            onClose={() => { setShowResetPw(false); setResetToken(null); setResetNewPassword(''); navigate('/login', { replace: true }); }}
            size="sm"
            dismissible={!loading}
          >
            <Modal.Header title="Set a new password" />
            <Modal.Body>
              {resetDone ? (
                <p className="text-body-sm t-secondary">
                  Your password has been reset. You can now sign in with your new password.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-caption t-muted">Enter a new password for your account.</p>
                  <input
                    className="w-full px-3 py-2 rounded-lg text-body"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
                    type="password"
                    placeholder="Min 10 characters"
                    value={resetNewPassword}
                    onChange={e => setResetNewPassword(e.target.value)}
                  />
                </div>
              )}
            </Modal.Body>
            <Modal.Footer>
              {resetDone ? (
                <Button variant="primary" size="sm" onClick={() => { setShowResetPw(false); setResetDone(false); setResetToken(null); setResetNewPassword(''); navigate('/login', { replace: true }); }}>
                  Back to Login
                </Button>
              ) : (
                <>
                  <Button variant="secondary" size="sm" onClick={() => { setShowResetPw(false); setResetToken(null); setResetNewPassword(''); navigate('/login', { replace: true }); }}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={handleResetPassword} disabled={loading || resetNewPassword.length < 10}>
                    {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                    Reset Password
                  </Button>
                </>
              )}
            </Modal.Footer>
          </Modal>

          {/* Forgot-password modal — same Modal pattern. */}
          <Modal
            open={showForgotPw}
            onClose={() => { setShowForgotPw(false); setForgotEmail(''); }}
            size="sm"
          >
            <Modal.Header title="Reset password" />
            <Modal.Body>
              {forgotSent ? (
                <p className="text-body-sm t-secondary">
                  If an account exists for <strong className="t-primary">{forgotEmail}</strong>, a reset link has been sent.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-caption t-muted">Enter your email and we will send you a reset link.</p>
                  <input
                    className="w-full px-3 py-2 rounded-lg text-body"
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
                    type="email"
                    placeholder="you@company.com"
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                  />
                </div>
              )}
            </Modal.Body>
            <Modal.Footer>
              {forgotSent ? (
                <Button variant="primary" size="sm" onClick={() => { setShowForgotPw(false); setForgotSent(false); setForgotEmail(''); }}>
                  Back to Login
                </Button>
              ) : (
                <>
                  <Button variant="secondary" size="sm" onClick={() => { setShowForgotPw(false); setForgotEmail(''); }}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={handleForgotPassword} disabled={!forgotEmail.trim()}>Send Reset Link</Button>
                </>
              )}
            </Modal.Footer>
          </Modal>
          <p className="text-caption t-muted text-center mt-6">
            {mode === 'login' ? <>Don&apos;t have an account? <button onClick={() => { setMode('register'); setError(null); }} className="font-medium" style={{ color: 'var(--accent)' }}>Create one</button></> : <>Already have an account? <button onClick={() => { setMode('login'); setError(null); }} className="font-medium" style={{ color: 'var(--accent)' }}>Sign in</button></>}
          </p>
          <p className="text-caption t-muted text-center mt-8">Protected by enterprise-grade security. &copy; {new Date().getFullYear()} Atheon</p>
          <p className="text-caption t-muted text-center mt-2">
            <a href="/status" className="hover:t-primary">Status</a>
            <span className="mx-2">·</span>
            <a href="/legal/security" className="hover:t-primary">Security &amp; Privacy</a>
            <span className="mx-2">·</span>
            <a href="/pricing" className="hover:t-primary">Pricing</a>
          </p>
        </div>
      </div>
    </div>
  );
}
