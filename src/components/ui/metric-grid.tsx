/**
 * `<MetricGrid>` — a row of figures divided by hairline rules.
 *
 *   KEY            KEY            KEY
 *   42.1M  ↑ 3.2   18 days        96%
 *   sub            sub            sub
 *
 * The Swiss data band: Archivo-800 tabular figures, letterspaced muted
 * keys, vertical hairlines between cells. Deltas follow the two-tier rule —
 * a positive delta reads in the ledger accent, a negative in the reserved
 * negative; zero stays muted. A `lead` cell widens and renders its figure
 * in the accent to anchor the row.
 */
import { cn } from "@/lib/utils";
import type { ReactNode } from 'react';

export interface MetricCell {
  /** Key / label above the figure. */
  k: string;
  /** The figure. */
  value: ReactNode;
  /** Optional supporting line below the figure. */
  sub?: string;
  /** Signed delta — sign drives colour (accent up / neg down / muted zero). */
  delta?: number;
  /** Anchor cell — widens and tints the figure with the accent. */
  lead?: boolean;
}

interface MetricGridProps {
  cells: MetricCell[];
  className?: string;
}

function deltaColor(delta: number): string {
  if (delta > 0) return 'var(--accent)';
  if (delta < 0) return 'var(--neg)';
  return 'var(--text-muted)';
}

export function MetricGrid({ cells, className }: MetricGridProps) {
  return (
    <div className={cn('flex flex-wrap', className)}>
      {cells.map((c, i) => (
        <div
          key={i}
          className={cn(
            'px-5 first:pl-0',
            i > 0 && 'border-l',
            c.lead ? 'flex-[1.5]' : 'flex-1'
          )}
          style={i > 0 ? { borderColor: 'var(--border-card)' } : undefined}
        >
          <p className="text-caption t-muted uppercase">{c.k}</p>
          <div className="flex items-baseline gap-2 mt-1.5">
            <span
              className={cn('tnum leading-none', c.lead ? 'text-figure-lg' : 'text-figure')}
              style={c.lead ? { color: 'var(--accent)' } : { color: 'var(--text-primary)' }}
            >
              {c.value}
            </span>
            {c.delta !== undefined && (
              <span
                className="text-caption tnum font-medium"
                style={{ color: deltaColor(c.delta) }}
              >
                {c.delta > 0 ? '↑' : c.delta < 0 ? '↓' : '·'} {Math.abs(c.delta)}
              </span>
            )}
          </div>
          {c.sub && <p className="text-caption t-muted mt-1">{c.sub}</p>}
        </div>
      ))}
    </div>
  );
}
