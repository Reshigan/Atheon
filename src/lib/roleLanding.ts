/**
 * Role-aware post-login landing.
 *
 * Per the UX audit (docs/UX_AUDIT_AND_CONSOLIDATION_PLAN.md §5.6),
 * every role should land on a screen they can immediately act on,
 * not the generic six-panel Dashboard.
 *
 * Mapping is conservative — every destination is a page the role
 * can already access per `src/components/layout/Sidebar.tsx`'s
 * navItems gating. If we want to redirect a role somewhere stricter
 * later (e.g. operator → /transactional-actions once #383 lands),
 * we update this single file.
 *
 * Dashboard remains accessible for any role; this just changes the
 * DEFAULT post-login URL. Bookmarks + deep links continue to work.
 */

import type { UserRole } from '@/types';

/** Default post-login URL for a given role. */
export function defaultLandingForRole(role: UserRole): string {
  switch (role) {
    // VantaX-internal: support staff start their day looking at customer
    // tickets / health. Engineering's "platform" console is coming in Wave 7;
    // until then both internal roles share the support console.
    case 'superadmin':
    case 'support_admin':
      return '/support';

    // Customer-IT admins land where they actually do work — connections + adapters.
    case 'admin':
      return '/integrations';

    // Executive: Apex is the headline savings + risk surface. The
    // mobile-friendly brief (today /apex/brief, merged into /apex in Wave 2.2)
    // becomes the landing view.
    case 'executive':
      return '/apex';

    // Department heads triage red metrics on Pulse. Their "what should I
    // act on" is the Action-required tab there.
    case 'manager':
      return '/pulse';

    // Operators work the catalyst exception queue. (Once the merged action
    // queue from Wave 2.6 lands, swap this to /transactional-actions.)
    case 'operator':
      return '/catalysts';

    // Analysts ask Mind questions; the chat / playground is their entry point.
    case 'analyst':
      return '/mind';

    // Viewer has Dashboard + Settings only — Dashboard is the right home.
    case 'viewer':
      return '/dashboard';

    default:
      // Unknown role: fall back to the generic Dashboard. Defensive — every
      // role above should be exhaustive but if a new one gets added without
      // updating this map, we don't 404 the user.
      return '/dashboard';
  }
}
