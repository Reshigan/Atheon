/**
 * ADMIN-009: Data Governance Dashboard
 * Retention, DSAR history, erasure log, audit volume, encryption status.
 * Route: /data-governance | Role: admin, support_admin, superadmin
 *
 * Data: GET /api/v1/governance/:tenantId — aggregates over audit_log,
 * tenant_entitlements, and erp_connections. No mocks. All tabs surface real,
 * read-only roll-up data. POPIA DSAR/erasure actions for a tenant already live
 * under /settings; this dashboard is summary-only.
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import { HeroHeader } from '@/components/ui/hero-header';
import { api, ApiError } from '@/lib/api';
import type { GovernanceResponse } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useAppStore } from '@/stores/appStore';
import {
  Shield, Lock, FileText, Database, Loader2,
  AlertCircle, RefreshCw, Activity, CheckCircle, XCircle,
} from 'lucide-react';

export function DataGovernancePage() {
  const { activeTab, setActiveTab } = useTabState('overview');
  const user = useAppStore((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GovernanceResponse | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    if (!user?.tenantId) {
      setError('No tenant context');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await api.governance.get(user.tenantId);
      setData(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error('Failed to load data governance', {
        message: msg,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.tenantId, toast]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: <Shield size={14} /> },
    { id: 'dsar', label: 'DSAR & Erasure', icon: <FileText size={14} /> },
    { id: 'retention', label: 'Retention', icon: <Database size={14} /> },
    { id: 'encryption', label: 'Encryption', icon: <Lock size={14} /> },
  ];

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <Card className="p-6 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium t-primary">Failed to load data governance</p>
          <p className="text-xs t-muted mt-1">{error}</p>
          <button
            onClick={handleRefresh}
            className="mt-3 text-xs px-3 py-1.5 rounded-lg border border-[var(--border-card)] t-secondary hover:t-primary"
          >
            Retry
          </button>
        </div>
      </Card>
    );
  }

  if (!data) return null;

  const totalErpConns = data.encryption.erpEncrypted + data.encryption.erpPlaintext;
  const encryptionPct = totalErpConns > 0 ? Math.round((data.encryption.erpEncrypted / totalErpConns) * 100) : 100;
  const encryptionHealthy = data.encryption.erpPlaintext === 0;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <HeroHeader
          icon={Shield}
          title="Data Governance"
          subtitle="Retention, DSAR history, erasure log & encryption status"
          accent="sage"
        />
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--border-card)] t-secondary hover:t-primary hover:bg-[var(--bg-secondary)] transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-label">DSAR Exports (30d)</p>
          <p className="text-xl font-bold t-primary">{data.dsar.exports30d}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Erasures (30d)</p>
          <p className="text-xl font-bold t-primary">{data.dsar.erasures30d}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Audit Volume (30d)</p>
          <p className="text-xl font-bold t-primary">{data.auditVolume30d.toLocaleString()}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Retention</p>
          <p className="text-xl font-bold t-primary">
            {data.retention.retentionDays ? `${data.retention.retentionDays}d` : '—'}
          </p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel id="overview" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">Compliance Posture (30-day rollup)</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="t-muted">DSAR Exports</span><span className="t-primary font-medium">{data.dsar.exports30d}</span></div>
              <div className="flex justify-between"><span className="t-muted">Erasure Events</span><span className="t-primary font-medium">{data.dsar.erasures30d}</span></div>
              <div className="flex justify-between">
                <span className="t-muted">Last Export</span>
                <span className="t-primary font-medium">{data.dsar.lastExportAt ? new Date(data.dsar.lastExportAt).toLocaleDateString() : 'Never'}</span>
              </div>
              <div className="flex justify-between"><span className="t-muted">Audit Log Volume</span><span className="t-primary font-medium">{data.auditVolume30d.toLocaleString()} entries</span></div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Lock size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">ERP Credential Encryption</span>
            </div>
            {totalErpConns === 0 ? (
              <p className="text-xs t-muted">No ERP connections configured.</p>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <p className="text-2xl font-bold" style={{ color: encryptionHealthy ? 'var(--accent)' : '#f59e0b' }}>
                    {encryptionPct}%
                  </p>
                  <Badge variant={encryptionHealthy ? 'success' : 'warning'} className="text-caption">
                    {encryptionHealthy ? 'All encrypted' : 'Plaintext present'}
                  </Badge>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="t-muted flex items-center gap-1.5"><CheckCircle size={11} className="text-emerald-400" /> Encrypted</span>
                    <span className="t-primary font-medium">{data.encryption.erpEncrypted}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="t-muted flex items-center gap-1.5"><XCircle size={11} className="text-red-400" /> Plaintext</span>
                    <span className="t-primary font-medium">{data.encryption.erpPlaintext}</span>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="dsar" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <FileText size={14} className="text-accent" />
              <span className="text-xs font-medium t-primary">DSAR Exports</span>
            </div>
            <p className="text-3xl font-bold t-primary">{data.dsar.exports30d}</p>
            <p className="text-caption t-muted mt-1">Completed in the last 30 days</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Shield size={14} className="text-accent" />
              <span className="text-xs font-medium t-primary">Erasure Events</span>
            </div>
            <p className="text-3xl font-bold t-primary">{data.dsar.erasures30d}</p>
            <p className="text-caption t-muted mt-1">POPIA right-to-be-forgotten fulfillments</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity size={14} className="text-accent" />
              <span className="text-xs font-medium t-primary">Last Export</span>
            </div>
            <p className="text-sm font-bold t-primary">
              {data.dsar.lastExportAt ? new Date(data.dsar.lastExportAt).toLocaleDateString() : 'Never'}
            </p>
            <p className="text-caption t-muted mt-1">
              {data.dsar.lastExportAt ? new Date(data.dsar.lastExportAt).toLocaleTimeString() : 'No historical record'}
            </p>
          </Card>
        </div>
        <Card className="p-4 mt-3">
          <p className="text-xs t-muted">
            Counts sourced from <code className="text-caption font-mono">audit_log</code> rows with action <code className="text-caption font-mono">popia.data_export.completed</code> / <code className="text-caption font-mono">popia.erasure.completed</code>. To raise a new DSAR or erasure, use the POPIA controls under Settings.
          </p>
        </Card>
      </TabPanel>

      <TabPanel id="retention" activeTab={activeTab}>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Database size={14} className="text-accent" />
            <span className="text-sm font-medium t-primary">Tenant Retention Policy</span>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="t-muted">Data Retention</span>
              <span className="t-primary font-medium">
                {data.retention.retentionDays ? `${data.retention.retentionDays} days` : 'Default'}
              </span>
            </div>
          </div>
          <p className="text-caption t-muted mt-3">{data.retention.policy}</p>
        </Card>
        <Card className="p-4 mt-3">
          <div className="flex items-center gap-2 mb-3">
            <Activity size={14} className="text-accent" />
            <span className="text-sm font-medium t-primary">Audit Log Volume</span>
          </div>
          <p className="text-3xl font-bold t-primary">{data.auditVolume30d.toLocaleString()}</p>
          <p className="text-caption t-muted mt-1">Audit entries recorded for this tenant in the last 30 days.</p>
        </Card>
      </TabPanel>

      <TabPanel id="encryption" activeTab={activeTab}>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Lock size={14} className="text-accent" />
            <span className="text-sm font-medium t-primary">ERP Credential Storage</span>
          </div>
          {totalErpConns === 0 ? (
            <p className="text-xs t-muted">No ERP connections configured yet.</p>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="t-muted">Encrypted (encrypted_config)</span>
                  <span className="t-primary font-medium">{data.encryption.erpEncrypted} of {totalErpConns}</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)]"
                    style={{ width: `${encryptionPct}%`, background: 'var(--accent)' }}
                  />
                </div>
              </div>
              {data.encryption.erpPlaintext > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-400/10 border border-amber-400/20">
                  <AlertCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-medium t-primary">{data.encryption.erpPlaintext} connection{data.encryption.erpPlaintext === 1 ? '' : 's'} storing credentials as plaintext</p>
                    <p className="text-caption t-muted mt-1">
                      Set the platform ENCRYPTION_KEY secret and rotate connections via <code className="font-mono text-caption">POST /api/v1/admin/rotate-encryption</code> to encrypt at rest.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
          <p className="text-caption t-muted mt-3">
            Transport encryption (TLS) and D1 encryption at rest are platform-wide defaults handled by Cloudflare and are not tenant-configurable.
          </p>
        </Card>
      </TabPanel>
    </div>
  );
}
