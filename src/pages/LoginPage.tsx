import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Loader2, UserPlus } from "lucide-react";
import { api, setToken, getToken } from "@/lib/api";
import { Hero3D, AtheonCrystalIcon } from "@/components/common/Hero3D";

type AuthMode = 'login' | 'register' | 'demo';

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

  const handleAuthResult = (res: { token: string; user: { id: string; email: string; name: string; role: string; tenantId: string; permissions: string[] } }) => {
    setToken(res.token);
    setUser({
      id: res.user.id,
      email: res.user.email,
      name: res.user.name,
      role: res.user.role as 'admin' | 'executive' | 'manager' | 'analyst' | 'operator',
      tenantId: res.user.tenantId,
      permissions: res.user.permissions,
    });
    navigate('/');
  };

  // Handle SSO callback (Azure AD redirects back with ?code=...&state=...)
  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    if (code && state) {
      setLoading(true);
      setError(null);
      api.auth.ssoCallback(code, state)
        .then((res) => handleAuthResult(res))
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'SSO authentication failed');
          // Clean up URL params
          window.history.replaceState({}, '', '/login');
        })
        .finally(() => setLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (existingUser && getToken()) {
      navigate('/', { replace: true });
    }
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.auth.demoLogin('vantax', 'admin');
      handleAuthResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const [showForgotPw, setShowForgotPw] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  const handleSSO = async (provider: string) => {
    setLoading(true);
    setError(null);
    try {
      // Request the Azure AD authorize URL from backend
      const res = await api.auth.ssoAuthorize(provider === 'azure' ? 'azure_ad' : provider);
      if (res.redirect_url) {
        // Redirect to Azure AD login page
        window.location.href = res.redirect_url;
        return;
      }
      setError('SSO configuration not available');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SSO login failed. Ensure SSO is configured in IAM settings.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!forgotEmail.trim()) return;
    try {
      await api.auth.forgotPassword(forgotEmail);
    } catch {
      // Don't reveal errors — always show success
    }
    setForgotSent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-5xl flex rounded-3xl overflow-hidden shadow-2xl shadow-amber-500/10" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(24px)' }}>
        {/* Left - Branding with 3D Capsule Hero */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-center items-center p-12 relative overflow-hidden">
          {/* Dark gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a1a] via-[#0d1025] to-[#0a0a1a]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_center,rgba(34,211,238,0.12),transparent_60%)]" />

          <div className="relative z-10 text-center">
            {/* Advanced 3D Crystal Hero */}
            <div className="mb-6 flex justify-center">
              <Hero3D size="md" />
            </div>

            <h1 className="text-4xl font-bold text-gradient mb-3">Atheon</h1>
            <p className="text-lg text-gray-400 mb-2">Enterprise Intelligence Platform</p>
            <p className="text-sm text-gray-500 max-w-xs mx-auto leading-relaxed">
              AI-powered executive intelligence, process monitoring,
              and autonomous execution.
            </p>
          </div>
        </div>

        {/* Right - Login Form */}
        <div className="flex-1 flex flex-col justify-center items-center p-8 sm:p-12">
          <div className="w-full max-w-sm">
            {/* Mobile Logo */}
            <div className="lg:hidden flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center shadow-lg shadow-amber-500/10">
                <AtheonCrystalIcon size={32} />
              </div>
              <h1 className="text-2xl font-bold text-gradient">Atheon</h1>
            </div>

            <h2 className="text-2xl font-bold text-white mb-1">
              {mode === 'register' ? 'Create your account' : 'Welcome back'}
            </h2>
            <p className="text-sm text-gray-500 mb-8">
              {mode === 'register' ? 'Register for your Atheon workspace' : 'Sign in to your Atheon workspace'}
            </p>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/100/10 border border-red-500/20 text-sm text-red-400 backdrop-blur-sm">
                {error}
              </div>
            )}

            {/* SSO Buttons */}
            {mode === 'login' && (
              <div className="space-y-3 mb-6">
                <button
                  onClick={() => handleSSO('azure')}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-gray-300 hover:bg-white/[0.08] transition-all backdrop-blur-sm"
                >
                  <div className="w-5 h-5 rounded bg-sky-600 flex items-center justify-center text-[10px] font-bold text-white">M</div>
                  Continue with Azure AD
                </button>
              </div>
            )}

            {mode === 'login' && (
              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="text-xs text-gray-500">or sign in with email</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>
            )}

            {/* Email/Password Form */}
            <form onSubmit={handleLogin} className="space-y-4">
              {mode === 'register' && (
                <Input
                  label="Full Name"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
              <Input
                label="Email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Input
                label="Password"
                type="password"
                placeholder={mode === 'register' ? 'Min 8 characters' : '••••••••'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode === 'login' && (
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-gray-500">
                    <input type="checkbox" className="rounded bg-white/[0.04] border-white/[0.08]" />
                    Remember me
                  </label>
                  <button type="button" onClick={() => setShowForgotPw(true)} className="text-xs text-amber-400 hover:text-amber-300">Forgot password?</button>
                </div>
              )}
              <Button variant="primary" size="lg" className="w-full" type="submit" disabled={loading}>
                {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                {mode === 'register' ? (
                  <><UserPlus size={16} /> Create Account</>
                ) : (
                  <>Sign In <ArrowRight size={16} /></>
                )}
              </Button>
            </form>

            {/* Forgot Password Modal */}
            {showForgotPw && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                <div className="rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4 max-h-[90vh] overflow-y-auto" style={{ background: 'rgba(18,18,42,0.95)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <h3 className="text-lg font-semibold text-white">Reset Password</h3>
                  {forgotSent ? (
                    <div className="space-y-3">
                      <p className="text-sm text-gray-400">If an account exists for <strong className="text-gray-200">{forgotEmail}</strong>, a password reset link has been sent.</p>
                      <button onClick={() => { setShowForgotPw(false); setForgotSent(false); setForgotEmail(''); }} className="w-full px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-sm hover:opacity-90 transition-opacity">Back to Login</button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-gray-500">Enter your email address and we'll send you a reset link.</p>
                      <input className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-gray-100 placeholder-gray-500 backdrop-blur-sm" type="email" placeholder="you@company.com" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} />
                      <div className="flex gap-3">
                        <button onClick={() => { setShowForgotPw(false); setForgotEmail(''); }} className="flex-1 px-4 py-2 rounded-xl bg-white/[0.06] border border-white/[0.08] text-sm text-gray-400 hover:bg-white/[0.1] transition-all">Cancel</button>
                        <button onClick={handleForgotPassword} disabled={!forgotEmail.trim()} className="flex-1 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50">Send Reset Link</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Demo Login */}
            <div className="mt-4">
              <button
                onClick={handleDemoLogin}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/100/10 border border-emerald-500/20 text-sm text-emerald-400 hover:bg-emerald-500/100/15 transition-all disabled:opacity-50 backdrop-blur-sm"
              >
                Try Demo (No account needed)
              </button>
            </div>

            {/* Toggle mode */}
            <p className="text-xs text-gray-500 text-center mt-8">
              {mode === 'login' ? (
                <>Don&apos;t have an account?{' '}
                  <button onClick={() => { setMode('register'); setError(null); }} className="text-amber-400 hover:text-amber-300">
                    Create one
                  </button>
                </>
              ) : (
                <>Already have an account?{' '}
                  <button onClick={() => { setMode('login'); setError(null); }} className="text-amber-400 hover:text-amber-300">
                    Sign in
                  </button>
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
