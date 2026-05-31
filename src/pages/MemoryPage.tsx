import { useState, useEffect, useCallback } from "react";
import { api, ApiError } from "@/lib/api";
import type { GraphEntity, GraphRelationship, GraphQueryResult } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { AsyncPageContent, statusFrom } from "@/components/ui/async";
import { PageHeader } from "@/components/ui/page-header";
import { KnowledgeGraphViz } from "@/components/memory/KnowledgeGraphViz";
import {
  Plus,
  Search,
  Link2,
  X,
  Loader2,
  AlertTriangle,
  Sparkles,
} from "lucide-react";

/**
 * Memory — Knowledge graph UI (entities, relationships, GraphRAG search).
 *
 * Backend: /api/memory/* (tenant-scoped; no companyId needed — tenant resolution
 * is driven by auth context + optional tenant_id override on the backend).
 *
 * The backend supports:
 *   GET/POST  /api/memory/entities
 *   GET/POST  /api/memory/relationships
 *   GET       /api/memory/graph
 *   POST      /api/memory/query          (GraphRAG)
 *   GET       /api/memory/stats
 *
 * There is no PUT/DELETE for entities, nor a CSV import endpoint — so the UI
 * no longer advertises those operations.
 */

const REL_TYPES = ["depends_on", "owns", "manages", "feeds_into", "reports_to"];

const ENTITY_TYPES = [
  "Organization",
  "Process",
  "System",
  "Person",
  "Product",
  "Department",
  "Location",
];

export function MemoryPage() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<"graph" | "entities" | "relationships" | "search">("graph");

  const [entities, setEntities] = useState<GraphEntity[]>([]);
  const [relationships, setRelationships] = useState<GraphRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  // Entity form
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("Organization");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Relationship form
  const [showRelForm, setShowRelForm] = useState(false);
  const [relSource, setRelSource] = useState("");
  const [relTarget, setRelTarget] = useState("");
  const [relType, setRelType] = useState("depends_on");
  const [relSaving, setRelSaving] = useState(false);
  const [relFormError, setRelFormError] = useState<string | null>(null);

  // GraphRAG search
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<GraphQueryResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoadError(null);
    try {
      const [ents, rels] = await Promise.all([
        api.memory.entities(undefined, typeFilter || undefined),
        api.memory.relationships(),
      ]);
      setEntities(ents.entities || []);
      setRelationships(rels.relationships || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load knowledge graph";
      setLoadError(message);
      toast.error("Failed to load knowledge graph", {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  }, [toast, typeFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredEntities = entities.filter((e) => {
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleSaveEntity = async () => {
    setSaving(true);
    setFormError(null);
    try {
      await api.memory.createEntity({ type: formType, name: formName });
      await fetchData();
      setShowForm(false);
      setFormName("");
      setFormType("Organization");
      toast.success("Entity created");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create entity";
      setFormError(message);
      toast.error("Failed to create entity", {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRelationship = async () => {
    setRelSaving(true);
    setRelFormError(null);
    try {
      await api.memory.createRelationship({
        source_id: relSource,
        target_id: relTarget,
        type: relType,
      });
      await fetchData();
      setShowRelForm(false);
      setRelSource("");
      setRelTarget("");
      setRelType("depends_on");
      toast.success("Relationship created");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create relationship";
      setRelFormError(message);
      toast.error("Failed to create relationship", {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setRelSaving(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSearchResult(null);
    try {
      const result = await api.memory.query(searchQuery);
      setSearchResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to run graph query";
      setSearchError(message);
      toast.error("Graph query failed", {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setSearching(false);
    }
  };

  const status = statusFrom({ loading, error: null, isEmpty: false });
  if (status !== 'success') {
    return (
      <AsyncPageContent
        status={status}
        loadingVariant="cards"
        loadingCount={4}
      >
        {null}
      </AsyncPageContent>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Memory · Knowledge Graph"
        title="Memory"
        dek="Knowledge Graph & Semantic Retrieval"
      />

      {loadError && !loading && (
        <div className="flex items-center gap-2 p-3 rounded-md border" style={{ background: 'rgb(var(--neg-rgb) / 0.08)', borderColor: 'rgb(var(--neg-rgb) / 0.25)' }}>
          <AlertTriangle size={14} className="flex-shrink-0" style={{ color: 'var(--neg)' }} />
          <p className="text-xs flex-1" style={{ color: 'var(--neg)' }}>{loadError}</p>
          <button onClick={fetchData} className="text-xs underline" style={{ color: 'var(--neg)' }}>
            Retry
          </button>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-md" style={{ background: "var(--bg-secondary)" }}>
        {[
          { id: "graph" as const, label: "Graph" },
          { id: "entities" as const, label: "Entities" },
          { id: "relationships" as const, label: "Relationships" },
          { id: "search" as const, label: "GraphRAG Search" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-xs font-medium transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] ${activeTab === tab.id ? "t-primary" : "t-muted hover:t-secondary"}`}
            style={activeTab === tab.id ? { background: "var(--bg-card)", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" } : undefined}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Graph Tab — Stitch "Knowledge Graph" force-directed canvas */}
      {activeTab === "graph" && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 t-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Highlight entities by name..."
                className="w-full pl-9 pr-3 py-2 rounded-md text-body-sm t-primary"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
              />
            </div>
            <span className="text-caption t-muted font-mono">
              {entities.length} entities · {relationships.length} relationships
            </span>
          </div>
          <KnowledgeGraphViz
            entities={entities}
            relationships={relationships}
            highlight={search}
            onSelect={() => { /* future: open side-panel for detail */ }}
          />
        </div>
      )}

      {/* Entities Tab */}
      {activeTab === "entities" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 t-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter entities by name..."
                className="w-full pl-9 pr-3 py-2 rounded-md text-sm t-primary"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 rounded-md text-sm t-secondary"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
              title="Filter by entity type"
            >
              <option value="">All Types</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setShowForm(true);
                setFormName("");
                setFormType("Organization");
                setFormError(null);
              }}
              className="px-3 py-2 rounded-md text-sm font-medium text-[var(--text-on-accent)] flex items-center gap-1.5"
              style={{ background: "var(--accent)" }}
              title="Create a new entity"
            >
              <Plus size={14} /> Add Entity
            </button>
          </div>

          <div className="space-y-2">
            {filteredEntities.map((ent) => (
              <div
                key={ent.id}
                className="flex items-center justify-between p-3 rounded-md"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium t-primary truncate">{ent.name}</p>
                  <p className="text-xs t-muted">
                    {ent.type}
                    {ent.source ? ` - ${ent.source}` : ""}
                    {typeof ent.confidence === "number" ? ` | ${Math.round(ent.confidence * 100)}% confidence` : ""}
                  </p>
                </div>
              </div>
            ))}
            {filteredEntities.length === 0 && (
              <p className="text-sm t-muted text-center py-8">
                {entities.length === 0
                  ? "No entities yet. Add your first entity to start building the knowledge graph."
                  : "No entities match the current filters."}
              </p>
            )}
          </div>

          {/* Entity Form Modal */}
          {showForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div
                className="w-full max-w-md rounded-md p-6 space-y-4"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold t-primary">Add Entity</h3>
                  <button onClick={() => setShowForm(false)} className="t-muted hover:t-primary" title="Close">
                    <X size={16} />
                  </button>
                </div>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Entity name"
                  className="w-full px-3 py-2 rounded-md text-sm t-primary"
                  style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
                />
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value)}
                  className="w-full px-3 py-2 rounded-md text-sm t-primary"
                  style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
                >
                  {ENTITY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                {formError && (
                  <div className="flex items-center gap-2 p-2 rounded-md border" style={{ background: 'rgb(var(--neg-rgb) / 0.08)', borderColor: 'rgb(var(--neg-rgb) / 0.25)' }}>
                    <AlertTriangle size={12} className="flex-shrink-0" style={{ color: 'var(--neg)' }} />
                    <p className="text-xs" style={{ color: 'var(--neg)' }}>{formError}</p>
                  </div>
                )}
                <button
                  onClick={handleSaveEntity}
                  disabled={saving || !formName.trim()}
                  className="w-full px-4 py-2 rounded-md text-sm font-medium text-[var(--text-on-accent)] flex items-center justify-center gap-2"
                  style={{ background: "var(--accent)", opacity: saving || !formName.trim() ? 0.6 : 1 }}
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  {saving ? "Creating..." : "Create Entity"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Relationships Tab */}
      {activeTab === "relationships" && (
        <div className="space-y-4">
          <button
            onClick={() => {
              setShowRelForm(true);
              setRelFormError(null);
            }}
            className="px-3 py-2 rounded-md text-sm font-medium text-[var(--text-on-accent)] flex items-center gap-1.5"
            style={{ background: "var(--accent)" }}
            title="Create a new relationship"
            disabled={entities.length < 2}
          >
            <Link2 size={14} /> Add Relationship
          </button>
          {entities.length < 2 && (
            <p className="text-xs t-muted">Add at least two entities first to create a relationship.</p>
          )}

          <div className="space-y-2">
            {relationships.map((rel) => (
              <div
                key={rel.id}
                className="flex items-center gap-3 p-3 rounded-md"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
              >
                <span className="text-sm t-primary truncate" title={rel.sourceName}>
                  {rel.sourceName || rel.sourceId}
                </span>
                <span
                  className="text-xs px-2 py-0.5 rounded-sm t-muted flex-shrink-0"
                  style={{ background: "var(--bg-secondary)" }}
                >
                  {rel.type}
                </span>
                <span className="text-sm t-primary truncate" title={rel.targetName}>
                  {rel.targetName || rel.targetId}
                </span>
              </div>
            ))}
            {relationships.length === 0 && (
              <p className="text-sm t-muted text-center py-8">No relationships defined yet.</p>
            )}
          </div>

          {showRelForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div
                className="w-full max-w-md rounded-md p-6 space-y-4"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold t-primary">Add Relationship</h3>
                  <button
                    onClick={() => setShowRelForm(false)}
                    className="t-muted hover:t-primary"
                    title="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
                <select
                  value={relSource}
                  onChange={(e) => setRelSource(e.target.value)}
                  className="w-full px-3 py-2 rounded-md text-sm t-primary"
                  style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
                >
                  <option value="">Source Entity</option>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.type})
                    </option>
                  ))}
                </select>
                <select
                  value={relType}
                  onChange={(e) => setRelType(e.target.value)}
                  className="w-full px-3 py-2 rounded-md text-sm t-primary"
                  style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
                >
                  {REL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <select
                  value={relTarget}
                  onChange={(e) => setRelTarget(e.target.value)}
                  className="w-full px-3 py-2 rounded-md text-sm t-primary"
                  style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
                >
                  <option value="">Target Entity</option>
                  {entities
                    .filter((e) => e.id !== relSource)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} ({e.type})
                      </option>
                    ))}
                </select>
                {relFormError && (
                  <div className="flex items-center gap-2 p-2 rounded-md border" style={{ background: 'rgb(var(--neg-rgb) / 0.08)', borderColor: 'rgb(var(--neg-rgb) / 0.25)' }}>
                    <AlertTriangle size={12} className="flex-shrink-0" style={{ color: 'var(--neg)' }} />
                    <p className="text-xs" style={{ color: 'var(--neg)' }}>{relFormError}</p>
                  </div>
                )}
                <button
                  onClick={handleSaveRelationship}
                  disabled={relSaving || !relSource || !relTarget}
                  className="w-full px-4 py-2 rounded-md text-sm font-medium text-[var(--text-on-accent)] flex items-center justify-center gap-2"
                  style={{ background: "var(--accent)", opacity: relSaving || !relSource || !relTarget ? 0.6 : 1 }}
                >
                  {relSaving ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                  {relSaving ? "Creating..." : "Create Relationship"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* GraphRAG Search Tab */}
      {activeTab === "search" && (
        <div className="rounded-md p-6 space-y-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold t-primary flex items-center gap-2">
              <Sparkles size={14} style={{ color: "var(--accent)" }} /> Knowledge Graph Query
            </h2>
            <p className="text-xs t-muted">
              Ask a natural-language question; results combine vector similarity and keyword matches over your graph.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              placeholder="e.g. Which processes depend on SAP?"
              className="flex-1 px-3 py-2 rounded-md text-sm t-primary"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
            />
            <button
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim()}
              className="px-4 py-2 rounded-md text-sm font-medium text-[var(--text-on-accent)] flex items-center gap-2"
              style={{ background: "var(--accent)", opacity: searching || !searchQuery.trim() ? 0.6 : 1 }}
            >
              {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {searching ? "Searching..." : "Search"}
            </button>
          </div>

          {searchError && (
            <div className="flex items-center gap-2 p-3 rounded-md border" style={{ background: 'rgb(var(--neg-rgb) / 0.08)', borderColor: 'rgb(var(--neg-rgb) / 0.25)' }}>
              <AlertTriangle size={14} className="flex-shrink-0" style={{ color: 'var(--neg)' }} />
              <p className="text-xs flex-1" style={{ color: 'var(--neg)' }}>{searchError}</p>
            </div>
          )}

          {searchResult && (
            <div className="space-y-4">
              {searchResult.answer && (
                <div
                  className="p-4 rounded-md text-sm t-secondary whitespace-pre-wrap"
                  style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
                >
                  {searchResult.answer}
                </div>
              )}

              <div>
                <p className="text-label mb-2">
                  Direct matches ({searchResult.directMatches?.length || 0})
                </p>
                {searchResult.directMatches && searchResult.directMatches.length > 0 ? (
                  <div className="space-y-1.5">
                    {searchResult.directMatches.map((e) => (
                      <div
                        key={e.id}
                        className="flex items-center justify-between p-2 rounded-md"
                        style={{ background: "var(--bg-secondary)" }}
                      >
                        <span className="text-xs t-primary">{e.name}</span>
                        <span className="text-caption t-muted">{e.type}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs t-muted">No direct matches.</p>
                )}
              </div>

              {searchResult.relatedEntities && searchResult.relatedEntities.length > 0 && (
                <div>
                  <p className="text-label mb-2">
                    Related ({searchResult.relatedEntities.length})
                  </p>
                  <div className="space-y-1.5">
                    {searchResult.relatedEntities.map((e) => (
                      <div
                        key={e.id}
                        className="flex items-center justify-between p-2 rounded-md"
                        style={{ background: "var(--bg-secondary)" }}
                      >
                        <span className="text-xs t-primary">{e.name}</span>
                        <span className="text-caption t-muted">{e.type}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!searchResult && !searching && !searchError && (
            <p className="text-xs t-muted text-center py-6">Enter a query above to search the knowledge graph.</p>
          )}
        </div>
      )}
    </div>
  );
}
