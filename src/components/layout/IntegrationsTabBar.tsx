/**
 * IntegrationsTabBar — visual consolidation across the integration domain.
 *
 * Per UX audit §5.3, the four integration-domain pages
 * (Integrations / Connectivity / Integration Health / Webhooks +
 * Partner Mappings when #379 lands) should feel like one workspace.
 * The full route + page consolidation is queued in audit Wave 3 as a
 * larger refactor; this component delivers the workspace feel without
 * rewriting any page bodies — render this strip at the top of each
 * integration-domain page and the user can switch between them in
 * one click.
 *
 * Active-tab detection uses startsWith so child routes like
 * /webhooks/:id keep the parent "Webhooks" tab highlighted.
 */
import { Link, useLocation } from "react-router-dom";
import { Plug, Activity, Zap, Workflow, Link2 } from "lucide-react";

interface IntegrationTab {
  path: string;
  label: string;
  icon: typeof Plug;
  sublabel?: string;
}

const TABS: IntegrationTab[] = [
  { path: '/integrations',       label: 'Connections',        icon: Plug,     sublabel: 'Adapters & schema' },
  { path: '/integration-health', label: 'Sync Health',        icon: Activity, sublabel: 'Errors & freshness' },
  { path: '/connectivity',       label: 'Live Connectivity',  icon: Zap,      sublabel: 'Circuit & test' },
  // /partner-mappings ships in unmerged PR #379 — kept here so the bar
  // already accommodates it once that lands. If the route 404s today
  // (because #379 isn't merged yet on this clone), the link still
  // navigates and React Router falls through to the default page.
  { path: '/partner-mappings',   label: 'Partner Mappings',   icon: Link2,    sublabel: 'ERP ID reconciliation' },
  { path: '/webhooks',           label: 'Webhooks',           icon: Workflow, sublabel: 'Event subscriptions' },
];

export function IntegrationsTabBar() {
  const location = useLocation();

  return (
    <nav
      className="flex items-center gap-1 overflow-x-auto pb-1"
      aria-label="Integrations sub-navigation"
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

export default IntegrationsTabBar;
