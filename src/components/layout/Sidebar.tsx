import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { Link, useLocation } from "react-router-dom";
import { X } from "lucide-react";
import {
  IconDashboard, IconApex, IconPulse, IconCatalysts, IconMind, IconMemory,
  IconChat, IconClients, IconIAM, IconControlPlane,
  IconERPAdapters, IconConnectivity, IconAudit, IconSettings,
  IconNetwork, IconBarChart, IconBolt, IconShield,
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

// Role hierarchy (level):
// superadmin (120)    — Full platform access incl. Tenants, IAM, ERP, Connectivity, Audit
// support_admin (110) — Same as superadmin minus Tenants; system accounts
// admin (100)         — Company admin: own tenant + IAM, Control Plane, ERP, Connectivity, Audit
// executive (90)      — C-Suite: Dashboard, Apex, Pulse, Catalysts, Mind, Memory, Chat
// manager (70)        — Department: Dashboard, Pulse, Catalysts, Mind, Memory, Chat
// analyst (50)        — Read-only: Dashboard, Pulse, Mind, Chat
// operator (40)       — Operational: Dashboard, Pulse, Catalysts, Mind, Chat
// viewer (10)         — Dashboard + Settings only

const SUPERADMIN_ROLES: UserRole[] = ['superadmin'];
const SUPPORT_ROLES: UserRole[] = ['superadmin', 'support_admin'];
const PLATFORM_ADMIN_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin'];
const EXECUTIVE_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive'];
const MANAGER_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager'];
const OPERATOR_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'operator'];
const STANDARD_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'analyst', 'operator'];

const navItems: NavItem[] = [
  // UX-14: Intelligence — core user-facing pages
  { path: '/dashboard', label: 'Dashboard', icon: IconDashboard, section: 'intelligence' },
  { path: '/apex', label: 'Apex', icon: IconApex, section: 'intelligence', sublabel: 'Executive Intelligence', roles: EXECUTIVE_ROLES },
  { path: '/pulse', label: 'Pulse', icon: IconPulse, section: 'intelligence', sublabel: 'Process Intelligence', roles: STANDARD_ROLES },
  { path: '/catalysts', label: 'Catalysts', icon: IconCatalysts, section: 'intelligence', sublabel: 'Autonomous Execution', roles: OPERATOR_ROLES },
  { path: '/chat', label: 'Chat', icon: IconChat, section: 'intelligence', sublabel: 'Conversational AI', roles: STANDARD_ROLES },
  { path: '/mind', label: 'Mind', icon: IconMind, section: 'intelligence', sublabel: 'AI Configuration', roles: PLATFORM_ADMIN_ROLES },
  // UX-14: Data — knowledge graph
  { path: '/memory', label: 'Memory', icon: IconMemory, section: 'data', sublabel: 'Knowledge Graph', roles: MANAGER_ROLES },
  // UX-14: Administration — IAM, Settings, Integrations, Audit, Clients
  { path: '/iam', label: 'IAM', icon: IconIAM, section: 'administration', sublabel: 'Users & Roles', roles: PLATFORM_ADMIN_ROLES },
  { path: '/tenants', label: 'Clients', icon: IconClients, section: 'administration', sublabel: 'Tenant Management', roles: SUPERADMIN_ROLES },
  { path: '/integrations', label: 'Integrations', icon: IconERPAdapters, section: 'administration', sublabel: 'Systems & Data Schema', roles: PLATFORM_ADMIN_ROLES },
  { path: '/webhooks', label: 'Webhooks', icon: IconBolt, section: 'administration', sublabel: 'Event Subscriptions', roles: PLATFORM_ADMIN_ROLES },
  { path: '/audit', label: 'Audit', icon: IconAudit, section: 'administration', sublabel: 'Governance', roles: PLATFORM_ADMIN_ROLES },
  { path: '/compliance', label: 'Compliance', icon: IconAudit, section: 'administration', sublabel: 'SOC 2 evidence pack', roles: PLATFORM_ADMIN_ROLES },
  { path: '/trust', label: 'Trust', icon: IconAudit, section: 'intelligence', sublabel: 'Calibration · Provenance · Peers', roles: STANDARD_ROLES },
  // Platform Ops — backend prefix middleware controls who can use the routes.
  // Sidebar role gating must match. Control Plane + Connectivity are open to
  // PLATFORM_ADMIN_ROLES (superadmin + support_admin + admin) per
  // workers/api/src/index.ts platformAdminRoutePrefixes. Deployments + Assessments
  // remain superadmin-only because their handlers explicitly enforce that.
  { path: '/control-plane', label: 'Control Plane', icon: IconControlPlane, section: 'platform-ops', sublabel: 'Agent Management', roles: PLATFORM_ADMIN_ROLES },
  { path: '/deployments', label: 'Deployments', icon: IconNetwork, section: 'platform-ops', sublabel: 'Hybrid & On-Premise', roles: SUPERADMIN_ROLES },
  { path: '/assessments', label: 'Assessments', icon: IconBarChart, section: 'platform-ops', sublabel: 'Pre-Sale Analysis', roles: SUPERADMIN_ROLES },
  { path: '/connectivity', label: 'Connectivity', icon: IconConnectivity, section: 'platform-ops', sublabel: 'Protocols', roles: PLATFORM_ADMIN_ROLES },
  // /executive retired: ExecutiveMobilePage consolidated into responsive ApexPage.
  { path: '/executive-summary', label: 'Exec Briefing', icon: IconBarChart, section: 'intelligence', sublabel: 'One-Page Summary', roles: EXECUTIVE_ROLES },
  // Admin Tooling (ADMIN-001 to ADMIN-012)
  { path: '/platform-health', label: 'Platform Health', icon: IconPulse, section: 'admin-tooling', sublabel: 'Infrastructure Status', roles: SUPERADMIN_ROLES },
  { path: '/support', label: 'Support Console', icon: IconChat, section: 'admin-tooling', sublabel: 'Tenant Support', roles: SUPPORT_ROLES },
  { path: '/company-health', label: 'Company Health', icon: IconBarChart, section: 'admin-tooling', sublabel: 'Org Utilization', roles: PLATFORM_ADMIN_ROLES },
  { path: '/impersonate', label: 'Impersonate', icon: IconClients, section: 'admin-tooling', sublabel: 'View as User', roles: SUPPORT_ROLES },
  { path: '/bulk-users', label: 'Bulk Users', icon: IconClients, section: 'admin-tooling', sublabel: 'Import & Manage', roles: PLATFORM_ADMIN_ROLES },
  { path: '/custom-roles', label: 'Custom Roles', icon: IconIAM, section: 'admin-tooling', sublabel: 'Role Builder', roles: PLATFORM_ADMIN_ROLES },
  { path: '/revenue', label: 'Revenue', icon: IconBarChart, section: 'admin-tooling', sublabel: 'MRR & Usage', roles: SUPERADMIN_ROLES },
  { path: '/feature-flags', label: 'Feature Flags', icon: IconBolt, section: 'admin-tooling', sublabel: 'Flag Management', roles: SUPERADMIN_ROLES },
  { path: '/data-governance', label: 'Data Governance', icon: IconShield, section: 'admin-tooling', sublabel: 'Retention & DSAR', roles: PLATFORM_ADMIN_ROLES },
  { path: '/integration-health', label: 'Integration Health', icon: IconConnectivity, section: 'admin-tooling', sublabel: 'Sync Monitoring', roles: PLATFORM_ADMIN_ROLES },
  { path: '/system-alerts', label: 'System Alerts', icon: IconApex, section: 'admin-tooling', sublabel: 'Alert Rules', roles: PLATFORM_ADMIN_ROLES },
  // v48: Support ticket system — everyone can file tickets; admins get Triage.
  { path: '/support-tickets', label: 'Support', icon: IconChat, section: 'administration', sublabel: 'File & track tickets' },
  { path: '/support-triage', label: 'Support Triage', icon: IconChat, section: 'admin-tooling', sublabel: 'Tenant Ticket Queue', roles: PLATFORM_ADMIN_ROLES },
  // Phase 10-30 / 10-31: Action layer HITL queues
  { path: '/action-layer', label: 'Action Layer Ops', icon: IconBolt, section: 'admin-tooling', sublabel: 'All 34 subcatalysts', roles: OPERATOR_ROLES },
  { path: '/ap-exceptions', label: 'AP Exceptions', icon: IconBolt, section: 'admin-tooling', sublabel: '3-way / Dup / Vendor stmt', roles: OPERATOR_ROLES },
  { path: '/cash-application', label: 'Cash Application', icon: IconBolt, section: 'admin-tooling', sublabel: 'AR Receipts Review', roles: OPERATOR_ROLES },
  { path: '/period-close', label: 'Period Close', icon: IconBarChart, section: 'admin-tooling', sublabel: '8-signal readiness', roles: PLATFORM_ADMIN_ROLES },
];

/** Atheon logo mark — geometric triangle with sage/sky/bronze palette */
function AtheonSidebarLogo() {
  return (
    <svg width="30" height="30" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sbBg" x1="0" y1="0" x2="36" y2="36">
          <stop offset="0%" stopColor="#06090d" />
          <stop offset="100%" stopColor="#0e151c" />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="9" fill="url(#sbBg)" />
      <path d="M18 6L28 29H8L18 6Z" fill="none" stroke="#4A6B5A" strokeWidth="1.5" />
      <line x1="11" y1="22" x2="25" y2="22" stroke="#4A6B5A" strokeWidth=".8" opacity=".6" />
      <line x1="13" y1="16.5" x2="23" y2="16.5" stroke="#7AACB5" strokeWidth=".8" opacity=".5" />
      <circle cx="18" cy="9.5" r="1.8" fill="#c9a059" />
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
        className="fixed left-0 top-0 h-full z-40 w-14 hidden md:flex flex-col items-center py-3 transition-colors duration-200"
        style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-card)', boxShadow: '2px 0 12px rgba(100, 120, 180, 0.06)' }}
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="mb-5 mt-0.5">
          <Link to="/dashboard" className="block" title="Go to Dashboard" aria-label="Go to Dashboard">
            <AtheonSidebarLogo />
          </Link>
        </div>

        <nav className="flex-1 flex flex-col items-center gap-0.5 overflow-y-auto scrollbar-thin w-full px-1.5" aria-label="Primary navigation">
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
                  <Icon size={17} className={cn(isActive ? 'text-accent' : 't-muted group-hover:t-secondary')} />
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
            <IconSettings size={17} className={location.pathname === '/settings' ? 'text-accent' : 't-muted'} />
          </Link>
        </div>
      </aside>

      {/* Mobile sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 h-full z-50 flex flex-col transition-transform duration-300 w-64 md:hidden',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ background: 'var(--bg-modal)', borderRight: '1px solid var(--border-card)', boxShadow: '4px 0 24px rgba(100, 120, 180, 0.10)' }}
        role="navigation"
        aria-label="Mobile navigation"
        aria-hidden={!mobileSidebarOpen}
      >
        <div className="flex items-center justify-between px-4 h-14" style={{ borderBottom: '1px solid var(--border-card)' }}>
          <div className="flex items-center gap-2.5">
            <AtheonSidebarLogo />
            <div>
              <h1 className="text-sm font-semibold t-primary tracking-tight">Atheon</h1>
              <p className="text-[10px] t-muted tracking-wide uppercase">Enterprise Intelligence</p>
            </div>
          </div>
          <button onClick={closeMobile} className="p-1.5 rounded-md t-muted hover:t-primary hover:bg-[var(--bg-secondary)] transition-all" title="Close navigation menu" aria-label="Close navigation menu">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto scrollbar-thin py-2 px-2" aria-label="Mobile navigation links">
          {(() => {
            let prevSection = '';
            return visibleItems.map((item) => {
              const isActive = location.pathname === item.path ||
                (item.path !== '/dashboard' && location.pathname.startsWith(item.path));
              const Icon = item.icon;
              const showSectionHeader = prevSection !== item.section;
              prevSection = item.section;
              const sectionLabels: Record<string, string> = { intelligence: 'Intelligence', data: 'Data', administration: 'Administration', 'platform-ops': 'Platform Ops', 'admin-tooling': 'Admin Tooling' };

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
                    title={item.label}
                    className={cn(
                      'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all duration-150 group',
                      isActive
                        ? 'font-medium'
                        : 't-secondary hover:t-primary hover:bg-[var(--bg-secondary)]'
                    )}
                    style={isActive ? { background: 'var(--accent-subtle)', color: 'var(--accent)' } : undefined}
                  >
                    <Icon className={cn('flex-shrink-0', isActive ? 'text-accent' : 't-muted group-hover:t-secondary')} size={16} />
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
