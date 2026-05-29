/**
 * Connectivity — Integration Health
 *
 * Read-only health dashboard for ERP connections: status, circuit breaker
 * state, last sync, schedule, record counts, multicompany awareness.
 *
 * Unlike IntegrationsPage (which creates/configures connections), this page
 * is a live-sync health view — use it to diagnose whether adapters are
 * healthy and which ones are tripping the circuit breaker.
 *
 * Per PR #219/#220, synced data carries company_id; when more than one
 * erp_company is registered we surface "N records across M companies" so
 * users understand the multi-company footprint without having to switch
 * the global company picker.
 */
import { useState, useEffect, useCallback } from "react";
import { api, ApiError } from "@/lib/api";
import type { ERPConnection, CircuitBreakerState, ERPCompany } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/state";
import {
  Plug, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Clock, Loader2,
  Play, Wifi, ShieldAlert, ShieldCheck, Building2,
} from "lucide-react";

type ConnStatus = 'connected' | 'disconnected' | 'error' | 'syncing';

function coerceStatus(s: string): ConnStatus {
  if (s === 'connected' || s === 'syncing' || s === 'error') return s;
  return 'disconnected';
}

export function ConnectivityPage() {
  const [connections, setConnections] = useState<ERPConnection[]>([]);
  const [circuitStates, setCircuitStates] = useState<Record<string, CircuitBreakerState>>({});
  const [companies, setCompanies] = useState<ERPCompany[]>([]);
  const [testResults, setTestResults] = useState<Record<string, { connected: boolean; message?: string }>>({});
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const toast = useToast();

  const loadCircuit = useCallback(async (conns: ERPConnection[]) => {
    if (conns.length === 0) return;
    const entries = await Promise.all(
      conns.map(async (c) => {
        try {
          const s = await api.erp.circuitState(c.id);
          return [c.id, s] as const;
        } catch {
          return null;
        }
      }),
    );
    const next: Record<string, CircuitBreakerState> = {};
    for (const e of entries) if (e) next[e[0]] = e[1];
    setCircuitStates(next);
  }, []);

  const fetchConnections = useCallback(async () => {
    try {
      const data = await api.erp.connections();
      setConnections(data.connections);
      loadCircuit(data.connections);
    } catch (err) {
      console.error("Failed to load connections", err);
      toast.error('Failed to load connections', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  }, [loadCircuit, toast]);

  const fetchCompanies = useCallback(async () => {
    try {
      const data = await api.companies.list();
      setCompanies(data.companies);
    } catch {
      // Non-critical — single-company tenants will have no rows
      setCompanies([]);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
    fetchCompanies();
  }, [fetchConnections, fetchCompanies]);

  const testConnection = async (id: string) => {
    setTestingId(id);
    try {
      const result = await api.erp.testConnection(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
      if (result.connected) {
        toast.success('Connection OK', connections.find(c => c.id === id)?.name);
      } else {
        toast.warning('Connection unhealthy', result.message ?? 'Remote system unreachable');
      }
      // Refresh circuit — tests flow through the breaker
      try {
        const cs = await api.erp.circuitState(id);
        setCircuitStates(prev => ({ ...prev, [id]: cs }));
      } catch { /* ignore */ }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection test failed';
      setTestResults((prev) => ({ ...prev, [id]: { connected: false, message: msg } }));
      toast.error('Test failed', {
        message: msg,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setTestingId(null);
    }
  };

  const statusIcon = (status: ConnStatus) => {
    switch (status) {
      case "connected": return <CheckCircle2 size={16} style={{ color: 'var(--accent)' }} />;
      case "syncing": return <RefreshCw size={16} className="animate-spin" style={{ color: 'var(--info)' }} />;
      case "error": return <XCircle size={16} style={{ color: 'var(--neg)' }} />;
      default: return <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />;
    }
  };

  const statusLabel = (status: ConnStatus) => {
    switch (status) {
      case "connected": return "Connected";
      case "syncing": return "Syncing";
      case "error": return "Error";
      default: return "Disconnected";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent)" }} />
      </div>
    );
  }

  const multicompany = companies.length > 1;
  const normalisedConnections = connections.map(c => ({ ...c, _status: coerceStatus(c.status) as ConnStatus }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Connectivity · Systems"
        title="Connectivity"
        dek="Live Protocols &amp; Integration Health"
        actions={
          multicompany ? (
            <div className="flex items-center gap-1.5 text-xs t-muted px-2.5 py-1 rounded-md"
                 style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}
                 title="Synced ERP data spans multiple company codes (BUKRS/tenant)">
              <Building2 size={12} /> {companies.length} companies
            </div>
          ) : undefined
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Connections", value: normalisedConnections.length, icon: Wifi },
          { label: "Connected", value: normalisedConnections.filter((c) => c._status === "connected").length, icon: CheckCircle2 },
          { label: "Errors", value: normalisedConnections.filter((c) => c._status === "error").length, icon: XCircle },
          { label: "Circuits Open", value: Object.values(circuitStates).filter(s => s.state !== 'CLOSED').length, icon: ShieldAlert },
        ].map((card) => (
          <div key={card.label} className="rounded-md p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
            <div className="flex items-center gap-2 mb-2">
              <card.icon size={14} className="t-muted" />
              <span className="text-label">{card.label}</span>
            </div>
            <p className="text-xl font-bold t-primary">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Connection health cards */}
      <div className="space-y-3">
        {normalisedConnections.map((conn) => {
          const cb = circuitStates[conn.id];
          const tr = testResults[conn.id];
          return (
            <div key={conn.id} className="rounded-md p-5" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {/* Live status pulse — connected nodes get a sage breathing
                      dot (matches Stitch "Live Protocols" pattern); other
                      states fall back to the static status glyph. */}
                  {conn._status === 'connected' ? (
                    <span className="relative inline-flex w-2.5 h-2.5" aria-hidden="true" title="Live connection">
                      <span className="absolute inset-0 rounded-full animate-ping" style={{ background: 'var(--accent)', opacity: 0.55 }} />
                      <span className="relative inline-flex w-2.5 h-2.5 rounded-full" style={{ background: 'var(--accent)', boxShadow: '0 0 0 3px rgb(var(--accent-rgb) / 0.18)' }} />
                    </span>
                  ) : (
                    statusIcon(conn._status)
                  )}
                  <div>
                    <p className="text-sm font-medium t-primary">{conn.name}</p>
                    <p className="text-xs t-muted">{conn.adapterName} &middot; {statusLabel(conn._status)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {cb && cb.state !== 'CLOSED' && (
                    <span
                      className="inline-flex items-center gap-1 text-caption px-2 py-0.5 rounded-md border font-medium"
                      style={
                        cb.state === 'OPEN'
                          ? { background: 'rgb(var(--neg-rgb) / 0.10)', color: 'var(--neg)', borderColor: 'rgb(var(--neg-rgb) / 0.20)' }
                          : { background: 'rgb(var(--warning-rgb, 180 130 60) / 0.10)', color: 'var(--warning)', borderColor: 'rgb(var(--warning-rgb, 180 130 60) / 0.20)' }
                      }
                      title={`Circuit ${cb.state} — ${cb.failures} failure(s)${cb.openedAt ? ', opened ' + new Date(cb.openedAt).toLocaleTimeString() : ''}`}
                    >
                      {cb.state === 'OPEN' ? <ShieldAlert size={10} /> : <ShieldCheck size={10} />} Circuit {cb.state}
                    </span>
                  )}
                  <button
                    onClick={() => testConnection(conn.id)}
                    disabled={testingId === conn.id}
                    className="px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                    style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
                  >
                    {testingId === conn.id ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    Test
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-4">
                <div>
                  <p className="text-label">Last Sync</p>
                  <p className="text-xs t-secondary flex items-center gap-1">
                    <Clock size={10} /> {conn.lastSync ? new Date(conn.lastSync).toLocaleString() : "Never"}
                  </p>
                </div>
                <div>
                  <p className="text-label">Schedule</p>
                  <p className="text-xs t-secondary">{conn.syncFrequency || "Manual"}</p>
                </div>
                <div>
                  <p className="text-label">Records Synced</p>
                  <p className="text-xs t-secondary">
                    {(conn.recordsSynced ?? 0).toLocaleString()}
                    {multicompany && <span className="t-muted"> across {companies.length} companies</span>}
                  </p>
                </div>
              </div>

              {tr && !tr.connected && tr.message && (
                <p className="mt-2 text-xs" style={{ color: 'var(--neg)' }}>{tr.message}</p>
              )}
              {tr && tr.connected && (
                <p className="mt-2 text-xs" style={{ color: 'var(--accent)' }}>Last test: connection successful</p>
              )}
            </div>
          );
        })}
        {normalisedConnections.length === 0 && (
          <EmptyState
            icon={Plug}
            title="No connections configured yet."
            description="Go to Integrations to set up your first connection."
            action={{ label: 'Open Integrations', href: '/integrations' }}
          />
        )}
      </div>
    </div>
  );
}
