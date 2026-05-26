/**
 * Sidebar — Stitch "Athens Executive Interface" 5-section IA.
 *
 * Lifted directly from the Stitch design (projects/4059809207181456952):
 *
 *   Intelligence      → Dashboard · Apex · Pulse · Catalysts · Chat · Mind · Memory · Trust · Exec Briefing
 *   Data              → Integrations · Webhooks · Connectivity · Integration Health · Compliance · Audit
 *   Administration    → IAM · Custom Roles · Bulk Users · Clients · Support (file ticket)
 *   Platform Ops      → Control Plane · Deployments · Assessments · Platform Health · System Alerts · Feature Flags
 *   Admin Tooling     → Revenue · Support Console · Support Triage · Impersonate
 *
 * Each section header is a Material-Symbols-labelled row that expands /
 * collapses its child routes. The section whose route the user is currently
 * on is auto-expanded. Active row gets a sage right-border (matches Stitch
 * `border-r-2 border-primary` exactly).
 *
 * Footer: Support · Settings. Same shape as Stitch.
 *
 * Two layouts:
 *   - Desktop: 240px expanded column, sticky, scrollable
 *   - Mobile:  drawer over content, opens via Header burger
 */
import { useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { Link, useLocation } from "react-router-dom";
import { X, ChevronDown } from "lucide-react";
import type { UserRole } from "@/types";

// ──────────────────────────────────────────────────────────────
// Role groups
// ──────────────────────────────────────────────────────────────
const SUPERADMIN_ROLES: UserRole[] = ['superadmin'];
const SUPPORT_ROLES: UserRole[] = ['superadmin', 'support_admin'];
const PLATFORM_ADMIN_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin'];
const EXECUTIVE_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive'];
const MANAGER_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager'];
const OPERATOR_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'operator'];
const STANDARD_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'analyst', 'operator'];
// Phase AT: auditors see ONLY /compliance + /settings. The sidebar should
// render exactly two items for them — anything else exposes the wrong scope.
const COMPLIANCE_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'auditor'];
// Phase AU: board members see ONLY /board-digest + /settings. Same scope
// pattern as auditor — narrow read-only landing, nothing operational.
const BOARD_DIGEST_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'board_member'];

// ──────────────────────────────────────────────────────────────
// Nav model — 5 sections + footer
// ──────────────────────────────────────────────────────────────
type SectionKey = 'intelligence' | 'data' | 'administration' | 'platform-ops' | 'admin-tooling';

interface NavLeaf {
  path: string;
  label: string;
  /** Material Symbols Outlined ligature name. Falls back to the section glyph. */
  symbol: string;
  roles?: UserRole[];
}

interface NavSection {
  key: SectionKey;
  label: string;
  /** Material Symbols Outlined ligature for the section header row. */
  symbol: string;
  children: NavLeaf[];
}

const SECTIONS: NavSection[] = [
  {
    key: 'intelligence',
    label: 'Intelligence',
    symbol: 'insights',
    children: [
      { path: '/dashboard',         label: 'Dashboard',     symbol: 'dashboard' },
      { path: '/apex',              label: 'Apex',          symbol: 'workspace_premium', roles: EXECUTIVE_ROLES },
      { path: '/pulse',             label: 'Pulse',         symbol: 'monitor_heart',     roles: STANDARD_ROLES },
      { path: '/catalysts',         label: 'Catalysts',     symbol: 'bolt',              roles: OPERATOR_ROLES },
      { path: '/mind',              label: 'Mind',          symbol: 'psychology',        roles: PLATFORM_ADMIN_ROLES },
      { path: '/memory',            label: 'Memory',        symbol: 'memory',            roles: MANAGER_ROLES },
      { path: '/trust',             label: 'Trust',         symbol: 'verified',          roles: STANDARD_ROLES },
      { path: '/executive-summary', label: 'Exec Briefing', symbol: 'description',       roles: EXECUTIVE_ROLES },
      { path: '/board-digest',      label: 'Board Digest',  symbol: 'workspaces',        roles: BOARD_DIGEST_ROLES },
    ],
  },
  {
    key: 'data',
    label: 'Data',
    symbol: 'database',
    children: [
      { path: '/integrations',        label: 'Integrations',        symbol: 'hub',            roles: PLATFORM_ADMIN_ROLES },
      { path: '/webhooks',            label: 'Webhooks',            symbol: 'webhook',        roles: PLATFORM_ADMIN_ROLES },
      { path: '/action-layer',        label: 'Operator Queue',      symbol: 'inbox',          roles: PLATFORM_ADMIN_ROLES },
      { path: '/connectivity',        label: 'Connectivity',        symbol: 'lan',            roles: PLATFORM_ADMIN_ROLES },
      { path: '/integration-health',  label: 'Integration Health',  symbol: 'cable',          roles: PLATFORM_ADMIN_ROLES },
      { path: '/compliance',          label: 'Compliance',          symbol: 'verified_user',  roles: COMPLIANCE_ROLES },
    ],
  },
  {
    key: 'administration',
    label: 'Administration',
    symbol: 'settings_account_box',
    children: [
      { path: '/iam',             label: 'IAM',           symbol: 'admin_panel_settings', roles: PLATFORM_ADMIN_ROLES },
      { path: '/custom-roles',    label: 'Custom Roles',  symbol: 'manage_accounts',      roles: PLATFORM_ADMIN_ROLES },
      { path: '/bulk-users',      label: 'Bulk Users',    symbol: 'group_add',            roles: PLATFORM_ADMIN_ROLES },
      { path: '/tenants',         label: 'Clients',       symbol: 'apartment',            roles: SUPERADMIN_ROLES },
      { path: '/support-tickets', label: 'Support',       symbol: 'support' },
    ],
  },
  {
    key: 'platform-ops',
    label: 'Platform Ops',
    symbol: 'settings_input_component',
    children: [
      { path: '/control-plane',    label: 'Control Plane',    symbol: 'memory',         roles: PLATFORM_ADMIN_ROLES },
      { path: '/deployments',      label: 'Deployments',      symbol: 'rocket_launch',  roles: SUPERADMIN_ROLES },
      { path: '/assessments',      label: 'Assessments',      symbol: 'fact_check',     roles: SUPERADMIN_ROLES },
      { path: '/platform-health',  label: 'Operations Health', symbol: 'health_metrics', roles: PLATFORM_ADMIN_ROLES },
      { path: '/system-alerts',    label: 'System Alerts',    symbol: 'notifications',  roles: PLATFORM_ADMIN_ROLES },
      { path: '/admin/incidents',  label: 'Incident Manager', symbol: 'report',         roles: SUPPORT_ROLES },
      { path: '/feature-flags',    label: 'Feature Flags',    symbol: 'flag',           roles: SUPERADMIN_ROLES },
    ],
  },
  {
    key: 'admin-tooling',
    label: 'Admin Tooling',
    symbol: 'construction',
    children: [
      { path: '/revenue',         label: 'Revenue',         symbol: 'payments',          roles: SUPERADMIN_ROLES },
      { path: '/support',         label: 'Support Console', symbol: 'support_agent',     roles: SUPPORT_ROLES },
      { path: '/support-triage',  label: 'Support Triage',  symbol: 'inbox_customize',   roles: PLATFORM_ADMIN_ROLES },
      { path: '/impersonate',     label: 'Impersonate',     symbol: 'manage_search',     roles: SUPPORT_ROLES },
    ],
  },
];

const FOOTER_ITEMS: NavLeaf[] = [
  { path: '/settings', label: 'Settings', symbol: 'settings' },
];

// ──────────────────────────────────────────────────────────────
// Components
// ──────────────────────────────────────────────────────────────

function MaterialIcon({ name, className = '', filled = false, size = 20 }: { name: string; className?: string; filled?: boolean; size?: number }) {
  return (
    <span
      className={cn('material-symbols-outlined', className)}
      style={{
        fontVariationSettings: filled
          ? "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24"
          : "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24",
        fontSize: `${size}px`,
        lineHeight: 1,
      }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}

interface SidebarSectionProps {
  section: NavSection;
  visible: NavLeaf[];
  isExpanded: boolean;
  isActiveSection: boolean;
  onToggle: () => void;
  closeMobile?: () => void;
  pathname: string;
}

function SidebarSection({ section, visible, isExpanded, isActiveSection, onToggle, closeMobile, pathname }: SidebarSectionProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2 rounded-md transition-colors duration-150',
          isActiveSection ? 't-primary' : 't-secondary hover:t-primary hover:bg-[var(--bg-secondary)]',
        )}
        style={isActiveSection ? { background: 'var(--accent-subtle)' } : undefined}
        aria-expanded={isExpanded}
        aria-controls={`section-${section.key}`}
      >
        <span className="flex items-center gap-3">
          <MaterialIcon name={section.symbol} size={18} filled={isActiveSection} className={isActiveSection ? 'text-accent' : ''} />
          <span className={cn('text-body-sm', isActiveSection ? 'font-semibold' : 'font-medium')}>{section.label}</span>
        </span>
        <ChevronDown
          size={14}
          className={cn('t-muted transition-transform duration-200', isExpanded ? 'rotate-0' : '-rotate-90')}
          aria-hidden="true"
        />
      </button>
      {isExpanded && (
        <ul id={`section-${section.key}`} className="mt-0.5 mb-1 pl-3 border-l border-[var(--border-card)] ml-4 space-y-0.5">
          {visible.map((leaf) => {
            const isActive = pathname === leaf.path || (leaf.path !== '/dashboard' && pathname.startsWith(leaf.path));
            return (
              <li key={leaf.path}>
                <Link
                  to={leaf.path}
                  onClick={closeMobile}
                  className={cn(
                    'flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-md text-body-sm transition-colors duration-150',
                    isActive
                      ? 'font-medium text-accent border-r-2 border-accent'
                      : 't-secondary hover:t-primary hover:bg-[var(--bg-secondary)]',
                  )}
                  style={isActive ? { background: 'var(--accent-subtle)' } : undefined}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <MaterialIcon name={leaf.symbol} size={16} className={isActive ? 'text-accent' : 't-muted'} />
                  <span className="truncate">{leaf.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AtheonSidebarLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="sbBg" x1="0" y1="0" x2="36" y2="36">
          <stop offset="0%" stopColor="#06090d" />
          <stop offset="100%" stopColor="#0e151c" />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="9" fill="url(#sbBg)" />
      <path d="M18 6L28 29H8L18 6Z" fill="none" stroke="#A3B18A" strokeWidth="1.5" />
      <line x1="11" y1="22" x2="25" y2="22" stroke="#A3B18A" strokeWidth=".8" opacity=".6" />
      <line x1="13" y1="16.5" x2="23" y2="16.5" stroke="#7EB3CD" strokeWidth=".8" opacity=".5" />
      <circle cx="18" cy="9.5" r="1.8" fill="#CDA37E" />
    </svg>
  );
}

/**
 * Returns the section key that owns the given route path, or null if none of
 * the section children match. Used to auto-expand the active section on load.
 */
function findActiveSection(pathname: string): SectionKey | null {
  for (const section of SECTIONS) {
    for (const child of section.children) {
      if (pathname === child.path || (child.path !== '/dashboard' && pathname.startsWith(child.path))) {
        return section.key;
      }
    }
  }
  return null;
}

export function Sidebar() {
  const { mobileSidebarOpen, setMobileSidebarOpen, user, theme } = useAppStore();
  const location = useLocation();
  const closeMobile = () => setMobileSidebarOpen(false);
  const userRole = user?.role as UserRole | undefined;

  // Track expanded sections. Default: only the section the user is currently
  // on is expanded. Subsequent toggles persist for the lifetime of the mount.
  const initialExpanded = useMemo<Set<SectionKey>>(() => {
    const active = findActiveSection(location.pathname);
    return new Set<SectionKey>(active ? [active] : ['intelligence']);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [expanded, setExpanded] = useState<Set<SectionKey>>(initialExpanded);

  // When the route changes, ensure the section that owns the new route is
  // expanded. Existing expanded sections stay open (additive).
  useEffect(() => {
    const active = findActiveSection(location.pathname);
    if (active && !expanded.has(active)) {
      setExpanded((prev) => new Set(prev).add(active));
    }
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSection = (key: SectionKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Pre-compute role-filtered children per section. Scoped read-only roles
  // (auditor, board_member) are restricted strictly to items that explicitly
  // opt them in — un-roled items (Dashboard, Support tickets) would
  // otherwise leak into their sidebar and defeat the narrow-scope intent.
  const sectionsForRender = useMemo(() => {
    const isScoped = userRole === 'auditor' || userRole === 'board_member';
    return SECTIONS.map((section) => ({
      section,
      visible: section.children.filter((c) => {
        if (isScoped) return !!(c.roles && userRole && c.roles.includes(userRole));
        return !c.roles || (userRole && c.roles.includes(userRole));
      }),
    })).filter((s) => s.visible.length > 0);
  }, [userRole]);

  const activeSectionKey = findActiveSection(location.pathname);
  const isDark = theme === 'dark';

  // Shared sidebar body (used by desktop + mobile drawer).
  // Logo target is role-aware — scoped read-only roles land on their own
  // home page (auditor → /compliance, board_member → /board-digest); others
  // go to the operational dashboard.
  const homeTarget =
    userRole === 'auditor' ? '/compliance'
    : userRole === 'board_member' ? '/board-digest'
    : '/dashboard';
  const sidebarBody = (
    <>
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <Link to={homeTarget} className="flex items-center gap-2.5" onClick={closeMobile}>
          <AtheonSidebarLogo />
          <div className="min-w-0">
            <p className="text-headline-md font-bold t-primary leading-none tracking-tight">Atheon AI</p>
            <p className="text-caption t-muted uppercase tracking-widest mt-1">Enterprise Intelligence</p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-3" aria-label="Primary navigation">
        <ul className="space-y-0.5">
          {sectionsForRender.map(({ section, visible }) => (
            <li key={section.key}>
              <SidebarSection
                section={section}
                visible={visible}
                isExpanded={expanded.has(section.key)}
                isActiveSection={activeSectionKey === section.key}
                onToggle={() => toggleSection(section.key)}
                closeMobile={closeMobile}
                pathname={location.pathname}
              />
            </li>
          ))}
        </ul>
      </nav>

      <ul className="border-t border-[var(--border-card)] pt-2 pb-3 px-3 space-y-0.5">
        {FOOTER_ITEMS.map((leaf) => {
          const isActive = location.pathname.startsWith(leaf.path);
          return (
            <li key={leaf.path}>
              <Link
                to={leaf.path}
                onClick={closeMobile}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-body-sm transition-colors duration-150',
                  isActive
                    ? 'font-semibold text-accent'
                    : 't-secondary hover:t-primary hover:bg-[var(--bg-secondary)]',
                )}
                style={isActive ? { background: 'var(--accent-subtle)' } : undefined}
                aria-current={isActive ? 'page' : undefined}
              >
                <MaterialIcon name={leaf.symbol} size={18} filled={isActive} className={isActive ? 'text-accent' : 't-muted'} />
                <span>{leaf.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );

  return (
    <>
      {mobileSidebarOpen && (
        <div
          className={cn("fixed inset-0 z-40 md:hidden", isDark ? "bg-black/60" : "bg-black/20")}
          onClick={closeMobile}
        />
      )}

      {/* Desktop — 240px sticky column with the Stitch 5-section IA */}
      <aside
        className="fixed left-0 top-0 h-full z-40 w-sidebar-expanded hidden md:flex flex-col transition-colors duration-200"
        style={{
          background: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border-card)',
          boxShadow: '2px 0 12px rgba(100, 120, 180, 0.06)',
        }}
        role="navigation"
        aria-label="Main navigation"
      >
        {sidebarBody}
      </aside>

      {/* Mobile drawer — same body, slides in from the left */}
      <aside
        className={cn(
          'fixed left-0 top-0 h-full z-50 flex flex-col transition-transform duration-300 w-72 md:hidden',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ background: 'var(--bg-modal)', borderRight: '1px solid var(--border-card)', boxShadow: '4px 0 24px rgba(100, 120, 180, 0.10)' }}
        role="navigation"
        aria-label="Mobile navigation"
        aria-hidden={!mobileSidebarOpen}
      >
        <div className="flex items-center justify-end px-4 pt-3">
          <button
            onClick={closeMobile}
            className="p-1.5 rounded-md t-muted hover:t-primary hover:bg-[var(--bg-secondary)] transition-all"
            title="Close navigation menu"
            aria-label="Close navigation menu"
          >
            <X size={18} />
          </button>
        </div>
        {sidebarBody}
      </aside>
    </>
  );
}
