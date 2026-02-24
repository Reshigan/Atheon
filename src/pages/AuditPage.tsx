import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { LayerBadge } from "@/components/ui/layer-badge";
import { api } from "@/lib/api";
import type { AuditEntry } from "@/lib/api";
import { Shield, CheckCircle, XCircle, Clock, Filter, Loader2 } from "lucide-react";
import type { AtheonLayer } from "@/types";

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

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
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
            <Shield className="w-5 h-5 text-gray-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
            <p className="text-sm text-gray-500">Complete governance trail across all Atheon layers</p>
          </div>
        </div>
        <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 border border-gray-200 text-sm text-gray-600 hover:bg-gray-100 transition-all">
          <Filter size={14} /> Filters
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <span className="text-xs text-gray-400">Total Events (Today)</span>
          <p className="text-2xl font-bold text-gray-900 mt-1">{entries.length}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Success</span>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{entries.filter(a => a.outcome === 'success').length}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Pending</span>
          <p className="text-2xl font-bold text-amber-600 mt-1">{entries.filter(a => a.outcome === 'pending').length}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Failed</span>
          <p className="text-2xl font-bold text-red-600 mt-1">{entries.filter(a => a.outcome === 'failure').length}</p>
        </Card>
      </div>

      {/* Audit Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Timestamp</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Action</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Layer</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Details</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-gray-200 hover:bg-gray-100/20 transition-colors">
                  <td className="py-3 px-4 text-xs text-gray-500 font-mono whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-800">{entry.action}</td>
                  <td className="py-3 px-4">
                    <LayerBadge layer={entry.layer as AtheonLayer} />
                  </td>
                  <td className="py-3 px-4 text-xs text-gray-400 max-w-xs truncate">
                    {entry.details ? Object.entries(entry.details).map(([k, v]) => `${k}: ${v}`).join(', ') : '-'}
                  </td>
                  <td className="py-3 px-4">
                    {entry.outcome === 'success' && (
                      <div className="flex items-center gap-1.5">
                        <CheckCircle size={14} className="text-emerald-600" />
                        <span className="text-xs text-emerald-600">Success</span>
                      </div>
                    )}
                    {entry.outcome === 'pending' && (
                      <div className="flex items-center gap-1.5">
                        <Clock size={14} className="text-amber-600" />
                        <span className="text-xs text-amber-600">Pending</span>
                      </div>
                    )}
                    {entry.outcome === 'failure' && (
                      <div className="flex items-center gap-1.5">
                        <XCircle size={14} className="text-red-600" />
                        <span className="text-xs text-red-600">Failed</span>
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
