import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { CanonicalEndpoint } from "@/lib/api";
import { Code, Layers, ArrowRight, Globe, BookOpen, Loader2 } from "lucide-react";

const methodColor: Record<string, string> = {
  GET: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  POST: 'bg-blue-50 text-blue-600 border-blue-200',
  PUT: 'bg-amber-50 text-amber-600 border-amber-200',
  PATCH: 'bg-violet-50 text-violet-600 border-violet-200',
  DELETE: 'bg-red-50 text-red-600 border-red-200',
};

const domainColor: Record<string, string> = {
  finance: 'text-emerald-600',
  procurement: 'text-blue-600',
  'supply-chain': 'text-amber-600',
  hr: 'text-violet-600',
  sales: 'text-pink-600',
  inventory: 'text-cyan-400',
  crm: 'text-orange-400',
};

export function CanonicalApiPage() {
  const { activeTab, setActiveTab } = useTabState('endpoints');
  const [endpoints, setEndpoints] = useState<CanonicalEndpoint[]>([]);
  const [loading, setLoading] = useState(true);

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
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
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
          <h1 className="text-2xl font-bold text-gray-900">Canonical API</h1>
          <p className="text-sm text-gray-500">Unified API layer abstracting all ERP systems into one schema</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <span className="text-xs text-gray-400">Endpoints</span>
          <p className="text-2xl font-bold text-gray-900 mt-1">{endpoints.length}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Domains</span>
          <p className="text-2xl font-bold text-gray-900 mt-1">{domains.length}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Active</span>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{endpoints.length}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Version</span>
          <p className="text-2xl font-bold text-gray-900 mt-1">v1.0</p>
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
                      <h3 className="text-sm font-semibold text-gray-900">{ep.description || ep.path}</h3>
                    </div>
                    <p className="text-xs font-mono text-indigo-600 mt-0.5">{ep.path}</p>
                    <p className="text-xs text-gray-400 mt-1">{ep.description}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className={`text-xs font-medium ${domainColor[ep.domain] || 'text-gray-500'}`}>{ep.domain}</span>
                      <span className="text-[10px] text-gray-400">v{ep.version}</span>
                      <span className="text-[10px] text-gray-400">Rate limit: {ep.rateLimit}/min</span>
                    </div>
                  </div>
                </div>
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
                  <span className={`text-sm font-bold ${domainColor[entity.domain] || 'text-gray-600'}`}>{entity.name}</span>
                  <Badge variant="outline" size="sm">{entity.domain}</Badge>
                </div>
                <p className="text-xs text-gray-400 mb-3">{entity.desc}</p>
                <div className="space-y-1">
                  {entity.fields.map((f) => (
                    <div key={f} className="flex items-center gap-2 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
                      <span className="font-mono text-gray-600">{f}</span>
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
                <h3 className="text-sm font-semibold text-gray-900">Canonical API Architecture</h3>
                <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                  The Atheon Canonical API provides a <strong className="text-gray-800">single, unified interface</strong> to interact with any connected ERP system.
                  Instead of calling SAP BAPIs, Salesforce REST, or Workday SOAP directly, Catalysts and user queries go through the Canonical API layer.
                </p>
                <div className="flex items-center gap-2 mt-4 text-xs text-gray-400">
                  <span className="px-2 py-1 rounded bg-gray-100">Catalyst / Chat</span>
                  <ArrowRight className="w-3 h-3" />
                  <span className="px-2 py-1 rounded bg-orange-500/15 text-orange-400 border border-orange-500/20">Canonical API</span>
                  <ArrowRight className="w-3 h-3" />
                  <span className="px-2 py-1 rounded bg-gray-100">ERP Adapter</span>
                  <ArrowRight className="w-3 h-3" />
                  <span className="px-2 py-1 rounded bg-gray-100">SAP / SF / WD / ...</span>
                </div>
                <p className="text-xs text-gray-500 mt-4 leading-relaxed">
                  <strong className="text-gray-800">Key benefits:</strong> ERP-agnostic Catalysts, hot-swap ERP backends without agent changes,
                  consistent data models, automatic field mapping, and centralised audit logging.
                </p>
                <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                  <strong className="text-gray-800">Versioning:</strong> All endpoints are versioned (v1). Breaking changes get a new version.
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
