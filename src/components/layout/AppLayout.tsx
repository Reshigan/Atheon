import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { api, getToken, setToken } from "@/lib/api";
import { Loader2 } from "lucide-react";

export function AppLayout() {
  const { user, setUser } = useAppStore();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setChecking(false);
      navigate('/login', { replace: true });
      return;
    }
    if (user) {
      setChecking(false);
      return;
    }
    // Validate token and restore session
    api.auth.me()
      .then((me) => {
        setUser({
          id: me.id,
          email: me.email,
          name: me.name,
          role: me.role as 'admin' | 'executive' | 'manager' | 'analyst' | 'operator',
          tenantId: me.tenantId,
          permissions: me.permissions,
        });
      })
      .catch(() => {
        setToken(null);
        navigate('/login', { replace: true });
      })
      .finally(() => setChecking(false));
  }, [user, navigate, setUser]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-glass-strong rounded-2xl p-8 glow-cyan">
          <Loader2 className="w-8 h-8 text-cyan-600 animate-spin" />
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen relative">
      {/* Global 3D Capsule Background — visible on all pages */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden flex items-start justify-center" style={{ paddingTop: '8vh' }}>
        <div className="animate-float opacity-40">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 320" fill="none" className="w-[340px] h-[260px] lg:w-[420px] lg:h-[320px]" style={{ filter: 'drop-shadow(0 30px 60px rgba(14,165,233,0.2))' }}>
            <defs>
              <linearGradient id="bg-pill-1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#7dd3fc" />
                <stop offset="40%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#0ea5e9" />
              </linearGradient>
              <linearGradient id="bg-pill-2" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#67e8f9" />
                <stop offset="50%" stopColor="#22d3ee" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
              <linearGradient id="bg-shine" x1="0%" y1="0%" x2="50%" y2="100%">
                <stop offset="0%" stopColor="white" stopOpacity="0.9" />
                <stop offset="50%" stopColor="white" stopOpacity="0.3" />
                <stop offset="100%" stopColor="white" stopOpacity="0" />
              </linearGradient>
              <filter id="bg-glow">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            {/* Left capsule */}
            <ellipse cx="155" cy="180" rx="58" ry="105" fill="url(#bg-pill-1)" transform="rotate(-35 155 180)" filter="url(#bg-glow)" />
            {/* Right capsule */}
            <ellipse cx="265" cy="165" rx="52" ry="98" fill="url(#bg-pill-2)" transform="rotate(25 265 165)" filter="url(#bg-glow)" />
            {/* Glass shine on left */}
            <ellipse cx="135" cy="145" rx="24" ry="52" fill="url(#bg-shine)" transform="rotate(-35 135 145)" opacity="0.7" />
            {/* Glass shine on right */}
            <ellipse cx="248" cy="130" rx="20" ry="45" fill="url(#bg-shine)" transform="rotate(25 248 130)" opacity="0.6" />
            {/* Highlight dots */}
            <circle cx="128" cy="112" r="8" fill="white" opacity="0.85" />
            <circle cx="128" cy="112" r="13" fill="white" opacity="0.2" />
            <circle cx="242" cy="105" r="7" fill="white" opacity="0.75" />
            <circle cx="242" cy="105" r="11" fill="white" opacity="0.15" />
            {/* Depth dots */}
            <circle cx="205" cy="220" r="4" fill="#7dd3fc" opacity="0.5" />
            <circle cx="225" cy="95" r="3" fill="white" opacity="0.6" />
            <circle cx="180" cy="125" r="3.5" fill="white" opacity="0.4" />
          </svg>
        </div>
      </div>

      <Sidebar />
      <Header />
      <main
        className={cn(
          'pt-16 min-h-screen transition-all duration-300 relative z-10',
          'pl-0 lg:pl-16'
        )}
      >
        <div className="p-4 sm:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
