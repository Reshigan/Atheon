import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { ERPAdapter, ERPConnection } from "@/lib/api";
import {
  Plug, CheckCircle, XCircle, RefreshCw, Plus, Database,
  Activity, Loader2, X
} from "lucide-react";

const systemIcons: Record<string, string> = {
  SAP: '🔷', SF: '☁️', WD: '🟣', ORC: '🔴', D365: '🟢', NS: '🟠', SG: '🟤', API: '🔌',
};

export function ERPAdaptersPage() {
  const { activeTab, setActiveTab } = useTabState('adapters');
  const [adapters, setAdapters] = useState<ERPAdapter[]>([]);
  const [connections, setConnections] = useState<ERPConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [connectForm, setConnectForm] = useState({ adapterId: '', name: '', syncFrequency: 'daily' });
  const [syncing, setSyncing] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [showLogs, setShowLogs] = useState<string | null>(null);

  const handleSync = async (connectionId: string) => {
    setSyncing(connectionId);
    try {
      await api.erp.sync(connectionId);
      const c = await api.erp.connections();
      setConnections(c.connections);
    } catch { /* silent */ }
    setSyncing(null);
  };

  const handleConnect = async () => {
    if (!connectForm.adapterId || !connectForm.name.trim() || connecting) return;
    setConnecting(true);
    try {
      await api.erp.createConnection({
        adapter_id: connectForm.adapterId,
        name: connectForm.name.trim(),
        sync_frequency: connectForm.syncFrequency,
        tenant_id: 'vantax',
      });
      const c = await api.erp.connections();
      setConnections(c.connections);
      setShowConnect(false);
      setConnectForm({ adapterId: '', name: '', syncFrequency: 'daily' });
    } catch { /* silent */ }
    setConnecting(false);
  };

  const handleAdapterConnect = (adapterId: string, adapterName: string) => {
    setConnectForm({ adapterId, name: adapterName + ' Connection', syncFrequency: 'daily' });
    setShowConnect(true);
  };

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [a, c] = await Promise.allSettled([
        api.erp.adapters(),
        api.erp.connections(),
      ]);
      if (a.status === 'fulfilled') setAdapters(a.value.adapters);
      if (c.status === 'fulfilled') setConnections(c.value.connections);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
      </div>
    );
  }

  const tabs = [
    { id: 'adapters', label: 'Available Adapters', icon: <Plug size={14} />, count: adapters.length },
    { id: 'connections', label: 'Active Connections', icon: <Database size={14} />, count: connections.length },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center">
            <Plug className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">ERP Adapter Layer</h1>
            <p className="text-sm text-gray-500">Pluggable adapters for enterprise system connectivity</p>
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowConnect(true)}><Plus size={14} /> Connect ERP</Button>
      </div>

      {/* Connect ERP Modal */}
      {showConnect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div style={{ background: "rgba(18,18,42,0.95)", border: "1px solid rgba(255,255,255,0.1)" }} className="rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Connect ERP System</h3>
              <button onClick={() => setShowConnect(false)} className="text-gray-400 hover:text-gray-400"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div><label className="text-xs text-gray-500">ERP Adapter</label><select className="w-full px-3 py-2 rounded-lg border border-white/[0.06] text-sm" value={connectForm.adapterId} onChange={e => setConnectForm(p => ({ ...p, adapterId: e.target.value }))}><option value="">Select an adapter...</option>{adapters.map(a => <option key={a.id} value={a.id}>{a.name} ({a.system})</option>)}</select></div>
              <div><label className="text-xs text-gray-500">Connection Name</label><input className="w-full px-3 py-2 rounded-lg border border-white/[0.06] text-sm" value={connectForm.name} onChange={e => setConnectForm(p => ({ ...p, name: e.target.value }))} placeholder="Production SAP" /></div>
              <div><label className="text-xs text-gray-500">Sync Frequency</label><select className="w-full px-3 py-2 rounded-lg border border-white/[0.06] text-sm" value={connectForm.syncFrequency} onChange={e => setConnectForm(p => ({ ...p, syncFrequency: e.target.value }))}><option value="realtime">Real-time</option><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></div>
            </div>
            <p className="text-[10px] text-gray-400">OAuth authentication will be initiated after connection setup. You will be redirected to the ERP provider to authorise access.</p>
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setShowConnect(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleConnect} disabled={!connectForm.adapterId || !connectForm.name.trim() || connecting}>
                {connecting ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} Connect
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <span className="text-xs text-gray-400">Available Adapters</span>
          <p className="text-2xl font-bold text-white mt-1">{adapters.length}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Active Connections</span>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{connections.filter(c => c.status === 'connected').length}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Entities Synced</span>
          <p className="text-2xl font-bold text-white mt-1">{(connections.reduce((s, c) => s + (c.recordsSynced || 0), 0) / 1000).toFixed(1)}K</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Total Throughput</span>
          <p className="text-2xl font-bold text-white mt-1">{connections.length} active</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'adapters' && (
        <TabPanel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {adapters.map((adapter) => (
              <Card key={adapter.id} hover>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="                    w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-xl">
                                          {systemIcons[adapter.system]|| '🔌'}
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-white">{adapter.name}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" size="sm">v{adapter.version}</Badge>
                        <Badge variant="outline" size="sm">{adapter.protocol}</Badge>
                      </div>
                    </div>
                  </div>
                  <Badge variant={adapter.status === 'available' ? 'success' : adapter.status === 'connected' ? 'info' : 'warning'}>
                    {adapter.status}
                  </Badge>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-3                  p-2 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                                      <span className="text-xs font-medium text-amber-400 w-24">Operations</span>
                    <div className="flex flex-wrap gap-1">
                      {adapter.operations.map(op => (
                        <Badge key={op} variant={op === 'write' ? 'warning' : op === 'subscribe' ? 'info' : 'success'} size="sm">{op}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3                  p-2 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                                      <span className="text-xs font-medium text-amber-400 w-24">Auth</span>
                    <div className="flex flex-wrap gap-1">
                      {adapter.authMethods.map(m => (
                        <Badge key={m} variant="outline" size="sm">{m}</Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => handleAdapterConnect(adapter.id, adapter.name)}>
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
            {connections.map((conn) => (
              <Card key={conn.id}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="                    w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-lg">
                                          {systemIcons[conn.adapterSystem]|| '🔌'}
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-white">{conn.name}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-500">{conn.adapterName}</span>
                        <Badge variant="outline" size="sm">{conn.adapterProtocol}</Badge>
                        <Badge variant="outline" size="sm">{conn.syncFrequency}</Badge>
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

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                  <div className="                  p-3 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                                      <span className="text-[10px] text-gray-400">Records Synced</span>
                    <p className="text-lg font-bold text-white">{(conn.recordsSynced || 0).toLocaleString()}</p>
                  </div>
                  <div className="                  p-3 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                                      <span className="text-[10px] text-gray-400">Sync Frequency</span>
                    <p className="text-lg font-bold text-white">{conn.syncFrequency}</p>
                  </div>
                  <div className="                  p-3 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                                      <span className="text-[10px] text-gray-400">Last Sync</span>
                    <p className="text-sm font-medium text-gray-400">{conn.lastSync ? new Date(conn.lastSync).toLocaleTimeString() : 'Never'}</p>
                  </div>
                </div>

                <div className="flex gap-2 mt-3">
                  <Button variant="secondary" size="sm" onClick={() => handleSync(conn.id)} disabled={syncing === conn.id}>
                    {syncing === conn.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sync Now
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowLogs(showLogs === conn.id ? null : conn.id)}>
                    <Activity size={12} /> {showLogs === conn.id ? 'Hide Logs' : 'View Logs'}
                  </Button>
                </div>

                {showLogs === conn.id && (
                  <div className="mt-3 p-3 rounded-lg bg-gray-900 text-green-400 font-mono text-xs max-h-48 overflow-y-auto animate-fadeIn">
                    <p>[{new Date().toISOString()}] Connection: {conn.name}</p>
                    <p>[{new Date().toISOString()}] Adapter: {conn.adapterName} ({conn.adapterSystem})</p>
                    <p>[{new Date().toISOString()}] Status: {conn.status}</p>
                    <p>[{new Date().toISOString()}] Records synced: {(conn.recordsSynced || 0).toLocaleString()}</p>
                    <p>[{new Date().toISOString()}] Sync frequency: {conn.syncFrequency}</p>
                    <p>[{new Date().toISOString()}] Last sync: {conn.lastSync || 'Never'}</p>
                    <p className="text-gray-500">[{new Date().toISOString()}] --- End of log ---</p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </TabPanel>
      )}
    </div>
  );
}
