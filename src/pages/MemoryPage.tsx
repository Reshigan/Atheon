import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Database, Network, Search, BookOpen, ArrowRight } from "lucide-react";

const graphStats = [
  { label: 'Total Entities', value: '24,892', change: '+342 (7d)' },
  { label: 'Relationships', value: '89,431', change: '+1,204 (7d)' },
  { label: 'Avg Confidence', value: '0.87', change: '+0.02 (7d)' },
  { label: 'Vector Embeddings', value: '156K', change: 'Indexed' },
];

const entityTypes = [
  { type: 'Organisation', count: 145, color: 'bg-indigo-500' },
  { type: 'Department', count: 892, color: 'bg-blue-500' },
  { type: 'Person', count: 4521, color: 'bg-violet-500' },
  { type: 'Process', count: 2340, color: 'bg-emerald-500' },
  { type: 'System', count: 89, color: 'bg-amber-500' },
  { type: 'KPI', count: 456, color: 'bg-pink-500' },
  { type: 'Document', count: 12890, color: 'bg-cyan-500' },
  { type: 'Risk', count: 234, color: 'bg-red-500' },
  { type: 'Asset', count: 3325, color: 'bg-orange-500' },
];

const recentQueries = [
  { query: 'Why is OTIF declining?', strategy: 'Graph + Vector', entities: 12, latency: '120ms', confidence: 0.89 },
  { query: 'Who manages the Limpopo expansion?', strategy: 'Graph traversal', entities: 5, latency: '45ms', confidence: 0.95 },
  { query: 'What are the risks for Q2 forex?', strategy: 'Vector search', entities: 8, latency: '85ms', confidence: 0.91 },
  { query: 'Show invoice processing bottlenecks', strategy: 'Graph + Vector', entities: 15, latency: '150ms', confidence: 0.87 },
];

const industryTemplates = [
  { name: 'FMCG Graph Template', entities: 'SKU, Retailer, Distributor, Promotion, Route, Shelf', status: 'active' },
  { name: 'Healthcare Graph Template', entities: 'Patient, Ward, Clinician, Procedure, Equipment, Drug', status: 'active' },
  { name: 'Mining Graph Template', entities: 'Mine Site, Equipment, Ore Body, Safety Event, Environmental Metric', status: 'active' },
];

export function MemoryPage() {
  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-pink-500/15 flex items-center justify-center">
          <Database className="w-5 h-5 text-pink-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Atheon Memory</h1>
          <p className="text-sm text-neutral-400">GraphRAG Knowledge Foundation - Organisational Intelligence</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {graphStats.map((stat) => (
          <Card key={stat.label}>
            <span className="text-xs text-neutral-500">{stat.label}</span>
            <p className="text-2xl font-bold text-white mt-1">{stat.value}</p>
            <span className="text-xs text-emerald-400">{stat.change}</span>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Entity Types */}
        <Card>
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Network className="w-4 h-4 text-pink-400" /> Entity Distribution
          </h3>
          <div className="space-y-3">
            {entityTypes.map((entity) => (
              <div key={entity.type} className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${entity.color} flex-shrink-0`} />
                <span className="text-sm text-neutral-300 w-28">{entity.type}</span>
                <div className="flex-1">
                  <Progress
                    value={entity.count}
                    max={Math.max(...entityTypes.map(e => e.count))}
                    color="indigo"
                    size="sm"
                  />
                </div>
                <span className="text-xs text-neutral-400 w-16 text-right">{entity.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* RAG Pipeline */}
        <Card>
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Search className="w-4 h-4 text-pink-400" /> RAG Pipeline - Recent Queries
          </h3>
          <div className="space-y-3">
            {recentQueries.map((q, i) => (
              <div key={i} className="p-3 rounded-lg bg-neutral-800/40 border border-neutral-800/50">
                <div className="flex items-start justify-between">
                  <p className="text-sm text-neutral-200 font-medium">"{q.query}"</p>
                  <Badge variant="info" size="sm">{Math.round(q.confidence * 100)}%</Badge>
                </div>
                <div className="flex items-center gap-4 mt-2 text-[10px] text-neutral-600">
                  <span>Strategy: {q.strategy}</span>
                  <span>{q.entities} entities</span>
                  <span>{q.latency}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Industry Templates */}
      <Card>
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-pink-400" /> Industry Graph Templates
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {industryTemplates.map((template) => (
            <div key={template.name} className="p-4 rounded-lg bg-neutral-800/40 border border-neutral-800/50">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-neutral-200">{template.name}</h4>
                <Badge variant="success" size="sm">{template.status}</Badge>
              </div>
              <p className="text-xs text-neutral-500">{template.entities}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Architecture */}
      <Card className="border-pink-500/20">
        <div className="flex items-start gap-3">
          <Database className="w-5 h-5 text-pink-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-white">GraphRAG Architecture</h3>
            <p className="text-xs text-neutral-400 mt-1">
              Atheon Memory uses Cloudflare D1 (SQLite at edge) for the graph adjacency model and Cloudflare Vectorize
              for semantic search with BGE-large-en-v1.5 embeddings (1024 dimensions). Hybrid retrieval combines vector
              similarity with structured graph traversal. Every fact carries a confidence score and source citation,
              ensuring full provenance from query to response.
            </p>
            <div className="flex items-center gap-2 mt-3 text-xs text-neutral-500">
              <span className="px-2 py-1 rounded bg-neutral-800">D1 Graph</span>
              <ArrowRight className="w-3 h-3" />
              <span className="px-2 py-1 rounded bg-neutral-800">Vectorize</span>
              <ArrowRight className="w-3 h-3" />
              <span className="px-2 py-1 rounded bg-neutral-800">Hybrid RAG</span>
              <ArrowRight className="w-3 h-3" />
              <span className="px-2 py-1 rounded bg-neutral-800">Citation Injection</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
