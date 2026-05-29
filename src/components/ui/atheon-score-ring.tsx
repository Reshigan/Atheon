/**
 * §11.7 Atheon Score Ring — Composite score visualization
 * Displays the Atheon Score as a circular ring with component breakdown
 */
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import type { AtheonScoreResponse } from '@/lib/api';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

function ScoreRingVisual({ score, size = 120 }: { score: number; size?: number }) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color = score >= 75 ? 'var(--accent)' : score >= 50 ? 'var(--warning)' : 'var(--neg)';

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border-card)" strokeWidth="8" />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference - progress}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold t-primary">{score}</span>
        <span className="text-caption t-muted uppercase tracking-wider">Atheon</span>
      </div>
    </div>
  );
}

export function AtheonScoreRing({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<AtheonScoreResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.atheonScore.get()
      .then(setData)
      .catch(() => { /* non-critical — ring stays hidden */ })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="w-16 h-16 rounded-full border-4 border-[var(--border-card)] animate-pulse" />
      </div>
    );
  }

  if (!data) return null;

  const trend = data.trend.length >= 2 ? data.trend[data.trend.length - 1].score - data.trend[data.trend.length - 2].score : 0;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <ScoreRingVisual score={data.score} size={48} />
        <div>
          <p className="text-xs font-semibold t-primary">{data.score}/100</p>
          <div className="flex items-center gap-1">
            {trend > 0 ? <TrendingUp className="w-3 h-3 text-emerald-500" /> : trend < 0 ? <TrendingDown className="w-3 h-3 text-red-500" /> : <Minus className="w-3 h-3 text-gray-400" />}
            <span className="text-caption t-muted">{trend > 0 ? '+' : ''}{trend}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <ScoreRingVisual score={data.score} />
        <div className="flex-1 space-y-1.5">
          {data.components.map((c) => (
            <div key={c.name} className="flex items-center gap-2">
              <span className="text-caption t-muted w-24 truncate">{c.name}</span>
              <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-secondary)]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${c.score}%`, background: c.score >= 75 ? 'var(--accent)' : c.score >= 50 ? 'var(--warning)' : 'var(--neg)' }}
                />
              </div>
              <span className="text-caption font-medium t-primary w-8 text-right">{c.score}</span>
            </div>
          ))}
        </div>
      </div>
      {data.industryAvg !== null && (
        <p className="text-caption t-muted text-center">
          Industry avg: {data.industryAvg} | Your score: {data.score > data.industryAvg ? 'above' : data.score < data.industryAvg ? 'below' : 'at'} average
        </p>
      )}
    </div>
  );
}
