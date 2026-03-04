/**
 * U5: Breadcrumb navigation component for all inner pages
 */
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  apex: 'Apex',
  pulse: 'Pulse',
  catalysts: 'Catalysts',
  mind: 'Mind',
  memory: 'Memory',
  chat: 'Chat',
  connectivity: 'Connectivity',
  audit: 'Audit',
  settings: 'Settings',
  tenants: 'Tenants',
  iam: 'IAM',
  'control-plane': 'Control Plane',
  'canonical-api': 'Canonical API',
  'erp-adapters': 'ERP Adapters',
};

export function Breadcrumbs() {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs t-muted mb-4">
      <Link
        to="/dashboard"
        className="flex items-center gap-1 hover:text-[var(--accent)] transition-colors"
        aria-label="Home"
      >
        <Home size={12} />
      </Link>
      {segments.map((segment, idx) => {
        const path = '/' + segments.slice(0, idx + 1).join('/');
        const label = ROUTE_LABELS[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);
        const isLast = idx === segments.length - 1;

        return (
          <span key={path} className="flex items-center gap-1.5">
            <ChevronRight size={10} className="opacity-40" />
            {isLast ? (
              <span className="font-medium t-primary" aria-current="page">{label}</span>
            ) : (
              <Link to={path} className="hover:text-[var(--accent)] transition-colors">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
