import { cn } from "@/lib/utils";

interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}

/** Swiss sparkline: a 2px accent stroke over a hairline baseline, terminated
 *  by a solid end-dot marking the latest value. No gradient fills — the line
 *  is the data. */
export function Sparkline({ data, color = 'var(--accent)', width = 80, height = 24, className }: SparklineProps) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const coords = data.map((value, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - ((value - min) / range) * (height - 4) - 2,
  }));

  const points = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const end = coords[coords.length - 1];

  return (
    <svg width={width} height={height} className={cn('inline-block', className)}>
      <line
        x1="0" y1={height - 1} x2={width} y2={height - 1}
        stroke="var(--border-card)" strokeWidth="1"
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={end.x} cy={end.y} r="2" fill={color} />
    </svg>
  );
}
