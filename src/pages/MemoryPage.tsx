import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import type { GraphStats, GraphEntity } from "@/lib/api";
import { Database, Network, Search, BookOpen, ArrowRight, Loader2 } from "lucide-react";

const entityColors: Record<string, string> = {
    Organisation: 'bg-[#1a5c68]',
    Department: 'bg-[#2a7c8c]/100',
    Person: 'bg-[#2a7c8c]',
  Process: 'bg-emerald-500/100',
  System: 'bg-[#2a7c8c]/100',
  KPI: 'bg-sky-500',
  Document: 'bg-[#2a7c8c]/100',
  Risk: 'bg-red-500/100',
  Asset: 'bg-orange-500',
};

const industryTemplates = [
  { name: 'FMCG Graph Template', entities: 'SKU, Retailer, Distributor, Promotion, Route, Shelf', status: 'active' },
  { name: 'Healthcare Graph Template', entities: 'Patient, Ward, Clinician, Procedure, Equipment, Drug', status: 'active' },
  { name: 'Mining Graph Template', entities: 'Mine Site, Equipment, Ore Body, Safety Event, Environmental Metric', status: 'active' },
];

export function MemoryPage() {
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [entities, setEntities] = useState<GraphEntity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [s, e] = await Promise.allSettled([
        api.memory.stats(), api.memory.entities(),
      ]);
      if (s.status === 'fulfilled') setStats(s.value);
      if (e.status === 'fulfilled') setEntities(e.value.entities);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-[#2a7c8c] animate-spin" />
      </div>
    );
  }

  const entityTypes = stats?.entityTypes || [];
  const maxCount = entityTypes.length > 0 ? Math.max(...entityTypes.map(e => e.count)) : 1;
  const graphStats = [
    { label: 'Total Entities', value: stats?.entities?.toLocaleString() || '0', change: `${entityTypes.length} types` },
    { label: 'Relationships', value: stats?.relationships?.toLocaleString() || '0', change: `${stats?.relationshipTypes?.length || 0} types` },
    { label: 'Entity Types', value: String(entityTypes.length), change: 'Indexed' },
    { label: 'Recent Entities', value: String(entities.length), change: 'loaded' },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl        bg-[#2a7c8c]/10 flex items-center justify-center">
                  <Database className="w-5 h-5 text-[#2a7c8c]"/>
        </div>
        <div>
          <h1 className="text-2xl font-bold t-primary">Atheon Memory</h1>
          <p className="text-sm t-muted">GraphRAG Knowledge Foundation - Organisational Intelligence</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {graphStats.map((stat) => (
          <Card key={stat.label}>
            <span className="text-xs t-secondary">{stat.label}</span>
            <p className="text-2xl font-bold text-white mt-1">{stat.value}</p>
            <span className="text-xs text-emerald-400">{stat.change}</span>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Entity Types */}
        <Card>
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Network className="w-4 h-4 text-[#2a7c8c]" /> Entity Distribution
          </h3>
          <div className="space-y-3">
            {entityTypes.map((entity) => (
              <div key={entity.type} className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${entityColors[entity.type] || 'bg-gray-400'} flex-shrink-0`} />
                <span className="text-sm t-secondary w-28">{entity.type}</span>
                <div className="flex-1">
                  <Progress
                    value={entity.count}
                    max={maxCount}
                    color="blue"
                    size="sm"
                  />
                </div>
                <span className="text-xs t-muted w-16 text-right">{entity.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* RAG Pipeline */}
        <Card>
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Search className="w-4 h-4 text-[#2a7c8c]" /> Recent Entities
          </h3>
          <div className="space-y-3">
            {entities.slice(0, 6).map((entity) => (
              <div key={entity.id}              className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                              <div className="flex items-start justify-between">
                                <p className="text-sm text-white font-medium">{entity.name}</p>
                  <Badge variant="info" size="sm">{Math.round(entity.confidence * 100)}%</Badge>
                </div>
                <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-400">
                  <span>Type: {entity.type}</span>
                  <span>Source: {entity.source}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Industry Templates */}
      <Card>
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-[#2a7c8c]" /> Industry Graph Templates
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {industryTemplates.map((template) => (
            <div key={template.name}            className="p-4 rounded-lg bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-semibold t-primary">{template.name}</h4>
                <Badge variant="success" size="sm">{template.status}</Badge>
              </div>
              <p className="text-xs t-secondary">{template.entities}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Architecture */}
      <Card className="border-[#2a7c8c]/20">
        <div className="flex items-start gap-3">
          <Database className="w-5 h-5 text-[#2a7c8c] mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold t-primary">GraphRAG Architecture</h3>
            <p className="text-xs t-muted mt-1">
              Atheon Memory uses Cloudflare D1 (SQLite at edge) for the graph adjacency model and Cloudflare Vectorize
              for semantic search with BGE-large-en-v1.5 embeddings (1024 dimensions). Hybrid retrieval combines vector
              similarity with structured graph traversal. Every fact carries a confidence score and source citation,
              ensuring full provenance from query to response.
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-gray-400">
              <span className="px-2 py-1 rounded bg-white/[0.04] border border-white/[0.06]">D1 Graph</span>
              <ArrowRight className="w-3 h-3 flex-shrink-0" />
              <span className="px-2 py-1 rounded bg-white/[0.04] border border-white/[0.06]">Vectorize</span>
              <ArrowRight className="w-3 h-3 flex-shrink-0" />
              <span className="px-2 py-1 rounded bg-white/[0.04] border border-white/[0.06]">Hybrid RAG</span>
              <ArrowRight className="w-3 h-3 flex-shrink-0" />
              <span className="px-2 py-1 rounded bg-white/[0.04] border border-white/[0.06]">Citation Injection</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
