import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Loader2, UserPlus } from "lucide-react";
import { api, setToken, getToken } from "@/lib/api";

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
      <div className="w-full max-w-5xl flex rounded-3xl overflow-hidden bg-glass-strong glow-cyan shadow-2xl shadow-cyan-500/10">
        {/* Left - Branding with 3D Capsule Hero */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-center items-center p-12 relative overflow-hidden">
          {/* Soft radial gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-sky-100/80 via-cyan-50/60 to-blue-100/70" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_center,rgba(56,189,248,0.2),transparent_60%)]" />

          <div className="relative z-10 text-center">
            {/* Large 3D Glossy Capsule Shape */}
            <div className="animate-float mb-10">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 260" fill="none" className="w-56 h-48 mx-auto" style={{ filter: 'drop-shadow(0 25px 50px rgba(14,165,233,0.3))' }}>
                <defs>
                  <linearGradient id="login-pill-1" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#7dd3fc" />
                    <stop offset="40%" stopColor="#38bdf8" />
                    <stop offset="100%" stopColor="#0ea5e9" />
                  </linearGradient>
                  <linearGradient id="login-pill-2" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#67e8f9" />
                    <stop offset="50%" stopColor="#22d3ee" />
                    <stop offset="100%" stopColor="#06b6d4" />
                  </linearGradient>
                  <linearGradient id="login-shine" x1="20%" y1="0%" x2="50%" y2="100%">
                    <stop offset="0%" stopColor="white" stopOpacity="0.95" />
                    <stop offset="40%" stopColor="white" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="white" stopOpacity="0" />
                  </linearGradient>
                  <filter id="login-glow">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>
                {/* Left capsule — larger */}
                <ellipse cx="110" cy="150" rx="52" ry="95" fill="url(#login-pill-1)" transform="rotate(-35 110 150)" filter="url(#login-glow)" />
                {/* Right capsule */}
                <ellipse cx="195" cy="140" rx="46" ry="88" fill="url(#login-pill-2)" transform="rotate(25 195 140)" filter="url(#login-glow)" />
                {/* Glass shine on left */}
                <ellipse cx="92" cy="118" rx="22" ry="48" fill="url(#login-shine)" transform="rotate(-35 92 118)" opacity="0.75" />
                {/* Glass shine on right */}
                <ellipse cx="180" cy="108" rx="18" ry="42" fill="url(#login-shine)" transform="rotate(25 180 108)" opacity="0.65" />
                {/* Bright highlights */}
                <circle cx="85" cy="92" r="8" fill="white" opacity="0.9" />
                <circle cx="85" cy="92" r="13" fill="white" opacity="0.2" />
                <circle cx="175" cy="85" r="6" fill="white" opacity="0.8" />
                <circle cx="175" cy="85" r="10" fill="white" opacity="0.15" />
                {/* Depth dots */}
                <circle cx="150" cy="190" r="4" fill="#7dd3fc" opacity="0.5" />
                <circle cx="165" cy="80" r="2.5" fill="white" opacity="0.6" />
                <circle cx="130" cy="100" r="3" fill="white" opacity="0.35" />
              </svg>
            </div>

            <h1 className="text-4xl font-bold text-gradient mb-3">Atheon</h1>
            <p className="text-lg text-gray-600 mb-2">Enterprise Intelligence Platform</p>
            <p className="text-sm text-gray-400/80 max-w-xs mx-auto leading-relaxed">
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
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 via-sky-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" className="w-5 h-5">
                  <path d="M32 12L16 48h8l2.5-6h11l2.5 6h8L32 12z" fill="white" opacity="0.95"/>
                  <path d="M27.5 38L32 22l4.5 16h-9z" fill="rgba(14,165,233,0.5)"/>
                  <circle cx="32" cy="16" r="2" fill="white" opacity="0.8"/>
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gradient">Atheon</h1>
            </div>

            <h2 className="text-2xl font-bold text-gray-800 mb-1">
              {mode === 'register' ? 'Create your account' : 'Welcome back'}
            </h2>
            <p className="text-sm text-gray-400 mb-8">
              {mode === 'register' ? 'Register for your Atheon workspace' : 'Sign in to your Atheon workspace'}
            </p>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-50/80 border border-red-200/50 text-sm text-red-700 backdrop-blur-sm">
                {error}
              </div>
            )}

            {/* SSO Buttons */}
            {mode === 'login' && (
              <div className="space-y-3 mb-6">
                <button
                  onClick={() => handleSSO('azure')}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/60 border border-white/70 text-sm text-gray-600 hover:bg-white/80 transition-all backdrop-blur-sm"
                >
                  <div className="w-5 h-5 rounded bg-sky-600 flex items-center justify-center text-[10px] font-bold text-white">M</div>
                  Continue with Azure AD
                </button>
              </div>
            )}

            {mode === 'login' && (
              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px bg-gray-200/50" />
                <span className="text-xs text-gray-400">or sign in with email</span>
                <div className="flex-1 h-px bg-gray-200/50" />
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
                    <input type="checkbox" className="rounded bg-white/60 border-gray-300" />
                    Remember me
                  </label>
                  <button type="button" onClick={() => setShowForgotPw(true)} className="text-xs text-cyan-600 hover:text-cyan-500">Forgot password?</button>
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
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
                <div className="bg-glass-strong rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4 space-y-4">
                  <h3 className="text-lg font-semibold text-gray-800">Reset Password</h3>
                  {forgotSent ? (
                    <div className="space-y-3">
                      <p className="text-sm text-gray-600">If an account exists for <strong>{forgotEmail}</strong>, a password reset link has been sent.</p>
                      <button onClick={() => { setShowForgotPw(false); setForgotSent(false); setForgotEmail(''); }} className="w-full px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm hover:opacity-90 transition-opacity">Back to Login</button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-gray-500">Enter your email address and we'll send you a reset link.</p>
                      <input className="w-full px-3 py-2 rounded-xl bg-white/60 border border-white/70 text-sm backdrop-blur-sm" type="email" placeholder="you@company.com" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} />
                      <div className="flex gap-3">
                        <button onClick={() => { setShowForgotPw(false); setForgotEmail(''); }} className="flex-1 px-4 py-2 rounded-xl bg-white/50 border border-white/60 text-sm text-gray-600 hover:bg-white/70 transition-all">Cancel</button>
                        <button onClick={handleForgotPassword} disabled={!forgotEmail.trim()} className="flex-1 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50">Send Reset Link</button>
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
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50/60 border border-emerald-200/50 text-sm text-emerald-700 hover:bg-emerald-100/70 transition-all disabled:opacity-50 backdrop-blur-sm"
              >
                Try Demo (No account needed)
              </button>
            </div>

            {/* Toggle mode */}
            <p className="text-xs text-gray-400 text-center mt-8">
              {mode === 'login' ? (
                <>Don&apos;t have an account?{' '}
                  <button onClick={() => { setMode('register'); setError(null); }} className="text-cyan-600 hover:text-cyan-500">
                    Create one
                  </button>
                </>
              ) : (
                <>Already have an account?{' '}
                  <button onClick={() => { setMode('login'); setError(null); }} className="text-cyan-600 hover:text-cyan-500">
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
