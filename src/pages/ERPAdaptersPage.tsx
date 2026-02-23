import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { erpAdapters, erpConnections } from "@/data/tenantData";
import {
  Plug, CheckCircle, XCircle, RefreshCw, Plus, Database,
  Activity, AlertTriangle
} from "lucide-react";

const systemIcons: Record<string, string> = {
  SAP: '🔷', SF: '☁️', WD: '🟣', ORC: '🔴', D365: '🟢', NS: '🟠', SG: '🟤', API: '🔌',
};

export function ERPAdaptersPage() {
  const { activeTab, setActiveTab } = useTabState('adapters');

  const tabs = [
    { id: 'adapters', label: 'Available Adapters', icon: <Plug size={14} />, count: erpAdapters.length },
    { id: 'connections', label: 'Active Connections', icon: <Database size={14} />, count: erpConnections.length },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center">
            <Plug className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">ERP Adapter Layer</h1>
            <p className="text-sm text-neutral-400">Pluggable adapters for enterprise system connectivity</p>
          </div>
        </div>
        <Button variant="primary" size="sm"><Plus size={14} /> Connect ERP</Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <span className="text-xs text-neutral-500">Available Adapters</span>
          <p className="text-2xl font-bold text-white mt-1">{erpAdapters.length}</p>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">Active Connections</span>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{erpConnections.filter(c => c.status === 'connected').length}</p>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">Entities Synced</span>
          <p className="text-2xl font-bold text-white mt-1">{(erpConnections.reduce((s, c) => s + c.syncStatus.entitiesSynced, 0) / 1000).toFixed(1)}K</p>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">Total Throughput</span>
          <p className="text-2xl font-bold text-white mt-1">{erpConnections.reduce((s, c) => s + c.syncStatus.throughput, 0)} req/s</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'adapters' && (
        <TabPanel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {erpAdapters.map((adapter) => (
              <Card key={adapter.id} hover>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-neutral-800/60 flex items-center justify-center text-xl">
                      {systemIcons[adapter.icon] || '🔌'}
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-white">{adapter.displayName}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" size="sm">v{adapter.version}</Badge>
                        <Badge variant="outline" size="sm">{adapter.authType}</Badge>
                      </div>
                    </div>
                  </div>
                  <Badge variant={adapter.status === 'available' ? 'success' : adapter.status === 'connected' ? 'info' : 'warning'}>
                    {adapter.status}
                  </Badge>
                </div>

                <div className="mt-3 space-y-2">
                  {adapter.capabilities.map((cap, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded bg-neutral-800/40">
                      <span className="text-xs font-medium text-indigo-400 w-24">{cap.domain}</span>
                      <div className="flex gap-1">
                        {cap.operations.map(op => (
                          <Badge key={op} variant={op === 'write' ? 'warning' : op === 'subscribe' ? 'info' : 'success'} size="sm">{op}</Badge>
                        ))}
                      </div>
                      <span className="text-[10px] text-neutral-600 ml-auto">{cap.entities.length} entities</span>
                    </div>
                  ))}
                </div>

                <Button variant="secondary" size="sm" className="mt-3 w-full">
                  <Plug size={12} /> Connect
                </Button>
              </Card>
            ))}
          </div>
        </TabPanel>
      )}

      {activeTab === 'connections' && (
        <TabPanel>
          <div className="space-y-4">
            {erpConnections.map((conn) => {
              const adapter = erpAdapters.find(a => a.id === conn.adapterId);
              return (
                <Card key={conn.id}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-neutral-800/60 flex items-center justify-center text-lg">
                        {systemIcons[adapter?.icon || 'API'] || '🔌'}
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-white">{conn.displayName}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-neutral-400 font-mono">{conn.config.baseUrl}</span>
                          <Badge variant="outline" size="sm">{conn.config.environment}</Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={conn.status === 'connected' ? 'success' : conn.status === 'syncing' ? 'info' : conn.status === 'error' ? 'danger' : 'default'}>
                        {conn.status === 'connected' && <CheckCircle size={10} className="mr-1" />}
                        {conn.status === 'syncing' && <RefreshCw size={10} className="mr-1 animate-spin" />}
                        {conn.status === 'error' && <XCircle size={10} className="mr-1" />}
                        {conn.status}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mt-4">
                    <div className="p-3 rounded bg-neutral-800/40">
                      <span className="text-[10px] text-neutral-600">Entities Synced</span>
                      <p className="text-lg font-bold text-white">{conn.syncStatus.entitiesSynced.toLocaleString()}</p>
                    </div>
                    <div className="p-3 rounded bg-neutral-800/40">
                      <span className="text-[10px] text-neutral-600">Throughput</span>
                      <p className="text-lg font-bold text-white">{conn.syncStatus.throughput} req/s</p>
                    </div>
                    <div className="p-3 rounded bg-neutral-800/40">
                      <span className="text-[10px] text-neutral-600">Last Sync</span>
                      <p className="text-sm font-medium text-neutral-300">{new Date(conn.lastSync).toLocaleTimeString()}</p>
                    </div>
                  </div>

                  {conn.syncStatus.lastError && (
                    <div className="mt-3 p-2 rounded bg-amber-500/5 border border-amber-500/10 flex items-center gap-2">
                      <AlertTriangle size={12} className="text-amber-400" />
                      <span className="text-xs text-amber-300">{conn.syncStatus.lastError}</span>
                    </div>
                  )}

                  <div className="flex gap-2 mt-3">
                    <Button variant="secondary" size="sm"><RefreshCw size={12} /> Sync Now</Button>
                    <Button variant="ghost" size="sm"><Activity size={12} /> View Logs</Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </TabPanel>
      )}
    </div>
  );
}
