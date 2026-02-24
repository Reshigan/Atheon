import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { ERPConnection } from "@/lib/api";
import { Link2, Radio, Bot, CheckCircle, XCircle, Wifi, WifiOff, ArrowRight, Loader2 } from "lucide-react";

interface MCPServer {
  id: string;
  name: string;
  system: string;
  status: string;
  lastHeartbeat: string;
  tools: { name: string; description: string; permissions: string[] }[];
}

export function ConnectivityPage() {
  const { activeTab, setActiveTab } = useTabState('mcp');
  const [connections, setConnections] = useState<ERPConnection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await api.erp.connections();
        setConnections(data.connections);
      } catch { /* ignore */ }
      setLoading(false);
    }
    load();
  }, []);

  // Transform connections into MCP-like server view
  const mcpServers: MCPServer[] = connections.map(c => ({
    id: c.id,
    name: `${c.adapterName} - ${c.name}`,
    system: c.adapterSystem,
    status: c.status === 'connected' ? 'connected' : 'disconnected',
    lastHeartbeat: c.lastSync || c.connectedAt || new Date().toISOString(),
    tools: [
      { name: `${c.adapterSystem.toLowerCase()}.read`, description: `Read data from ${c.adapterName}`, permissions: ['read'] },
      { name: `${c.adapterSystem.toLowerCase()}.write`, description: `Write data to ${c.adapterName}`, permissions: ['read', 'write'] },
      { name: `${c.adapterSystem.toLowerCase()}.sync`, description: `Sync ${c.name}`, permissions: ['read', 'execute'] },
    ],
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  const tabs = [
    { id: 'mcp', label: 'MCP Servers', icon: <Radio size={14} />, count: mcpServers.length },
    { id: 'a2a', label: 'A2A Protocol', icon: <Bot size={14} /> },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/15 flex items-center justify-center">
          <Link2 className="w-5 h-5 text-cyan-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Connectivity</h1>
          <p className="text-sm text-gray-500">MCP (Model Context Protocol) + A2A (Agent-to-Agent) integration</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <span className="text-xs text-gray-400">MCP Servers</span>
          <p className="text-2xl font-bold text-gray-900 mt-1">{mcpServers.length}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Connected</span>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{mcpServers.filter(s => s.status === 'connected').length}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Total Tools</span>
          <p className="text-2xl font-bold text-gray-900 mt-1">{mcpServers.reduce((s, m) => s + m.tools.length, 0)}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Disconnected</span>
          <p className="text-2xl font-bold text-red-600 mt-1">{mcpServers.filter(s => s.status !== 'connected').length}</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'mcp' && (
        <TabPanel>
          <div className="space-y-4">
            {mcpServers.map((server) => (
              <Card key={server.id}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      server.status === 'connected' ? 'bg-emerald-50' : 'bg-red-50'
                    }`}>
                      {server.status === 'connected' ? (
                        <Wifi className="w-5 h-5 text-emerald-600" />
                      ) : (
                        <WifiOff className="w-5 h-5 text-red-600" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-gray-900">{server.name}</h3>
                      <span className="text-xs text-gray-500">{server.system}</span>
                    </div>
                  </div>
                  <Badge variant={server.status === 'connected' ? 'success' : 'danger'}>
                    {server.status === 'connected' && <CheckCircle size={10} className="mr-1" />}
                    {server.status !== 'connected' && <XCircle size={10} className="mr-1" />}
                    {server.status}
                  </Badge>
                </div>

                <div className="mt-3 space-y-2">
                  <span className="text-xs text-gray-400">Available Tools ({server.tools.length})</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {server.tools.map((tool) => (
                      <div key={tool.name} className="flex items-center justify-between p-2 rounded bg-gray-100">
                        <div>
                          <span className="text-xs font-mono text-gray-600">{tool.name}</span>
                          <p className="text-[10px] text-gray-400">{tool.description}</p>
                        </div>
                        <div className="flex gap-1">
                          {tool.permissions.map(p => (
                            <Badge key={p} variant="outline" size="sm">{p}</Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-2 text-[10px] text-gray-400">
                  Last heartbeat: {new Date(server.lastHeartbeat).toLocaleString()}
                </div>
              </Card>
            ))}
          </div>
        </TabPanel>
      )}

      {activeTab === 'a2a' && (
        <TabPanel>
          <Card className="border-cyan-500/20">
            <div className="flex items-start gap-3">
              <Bot className="w-5 h-5 text-cyan-400 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Agent-to-Agent (A2A) Protocol</h3>
                <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                  The A2A protocol enables Atheon Catalysts to discover and communicate with each other across clusters.
                  Each Catalyst publishes an <strong className="text-gray-800">Agent Card</strong> (JSON-LD) describing its capabilities,
                  skills, and communication endpoints.
                </p>
                <div className="flex items-center gap-2 mt-4 text-xs text-gray-400">
                  <span className="px-2 py-1 rounded bg-blue-50 text-blue-600 border border-blue-200">Finance Catalyst</span>
                  <ArrowRight className="w-3 h-3" />
                  <span className="px-2 py-1 rounded bg-gray-100">A2A Protocol</span>
                  <ArrowRight className="w-3 h-3" />
                  <span className="px-2 py-1 rounded bg-blue-50 text-blue-600 border border-blue-200">Supply Chain Catalyst</span>
                </div>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3 rounded bg-gray-100">
                    <span className="text-xs font-semibold text-gray-800">Discovery</span>
                    <p className="text-[10px] text-gray-400 mt-1">Catalysts register Agent Cards at /.well-known/agent.json</p>
                  </div>
                  <div className="p-3 rounded bg-gray-100">
                    <span className="text-xs font-semibold text-gray-800">Communication</span>
                    <p className="text-[10px] text-gray-400 mt-1">JSON-RPC over HTTP/2. Structured task/result protocol.</p>
                  </div>
                  <div className="p-3 rounded bg-gray-100">
                    <span className="text-xs font-semibold text-gray-800">Governance</span>
                    <p className="text-[10px] text-gray-400 mt-1">All cross-cluster calls logged. Trust scores affect routing.</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </TabPanel>
      )}
    </div>
  );
}
