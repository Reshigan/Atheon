import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { OnboardingModal } from "@/components/common/OnboardingModal";
import { HelpButton } from "@/components/common/HelpButton";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { api, getToken, setToken } from "@/lib/api";
import { Loader2 } from "lucide-react";
import { Hero3D } from "@/components/common/Hero3D";

export function AppLayout() {
  const { user, setUser, theme, onboardingDismissed } = useAppStore();
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
          tenantName: me.tenantName,
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
        <div className="card-dark rounded-2xl p-8">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className={cn('min-h-screen relative transition-colors duration-300', theme === 'dark' ? 'atheon-dark' : '')}>
      {/* Global 3D Crystal Background */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden flex items-start justify-center" style={{ paddingTop: '4vh' }}>
        <div style={{ opacity: theme === 'dark' ? 0.3 : 0.1 }}>
          <Hero3D size="lg" />
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

      {/* Onboarding modal for new users */}
      {!onboardingDismissed && <OnboardingModal />}

      {/* Floating help button */}
      <HelpButton />
    </div>
  );
}
