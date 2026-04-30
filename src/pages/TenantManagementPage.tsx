import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import {
  Users, Database, Trash2, RotateCcw, Download, Shield, AlertTriangle,
  CheckCircle, XCircle, Search, Eye, Activity, TrendingUp,
  Building2, Calendar, HardDrive, FileJson, ArrowLeft, Zap
} from "lucide-react";
import { format } from 'date-fns';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  industry?: string;
  plan?: string;
  status: string;
  deployment_model?: string;
  region?: string;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  deleted_at?: string;
  deleted_by?: string;
  data: {
    runs: number;
    metrics: number;
    risks: number;
    users: number;
  };
}

interface TenantDetails extends Tenant {
  data: {
    runs: number;
    metrics: number;
    risks: number;
    healthScores: number;
    briefings: number;
    users: number;
    clusters: number;
    runItems: number;
  };
}

export function TenantManagementPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<TenantDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'deleted'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Load once on mount. loadTenants is a stable function reference — it
  // only reads/writes setState — so disabling the exhaustive-deps check
  // is safe here and avoids re-fetching on every render.
  useEffect(() => {
    loadTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTenants = async () => {
    try {
      setLoading(true);
      const data = await api.get<{ tenants: Tenant[] }>('/api/v1/admin/tenants');
      setTenants(data.tenants);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load tenants';
      setError(message);
      toast.error('Failed to load tenants', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  };

  const loadTenantDetails = async (tenantId: string) => {
    try {
      setActionLoading(tenantId);
      const data = await api.get<{ tenant: TenantDetails }>(`/api/v1/admin/tenants/${tenantId}`);
      setSelectedTenant(data.tenant);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load details';
      setError(message);
      toast.error('Failed to load tenant details', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleSoftDelete = async (tenantId: string) => {
    if (!confirm(`Are you sure you want to soft-delete "${tenants.find(t => t.id === tenantId)?.name}"?\n\nThis will:\n- Suspend all users\n- Mark tenant as deleted\n- Keep all data intact\n- Allow reactivation within 24 hours`)) {
      return;
    }

    try {
      setActionLoading(tenantId);
      const data = await api.post<{ message: string }>(`/api/v1/admin/tenants/${tenantId}/soft-delete`);
      alert(`Success: ${data.message}`);
      loadTenants();
      setSelectedTenant(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to soft-delete tenant';
      alert(message);
      toast.error('Soft-delete failed', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReactivate = async (tenantId: string) => {
    if (!confirm(`Reactivate "${tenants.find(t => t.id === tenantId)?.name}"?\n\nThis will:\n- Restore tenant access\n- Reactivate all users\n- Clear deletion timestamp`)) {
      return;
    }

    try {
      setActionLoading(tenantId);
      const data = await api.post<{ message: string }>(`/api/v1/admin/tenants/${tenantId}/reactivate`);
      alert(`Success: ${data.message}`);
      loadTenants();
      setSelectedTenant(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reactivate tenant';
      alert(message);
      toast.error('Reactivate failed', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleExport = async (tenantId: string, tenantSlug?: string) => {
    try {
      setActionLoading(tenantId);
      const data = await api.get<Record<string, unknown>>(`/api/v1/admin/tenants/${tenantId}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tenant-export-${tenantSlug}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      alert('Export downloaded successfully');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export tenant';
      alert(message);
      toast.error('Export failed', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleHardDelete = async (tenantId: string) => {
    if (!confirm(`⚠️ DANGER: PERMANENT DELETION ⚠️\n\nThis will IRREVERSIBLY delete:\n- All tenant data\n- All users\n- All runs, metrics, risks\n- All history and audit logs\n\nThis action CANNOT be undone.\n\nType "DELETE" to confirm:`)) {
      return;
    }
    
    // Additional confirmation
    const confirmation = prompt('Type "DELETE" to confirm permanent deletion:');
    if (confirmation !== 'DELETE') {
      return;
    }

    try {
      setActionLoading(tenantId);
      const data = await api.delete<{ message: string; audit: { totalRecordsDeleted: number } }>(`/api/v1/admin/tenants/${tenantId}/hard-delete`);
      alert(`PERMANENTLY DELETED: ${data.message}\n\nRecords deleted: ${data.audit.totalRecordsDeleted}`);
      loadTenants();
      setSelectedTenant(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to hard-delete tenant';
      alert(message);
      toast.error('Hard-delete failed', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setActionLoading(null);
    }
  };

  const filteredTenants = tenants.filter(tenant => {
    const matchesFilter = 
      filter === 'all' ||
      (filter === 'active' && !tenant.is_deleted) ||
      (filter === 'deleted' && tenant.is_deleted);
    
    const matchesSearch = 
      tenant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tenant.slug.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesFilter && matchesSearch;
  });

  const stats = {
    total: tenants.length,
    active: tenants.filter(t => !t.is_deleted).length,
    deleted: tenants.filter(t => t.is_deleted).length,
    totalRuns: tenants.reduce((sum, t) => sum + t.data.runs, 0),
    totalUsers: tenants.reduce((sum, t) => sum + t.data.users, 0),
  };

  if (selectedTenant) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedTenant(null)}>
            <ArrowLeft size={16} className="mr-2" />
            Back to List
          </Button>
          <h1 className="text-2xl font-bold text-white">Tenant Details</h1>
        </div>

        {actionLoading === selectedTenant.id && (
          <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-blue-400">Loading...</span>
          </div>
        )}

        {/* Tenant Info Card */}
        <Card>
          <div className="p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-2xl font-bold text-white">{selectedTenant.name}</h2>
                  <Badge variant={selectedTenant.is_deleted ? 'default' : 'info'}>
                    {selectedTenant.is_deleted ? 'Deleted' : 'Active'}
                  </Badge>
                </div>
                <p className="text-sm text-gray-400">Slug: {selectedTenant.slug}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleExport(selectedTenant.id, selectedTenant.slug)}
                  disabled={!!actionLoading}
                >
                  <Download size={14} className="mr-2" />
                  Export Data
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700">
                <div className="flex items-center gap-2 mb-1">
                  <Building2 size={14} className="text-gray-400" />
                  <span className="text-xs text-gray-400">Industry</span>
                </div>
                <p className="text-sm font-medium text-white">{selectedTenant.industry || 'N/A'}</p>
              </div>
              <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700">
                <div className="flex items-center gap-2 mb-1">
                  <Shield size={14} className="text-gray-400" />
                  <span className="text-xs text-gray-400">Plan</span>
                </div>
                <p className="text-sm font-medium text-white capitalize">{selectedTenant.plan || 'N/A'}</p>
              </div>
              <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700">
                <div className="flex items-center gap-2 mb-1">
                  <HardDrive size={14} className="text-gray-400" />
                  <span className="text-xs text-gray-400">Deployment</span>
                </div>
                <p className="text-sm font-medium text-white capitalize">{selectedTenant.deployment_model || 'N/A'}</p>
              </div>
              <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700">
                <div className="flex items-center gap-2 mb-1">
                  <Calendar size={14} className="text-gray-400" />
                  <span className="text-xs text-gray-400">Created</span>
                </div>
                <p className="text-sm font-medium text-white">
                  {format(new Date(selectedTenant.created_at), 'MMM d, yyyy')}
                </p>
              </div>
            </div>

            {selectedTenant.is_deleted && (
              <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-400 mb-1">Tenant Soft-Deleted</p>
                    <p className="text-xs text-red-300/80">
                      Deleted: {format(new Date(selectedTenant.deleted_at!), 'PPP p')}
                      {selectedTenant.deleted_by && ` by ${selectedTenant.deleted_by}`}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Data Statistics */}
        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Database size={18} className="text-accent" />
              Data Statistics
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Users', value: selectedTenant.data.users, icon: Users },
                { label: 'Clusters', value: selectedTenant.data.clusters, icon: Building2 },
                { label: 'Runs', value: selectedTenant.data.runs, icon: Activity },
                { label: 'Run Items', value: selectedTenant.data.runItems, icon: FileJson },
                { label: 'Metrics', value: selectedTenant.data.metrics, icon: TrendingUp },
                { label: 'Risks', value: selectedTenant.data.risks, icon: AlertTriangle },
                { label: 'Health Scores', value: selectedTenant.data.healthScores, icon: CheckCircle },
                { label: 'Briefings', value: selectedTenant.data.briefings, icon: FileJson },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon size={16} className="text-gray-400" />
                    <span className="text-xs text-gray-400">{label}</span>
                  </div>
                  <p className="text-2xl font-bold text-white">{value.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Actions */}
        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Shield size={18} className="text-accent" />
              Administrative Actions
            </h3>
            <div className="flex flex-wrap gap-3">
              {!selectedTenant.is_deleted ? (
                <Button
                  variant="secondary"
                  onClick={() => handleSoftDelete(selectedTenant.id)}
                  disabled={!!actionLoading || selectedTenant.slug === 'vantax'}
                  className="bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20"
                >
                  <Trash2 size={14} className="mr-2" />
                  Soft-Delete Tenant
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => handleReactivate(selectedTenant.id)}
                  disabled={!!actionLoading}
                >
                  <RotateCcw size={14} className="mr-2" />
                  Reactivate Tenant
                </Button>
              )}

              {selectedTenant.is_deleted && (
                <Button
                  variant="secondary"
                  onClick={() => handleHardDelete(selectedTenant.id)}
                  disabled={!!actionLoading}
                  className="bg-red-600 text-white border-red-500 hover:bg-red-700"
                >
                  <Trash2 size={14} className="mr-2" />
                  Permanently Delete (After 24h)
                </Button>
              )}

              <Button
                variant="ghost"
                onClick={() => handleExport(selectedTenant.id, selectedTenant.slug)}
                disabled={!!actionLoading}
              >
                <Download size={14} className="mr-2" />
                Export All Data
              </Button>

              <Link to={`/admin/tenants/${selectedTenant.id}/llm`}>
                <Button variant="ghost" disabled={!!actionLoading}>
                  <Zap size={14} className="mr-2" />
                  LLM Budget & Redaction
                </Button>
              </Link>
            </div>

            {selectedTenant.slug === 'vantax' && (
              <div className="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <p className="text-xs text-blue-300">
                  ℹ️ This is the VantaX demo tenant. Use the seeder endpoint to reset data instead of deletion.
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Tenant Management</h1>
          <p className="text-sm text-gray-400 mt-1">Superadmin-only tenant administration</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Building2 size={16} className="text-gray-400" />
              <span className="text-xs text-gray-400">Total</span>
            </div>
            <p className="text-2xl font-bold text-white">{stats.total}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={16} className="text-emerald-400" />
              <span className="text-xs text-gray-400">Active</span>
            </div>
            <p className="text-2xl font-bold text-emerald-400">{stats.active}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <XCircle size={16} className="text-red-400" />
              <span className="text-xs text-gray-400">Deleted</span>
            </div>
            <p className="text-2xl font-bold text-red-400">{stats.deleted}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity size={16} className="text-blue-400" />
              <span className="text-xs text-gray-400">Total Runs</span>
            </div>
            <p className="text-2xl font-bold text-blue-400">{stats.totalRuns.toLocaleString()}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users size={16} className="text-purple-400" />
              <span className="text-xs text-gray-400">Total Users</span>
            </div>
            <p className="text-2xl font-bold text-purple-400">{stats.totalUsers.toLocaleString()}</p>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <div className="p-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search tenants..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-400 focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant={filter === 'all' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setFilter('all')}
            >
              All
            </Button>
            <Button
              variant={filter === 'active' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setFilter('active')}
            >
              Active
            </Button>
            <Button
              variant={filter === 'deleted' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setFilter('deleted')}
            >
              Deleted
            </Button>
          </div>
        </div>
      </Card>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
            <XCircle size={16} />
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Tenant List */}
      {!loading && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left p-4 text-xs font-medium text-gray-400 uppercase">Tenant</th>
                  <th className="text-left p-4 text-xs font-medium text-gray-400 uppercase">Plan</th>
                  <th className="text-left p-4 text-xs font-medium text-gray-400 uppercase">Status</th>
                  <th className="text-center p-4 text-xs font-medium text-gray-400 uppercase">Runs</th>
                  <th className="text-center p-4 text-xs font-medium text-gray-400 uppercase">Users</th>
                  <th className="text-left p-4 text-xs font-medium text-gray-400 uppercase">Created</th>
                  <th className="text-right p-4 text-xs font-medium text-gray-400 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTenants.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-gray-400">
                      No tenants found
                    </td>
                  </tr>
                ) : (
                  filteredTenants.map((tenant) => (
                    <tr key={tenant.id} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                      <td className="p-4">
                        <div>
                          <p className="text-sm font-medium text-white">{tenant.name}</p>
                          <p className="text-xs text-gray-400">{tenant.slug}</p>
                        </div>
                      </td>
                      <td className="p-4">
                        <Badge variant="info" className="text-xs capitalize">{tenant.plan || 'N/A'}</Badge>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {tenant.is_deleted ? (
                            <Badge variant="default" className="text-xs">
                              <XCircle size={10} className="mr-1" />
                              Deleted
                            </Badge>
                          ) : (
                            <Badge variant="success" className="text-xs">
                              <CheckCircle size={10} className="mr-1" />
                              Active
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-center text-sm text-gray-300">{tenant.data.runs.toLocaleString()}</td>
                      <td className="p-4 text-center text-sm text-gray-300">{tenant.data.users.toLocaleString()}</td>
                      <td className="p-4 text-sm text-gray-400">
                        {format(new Date(tenant.created_at), 'MMM d, yyyy')}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => loadTenantDetails(tenant.id)}
                            disabled={!!actionLoading}
                            title="View details"
                          >
                            <Eye size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/admin/tenants/${tenant.id}/llm`)}
                            disabled={!!actionLoading}
                            title="LLM budget & redaction"
                          >
                            <Zap size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleExport(tenant.id)}
                            disabled={!!actionLoading}
                            title="Export data"
                          >
                            <Download size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
