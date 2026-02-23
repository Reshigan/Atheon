import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/appStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, ArrowRight, Shield, Globe } from "lucide-react";

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const setUser = useAppStore((s) => s.setUser);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setUser({
      id: '1',
      email: email || 'admin@vantax.co.za',
      name: email ? email.split('@')[0] : 'Reshigan',
      role: 'admin',
      tenantId: 'vantax',
      permissions: ['*'],
    });
    navigate('/');
  };

  const handleSSO = (_provider: string) => {
    setUser({
      id: '1',
      email: 'admin@vantax.co.za',
      name: 'Reshigan',
      role: 'admin',
      tenantId: 'vantax',
      permissions: ['*'],
    });
    navigate('/');
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

          <h2 className="text-2xl font-bold text-white mb-1">Welcome back</h2>
          <p className="text-sm text-neutral-500 mb-8">Sign in to your Atheon workspace</p>

          {/* SSO Buttons */}
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

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-neutral-800" />
            <span className="text-xs text-neutral-600">or sign in with email</span>
            <div className="flex-1 h-px bg-neutral-800" />
          </div>

          {/* Email/Password Form */}
          <form onSubmit={handleLogin} className="space-y-4">
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
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-neutral-400">
                <input type="checkbox" className="rounded bg-neutral-800 border-neutral-700" />
                Remember me
              </label>
              <a href="#" className="text-xs text-indigo-400 hover:text-indigo-300">Forgot password?</a>
            </div>
            <Button variant="primary" size="lg" className="w-full" type="submit">
              Sign In <ArrowRight size={16} />
            </Button>
          </form>

          <p className="text-xs text-neutral-600 text-center mt-8">
            Don't have an account? <a href="#" className="text-indigo-400 hover:text-indigo-300">Request access</a>
          </p>
        </div>
      </div>
    </div>
  );
}
