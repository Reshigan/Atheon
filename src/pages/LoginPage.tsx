import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, ArrowRight, Shield, Globe, Loader2, UserPlus } from "lucide-react";
import { api, setToken } from "@/lib/api";

type AuthMode = 'login' | 'register' | 'demo';

export function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const setUser = useAppStore((s) => s.setUser);

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
    } catch {
      // Fallback to local login if API is unavailable
      setUser({
        id: '1',
        email: 'admin@vantax.co.za',
        name: 'Reshigan',
        role: 'admin',
        tenantId: 'vantax',
        permissions: ['*'],
      });
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const handleSSO = async (_provider: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.auth.demoLogin('vantax', 'admin');
      handleAuthResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SSO login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex">
      {/* Left - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-indigo-950 via-neutral-950 to-violet-950 flex-col justify-center items-center p-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.15),transparent_70%)]" />
        <div className="relative z-10 text-center">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-indigo-500/30">
            <Sparkles className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-5xl font-bold text-gradient mb-4">Atheon</h1>
          <p className="text-xl text-neutral-400 mb-2">Enterprise Intelligence Platform</p>
          <p className="text-sm text-neutral-600 max-w-md">
            Multi-tenant AI platform connecting executive intelligence, process monitoring,
            and autonomous execution across your enterprise.
          </p>

          <div className="flex items-center gap-6 mt-12">
            {[
              { icon: Shield, label: 'RBAC/ABAC' },
              { icon: Globe, label: 'SaaS / On-Prem / Hybrid' },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex items-center gap-2 text-neutral-500">
                  <Icon size={16} />
                  <span className="text-xs">{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right - Login Form */}
      <div className="flex-1 flex flex-col justify-center items-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gradient">Atheon</h1>
          </div>

          <h2 className="text-2xl font-bold text-white mb-1">
            {mode === 'register' ? 'Create your account' : 'Welcome back'}
          </h2>
          <p className="text-sm text-neutral-500 mb-8">
            {mode === 'register' ? 'Register for your Atheon workspace' : 'Sign in to your Atheon workspace'}
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* SSO Buttons */}
          {mode === 'login' && (
            <div className="space-y-3 mb-6">
              <button
                onClick={() => handleSSO('azure')}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-neutral-900/60 border border-neutral-800/50 text-sm text-neutral-300 hover:bg-neutral-800/60 hover:border-neutral-700/50 transition-all"
              >
                <div className="w-5 h-5 rounded bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white">M</div>
                Continue with Azure AD
              </button>
              <button
                onClick={() => handleSSO('okta')}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-neutral-900/60 border border-neutral-800/50 text-sm text-neutral-300 hover:bg-neutral-800/60 hover:border-neutral-700/50 transition-all"
              >
                <div className="w-5 h-5 rounded bg-blue-500 flex items-center justify-center text-[10px] font-bold text-white">O</div>
                Continue with Okta
              </button>
            </div>
          )}

          {mode === 'login' && (
            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-neutral-800" />
              <span className="text-xs text-neutral-600">or sign in with email</span>
              <div className="flex-1 h-px bg-neutral-800" />
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
                <label className="flex items-center gap-2 text-xs text-neutral-400">
                  <input type="checkbox" className="rounded bg-neutral-800 border-neutral-700" />
                  Remember me
                </label>
                <a href="#" className="text-xs text-indigo-400 hover:text-indigo-300">Forgot password?</a>
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

          {/* Demo Login */}
          <div className="mt-4">
            <button
              onClick={handleDemoLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/30 transition-all disabled:opacity-50"
            >
              <Sparkles size={14} />
              Try Demo (No account needed)
            </button>
          </div>

          {/* Toggle mode */}
          <p className="text-xs text-neutral-600 text-center mt-8">
            {mode === 'login' ? (
              <>Don't have an account?{' '}
                <button onClick={() => { setMode('register'); setError(null); }} className="text-indigo-400 hover:text-indigo-300">
                  Create one
                </button>
              </>
            ) : (
              <>Already have an account?{' '}
                <button onClick={() => { setMode('login'); setError(null); }} className="text-indigo-400 hover:text-indigo-300">
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
