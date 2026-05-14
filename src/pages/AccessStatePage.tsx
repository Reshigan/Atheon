/**
 * AccessStatePage — Stitch-styled "System — Access Denied (403)" + 404.
 *
 * One component, two surfaces. Centred card on the page-pattern radial
 * gradient (the Stitch body background). Material Symbols icon, sage
 * accent tile, headline-xl title, body copy, primary CTA back to the
 * dashboard.
 *
 * Used by:
 *   - ProtectedRoute when a role check fails ({kind: '403'})
 *   - The catch-all `<Route path="*">` at the bottom of App.tsx ({kind: '404'})
 */
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

interface AccessStatePageProps {
  kind: '403' | '404';
  /** Optional list of roles that *would* satisfy this route (403 only). */
  requiredRoles?: string[];
}

const COPY = {
  '403': {
    symbol: 'block',
    title: 'Access Denied',
    code: '403',
    body: "You don't have permission to access this page. If you think this is wrong, ask your tenant admin to grant your role the required permissions.",
    cta: 'Back to Dashboard',
  },
  '404': {
    symbol: 'travel_explore',
    title: 'Page not found',
    code: '404',
    body: "The page you're looking for doesn't exist, or has been moved. Check the URL or head back to the dashboard.",
    cta: 'Back to Dashboard',
  },
} as const;

export function AccessStatePage({ kind, requiredRoles }: AccessStatePageProps): JSX.Element {
  const c = COPY[kind];
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 sm:px-6"
      style={{
        background: 'var(--bg-primary)',
        backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(163, 177, 138, 0.06) 0%, transparent 70%)',
        backgroundAttachment: 'fixed',
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-7 sm:p-8 text-center"
        style={{
          background: 'var(--bg-card-solid)',
          border: '1px solid var(--border-card)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div className="flex flex-col items-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 border"
            style={{
              background: 'rgba(163, 177, 138, 0.10)',
              borderColor: 'rgba(163, 177, 138, 0.25)',
            }}
            aria-hidden="true"
          >
            <span
              className="material-symbols-outlined"
              style={{
                fontVariationSettings: "'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 24",
                fontSize: 28,
                color: 'var(--accent)',
                lineHeight: 1,
              }}
            >
              {c.symbol}
            </span>
          </div>

          <p className="text-caption uppercase tracking-widest t-muted font-mono mb-1">Error {c.code}</p>
          <h1 className="text-headline-xl font-bold t-primary tracking-tight leading-tight mb-3">{c.title}</h1>
          <p className="text-body-sm t-muted max-w-sm leading-relaxed">{c.body}</p>

          {kind === '403' && requiredRoles && requiredRoles.length > 0 && (
            <p className="text-caption font-mono t-muted mt-4">
              Required role{requiredRoles.length === 1 ? '' : 's'}: {requiredRoles.join(', ')}
            </p>
          )}

          <Link to="/dashboard" className="block mt-6 w-full">
            <Button variant="primary" size="md" className="w-full">
              {c.cta}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default AccessStatePage;
