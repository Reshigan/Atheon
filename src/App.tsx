import { Suspense } from "react";
import { lazyWithRetry } from "@/lib/lazy-with-retry";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

// Eager-loaded — needed on first paint regardless of where the user lands:
// app shell, public entry points, and a thin set of pages that we don't
// want to wait on a chunk fetch for (Dashboard is the post-login landing).
import { AppLayout } from "@/components/layout/AppLayout";
import { BrandProvider } from "@/components/layout/BrandProvider";
import { Dashboard } from "@/pages/Dashboard";
import { LoginPage } from "@/pages/LoginPage";
import { MarketingPage } from "@/pages/MarketingPage";
import { TrialPage } from "@/pages/TrialPage";
import { VerifyEmailPage } from "@/pages/VerifyEmailPage";
import { ERPOAuthCallbackPage } from "@/pages/ERPOAuthCallbackPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { MFASetupPage } from "@/pages/MFASetupPage";
import { useAppStore } from "@/stores/appStore";
import type { UserRole } from "@/types";

// Lazy — every other page. Most are 200–2000-line tab-pages whose code +
// dependencies (heavy chart / table libs) blow up the main chunk if loaded
// up-front. The named-to-default adapter is needed because most pages use
// named exports.
const ApexPage = lazyWithRetry(() => import("@/pages/ApexPage").then(m => ({ default: m.ApexPage })));
const ROIDashboardPage = lazyWithRetry(() => import("@/pages/ROIDashboardPage"));
const BoardDigestPage = lazyWithRetry(() => import("@/pages/BoardDigestPage"));
const StatusPage = lazyWithRetry(() => import("@/pages/StatusPage"));
const SecurityPage = lazyWithRetry(() => import("@/pages/SecurityPage"));
const ConnectorsPage = lazyWithRetry(() => import("@/pages/ConnectorsPage"));
const PerformancePage = lazyWithRetry(() => import("@/pages/PerformancePage"));
const AuditSharePage = lazyWithRetry(() => import("@/pages/AuditSharePage"));
const StatusIncidentsAdminPage = lazyWithRetry(() => import("@/pages/admin/StatusIncidentsAdminPage"));
// ApexBriefPage retired 2026-05-12 — duplicated ExecutiveSummaryPage with
// a slimmer LLM-only layout. /apex/brief now redirects to /executive-summary.
const PulsePage = lazyWithRetry(() => import("@/pages/PulsePage").then(m => ({ default: m.PulsePage })));
const CatalystsPage = lazyWithRetry(() => import("@/pages/CatalystsPage").then(m => ({ default: m.CatalystsPage })));
const CatalystRunDetailPage = lazyWithRetry(() => import("@/pages/CatalystRunDetailPage").then(m => ({ default: m.CatalystRunDetailPage })));
const MindPage = lazyWithRetry(() => import("@/pages/MindPage").then(m => ({ default: m.MindPage })));
const MemoryPage = lazyWithRetry(() => import("@/pages/MemoryPage").then(m => ({ default: m.MemoryPage })));
const ConnectivityPage = lazyWithRetry(() => import("@/pages/ConnectivityPage").then(m => ({ default: m.ConnectivityPage })));
// AuditPage no longer lazy-loaded here — CompliancePage imports it directly
// and renders it inside the "Audit Log" tab (May 2026 merge).
const TenantsPage = lazyWithRetry(() => import("@/pages/TenantsPage").then(m => ({ default: m.TenantsPage })));
const IAMPage = lazyWithRetry(() => import("@/pages/IAMPage").then(m => ({ default: m.IAMPage })));
const ControlPlanePage = lazyWithRetry(() => import("@/pages/ControlPlanePage").then(m => ({ default: m.ControlPlanePage })));
const IntegrationsPage = lazyWithRetry(() => import("@/pages/IntegrationsPage").then(m => ({ default: m.IntegrationsPage })));
const ActionLayerPage = lazyWithRetry(() => import("@/pages/ActionLayerPage").then(m => ({ default: m.ActionLayerPage })));
const AccessStatePage = lazyWithRetry(() => import("@/pages/AccessStatePage").then(m => ({ default: m.AccessStatePage })));
const DeploymentsPage = lazyWithRetry(() => import("@/pages/DeploymentsPage").then(m => ({ default: m.DeploymentsPage })));
const AssessmentsPage = lazyWithRetry(() => import("@/pages/AssessmentsPage").then(m => ({ default: m.AssessmentsPage })));
const TenantManagementPage = lazyWithRetry(() => import("@/pages/TenantManagementPage").then(m => ({ default: m.TenantManagementPage })));
const TenantLlmBudgetPage = lazyWithRetry(() => import("@/pages/admin/TenantLlmBudgetPage").then(m => ({ default: m.TenantLlmBudgetPage })));
const ExecutiveSummaryPage = lazyWithRetry(() => import("@/pages/ExecutiveSummaryPage").then(m => ({ default: m.ExecutiveSummaryPage })));
const PlatformHealthPage = lazyWithRetry(() => import("@/pages/PlatformHealthPage").then(m => ({ default: m.PlatformHealthPage })));
const SupportConsolePage = lazyWithRetry(() => import("@/pages/SupportConsolePage").then(m => ({ default: m.SupportConsolePage })));
// CompanyHealthPage no longer lazy-loaded here — PlatformHealthPage imports
// it directly and conditionally renders it based on role (May 2026 merge).
const ImpersonationPage = lazyWithRetry(() => import("@/pages/ImpersonationPage").then(m => ({ default: m.ImpersonationPage })));
const BulkUserManagementPage = lazyWithRetry(() => import("@/pages/BulkUserManagementPage").then(m => ({ default: m.BulkUserManagementPage })));
const CustomRoleBuilderPage = lazyWithRetry(() => import("@/pages/CustomRoleBuilderPage").then(m => ({ default: m.CustomRoleBuilderPage })));
const RevenueUsagePage = lazyWithRetry(() => import("@/pages/RevenueUsagePage").then(m => ({ default: m.RevenueUsagePage })));
const FeatureFlagsPage = lazyWithRetry(() => import("@/pages/FeatureFlagsPage").then(m => ({ default: m.FeatureFlagsPage })));
// DataGovernancePage no longer lazy-loaded here — CompliancePage imports it
// directly and renders it inside the "Governance" tab (May 2026 merge).
const IntegrationHealthPage = lazyWithRetry(() => import("@/pages/IntegrationHealthPage").then(m => ({ default: m.IntegrationHealthPage })));
const SystemAlertsPage = lazyWithRetry(() => import("@/pages/SystemAlertsPage").then(m => ({ default: m.SystemAlertsPage })));
const WebhooksPage = lazyWithRetry(() => import("@/pages/WebhooksPage").then(m => ({ default: m.WebhooksPage })));
const SupportPage = lazyWithRetry(() => import("@/pages/SupportPage").then(m => ({ default: m.SupportPage })));
const SupportTicketDetailPage = lazyWithRetry(() => import("@/pages/SupportTicketDetailPage").then(m => ({ default: m.SupportTicketDetailPage })));
const SupportTriagePage = lazyWithRetry(() => import("@/pages/admin/SupportTriagePage").then(m => ({ default: m.SupportTriagePage })));
const TrustPerformancePage = lazyWithRetry(() => import("@/pages/TrustPerformancePage"));
const OnboardingWizardPage = lazyWithRetry(() => import("@/pages/OnboardingWizardPage"));
const PricingPage = lazyWithRetry(() => import("@/pages/PricingPage"));
const CompliancePage = lazyWithRetry(() => import("@/pages/CompliancePage"));

/**
 * 3.10: Role-based frontend route protection
 * Only admin and executive roles can access platform management pages
 */
function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: UserRole[] }) {
  const user = useAppStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(user.role)) {
    return <AccessStatePage kind="403" requiredRoles={allowedRoles} />;
  }
  return <>{children}</>;
}

/**
 * Phase AT/AU: silently redirects scoped read-only roles away from
 * operational surfaces. Auditors and board members both have narrow
 * scopes; if they deep-link into an operational route (/dashboard, etc.)
 * we redirect them to their landing page instead of rendering a 403
 * — less alarming for a shared link.
 */
function ScopedRoleRedirect({ children }: { children: React.ReactNode }) {
  const user = useAppStore((s) => s.user);
  if (user?.role === 'auditor') return <Navigate to="/compliance" replace />;
  if (user?.role === 'board_member') return <Navigate to="/board-digest" replace />;
  return <>{children}</>;
}

/** Lightweight loader shown while a lazy-loaded route's chunk is fetching. */
function RouteLoader() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <Loader2 className="w-6 h-6 text-accent animate-spin" />
    </div>
  );
}

const SUPERADMIN_ROLES: UserRole[] = ['superadmin'];
const SUPPORT_ROLES: UserRole[] = ['superadmin', 'support_admin'];
const PLATFORM_ADMIN_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin'];
const EXECUTIVE_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive'];
const MANAGER_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager'];
const OPERATOR_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'operator'];
const STANDARD_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'analyst', 'operator'];
// Phase AT: `auditor` role — read-only access scoped to /compliance only.
// Procurement + legal need to point external auditors (PwC/Deloitte etc.) at
// the SOC 2 evidence pack + audit log WITHOUT giving them executive scope.
// COMPLIANCE_ROLES adds auditor on top of PLATFORM_ADMIN_ROLES so the route
// gate accepts both populations.
const COMPLIANCE_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'auditor'];
// Phase AU: `board_member` role — quarterly digest only. Audit committee +
// board directors don't need (and procurement won't approve) executive-grade
// operational access. BOARD_DIGEST_ROLES gates the digest landing page;
// every other route stays gated to its prior bucket so a board member sees
// nothing else.
const BOARD_DIGEST_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'board_member'];

export default function App() {
  return (
    <BrowserRouter>
      <BrandProvider>
      <Suspense fallback={<RouteLoader />}>
        <Routes>
          <Route path="/" element={<MarketingPage />} />
          {/* Public pricing page — public so prospects can land on it from
              the marketing site, and so trial users can navigate to it
              from the upgrade banner without being logged in. */}
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset-password" element={<LoginPage />} />
          <Route path="/trial" element={<TrialPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/erp/oauth/callback" element={<ERPOAuthCallbackPage />} />
          {/* Phase AZ: public platform status + incident timeline. No
              auth — procurement teams probe this URL during vendor risk
              assessments. Polls /api/status every 30s. */}
          <Route path="/status" element={<StatusPage />} />
          {/* Phase BA: public security overview + sub-processor list +
              DPA contact. No auth — vendor-risk teams need this URL
              before they engage. Crawler-friendly for SEO discoverability. */}
          <Route path="/legal/security" element={<SecurityPage />} />
          <Route path="/security" element={<SecurityPage />} />
          {/* Phase BB: public connector conformance matrix. Procurement +
              CIOs probe this before vendor engagement. Honest GA/Beta/
              Preview/On-request levels per connector. */}
          <Route path="/legal/connectors" element={<ConnectorsPage />} />
          <Route path="/connectors" element={<ConnectorsPage />} />
          {/* Phase BD: public load-test datasheet — real numbers + the
              regressions caught & fixed during the load-test pass. */}
          <Route path="/legal/performance" element={<PerformancePage />} />
          <Route path="/performance" element={<PerformancePage />} />
          {/* Public auditor-facing read-only SOC 2 evidence pack.
              Token in URL is the credential — no login. Issued via
              "Share with auditor" on /compliance. 7-day expiry,
              revocable, access-logged on every fetch. */}
          <Route path="/audit-share/:token" element={<AuditSharePage />} />
          <Route element={<AppLayout />}>
            {/* Operational dashboard — open to every role except the
                scoped read-only ones (auditor, board_member), which get
                redirected to their own landing page instead of seeing
                operational data they shouldn't have access to. */}
            <Route path="/dashboard" element={<ScopedRoleRedirect><Dashboard /></ScopedRoleRedirect>} />
            {/* Guided onboarding wizard — full-screen version of the
                Dashboard's OnboardingChecklist, walks the user through the
                7 week-1 stop-gates with deep-link CTAs. Open to all auth users
                (the checklist itself is per-user, not per-tenant). */}
            <Route path="/onboarding" element={<OnboardingWizardPage />} />
            <Route path="/apex" element={<ProtectedRoute allowedRoles={EXECUTIVE_ROLES}><ApexPage /></ProtectedRoute>} />
            {/* Phase 10-23: ROI / Insights dashboard surfacing billing,
                forecast accuracy, calibration, and DSAR summaries. */}
            <Route path="/roi-dashboard" element={<ProtectedRoute allowedRoles={EXECUTIVE_ROLES}><ROIDashboardPage /></ProtectedRoute>} />
            {/* Phase AU: Quarterly digest for Board Members + Audit Committee.
                Open to executives so they can preview what the board sees. */}
            <Route path="/board-digest" element={<ProtectedRoute allowedRoles={BOARD_DIGEST_ROLES}><BoardDigestPage /></ProtectedRoute>} />
            {/* ApexBriefPage retired (see commit 2026-05-12 frontend
                consolidation). Same data lives on /executive-summary
                which uses a single backend endpoint + cleaner layout. */}
            <Route path="/apex/brief" element={<Navigate to="/executive-summary" replace />} />
            <Route path="/pulse" element={<ProtectedRoute allowedRoles={STANDARD_ROLES}><PulsePage /></ProtectedRoute>} />
            <Route path="/catalysts" element={<ProtectedRoute allowedRoles={OPERATOR_ROLES}><CatalystsPage /></ProtectedRoute>} />
            <Route path="/catalysts/runs/:runId" element={<ProtectedRoute allowedRoles={OPERATOR_ROLES}><CatalystRunDetailPage /></ProtectedRoute>} />
            <Route path="/mind" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><MindPage /></ProtectedRoute>} />
            <Route path="/memory" element={<ProtectedRoute allowedRoles={MANAGER_ROLES}><MemoryPage /></ProtectedRoute>} />
            {/* Backend gates /api/v1/connectivity to superadmin + support_admin + admin
                (workers/api/src/index.ts platformAdminRoutePrefixes); aligning the
                frontend guard so support_admin can reach the page. */}
            <Route path="/connectivity" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><ConnectivityPage /></ProtectedRoute>} />
            {/* /audit retired 2026-05-12 — now lives under /compliance Audit Log tab */}
            <Route path="/audit" element={<Navigate to="/compliance" replace />} />
            {/* SOC 2 control evidence pack — read-only aggregation over
                audit_log + IAM + support tables. Admin+ for own tenant;
                support_admin / superadmin for cross-tenant via the existing
                tenant switcher. Backend enforces role + cross-tenant rules. */}
            <Route path="/compliance" element={<ProtectedRoute allowedRoles={COMPLIANCE_ROLES}><CompliancePage /></ProtectedRoute>} />
            {/* Trust & Performance — buyer-facing aggregation of calibration,
                provenance, and federated peer patterns. Open to standard roles
                so a salesperson with a viewer login can demo it. */}
            <Route path="/trust" element={<ProtectedRoute allowedRoles={STANDARD_ROLES}><TrustPerformancePage /></ProtectedRoute>} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/mfa" element={<MFASetupPage />} />
            <Route path="/admin/tenants" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><TenantManagementPage /></ProtectedRoute>} />
            <Route path="/admin/tenants/:id/llm" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><TenantLlmBudgetPage /></ProtectedRoute>} />
            <Route path="/tenants" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><TenantsPage /></ProtectedRoute>} />
            <Route path="/iam" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><IAMPage /></ProtectedRoute>} />
            {/* Backend gates /api/v1/controlplane to superadmin + support_admin + admin;
                aligning frontend so support_admin can configure agents and catalysts. */}
            <Route path="/control-plane" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><ControlPlanePage /></ProtectedRoute>} />
            <Route path="/integrations" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><IntegrationsPage /></ProtectedRoute>} />
            <Route path="/action-layer" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><ActionLayerPage /></ProtectedRoute>} />
            <Route path="/canonical-api" element={<Navigate to="/integrations" replace />} />
            <Route path="/erp-adapters" element={<Navigate to="/integrations" replace />} />
            <Route path="/deployments" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><DeploymentsPage /></ProtectedRoute>} />
            <Route path="/assessments" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><AssessmentsPage /></ProtectedRoute>} />
            {/* /executive was the retired ExecutiveMobilePage — now consolidated
                into the responsive ApexPage (mobile KPI strip, pull-to-refresh,
                and tight 3-card above-fold layout). Redirect preserves old links. */}
            <Route path="/executive" element={<Navigate to="/apex" replace />} />
            <Route path="/executive-summary" element={<ProtectedRoute allowedRoles={EXECUTIVE_ROLES}><ExecutiveSummaryPage /></ProtectedRoute>} />
            {/* Admin Tooling Routes (ADMIN-001 to ADMIN-012) */}
            {/* /platform-health is the canonical "Operations Health" URL —
                role-conditional inside the component: superadmin sees
                infra/tenants/alerts; non-superadmin admins see the
                CompanyHealth content (adoption/catalysts/LLM/entitlements).
                Relaxed to PLATFORM_ADMIN_ROLES so both audiences land here. */}
            <Route path="/platform-health" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><PlatformHealthPage /></ProtectedRoute>} />
            <Route path="/support" element={<ProtectedRoute allowedRoles={SUPPORT_ROLES}><SupportConsolePage /></ProtectedRoute>} />
            {/* /company-health retired 2026-05-12 — see UI_POLISH_PRINCIPLES §6.2 */}
            <Route path="/company-health" element={<Navigate to="/platform-health" replace />} />
            <Route path="/impersonate" element={<ProtectedRoute allowedRoles={SUPPORT_ROLES}><ImpersonationPage /></ProtectedRoute>} />
            <Route path="/bulk-users" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><BulkUserManagementPage /></ProtectedRoute>} />
            <Route path="/custom-roles" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><CustomRoleBuilderPage /></ProtectedRoute>} />
            <Route path="/revenue" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><RevenueUsagePage /></ProtectedRoute>} />
            <Route path="/feature-flags" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><FeatureFlagsPage /></ProtectedRoute>} />
            {/* /data-governance retired 2026-05-12 — now lives under /compliance Governance tab */}
            <Route path="/data-governance" element={<Navigate to="/compliance" replace />} />
            <Route path="/integration-health" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><IntegrationHealthPage /></ProtectedRoute>} />
            <Route path="/system-alerts" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><SystemAlertsPage /></ProtectedRoute>} />
            {/* Phase BC: incident manager for the public /status page.
                Superadmin/support_admin gated inside the page; ProtectedRoute
                here is the outer floor. */}
            <Route path="/admin/incidents" element={<ProtectedRoute allowedRoles={SUPPORT_ROLES}><StatusIncidentsAdminPage /></ProtectedRoute>} />
            <Route path="/webhooks" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><WebhooksPage /></ProtectedRoute>} />
            <Route path="/webhooks/:webhookId" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><WebhooksPage /></ProtectedRoute>} />
            {/* v48: Support ticket system — all authenticated users can file tickets;
                admins use the triage view for tenant-wide management. */}
            <Route path="/support-tickets" element={<SupportPage />} />
            <Route path="/support-tickets/:id" element={<SupportTicketDetailPage />} />
            <Route path="/support-triage" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><SupportTriagePage /></ProtectedRoute>} />
          </Route>

          {/* Catch-all 404 — last route, lives outside AppLayout so the
              standalone error surface renders without the sidebar/header. */}
          <Route path="*" element={<AccessStatePage kind="404" />} />
        </Routes>
      </Suspense>
      </BrandProvider>
    </BrowserRouter>
  );
}
