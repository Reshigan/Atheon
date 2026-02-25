import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { Link, useLocation } from "react-router-dom";
import { X } from "lucide-react";
import {
  IconDashboard, IconApex, IconPulse, IconCatalysts, IconMind, IconMemory,
  IconChat, IconClients, IconIAM, IconControlPlane, IconCanonicalApi,
  IconERPAdapters, IconConnectivity, IconAudit, IconSettings,
} from "@/components/icons/AtheonIcons";
import type { UserRole } from "@/types";

/** Roles that can see each menu item. If omitted, all roles can see it. */
type NavItem = {
  path: string;
  label: string;
  icon: typeof IconDashboard;
  section: string;
  sublabel?: string;
  /** Roles allowed to see this item. undefined = visible to everyone */
  roles?: UserRole[];
};

const ADMIN_ROLES: UserRole[] = ['admin', 'executive'];
const POWER_ROLES: UserRole[] = ['admin', 'executive', 'manager'];

const navItems: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: IconDashboard, section: 'intelligence' },
  { path: '/apex', label: 'Apex', icon: IconApex, section: 'intelligence', sublabel: 'Executive Intelligence', roles: POWER_ROLES },
  { path: '/pulse', label: 'Pulse', icon: IconPulse, section: 'intelligence', sublabel: 'Process Intelligence' },
  { path: '/catalysts', label: 'Catalysts', icon: IconCatalysts, section: 'intelligence', sublabel: 'Autonomous Execution' },
  { path: '/mind', label: 'Mind', icon: IconMind, section: 'intelligence', sublabel: 'Domain LLM' },
  { path: '/memory', label: 'Memory', icon: IconMemory, section: 'intelligence', sublabel: 'GraphRAG' },
  { path: '/chat', label: 'Chat', icon: IconChat, section: 'intelligence', sublabel: 'Conversational AI' },
  { path: '/tenants', label: 'Clients', icon: IconClients, section: 'platform', sublabel: 'Tenant Management', roles: ADMIN_ROLES },
  { path: '/iam', label: 'IAM', icon: IconIAM, section: 'platform', sublabel: 'Identity & Access', roles: ADMIN_ROLES },
  { path: '/control-plane', label: 'Control Plane', icon: IconControlPlane, section: 'platform', sublabel: 'Agent Management', roles: ADMIN_ROLES },
  { path: '/canonical-api', label: 'Canonical API', icon: IconCanonicalApi, section: 'platform', sublabel: 'Unified API', roles: ADMIN_ROLES },
  { path: '/erp-adapters', label: 'ERP Adapters', icon: IconERPAdapters, section: 'platform', sublabel: 'System Connectors', roles: ADMIN_ROLES },
  { path: '/connectivity', label: 'Connectivity', icon: IconConnectivity, section: 'system', sublabel: 'MCP + A2A', roles: ADMIN_ROLES },
  { path: '/audit', label: 'Audit', icon: IconAudit, section: 'system', sublabel: 'Governance', roles: ADMIN_ROLES },
];

/** Atheon infinity-loop logo mark for sidebar */
function AtheonSidebarLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 4C8.5 4 4 8.5 4 14s4.5 10 10 10 10-4.5 10-10S19.5 4 14 4zm0 17c-3.9 0-7-3.1-7-7s3.1-7 7-7 7 3.1 7 7-3.1 7-7 7z" fill="var(--accent)" opacity="0.8"/>
      <path d="M14 8c-3.3 0-6 2.7-6 6s2.7 6 6 6 6-2.7 6-6-2.7-6-6-6zm0 9.5c-1.9 0-3.5-1.6-3.5-3.5S12.1 10.5 14 10.5s3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5z" fill="var(--accent)" opacity="0.5"/>
    </svg>
  );
}

export function Sidebar() {
  const { mobileSidebarOpen, setMobileSidebarOpen, user, theme } = useAppStore();
  const location = useLocation();
  const closeMobile = () => setMobileSidebarOpen(false);
  const userRole = user?.role as UserRole | undefined;

  // Filter nav items based on user role
  const visibleItems = navItems.filter((item) => {
    if (!item.roles) return true; // visible to everyone
    if (!userRole) return false;  // hide restricted items if no user
    return item.roles.includes(userRole);
  });

  const isDark = theme === 'dark';
  let lastSection = '';

  return (
    <>
      {/* Mobile overlay backdrop */}
      {mobileSidebarOpen && (
        <div
          className={cn("fixed inset-0 z-40 backdrop-blur-sm lg:hidden", isDark ? "bg-black/50" : "bg-black/20")}
          onClick={closeMobile}
        />
      )}

      {/* Desktop sidebar -- icon-only narrow bar with soft blue tint */}
      <aside
        className="fixed left-0 top-0 h-full z-40 w-[60px] hidden lg:flex flex-col items-center py-4 transition-colors duration-300"
        style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--divider)' }}
      >
        {/* Logo */}
        <div className="mb-6 mt-1">
          <AtheonSidebarLogo />
        </div>

        {/* Nav icons */}
        <nav className="flex-1 flex flex-col items-center gap-1 overflow-y-auto scrollbar-thin w-full px-2">
          {visibleItems.map((item) => {
            const isActive = location.pathname === item.path ||
              (item.path !== '/dashboard' && location.pathname.startsWith(item.path));
            const Icon = item.icon;
            const showDivider = lastSection !== '' && lastSection !== item.section;
            lastSection = item.section;

            return (
              <div key={item.path} className="w-full flex flex-col items-center">
                {showDivider && <div className="w-6 h-px my-1.5" style={{ background: 'var(--divider)' }} />}
                <Link
                  to={item.path}
                  title={item.label}
                  className={cn(
                    'w-10 h-10 flex items-center justify-center rounded-2xl transition-all duration-200 group relative',
                    isActive
                      ? 'shadow-sm'
                      : 'hover:bg-white/[0.5]'
                  )}
                  style={isActive ? { background: 'var(--bg-card)', boxShadow: 'var(--shadow-card)' } : undefined}
                >
                  <Icon size={18} className={cn(isActive ? 'text-[var(--accent)]' : 't-muted group-hover:t-secondary')} />
                  {/* Tooltip */}
                  <div
                    className="absolute left-full ml-3 px-3 py-1.5 text-xs font-medium rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-lg"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  >
                    {item.label}
                  </div>
                </Link>
              </div>
            );
          })}
        </nav>

        {/* Settings at bottom */}
        <div className="mt-2 mb-1">
          <Link
            to="/settings"
            title="Settings"
            className="w-10 h-10 flex items-center justify-center rounded-2xl t-muted hover:t-secondary transition-all"
          >
            <IconSettings size={18} />
          </Link>
        </div>
      </aside>

      {/* Mobile sidebar -- full expanded with labels */}
      <aside className={cn(
        'fixed left-0 top-0 h-full z-50 flex flex-col transition-transform duration-300 w-72 lg:hidden',
        mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
      )} style={{ background: 'var(--bg-card)', borderRight: '1px solid var(--divider)' }}>
        <div className="flex items-center justify-between px-4 h-16" style={{ borderBottom: '1px solid var(--divider)' }}>
          <div className="flex items-center gap-3">
            <AtheonSidebarLogo />
            <div>
                <h1 className="text-lg font-bold t-primary">Atheon</h1>
                <p className="text-[10px] t-muted -mt-0.5 tracking-wider uppercase">Enterprise Intelligence</p>
            </div>
          </div>
          <button
            onClick={closeMobile}
            className="p-2 rounded-xl t-muted hover:t-primary transition-all"
            style={{ background: 'transparent' }}
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-3">
          {(() => {
            let prevSection = '';
            return visibleItems.map((item) => {
              const isActive = location.pathname === item.path ||
                (item.path !== '/dashboard' && location.pathname.startsWith(item.path));
              const Icon = item.icon;
              const showSectionHeader = prevSection !== item.section;
              prevSection = item.section;
              const sectionLabels: Record<string, string> = { intelligence: 'Intelligence', platform: 'Platform', system: 'System' };

              return (
                <div key={item.path}>
                  {showSectionHeader && (
                    <span className="block px-3 mt-4 mb-1.5 text-[10px] font-semibold t-muted uppercase tracking-wider first:mt-0">
                      {sectionLabels[item.section]}
                    </span>
                  )}
                  <Link
                    to={item.path}
                    onClick={closeMobile}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 group',
                      isActive
                        ? 'shadow-sm'
                        : 't-secondary hover:t-primary'
                    )}
                    style={isActive ? { background: 'var(--bg-primary)', color: 'var(--accent)' } : undefined}
                  >
                    <Icon className={cn('flex-shrink-0', isActive ? 'text-[var(--accent)]' : 't-muted group-hover:t-secondary')} size={18} />
                    <div className="min-w-0">
                      <span className="font-medium">{item.label}</span>
                      {item.sublabel && (
                        <span className="block text-[10px] t-muted truncate">{item.sublabel}</span>
                      )}
                    </div>
                  </Link>
                </div>
              );
            });
          })()}
        </nav>
      </aside>
    </>
  );
}
