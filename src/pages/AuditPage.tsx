import { Card } from "@/components/ui/card";
import { LayerBadge } from "@/components/ui/layer-badge";
import { auditEntries } from "@/data/mockData";
import { Shield, CheckCircle, XCircle, Clock, Filter } from "lucide-react";
import type { AtheonLayer } from "@/types";

export function AuditPage() {
  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-neutral-700/30 flex items-center justify-center">
            <Shield className="w-5 h-5 text-neutral-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Audit Log</h1>
            <p className="text-sm text-neutral-400">Complete governance trail across all Atheon layers</p>
          </div>
        </div>
        <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-800/60 border border-neutral-700/50 text-sm text-neutral-300 hover:bg-neutral-800 transition-all">
          <Filter size={14} /> Filters
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <span className="text-xs text-neutral-500">Total Events (Today)</span>
          <p className="text-2xl font-bold text-white mt-1">{auditEntries.length}</p>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">Success</span>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{auditEntries.filter(a => a.outcome === 'success').length}</p>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">Pending</span>
          <p className="text-2xl font-bold text-amber-400 mt-1">{auditEntries.filter(a => a.outcome === 'pending').length}</p>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">Failed</span>
          <p className="text-2xl font-bold text-red-400 mt-1">{auditEntries.filter(a => a.outcome === 'failure').length}</p>
        </Card>
      </div>

      {/* Audit Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800">
                <th className="text-left py-3 px-4 text-neutral-500 font-medium">Timestamp</th>
                <th className="text-left py-3 px-4 text-neutral-500 font-medium">Action</th>
                <th className="text-left py-3 px-4 text-neutral-500 font-medium">Layer</th>
                <th className="text-left py-3 px-4 text-neutral-500 font-medium">Details</th>
                <th className="text-left py-3 px-4 text-neutral-500 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {auditEntries.map((entry) => (
                <tr key={entry.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/20 transition-colors">
                  <td className="py-3 px-4 text-xs text-neutral-400 font-mono whitespace-nowrap">
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-sm text-neutral-200">{entry.action}</td>
                  <td className="py-3 px-4">
                    <LayerBadge layer={entry.layer as AtheonLayer} />
                  </td>
                  <td className="py-3 px-4 text-xs text-neutral-500 max-w-xs truncate">
                    {Object.entries(entry.details).map(([k, v]) => `${k}: ${v}`).join(', ')}
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
