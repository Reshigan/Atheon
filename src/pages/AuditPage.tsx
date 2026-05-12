import { useEffect, useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { LayerBadge } from "@/components/ui/layer-badge";
import { api, ApiError } from "@/lib/api";
import type { AuditEntry } from "@/lib/api";
import { Shield, CheckCircle, XCircle, Clock, Filter, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/state";
import { useToast } from "@/components/ui/toast";
import { ProvenanceVerifyPanel } from "@/components/ProvenanceVerifyPanel";

export function AuditPage() {
 const toast = useToast();
 const [entries, setEntries] = useState<AuditEntry[]>([]);
 const [loading, setLoading] = useState(true);
 const [showFilters, setShowFilters] = useState(false);
 const [filterLayer, setFilterLayer] = useState<string>('');
 const [filterOutcome, setFilterOutcome] = useState<string>('');
 // Phase 4.6: Date range filter
 const [dateFrom, setDateFrom] = useState<string>('');
 const [dateTo, setDateTo] = useState<string>('');

 useEffect(() => {
 async function load() {
 setLoading(true);
 try {
 const data = await api.audit.log();
 setEntries(data.entries);
  } catch (err) {
   console.error('Failed to load audit log', err);
   toast.error('Failed to load audit log', {
    message: err instanceof Error ? err.message : 'Unable to retrieve audit entries',
    requestId: err instanceof ApiError ? err.requestId : null,
   });
  }
  setLoading(false);
 }
 load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 // Shared filter predicate so the table, export buttons, and active-filter
 // count stay in sync instead of duplicating the same inline filter logic.
 const filteredEntries = useMemo(() => entries.filter(e => {
   const matchLayer = !filterLayer || e.layer === filterLayer;
   const matchOutcome = !filterOutcome || e.outcome === filterOutcome;
   const entryDate = new Date(e.createdAt);
   const matchFrom = !dateFrom || entryDate >= new Date(dateFrom);
   const matchTo = !dateTo || entryDate <= new Date(dateTo + 'T23:59:59');
   return matchLayer && matchOutcome && matchFrom && matchTo;
 }), [entries, filterLayer, filterOutcome, dateFrom, dateTo]);

 const activeFilterCount = [filterLayer, filterOutcome, dateFrom, dateTo].filter(Boolean).length;

 if (loading) return <LoadingState variant="cards" count={4} />;

 return (
 <div className="space-y-6 animate-fadeIn">
 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
 <div className="flex items-center gap-3">
 <div className=" w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
 <Shield className="w-5 h-5 text-accent"/>
 </div>
 <div>
 <h1 className="text-2xl font-bold t-primary">Audit & Provenance</h1>
 <p className="text-sm t-muted">Complete governance trail across all Atheon layers, plus the cryptographic AI decision ledger</p>
 </div>
 </div>
 <div className="flex items-center gap-2">
 <Button
 variant="secondary"
 size="sm"
 disabled={filteredEntries.length === 0}
 title={filteredEntries.length === 0 ? 'No entries to export' : 'Export filtered entries to CSV'}
 onClick={() => {
 // Sanitize CSV values to prevent formula injection (=, +, -, @, tab, CR)
 const csvSafe = (val: string) => {
 const s = val.replace(/"/g, '""');
 if (/^[=+\-@\t\r]/.test(s)) return `"'${s}"`;
 return `"${s}"`;
 };
 const csv = ['Timestamp,Action,Layer,Resource,Outcome,IP,User,Details']
 .concat(filteredEntries.map(e => [
   csvSafe(new Date(e.createdAt).toISOString()),
   csvSafe(e.action),
   csvSafe(e.layer),
   csvSafe(e.resource || ''),
   csvSafe(e.outcome),
   csvSafe(e.ipAddress || ''),
   csvSafe(e.userId || ''),
   csvSafe(e.details ? Object.entries(e.details).map(([k,v]) => `${k}: ${v}`).join('; ') : ''),
 ].join(',')));
 const blob = new Blob([csv.join('\n')], { type: 'text/csv' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = `atheon-audit-${new Date().toISOString().slice(0,10)}.csv`;
 a.click();
 URL.revokeObjectURL(url);
 toast.success('CSV export ready', `${filteredEntries.length} entr${filteredEntries.length === 1 ? 'y' : 'ies'} downloaded`);
 }}
 >
 <Download size={14} /> Export CSV
 </Button>
 {/* Phase 4.6: PDF Export */}
 <Button
 variant="secondary"
 size="sm"
 disabled={filteredEntries.length === 0}
 title={filteredEntries.length === 0 ? 'No entries to export' : 'Export filtered entries as a readable report'}
 onClick={() => {
 // Generate a simple text-based PDF-like report
 const lines = [
 'ATHEON AUDIT LOG REPORT',
 `Generated: ${new Date().toISOString()}`,
 `Filters: ${[filterLayer && `Layer=${filterLayer}`, filterOutcome && `Outcome=${filterOutcome}`, dateFrom && `From=${dateFrom}`, dateTo && `To=${dateTo}`].filter(Boolean).join(', ') || 'None'}`,
 `Total entries: ${filteredEntries.length}`,
 '',
 'TIMESTAMP | ACTION | LAYER | RESOURCE | OUTCOME | IP | DETAILS',
 '-'.repeat(120),
 ...filteredEntries.map(e => `${new Date(e.createdAt).toISOString()} | ${e.action} | ${e.layer} | ${e.resource || '-'} | ${e.outcome} | ${e.ipAddress || '-'} | ${e.details ? Object.entries(e.details).map(([k,v]) => `${k}: ${v}`).join('; ') : '-'}`),
 ];
 const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = `atheon-audit-${new Date().toISOString().slice(0,10)}.txt`;
 a.click();
 URL.revokeObjectURL(url);
 toast.success('Report export ready', `${filteredEntries.length} entr${filteredEntries.length === 1 ? 'y' : 'ies'} downloaded`);
 }}
 >
 <FileText size={14} /> Export Report
 </Button>
 <button
 onClick={() => setShowFilters(!showFilters)}
 className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${showFilters ? 'bg-accent/10 border-accent/20 text-accent' : 'bg-[var(--bg-secondary)] border-[var(--border-card)] text-gray-400 hover:bg-[var(--bg-secondary)]'}`}
 title="Toggle audit log filters"
 >
 <Filter size={14} /> Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
 </button>
 </div>
 </div>

 {/* Cryptographic provenance ledger — sits above the standard audit log
     so the tamper-evidence story is the first thing on the page. */}
 <ProvenanceVerifyPanel />

 {/* Filter Panel */}
 {showFilters && (
 <div className="flex flex-wrap gap-4 p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <div>
 <label className="text-xs t-muted block mb-1">Layer</label>
 <select className="px-3 py-1.5 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" value={filterLayer} onChange={e => setFilterLayer(e.target.value)}>
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
 <label className="text-xs t-muted block mb-1">Outcome</label>
 <select className="px-3 py-1.5 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" value={filterOutcome} onChange={e => setFilterOutcome(e.target.value)}>
 <option value="">All Outcomes</option>
 <option value="success">Success</option>
 <option value="pending">Pending</option>
 <option value="failure">Failed</option>
 </select>
 </div>
 {/* Phase 4.6: Date range filter */}
 <div>
 <label className="text-xs t-muted block mb-1">From Date</label>
 <input type="date" className="px-3 py-1.5 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
 </div>
 <div>
 <label className="text-xs t-muted block mb-1">To Date</label>
 <input type="date" className="px-3 py-1.5 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary" value={dateTo} onChange={e => setDateTo(e.target.value)} />
 </div>
 {(filterLayer || filterOutcome || dateFrom || dateTo) && (
 <button onClick={() => { setFilterLayer(''); setFilterOutcome(''); setDateFrom(''); setDateTo(''); }} className="self-end text-xs text-accent hover:text-[#3a9cac] pb-1.5" title="Reset all filters">Clear filters</button>
 )}
 </div>
 )}

 {/* Summary */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <Card>
 <span className="text-xs t-secondary">{activeFilterCount > 0 ? 'Filtered Events' : 'Total Events'}</span>
 <p className="text-2xl font-bold t-primary mt-1">{filteredEntries.length}</p>
 {activeFilterCount > 0 && <span className="text-caption t-muted">of {entries.length} total</span>}
 </Card>
 <Card>
 <span className="text-xs t-secondary">Success</span>
 <p className="text-2xl font-bold text-emerald-400 mt-1">{filteredEntries.filter(a => a.outcome === 'success').length}</p>
 </Card>
 <Card>
 <span className="text-xs t-secondary">Pending</span>
 <p className="text-2xl font-bold text-accent mt-1">{filteredEntries.filter(a => a.outcome === 'pending').length}</p>
 </Card>
 <Card>
 <span className="text-xs t-secondary">Failed</span>
 <p className="text-2xl font-bold text-red-400 mt-1">{filteredEntries.filter(a => a.outcome === 'failure').length}</p>
 </Card>
 </div>

 {/* Audit Table */}
 <Card>
 {entries.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-16">
 <Shield className="w-10 h-10 t-muted mb-3 opacity-40" />
 <p className="text-sm font-medium t-primary">No audit entries found</p>
 <p className="text-xs t-muted mt-1">Audit events will appear here as actions are performed across Atheon.</p>
 </div>
 ) : filteredEntries.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-16">
 <Filter className="w-10 h-10 t-muted mb-3 opacity-40" />
 <p className="text-sm font-medium t-primary">No entries match the current filters</p>
 <p className="text-xs t-muted mt-1">Adjust or clear the filters to see more results.</p>
 {activeFilterCount > 0 && (
 <button onClick={() => { setFilterLayer(''); setFilterOutcome(''); setDateFrom(''); setDateTo(''); }} className="mt-3 text-xs text-accent hover:underline" title="Reset all filters">Clear filters</button>
 )}
 </div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead>
 <tr className="border-b border-[var(--border-card)]">
 <th className="text-left py-3 px-4 text-gray-400 font-medium">Timestamp</th>
 <th className="text-left py-3 px-4 text-gray-400 font-medium">Action</th>
 <th className="text-left py-3 px-4 text-gray-400 font-medium">Layer</th>
 <th className="text-left py-3 px-4 text-gray-400 font-medium">Resource</th>
 <th className="text-left py-3 px-4 text-gray-400 font-medium">Details</th>
 <th className="text-left py-3 px-4 text-gray-400 font-medium">Outcome</th>
 </tr>
 </thead>
 <tbody>
 {filteredEntries.map((entry) => (
 <tr key={entry.id} className="border-b border-[var(--border-card)] hover:bg-[var(--bg-secondary)] transition-colors">
 <td className="py-3 px-4 text-xs text-gray-500 font-mono whitespace-nowrap" title={entry.ipAddress ? `IP: ${entry.ipAddress}${entry.userId ? ` • User: ${entry.userId}` : ''}` : entry.userId ? `User: ${entry.userId}` : undefined}>
 {new Date(entry.createdAt).toLocaleString()}
 </td>
 <td className="py-3 px-4 text-sm t-primary">{entry.action}</td>
 <td className="py-3 px-4">
 <LayerBadge layer={entry.layer} />
 </td>
 <td className="py-3 px-4 text-xs text-gray-400 font-mono max-w-[160px] truncate" title={entry.resource || undefined}>
 {entry.resource || '-'}
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
 <Clock size={14} className="text-accent" />
 <span className="text-xs text-accent">Pending</span>
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
 )}
 </Card>
 </div>
 );
}
