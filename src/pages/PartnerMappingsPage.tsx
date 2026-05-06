/**
 * PartnerMappingsPage — Atheon canonical partner_ref ↔ ERP-native ID.
 *
 * Phase 10-45 (#378). Operators populate this table per ERP connection
 * so the action-layer dispatchers can resolve a payload's
 * vendor_ref / customer_ref into the right ERP-native partner ID:
 *
 *   - Odoo:     numeric res.partner.id
 *   - Xero:     ContactID (UUID)
 *   - NetSuite: vendor / customer internalId
 *   - SAP:      InvoicingParty / Customer (BUKRS partner code)
 *
 * Without a mapping for a given vendor_ref, the dispatcher throws and
 * the staged action lands in transactional_actions with status='failed'
 * — that's the user-visible signal that this page needs attention.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Plus, Trash2, Loader2, X, Search, AlertTriangle, Users, Briefcase } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/ui/portal";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import type { ERPConnection } from "@/lib/api";

type PartnerType = 'vendor' | 'customer';

interface PartnerMapping {
  id: string;
  tenant_id: string;
  erp_connection_id: string;
  partner_type: PartnerType;
  atheon_partner_ref: string;
  external_partner_id: string;
  external_partner_name: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

type EditorState =
  | { mode: 'create'; partnerType: PartnerType }
  | { mode: 'edit'; mapping: PartnerMapping };

export function PartnerMappingsPage() {
  const toast = useToast();
  const [connections, setConnections] = useState<ERPConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
  const [tab, setTab] = useState<PartnerType>('vendor');
  const [mappings, setMappings] = useState<PartnerMapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PartnerMapping | null>(null);

  // Load connections on mount.
  useEffect(() => {
    let cancelled = false;
    setConnectionsLoading(true);
    api.erp.connections().then((res) => {
      if (cancelled) return;
      setConnections(res.connections || []);
      // Auto-pick the first connection so the page isn't empty on first load.
      if (res.connections?.length && !selectedConnId) {
        setSelectedConnId(res.connections[0].id);
      }
    }).catch((err) => {
      if (cancelled) return;
      toast.error('Failed to load ERP connections', err instanceof Error ? err.message : undefined);
    }).finally(() => {
      if (!cancelled) setConnectionsLoading(false);
    });
    return () => { cancelled = true; };
    // toast is a stable ref; deps narrowed to mount-only fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMappings = useCallback(async () => {
    if (!selectedConnId) return;
    setMappingsLoading(true);
    setError(null);
    try {
      const res = await api.erp.partnerMappings(selectedConnId);
      setMappings(res.mappings || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load mappings');
    } finally {
      setMappingsLoading(false);
    }
  }, [selectedConnId]);

  useEffect(() => { loadMappings(); }, [loadMappings]);

  const selectedConn = useMemo(
    () => connections.find((c) => c.id === selectedConnId) || null,
    [connections, selectedConnId]
  );

  const filteredMappings = useMemo(() => {
    const lc = search.toLowerCase().trim();
    return mappings
      .filter((m) => m.partner_type === tab)
      .filter((m) =>
        !lc
        || m.atheon_partner_ref.toLowerCase().includes(lc)
        || m.external_partner_id.toLowerCase().includes(lc)
        || (m.external_partner_name?.toLowerCase().includes(lc) ?? false)
      );
  }, [mappings, tab, search]);

  const counts = useMemo(() => ({
    vendor: mappings.filter((m) => m.partner_type === 'vendor').length,
    customer: mappings.filter((m) => m.partner_type === 'customer').length,
  }), [mappings]);

  const handleSaved = async () => {
    setEditor(null);
    await loadMappings();
  };

  const handleDelete = async () => {
    if (!confirmDelete || !selectedConnId) return;
    try {
      await api.erp.deletePartnerMapping(selectedConnId, confirmDelete.partner_type, confirmDelete.atheon_partner_ref);
      toast.success('Mapping removed');
      setConfirmDelete(null);
      await loadMappings();
    } catch (err) {
      toast.error('Failed to remove mapping', err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-subtle)' }}>
            <Link2 className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold t-primary">Partner Mappings</h1>
            <p className="text-sm t-muted">
              Translate Atheon canonical partner refs to ERP-native IDs (Odoo res.partner.id, Xero ContactID, NetSuite internalId, SAP BUKRS).
            </p>
          </div>
        </div>
        <Button
          variant="primary"
          size="md"
          disabled={!selectedConnId}
          onClick={() => setEditor({ mode: 'create', partnerType: tab })}
        >
          <Plus size={14} /> Add mapping
        </Button>
      </div>

      {/* Connection picker */}
      <Card>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[260px] space-y-2">
            <label className="text-xs font-medium t-secondary uppercase tracking-wide">ERP Connection</label>
            {connectionsLoading ? (
              <div className="flex items-center text-sm t-muted">
                <Loader2 size={14} className="animate-spin mr-2" /> Loading connections…
              </div>
            ) : connections.length === 0 ? (
              <p className="text-sm t-muted">No ERP connections configured for this tenant.</p>
            ) : (
              <select
                value={selectedConnId || ''}
                onChange={(e) => setSelectedConnId(e.target.value || null)}
                className="w-full px-3 py-2 rounded-lg text-sm font-medium"
                style={{
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-card)',
                }}
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.adapterName} ({c.adapterSystem})
                  </option>
                ))}
              </select>
            )}
          </div>
          {selectedConn && (
            <div className="flex items-center gap-3">
              <Badge variant={selectedConn.status === 'active' ? 'success' : 'warning'}>
                {selectedConn.status}
              </Badge>
              <span className="text-xs t-muted">
                {counts.vendor + counts.customer} mapping{counts.vendor + counts.customer === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>
      </Card>

      {!selectedConnId ? null : (
        <>
          {/* Vendor / Customer tabs */}
          <div className="flex items-center gap-2 border-b" style={{ borderColor: 'var(--border-card)' }}>
            <TabButton active={tab === 'vendor'} onClick={() => setTab('vendor')} icon={Briefcase} label="Vendors" count={counts.vendor} />
            <TabButton active={tab === 'customer'} onClick={() => setTab('customer')} icon={Users} label="Customers" count={counts.customer} />
            <div className="ml-auto pb-2 relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 t-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Search ref or external ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 pr-2 py-1 rounded-md text-xs"
                style={{
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-card)',
                  width: 240,
                }}
              />
            </div>
          </div>

          {error && (
            <Card variant="outline" className="border-red-500/30">
              <p className="text-sm text-red-400 flex items-center gap-2">
                <AlertTriangle size={14} /> {error}
              </p>
            </Card>
          )}

          {mappingsLoading ? (
            <Card>
              <div className="flex items-center justify-center py-10 t-muted">
                <Loader2 size={16} className="animate-spin mr-2" /> Loading mappings…
              </div>
            </Card>
          ) : filteredMappings.length === 0 ? (
            <Card>
              <div className="text-center py-10 space-y-3">
                {tab === 'vendor' ? <Briefcase className="w-10 h-10 t-muted mx-auto" /> : <Users className="w-10 h-10 t-muted mx-auto" />}
                <h3 className="text-sm font-semibold t-primary">
                  {search ? 'No matches' : `No ${tab} mappings yet`}
                </h3>
                <p className="text-xs t-muted max-w-md mx-auto">
                  {search
                    ? 'Try a different search term or clear the filter.'
                    : `Without a ${tab} mapping for this connection, action-layer dispatches that reference a ${tab} by canonical ref will fail at the ERP boundary.`}
                </p>
                {!search && (
                  <Button variant="primary" size="md" onClick={() => setEditor({ mode: 'create', partnerType: tab })}>
                    <Plus size={14} /> Add first {tab} mapping
                  </Button>
                )}
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {filteredMappings.map((m) => (
                <Card key={m.id} className="cursor-pointer" onClick={() => setEditor({ mode: 'edit', mapping: m })}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-sm font-mono t-primary">{m.atheon_partner_ref}</code>
                        <span className="t-muted text-xs">→</span>
                        <code className="text-sm font-mono text-accent">{m.external_partner_id}</code>
                        {m.external_partner_name && (
                          <span className="text-xs t-secondary truncate max-w-[300px]">
                            {m.external_partner_name}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] t-muted">
                        Updated {new Date(m.updated_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button variant="outline" size="sm" onClick={() => setEditor({ mode: 'edit', mapping: m })}>
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => setConfirmDelete(m)}>
                        <Trash2 size={12} /> Remove
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* Editor modal */}
      {editor && selectedConnId && (
        <Modal
          title={editor.mode === 'create' ? `Add ${editor.partnerType} mapping` : `Edit ${editor.mapping.partner_type} mapping`}
          onClose={() => setEditor(null)}
        >
          <MappingEditor
            connectionId={selectedConnId}
            initial={editor.mode === 'edit' ? editor.mapping : null}
            partnerType={editor.mode === 'create' ? editor.partnerType : editor.mapping.partner_type}
            onSaved={handleSaved}
            onCancel={() => setEditor(null)}
          />
        </Modal>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <Portal>
          <div
            className="fixed inset-0 z-[9000] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setConfirmDelete(null)}
          >
            <div
              className="rounded-xl shadow-2xl p-6 w-full max-w-sm space-y-4"
              style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold t-primary">Remove mapping</h3>
              <p className="text-sm t-muted">
                Remove the {confirmDelete.partner_type} mapping{' '}
                <code className="font-mono">{confirmDelete.atheon_partner_ref}</code> →{' '}
                <code className="font-mono">{confirmDelete.external_partner_id}</code>?
              </p>
              <p className="text-xs t-muted">
                Future dispatches referencing this ref will fail until a new mapping is added.
              </p>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                <Button variant="danger" onClick={handleDelete}>Remove</Button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

// ─── Tab button ──────────────────────────────────────────────────────────
function TabButton({
  active, onClick, icon: Icon, label, count,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Users;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active ? 'text-accent' : 't-muted hover:t-primary'
      }`}
      style={{
        borderBottomColor: active ? 'var(--color-accent)' : 'transparent',
      }}
    >
      <Icon size={14} />
      {label}
      <Badge variant={active ? 'info' : 'outline'} size="sm">{count}</Badge>
    </button>
  );
}

// ─── Modal shell ─────────────────────────────────────────────────────────
function Modal({ children, title, onClose }: { children: React.ReactNode; title: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[9000] flex items-start justify-center p-4 overflow-y-auto"
        style={{ background: 'rgba(0,0,0,0.6)' }}
        onClick={onClose}
      >
        <div
          className="relative rounded-2xl border shadow-2xl w-full my-8"
          style={{
            background: 'var(--bg-card-solid)',
            borderColor: 'var(--border-card)',
            maxWidth: 560,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-card)' }}>
            <h2 className="text-base font-semibold t-primary">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[var(--bg-secondary)] t-muted hover:t-primary"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="p-5">{children}</div>
        </div>
      </div>
    </Portal>
  );
}

// ─── Editor (create + edit) ──────────────────────────────────────────────
interface MappingEditorProps {
  connectionId: string;
  initial: PartnerMapping | null;
  partnerType: PartnerType;
  onSaved: () => void;
  onCancel: () => void;
}

function MappingEditor({ connectionId, initial, partnerType, onSaved, onCancel }: MappingEditorProps) {
  const toast = useToast();
  const isEdit = !!initial;
  const [atheonRef, setAtheonRef] = useState(initial?.atheon_partner_ref ?? '');
  const [externalId, setExternalId] = useState(initial?.external_partner_id ?? '');
  const [externalName, setExternalName] = useState(initial?.external_partner_name ?? '');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const ref = atheonRef.trim();
    const ext = externalId.trim();
    if (!ref || !ext) {
      toast.error('Both refs are required');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.erp.upsertPartnerMapping(connectionId, {
        partner_type: partnerType,
        atheon_partner_ref: ref,
        external_partner_id: ext,
        external_partner_name: externalName.trim() || undefined,
      });
      toast.success(res.created ? 'Mapping added' : 'Mapping updated');
      onSaved();
    } catch (err) {
      toast.error('Failed to save mapping', err instanceof Error ? err.message : undefined);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-medium t-secondary uppercase tracking-wide">
          Atheon canonical ref
        </label>
        <input
          type="text"
          value={atheonRef}
          onChange={(e) => setAtheonRef(e.target.value)}
          placeholder={partnerType === 'vendor' ? 'vendor-acme-001' : 'customer-acme-001'}
          disabled={isEdit}
          className="w-full px-3 py-2 rounded-lg text-sm font-mono"
          style={{
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-card)',
            opacity: isEdit ? 0.6 : 1,
          }}
        />
        <p className="text-[11px] t-muted">
          Stable identifier the action-layer subcatalysts emit. Typically the source-system natural key
          (e.g. SAP partner code or the slug from your canonical {partnerType} table).
          {isEdit && ' Cannot be changed once a mapping exists — remove and re-add to rename.'}
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium t-secondary uppercase tracking-wide">
          External ERP ID
        </label>
        <input
          type="text"
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
          placeholder="e.g. 17 (Odoo) / 0e0c-… (Xero) / 4421 (NetSuite)"
          className="w-full px-3 py-2 rounded-lg text-sm font-mono"
          style={{
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-card)',
          }}
        />
        <p className="text-[11px] t-muted">
          The ID the ERP write API will receive verbatim. Numeric for Odoo and NetSuite, UUID for Xero,
          BUKRS partner code for SAP.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium t-secondary uppercase tracking-wide">
          External name <span className="t-muted normal-case">(optional)</span>
        </label>
        <input
          type="text"
          value={externalName}
          onChange={(e) => setExternalName(e.target.value)}
          placeholder="Acme Corp Ltd"
          className="w-full px-3 py-2 rounded-lg text-sm"
          style={{
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-card)',
          }}
        />
        <p className="text-[11px] t-muted">
          Human-readable name from the ERP, shown in this list to confirm the mapping points at the
          right party.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={submitting || !atheonRef.trim() || !externalId.trim()}>
          {submitting && <Loader2 size={12} className="animate-spin mr-1" />}
          {isEdit ? 'Update mapping' : 'Add mapping'}
        </Button>
      </div>
    </div>
  );
}

export default PartnerMappingsPage;
