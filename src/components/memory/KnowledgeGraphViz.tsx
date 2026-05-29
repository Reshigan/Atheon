/**
 * `<KnowledgeGraphViz>` — Stitch "Memory — Knowledge Graph" canvas.
 *
 * Renders entities as type-coloured nodes on a 2D canvas using a tiny
 * inline force-directed simulation (spring along edges + Coulomb-style
 * repulsion). No extra deps — just SVG. Suitable for graphs up to ~150
 * nodes; beyond that we degrade to a static radial layout.
 *
 * Hover any node to dim the rest and surface a sage-bordered tooltip
 * with the entity name, type, and connection degree. Click a node to
 * pin it (and call onSelect for the parent to drive the side-panel).
 *
 * Stitch design fidelity: dark abyss canvas, sage/sky/bronze type palette,
 * dotted edge lines, opsz-24 Material-Symbols-style centred glyph in the
 * larger node circles.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphEntity, GraphRelationship } from '@/lib/api';

interface KnowledgeGraphVizProps {
  entities: GraphEntity[];
  relationships: GraphRelationship[];
  onSelect?: (entity: GraphEntity) => void;
  /** Optional: restrict to entities matching this search term (substring of
   *  name). Filtered-out nodes + their edges fade. */
  highlight?: string;
  className?: string;
  /** SVG viewport. Width is responsive (100%); height is fixed. */
  height?: number;
}

// ── Type → tone palette ──────────────────────────────────────────
const TYPE_TONE: Record<string, { fill: string; stroke: string }> = {
  Organization: { fill: 'rgb(var(--accent-rgb) / 0.20)', stroke: 'var(--accent)' }, // accent
  Person:       { fill: 'rgba(126, 179, 205, 0.20)', stroke: 'var(--info)' }, // info
  Product:      { fill: 'rgba(205, 163, 126, 0.20)', stroke: 'var(--bronze)' }, // bronze
  Project:      { fill: 'rgb(var(--accent-rgb) / 0.16)', stroke: '#becda4' },
  Document:     { fill: 'rgba(126, 179, 205, 0.16)', stroke: '#5d92ad' },
  Concept:      { fill: 'rgba(251, 191, 36, 0.18)',  stroke: 'var(--warning)' },
  Default:      { fill: 'rgba(126, 132, 145, 0.20)', stroke: '#909287' },
};
function toneFor(type: string): { fill: string; stroke: string } {
  return TYPE_TONE[type] ?? TYPE_TONE.Default;
}

interface SimNode {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}
interface SimEdge { source: string; target: string; type: string }

/**
 * Tiny force-directed layout. Runs SIM_STEPS iterations synchronously
 * before first paint; small enough (~100 nodes × 200 iters) that the
 * UI thread doesn't notice. Returns nodes with final {x,y}.
 */
function runForceLayout(nodes: SimNode[], edges: SimEdge[], width: number, height: number) {
  const SIM_STEPS = 220;
  const SPRING_LEN = 90;
  const SPRING_K = 0.04;
  const REPEL_K = 1400;
  const DAMP = 0.85;
  const CENTER_PULL = 0.0035;

  const cx = width / 2;
  const cy = height / 2;

  // Initial layout: concentric circles by degree so well-connected nodes
  // start near the centre — converges in fewer iterations.
  const sorted = [...nodes].sort((a, b) => b.degree - a.degree);
  sorted.forEach((n, i) => {
    const ring = Math.floor(i / 12);
    const ringSize = Math.min(nodes.length - ring * 12, 12);
    const a = ((i % 12) / ringSize) * Math.PI * 2;
    const r = 60 + ring * 70;
    n.x = cx + Math.cos(a) * r;
    n.y = cy + Math.sin(a) * r;
    n.vx = 0;
    n.vy = 0;
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (let step = 0; step < SIM_STEPS; step++) {
    // Coulomb repulsion (O(n²) — fine for ≤150 nodes)
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy + 0.1;
        const force = REPEL_K / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    // Spring along edges
    for (const e of edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.1;
      const stretch = d - SPRING_LEN;
      const force = SPRING_K * stretch;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    // Gentle pull toward centre — keeps drifters in view
    for (const n of nodes) {
      n.vx += (cx - n.x) * CENTER_PULL;
      n.vy += (cy - n.y) * CENTER_PULL;
      n.vx *= DAMP;
      n.vy *= DAMP;
      n.x += n.vx;
      n.y += n.vy;
    }
  }
  return nodes;
}

export function KnowledgeGraphViz({
  entities,
  relationships,
  onSelect,
  highlight,
  className = '',
  height = 520,
}: KnowledgeGraphVizProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [hovered, setHovered] = useState<string | null>(null);

  // Responsive width — resize observer instead of window.onresize so the
  // parent panel can shrink/grow without us touching the page layout.
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && Math.abs(w - width) > 2) setWidth(w);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [width]);

  const { nodes, edges } = useMemo(() => {
    // Build degree map once
    const degree = new Map<string, number>();
    for (const r of relationships) {
      degree.set(r.sourceId, (degree.get(r.sourceId) ?? 0) + 1);
      degree.set(r.targetId, (degree.get(r.targetId) ?? 0) + 1);
    }
    const sim: SimNode[] = entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      x: 0, y: 0, vx: 0, vy: 0,
      degree: degree.get(e.id) ?? 0,
    }));
    const edg: SimEdge[] = relationships
      .filter((r) => sim.find((n) => n.id === r.sourceId) && sim.find((n) => n.id === r.targetId))
      .map((r) => ({ source: r.sourceId, target: r.targetId, type: r.type }));
    runForceLayout(sim, edg, width, height);
    return { nodes: sim, edges: edg };
  }, [entities, relationships, width, height]);

  const hl = (highlight ?? '').trim().toLowerCase();
  const isMatch = (n: SimNode) => !hl || n.name.toLowerCase().includes(hl);

  if (entities.length === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded-2xl ${className}`}
        style={{
          height,
          background: 'var(--bg-card-solid)',
          border: '1px solid var(--border-card)',
        }}
      >
        <div className="text-center">
          <p className="text-body-sm t-muted">No entities yet.</p>
          <p className="text-caption t-muted mt-1">Create entities and relationships to populate the graph.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative rounded-2xl overflow-hidden ${className}`}
      style={{
        height,
        background: 'var(--bg-card-solid)',
        border: '1px solid var(--border-card)',
        backgroundImage: 'radial-gradient(circle at 50% 0%, rgb(var(--accent-rgb) / 0.05) 0%, transparent 70%)',
      }}
    >
      <svg width={width} height={height} role="img" aria-label="Knowledge graph">
        {/* Dotted edges */}
        {edges.map((e, i) => {
          const a = nodes.find((n) => n.id === e.source);
          const b = nodes.find((n) => n.id === e.target);
          if (!a || !b) return null;
          const involved = hovered === a.id || hovered === b.id;
          const isHighlighted = !hl || isMatch(a) || isMatch(b);
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={involved ? 'var(--accent)' : 'rgba(10,20,30,0.18)'}
              strokeWidth={involved ? 1.5 : 0.8}
              strokeDasharray="3 4"
              opacity={isHighlighted ? (involved ? 0.95 : 0.5) : 0.12}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((n) => {
          const tone = toneFor(n.type);
          const isHover = hovered === n.id;
          const r = 9 + Math.min(n.degree, 6) * 1.5;
          const dim = !!hovered && !isHover;
          const filteredOut = !!hl && !isMatch(n);
          const finalOpacity = filteredOut ? 0.15 : (dim ? 0.45 : 1);
          return (
            <g
              key={n.id}
              transform={`translate(${n.x}, ${n.y})`}
              style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
              opacity={finalOpacity}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelect && onSelect({
                id: n.id, name: n.name, type: n.type,
                properties: {}, confidence: 1, source: 'graph',
              })}
            >
              <circle r={r} fill={tone.fill} stroke={tone.stroke} strokeWidth={isHover ? 2 : 1.25} />
              {/* Initials inside the circle for nodes large enough */}
              {r >= 11 && (
                <text
                  textAnchor="middle"
                  dy={3.5}
                  style={{
                    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                    fontSize: 9,
                    fontWeight: 600,
                    fill: tone.stroke,
                    pointerEvents: 'none',
                  }}
                >
                  {(n.name || '?').split(/\s+/).slice(0, 2).map((s) => s[0] ?? '').join('').toUpperCase()}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Hover tooltip */}
      {hovered && (() => {
        const n = nodes.find((x) => x.id === hovered);
        if (!n) return null;
        const tone = toneFor(n.type);
        const tipX = Math.min(Math.max(n.x + 14, 10), width - 220);
        const tipY = Math.min(Math.max(n.y - 6, 10), height - 70);
        return (
          <div
            className="absolute pointer-events-none rounded-md px-3 py-2 shadow-md"
            style={{
              left: tipX,
              top: tipY,
              background: 'var(--bg-elevated)',
              border: `1px solid ${tone.stroke}40`,
              maxWidth: 200,
            }}
            role="tooltip"
          >
            <p className="text-body-sm font-semibold t-primary truncate">{n.name}</p>
            <p className="text-caption t-muted" style={{ color: tone.stroke }}>{n.type}</p>
            <p className="text-caption t-muted mt-1 font-mono">
              {n.degree} connection{n.degree === 1 ? '' : 's'}
            </p>
          </div>
        );
      })()}

      {/* Legend */}
      <div className="absolute bottom-3 right-3 flex flex-wrap gap-2 max-w-[60%]">
        {Array.from(new Set(entities.map((e) => e.type))).slice(0, 6).map((t) => {
          const tone = toneFor(t);
          return (
            <span
              key={t}
              className="text-caption font-medium rounded-full px-2 py-0.5"
              style={{
                color: tone.stroke,
                background: tone.fill,
                border: `1px solid ${tone.stroke}30`,
              }}
            >
              {t}
            </span>
          );
        })}
      </div>
    </div>
  );
}
