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

type NavItem = {
  path: string;
  label: string;
  icon: typeof IconDashboard;
  section: string;
  sublabel?: string;
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

/** Atheon logo mark — geometric A */
function AtheonSidebarLogo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L3 20h3.5l1.5-3.5h8L17.5 20H21L12 2zm0 5.5L15.5 15h-7L12 7.5z" fill="var(--accent)" />
    </svg>
  );
}

export function Sidebar() {
  const { mobileSidebarOpen, setMobileSidebarOpen, user, theme } = useAppStore();
  const location = useLocation();
  const closeMobile = () => setMobileSidebarOpen(false);
  const userRole = user?.role as UserRole | undefined;

  const visibleItems = navItems.filter((item) => {
    if (!item.roles) return true;
    if (!userRole) return false;
    return item.roles.includes(userRole);
  });

  const isDark = theme === 'dark';
  let lastSection = '';

  return (
    <>
      {mobileSidebarOpen && (
        <div
          className={cn("fixed inset-0 z-40 lg:hidden", isDark ? "bg-black/60" : "bg-black/20")}
          onClick={closeMobile}
        />
      )}

      {/* Desktop sidebar — icon-only 56px bar */}
      <aside
        className="fixed left-0 top-0 h-full z-40 w-14 hidden lg:flex flex-col items-center py-3 transition-colors duration-200"
        style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-card)' }}
      >
        <div className="mb-5 mt-0.5">
          <Link to="/dashboard" className="block">
            <AtheonSidebarLogo />
          </Link>
        </div>

        <nav className="flex-1 flex flex-col items-center gap-0.5 overflow-y-auto scrollbar-thin w-full px-1.5">
          {visibleItems.map((item) => {
            const isActive = location.pathname === item.path ||
              (item.path !== '/dashboard' && location.pathname.startsWith(item.path));
            const Icon = item.icon;
            const showDivider = lastSection !== '' && lastSection !== item.section;
            lastSection = item.section;

            return (
              <div key={item.path} className="w-full flex flex-col items-center">
                {showDivider && <div className="w-5 h-px my-1" style={{ background: 'var(--border-card)' }} />}
                <Link
                  to={item.path}
                  title={item.label}
                  className={cn(
                    'w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-150 group relative',
                    isActive
                      ? ''
                      : 'hover:bg-[var(--bg-secondary)]'
                  )}
                  style={isActive ? { background: 'var(--accent-subtle)', color: 'var(--accent)' } : undefined}
                >
                  <Icon size={17} className={cn(isActive ? 'text-[var(--accent)]' : 't-muted group-hover:t-secondary')} />
                  <div
                    className="absolute left-full ml-2.5 px-2.5 py-1 text-[11px] font-medium rounded-md opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-card)', color: 'var(--text-primary)', boxShadow: 'var(--shadow-dropdown)' }}
                  >
                    {item.label}
                  </div>
                </Link>
              </div>
            );
          })}
        </nav>

        <div className="mt-1 mb-0.5">
          <Link
            to="/settings"
            title="Settings"
            className={cn(
              'w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-150',
              location.pathname === '/settings' ? '' : 'hover:bg-[var(--bg-secondary)]'
            )}
            style={location.pathname === '/settings' ? { background: 'var(--accent-subtle)', color: 'var(--accent)' } : undefined}
          >
            <IconSettings size={17} className={location.pathname === '/settings' ? 'text-[var(--accent)]' : 't-muted'} />
          </Link>
        </div>
      </aside>

      {/* Mobile sidebar */}
      <aside className={cn(
        'fixed left-0 top-0 h-full z-50 flex flex-col transition-transform duration-300 w-64 lg:hidden',
        mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
      )} style={{ background: 'var(--bg-card)', borderRight: '1px solid var(--border-card)' }}>
        <div className="flex items-center justify-between px-4 h-14" style={{ borderBottom: '1px solid var(--border-card)' }}>
          <div className="flex items-center gap-2.5">
            <AtheonSidebarLogo />
            <div>
              <h1 className="text-sm font-semibold t-primary tracking-tight">Atheon</h1>
              <p className="text-[10px] t-muted tracking-wide uppercase">Enterprise Intelligence</p>
            </div>
          </div>
          <button onClick={closeMobile} className="p-1.5 rounded-md t-muted hover:t-primary hover:bg-[var(--bg-secondary)] transition-all">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto scrollbar-thin py-2 px-2">
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
                    <span className="block px-2.5 mt-4 mb-1 text-[10px] font-medium t-muted uppercase tracking-widest first:mt-0">
                      {sectionLabels[item.section]}
                    </span>
                  )}
                  <Link
                    to={item.path}
                    onClick={closeMobile}
                    className={cn(
                      'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all duration-150 group',
                      isActive
                        ? 'font-medium'
                        : 't-secondary hover:t-primary hover:bg-[var(--bg-secondary)]'
                    )}
                    style={isActive ? { background: 'var(--accent-subtle)', color: 'var(--accent)' } : undefined}
                  >
                    <Icon className={cn('flex-shrink-0', isActive ? 'text-[var(--accent)]' : 't-muted group-hover:t-secondary')} size={16} />
                    <div className="min-w-0">
                      <span className={isActive ? 'font-medium' : ''}>{item.label}</span>
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
