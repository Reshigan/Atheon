import { BrowserRouter, Routes, Route } from "react-router-dom";
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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/apex" element={<ApexPage />} />
          <Route path="/pulse" element={<PulsePage />} />
          <Route path="/catalysts" element={<CatalystsPage />} />
          <Route path="/mind" element={<MindPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/connectivity" element={<ConnectivityPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/tenants" element={<TenantsPage />} />
          <Route path="/iam" element={<IAMPage />} />
          <Route path="/control-plane" element={<ControlPlanePage />} />
          <Route path="/canonical-api" element={<CanonicalApiPage />} />
          <Route path="/erp-adapters" element={<ERPAdaptersPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
