import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { canonicalEndpoints } from "@/data/tenantData";
import { Code, Layers, ArrowRight, Globe, BookOpen } from "lucide-react";

const methodColor: Record<string, string> = {
  GET: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  POST: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  PUT: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  PATCH: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  DELETE: 'bg-red-500/15 text-red-400 border-red-500/20',
};

const domainColor: Record<string, string> = {
  finance: 'text-emerald-400',
  procurement: 'text-blue-400',
  'supply-chain': 'text-amber-400',
  hr: 'text-violet-400',
  sales: 'text-pink-400',
  inventory: 'text-cyan-400',
  crm: 'text-orange-400',
};

export function CanonicalApiPage() {
  const { activeTab, setActiveTab } = useTabState('endpoints');

  const tabs = [
    { id: 'endpoints', label: 'API Endpoints', icon: <Code size={14} />, count: canonicalEndpoints.length },
    { id: 'schema', label: 'Data Model', icon: <Layers size={14} /> },
    { id: 'docs', label: 'Documentation', icon: <BookOpen size={14} /> },
  ];

  const domains = [...new Set(canonicalEndpoints.map(e => e.domain))];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center">
          <Globe className="w-5 h-5 text-orange-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Canonical API</h1>
          <p className="text-sm text-neutral-400">Unified API layer abstracting all ERP systems into one schema</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <span className="text-xs text-neutral-500">Endpoints</span>
          <p className="text-2xl font-bold text-white mt-1">{canonicalEndpoints.length}</p>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">Domains</span>
          <p className="text-2xl font-bold text-white mt-1">{domains.length}</p>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">Active</span>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{canonicalEndpoints.filter(e => e.status === 'active').length}</p>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">Version</span>
          <p className="text-2xl font-bold text-white mt-1">v1.0</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'endpoints' && (
        <TabPanel>
          <div className="space-y-3">
            {canonicalEndpoints.map((ep) => (
              <Card key={ep.id} hover>
                <div className="flex items-start gap-4">
                  <span className={`px-2.5 py-1 rounded text-xs font-bold border ${methodColor[ep.method]}`}>
                    {ep.method}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">{ep.name}</h3>
                      <Badge variant={ep.status === 'active' ? 'success' : ep.status === 'beta' ? 'warning' : 'default'} size="sm">{ep.status}</Badge>
                    </div>
                    <p className="text-xs font-mono text-indigo-400 mt-0.5">{ep.path}</p>
                    <p className="text-xs text-neutral-500 mt-1">{ep.description}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className={`text-xs font-medium ${domainColor[ep.domain] || 'text-neutral-400'}`}>{ep.domain}</span>
                      <span className="text-[10px] text-neutral-600">v{ep.version}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-neutral-600">Supported:</span>
                        {ep.supportedERPs.map((erp) => (
                          <Badge key={erp} variant="outline" size="sm">{erp}</Badge>
                        ))}
                      </div>
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
                  <span className={`text-sm font-bold ${domainColor[entity.domain] || 'text-neutral-300'}`}>{entity.name}</span>
                  <Badge variant="outline" size="sm">{entity.domain}</Badge>
                </div>
                <p className="text-xs text-neutral-500 mb-3">{entity.desc}</p>
                <div className="space-y-1">
                  {entity.fields.map((f) => (
                    <div key={f} className="flex items-center gap-2 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
                      <span className="font-mono text-neutral-300">{f}</span>
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
                <h3 className="text-sm font-semibold text-white">Canonical API Architecture</h3>
                <p className="text-xs text-neutral-400 mt-2 leading-relaxed">
                  The Atheon Canonical API provides a <strong className="text-neutral-200">single, unified interface</strong> to interact with any connected ERP system.
                  Instead of calling SAP BAPIs, Salesforce REST, or Workday SOAP directly, Catalysts and user queries go through the Canonical API layer.
                </p>
                <div className="flex items-center gap-2 mt-4 text-xs text-neutral-500">
                  <span className="px-2 py-1 rounded bg-neutral-800">Catalyst / Chat</span>
                  <ArrowRight className="w-3 h-3" />
                  <span className="px-2 py-1 rounded bg-orange-500/15 text-orange-400 border border-orange-500/20">Canonical API</span>
                  <ArrowRight className="w-3 h-3" />
                  <span className="px-2 py-1 rounded bg-neutral-800">ERP Adapter</span>
                  <ArrowRight className="w-3 h-3" />
                  <span className="px-2 py-1 rounded bg-neutral-800">SAP / SF / WD / ...</span>
                </div>
                <p className="text-xs text-neutral-400 mt-4 leading-relaxed">
                  <strong className="text-neutral-200">Key benefits:</strong> ERP-agnostic Catalysts, hot-swap ERP backends without agent changes,
                  consistent data models, automatic field mapping, and centralised audit logging.
                </p>
                <p className="text-xs text-neutral-400 mt-2 leading-relaxed">
                  <strong className="text-neutral-200">Versioning:</strong> All endpoints are versioned (v1). Breaking changes get a new version.
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
