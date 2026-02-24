import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Dashboard } from "@/pages/Dashboard";
import { ApexPage } from "@/pages/ApexPage";
import { PulsePage } from "@/pages/PulsePage";
import { CatalystsPage } from "@/pages/CatalystsPage";
import { MindPage } from "@/pages/MindPage";
import { MemoryPage } from "@/pages/MemoryPage";
import { ChatPage } from "@/pages/ChatPage";
import { ConnectivityPage } from "@/pages/ConnectivityPage";
import { AuditPage } from "@/pages/AuditPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TenantsPage } from "@/pages/TenantsPage";
import { IAMPage } from "@/pages/IAMPage";
import { ControlPlanePage } from "@/pages/ControlPlanePage";
import { CanonicalApiPage } from "@/pages/CanonicalApiPage";
import { ERPAdaptersPage } from "@/pages/ERPAdaptersPage";
import { LoginPage } from "@/pages/LoginPage";
import { useAppStore } from "@/stores/appStore";
import type { UserRole } from "@/types";

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

const ADMIN_ROLES: UserRole[] = ['admin', 'executive'];
const ALL_ROLES: UserRole[] = ['admin', 'executive', 'manager', 'analyst', 'operator'];

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/apex" element={<ApexPage />} />
          <Route path="/pulse" element={<PulsePage />} />
          <Route path="/catalysts" element={<ProtectedRoute allowedRoles={ALL_ROLES}><CatalystsPage /></ProtectedRoute>} />
          <Route path="/mind" element={<MindPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/connectivity" element={<ProtectedRoute allowedRoles={ADMIN_ROLES}><ConnectivityPage /></ProtectedRoute>} />
          <Route path="/audit" element={<ProtectedRoute allowedRoles={ADMIN_ROLES}><AuditPage /></ProtectedRoute>} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/tenants" element={<ProtectedRoute allowedRoles={ADMIN_ROLES}><TenantsPage /></ProtectedRoute>} />
          <Route path="/iam" element={<ProtectedRoute allowedRoles={ADMIN_ROLES}><IAMPage /></ProtectedRoute>} />
          <Route path="/control-plane" element={<ProtectedRoute allowedRoles={ADMIN_ROLES}><ControlPlanePage /></ProtectedRoute>} />
          <Route path="/canonical-api" element={<ProtectedRoute allowedRoles={ADMIN_ROLES}><CanonicalApiPage /></ProtectedRoute>} />
          <Route path="/erp-adapters" element={<ProtectedRoute allowedRoles={ADMIN_ROLES}><ERPAdaptersPage /></ProtectedRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
