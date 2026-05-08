/**
 * TenantContextBanner — sticky "viewing as" indicator for VantaX-internal staff.
 *
 * Per UX audit §3.4 + §5.5: when a superadmin / support_admin sets the
 * tenantOverrideId (via the existing tenant switcher / impersonation flow),
 * every page they hit afterward operates in that tenant's context. Today
 * that override has no visible UI signal, so it's easy to forget you're
 * "viewing as" someone else.
 *
 * The banner:
 *   - only renders when an internal-staff role has a tenant override active
 *   - sits at the top of every authenticated page (above the breadcrumbs)
 *   - shows the tenant name + a one-click Clear button
 *
 * The clear action resets the Zustand override, the api-client tenant
 * override (so subsequent requests stop carrying ?tenant_id=…), and
 * reloads the page so any in-flight tenant-scoped data is dropped.
 */
import { Eye, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { setTenantOverride } from "@/lib/api";

const INTERNAL_ROLES = new Set(['superadmin', 'support_admin']);

export function TenantContextBanner() {
  const user = useAppStore((s) => s.user);
  const activeTenantId = useAppStore((s) => s.activeTenantId);
  const activeTenantName = useAppStore((s) => s.activeTenantName);
  const setActiveTenant = useAppStore((s) => s.setActiveTenant);

  // Only show for internal staff with an active override that's NOT their own tenant.
  if (!user || !INTERNAL_ROLES.has(user.role)) return null;
  if (!activeTenantId || activeTenantId === user.tenantId) return null;

  const clearContext = () => {
    setActiveTenant(null, null, null);
    setTenantOverride(null);
    // Force a reload so any in-flight cached tenant-scoped data is dropped.
    // Cheap; happens once per context-clear, not per render.
    window.location.reload();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-12 z-30 -mx-4 sm:-mx-5 lg:-mx-6 mb-4 px-4 sm:px-5 lg:px-6 py-2 flex items-center gap-2 text-xs"
      style={{
        background: 'rgba(245, 158, 11, 0.12)',
        borderBottom: '1px solid rgba(245, 158, 11, 0.35)',
        color: '#fbbf24',
      }}
    >
      <Eye size={12} className="flex-shrink-0" />
      <span>
        Viewing as <strong className="font-semibold">{activeTenantName ?? activeTenantId}</strong>
        <span className="opacity-70"> · all data and actions on this session apply to this tenant.</span>
      </span>
      <button
        type="button"
        onClick={clearContext}
        className="ml-auto flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium hover:bg-amber-500/20"
        title="Clear tenant context — return to your own tenant"
      >
        <X size={11} /> Clear context
      </button>
    </div>
  );
}

export default TenantContextBanner;
