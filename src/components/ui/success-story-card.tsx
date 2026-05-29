/**
 * §11.6 Success Story Card — Anonymised peer insights
 */
import type { SuccessStory } from '@/lib/api';
import { CheckCircle2, Clock, Coins, Tag } from 'lucide-react';
import { StatusPill } from '@/components/ui/status-pill';

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R${(value / 1_000).toFixed(0)}k`;
  return `R${value.toFixed(0)}`;
}

export function SuccessStoryCard({ story }: { story: SuccessStory }) {
  const signature = story.patternSignature.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="rounded-md p-4 border border-[var(--border-card)]" style={{ background: 'var(--bg-card-solid)' }}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={14} className="text-[var(--accent)] flex-shrink-0" />
          <h4 className="text-xs font-semibold t-primary">{signature}</h4>
        </div>
        <StatusPill status="verified" label={`${story.resolutionCount} resolved`} size="sm" noGlyph />
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-caption t-secondary">
          <Clock size={10} className="t-muted" />
          <span>Avg {story.avgResolutionDays} days to resolve</span>
        </div>
        {story.avgValueRecovered > 0 && (
          <div className="flex items-center gap-1.5 text-caption t-secondary">
            <Coins size={10} className="text-[var(--accent)]" />
            <span>Avg {formatCurrency(story.avgValueRecovered)} recovered</span>
          </div>
        )}
      </div>

      {story.commonFixTypes.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <Tag size={10} className="t-muted flex-shrink-0" />
          {story.commonFixTypes.slice(0, 3).map((fix, i) => (
            <span key={i} className="text-caption px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] t-muted">
              {fix}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
