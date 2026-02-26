/**
 * Hero3D — Atheon bold geometric A with energy prism effects
 * Striking animated SVG with bold letterform, energy crossbar,
 * orbital rings, pulsing particles, and prismatic flare.
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
      {/* Outer ambient glow — stronger, more impactful */}
      <div className="absolute inset-0 animate-pulse-glow" style={{
        background: 'radial-gradient(ellipse at 50% 45%, rgb(var(--accent-rgb) / 0.35) 0%, rgba(78, 124, 246, 0.12) 35%, transparent 65%)',
        filter: 'blur(60px)',
      }} />

      {/* Secondary prismatic sweep */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at 40% 50%, rgb(var(--accent-rgb) / 0.15) 0%, transparent 50%), radial-gradient(ellipse at 60% 35%, rgba(41, 82, 204, 0.10) 0%, transparent 45%)',
        filter: 'blur(35px)',
        animation: 'shimmer 4s ease-in-out infinite',
      }} />

      <div className="animate-float" style={{ transformStyle: 'preserve-3d' }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox={dimensions.vb} fill="none" width={dimensions.w} height={dimensions.h}>
          <defs>
            {/* Bold primary gradient — deeper range */}
            <linearGradient id="h-bold" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7db4ff" stopOpacity="1" />
              <stop offset="40%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#2952cc" stopOpacity="0.85" />
            </linearGradient>
            {/* Bright reflection */}
            <linearGradient id="h-reflect" x1="30%" y1="0%" x2="70%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.50" />
              <stop offset="40%" stopColor="#ffffff" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.02" />
            </linearGradient>
            {/* Energy crossbar gradient */}
            <linearGradient id="h-energy" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#7db4ff" stopOpacity="0" />
              <stop offset="20%" stopColor="#7db4ff" stopOpacity="0.9" />
              <stop offset="50%" stopColor="#4e7cf6" stopOpacity="1" />
              <stop offset="80%" stopColor="#7db4ff" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#7db4ff" stopOpacity="0" />
            </linearGradient>
            {/* Orbital ring gradient */}
            <linearGradient id="h-ring" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0" />
              <stop offset="30%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.45" />
              <stop offset="70%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.25" />
              <stop offset="100%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0" />
            </linearGradient>
            {/* Radial ambient fill */}
            <radialGradient id="h-radial" cx="50%" cy="40%" r="50%">
              <stop offset="0%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.22" />
              <stop offset="100%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.02" />
            </radialGradient>
            {/* Glow filters */}
            <filter id="h-glow">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <filter id="h-soft">
              <feGaussianBlur stdDeviation="2" />
            </filter>
            <filter id="h-shadow">
              <feDropShadow dx="0" dy="6" stdDeviation="12" floodColor="rgb(var(--accent-rgb))" floodOpacity="0.35" />
            </filter>
            <filter id="h-flare">
              <feGaussianBlur stdDeviation="6" />
            </filter>
          </defs>

          {/* Background ambient circle */}
          <circle cx="200" cy="200" r="185" fill="url(#h-radial)" />

          {/* Outer orbital ring 1 */}
          <ellipse cx="200" cy="200" rx="175" ry="58" stroke="url(#h-ring)" strokeWidth="1" fill="none" opacity="0.35" transform="rotate(-15 200 200)">
            <animateTransform attributeName="transform" type="rotate" from="-15 200 200" to="345 200 200" dur="40s" repeatCount="indefinite" />
          </ellipse>
          {/* Outer orbital ring 2 */}
          <ellipse cx="200" cy="200" rx="160" ry="48" stroke="url(#h-ring)" strokeWidth="0.8" fill="none" opacity="0.25" transform="rotate(65 200 200)">
            <animateTransform attributeName="transform" type="rotate" from="65 200 200" to="-295 200 200" dur="32s" repeatCount="indefinite" />
          </ellipse>
          {/* Inner orbital ring 3 */}
          <ellipse cx="200" cy="200" rx="135" ry="40" stroke="url(#h-ring)" strokeWidth="0.6" fill="none" opacity="0.20" transform="rotate(120 200 200)">
            <animateTransform attributeName="transform" type="rotate" from="120 200 200" to="480 200 200" dur="22s" repeatCount="indefinite" />
          </ellipse>

          {/* Diamond shield frame behind A */}
          <g filter="url(#h-shadow)">
            <path d="M200 50 L320 115 L320 290 L200 350 L80 290 L80 115 Z" fill="url(#h-bold)" opacity="0.08" stroke="rgb(var(--accent-rgb) / 0.18)" strokeWidth="1" />
          </g>

          {/* Outer A glow (larger, blurred behind) */}
          <path d="M200 75 L110 320 h40 l20-48 h60 l20 48 h40 Z" fill="rgb(var(--accent-rgb))" opacity="0.12" filter="url(#h-flare)" />

          {/* Bold A letterform — thicker, more imposing */}
          <g filter="url(#h-glow)">
            <path d="M200 80 L115 315 h38 l22-52 h50 l22 52 h38 Z M200 148 l32 78 h-64 Z" fill="url(#h-bold)" />
          </g>
          {/* Glass reflection overlay */}
          <path d="M200 80 L115 315 h38 l22-52 h25 L200 148 Z" fill="url(#h-reflect)" />
          {/* A outline stroke for definition */}
          <path d="M200 80 L115 315 h38 l22-52 h50 l22 52 h38 Z" fill="none" stroke="rgb(var(--accent-rgb) / 0.30)" strokeWidth="1.5" />

          {/* Energy crossbar — bold glowing bar through the A */}
          <rect x="130" y="222" width="140" height="5" rx="2.5" fill="url(#h-energy)" opacity="0.7">
            <animate attributeName="opacity" values="0.5;0.85;0.5" dur="3s" repeatCount="indefinite" />
          </rect>
          {/* Secondary subtle crossbar pulse */}
          <rect x="145" y="223" width="110" height="3" rx="1.5" fill="#7db4ff" opacity="0.15" filter="url(#h-soft)">
            <animate attributeName="opacity" values="0.08;0.25;0.08" dur="2.5s" repeatCount="indefinite" />
          </rect>

          {/* Top prism flare — bright point at apex */}
          <circle cx="200" cy="78" r="6" fill="#7db4ff" opacity="0.9">
            <animate attributeName="r" values="5;8;5" dur="3s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.6;1;0.6" dur="3s" repeatCount="indefinite" />
          </circle>
          <circle cx="200" cy="78" r="16" fill="#7db4ff" opacity="0.12" filter="url(#h-soft)">
            <animate attributeName="r" values="14;20;14" dur="3s" repeatCount="indefinite" />
          </circle>

          {/* Floating orbital particles — bolder */}
          <circle r="4" fill="rgb(var(--accent-rgb))" opacity="0.8">
            <animateMotion dur="16s" repeatCount="indefinite" path="M200,25 A175,175 0 1,1 199,25 Z" />
            <animate attributeName="opacity" values="0.4;0.9;0.4" dur="3s" repeatCount="indefinite" />
          </circle>
          <circle r="3" fill="rgb(var(--accent-rgb))" opacity="0.65">
            <animateMotion dur="20s" repeatCount="indefinite" path="M375,200 A175,175 0 1,1 374,200 Z" />
            <animate attributeName="opacity" values="0.3;0.75;0.3" dur="4s" repeatCount="indefinite" />
          </circle>
          <circle r="2.5" fill="#7db4ff" opacity="0.6">
            <animateMotion dur="14s" repeatCount="indefinite" path="M200,375 A175,175 0 1,0 201,375 Z" />
            <animate attributeName="opacity" values="0.3;0.7;0.3" dur="2.5s" repeatCount="indefinite" />
          </circle>
          <circle r="2" fill="rgb(var(--accent-rgb))" opacity="0.5">
            <animateMotion dur="26s" repeatCount="indefinite" path="M25,200 A175,175 0 1,0 26,200 Z" />
          </circle>

          {/* Sparkle accents — bigger and brighter */}
          <circle cx="130" cy="115" r="2" fill="white" opacity="0.5">
            <animate attributeName="opacity" values="0.15;0.6;0.15" dur="2s" repeatCount="indefinite" />
          </circle>
          <circle cx="280" cy="140" r="1.5" fill="white" opacity="0.4">
            <animate attributeName="opacity" values="0.1;0.5;0.1" dur="3s" repeatCount="indefinite" begin="0.5s" />
          </circle>
          <circle cx="260" cy="310" r="1.8" fill="white" opacity="0.4">
            <animate attributeName="opacity" values="0.1;0.5;0.1" dur="2.5s" repeatCount="indefinite" begin="1s" />
          </circle>
          <circle cx="150" cy="290" r="1.3" fill="white" opacity="0.3">
            <animate attributeName="opacity" values="0.1;0.4;0.1" dur="3.5s" repeatCount="indefinite" begin="1.5s" />
          </circle>

          {/* Center energy sphere — brighter */}
          <circle cx="200" cy="195" r="40" fill="url(#h-radial)" opacity="0.18" filter="url(#h-soft)">
            <animate attributeName="r" values="36;44;36" dur="4s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>
    </div>
  );
}

export function AtheonTextMark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-extrabold tracking-tighter ${className}`}
      style={{
        background: 'linear-gradient(135deg, #7db4ff 0%, rgb(var(--accent-rgb)) 50%, #2952cc 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        fontFamily: "'Inter', system-ui, sans-serif",
        letterSpacing: '-0.04em',
      }}
    >
      A
    </span>
  );
}

export function AtheonLogoInline({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-extrabold tracking-tighter ${className}`}
      style={{
        background: 'linear-gradient(135deg, #7db4ff 0%, rgb(var(--accent-rgb)) 50%, #2952cc 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        fontFamily: "'Inter', system-ui, sans-serif",
        letterSpacing: '-0.04em',
      }}
    >
      A
    </span>
  );
}
