import { useAppStore } from "@/stores/appStore";
import { Bell, ChevronDown, Menu, LogOut, MessageCircle, Settings, X, Check, Sun, Moon, Building2, Factory } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, setToken, setTenantOverride } from "@/lib/api";
import type { NotificationItem, Tenant } from "@/lib/api";
import type { IndustryVertical } from "@/types";
import { useState, useEffect, useRef, useCallback } from "react";

const PLATFORM_ADMIN_ROLES = ['superadmin', 'support_admin', 'admin'];

const industries: { value: IndustryVertical; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'fmcg', label: 'FMCG' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'mining', label: 'Mining' },
  { value: 'agriculture', label: 'Agriculture' },
  { value: 'logistics', label: 'Logistics' },
  { value: 'technology', label: 'Technology' },
  { value: 'manufacturing', label: 'Manufacturing' },
];

const severityColors: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-500',
  low: 'bg-blue-500',
  info: 'bg-zinc-400',
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function Header() {
  const { user, industry, setIndustry, setMobileSidebarOpen, setUser, theme, toggleTheme, activeTenantId, activeTenantName, setActiveTenant } = useAppStore();
  const navigate = useNavigate();
  const isPlatformAdmin = user?.role && PLATFORM_ADMIN_ROLES.includes(user.role);

  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Company selector state for platform admins
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);
  const companyDropdownRef = useRef<HTMLDivElement>(null);

  // Load tenants list for platform admins
  useEffect(() => {
    if (!isPlatformAdmin) return;
    api.tenants.list().then((data) => {
      setTenants(data.tenants || []);
      // If no active tenant is selected, default to user's own tenant
      if (!activeTenantId && user?.tenantId) {
        const myTenant = data.tenants?.find((t: Tenant) => t.id === user.tenantId);
        if (myTenant) {
          setActiveTenant(myTenant.id, myTenant.name, myTenant.industry as IndustryVertical);
          setTenantOverride(null); // Don't override for own tenant
        }
      }
    }).catch(() => { /* silent - non-critical */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlatformAdmin, user?.tenantId, setActiveTenant]);

  // Close company dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (companyDropdownRef.current && !companyDropdownRef.current.contains(e.target as Node)) {
        setShowCompanyDropdown(false);
      }
    }
    if (showCompanyDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showCompanyDropdown]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    }
    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showNotifications]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const data = await api.notifications.unreadCount();
      setUnreadCount(data.unreadCount);
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  const openNotifications = async () => {
    setShowNotifications((prev) => !prev);
    if (!showNotifications) {
      setLoadingNotifs(true);
      try {
        const data = await api.notifications.list({ limit: 20 });
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      } catch {
        // fallback empty
      } finally {
        setLoadingNotifs(false);
      }
    }
  };

  const markAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    try {
      await api.notifications.markRead(unreadIds);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // silently fail
    }
  };

  const handleLogout = async () => {
    try {
      await api.auth.logout();
    } catch {
      // Continue with client-side logout even if API call fails
    }
    setToken(null);
    setTenantOverride(null);
    setUser(null);
    setActiveTenant(null, null, null);
    navigate('/login', { replace: true });
  };

  const handleSelectTenant = (tenant: Tenant) => {
    setActiveTenant(tenant.id, tenant.name, tenant.industry as IndustryVertical);
    // Update industry selector to match selected company's industry
    if (tenant.industry) {
      setIndustry(tenant.industry as IndustryVertical);
    }
    // Set tenant override for API calls (null if it's user's own tenant)
    if (tenant.id === user?.tenantId) {
      setTenantOverride(null);
    } else {
      setTenantOverride(tenant.id);
    }
    setShowCompanyDropdown(false);
    // Reload to ensure all cached data is refreshed with new tenant context
    window.location.reload();
  };

  // Get display industry for the header badge
  const displayIndustry = industries.find(i => i.value === industry);

  return (
    <header
      className="fixed top-0 right-0 z-30 h-12 flex items-center justify-between px-4 sm:px-5 transition-colors duration-200"
      style={{ left: '0px', background: 'var(--bg-header)', borderBottom: '1px solid var(--border-card)', boxShadow: '0 2px 12px rgba(100, 120, 180, 0.06)' }}
    >
      <div className="flex items-center gap-2.5 flex-1">
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="lg:hidden p-1.5 -ml-1 rounded-md t-muted hover:t-primary hover:bg-[var(--bg-secondary)] transition-all"
          title="Open navigation menu"
          aria-label="Open navigation menu"
        >
          <Menu size={18} />
        </button>

        <div className="hidden lg:block flex-shrink-0 w-8" />

        {/* Company Selector for Platform Admins */}
        {isPlatformAdmin && tenants.length > 0 ? (
          <div className="relative" ref={companyDropdownRef}>
            <button
              onClick={() => setShowCompanyDropdown(!showCompanyDropdown)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md cursor-pointer hover:bg-[var(--bg-tertiary)] transition-all"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}
              title="Switch company"
            >
              <Building2 size={12} className="flex-shrink-0 t-muted" />
              <span className="text-[11px] font-medium t-secondary truncate max-w-[180px]">
                {activeTenantName || user?.tenantName || 'Select Company'}
              </span>
              <ChevronDown size={10} className="flex-shrink-0 t-muted" />
            </button>

            {showCompanyDropdown && (
              <div
                className="absolute left-0 top-full mt-1 w-64 rounded-lg overflow-hidden z-50"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', boxShadow: 'var(--shadow-dropdown)' }}
              >
                <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border-card)' }}>
                  <p className="text-[10px] font-medium t-muted uppercase tracking-wider">Switch Company</p>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {/* Pin user's own company at top, then sort rest alphabetically */}
                  {[...tenants].sort((a, b) => {
                    if (a.id === user?.tenantId) return -1;
                    if (b.id === user?.tenantId) return 1;
                    return a.name.localeCompare(b.name);
                  }).map((t) => {
                    const isActive = t.id === activeTenantId;
                    const isOwnCompany = t.id === user?.tenantId;
                    const industryLabel = industries.find(i => i.value === t.industry)?.label || t.industry;
                    return (
                      <button
                        key={t.id}
                        onClick={() => handleSelectTenant(t)}
                        className="w-full text-left px-3 py-2 transition-all hover:bg-[var(--bg-secondary)] flex items-center gap-2.5"
                        style={isActive ? { background: 'var(--accent-subtle)' } : undefined}
                      >
                        <Building2 size={13} className={isActive ? 'text-accent flex-shrink-0' : 't-muted flex-shrink-0'} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-[12px] leading-tight truncate ${isActive ? 'font-medium t-primary' : 't-secondary'}`}>{t.name}</p>
                          <p className="text-[10px] t-muted">{isOwnCompany ? 'Your company' : industryLabel} &middot; {t.plan}</p>
                        </div>
                        {isActive && <Check size={12} className="text-accent flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : user?.tenantName ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}>
            <Building2 size={12} className="flex-shrink-0 t-muted" />
            <span className="text-[11px] font-medium t-secondary truncate max-w-[180px]">{user.tenantName}</span>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-0.5">
        {/* Industry Selector for platform admins / Industry Display for regular users */}
        {isPlatformAdmin ? (
          <div className="relative hidden md:block">
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value as IndustryVertical)}
              className="appearance-none rounded-md pl-2.5 pr-6 py-1 text-[11px] t-secondary cursor-pointer focus:outline-none transition-all"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}
              title="Filter analytics by industry vertical"
            >
              {industries.map(i => (
                <option key={i.value} value={i.value}>{i.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 t-muted pointer-events-none" />
          </div>
        ) : displayIndustry && displayIndustry.value !== 'general' ? (
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}>
            <Factory size={11} className="flex-shrink-0 t-muted" />
            <span className="text-[11px] font-medium t-secondary">{displayIndustry.label}</span>
          </div>
        ) : null}

        <button
          onClick={() => navigate('/chat')}
          className="p-1.5 rounded-md t-muted hover:t-primary hover:bg-[var(--bg-secondary)] transition-all"
          title="Messages"
          aria-label="Open chat messages"
        >
          <MessageCircle size={15} />
        </button>

        {/* Notifications */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={openNotifications}
            className="relative p-1.5 rounded-md t-muted hover:t-primary hover:bg-[var(--bg-secondary)] transition-all"
            title="Notifications"
            aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          >
            <Bell size={15} />
            {unreadCount > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full text-[9px] font-bold text-white flex items-center justify-center leading-none" style={{ background: 'var(--accent)' }}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div
              className="absolute right-0 top-full mt-1.5 w-80 sm:w-96 rounded-lg overflow-hidden z-50"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', boxShadow: 'var(--shadow-dropdown)' }}
            >
              <div className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--border-card)' }}>
                <h3 className="text-xs font-semibold t-primary">Notifications</h3>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} className="text-[11px] font-medium flex items-center gap-1" style={{ color: 'var(--accent)' }} title="Mark all notifications as read">
                      <Check size={11} /> Mark all read
                    </button>
                  )}
                  <button onClick={() => setShowNotifications(false)} className="p-0.5 rounded t-muted hover:t-primary transition-all" title="Close notifications">
                    <X size={13} />
                  </button>
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto">
                {loadingNotifs ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="py-8 text-center">
                    <Bell size={20} className="mx-auto mb-2 t-muted" />
                    <p className="text-xs t-muted">No notifications yet</p>
                  </div>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        if (n.actionUrl) navigate(n.actionUrl.replace('https://atheon.vantax.co.za', ''));
                        setShowNotifications(false);
                      }}
                      className="w-full text-left px-3.5 py-2.5 transition-all hover:bg-[var(--bg-secondary)]"
                      style={{ borderBottom: '1px solid var(--divider)', background: !n.read ? 'var(--accent-subtle)' : 'transparent' }}
                      title={n.actionUrl ? 'Open related page' : 'Notification'}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${severityColors[n.severity] || 'bg-zinc-400'}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-[12px] leading-tight ${!n.read ? 'font-medium t-primary' : 't-secondary'}`}>{n.title}</p>
                          <p className="text-[11px] t-muted mt-0.5 line-clamp-2">{n.message}</p>
                          <p className="text-[10px] t-muted mt-0.5">{timeAgo(n.createdAt)}</p>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>

              {notifications.length > 0 && (
                <div className="px-3.5 py-2" style={{ borderTop: '1px solid var(--border-card)' }}>
                  <button
                    onClick={() => { navigate('/audit'); setShowNotifications(false); }}
                    className="text-[11px] font-medium"
                    style={{ color: 'var(--accent)' }}
                    title="Open audit log"
                  >
                    View all activity
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-md t-muted hover:t-primary hover:bg-[var(--bg-secondary)] transition-all"
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        <button
          onClick={() => navigate('/settings')}
          className="p-1.5 rounded-md t-muted hover:t-primary hover:bg-[var(--bg-secondary)] transition-all"
          title="Settings"
          aria-label="Open settings"
        >
          <Settings size={15} />
        </button>

        <div className="flex items-center gap-1.5 ml-1.5 pl-1.5" style={{ borderLeft: '1px solid var(--border-card)' }}>
          <div
            className="w-7 h-7 rounded-md overflow-hidden flex items-center justify-center text-[11px] font-semibold text-white flex-shrink-0"
            style={{ background: 'var(--accent)' }}
          >
            {user?.name?.charAt(0) || 'A'}
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="p-1 rounded-md t-muted hover:text-red-500 hover:bg-red-500/10 transition-all"
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </header>
  );
}
