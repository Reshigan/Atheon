import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { Plug, Globe, Layers } from "lucide-react";
import { ERPAdaptersPage } from "./ERPAdaptersPage";
import { CanonicalApiPage } from "./CanonicalApiPage";

/**
 * P2: Merged Integrations page combining ERP Adapters + Canonical API
 * Section 1: Connected Systems (ERP Adapters — connections + adapters)
 * Section 2: Canonical Data Schema (from CanonicalApiPage)
 */
export function IntegrationsPage() {
 const { activeTab, setActiveTab } = useTabState('connections');

 const tabs = [
  { id: 'connections', label: 'Connected Systems', icon: <Plug size={14} /> },
  { id: 'schema', label: 'Canonical Data Schema', icon: <Globe size={14} /> },
 ];

 return (
  <div className="space-y-6 animate-fadeIn">
   <div className="flex items-center gap-3">
    <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center">
     <Layers className="w-5 h-5 text-teal-400" />
    </div>
    <div>
     <h1 className="text-2xl font-bold t-primary">Integrations</h1>
     <p className="text-sm t-muted">ERP connections, adapters, and canonical data schema</p>
    </div>
   </div>

   <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

   {activeTab === 'connections' && (
    <TabPanel>
     <ERPAdaptersPage embedded />
    </TabPanel>
   )}

   {activeTab === 'schema' && (
    <TabPanel>
     <CanonicalApiPage embedded />
    </TabPanel>
   )}
  </div>
 );
}
