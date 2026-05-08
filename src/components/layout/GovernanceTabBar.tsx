/**
 * GovernanceTabBar — visual consolidation across Audit / Compliance /
 * Data Governance.
 *
 * Per UX audit §5.4, these three pages all read from the same
 * audit_log + tenant_config tables but surface non-overlapping slices.
 * The full hub-page consolidation (one /governance route with four
 * tabs) is the larger Wave-4 refactor; this strip delivers the
 * "auditors and CISOs have one destination" feel without rewriting
 * any page bodies.
 */
import { Link, useLocation } from "react-router-dom";
import { ScrollText, ShieldCheck, Database } from "lucide-react";

interface GovernanceTab {
  path: string;
  label: string;
  icon: typeof ScrollText;
  sublabel: string;
}

const TABS: GovernanceTab[] = [
  { path: '/audit',           label: 'Audit Log',       icon: ScrollText,  sublabel: 'Action trail + provenance' },
  { path: '/compliance',      label: 'Compliance',      icon: ShieldCheck, sublabel: 'SOC 2 evidence pack' },
  { path: '/data-governance', label: 'Data Governance', icon: Database,    sublabel: 'Retention · DSAR · Encryption' },
];

export function GovernanceTabBar() {
  const location = useLocation();

  return (
    <nav
      className="flex items-center gap-1 overflow-x-auto pb-1"
      aria-label="Governance sub-navigation"
    >
      {TABS.map((t) => {
        const Icon = t.icon;
        const active =
          location.pathname === t.path ||
          (t.path !== '/' && location.pathname.startsWith(`${t.path}/`));
        return (
          <Link
            key={t.path}
            to={t.path}
            className="flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors"
            style={{
              background: active ? 'var(--accent-subtle)' : 'transparent',
              color: active ? 'var(--color-accent)' : 'var(--text-muted)',
              border: `1px solid ${active ? 'var(--color-accent)' : 'var(--border-card)'}`,
            }}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={12} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default GovernanceTabBar;
