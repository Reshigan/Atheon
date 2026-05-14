import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { OnboardingWizard } from "@/components/common/OnboardingWizard";
import { HelpButton } from "@/components/common/HelpButton";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { api, getToken, setToken } from "@/lib/api";
import { Loader2 } from "lucide-react";
import { clearChunkReloadGuard } from "@/lib/lazy-with-retry";

export function AppLayout() {
  const { user, setUser, theme, onboardingDismissed } = useAppStore();
  const loadCompanies = useAppStore((s) => s.loadCompanies);
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
          // Whitelabel — backend always returns a `brand` block; default to
          // null fields so the BrandProvider clears any prior tenant state.
          brand: me.brand
            ? { logoUrl: me.brand.logoUrl, primaryColor: me.brand.primaryColor, nameOverride: me.brand.nameOverride }
            : { logoUrl: null, primaryColor: null, nameOverride: null },
        });
      })
      .catch(() => {
        setToken(null);
        navigate('/login', { replace: true });
      })
      .finally(() => setChecking(false));
  }, [user, navigate, setUser]);

  // Load the tenant's ERP companies once we have an authenticated user so the
  // company-switcher has data. Also re-runs if the active tenant id changes
  // (platform admin switched tenants).
  const activeTenantId = useAppStore((s) => s.activeTenantId);
  useEffect(() => {
    if (!user) return;
    loadCompanies();
  }, [user, activeTenantId, loadCompanies]);

  // Clear the chunk-load reload guard once the layout mounts successfully.
  // This lets a subsequent stale-cache scenario (mid-session second deploy)
  // self-heal via lazyWithRetry — the user gets one auto-reload per session
  // per stale-bundle event.
  useEffect(() => {
    clearChunkReloadGuard();
  }, []);

  // TASK-006: Global keyboard handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") document.dispatchEvent(new CustomEvent("atheon:escape"));
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        document.dispatchEvent(new CustomEvent("atheon:help"));
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className={cn('min-h-screen transition-colors duration-200', theme === 'dark' ? 'atheon-dark' : '')} style={{ background: 'var(--bg-primary)', backgroundImage: 'var(--bg-pattern)', backgroundAttachment: 'fixed' }}>
      {/* TASK-006: Skip to content link */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:rounded-md focus:bg-[var(--accent)] focus:text-white focus:text-sm">
        Skip to main content
      </a>
      <Sidebar />
      <Header />
      <main
        className={cn(
          'pt-12 min-h-screen transition-all duration-200',
          // Sidebar is now 240px wide (Stitch 5-section IA, Phase P).
          // Match the offset; mobile gets no padding since the sidebar is a drawer.
          'pl-0 md:pl-sidebar-expanded',
        )}
      >
        <div id="main-content" className="p-4 sm:p-5 lg:p-6">
          <Breadcrumbs />
          <Outlet />
        </div>
      </main>

      {!onboardingDismissed && <OnboardingWizard onDismiss={() => useAppStore.getState().dismissOnboarding()} />}
      <HelpButton />
    </div>
  );
}
