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
  sm: { width: 60, stroke: 4, fontSize: 'text-sm', r: 24 },
  md: { width: 80, stroke: 5, fontSize: 'text-lg', r: 32 },
  lg: { width: 120, stroke: 6, fontSize: 'text-2xl', r: 48 },
  xl: { width: 160, stroke: 8, fontSize: 'text-4xl', r: 64 },
};

function getScoreColor(score: number): string {
  if (score >= 80) return '#10b981';
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
            stroke="rgb(229, 231, 235)"
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
            style={{ filter: `drop-shadow(0 0 6px ${color}40)` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('font-bold text-gray-900', config.fontSize)}>{score}</span>
        </div>
      </div>
            {label && <span className="mt-2 text-sm font-medium text-gray-700">{label}</span>}
            {sublabel && <span className="text-xs text-gray-500">{sublabel}</span>}
    </div>
  );
}
