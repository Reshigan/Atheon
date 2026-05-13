import { lazy, Suspense } from "react";
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
const ApexPage = lazy(() => import("@/pages/ApexPage").then(m => ({ default: m.ApexPage })));
const ROIDashboardPage = lazy(() => import("@/pages/ROIDashboardPage"));
// ApexBriefPage retired 2026-05-12 — duplicated ExecutiveSummaryPage with
// a slimmer LLM-only layout. /apex/brief now redirects to /executive-summary.
const PulsePage = lazy(() => import("@/pages/PulsePage").then(m => ({ default: m.PulsePage })));
const CatalystsPage = lazy(() => import("@/pages/CatalystsPage").then(m => ({ default: m.CatalystsPage })));
const CatalystRunDetailPage = lazy(() => import("@/pages/CatalystRunDetailPage").then(m => ({ default: m.CatalystRunDetailPage })));
const MindPage = lazy(() => import("@/pages/MindPage").then(m => ({ default: m.MindPage })));
const MemoryPage = lazy(() => import("@/pages/MemoryPage").then(m => ({ default: m.MemoryPage })));
const ChatPage = lazy(() => import("@/pages/ChatPage").then(m => ({ default: m.ChatPage })));
const ConnectivityPage = lazy(() => import("@/pages/ConnectivityPage").then(m => ({ default: m.ConnectivityPage })));
// AuditPage no longer lazy-loaded here — CompliancePage imports it directly
// and renders it inside the "Audit Log" tab (May 2026 merge).
const TenantsPage = lazy(() => import("@/pages/TenantsPage").then(m => ({ default: m.TenantsPage })));
const IAMPage = lazy(() => import("@/pages/IAMPage").then(m => ({ default: m.IAMPage })));
const ControlPlanePage = lazy(() => import("@/pages/ControlPlanePage").then(m => ({ default: m.ControlPlanePage })));
const IntegrationsPage = lazy(() => import("@/pages/IntegrationsPage").then(m => ({ default: m.IntegrationsPage })));
const ActionLayerPage = lazy(() => import("@/pages/ActionLayerPage").then(m => ({ default: m.ActionLayerPage })));
const DeploymentsPage = lazy(() => import("@/pages/DeploymentsPage").then(m => ({ default: m.DeploymentsPage })));
const AssessmentsPage = lazy(() => import("@/pages/AssessmentsPage").then(m => ({ default: m.AssessmentsPage })));
const TenantManagementPage = lazy(() => import("@/pages/TenantManagementPage").then(m => ({ default: m.TenantManagementPage })));
const TenantLlmBudgetPage = lazy(() => import("@/pages/admin/TenantLlmBudgetPage").then(m => ({ default: m.TenantLlmBudgetPage })));
const ExecutiveSummaryPage = lazy(() => import("@/pages/ExecutiveSummaryPage").then(m => ({ default: m.ExecutiveSummaryPage })));
const PlatformHealthPage = lazy(() => import("@/pages/PlatformHealthPage").then(m => ({ default: m.PlatformHealthPage })));
const SupportConsolePage = lazy(() => import("@/pages/SupportConsolePage").then(m => ({ default: m.SupportConsolePage })));
// CompanyHealthPage no longer lazy-loaded here — PlatformHealthPage imports
// it directly and conditionally renders it based on role (May 2026 merge).
const ImpersonationPage = lazy(() => import("@/pages/ImpersonationPage").then(m => ({ default: m.ImpersonationPage })));
const BulkUserManagementPage = lazy(() => import("@/pages/BulkUserManagementPage").then(m => ({ default: m.BulkUserManagementPage })));
const CustomRoleBuilderPage = lazy(() => import("@/pages/CustomRoleBuilderPage").then(m => ({ default: m.CustomRoleBuilderPage })));
const RevenueUsagePage = lazy(() => import("@/pages/RevenueUsagePage").then(m => ({ default: m.RevenueUsagePage })));
const FeatureFlagsPage = lazy(() => import("@/pages/FeatureFlagsPage").then(m => ({ default: m.FeatureFlagsPage })));
// DataGovernancePage no longer lazy-loaded here — CompliancePage imports it
// directly and renders it inside the "Governance" tab (May 2026 merge).
const IntegrationHealthPage = lazy(() => import("@/pages/IntegrationHealthPage").then(m => ({ default: m.IntegrationHealthPage })));
const SystemAlertsPage = lazy(() => import("@/pages/SystemAlertsPage").then(m => ({ default: m.SystemAlertsPage })));
const WebhooksPage = lazy(() => import("@/pages/WebhooksPage").then(m => ({ default: m.WebhooksPage })));
const SupportPage = lazy(() => import("@/pages/SupportPage").then(m => ({ default: m.SupportPage })));
const SupportTicketDetailPage = lazy(() => import("@/pages/SupportTicketDetailPage").then(m => ({ default: m.SupportTicketDetailPage })));
const SupportTriagePage = lazy(() => import("@/pages/admin/SupportTriagePage").then(m => ({ default: m.SupportTriagePage })));
const TrustPerformancePage = lazy(() => import("@/pages/TrustPerformancePage"));
const OnboardingWizardPage = lazy(() => import("@/pages/OnboardingWizardPage"));
const PricingPage = lazy(() => import("@/pages/PricingPage"));
const CompliancePage = lazy(() => import("@/pages/CompliancePage"));

/**
 * 3.10: Role-based frontend route protection
 * Only admin and executive roles can access platform management pages
 */
function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: UserRole[] }) {
  const user = useAppStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(user.role)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <h2 className="text-xl font-semibold text-white">Access Denied</h2>
          <p className="text-sm text-gray-500">You do not have permission to access this page.</p>
          <p className="text-xs text-gray-400">Required role: {allowedRoles.join(', ')}</p>
        </div>
      </div>
    );
  }
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
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            {/* Guided onboarding wizard — full-screen version of the
                Dashboard's OnboardingChecklist, walks the user through the
                7 week-1 stop-gates with deep-link CTAs. Open to all auth users
                (the checklist itself is per-user, not per-tenant). */}
            <Route path="/onboarding" element={<OnboardingWizardPage />} />
            <Route path="/apex" element={<ProtectedRoute allowedRoles={EXECUTIVE_ROLES}><ApexPage /></ProtectedRoute>} />
            {/* Phase 10-23: ROI / Insights dashboard surfacing billing,
                forecast accuracy, calibration, and DSAR summaries. */}
            <Route path="/roi-dashboard" element={<ProtectedRoute allowedRoles={EXECUTIVE_ROLES}><ROIDashboardPage /></ProtectedRoute>} />
            {/* ApexBriefPage retired (see commit 2026-05-12 frontend
                consolidation). Same data lives on /executive-summary
                which uses a single backend endpoint + cleaner layout. */}
            <Route path="/apex/brief" element={<Navigate to="/executive-summary" replace />} />
            <Route path="/pulse" element={<ProtectedRoute allowedRoles={STANDARD_ROLES}><PulsePage /></ProtectedRoute>} />
            <Route path="/catalysts" element={<ProtectedRoute allowedRoles={OPERATOR_ROLES}><CatalystsPage /></ProtectedRoute>} />
            <Route path="/catalysts/runs/:runId" element={<ProtectedRoute allowedRoles={OPERATOR_ROLES}><CatalystRunDetailPage /></ProtectedRoute>} />
            <Route path="/mind" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><MindPage /></ProtectedRoute>} />
            <Route path="/memory" element={<ProtectedRoute allowedRoles={MANAGER_ROLES}><MemoryPage /></ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute allowedRoles={STANDARD_ROLES}><ChatPage /></ProtectedRoute>} />
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
            <Route path="/compliance" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><CompliancePage /></ProtectedRoute>} />
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
            <Route path="/webhooks" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><WebhooksPage /></ProtectedRoute>} />
            <Route path="/webhooks/:webhookId" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><WebhooksPage /></ProtectedRoute>} />
            {/* v48: Support ticket system — all authenticated users can file tickets;
                admins use the triage view for tenant-wide management. */}
            <Route path="/support-tickets" element={<SupportPage />} />
            <Route path="/support-tickets/:id" element={<SupportTicketDetailPage />} />
            <Route path="/support-triage" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><SupportTriagePage /></ProtectedRoute>} />
          </Route>
        </Routes>
      </Suspense>
      </BrandProvider>
    </BrowserRouter>
  );
}
