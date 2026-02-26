import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { CanonicalEndpoint } from "@/lib/api";
import { Code, Layers, ArrowRight, Globe, BookOpen, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

const methodColor: Record<string, string> = {
 GET: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
 POST: 'bg-accent/10 text-accent border-accent/20',
 PUT: 'bg-accent/10 text-accent border-accent/20',
 PATCH: 'bg-accent/10 text-accent border-accent/20',
 DELETE: 'bg-red-500/10 text-red-400 border-red-500/20'};

const domainColor: Record<string, string> = {
 finance: 'text-emerald-400',
 procurement: 'text-accent',
 'supply-chain': 'text-accent',
 hr: 'text-accent',
 sales: 'text-pink-600',
 inventory: 'text-accent',
 crm: 'text-orange-400'};

export function CanonicalApiPage() {
 const { activeTab, setActiveTab } = useTabState('endpoints');
 const [endpoints, setEndpoints] = useState<CanonicalEndpoint[]>([]);
 const [loading, setLoading] = useState(true);
 const [tryingEndpoint, setTryingEndpoint] = useState<string | null>(null);
 const [tryResult, setTryResult] = useState<{ endpointId: string; status: number; data: unknown } | null>(null);
 const [tryLoading, setTryLoading] = useState(false);

 useEffect(() => {
 async function load() {
 setLoading(true);
 try {
 const data = await api.erp.canonical();
 setEndpoints(data.endpoints);
 } catch { /* ignore */ }
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

 const domains = [...new Set(endpoints.map(e => e.domain))];

 const tabs = [
 { id: 'endpoints', label: 'API Endpoints', icon: <Code size={14} />, count: endpoints.length },
 { id: 'schema', label: 'Data Model', icon: <Layers size={14} /> },
 { id: 'docs', label: 'Documentation', icon: <BookOpen size={14} /> },
 ];

 return (
 <div className="space-y-6 animate-fadeIn">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center">
 <Globe className="w-5 h-5 text-orange-400" />
 </div>
 <div>
 <h1 className="text-2xl font-bold t-primary">Canonical API</h1>
 <p className="text-sm t-muted">Unified API layer abstracting all ERP systems into one schema</p>
 </div>
 </div>

 {/* Stats */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <Card>
 <span className="text-xs t-secondary">Endpoints</span>
 <p className="text-2xl font-bold t-primary mt-1">{endpoints.length}</p>
 </Card>
 <Card>
 <span className="text-xs t-secondary">Domains</span>
 <p className="text-2xl font-bold t-primary mt-1">{domains.length}</p>
 </Card>
 <Card>
 <span className="text-xs t-secondary">Active</span>
 <p className="text-2xl font-bold text-emerald-400 mt-1">{endpoints.length}</p>
 </Card>
 <Card>
 <span className="text-xs t-secondary">Version</span>
 <p className="text-2xl font-bold t-primary mt-1">v1.0</p>
 </Card>
 </div>

 <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

 {activeTab === 'endpoints' && (
 <TabPanel>
 <div className="space-y-3">
 {endpoints.map((ep) => (
 <Card key={ep.id} hover>
 <div className="flex items-start gap-4">
 <span className={`px-2.5 py-1 rounded text-xs font-bold border ${methodColor[ep.method] || ''}`}>
 {ep.method}
 </span>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <h3 className="text-sm font-semibold t-primary">{ep.description || ep.path}</h3>
 </div>
 <p className="text-xs font-mono text-accent mt-0.5">{ep.path}</p>
 <p className="text-xs t-secondary mt-1">{ep.description}</p>
 <div className="flex items-center gap-3 mt-2">
 <span className={`text-xs font-medium ${domainColor[ep.domain] || 'text-gray-500'}`}>{ep.domain}</span>
 <span className="text-[10px] text-gray-400">v{ep.version}</span>
 <span className="text-[10px] text-gray-400">Rate limit: {ep.rateLimit}/min</span>
 {ep.method === 'GET' && (
 <Button
 variant="ghost"
 size="sm"
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
 fetch(`${apiUrl}${ep.path}?tenant_id=vantax`, {
 headers: { 'Authorization': `Bearer ${localStorage.getItem('atheon_token') || ''}` }})
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
 </TabPanel>
 )}

 {activeTab === 'schema' && (
 <TabPanel>
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
 </TabPanel>
 )}

 {activeTab === 'docs' && (
 <TabPanel>
 <Card className="border-orange-500/20">
 <div className="flex items-start gap-3">
 <BookOpen className="w-5 h-5 text-orange-400 mt-0.5 flex-shrink-0" />
 <div>
 <h3 className="text-sm font-semibold t-primary">Canonical API Architecture</h3>
 <p className="text-xs t-muted mt-2 leading-relaxed">
 The Atheon Canonical API provides a <strong className="t-primary">single, unified interface</strong> to interact with any connected ERP system.
 Instead of calling SAP BAPIs, Salesforce REST, or Workday SOAP directly, Catalysts and user queries go through the Canonical API layer.
 </p>
 <div className="flex flex-wrap items-center gap-2 mt-4 text-xs text-gray-400">
 <span className="px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">Catalyst / Chat</span>
 <ArrowRight className="w-3 h-3 flex-shrink-0" />
 <span className="px-2 py-1 rounded bg-orange-500/15 text-orange-400 border border-orange-500/20">Canonical API</span>
 <ArrowRight className="w-3 h-3 flex-shrink-0" />
 <span className="px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">ERP Adapter</span>
 <ArrowRight className="w-3 h-3 flex-shrink-0" />
 <span className="px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">SAP / SF / WD / ...</span>
 </div>
 <p className="text-xs t-muted mt-4 leading-relaxed">
 <strong className="t-primary">Key benefits:</strong> ERP-agnostic Catalysts, hot-swap ERP backends without agent changes,
 consistent data models, automatic field mapping, and centralised audit logging.
 </p>
 <p className="text-xs t-muted mt-2 leading-relaxed">
 <strong className="t-primary">Versioning:</strong> All endpoints are versioned (v1). Breaking changes get a new version.
 Adapters implement the canonical schema and handle ERP-specific transformations internally.
 </p>
 </div>
 </div>
 </Card>
 </TabPanel>
 )}
 </div>
 );
}
