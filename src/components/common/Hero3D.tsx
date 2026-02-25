/**
 * Hero3D — Atheon glass-morphism 3D crystalline mark
 * Stunning animated SVG with glass reflections, orbital rings,
 * floating particles, and prismatic light effects.
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
      {/* Outer ambient glow */}
      <div className="absolute inset-0 animate-pulse-glow" style={{
        background: 'radial-gradient(ellipse at 50% 45%, rgb(var(--accent-rgb) / 0.25) 0%, rgba(139, 92, 246, 0.08) 40%, transparent 70%)',
        filter: 'blur(50px)',
      }} />

      {/* Secondary prismatic glow */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at 35% 55%, rgb(var(--accent-rgb) / 0.12) 0%, transparent 50%), radial-gradient(ellipse at 65% 40%, rgba(139, 92, 246, 0.10) 0%, transparent 50%)',
        filter: 'blur(30px)',
        animation: 'shimmer 4s ease-in-out infinite',
      }} />

      <div className="animate-float" style={{ transformStyle: 'preserve-3d' }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox={dimensions.vb} fill="none" width={dimensions.w} height={dimensions.h}>
          <defs>
            {/* Primary glass gradient */}
            <linearGradient id="h-glass1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.95" />
              <stop offset="40%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.75" />
              <stop offset="100%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.50" />
            </linearGradient>
            {/* Reflection highlight gradient */}
            <linearGradient id="h-reflect" x1="30%" y1="0%" x2="70%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
              <stop offset="50%" stopColor="#ffffff" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.02" />
            </linearGradient>
            {/* Orbital ring gradient */}
            <linearGradient id="h-ring" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0" />
              <stop offset="30%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.5" />
              <stop offset="70%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.3" />
              <stop offset="100%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0" />
            </linearGradient>
            {/* Radial glass fill */}
            <radialGradient id="h-radial" cx="50%" cy="40%" r="50%">
              <stop offset="0%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.20" />
              <stop offset="100%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.02" />
            </radialGradient>
            {/* Glass blur filter */}
            <filter id="h-glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <filter id="h-soft">
              <feGaussianBlur stdDeviation="1.5" />
            </filter>
            {/* Glass drop shadow */}
            <filter id="h-shadow">
              <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor="rgb(var(--accent-rgb))" floodOpacity="0.25" />
            </filter>
          </defs>

          {/* Background ambient circle */}
          <circle cx="200" cy="200" r="180" fill="url(#h-radial)" />

          {/* Outer orbital ring 1 */}
          <ellipse cx="200" cy="200" rx="170" ry="60" stroke="url(#h-ring)" strokeWidth="0.8" fill="none" opacity="0.4" transform="rotate(-15 200 200)">
            <animateTransform attributeName="transform" type="rotate" from="-15 200 200" to="345 200 200" dur="40s" repeatCount="indefinite" />
          </ellipse>
          {/* Outer orbital ring 2 */}
          <ellipse cx="200" cy="200" rx="155" ry="50" stroke="url(#h-ring)" strokeWidth="0.6" fill="none" opacity="0.3" transform="rotate(60 200 200)">
            <animateTransform attributeName="transform" type="rotate" from="60 200 200" to="-300 200 200" dur="35s" repeatCount="indefinite" />
          </ellipse>
          {/* Inner orbital ring 3 */}
          <ellipse cx="200" cy="200" rx="130" ry="42" stroke="url(#h-ring)" strokeWidth="0.5" fill="none" opacity="0.25" transform="rotate(120 200 200)">
            <animateTransform attributeName="transform" type="rotate" from="120 200 200" to="480 200 200" dur="25s" repeatCount="indefinite" />
          </ellipse>

          {/* Glass hexagonal frame */}
          <g filter="url(#h-shadow)">
            <path d="M200 55 L310 110 L310 285 L200 340 L90 285 L90 110 Z" fill="url(#h-glass1)" opacity="0.12" stroke="rgb(var(--accent-rgb) / 0.25)" strokeWidth="1" />
          </g>

          {/* Glass A letter */}
          <g filter="url(#h-glow)">
            <path d="M200 85 L125 305 h32 l18-42 h50 l18 42 h32 L200 85z M200 145 l30 80 h-60 l30-80z" fill="url(#h-glass1)" />
          </g>
          {/* Reflection overlay */}
          <path d="M200 85 L125 305 h32 l18-42 h50 l18 42 h32 L200 85z M200 145 l30 80 h-60 l30-80z" fill="url(#h-reflect)" />
          {/* Inner A glow stroke */}
          <path d="M200 85 L125 305 h32 l18-42 h50 l18 42 h32 L200 85z" fill="none" stroke="rgb(var(--accent-rgb) / 0.35)" strokeWidth="1.5" />

          {/* Prismatic light streak */}
          <rect x="130" y="195" width="140" height="2" rx="1" fill="white" opacity="0.15">
            <animate attributeName="opacity" values="0.05;0.20;0.05" dur="3s" repeatCount="indefinite" />
            <animate attributeName="y" values="190;200;190" dur="5s" repeatCount="indefinite" />
          </rect>

          {/* Floating orbital particles */}
          <circle r="3" fill="rgb(var(--accent-rgb))" opacity="0.7">
            <animateMotion dur="18s" repeatCount="indefinite" path="M200,30 A170,170 0 1,1 199,30 Z" />
            <animate attributeName="opacity" values="0.3;0.8;0.3" dur="3s" repeatCount="indefinite" />
          </circle>
          <circle r="2.5" fill="rgb(var(--accent-rgb))" opacity="0.6">
            <animateMotion dur="22s" repeatCount="indefinite" path="M370,200 A170,170 0 1,1 369,200 Z" />
            <animate attributeName="opacity" values="0.2;0.7;0.2" dur="4s" repeatCount="indefinite" />
          </circle>
          <circle r="2" fill="rgb(var(--accent-rgb))" opacity="0.5">
            <animateMotion dur="15s" repeatCount="indefinite" path="M200,370 A170,170 0 1,0 201,370 Z" />
            <animate attributeName="opacity" values="0.3;0.6;0.3" dur="2.5s" repeatCount="indefinite" />
          </circle>
          <circle r="1.5" fill="rgb(var(--accent-rgb))" opacity="0.5">
            <animateMotion dur="28s" repeatCount="indefinite" path="M30,200 A170,170 0 1,0 31,200 Z" />
          </circle>

          {/* Sparkle dots */}
          <circle cx="140" cy="120" r="1.5" fill="white" opacity="0.4">
            <animate attributeName="opacity" values="0.1;0.5;0.1" dur="2s" repeatCount="indefinite" />
          </circle>
          <circle cx="270" cy="150" r="1" fill="white" opacity="0.3">
            <animate attributeName="opacity" values="0.1;0.4;0.1" dur="3s" repeatCount="indefinite" begin="0.5s" />
          </circle>
          <circle cx="250" cy="300" r="1.2" fill="white" opacity="0.35">
            <animate attributeName="opacity" values="0.1;0.45;0.1" dur="2.5s" repeatCount="indefinite" begin="1s" />
          </circle>
          <circle cx="160" cy="280" r="1" fill="white" opacity="0.25">
            <animate attributeName="opacity" values="0.1;0.35;0.1" dur="3.5s" repeatCount="indefinite" begin="1.5s" />
          </circle>

          {/* Center glow sphere */}
          <circle cx="200" cy="190" r="35" fill="url(#h-radial)" opacity="0.15" filter="url(#h-soft)">
            <animate attributeName="r" values="32;38;32" dur="4s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>
    </div>
  );
}

export function AtheonTextMark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-bold tracking-tight ${className}`}
      style={{
        background: 'linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent-rgb) / 0.7))',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      A
    </span>
  );
}

export function AtheonLogoInline({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-bold tracking-tight ${className}`}
      style={{
        background: 'linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent-rgb) / 0.7))',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      A
    </span>
  );
}
