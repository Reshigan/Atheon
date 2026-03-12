import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import type { GraphStats, GraphEntity, GraphRelationship } from "@/lib/api";
import { useAppStore } from "@/stores/appStore";
import { Database, Network, Search, BookOpen, ArrowRight, Loader2, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const entityColors: Record<string, string> = {
 Organisation: 'bg-accent',
 Department: 'bg-accent',
 Person: 'bg-accent',
 Process: 'bg-emerald-500',
 System: 'bg-accent',
 KPI: 'bg-sky-500',
 Document: 'bg-accent',
 Risk: 'bg-red-500',
 Asset: 'bg-orange-500',
};

const industryTemplates = [
 { name: 'FMCG Graph Template', entities: 'SKU, Retailer, Distributor, Promotion, Route, Shelf', status: 'active' },
 { name: 'Healthcare Graph Template', entities: 'Patient, Ward, Clinician, Procedure, Equipment, Drug', status: 'active' },
 { name: 'Mining Graph Template', entities: 'Mine Site, Equipment, Ore Body, Safety Event, Environmental Metric', status: 'active' },
];

/** Phase 4.2: Simple SVG force-directed graph visualization */
interface GraphNode { id: string; label: string; type: string; x: number; y: number; vx: number; vy: number; }
interface GraphEdge { source: string; target: string; label: string; }

function ForceGraph({ entities, relationships }: { entities: GraphEntity[]; relationships: GraphRelationship[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const nodeMap = new Map<string, GraphNode>();
    const w = 600, h = 400;
    entities.slice(0, 40).forEach((e, i) => {
      const angle = (2 * Math.PI * i) / Math.min(entities.length, 40);
      const r = 120 + Math.random() * 60;
      nodeMap.set(e.id, { id: e.id, label: e.name, type: e.type, x: w / 2 + r * Math.cos(angle), y: h / 2 + r * Math.sin(angle), vx: 0, vy: 0 });
    });
    setNodes(Array.from(nodeMap.values()));
    const edgeList: GraphEdge[] = [];
    relationships.slice(0, 60).forEach(r => {
      if (nodeMap.has(r.sourceId) && nodeMap.has(r.targetId)) {
        edgeList.push({ source: r.sourceId, target: r.targetId, label: r.type });
      }
    });
    setEdges(edgeList);
  }, [entities, relationships]);

  // Simple force simulation
  const simulate = useCallback(() => {
    setNodes(prev => {
      const next = prev.map(n => ({ ...n }));
      const w = 600, h = 400;
      // Repulsion between all nodes
      for (let i = 0; i < next.length; i++) {
        for (let j = i + 1; j < next.length; j++) {
          const dx = next[j].x - next[i].x;
          const dy = next[j].y - next[i].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = 800 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          next[i].vx -= fx; next[i].vy -= fy;
          next[j].vx += fx; next[j].vy += fy;
        }
      }
      // Attraction along edges
      edges.forEach(e => {
        const s = next.find(n => n.id === e.source);
        const t = next.find(n => n.id === e.target);
        if (s && t) {
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = (dist - 100) * 0.01;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          s.vx += fx; s.vy += fy;
          t.vx -= fx; t.vy -= fy;
        }
      });
      // Center gravity
      next.forEach(n => {
        n.vx += (w / 2 - n.x) * 0.001;
        n.vy += (h / 2 - n.y) * 0.001;
        n.vx *= 0.9; n.vy *= 0.9;
        n.x = Math.max(20, Math.min(w - 20, n.x + n.vx));
        n.y = Math.max(20, Math.min(h - 20, n.y + n.vy));
      });
      // Convergence check: stop animation when kinetic energy is low
      const totalEnergy = next.reduce((sum, n) => sum + n.vx * n.vx + n.vy * n.vy, 0);
      if (totalEnergy > 0.01) {
        animRef.current = requestAnimationFrame(simulate);
      }
      return next;
    });
  }, [edges]);

  useEffect(() => {
    if (nodes.length > 0) {
      cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(simulate);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [simulate]);

  const typeColors: Record<string, string> = {
    Organisation: '#4f46e5', Department: '#6366f1', Person: '#8b5cf6',
    Process: '#10b981', System: '#3b82f6', KPI: '#0ea5e9',
    Document: '#6366f1', Risk: '#ef4444', Asset: '#f97316',
  };

  if (nodes.length === 0) {
    return <div className="flex items-center justify-center h-48 text-gray-400 text-sm">No graph data available</div>;
  }

  return (
    <svg ref={svgRef} viewBox="0 0 600 400" className="w-full h-full" style={{ minHeight: 300 }}>
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto"><polygon points="0 0, 6 2, 0 4" fill="var(--text-muted)" opacity="0.4" /></marker>
      </defs>
      {edges.map((e, i) => {
        const s = nodes.find(n => n.id === e.source);
        const t = nodes.find(n => n.id === e.target);
        if (!s || !t) return null;
        return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="var(--text-muted)" strokeOpacity={0.2} strokeWidth={1} markerEnd="url(#arrowhead)" />;
      })}
      {nodes.map(n => (
        <g key={n.id} onMouseEnter={() => setHoveredNode(n.id)} onMouseLeave={() => setHoveredNode(null)}>
          <circle cx={n.x} cy={n.y} r={hoveredNode === n.id ? 10 : 7} fill={typeColors[n.type] || '#6366f1'} opacity={hoveredNode === n.id ? 1 : 0.8} style={{ cursor: 'pointer', transition: 'r 0.2s' }} />
          {hoveredNode === n.id && (
            <text x={n.x} y={n.y - 14} textAnchor="middle" className="text-[10px]" fill="var(--text-primary)" fontWeight="600">{n.label}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

export function MemoryPage() {
 const industry = useAppStore((s) => s.industry);
 const user = useAppStore((s) => s.user);
 const isAdmin = user?.role === 'superadmin' || user?.role === 'support_admin';
 const [stats, setStats] = useState<GraphStats | null>(null);
 const [entities, setEntities] = useState<GraphEntity[]>([]);
 const [relationships, setRelationships] = useState<GraphRelationship[]>([]);
 const [loading, setLoading] = useState(true);
 const [showGraph, setShowGraph] = useState(false);

 useEffect(() => {
 async function load() {
 setLoading(true);
 const ind = industry !== 'general' ? industry : undefined;
 const [s, e, r] = await Promise.allSettled([
 api.memory.stats(undefined, ind), api.memory.entities(undefined, undefined, ind), api.memory.relationships(undefined, ind),
 ]);
 if (s.status === 'fulfilled') setStats(s.value);
 if (e.status === 'fulfilled') setEntities(e.value.entities);
 if (r.status === 'fulfilled') setRelationships(r.value.relationships);
 setLoading(false);
 }
 load();
 }, [industry]);

 if (loading) {
 return (
 <div className="flex items-center justify-center h-96">
 <Loader2 className="w-8 h-8 text-accent animate-spin" />
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
 <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
 <Database className="w-5 h-5 text-accent"/>
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
 <p className="text-2xl font-bold t-primary mt-1">{stat.value}</p>
 <span className="text-xs text-emerald-400">{stat.change}</span>
 </Card>
 ))}
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 {/* Entity Types */}
 <Card>
 <h3 className="text-lg font-semibold t-primary mb-4 flex items-center gap-2">
 <Network className="w-4 h-4 text-accent" /> Entity Distribution
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

 {/* Phase 4.2: Knowledge Graph Visualization */}
 <Card>
 <div className="flex items-center justify-between mb-4">
   <h3 className="text-lg font-semibold t-primary flex items-center gap-2">
     <Network className="w-4 h-4 text-accent" /> {showGraph ? 'Knowledge Graph' : 'Recent Entities'}
   </h3>
   <Button variant="secondary" size="sm" onClick={() => setShowGraph(!showGraph)} title={showGraph ? 'Show entity list' : 'Show graph visualization'}>
     {showGraph ? <Search size={14} /> : <Maximize2 size={14} />}
     {showGraph ? 'List View' : 'Graph View'}
   </Button>
 </div>
 {showGraph ? (
   <ForceGraph entities={entities} relationships={relationships} />
 ) : (
 <div className="space-y-3">
 {entities.slice(0, 6).map((entity) => (
 <div key={entity.id} className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <div className="flex items-start justify-between">
 <p className="text-sm t-primary font-medium">{entity.name}</p>
 <Badge variant="info" size="sm">{Math.round(entity.confidence * 100)}%</Badge>
 </div>
 <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-400">
 <span>Type: {entity.type}</span>
 <span>Source: {entity.source}</span>
 </div>
 </div>
 ))}
 {entities.length === 0 && <div className="text-center text-gray-400 text-sm py-8">No entities found. Deploy catalysts to build the knowledge graph.</div>}
 </div>
 )}
 </Card>
 </div>

 {/* UX-08: Industry Templates — admin only */}
 {isAdmin && (
 <Card>
 <h3 className="text-lg font-semibold t-primary mb-4 flex items-center gap-2">
 <BookOpen className="w-4 h-4 text-accent" /> Industry Graph Templates
 </h3>
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 {industryTemplates.map((template) => (
 <div key={template.name} className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <div className="flex items-center justify-between mb-2">
 <h4 className="text-sm font-semibold t-primary">{template.name}</h4>
 <Badge variant="success" size="sm">{template.status}</Badge>
 </div>
 <p className="text-xs t-secondary">{template.entities}</p>
 </div>
 ))}
 </div>
 </Card>
 )}

 {/* UX-08: Architecture — admin only */}
 {isAdmin && (
 <Card className="border-accent/20">
 <div className="flex items-start gap-3">
 <Database className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
 <div>
 <h3 className="text-sm font-semibold t-primary">GraphRAG Architecture</h3>
 <p className="text-xs t-muted mt-1">
 Atheon Memory uses Cloudflare D1 (SQLite at edge) for the graph adjacency model and Cloudflare Vectorize
 for semantic search with BGE-large-en-v1.5 embeddings (1024 dimensions). Hybrid retrieval combines vector
 similarity with structured graph traversal. Every fact carries a confidence score and source citation,
 ensuring full provenance from query to response.
 </p>
 <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-gray-400">
 <span className="px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">D1 Graph</span>
 <ArrowRight className="w-3 h-3 flex-shrink-0" />
 <span className="px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">Vectorize</span>
 <ArrowRight className="w-3 h-3 flex-shrink-0" />
 <span className="px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">Hybrid RAG</span>
 <ArrowRight className="w-3 h-3 flex-shrink-0" />
 <span className="px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">Citation Injection</span>
 </div>
 </div>
 </div>
 </Card>
 )}
 </div>
 );
}
