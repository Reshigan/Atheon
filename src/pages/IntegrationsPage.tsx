/**
 * UX-11: Unified Integrations Page
 * Merges ERP Adapters + Canonical API into a single page with tabs:
 *   - Connected Systems (active ERP connections)
 *   - Available Adapters (ERP adapters catalog)
 *   - Canonical Data Schema (unified API endpoints + data model)
 */
import { useEffect, useState } from "react";
import { Portal } from "@/components/ui/portal";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { ERPAdapter, ERPConnection, CanonicalEndpoint } from "@/lib/api";
import {
  Plug, CheckCircle, XCircle, RefreshCw, Plus, Database,
  Activity, Loader2, X, AlertCircle, Code, Layers, Globe, Play,
} from "lucide-react";
import { IconERP_SAP, IconERP_Cloud, IconERP_Generic } from "@/components/icons/AtheonIcons";
import { useAppStore } from "@/stores/appStore";

const systemIconMap: Record<string, React.FC<{ size?: number }>> = {
  SAP: IconERP_SAP, SF: IconERP_Cloud, WD: IconERP_Generic, ORC: IconERP_Generic,
  D365: IconERP_Generic, NS: IconERP_Generic, SG: IconERP_Generic, API: IconERP_Generic,
};

const methodColor: Record<string, string> = {
  GET: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  POST: 'bg-accent/10 text-accent border-accent/20',
  PUT: 'bg-accent/10 text-accent border-accent/20',
  PATCH: 'bg-accent/10 text-accent border-accent/20',
  DELETE: 'bg-red-500/10 text-red-400 border-red-500/20',
};

const domainColor: Record<string, string> = {
  finance: 'text-emerald-400', procurement: 'text-accent', 'supply-chain': 'text-accent',
  hr: 'text-accent', sales: 'text-pink-600', inventory: 'text-accent', crm: 'text-orange-400',
};

export function IntegrationsPage() {
  const { activeTab, setActiveTab } = useTabState('connections');
  const user = useAppStore((s) => s.user);
  const [adapters, setAdapters] = useState<ERPAdapter[]>([]);
  const [connections, setConnections] = useState<ERPConnection[]>([]);
  const [endpoints, setEndpoints] = useState<CanonicalEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [connectForm, setConnectForm] = useState({ adapterId: '', name: '', syncFrequency: 'daily' });
  const [syncing, setSyncing] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [showLogs, setShowLogs] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [tryingEndpoint, setTryingEndpoint] = useState<string | null>(null);
  const [tryResult, setTryResult] = useState<{ endpointId: string; status: number; data: unknown } | null>(null);
  const [tryLoading, setTryLoading] = useState(false);

  const handleSync = async (connectionId: string) => {
    setSyncing(connectionId);
    setActionError(null);
    try {
      await api.erp.sync(connectionId);
      const c = await api.erp.connections();
      setConnections(c.connections);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Sync failed');
    }
    setSyncing(null);
  };

  const handleConnect = async () => {
    if (!connectForm.adapterId || !connectForm.name.trim() || connecting) return;
    if (!user?.tenantId) {
      setConnectError('Unable to determine tenant. Please log in again.');
      return;
    }
    setConnecting(true);
    setConnectError(null);
    try {
      await api.erp.createConnection({
        adapter_id: connectForm.adapterId,
        name: connectForm.name.trim(),
        sync_frequency: connectForm.syncFrequency,
        tenant_id: user.tenantId,
      });
      const c = await api.erp.connections();
      setConnections(c.connections);
      setShowConnect(false);
      setConnectForm({ adapterId: '', name: '', syncFrequency: 'daily' });
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Connection failed');
    }
    setConnecting(false);
  };

  const handleAdapterConnect = (adapterId: string, adapterName: string) => {
    setConnectForm({ adapterId, name: adapterName + ' Connection', syncFrequency: 'daily' });
    setConnectError(null);
    setShowConnect(true);
  };

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [a, c, e] = await Promise.allSettled([
        api.erp.adapters(),
        api.erp.connections(),
        api.erp.canonical(),
      ]);
      if (a.status === 'fulfilled') setAdapters(a.value.adapters);
      if (c.status === 'fulfilled') setConnections(c.value.connections);
      if (e.status === 'fulfilled') setEndpoints(e.value.endpoints);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  const tabs = [
    { id: 'connections', label: 'Connected Systems', icon: <Database size={14} />, count: connections.length },
    { id: 'adapters', label: 'Available Adapters', icon: <Plug size={14} />, count: adapters.length },
    { id: 'schema', label: 'Canonical Data Schema', icon: <Layers size={14} />, count: endpoints.length },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center">
            <Globe className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold t-primary">Integrations</h1>
            <p className="text-sm t-muted">Connected systems, adapters, and canonical data schema</p>
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowConnect(true)} title="Connect a new ERP system">
          <Plus size={14} /> Connect System
        </Button>
      </div>

      {actionError && (
        <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400 flex-1">{actionError}</p>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-300" title="Dismiss error"><X size={14} /></button>
        </div>
      )}

      {/* Connect Modal */}
      {showConnect && (
        <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold t-primary">Connect System</h3>
              <button onClick={() => { setShowConnect(false); setConnectError(null); }} className="text-gray-400 hover:text-gray-300" title="Close"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs t-muted">ERP Adapter</label>
                <select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" value={connectForm.adapterId} onChange={e => setConnectForm(p => ({ ...p, adapterId: e.target.value }))}>
                  <option value="">Select an adapter...</option>
                  {adapters.map(a => <option key={a.id} value={a.id}>{a.name} ({a.system})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs t-muted">Connection Name</label>
                <input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" value={connectForm.name} onChange={e => setConnectForm(p => ({ ...p, name: e.target.value }))} placeholder="Production SAP" />
              </div>
              <div>
                <label className="text-xs t-muted">Sync Frequency</label>
                <select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" value={connectForm.syncFrequency} onChange={e => setConnectForm(p => ({ ...p, syncFrequency: e.target.value }))}>
                  <option value="realtime">Real-time</option>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
            </div>
            <p className="text-[10px] text-gray-400">OAuth authentication will be initiated after connection setup.</p>
            {connectError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2"><AlertCircle size={14} /> {connectError}</div>
            )}
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" size="sm" onClick={() => { setShowConnect(false); setConnectError(null); }}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleConnect} disabled={!connectForm.adapterId || !connectForm.name.trim() || connecting}>
                {connecting ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} Connect
              </Button>
            </div>
          </div>
        </div></Portal>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <span className="text-xs t-secondary">Active Connections</span>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{connections.filter(c => c.status === 'connected').length}</p>
        </Card>
        <Card>
          <span className="text-xs t-secondary">Available Adapters</span>
          <p className="text-2xl font-bold t-primary mt-1">{adapters.length}</p>
        </Card>
        <Card>
          <span className="text-xs t-secondary">API Endpoints</span>
          <p className="text-2xl font-bold t-primary mt-1">{endpoints.length}</p>
        </Card>
        <Card>
          <span className="text-xs t-secondary">Records Synced</span>
          <p className="text-2xl font-bold t-primary mt-1">{(connections.reduce((s, c) => s + (c.recordsSynced || 0), 0) / 1000).toFixed(1)}K</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab: Connected Systems */}
      {activeTab === 'connections' && (
        <TabPanel>
          {connections.length === 0 ? (
            <Card>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Database className="w-10 h-10 t-muted mb-3 opacity-30" />
                <p className="text-sm font-medium t-primary">No connected systems yet</p>
                <p className="text-xs t-muted mt-1">Connect an ERP system from the Available Adapters tab to get started.</p>
                <Button variant="primary" size="sm" className="mt-4" onClick={() => setActiveTab('adapters')}>
                  <Plug size={14} /> Browse Adapters
                </Button>
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {connections.map((conn) => (
                <Card key={conn.id}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] flex items-center justify-center">
                        {(() => { const SysIcon = systemIconMap[conn.adapterSystem] || IconERP_Generic; return <SysIcon size={18} />; })()}
                      </div>
                      <div>
                        <h3 className="text-base font-semibold t-primary">{conn.name}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs t-muted">{conn.adapterName}</span>
                          <Badge variant="outline" size="sm">{conn.adapterProtocol}</Badge>
                          <Badge variant="outline" size="sm">{conn.syncFrequency}</Badge>
                        </div>
                      </div>
                    </div>
                    <Badge variant={conn.status === 'connected' ? 'success' : conn.status === 'syncing' ? 'info' : conn.status === 'error' ? 'danger' : 'default'}>
                      {conn.status === 'connected' && <CheckCircle size={10} className="mr-1" />}
                      {conn.status === 'syncing' && <RefreshCw size={10} className="mr-1 animate-spin" />}
                      {conn.status === 'error' && <XCircle size={10} className="mr-1" />}
                      {conn.status}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                    <div className="p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                      <span className="text-[10px] text-gray-400">Records Synced</span>
                      <p className="text-lg font-bold t-primary">{(conn.recordsSynced || 0).toLocaleString()}</p>
                    </div>
                    <div className="p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                      <span className="text-[10px] text-gray-400">Sync Frequency</span>
                      <p className="text-lg font-bold t-primary">{conn.syncFrequency}</p>
                    </div>
                    <div className="p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                      <span className="text-[10px] text-gray-400">Last Sync</span>
                      <p className="text-sm font-medium text-gray-400">{conn.lastSync ? new Date(conn.lastSync).toLocaleTimeString() : 'Never'}</p>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-3">
                    <Button variant="secondary" size="sm" onClick={() => handleSync(conn.id)} disabled={syncing === conn.id} title="Trigger a manual data sync now">
                      {syncing === conn.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sync Now
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowLogs(showLogs === conn.id ? null : conn.id)} title="View sync activity logs">
                      <Activity size={12} /> {showLogs === conn.id ? 'Hide Logs' : 'View Logs'}
                    </Button>
                  </div>

                  {showLogs === conn.id && (
                    <div className="mt-3 p-3 rounded-lg bg-gray-900 text-green-400 font-mono text-xs max-h-48 overflow-y-auto animate-fadeIn">
                      <p>[{new Date().toISOString()}] Connection: {conn.name}</p>
                      <p>[{new Date().toISOString()}] Adapter: {conn.adapterName} ({conn.adapterSystem})</p>
                      <p>[{new Date().toISOString()}] Status: {conn.status}</p>
                      <p>[{new Date().toISOString()}] Records synced: {(conn.recordsSynced || 0).toLocaleString()}</p>
                      <p className="text-gray-500">[{new Date().toISOString()}] --- End of log ---</p>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </TabPanel>
      )}

      {/* Tab: Available Adapters */}
      {activeTab === 'adapters' && (
        <TabPanel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {adapters.map((adapter) => (
              <Card key={adapter.id} hover>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-card)] flex items-center justify-center">
                      {(() => { const SysIcon = systemIconMap[adapter.system] || IconERP_Generic; return <SysIcon size={20} />; })()}
                    </div>
                    <div>
                      <h3 className="text-base font-semibold t-primary">{adapter.name}</h3>
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
                  <div className="flex items-center gap-3 p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                    <span className="text-xs font-medium text-accent w-24">Operations</span>
                    <div className="flex flex-wrap gap-1">
                      {adapter.operations.map(op => (
                        <Badge key={op} variant={op === 'write' ? 'warning' : op === 'subscribe' ? 'info' : 'success'} size="sm">{op}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                    <span className="text-xs font-medium text-accent w-24">Auth</span>
                    <div className="flex flex-wrap gap-1">
                      {adapter.authMethods.map(m => (
                        <Badge key={m} variant="outline" size="sm">{m}</Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => handleAdapterConnect(adapter.id, adapter.name)} title="Connect this adapter">
                  <Plug size={12} /> Connect
                </Button>
              </Card>
            ))}
          </div>
        </TabPanel>
      )}

      {/* Tab: Canonical Data Schema */}
      {activeTab === 'schema' && (
        <TabPanel>
          <div className="space-y-6">
            {/* Data Model */}
            <div>
              <h3 className="text-sm font-semibold t-primary mb-3 flex items-center gap-2"><Layers size={14} className="text-accent" /> Canonical Data Model</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { name: 'Invoice', domain: 'finance', fields: ['id', 'vendorId', 'amount', 'currency', 'lineItems[]', 'status', 'dueDate', 'poReference'], desc: 'Unified invoice entity across all ERP systems' },
                  { name: 'PurchaseOrder', domain: 'procurement', fields: ['id', 'vendorId', 'items[]', 'totalAmount', 'status', 'approvalChain[]', 'deliveryDate'], desc: 'Canonical purchase order with multi-level approval' },
                  { name: 'StockLevel', domain: 'inventory', fields: ['materialId', 'plant', 'storageLocation', 'available', 'reserved', 'inTransit', 'unit'], desc: 'Real-time stock position across warehouses' },
                  { name: 'Employee', domain: 'hr', fields: ['id', 'name', 'email', 'department', 'position', 'manager', 'startDate', 'status'], desc: 'Employee master record normalised from HR systems' },
                  { name: 'Opportunity', domain: 'crm', fields: ['id', 'accountId', 'name', 'stage', 'amount', 'probability', 'closeDate', 'owner'], desc: 'Sales pipeline opportunity from CRM' },
                  { name: 'GoodsReceipt', domain: 'supply-chain', fields: ['id', 'poId', 'items[]', 'receivedDate', 'inspectionStatus', 'warehouse'], desc: 'Goods receipt recording against purchase orders' },
                ].map((entity) => (
                  <Card key={entity.name}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-sm font-bold ${domainColor[entity.domain] || 'text-gray-400'}`}>{entity.name}</span>
                      <Badge variant="outline" size="sm">{entity.domain}</Badge>
                    </div>
                    <p className="text-xs t-secondary mb-3">{entity.desc}</p>
                    <div className="space-y-1">
                      {entity.fields.map((f) => (
                        <div key={f} className="flex items-center gap-2 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                          <span className="font-mono text-gray-400">{f}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            </div>

            {/* API Endpoints */}
            <div>
              <h3 className="text-sm font-semibold t-primary mb-3 flex items-center gap-2"><Code size={14} className="text-accent" /> API Endpoints ({endpoints.length})</h3>
              <div className="space-y-3">
                {endpoints.map((ep) => (
                  <Card key={ep.id} hover>
                    <div className="flex items-start gap-4">
                      <span className={`px-2.5 py-1 rounded text-xs font-bold border ${methodColor[ep.method] || ''}`}>
                        {ep.method}
                      </span>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold t-primary">{ep.description || ep.path}</h3>
                        <p className="text-xs font-mono text-accent mt-0.5">{ep.path}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className={`text-xs font-medium ${domainColor[ep.domain] || 'text-gray-500'}`}>{ep.domain}</span>
                          <span className="text-[10px] text-gray-400">v{ep.version}</span>
                          <span className="text-[10px] text-gray-400">Rate limit: {ep.rateLimit}/min</span>
                          {ep.method === 'GET' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Call this endpoint and show the response"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (tryingEndpoint === ep.id) {
                                  setTryingEndpoint(null);
                                  setTryResult(null);
                                } else {
                                  setTryingEndpoint(ep.id);
                                  setTryLoading(true);
                                  setTryResult(null);
                                  const apiUrl = import.meta.env.VITE_API_URL || 'https://atheon-api.reshigan-085.workers.dev';
                                  fetch(`${apiUrl}${ep.path}?tenant_id=${user?.tenantId || 'vantax'}`, {
                                    headers: { 'Authorization': `Bearer ${localStorage.getItem('atheon_token') || ''}` },
                                  })
                                    .then(async (res) => {
                                      const data = await res.json().catch(() => ({}));
                                      setTryResult({ endpointId: ep.id, status: res.status, data });
                                    })
                                    .catch(() => {
                                      setTryResult({ endpointId: ep.id, status: 0, data: { error: 'Network error' } });
                                    })
                                    .finally(() => setTryLoading(false));
                                }
                              }}
                            >
                              <Play size={12} /> {tryingEndpoint === ep.id ? 'Hide' : 'Try it'}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    {tryingEndpoint === ep.id && (
                      <div className="mt-3 space-y-2 animate-fadeIn">
                        {tryLoading ? (
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <Loader2 size={14} className="animate-spin" /> Calling endpoint...
                          </div>
                        ) : tryResult && tryResult.endpointId === ep.id ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Badge variant={tryResult.status >= 200 && tryResult.status < 300 ? 'success' : 'danger'} size="sm">
                                {tryResult.status || 'ERR'}
                              </Badge>
                              <span className="text-xs t-muted">Response</span>
                            </div>
                            <pre className="p-3 rounded-lg bg-gray-900 text-green-400 text-xs font-mono overflow-x-auto max-h-48">
                              {JSON.stringify(tryResult.data, null, 2)}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </TabPanel>
      )}
    </div>
  );
}
