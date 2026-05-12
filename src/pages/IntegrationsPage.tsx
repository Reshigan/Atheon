/**
 * UX-11: Unified Integrations Page
 * Merges ERP Adapters + Canonical API into a single page with tabs:
 *   - Connected Systems (active ERP connections)
 *   - Available Adapters (ERP adapters catalog)
 *   - Canonical Data Schema (unified API endpoints + data model)
 */
import { useEffect, useState, useCallback } from "react";
import { Portal } from "@/components/ui/portal";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import type { ERPAdapter, ERPConnection, CanonicalEndpoint, CircuitBreakerState } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import {
  Plug, CheckCircle, XCircle, RefreshCw, Plus, Database,
  Activity, Loader2, X, AlertCircle, Code, Layers, Globe, Play,
  Settings, Trash2, Wifi, Eye, EyeOff, Shield, Key, ShieldAlert, ShieldCheck,
} from "lucide-react";
import { IconERP_SAP, IconERP_Cloud, IconERP_Generic, IconERP_Odoo } from "@/components/icons/AtheonIcons";
import { useAppStore } from "@/stores/appStore";
import { OnboardingPanel } from "@/components/dashboard/OnboardingPanel";

const systemIconMap: Record<string, React.FC<{ size?: number }>> = {
  SAP: IconERP_SAP, SF: IconERP_Cloud, WD: IconERP_Generic, ORC: IconERP_Generic,
  D365: IconERP_Generic, NS: IconERP_Generic, SG: IconERP_Generic, API: IconERP_Generic, Odoo: IconERP_Odoo,
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

/* -- Credential field definitions per auth method -- */
interface CredField {
  key: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password' | 'url';
  required?: boolean;
}

const AUTH_FIELD_MAP: Record<string, CredField[]> = {
  'OAuth 2.0': [
    { key: 'base_url', label: 'Base URL', placeholder: 'https://your-instance.example.com', type: 'url', required: true },
    { key: 'client_id', label: 'Client ID', placeholder: 'Enter OAuth client ID', type: 'text', required: true },
    { key: 'client_secret', label: 'Client Secret', placeholder: 'Enter OAuth client secret', type: 'password', required: true },
    { key: 'auth_url', label: 'Auth URL (optional)', placeholder: 'https://auth.example.com/authorize', type: 'url' },
    { key: 'token_url', label: 'Token URL (optional)', placeholder: 'https://auth.example.com/token', type: 'url' },
    { key: 'scope', label: 'Scope (optional)', placeholder: 'read write', type: 'text' },
  ],
  'API Key': [
    { key: 'base_url', label: 'Base URL', placeholder: 'https://your-instance.example.com', type: 'url', required: true },
    { key: 'api_key', label: 'API Key', placeholder: 'Enter your API key', type: 'password', required: true },
  ],
  'Session Auth': [
    { key: 'base_url', label: 'Base URL', placeholder: 'https://your-instance.example.com', type: 'url', required: true },
    { key: 'username', label: 'Username', placeholder: 'Enter username', type: 'text', required: true },
    { key: 'password', label: 'Password', placeholder: 'Enter password', type: 'password', required: true },
    { key: 'api_key', label: 'Database Name (if applicable)', placeholder: 'e.g. mycompany_db', type: 'text' },
  ],
  'Basic Auth': [
    { key: 'base_url', label: 'Base URL', placeholder: 'https://your-instance.example.com', type: 'url', required: true },
    { key: 'username', label: 'Username', placeholder: 'Enter username', type: 'text', required: true },
    { key: 'password', label: 'Password', placeholder: 'Enter password', type: 'password', required: true },
  ],
  'JWT Bearer': [
    { key: 'base_url', label: 'Base URL', placeholder: 'https://your-instance.example.com', type: 'url', required: true },
    { key: 'client_id', label: 'Client ID', placeholder: 'Enter client ID', type: 'text', required: true },
    { key: 'client_secret', label: 'Private Key / Secret', placeholder: 'Enter private key or secret', type: 'password', required: true },
    { key: 'token_url', label: 'Token URL (optional)', placeholder: 'https://auth.example.com/token', type: 'url' },
  ],
  'Azure AD OAuth': [
    { key: 'base_url', label: 'Dynamics 365 URL', placeholder: 'https://your-org.crm.dynamics.com', type: 'url', required: true },
    { key: 'client_id', label: 'Application (Client) ID', placeholder: 'Enter Azure AD app client ID', type: 'text', required: true },
    { key: 'client_secret', label: 'Client Secret', placeholder: 'Enter Azure AD client secret', type: 'password', required: true },
    { key: 'auth_url', label: 'Authority URL', placeholder: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize', type: 'url' },
    { key: 'token_url', label: 'Token URL', placeholder: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token', type: 'url' },
    { key: 'scope', label: 'Scope', placeholder: 'https://your-org.crm.dynamics.com/.default', type: 'text' },
  ],
  'Service Principal': [
    { key: 'base_url', label: 'Base URL', placeholder: 'https://your-instance.example.com', type: 'url', required: true },
    { key: 'client_id', label: 'Service Principal ID', placeholder: 'Enter service principal client ID', type: 'text', required: true },
    { key: 'client_secret', label: 'Service Principal Secret', placeholder: 'Enter service principal secret', type: 'password', required: true },
  ],
  'Token-Based Auth': [
    { key: 'base_url', label: 'Base URL', placeholder: 'https://your-instance.example.com', type: 'url', required: true },
    { key: 'client_id', label: 'Consumer Key', placeholder: 'Enter consumer key', type: 'text', required: true },
    { key: 'client_secret', label: 'Consumer Secret', placeholder: 'Enter consumer secret', type: 'password', required: true },
    { key: 'api_key', label: 'Token ID', placeholder: 'Enter token ID', type: 'text', required: true },
    { key: 'password', label: 'Token Secret', placeholder: 'Enter token secret', type: 'password', required: true },
  ],
  'X.509 Certificate': [
    { key: 'base_url', label: 'Base URL', placeholder: 'https://your-instance.example.com', type: 'url', required: true },
    { key: 'client_id', label: 'Certificate CN / ID', placeholder: 'Enter certificate identifier', type: 'text', required: true },
    { key: 'client_secret', label: 'Certificate Key (PEM)', placeholder: 'Paste certificate private key', type: 'password', required: true },
  ],
  'SNC': [
    { key: 'base_url', label: 'SAP Host', placeholder: 'https://sap-ecc.example.com', type: 'url', required: true },
    { key: 'username', label: 'SAP User', placeholder: 'Enter SAP username', type: 'text', required: true },
    { key: 'password', label: 'SAP Password', placeholder: 'Enter SAP password', type: 'password', required: true },
    { key: 'client_id', label: 'SNC Partner Name (optional)', placeholder: 'p:CN=...', type: 'text' },
  ],
  'SAML': [
    { key: 'base_url', label: 'Base URL', placeholder: 'https://your-instance.example.com', type: 'url', required: true },
    { key: 'client_id', label: 'SAML Issuer', placeholder: 'Enter SAML issuer', type: 'text', required: true },
    { key: 'client_secret', label: 'SAML Certificate', placeholder: 'Paste SAML certificate', type: 'password', required: true },
  ],
  'X.509': [
    { key: 'base_url', label: 'Base URL', placeholder: 'https://your-instance.example.com', type: 'url', required: true },
    { key: 'client_id', label: 'Certificate CN / ID', placeholder: 'Enter certificate identifier', type: 'text', required: true },
    { key: 'client_secret', label: 'Certificate Key (PEM)', placeholder: 'Paste certificate private key', type: 'password', required: true },
  ],
};

function getCredentialFields(_authMethods: string[], selectedAuth: string): CredField[] {
  const fields = AUTH_FIELD_MAP[selectedAuth];
  if (fields) return fields;
  return [
    { key: 'base_url', label: 'Base URL', placeholder: 'https://your-instance.example.com', type: 'url', required: true },
    { key: 'api_key', label: 'API Key', placeholder: 'Enter API key', type: 'password' },
    { key: 'username', label: 'Username', placeholder: 'Enter username', type: 'text' },
    { key: 'password', label: 'Password', placeholder: 'Enter password', type: 'password' },
  ];
}

/* -- Credential input component -- */
function CredentialInput({ field, value, onChange }: { field: CredField; value: string; onChange: (v: string) => void }) {
  const [showSecret, setShowSecret] = useState(false);
  const isSecret = field.type === 'password';

  return (
    <div>
      <label className="text-xs t-muted flex items-center gap-1">
        {isSecret && <Shield size={10} className="text-amber-400" />}
        {field.label}
        {field.required && <span className="text-red-400">*</span>}
      </label>
      <div className="relative">
        <input
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary pr-9"
          type={isSecret && !showSecret ? 'password' : 'text'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
          autoComplete="off"
        />
        {isSecret && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
            onClick={() => setShowSecret(!showSecret)}
            title={showSecret ? 'Hide' : 'Show'}
          >
            {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
    </div>
  );
}

export function IntegrationsPage() {
  const { activeTab, setActiveTab } = useTabState('connections');
  const user = useAppStore((s) => s.user);
  const activeTenantId = useAppStore((s) => s.activeTenantId);
  const toast = useToast();
  const [adapters, setAdapters] = useState<ERPAdapter[]>([]);
  const [connections, setConnections] = useState<ERPConnection[]>([]);
  const [endpoints, setEndpoints] = useState<CanonicalEndpoint[]>([]);
  const [circuitStates, setCircuitStates] = useState<Record<string, CircuitBreakerState>>({});
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [connectForm, setConnectForm] = useState({ adapterId: '', name: '', syncFrequency: 'daily' });
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [selectedAuth, setSelectedAuth] = useState('');
  const [syncing, setSyncing] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [showLogs, setShowLogs] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [tryingEndpoint, setTryingEndpoint] = useState<string | null>(null);
  const [tryResult, setTryResult] = useState<{ endpointId: string; status: number; data: unknown } | null>(null);
  const [tryLoading, setTryLoading] = useState(false);

  // Configure modal state
  const [configureConn, setConfigureConn] = useState<ERPConnection | null>(null);
  const [configCredentials, setConfigCredentials] = useState<Record<string, string>>({});
  const [configAuth, setConfigAuth] = useState('');
  const [configName, setConfigName] = useState('');
  const [configSyncFreq, setConfigSyncFreq] = useState('');
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // Test connection state
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; connected: boolean; message?: string } | null>(null);

  // Delete state
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // v57: per-connection schema discovery panel state. Loaded lazily when
  // the user opens the panel — a single tenant may have hundreds of fields
  // across multiple ERPs, so we don't fetch eagerly for the whole list.
  type DiscoveredField = {
    entity_type: string;
    source_field: string;
    inferred_type: string;
    sample_values: string[];
    null_rate: number;
    occurrences: number;
    sample_size: number;
    source_system: string;
    first_seen_at: string;
    last_seen_at: string;
  };
  const [showSchemas, setShowSchemas] = useState<string | null>(null);
  const [schemasByConn, setSchemasByConn] = useState<Record<string, Record<string, DiscoveredField[]>>>({});
  const [schemasLoading, setSchemasLoading] = useState<string | null>(null);

  const toggleSchemas = useCallback(async (connId: string) => {
    if (showSchemas === connId) {
      setShowSchemas(null);
      return;
    }
    setShowSchemas(connId);
    if (schemasByConn[connId]) return; // cached
    setSchemasLoading(connId);
    try {
      const res = await api.erp.discoveredSchemas(connId);
      setSchemasByConn((prev) => ({ ...prev, [connId]: res.schemas }));
    } catch {
      setSchemasByConn((prev) => ({ ...prev, [connId]: {} }));
    } finally {
      setSchemasLoading(null);
    }
  }, [showSchemas, schemasByConn]);

  // v58/v59: per-connection mapping review panel — shared-savings billing
  // requires that every canonical-field mapping is auditable and customer-
  // confirmed. The panel shows active vs suggested mappings with confirm /
  // reject actions.
  type Mapping = {
    entity_type: string;
    canonical_field: string;
    source_field: string;
    confidence: number;
    learned_from: string;
    rationale: string | null;
    status: string;
  };
  const [showMappings, setShowMappings] = useState<string | null>(null);
  const [mappingsByConn, setMappingsByConn] = useState<Record<string, Record<string, Mapping[]>>>({});
  const [mappingsLoading, setMappingsLoading] = useState<string | null>(null);
  const [mappingActionPending, setMappingActionPending] = useState<string | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);

  const loadMappings = useCallback(async (connId: string) => {
    setMappingsLoading(connId);
    try {
      const res = await api.erp.mappings(connId);
      setMappingsByConn((prev) => ({ ...prev, [connId]: res.mappings }));
    } catch {
      setMappingsByConn((prev) => ({ ...prev, [connId]: {} }));
    } finally {
      setMappingsLoading(null);
    }
  }, []);

  const toggleMappings = useCallback(async (connId: string) => {
    setMappingError(null);
    if (showMappings === connId) {
      setShowMappings(null);
      return;
    }
    setShowMappings(connId);
    if (!mappingsByConn[connId]) await loadMappings(connId);
  }, [showMappings, mappingsByConn, loadMappings]);

  const handleConfirmMapping = useCallback(async (
    connId: string, canonical: string, source: string, entityType: string,
  ) => {
    setMappingActionPending(`${connId}:${canonical}:${source}`);
    setMappingError(null);
    try {
      await api.erp.confirmMapping(connId, entityType, canonical, source);
      await loadMappings(connId);
    } catch (err) {
      setMappingError(err instanceof Error ? err.message : 'Failed to confirm mapping');
    } finally {
      setMappingActionPending(null);
    }
  }, [loadMappings]);

  const handleRejectMapping = useCallback(async (
    connId: string, canonical: string, source: string, entityType: string,
  ) => {
    setMappingActionPending(`${connId}:${canonical}:${source}`);
    setMappingError(null);
    try {
      await api.erp.rejectMapping(connId, entityType, canonical, source);
      await loadMappings(connId);
    } catch (err) {
      setMappingError(err instanceof Error ? err.message : 'Failed to reject mapping');
    } finally {
      setMappingActionPending(null);
    }
  }, [loadMappings]);

  const handleRefreshMappings = useCallback(async (connId: string) => {
    setMappingActionPending(`${connId}:refresh`);
    setMappingError(null);
    try {
      await api.erp.refreshMappings(connId);
      await loadMappings(connId);
    } catch (err) {
      setMappingError(err instanceof Error ? err.message : 'Failed to refresh mappings');
    } finally {
      setMappingActionPending(null);
    }
  }, [loadMappings]);

  // v61: process profile — structured business rules per connection.
  // Each catalyst reads these so the same handler running for two customers
  // applies each customer's actual tolerance %, payment terms, etc.
  type ProcessProfileResp = Awaited<ReturnType<typeof api.erp.processProfile>>;
  const [showProfile, setShowProfile] = useState<string | null>(null);
  const [profileByConn, setProfileByConn] = useState<Record<string, ProcessProfileResp>>({});
  const [profileLoading, setProfileLoading] = useState<string | null>(null);
  const [profileActionPending, setProfileActionPending] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadProfile = useCallback(async (connId: string) => {
    setProfileLoading(connId);
    try {
      const res = await api.erp.processProfile(connId);
      setProfileByConn((prev) => ({ ...prev, [connId]: res }));
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setProfileLoading(null);
    }
  }, []);

  const toggleProfile = useCallback(async (connId: string) => {
    setProfileError(null);
    if (showProfile === connId) {
      setShowProfile(null);
      return;
    }
    setShowProfile(connId);
    if (!profileByConn[connId]) await loadProfile(connId);
  }, [showProfile, profileByConn, loadProfile]);

  const handleRefreshProfile = useCallback(async (connId: string) => {
    setProfileActionPending(`${connId}:refresh`);
    setProfileError(null);
    try {
      await api.erp.refreshProcessProfile(connId);
      await loadProfile(connId);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to refresh profile');
    } finally {
      setProfileActionPending(null);
    }
  }, [loadProfile]);

  const handleProfileOverride = useCallback(async (connId: string, overrides: Record<string, unknown>) => {
    setProfileActionPending(`${connId}:override`);
    setProfileError(null);
    try {
      await api.erp.updateProcessProfile(connId, overrides);
      await loadProfile(connId);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to save override');
    } finally {
      setProfileActionPending(null);
    }
  }, [loadProfile]);

  // v62: vendor-baseline comparison panel — moves the connection card
  // from "here's your data" to "here's how you compare to the vendor's
  // recommended configuration, and what to do about it".
  type BaselineResp = Awaited<ReturnType<typeof api.erp.baselineComparison>>;
  const [showBaseline, setShowBaseline] = useState<string | null>(null);
  const [baselineByConn, setBaselineByConn] = useState<Record<string, BaselineResp>>({});
  const [baselineLoading, setBaselineLoading] = useState<string | null>(null);

  const toggleBaseline = useCallback(async (connId: string) => {
    if (showBaseline === connId) {
      setShowBaseline(null);
      return;
    }
    setShowBaseline(connId);
    if (baselineByConn[connId]) return;
    setBaselineLoading(connId);
    try {
      const res = await api.erp.baselineComparison(connId);
      setBaselineByConn((prev) => ({ ...prev, [connId]: res }));
    } catch {
      setBaselineByConn((prev) => ({ ...prev, [connId]: { connectionId: connId, vendor: null, reason: 'Failed to load baseline comparison' } }));
    } finally {
      setBaselineLoading(null);
    }
  }, [showBaseline, baselineByConn]);

  const refreshCircuitStates = useCallback(async (conns: ERPConnection[]) => {
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

  const refreshConnections = useCallback(async () => {
    try {
      const c = await api.erp.connections();
      setConnections(c.connections);
      refreshCircuitStates(c.connections);
    } catch (err) {
      console.error('Failed to refresh connections', err);
      toast.error('Failed to refresh connections', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    }
  }, [refreshCircuitStates, toast]);

  const handleSync = async (connectionId: string) => {
    setSyncing(connectionId);
    setActionError(null);
    try {
      const r = await api.erp.sync(connectionId);
      await refreshConnections();
      toast.success('Sync complete', `${r.recordsSynced.toLocaleString()} records synced`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      setActionError(msg);
      toast.error('Sync failed', {
        message: msg,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    }
    setSyncing(null);
  };

  const selectedAdapter = adapters.find(a => a.id === connectForm.adapterId);

  const handleConnect = async () => {
    if (!connectForm.adapterId || !connectForm.name.trim() || connecting) return;
    const effectiveTenantId = activeTenantId || user?.tenantId;
    if (!effectiveTenantId) {
      setConnectError('Unable to determine tenant. Please log in again.');
      return;
    }
    setConnecting(true);
    setConnectError(null);
    try {
      const config: Record<string, string> = {};
      for (const [k, v] of Object.entries(credentialValues)) {
        if (v.trim()) config[k] = v.trim();
      }
      await api.erp.createConnection({
        adapter_id: connectForm.adapterId,
        name: connectForm.name.trim(),
        sync_frequency: connectForm.syncFrequency,
        tenant_id: effectiveTenantId,
        config,
      });
      await refreshConnections();
      toast.success('Connection created', connectForm.name.trim());
      setShowConnect(false);
      setConnectForm({ adapterId: '', name: '', syncFrequency: 'daily' });
      setCredentialValues({});
      setSelectedAuth('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      setConnectError(msg);
      toast.error('Failed to create connection', {
        message: msg,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    }
    setConnecting(false);
  };

  const handleAdapterConnect = (adapterId: string, adapterName: string) => {
    const adapter = adapters.find(a => a.id === adapterId);
    setConnectForm({ adapterId, name: adapterName + ' Connection', syncFrequency: 'daily' });
    setCredentialValues({});
    setSelectedAuth(adapter?.authMethods?.[0] || '');
    setConnectError(null);
    setShowConnect(true);
  };

  const handleTestConnection = async (connectionId: string) => {
    setTesting(connectionId);
    setTestResult(null);
    try {
      const result = await api.erp.testConnection(connectionId);
      setTestResult({ id: connectionId, ...result });
      // Refresh circuit state — test goes through the breaker
      try {
        const cs = await api.erp.circuitState(connectionId);
        setCircuitStates(prev => ({ ...prev, [connectionId]: cs }));
      } catch { /* ignore */ }
    } catch (err) {
      setTestResult({ id: connectionId, connected: false, message: err instanceof Error ? err.message : 'Test failed' });
      toast.error('Test failed', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    }
    setTesting(null);
  };

  const handleDelete = async (connectionId: string) => {
    setDeleting(connectionId);
    try {
      await api.erp.deleteConnection(connectionId);
      await refreshConnections();
      setConfirmDelete(null);
      toast.success('Connection deleted');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      setActionError(msg);
      toast.error('Delete failed', {
        message: msg,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    }
    setDeleting(null);
  };

  const openConfigure = (conn: ERPConnection) => {
    const adapter = adapters.find(a => a.id === conn.adapterId);
    setConfigureConn(conn);
    setConfigName(conn.name);
    setConfigSyncFreq(conn.syncFrequency);
    setConfigAuth(adapter?.authMethods?.[0] || '');
    setConfigCredentials({});
    setConfigError(null);
  };

  const handleSaveConfig = async () => {
    if (!configureConn) return;
    setConfigSaving(true);
    setConfigError(null);
    try {
      const config: Record<string, string> = {};
      for (const [k, v] of Object.entries(configCredentials)) {
        if (v.trim()) config[k] = v.trim();
      }
      const updates: Record<string, unknown> = {};
      if (configName.trim() && configName.trim() !== configureConn.name) updates.name = configName.trim();
      if (configSyncFreq && configSyncFreq !== configureConn.syncFrequency) updates.sync_frequency = configSyncFreq;
      if (Object.keys(config).length > 0) updates.config = config;

      if (Object.keys(updates).length > 0) {
        await api.erp.updateConnection(configureConn.id, updates);
        await refreshConnections();
        toast.success('Connection updated', configureConn.name);
      }
      setConfigureConn(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setConfigError(msg);
      toast.error('Failed to save configuration', {
        message: msg,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    }
    setConfigSaving(false);
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
      else {
        const err = a.reason;
        toast.error('Failed to load adapters', {
          message: err instanceof Error ? err.message : undefined,
          requestId: err instanceof ApiError ? err.requestId : null,
        });
      }
      if (c.status === 'fulfilled') {
        setConnections(c.value.connections);
        refreshCircuitStates(c.value.connections);
      } else {
        const err = c.reason;
        toast.error('Failed to load connections', {
          message: err instanceof Error ? err.message : undefined,
          requestId: err instanceof ApiError ? err.requestId : null,
        });
      }
      if (e.status === 'fulfilled') setEndpoints(e.value.endpoints);
      else {
        const err = e.reason;
        toast.error('Failed to load canonical schema', {
          message: err instanceof Error ? err.message : undefined,
          requestId: err instanceof ApiError ? err.requestId : null,
        });
      }
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const connectCredFields = selectedAdapter && selectedAuth
    ? getCredentialFields(selectedAdapter.authMethods, selectedAuth)
    : [];

  const configAdapter = configureConn ? adapters.find(a => a.id === configureConn.adapterId) : null;
  const configCredFields = configAdapter && configAuth
    ? getCredentialFields(configAdapter.authMethods, configAuth)
    : [];

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
        <Button variant="primary" size="sm" onClick={() => { setShowConnect(true); setSelectedAuth(''); setCredentialValues({}); }} title="Connect a new ERP system">
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

      {/* Connect System Modal */}
      {showConnect && (
        <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold t-primary flex items-center gap-2"><Plug size={18} className="text-accent" /> Connect System</h3>
              <button onClick={() => { setShowConnect(false); setConnectError(null); }} className="text-gray-400 hover:text-gray-300" title="Close"><X size={18} /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs t-muted">ERP Adapter</label>
                <select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" value={connectForm.adapterId} onChange={e => {
                  const adapterId = e.target.value;
                  const adapter = adapters.find(a => a.id === adapterId);
                  setConnectForm(p => ({ ...p, adapterId }));
                  setSelectedAuth(adapter?.authMethods?.[0] || '');
                  setCredentialValues({});
                }}>
                  <option value="">Select an adapter...</option>
                  {adapters.map(a => <option key={a.id} value={a.id}>{a.name} ({a.system})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs t-muted">Connection Name</label>
                <input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" value={connectForm.name} onChange={e => setConnectForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Production SAP, Customer ABC Odoo" />
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

            {selectedAdapter && (
              <div className="space-y-3 pt-2 border-t border-[var(--border-card)]">
                <div className="flex items-center gap-2">
                  <Key size={14} className="text-accent" />
                  <span className="text-sm font-medium t-primary">Connection Credentials</span>
                </div>

                {selectedAdapter.authMethods.length > 1 && (
                  <div>
                    <label className="text-xs t-muted">Authentication Method</label>
                    <select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" value={selectedAuth} onChange={e => { setSelectedAuth(e.target.value); setCredentialValues({}); }}>
                      {selectedAdapter.authMethods.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                )}
                {selectedAdapter.authMethods.length === 1 && (
                  <p className="text-xs t-muted">Auth: <span className="text-accent font-medium">{selectedAdapter.authMethods[0]}</span></p>
                )}

                {connectCredFields.map(field => (
                  <CredentialInput
                    key={field.key}
                    field={field}
                    value={credentialValues[field.key] || ''}
                    onChange={v => setCredentialValues(prev => ({ ...prev, [field.key]: v }))}
                  />
                ))}

                <p className="text-caption t-muted flex items-center gap-1">
                  <Shield size={10} /> Credentials are encrypted before storage. You can also configure them later.
                </p>
              </div>
            )}

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

      {/* Configure Connection Modal */}
      {configureConn && (
        <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold t-primary flex items-center gap-2"><Settings size={18} className="text-accent" /> Configure Connection</h3>
              <button onClick={() => { setConfigureConn(null); setConfigError(null); }} className="text-gray-400 hover:text-gray-300" title="Close"><X size={18} /></button>
            </div>

            <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-card)] flex items-center justify-center">
                {(() => { const SysIcon = systemIconMap[configureConn.adapterSystem] || IconERP_Generic; return <SysIcon size={16} />; })()}
              </div>
              <div>
                <p className="text-sm font-medium t-primary">{configureConn.adapterName}</p>
                <p className="text-xs t-muted">{configureConn.adapterProtocol}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs t-muted">Connection Name</label>
                <input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" value={configName} onChange={e => setConfigName(e.target.value)} placeholder="Connection name" />
              </div>
              <div>
                <label className="text-xs t-muted">Sync Frequency</label>
                <select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" value={configSyncFreq} onChange={e => setConfigSyncFreq(e.target.value)}>
                  <option value="realtime">Real-time</option>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
            </div>

            {configAdapter && (
              <div className="space-y-3 pt-2 border-t border-[var(--border-card)]">
                <div className="flex items-center gap-2">
                  <Key size={14} className="text-accent" />
                  <span className="text-sm font-medium t-primary">Update Credentials</span>
                </div>

                {configAdapter.authMethods.length > 1 && (
                  <div>
                    <label className="text-xs t-muted">Authentication Method</label>
                    <select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" value={configAuth} onChange={e => { setConfigAuth(e.target.value); setConfigCredentials({}); }}>
                      {configAdapter.authMethods.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                )}
                {configAdapter.authMethods.length === 1 && (
                  <p className="text-xs t-muted">Auth: <span className="text-accent font-medium">{configAdapter.authMethods[0]}</span></p>
                )}

                {configCredFields.map(field => (
                  <CredentialInput
                    key={field.key}
                    field={field}
                    value={configCredentials[field.key] || ''}
                    onChange={v => setConfigCredentials(prev => ({ ...prev, [field.key]: v }))}
                  />
                ))}

                <p className="text-caption t-muted flex items-center gap-1">
                  <Shield size={10} /> Leave fields blank to keep existing values. New values are encrypted before storage.
                </p>
              </div>
            )}

            {configError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2"><AlertCircle size={14} /> {configError}</div>
            )}
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" size="sm" onClick={() => { setConfigureConn(null); setConfigError(null); }}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleSaveConfig} disabled={configSaving}>
                {configSaving ? <Loader2 size={14} className="animate-spin" /> : <Settings size={14} />} Save Configuration
              </Button>
            </div>
          </div>
        </div></Portal>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-lg font-semibold t-primary">Delete Connection</h3>
            <p className="text-sm t-muted">Are you sure you want to delete this connection? This will remove all configuration and sync history. This action cannot be undone.</p>
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="primary" size="sm" className="!bg-red-500 hover:!bg-red-600" onClick={() => handleDelete(confirmDelete)} disabled={deleting === confirmDelete}>
                {deleting === confirmDelete ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
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
                    <div className="flex items-center gap-2">
                      {(() => {
                        const cb = circuitStates[conn.id];
                        if (!cb || cb.state === 'CLOSED') return null;
                        const openedStr = cb.openedAt ? new Date(cb.openedAt).toLocaleTimeString() : '—';
                        const title = `Circuit ${cb.state} — ${cb.failures} failure(s)${cb.openedAt ? `, opened ${openedStr}` : ''}. Adapter is ${cb.state === 'OPEN' ? 'blocking' : 'probing'} calls.`;
                        const variant: 'danger' | 'warning' = cb.state === 'OPEN' ? 'danger' : 'warning';
                        const Icon = cb.state === 'OPEN' ? ShieldAlert : ShieldCheck;
                        return (
                          <span title={title} className="inline-flex">
                            <Badge variant={variant}>
                              <Icon size={10} className="mr-1" /> Circuit {cb.state}
                            </Badge>
                          </span>
                        );
                      })()}
                      <Badge variant={conn.status === 'connected' ? 'success' : conn.status === 'syncing' ? 'info' : conn.status === 'error' ? 'danger' : 'default'}>
                        {conn.status === 'connected' && <CheckCircle size={10} className="mr-1" />}
                        {conn.status === 'syncing' && <RefreshCw size={10} className="mr-1 animate-spin" />}
                        {conn.status === 'error' && <XCircle size={10} className="mr-1" />}
                        {conn.status}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                    <div className="p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                      <span className="text-caption t-muted">Records Synced</span>
                      <p className="text-lg font-bold t-primary">{(conn.recordsSynced || 0).toLocaleString()}</p>
                    </div>
                    <div className="p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                      <span className="text-caption t-muted">Sync Frequency</span>
                      <p className="text-lg font-bold t-primary">{conn.syncFrequency}</p>
                    </div>
                    <div className="p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                      <span className="text-caption t-muted">Last Sync</span>
                      <p className="text-sm font-medium text-gray-400">{conn.lastSync ? new Date(conn.lastSync).toLocaleTimeString() : 'Never'}</p>
                    </div>
                  </div>

                  {testResult && testResult.id === conn.id && (
                    <div className={`mt-3 p-3 rounded-lg border text-sm flex items-center gap-2 animate-fadeIn ${
                      testResult.connected
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : 'bg-red-500/10 border-red-500/20 text-red-400'
                    }`}>
                      {testResult.connected ? <CheckCircle size={14} /> : <XCircle size={14} />}
                      {testResult.connected ? 'Connection successful' : `Connection failed${testResult.message ? ': ' + testResult.message : ''}`}
                    </div>
                  )}

                  {/* v64 — onboarding checklist per connection. Surfaces the
                      customer-side steps (review mappings, set profile, choose
                      autonomy, dispatch action) that gate full value. */}
                  <OnboardingPanel connectionId={conn.id} />

                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button variant="secondary" size="sm" onClick={() => openConfigure(conn)} title="Configure connection credentials and settings">
                      <Settings size={12} /> Configure
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleTestConnection(conn.id)} disabled={testing === conn.id} title="Test connection to the remote system">
                      {testing === conn.id ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />} Test Connection
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleSync(conn.id)} disabled={syncing === conn.id} title="Trigger a manual data sync now">
                      {syncing === conn.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sync Now
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowLogs(showLogs === conn.id ? null : conn.id)} title="View sync activity logs">
                      <Activity size={12} /> {showLogs === conn.id ? 'Hide Logs' : 'View Logs'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleSchemas(conn.id)} title="View fields Atheon has discovered from your ERP records">
                      <Database size={12} /> {showSchemas === conn.id ? 'Hide Schema' : 'View Schema'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleMappings(conn.id)} title="Review canonical-field mappings (confirm or reject auto-suggested mappings)">
                      <Shield size={12} /> {showMappings === conn.id ? 'Hide Mappings' : 'Review Mappings'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleProfile(conn.id)} title="Process profile — business rules catalysts apply for this connection (tolerances, payment terms, matching mode)">
                      <Settings size={12} /> {showProfile === conn.id ? 'Hide Profile' : 'Process Profile'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleBaseline(conn.id)} title="Compare your configuration to the vendor's recommended defaults (SAP / Odoo / Xero)">
                      <Layers size={12} /> {showBaseline === conn.id ? 'Hide Baseline' : 'Vendor Baseline'}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => setConfirmDelete(conn.id)} title="Delete this connection">
                      <Trash2 size={12} /> Delete
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

                  {showSchemas === conn.id && (
                    <div className="mt-3 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] animate-fadeIn">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="text-sm font-semibold t-primary flex items-center gap-2">
                            <Database size={14} /> Discovered Schema
                          </h4>
                          <p className="text-xs t-muted mt-0.5">
                            Fields Atheon has profiled from records this connection sent.
                            Custom fields (Z-fields, custom modules) appear here verbatim.
                          </p>
                        </div>
                      </div>
                      {schemasLoading === conn.id ? (
                        <div className="flex items-center gap-2 text-xs t-muted py-4 justify-center">
                          <Loader2 size={14} className="animate-spin" /> Loading discovered fields…
                        </div>
                      ) : !schemasByConn[conn.id] || Object.keys(schemasByConn[conn.id] || {}).length === 0 ? (
                        <div className="text-xs t-muted py-4 text-center">
                          No fields discovered yet — sync the connection to populate the schema.
                        </div>
                      ) : (
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                          {Object.entries(schemasByConn[conn.id]).map(([entity, fields]) => (
                            <div key={entity}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-semibold t-primary">{entity}</span>
                                <Badge variant="outline" size="sm">{fields.length} fields</Badge>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-[var(--border-card)] text-left t-muted">
                                      <th className="py-1 pr-3 font-medium">Field</th>
                                      <th className="py-1 pr-3 font-medium">Type</th>
                                      <th className="py-1 pr-3 font-medium">Null %</th>
                                      <th className="py-1 pr-3 font-medium">Sample values</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {fields.map((f) => (
                                      <tr key={f.source_field} className="border-b border-[var(--border-card)]/50">
                                        <td className="py-1 pr-3 font-mono t-primary">{f.source_field}</td>
                                        <td className="py-1 pr-3 t-muted">{f.inferred_type}</td>
                                        <td className="py-1 pr-3 t-muted">{Math.round((f.null_rate || 0) * 100)}%</td>
                                        <td className="py-1 pr-3 t-muted">
                                          {(f.sample_values || []).slice(0, 3).join(', ') || <span className="opacity-50">—</span>}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {showMappings === conn.id && (
                    <div className="mt-3 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] animate-fadeIn">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="text-sm font-semibold t-primary flex items-center gap-2">
                            <Shield size={14} /> Field Mappings
                          </h4>
                          <p className="text-xs t-muted mt-0.5">
                            Each canonical field (amount, ref, entity, …) maps to one or more source fields. Confirm to lock for billing audits; reject to remove from the active set.
                          </p>
                        </div>
                        <Button
                          variant="secondary" size="sm"
                          onClick={() => handleRefreshMappings(conn.id)}
                          disabled={mappingActionPending === `${conn.id}:refresh`}
                          title="Re-run the auto-mapper on the current schema"
                        >
                          {mappingActionPending === `${conn.id}:refresh` ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
                        </Button>
                      </div>

                      {mappingError && (
                        <div className="mb-2 p-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                          {mappingError}
                        </div>
                      )}

                      {mappingsLoading === conn.id ? (
                        <div className="flex items-center gap-2 text-xs t-muted py-4 justify-center">
                          <Loader2 size={14} className="animate-spin" /> Loading mappings…
                        </div>
                      ) : !mappingsByConn[conn.id] || Object.keys(mappingsByConn[conn.id] || {}).length === 0 ? (
                        <div className="text-xs t-muted py-4 text-center">
                          No mappings yet — sync the connection to populate the auto-mapper.
                        </div>
                      ) : (
                        <div className="space-y-3 max-h-[28rem] overflow-y-auto">
                          {Object.entries(mappingsByConn[conn.id]).map(([canonical, rows]) => (
                            <div key={canonical}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-semibold t-primary">{canonical}</span>
                                <Badge variant="outline" size="sm">{rows.length} candidate{rows.length === 1 ? '' : 's'}</Badge>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-[var(--border-card)] text-left t-muted">
                                      <th className="py-1 pr-3 font-medium">Source field</th>
                                      <th className="py-1 pr-3 font-medium">Entity</th>
                                      <th className="py-1 pr-3 font-medium">Confidence</th>
                                      <th className="py-1 pr-3 font-medium">Status</th>
                                      <th className="py-1 pr-3 font-medium">From</th>
                                      <th className="py-1 pr-3 font-medium">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map((m) => {
                                      const pendingKey = `${conn.id}:${m.canonical_field}:${m.source_field}`;
                                      const pending = mappingActionPending === pendingKey;
                                      return (
                                        <tr key={`${m.entity_type}-${m.canonical_field}-${m.source_field}`} className="border-b border-[var(--border-card)]/50">
                                          <td className="py-1 pr-3 font-mono t-primary">{m.source_field}</td>
                                          <td className="py-1 pr-3 t-muted">{m.entity_type}</td>
                                          <td className="py-1 pr-3 t-muted">{Math.round(m.confidence * 100)}%</td>
                                          <td className="py-1 pr-3">
                                            <Badge
                                              variant={m.status === 'active' ? 'success' : m.status === 'rejected' ? 'danger' : 'warning'}
                                              size="sm"
                                            >
                                              {m.status}
                                            </Badge>
                                          </td>
                                          <td className="py-1 pr-3 t-muted">{m.learned_from}</td>
                                          <td className="py-1 pr-3">
                                            <div className="flex items-center gap-1">
                                              {m.status !== 'active' && (
                                                <Button
                                                  variant="ghost" size="sm"
                                                  onClick={() => handleConfirmMapping(conn.id, m.canonical_field, m.source_field, m.entity_type)}
                                                  disabled={pending}
                                                  title="Confirm — lock this mapping into the audit trail"
                                                >
                                                  {pending ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Confirm
                                                </Button>
                                              )}
                                              {m.status !== 'rejected' && (
                                                <Button
                                                  variant="ghost" size="sm"
                                                  className="text-red-400 hover:text-red-300"
                                                  onClick={() => handleRejectMapping(conn.id, m.canonical_field, m.source_field, m.entity_type)}
                                                  disabled={pending}
                                                  title="Reject — remove from the active set"
                                                >
                                                  {pending ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />} Reject
                                                </Button>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {showProfile === conn.id && (
                    <div className="mt-3 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] animate-fadeIn">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="text-sm font-semibold t-primary flex items-center gap-2">
                            <Settings size={14} /> Process Profile
                          </h4>
                          <p className="text-xs t-muted mt-0.5">
                            Business rules every catalyst applies for this connection. Inferred from your data; click to override when our inference is wrong or unsure.
                          </p>
                        </div>
                        <Button
                          variant="secondary" size="sm"
                          onClick={() => handleRefreshProfile(conn.id)}
                          disabled={profileActionPending === `${conn.id}:refresh`}
                          title="Re-run inference on the latest synced data"
                        >
                          {profileActionPending === `${conn.id}:refresh` ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Re-infer
                        </Button>
                      </div>

                      {profileError && (
                        <div className="mb-2 p-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                          {profileError}
                        </div>
                      )}

                      {profileLoading === conn.id ? (
                        <div className="flex items-center gap-2 text-xs t-muted py-4 justify-center">
                          <Loader2 size={14} className="animate-spin" /> Loading process profile…
                        </div>
                      ) : !profileByConn[conn.id] ? (
                        <div className="text-xs t-muted py-4 text-center">
                          Profile not loaded.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {([
                            ['Matching Mode', 'matching_mode', String(profileByConn[conn.id].profile.matching_mode), ['none', '2way', '3way']],
                            ['Tolerance %', 'tolerance_pct', String(profileByConn[conn.id].profile.tolerance_pct), null],
                            ['Payment Terms (days)', 'payment_terms_days', String(profileByConn[conn.id].profile.payment_terms_days), null],
                            ['Default Currency', 'default_currency', profileByConn[conn.id].profile.default_currency, null],
                            ['Fiscal Year Start (month)', 'fiscal_year_start_month', String(profileByConn[conn.id].profile.fiscal_year_start_month), null],
                          ] as Array<[string, string, string, string[] | null]>).map(([label, field, value, options]) => {
                            const ev = profileByConn[conn.id].evidence[field] || { source: 'default' };
                            const isLowConf = ev.source === 'low-confidence';
                            const isHuman = ev.source === 'human';
                            return (
                              <div key={field} className={`p-2 rounded border ${isLowConf ? 'border-amber-500/30 bg-amber-500/5' : 'border-[var(--border-card)] bg-[var(--bg-primary)]'}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-medium t-primary">{label}</span>
                                      <Badge
                                        variant={isHuman ? 'success' : isLowConf ? 'warning' : ev.source === 'inferred' ? 'info' : 'default'}
                                        size="sm"
                                      >
                                        {ev.source}{ev.confidence !== undefined ? ` · ${Math.round(ev.confidence * 100)}%` : ''}
                                      </Badge>
                                    </div>
                                    {ev.basis && <p className="text-caption t-muted mt-0.5">{ev.basis}</p>}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {options ? (
                                      <select
                                        className="text-xs bg-[var(--bg-secondary)] border border-[var(--border-card)] rounded px-2 py-1 t-primary"
                                        value={value}
                                        disabled={profileActionPending === `${conn.id}:override`}
                                        onChange={(e) => handleProfileOverride(conn.id, { [field]: e.target.value })}
                                      >
                                        {options.map((o) => <option key={o} value={o}>{o}</option>)}
                                      </select>
                                    ) : (
                                      <input
                                        type={field.includes('days') || field.includes('pct') || field.includes('month') ? 'number' : 'text'}
                                        className="text-xs bg-[var(--bg-secondary)] border border-[var(--border-card)] rounded px-2 py-1 t-primary w-28"
                                        defaultValue={value}
                                        disabled={profileActionPending === `${conn.id}:override`}
                                        onBlur={(e) => {
                                          if (e.target.value === value) return;
                                          const val = field.includes('days') || field.includes('pct') || field.includes('month')
                                            ? parseFloat(e.target.value)
                                            : e.target.value;
                                          handleProfileOverride(conn.id, { [field]: val });
                                        }}
                                      />
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {showBaseline === conn.id && (
                    <div className="mt-3 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] animate-fadeIn">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="text-sm font-semibold t-primary flex items-center gap-2">
                            <Layers size={14} /> Vendor Baseline
                          </h4>
                          <p className="text-xs t-muted mt-0.5">
                            How your configuration compares to the vanilla vendor recommendation. Deviations are flagged with rationale + source — they are not necessarily wrong, but worth a conscious decision.
                          </p>
                        </div>
                      </div>
                      {baselineLoading === conn.id ? (
                        <div className="flex items-center gap-2 text-xs t-muted py-4 justify-center">
                          <Loader2 size={14} className="animate-spin" /> Loading vendor baseline…
                        </div>
                      ) : !baselineByConn[conn.id] ? (
                        <div className="text-xs t-muted py-4 text-center">Not loaded.</div>
                      ) : !baselineByConn[conn.id].vendor ? (
                        <div className="p-3 rounded bg-[var(--bg-primary)] text-xs t-muted">
                          {baselineByConn[conn.id].reason}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="info" size="sm">{baselineByConn[conn.id].vendor}</Badge>
                            <span className="text-xs t-muted">{baselineByConn[conn.id].product}</span>
                            <span className="ml-auto text-xs">
                              <Badge variant={(baselineByConn[conn.id].alignment_score || 0) >= 0.8 ? 'success' : (baselineByConn[conn.id].alignment_score || 0) >= 0.5 ? 'warning' : 'danger'} size="sm">
                                Alignment: {Math.round((baselineByConn[conn.id].alignment_score || 0) * 100)}%
                              </Badge>
                            </span>
                          </div>

                          {(baselineByConn[conn.id].profile_deviations || []).length > 0 && (
                            <div>
                              <div className="text-xs font-semibold t-primary mb-1">Configuration deviations</div>
                              <div className="space-y-1.5">
                                {baselineByConn[conn.id].profile_deviations!.map((d) => (
                                  <div key={d.field} className={`p-2 rounded border text-xs ${
                                    d.severity === 'critical' ? 'border-red-500/30 bg-red-500/5'
                                      : d.severity === 'warning' ? 'border-amber-500/30 bg-amber-500/5'
                                      : 'border-[var(--border-card)] bg-[var(--bg-primary)]'
                                  }`}>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-medium t-primary">{d.field}</span>
                                      <Badge variant={d.severity === 'critical' ? 'danger' : 'warning'} size="sm">{d.severity}</Badge>
                                    </div>
                                    <div className="t-muted mt-0.5">
                                      You: <span className="font-mono t-primary">{String(d.customer_value)}</span> · Vendor: <span className="font-mono t-primary">{String(d.recommended_value)}</span>
                                    </div>
                                    <div className="t-muted mt-1">{d.rationale}</div>
                                    <div className="t-muted mt-1 italic">{d.action}</div>
                                    <div className="text-caption t-muted mt-1 opacity-70">Source: {d.source}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {(baselineByConn[conn.id].schema_deviations || []).length > 0 && (
                            <div>
                              <div className="text-xs font-semibold t-primary mb-1">Schema deviations</div>
                              <div className="space-y-1.5">
                                {baselineByConn[conn.id].schema_deviations!.map((d) => (
                                  <div key={d.entity_type} className="p-2 rounded border border-[var(--border-card)] bg-[var(--bg-primary)] text-xs">
                                    <div className="font-medium t-primary mb-0.5">{d.entity_type}</div>
                                    {d.missing_fields.length > 0 && (
                                      <div className="t-muted">
                                        Missing standard fields ({d.missing_fields.length}): <span className="font-mono">{d.missing_fields.slice(0, 6).join(', ')}{d.missing_fields.length > 6 ? '…' : ''}</span>
                                      </div>
                                    )}
                                    {d.custom_fields.length > 0 && (
                                      <div className="t-muted">
                                        Custom fields ({d.custom_fields.length}): <span className="font-mono">{d.custom_fields.slice(0, 6).join(', ')}{d.custom_fields.length > 6 ? '…' : ''}</span>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {(baselineByConn[conn.id].flows || []).length > 0 && (
                            <div>
                              <div className="text-xs font-semibold t-primary mb-1">Vendor process flows</div>
                              <div className="space-y-1.5">
                                {baselineByConn[conn.id].flows!.map((f) => (
                                  <details key={f.name} className="p-2 rounded border border-[var(--border-card)] bg-[var(--bg-primary)] text-xs">
                                    <summary className="cursor-pointer font-medium t-primary">{f.name}</summary>
                                    <p className="t-muted mt-1">{f.description}</p>
                                    <ol className="mt-2 space-y-1 list-decimal list-inside">
                                      {f.steps.map((s, idx) => (
                                        <li key={idx} className="t-muted">
                                          <span className="font-medium t-primary">{s.step}</span>{!s.required && <span className="opacity-60"> (optional)</span>} — {s.description}
                                        </li>
                                      ))}
                                    </ol>
                                  </details>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
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
                          <span className="text-caption t-muted">v{ep.version}</span>
                          <span className="text-caption t-muted">Rate limit: {ep.rateLimit}/min</span>
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
                                  const tenantQs = activeTenantId || user?.tenantId;
                                  const url = tenantQs ? `${ep.path}?tenant_id=${encodeURIComponent(tenantQs)}` : ep.path;
                                  api.get(url)
                                    .then((data) => {
                                      setTryResult({ endpointId: ep.id, status: 200, data });
                                    })
                                    .catch((err) => {
                                      const status = err instanceof ApiError ? err.status : 0;
                                      const message = err instanceof Error ? err.message : 'Network error';
                                      setTryResult({ endpointId: ep.id, status, data: { error: message } });
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
