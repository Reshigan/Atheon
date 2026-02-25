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
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className={cn('min-h-screen transition-colors duration-200', theme === 'dark' ? 'atheon-dark' : '')} style={{ background: 'var(--bg-primary)' }}>
      <Sidebar />
      <Header />
      <main
        className={cn(
          'pt-12 min-h-screen transition-all duration-200',
          'pl-0 lg:pl-14'
        )}
      >
        <div className="p-4 sm:p-5 lg:p-6">
          <Outlet />
        </div>
      </main>

      {!onboardingDismissed && <OnboardingModal />}
      <HelpButton />
    </div>
  );
}
