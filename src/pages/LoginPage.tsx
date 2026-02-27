import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Loader2, UserPlus } from "lucide-react";
import { api, setToken, getToken } from "@/lib/api";

type AuthMode= 'login' | 'register';

export function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setUser = useAppStore((s) => s.setUser);
  const existingUser = useAppStore((s) => s.user);

  const handleAuthResult = (res: { token: string; user: { id: string; email: string; name: string; role: string; tenantId: string; tenantName?: string; permissions: string[] } }) => {
    setToken(res.token);
    setUser({ id: res.user.id, email: res.user.email, name: res.user.name, role: res.user.role as 'admin' | 'executive' | 'manager' | 'analyst' | 'operator', tenantId: res.user.tenantId, tenantName: res.user.tenantName, permissions: res.user.permissions });
    navigate('/dashboard');
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

  useEffect(() => {
    if (existingUser && getToken()) navigate('/dashboard', { replace: true });
  }, [existingUser, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === 'register') {
        if (!name.trim()) { setError('Name is required'); setLoading(false); return; }
        if (password.length < 8) { setError('Password must be at least 8 characters'); setLoading(false); return; }
        const res = await api.auth.register(email, password, name);
        handleAuthResult(res);
      } else {
        const res = await api.auth.login(email, password);
        handleAuthResult(res);
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Authentication failed'); }
    finally { setLoading(false); }
  };

  const [showForgotPw, setShowForgotPw] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

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

  const handleForgotPassword = async () => {
    if (!forgotEmail.trim()) return;
    try { await api.auth.forgotPassword(forgotEmail); } catch { /* silent */ }
    setForgotSent(true);
  };

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg-primary)', backgroundImage: 'var(--bg-pattern)', backgroundAttachment: 'fixed' }}>
      <div className="hidden lg:flex lg:w-[45%] flex-col justify-center items-center p-12 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #06090d 0%, #0a0f14 50%, #0e151c 100%)' }}>
        <div className="absolute inset-0 opacity-40" style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(74, 107, 90, 0.12), transparent 70%)' }} />
        <div className="relative z-10 text-center max-w-sm">
          <div className="mb-8 flex justify-center">
            <div className="w-24 h-24 rounded-2xl flex items-center justify-center relative" style={{ background: 'linear-gradient(135deg, #06090d, #0e151c)', boxShadow: '0 12px 40px rgba(74, 107, 90, 0.25), 0 0 0 1px rgba(74, 107, 90, 0.15)' }}>
              <div className="absolute inset-0 rounded-2xl" style={{ background: 'radial-gradient(ellipse at 50% 30%, rgba(74, 107, 90, 0.10) 0%, transparent 60%)' }} />
              <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
                <path d="M16 4L27 27H5L16 4Z" fill="none" stroke="#4A6B5A" strokeWidth="1.5" />
                <line x1="9" y1="20" x2="23" y2="20" stroke="#4A6B5A" strokeWidth=".8" opacity=".6" />
                <line x1="11.5" y1="14.5" x2="20.5" y2="14.5" stroke="#7AACB5" strokeWidth=".8" opacity=".5" />
                <circle cx="16" cy="9" r="1.5" fill="#c9a059" />
              </svg>
            </div>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tighter mb-3" style={{ color: '#e8e4dc', fontFamily: 'Instrument Serif, serif' }}>Atheon</h1>
          <p className="text-sm mb-2" style={{ color: '#c4bfb4' }}>Enterprise Intelligence Platform</p>
          <p className="text-xs leading-relaxed max-w-xs mx-auto" style={{ color: '#586573' }}>AI-powered executive intelligence, autonomous process monitoring, and intelligent execution across your entire enterprise.</p>
          <div className="mt-10 space-y-2.5 text-left max-w-xs mx-auto">
            {['Real-time executive health scoring', 'Autonomous catalyst execution', 'Multi-tenant SaaS architecture', 'Universal ERP integration layer'].map((f) => (
              <div key={f} className="flex items-center gap-2.5 text-xs" style={{ color: '#586573' }}><div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#4A6B5A' }} />{f}</div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col justify-center items-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #06090d, #0e151c)', boxShadow: '0 4px 16px rgba(74, 107, 90, 0.25)' }}>
              <svg width="18" height="18" viewBox="0 0 32 32" fill="none"><path d="M16 4L27 27H5L16 4Z" fill="none" stroke="#4A6B5A" strokeWidth="1.5"/><line x1="9" y1="20" x2="23" y2="20" stroke="#4A6B5A" strokeWidth=".8" opacity=".6"/><circle cx="16" cy="9" r="1.5" fill="#c9a059"/></svg>
            </div>
            <div><h1 className="text-xl font-extrabold tracking-tighter t-primary" style={{ fontFamily: 'Instrument Serif, serif' }}>Atheon</h1><p className="text-[9px] t-muted font-medium tracking-wide uppercase">Enterprise Intelligence</p></div>
          </div>
          <h2 className="text-xl font-semibold t-primary mb-1">{mode === 'register' ? 'Create your account' : 'Welcome back'}</h2>
          <p className="text-xs t-muted mb-6">{mode === 'register' ? 'Register for your Atheon workspace' : 'Sign in to your Atheon workspace'}</p>
          {error && <div className="mb-4 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-500">{error}</div>}
          {mode === 'login' && (
            <div className="space-y-2 mb-5">
              <button onClick={() => handleSSO('azure')} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium t-secondary transition-all hover:bg-[var(--bg-secondary)]" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)' }}>
                <div className="w-4 h-4 rounded bg-sky-600 flex items-center justify-center text-[8px] font-bold text-white">M</div>Continue with Azure AD
              </button>
            </div>
          )}
          {mode === 'login' && (
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px" style={{ background: 'var(--divider)' }} /><span className="text-[10px] t-muted">or sign in with email</span><div className="flex-1 h-px" style={{ background: 'var(--divider)' }} />
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-3">
            {mode === 'register' && <Input label="Full Name" type="text" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />}
            <Input label="Email" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input label="Password" type="password" placeholder={mode === 'register' ? 'Min 8 characters' : '••••••••'} value={password} onChange={(e) => setPassword(e.target.value)} />
            {mode === 'login' && (
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-[10px] t-muted"><input type="checkbox" className="rounded" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-card)' }} />Remember me</label>
                <button type="button" onClick={() => setShowForgotPw(true)} className="text-[10px] font-medium" style={{ color: 'var(--accent)' }}>Forgot password?</button>
              </div>
            )}
            <Button variant="primary" size="md" className="w-full mt-1" type="submit" disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              {mode === 'register' ? <><UserPlus size={14} /> Create Account</> : <>Sign In <ArrowRight size={14} /></>}
            </Button>
          </form>
          {showForgotPw && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
              <div className="rounded-xl p-5 w-full max-w-sm space-y-3" style={{ background: 'var(--bg-modal)', border: '1px solid var(--border-card)', boxShadow: 'var(--shadow-modal)' }}>
                <h3 className="text-sm font-semibold t-primary">Reset Password</h3>
                {forgotSent ? (
                  <div className="space-y-3"><p className="text-xs t-secondary">If an account exists for <strong className="t-primary">{forgotEmail}</strong>, a reset link has been sent.</p><Button variant="primary" size="sm" className="w-full" onClick={() => { setShowForgotPw(false); setForgotSent(false); setForgotEmail(''); }}>Back to Login</Button></div>
                ) : (
                  <div className="space-y-3"><p className="text-xs t-muted">Enter your email and we will send you a reset link.</p><input className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }} type="email" placeholder="you@company.com" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} /><div className="flex gap-2"><Button variant="secondary" size="sm" className="flex-1" onClick={() => { setShowForgotPw(false); setForgotEmail(''); }}>Cancel</Button><Button variant="primary" size="sm" className="flex-1" onClick={handleForgotPassword} disabled={!forgotEmail.trim()}>Send Reset Link</Button></div></div>
                )}
              </div>
            </div>
          )}
          <p className="text-[10px] t-muted text-center mt-6">
            {mode === 'login' ? <>Don&apos;t have an account? <button onClick={() => { setMode('register'); setError(null); }} className="font-medium" style={{ color: 'var(--accent)' }}>Create one</button></> : <>Already have an account? <button onClick={() => { setMode('login'); setError(null); }} className="font-medium" style={{ color: 'var(--accent)' }}>Sign in</button></>}
          </p>
          <p className="text-[9px] t-muted text-center mt-8">Protected by enterprise-grade security. &copy; {new Date().getFullYear()} Atheon</p>
        </div>
      </div>
    </div>
  );
}
