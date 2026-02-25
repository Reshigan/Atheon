/**
 * Hero3D — Atheon enterprise geometric mark
 * Clean, sophisticated SVG with subtle animation.
 */

interface Hero3DProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Hero3D({ size = 'lg', className = '' }: Hero3DProps) {
  const dimensions = {
    sm: { w: 200, h: 200, vb: '0 0 400 400' },
    md: { w: 360, h: 360, vb: '0 0 400 400' },
    lg: { w: 520, h: 520, vb: '0 0 400 400' },
  }[size];

  return (
    <div className={`relative ${className}`} style={{ width: dimensions.w, height: dimensions.h }}>
      <div className="absolute inset-0 animate-pulse-glow" style={{ background: 'radial-gradient(ellipse at 50% 50%, var(--accent-glow) 0%, transparent 70%)', filter: 'blur(40px)' }} />
      <div className="animate-float" style={{ transformStyle: 'preserve-3d' }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox={dimensions.vb} fill="none" width={dimensions.w} height={dimensions.h}>
          <defs>
            <linearGradient id="h-grad1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.9" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.3" />
            </linearGradient>
            <linearGradient id="h-grad2" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.6" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.15" />
            </linearGradient>
            <linearGradient id="h-grad3" x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* Outer ring */}
          <circle cx="200" cy="200" r="160" stroke="url(#h-grad3)" strokeWidth="1" fill="none" opacity="0.5">
            <animateTransform attributeName="transform" type="rotate" from="0 200 200" to="360 200 200" dur="60s" repeatCount="indefinite" />
          </circle>
          <circle cx="200" cy="200" r="130" stroke="url(#h-grad3)" strokeWidth="0.5" fill="none" opacity="0.3">
            <animateTransform attributeName="transform" type="rotate" from="360 200 200" to="0 200 200" dur="45s" repeatCount="indefinite" />
          </circle>

          {/* Geometric A shape */}
          <g opacity="0.85">
            <path d="M200 80L120 300h30l15-35h70l15 35h30L200 80zm0 50l25 100h-50l25-100z" fill="url(#h-grad1)" />
          </g>

          {/* Orbital dots */}
          <circle cx="200" cy="40" r="3" fill="var(--accent)" opacity="0.6">
            <animateTransform attributeName="transform" type="rotate" from="0 200 200" to="360 200 200" dur="20s" repeatCount="indefinite" />
          </circle>
          <circle cx="360" cy="200" r="2" fill="var(--accent)" opacity="0.4">
            <animateTransform attributeName="transform" type="rotate" from="120 200 200" to="480 200 200" dur="25s" repeatCount="indefinite" />
          </circle>
          <circle cx="200" cy="360" r="2.5" fill="var(--accent)" opacity="0.5">
            <animateTransform attributeName="transform" type="rotate" from="240 200 200" to="600 200 200" dur="30s" repeatCount="indefinite" />
          </circle>

          {/* Inner glow */}
          <circle cx="200" cy="180" r="40" fill="var(--accent)" opacity="0.04" />
        </svg>
      </div>
    </div>
  );
}

export function AtheonTextMark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-bold tracking-tight ${className}`}
      style={{ color: 'var(--accent)', fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      A
    </span>
  );
}

export function AtheonLogoInline({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-bold tracking-tight ${className}`}
      style={{ color: 'var(--accent)', fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      A
    </span>
  );
}
