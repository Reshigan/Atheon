import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { LayerBadge } from "@/components/ui/layer-badge";
import { api } from "@/lib/api";
import type { AuditEntry } from "@/lib/api";
import { Shield, CheckCircle, XCircle, Clock, Filter, Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AtheonLayer } from "@/types";

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [filterLayer, setFilterLayer] = useState<string>('');
  const [filterOutcome, setFilterOutcome] = useState<string>('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await api.audit.log();
        setEntries(data.entries);
      } catch { /* ignore */ }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="          w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                      <Shield className="w-5 h-5 text-cyan-400"/>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Audit Log</h1>
            <p className="text-sm text-gray-500">Complete governance trail across all Atheon layers</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const filtered = entries.filter(e => (!filterLayer || e.layer === filterLayer) && (!filterOutcome || e.outcome === filterOutcome));
              const csv = ['Timestamp,Action,Layer,Outcome,Details']
                .concat(filtered.map(e => `"${new Date(e.createdAt).toISOString()}","${e.action}","${e.layer}","${e.outcome}","${e.details ? Object.entries(e.details).map(([k,v]) => `${k}: ${v}`).join('; ') : ''}"`));
              const blob = new Blob([csv.join('\n')], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `atheon-audit-${new Date().toISOString().slice(0,10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={14} /> Export CSV
          </Button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${showFilters ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400' : 'bg-white/[0.04] border-white/[0.06] text-gray-400 hover:bg-white/[0.04]'}`}
          >
            <Filter size={14} /> Filters {(filterLayer || filterOutcome) ? `(${[filterLayer, filterOutcome].filter(Boolean).length})` : ''}
          </button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="flex flex-wrap gap-4 p-4 rounded-xl bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Layer</label>
            <select className="px-3 py-1.5 rounded-lg border border-white/[0.06] text-sm bg-white/[0.04] text-gray-200" value={filterLayer} onChange={e => setFilterLayer(e.target.value)}>
              <option value="">All Layers</option>
              <option value="apex">Apex</option>
              <option value="pulse">Pulse</option>
              <option value="catalysts">Catalysts</option>
              <option value="mind">Mind</option>
              <option value="memory">Memory</option>
              <option value="control-plane">Control Plane</option>
              <option value="erp">ERP</option>
              <option value="iam">IAM</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Outcome</label>
            <select className="px-3 py-1.5 rounded-lg border border-white/[0.06] text-sm bg-white/[0.04] text-gray-200" value={filterOutcome} onChange={e => setFilterOutcome(e.target.value)}>
              <option value="">All Outcomes</option>
              <option value="success">Success</option>
              <option value="pending">Pending</option>
              <option value="failure">Failed</option>
            </select>
          </div>
          {(filterLayer || filterOutcome) && (
            <button onClick={() => { setFilterLayer(''); setFilterOutcome(''); }} className="self-end text-xs text-cyan-400 hover:text-cyan-300 pb-1.5">Clear filters</button>
          )}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <span className="text-xs text-gray-400">Total Events (Today)</span>
          <p className="text-2xl font-bold text-white mt-1">{entries.length}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Success</span>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{entries.filter(a => a.outcome === 'success').length}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Pending</span>
          <p className="text-2xl font-bold text-amber-400 mt-1">{entries.filter(a => a.outcome === 'pending').length}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Failed</span>
          <p className="text-2xl font-bold text-red-400 mt-1">{entries.filter(a => a.outcome === 'failure').length}</p>
        </Card>
      </div>

      {/* Audit Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Timestamp</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Action</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Layer</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Details</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {entries.filter(e => (!filterLayer || e.layer === filterLayer) && (!filterOutcome || e.outcome === filterOutcome)).map((entry) => (
                <tr key={entry.id} className="border-b border-white/[0.06] hover:bg-white/[0.03] transition-colors">
                  <td className="py-3 px-4 text-xs text-gray-500 font-mono whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-sm text-white">{entry.action}</td>
                  <td className="py-3 px-4">
                    <LayerBadge layer={entry.layer as AtheonLayer} />
                  </td>
                  <td className="py-3 px-4 text-xs text-gray-400 max-w-xs truncate">
                    {entry.details ? Object.entries(entry.details).map(([k, v]) => `${k}: ${v}`).join(', ') : '-'}
                  </td>
                  <td className="py-3 px-4">
                    {entry.outcome === 'success' && (
                      <div className="flex items-center gap-1.5">
                        <CheckCircle size={14} className="text-emerald-400" />
                        <span className="text-xs text-emerald-400">Success</span>
                      </div>
                    )}
                    {entry.outcome === 'pending' && (
                      <div className="flex items-center gap-1.5">
                        <Clock size={14} className="text-amber-400" />
                        <span className="text-xs text-amber-400">Pending</span>
                      </div>
                    )}
                    {entry.outcome === 'failure' && (
                      <div className="flex items-center gap-1.5">
                        <XCircle size={14} className="text-red-400" />
                        <span className="text-xs text-red-400">Failed</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
