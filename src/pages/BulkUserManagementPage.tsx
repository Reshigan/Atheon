/**
 * ADMIN-005: Bulk User Management (v45)
 * CSV import + bulk suspend/activate/change-role + import history.
 * Backed by /api/v1/iam/users/bulk-* endpoints (iam.ts).
 * Route: /bulk-users | Role: admin, support_admin, superadmin
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import { LoadingState, EmptyState } from '@/components/ui/state';
import { api, ApiError } from '@/lib/api';
import type { IAMUser } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import {
  Upload, Users, FileText, Loader2, Clock, CheckCircle, AlertTriangle,
  XCircle, Eye, Play, UserX, UserCheck, Shuffle,
} from 'lucide-react';

type ImportResult = {
  importId: string;
  total: number;
  created: number;
  createdUsers: Array<{ row: number; id: string; email: string; name: string; role: string; tempPassword: string }>;
  skipped: Array<{ row: number; email: string; reason: string }>;
  errors: Array<{ row: number; email?: string; reason: string }>;
  dryRun: boolean;
};

type ImportHistoryEntry = {
  id: string;
  imported_by: string | null;
  row_count: number;
  created_count: number;
  skipped_count: number;
  error_count: number;
  outcome: string;
  created_at: string;
};

const ROLE_OPTIONS = ['executive', 'manager', 'analyst', 'operator', 'viewer'];
const TEMPLATE_CSV = 'email,name,role\njane@example.com,Jane Doe,analyst\njohn@example.com,John Smith,operator';

export function BulkUserManagementPage() {
  const toast = useToast();
  const { activeTab, setActiveTab } = useTabState('import');

  // Import state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState<string>('');
  const [dryRun, setDryRun] = useState<boolean>(true);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Users / bulk action state
  const [users, setUsers] = useState<IAMUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [bulkAction, setBulkAction] = useState<string>('');
  const [applyingAction, setApplyingAction] = useState(false);

  // History state
  const [history, setHistory] = useState<ImportHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const showError = useCallback((title: string, err: unknown, fallback: string) => {
    const message = err instanceof Error ? err.message : fallback;
    toast.error(title, {
      message,
      requestId: err instanceof ApiError ? err.requestId : null,
    });
  }, [toast]);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const res = await api.iam.users();
      setUsers(res.users || []);
    } catch (err) {
      showError('Failed to load users', err, 'Could not load users');
    } finally {
      setLoadingUsers(false);
    }
  }, [showError]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await api.bulkUsers.history();
      setHistory(res.imports || []);
    } catch (err) {
      showError('Failed to load import history', err, 'Could not load history');
    } finally {
      setLoadingHistory(false);
    }
  }, [showError]);

  useEffect(() => {
    loadUsers();
    loadHistory();
  }, [loadUsers, loadHistory]);

  // ── CSV preview ───────────────────────────────────────────────
  const previewRows = useMemo(() => {
    if (!csvText.trim()) return [];
    const lines = csvText.split(/\r?\n/).filter(l => l.length > 0);
    return lines.slice(0, 6); // header + 5 rows
  }, [csvText]);

  const handleFile = useCallback((file: File) => {
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = () => setCsvText(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => showError('Failed to read file', reader.error, 'File read failed');
    reader.readAsText(file);
  }, [showError]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const clearFile = () => {
    setSelectedFile(null);
    setCsvText('');
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const runImport = async () => {
    if (!csvText.trim()) {
      toast.warning('No CSV content to import');
      return;
    }
    setUploading(true);
    setImportResult(null);
    try {
      const res = await api.bulkUsers.import(csvText, dryRun);
      setImportResult(res);
      if (dryRun) {
        toast.info(`Dry run complete — ${res.created} valid, ${res.skipped.length} skipped, ${res.errors.length} errors`);
      } else {
        toast.success(`Imported ${res.created} user(s) · ${res.skipped.length} skipped · ${res.errors.length} errors`);
        await Promise.all([loadUsers(), loadHistory()]);
      }
    } catch (err) {
      showError('Import failed', err, 'Could not import users');
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'user-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Bulk actions ──────────────────────────────────────────────
  const selectedCount = selectedIds.size;
  const allSelected = users.length > 0 && selectedCount === users.length;

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(users.map(u => u.id)));
  };
  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const applyBulkAction = async () => {
    if (!bulkAction || selectedCount === 0) return;
    setApplyingAction(true);
    try {
      const [kind, roleArg] = bulkAction.split(':') as [string, string | undefined];
      const action = (kind === 'role' ? 'change_role' : kind) as 'suspend' | 'activate' | 'change_role';
      const ids = Array.from(selectedIds);
      const res = await api.bulkUsers.action(ids, action, roleArg);
      if (res.failed.length > 0) {
        toast.warning(`Applied to ${res.applied} of ${ids.length} users · ${res.failed.length} failed`);
      } else {
        toast.success(`Applied ${action} to ${res.applied} users`);
      }
      setSelectedIds(new Set());
      setBulkAction('');
      await loadUsers();
    } catch (err) {
      showError('Bulk action failed', err, 'Could not apply bulk action');
    } finally {
      setApplyingAction(false);
    }
  };

  // ── UI helpers ────────────────────────────────────────────────
  const userStatusColor = (s?: string): 'success' | 'danger' | 'warning' | 'default' => {
    if (s === 'active') return 'success';
    if (s === 'suspended' || s === 'inactive') return 'danger';
    return 'warning';
  };
  const outcomeColor = (o: string): 'success' | 'danger' | 'warning' => {
    if (o === 'success') return 'success';
    if (o === 'partial') return 'warning';
    return 'danger';
  };

  const tabs = [
    { id: 'import', label: 'CSV Import', icon: <Upload size={14} /> },
    { id: 'bulk-actions', label: 'Bulk Actions', icon: <Users size={14} />, count: selectedCount || undefined },
    { id: 'history', label: 'Import History', icon: <Clock size={14} /> },
  ];

  const activeCount = users.filter(u => u.status === 'active').length;
  const suspendedCount = users.filter(u => u.status === 'suspended' || u.status === 'inactive').length;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <Users className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold t-primary">Bulk User Management</h1>
          <p className="text-xs t-muted">Import users via CSV and apply bulk actions across your tenant</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-label">Total Users</p>
          <p className="text-xl font-bold t-primary">{users.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Active</p>
          <p className="text-xl font-bold text-emerald-400">{activeCount}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Suspended</p>
          <p className="text-xl font-bold text-red-400">{suspendedCount}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Imports</p>
          <p className="text-xl font-bold t-primary">{history.length}</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* IMPORT TAB */}
      <TabPanel id="import" activeTab={activeTab}>
        <Card className="p-6">
          <div className="text-center">
            <Upload size={32} className="mx-auto text-accent mb-3" />
            <h3 className="text-sm font-medium t-primary mb-1">Import Users via CSV</h3>
            <p className="text-xs t-muted mb-4">Columns: <code className="px-1 rounded bg-[var(--bg-secondary)]">email</code>, <code className="px-1 rounded bg-[var(--bg-secondary)]">name</code>, <code className="px-1 rounded bg-[var(--bg-secondary)]">role</code> (optional), <code className="px-1 rounded bg-[var(--bg-secondary)]">permissions</code> (optional)</p>
            <div
              className={`border-2 border-dashed rounded-xl p-8 mb-4 transition-colors ${dragOver ? 'border-accent bg-accent/5' : 'border-[var(--border-card)] hover:border-accent/50'}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileInput}
                className="hidden"
                id="csv-upload"
              />
              <label htmlFor="csv-upload" className="cursor-pointer block">
                {selectedFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText size={16} className="text-accent" />
                    <span className="text-sm t-primary">{selectedFile.name}</span>
                    <span className="text-xs t-muted">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
                  </div>
                ) : (
                  <p className="text-sm t-muted">Click to select CSV file or drag &amp; drop</p>
                )}
              </label>
            </div>

            <div className="flex items-center justify-center gap-4 mb-3">
              <label className="flex items-center gap-2 text-xs t-primary cursor-pointer">
                <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="rounded" />
                Dry run (preview only, no changes)
              </label>
            </div>

            <div className="flex justify-center gap-2">
              <Button variant="outline" size="sm" onClick={clearFile} disabled={!selectedFile && !csvText}>Clear</Button>
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <FileText size={12} className="mr-1" /> Template
              </Button>
              <Button size="sm" onClick={runImport} disabled={!csvText.trim() || uploading}>
                {uploading ? <Loader2 size={14} className="animate-spin mr-1" /> : (dryRun ? <Eye size={14} className="mr-1" /> : <Upload size={14} className="mr-1" />)}
                {dryRun ? 'Preview' : 'Import'}
              </Button>
            </div>
          </div>

          {previewRows.length > 0 && (
            <div className="mt-6 p-4 rounded-lg bg-[var(--bg-secondary)]">
              <p className="text-xs font-medium t-primary mb-2">CSV Preview (first 6 lines)</p>
              <pre className="text-caption t-muted font-mono whitespace-pre-wrap">{previewRows.join('\n')}</pre>
            </div>
          )}

          {importResult && (
            <div className="mt-6 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="p-3"><p className="text-label">Rows</p><p className="text-xl font-bold t-primary">{importResult.total}</p></Card>
                <Card className="p-3"><p className="text-label">{importResult.dryRun ? 'Valid' : 'Created'}</p><p className="text-xl font-bold text-emerald-400">{importResult.created}</p></Card>
                <Card className="p-3"><p className="text-label">Skipped</p><p className="text-xl font-bold text-amber-400">{importResult.skipped.length}</p></Card>
                <Card className="p-3"><p className="text-label">Errors</p><p className="text-xl font-bold text-red-400">{importResult.errors.length}</p></Card>
              </div>

              {importResult.createdUsers.length > 0 && (
                <Card className="p-4">
                  <p className="text-xs font-medium t-primary mb-2 flex items-center gap-2"><CheckCircle size={14} className="text-emerald-400" /> {importResult.dryRun ? 'Would create' : 'Created'} ({importResult.createdUsers.length})</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {importResult.createdUsers.map(u => (
                      <div key={`${u.row}-${u.email}`} className="flex items-center justify-between text-xs">
                        <span className="t-primary">{u.name} &middot; {u.email}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="default" className="text-caption">{u.role}</Badge>
                          {!importResult.dryRun && (
                            <code className="text-caption px-1 rounded bg-[var(--bg-secondary)] t-muted">{u.tempPassword}</code>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {importResult.skipped.length > 0 && (
                <Card className="p-4">
                  <p className="text-xs font-medium t-primary mb-2 flex items-center gap-2"><AlertTriangle size={14} className="text-amber-400" /> Skipped ({importResult.skipped.length})</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {importResult.skipped.map((s, i) => (
                      <div key={i} className="text-xs flex items-center justify-between">
                        <span className="t-primary">Row {s.row} &middot; {s.email || '(no email)'}</span>
                        <span className="t-muted">{s.reason}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {importResult.errors.length > 0 && (
                <Card className="p-4 border-red-500/20">
                  <p className="text-xs font-medium text-red-400 mb-2 flex items-center gap-2"><XCircle size={14} /> Errors ({importResult.errors.length})</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {importResult.errors.map((e, i) => (
                      <div key={i} className="text-xs flex items-center justify-between">
                        <span className="t-primary">Row {e.row} {e.email ? `· ${e.email}` : ''}</span>
                        <span className="text-red-400">{e.reason}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}
        </Card>
      </TabPanel>

      {/* BULK ACTIONS TAB */}
      <TabPanel id="bulk-actions" activeTab={activeTab}>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4 p-3 rounded-lg bg-[var(--bg-secondary)]">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
              <span className="text-xs t-muted">{selectedCount} of {users.length} selected</span>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={bulkAction}
                onChange={(e) => setBulkAction(e.target.value)}
                className="text-xs rounded-lg border border-[var(--border-card)] bg-[var(--bg-primary)] t-primary px-2 py-1"
              >
                <option value="">Select action...</option>
                <option value="suspend">Suspend Users</option>
                <option value="activate">Activate Users</option>
                {ROLE_OPTIONS.map(r => (
                  <option key={r} value={`role:${r}`}>Change Role → {r}</option>
                ))}
              </select>
              <Button size="sm" onClick={applyBulkAction} disabled={!bulkAction || selectedCount === 0 || applyingAction} className="text-xs">
                {applyingAction ? <Loader2 size={12} className="animate-spin mr-1" /> : (
                  bulkAction === 'suspend' ? <UserX size={12} className="mr-1" /> :
                  bulkAction === 'activate' ? <UserCheck size={12} className="mr-1" /> :
                  bulkAction.startsWith('role:') ? <Shuffle size={12} className="mr-1" /> : null
                )}
                Apply
              </Button>
            </div>
          </div>

          {loadingUsers ? (
            <LoadingState variant="list" count={3} />
          ) : users.length === 0 ? (
            <EmptyState title="No users in this tenant yet" description="Import a CSV above to get started." />
          ) : (
            <div className="space-y-1">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors">
                  <input type="checkbox" checked={selectedIds.has(u.id)} onChange={() => toggleOne(u.id)} className="rounded" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium t-primary">{u.name || '(no name)'}</p>
                      <Badge variant={userStatusColor(u.status)} className="text-caption">{u.status || 'unknown'}</Badge>
                    </div>
                    <p className="text-caption t-muted">{u.email} · {u.role || 'viewer'}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </TabPanel>

      {/* HISTORY TAB */}
      <TabPanel id="history" activeTab={activeTab}>
        {loadingHistory ? (
          <LoadingState variant="list" count={3} />
        ) : history.length === 0 ? (
          <EmptyState title="No imports yet" description="Run a CSV import to see history here." />
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <Card key={h.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Play size={16} className="text-accent" />
                    <div>
                      <p className="text-sm font-medium t-primary">Import {h.id.slice(0, 8)}</p>
                      <p className="text-caption t-muted">
                        {h.row_count} rows · {h.created_count} created · {h.skipped_count} skipped · {h.error_count} errors
                        {h.imported_by ? ` · by ${h.imported_by}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-caption t-muted">{new Date(h.created_at).toLocaleString()}</span>
                    <Badge variant={outcomeColor(h.outcome)}>{h.outcome}</Badge>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </TabPanel>
    </div>
  );
}
