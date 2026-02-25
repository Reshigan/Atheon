import { cn } from "@/lib/utils";

interface ScoreRingProps {
  score: number;
  maxScore?: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  label?: string;
  sublabel?: string;
  className?: string;
}

const sizeConfig = {
  sm: { width: 56, stroke: 3, fontSize: 'text-xs', r: 22 },
  md: { width: 72, stroke: 4, fontSize: 'text-sm', r: 28 },
  lg: { width: 100, stroke: 5, fontSize: 'text-xl', r: 40 },
  xl: { width: 140, stroke: 6, fontSize: 'text-3xl', r: 56 },
};

function getScoreColor(score: number): string {
  if (score >= 80) return 'var(--accent)';
  if (score >= 60) return '#f59e0b';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

export function ScoreRing({ score, maxScore = 100, size = 'lg', label, sublabel, className }: ScoreRingProps) {
  const config = sizeConfig[size];
  const circumference = 2 * Math.PI * config.r;
  const percentage = (score / maxScore) * 100;
  const offset = circumference - (percentage / 100) * circumference;
  const color = getScoreColor(score);
  const center = config.width / 2;

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <div className="relative" style={{ width: config.width, height: config.width }}>
        <svg width={config.width} height={config.width} className="-rotate-90">
          <circle
            cx={center}
            cy={center}
            r={config.r}
            fill="none"
            stroke="var(--bg-secondary)"
            strokeWidth={config.stroke}
          />
          <circle
            cx={center}
            cy={center}
            r={config.r}
            fill="none"
            stroke={color}
            strokeWidth={config.stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('font-semibold t-primary', config.fontSize)}>{score}</span>
        </div>
      </div>
      {label && <span className="mt-1.5 text-xs font-medium t-secondary">{label}</span>}
      {sublabel && <span className="text-[10px] t-muted">{sublabel}</span>}
    </div>
  );
}
