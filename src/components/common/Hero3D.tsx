/**
 * Hero3D — Atheon Neural Nexus visualization
 * A futuristic singularity/nexus core with converging energy arcs,
 * holographic rings, neural pathways, and particle halos.
 * Pure SVG + CSS animations, no external dependencies.
 */

interface Hero3DProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Hero3D({ size = 'lg', className = '' }: Hero3DProps) {
  const dimensions = {
    sm: { w: 200, h: 200, viewBox: '0 0 400 400' },
    md: { w: 320, h: 320, viewBox: '0 0 400 400' },
    lg: { w: 440, h: 440, viewBox: '0 0 400 400' },
  }[size];

  return (
    <div className={`relative ${className}`} style={{ width: dimensions.w, height: dimensions.h }}>
      {/* Ambient glow behind the shape */}
      <div
        className="absolute inset-0 animate-pulse-glow"
        style={{
          background: 'radial-gradient(circle at 50% 50%, rgba(245,197,66,0.3) 0%, rgba(249,115,22,0.12) 35%, transparent 65%)',
          filter: 'blur(30px)',
        }}
      />

      {/* Main 3D rotating container */}
      <div className="animate-hero-rotate" style={{ transformStyle: 'preserve-3d' }}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox={dimensions.viewBox}
          fill="none"
          width={dimensions.w}
          height={dimensions.h}
          style={{ filter: 'drop-shadow(0 20px 60px rgba(245,197,66,0.3))' }}
        >
          <defs>
            {/* Core radial gradient */}
            <radialGradient id="nx-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="white" stopOpacity="1" />
              <stop offset="15%" stopColor="#fde68a" stopOpacity="0.9" />
              <stop offset="40%" stopColor="#f5c542" stopOpacity="0.5" />
              <stop offset="70%" stopColor="#b45309" stopOpacity="0.15" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            <radialGradient id="nx-inner-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.8" />
              <stop offset="30%" stopColor="#fbbf24" stopOpacity="0.4" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            <radialGradient id="nx-ambient" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f5c542" stopOpacity="0.2" />
              <stop offset="50%" stopColor="#f97316" stopOpacity="0.08" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            {/* Energy arc gradients */}
            <linearGradient id="nx-arc-cyan" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f5c542" stopOpacity="0" />
              <stop offset="30%" stopColor="#f5c542" stopOpacity="0.7" />
              <stop offset="50%" stopColor="#fbbf24" stopOpacity="0.9" />
              <stop offset="70%" stopColor="#f5c542" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#f5c542" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="nx-arc-indigo" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f97316" stopOpacity="0" />
              <stop offset="30%" stopColor="#f97316" stopOpacity="0.6" />
              <stop offset="50%" stopColor="#fb923c" stopOpacity="0.8" />
              <stop offset="70%" stopColor="#f97316" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="nx-arc-teal" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0" />
              <stop offset="30%" stopColor="#ef4444" stopOpacity="0.5" />
              <stop offset="50%" stopColor="#f87171" stopOpacity="0.7" />
              <stop offset="70%" stopColor="#ef4444" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
            </linearGradient>
            {/* Ring gradients */}
            <linearGradient id="nx-ring1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f5c542" stopOpacity="0" />
              <stop offset="25%" stopColor="#f5c542" stopOpacity="0.5" />
              <stop offset="50%" stopColor="#fbbf24" stopOpacity="0.8" />
              <stop offset="75%" stopColor="#f5c542" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#f5c542" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="nx-ring2" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f97316" stopOpacity="0" />
              <stop offset="25%" stopColor="#f97316" stopOpacity="0.4" />
              <stop offset="50%" stopColor="#fb923c" stopOpacity="0.6" />
              <stop offset="75%" stopColor="#f97316" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="nx-ring3" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0" />
              <stop offset="30%" stopColor="#ef4444" stopOpacity="0.3" />
              <stop offset="50%" stopColor="#f87171" stopOpacity="0.5" />
              <stop offset="70%" stopColor="#ef4444" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
            </linearGradient>
            {/* Particle glow */}
            <radialGradient id="nx-particle" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="white" stopOpacity="1" />
              <stop offset="40%" stopColor="#fbbf24" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#f5c542" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="nx-particle-indigo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="white" stopOpacity="0.9" />
              <stop offset="40%" stopColor="#fb923c" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
            </radialGradient>
            {/* Hexagonal shield gradient */}
            <linearGradient id="nx-hex" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f5c542" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0.08" />
            </linearGradient>
            {/* Filters */}
            <filter id="nx-blur-sm"><feGaussianBlur stdDeviation="2" /></filter>
            <filter id="nx-blur-md"><feGaussianBlur stdDeviation="4" /></filter>
            <filter id="nx-glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="nx-glow-strong">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* ── Ambient background field ── */}
          <circle cx="200" cy="200" r="180" fill="url(#nx-ambient)" className="animate-pulse-glow" />

          {/* ── Outer hexagonal shield ── */}
          <polygon points="200,40 340,110 340,290 200,360 60,290 60,110" fill="none" stroke="#f5c542" strokeWidth="0.5" opacity="0.12" strokeDasharray="6 8" />
          <polygon points="200,60 320,120 320,280 200,340 80,280 80,120" fill="url(#nx-hex)" stroke="#f97316" strokeWidth="0.3" opacity="0.08" />

          {/* ── Outer orbital ring 1 (cyan) ── */}
          <g className="animate-orbit" style={{ transformOrigin: '200px 200px' }}>
            <ellipse cx="200" cy="200" rx="170" ry="50" fill="none" stroke="url(#nx-ring1)" strokeWidth="1.2" transform="rotate(-20 200 200)" />
            <circle cx="370" cy="200" r="4" fill="white" opacity="0.95" filter="url(#nx-glow)" transform="rotate(-20 200 200)">
              <animateTransform attributeName="transform" type="rotate" from="-20 200 200" to="340 200 200" dur="18s" repeatCount="indefinite" additive="replace" />
            </circle>
          </g>

          {/* ── Outer orbital ring 2 (indigo) ── */}
          <g className="animate-orbit-reverse" style={{ transformOrigin: '200px 200px' }}>
            <ellipse cx="200" cy="200" rx="145" ry="42" fill="none" stroke="url(#nx-ring2)" strokeWidth="1" transform="rotate(35 200 200)" />
            <circle cx="345" cy="200" r="3.5" fill="#fb923c" opacity="0.9" filter="url(#nx-glow)" transform="rotate(35 200 200)">
              <animateTransform attributeName="transform" type="rotate" from="395 200 200" to="35 200 200" dur="22s" repeatCount="indefinite" additive="replace" />
            </circle>
          </g>

          {/* ── Inner orbital ring 3 (teal) ── */}
          <g className="animate-orbit" style={{ transformOrigin: '200px 200px', animationDuration: '30s' }}>
            <ellipse cx="200" cy="200" rx="110" ry="32" fill="none" stroke="url(#nx-ring3)" strokeWidth="0.8" transform="rotate(-55 200 200)" />
          </g>

          {/* ── Dashed tech ring ── */}
          <ellipse cx="200" cy="200" rx="85" ry="85" fill="none" stroke="#f5c542" strokeWidth="0.4" opacity="0.15" strokeDasharray="4 6" className="animate-orbit-reverse" style={{ transformOrigin: '200px 200px', animationDuration: '40s' }} />

          {/* ── Neural pathways converging to center ── */}
          <g opacity="0.4" className="animate-shimmer">
            <path d="M 200 60 Q 180 130 200 200" stroke="url(#nx-arc-cyan)" strokeWidth="1.5" fill="none" />
            <path d="M 200 340 Q 220 270 200 200" stroke="url(#nx-arc-cyan)" strokeWidth="1.5" fill="none" />
            <path d="M 60 200 Q 130 180 200 200" stroke="url(#nx-arc-cyan)" strokeWidth="1.5" fill="none" />
            <path d="M 340 200 Q 270 220 200 200" stroke="url(#nx-arc-cyan)" strokeWidth="1.5" fill="none" />
            <path d="M 90 90 Q 150 140 200 200" stroke="url(#nx-arc-indigo)" strokeWidth="1.2" fill="none" />
            <path d="M 310 310 Q 250 260 200 200" stroke="url(#nx-arc-indigo)" strokeWidth="1.2" fill="none" />
            <path d="M 310 90 Q 260 140 200 200" stroke="url(#nx-arc-teal)" strokeWidth="1.2" fill="none" />
            <path d="M 90 310 Q 140 260 200 200" stroke="url(#nx-arc-teal)" strokeWidth="1.2" fill="none" />
          </g>

          {/* ── Secondary neural pathways ── */}
          <g opacity="0.2" className="animate-shimmer" style={{ animationDelay: '-1.5s' }}>
            <path d="M 130 65 Q 100 150 200 200" stroke="#fbbf24" strokeWidth="0.8" fill="none" />
            <path d="M 270 65 Q 300 150 200 200" stroke="#fb923c" strokeWidth="0.8" fill="none" />
            <path d="M 340 135 Q 280 100 200 200" stroke="#f87171" strokeWidth="0.8" fill="none" />
            <path d="M 60 265 Q 120 300 200 200" stroke="#fbbf24" strokeWidth="0.8" fill="none" />
            <path d="M 340 265 Q 280 300 200 200" stroke="#fb923c" strokeWidth="0.8" fill="none" />
            <path d="M 60 135 Q 120 100 200 200" stroke="#f87171" strokeWidth="0.8" fill="none" />
          </g>

          {/* ── Pulsing concentric circles ── */}
          <circle cx="200" cy="200" r="60" fill="none" stroke="#f5c542" strokeWidth="0.6" opacity="0.15" className="animate-pulse-glow" />
          <circle cx="200" cy="200" r="90" fill="none" stroke="#f97316" strokeWidth="0.4" opacity="0.1" className="animate-pulse-glow" style={{ animationDelay: '-1s' }} />
          <circle cx="200" cy="200" r="120" fill="none" stroke="#f5c542" strokeWidth="0.3" opacity="0.08" className="animate-pulse-glow" style={{ animationDelay: '-2s' }} />

          {/* ── Core layers ── */}
          <circle cx="200" cy="200" r="45" fill="url(#nx-core)" opacity="0.6" filter="url(#nx-blur-md)" className="animate-pulse-glow" />
          <circle cx="200" cy="200" r="28" fill="url(#nx-inner-glow)" opacity="0.8" filter="url(#nx-blur-sm)" />
          <circle cx="200" cy="200" r="14" fill="white" opacity="0.9" filter="url(#nx-glow-strong)" />
          <circle cx="200" cy="200" r="8" fill="white" opacity="1" />
          <ellipse cx="196" cy="194" rx="6" ry="4" fill="white" opacity="0.7" transform="rotate(-30 196 194)" />

          {/* ── Endpoint nodes ── */}
          <g filter="url(#nx-glow)">
            <circle cx="200" cy="60" r="4" fill="#fbbf24" opacity="0.8" />
            <circle cx="200" cy="340" r="4" fill="#fbbf24" opacity="0.8" />
            <circle cx="60" cy="200" r="4" fill="#fbbf24" opacity="0.8" />
            <circle cx="340" cy="200" r="4" fill="#fbbf24" opacity="0.8" />
            <circle cx="90" cy="90" r="3.5" fill="#fb923c" opacity="0.7" />
            <circle cx="310" cy="310" r="3.5" fill="#fb923c" opacity="0.7" />
            <circle cx="310" cy="90" r="3.5" fill="#f87171" opacity="0.7" />
            <circle cx="90" cy="310" r="3.5" fill="#f87171" opacity="0.7" />
          </g>

          {/* ── Floating energy particles ── */}
          <g className="animate-particle-drift">
            <circle cx="115" cy="140" r="2.5" fill="url(#nx-particle)" />
            <circle cx="295" cy="130" r="2" fill="url(#nx-particle-indigo)" />
            <circle cx="85" cy="255" r="2.2" fill="url(#nx-particle)" />
            <circle cx="325" cy="265" r="2.8" fill="url(#nx-particle)" />
            <circle cx="155" cy="335" r="1.8" fill="url(#nx-particle-indigo)" />
            <circle cx="255" cy="80" r="2" fill="url(#nx-particle)" />
          </g>
          <g className="animate-particle-drift" style={{ animationDelay: '-2s' }}>
            <circle cx="70" cy="185" r="1.8" fill="url(#nx-particle)" />
            <circle cx="340" cy="195" r="2.2" fill="url(#nx-particle-indigo)" />
            <circle cx="165" cy="70" r="1.5" fill="url(#nx-particle)" />
            <circle cx="245" cy="335" r="2.5" fill="url(#nx-particle)" />
            <circle cx="345" cy="155" r="1.5" fill="url(#nx-particle-indigo)" />
          </g>
          <g className="animate-particle-drift" style={{ animationDelay: '-4s' }}>
            <circle cx="60" cy="235" r="1.5" fill="url(#nx-particle)" />
            <circle cx="355" cy="225" r="1.8" fill="url(#nx-particle-indigo)" />
            <circle cx="140" cy="80" r="1.2" fill="url(#nx-particle)" />
            <circle cx="275" cy="330" r="1.8" fill="url(#nx-particle)" />
          </g>

          {/* ── Energy beam lines from core ── */}
          <g opacity="0.1" stroke="#fbbf24" strokeWidth="0.4" className="animate-shimmer" style={{ animationDelay: '-1s' }}>
            <line x1="200" y1="200" x2="200" y2="60" />
            <line x1="200" y1="200" x2="200" y2="340" />
            <line x1="200" y1="200" x2="60" y2="200" />
            <line x1="200" y1="200" x2="340" y2="200" />
            <line x1="200" y1="200" x2="90" y2="90" />
            <line x1="200" y1="200" x2="310" y2="310" />
            <line x1="200" y1="200" x2="310" y2="90" />
            <line x1="200" y1="200" x2="90" y2="310" />
          </g>
        </svg>
      </div>
    </div>
  );
}

/**
 * AtheonCrystalIcon — Compact nexus icon for sidebar, header, and favicon.
 * Neural nexus core with converging arcs and orbital ring accent.
 */
export function AtheonCrystalIcon({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" width={size} height={size} className={className}>
      <defs>
        <radialGradient id="ci-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="20%" stopColor="#fde68a" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#f5c542" stopOpacity="0.5" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <radialGradient id="ci-glow2" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f5c542" stopOpacity="0.3" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <linearGradient id="ci-ring" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f5c542" stopOpacity="0" />
          <stop offset="50%" stopColor="#fbbf24" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#f5c542" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="ci-ring2" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0" />
          <stop offset="50%" stopColor="#fb923c" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </linearGradient>
        <filter id="ci-glow">
          <feGaussianBlur stdDeviation="1" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Ambient glow */}
      <circle cx="32" cy="32" r="28" fill="url(#ci-glow2)" opacity="0.5" />

      {/* Hexagonal frame */}
      <polygon points="32,6 54,17 54,47 32,58 10,47 10,17" fill="none" stroke="#f5c542" strokeWidth="0.4" opacity="0.15" />

      {/* Orbital rings */}
      <ellipse cx="32" cy="32" rx="26" ry="8" fill="none" stroke="url(#ci-ring)" strokeWidth="0.7" transform="rotate(-18 32 32)" />
      <ellipse cx="32" cy="32" rx="22" ry="6.5" fill="none" stroke="url(#ci-ring2)" strokeWidth="0.5" transform="rotate(30 32 32)" />

      {/* Neural pathways */}
      <g opacity="0.35" stroke="#f5c542" strokeWidth="0.6" fill="none">
        <path d="M 32 8 Q 28 20 32 32" />
        <path d="M 32 56 Q 36 44 32 32" />
        <path d="M 8 32 Q 20 28 32 32" />
        <path d="M 56 32 Q 44 36 32 32" />
      </g>
      <g opacity="0.25" stroke="#f97316" strokeWidth="0.5" fill="none">
        <path d="M 14 14 Q 22 20 32 32" />
        <path d="M 50 50 Q 42 44 32 32" />
        <path d="M 50 14 Q 42 20 32 32" />
        <path d="M 14 50 Q 22 44 32 32" />
      </g>

      {/* Endpoint nodes */}
      <circle cx="32" cy="8" r="1.8" fill="#fbbf24" opacity="0.7" filter="url(#ci-glow)" />
      <circle cx="32" cy="56" r="1.8" fill="#fbbf24" opacity="0.7" filter="url(#ci-glow)" />
      <circle cx="8" cy="32" r="1.8" fill="#fbbf24" opacity="0.7" filter="url(#ci-glow)" />
      <circle cx="56" cy="32" r="1.8" fill="#fbbf24" opacity="0.7" filter="url(#ci-glow)" />
      <circle cx="14" cy="14" r="1.5" fill="#fb923c" opacity="0.6" />
      <circle cx="50" cy="50" r="1.5" fill="#fb923c" opacity="0.6" />
      <circle cx="50" cy="14" r="1.5" fill="#f87171" opacity="0.6" />
      <circle cx="14" cy="50" r="1.5" fill="#f87171" opacity="0.6" />

      {/* Core layers */}
      <circle cx="32" cy="32" r="8" fill="url(#ci-core)" opacity="0.7" />
      <circle cx="32" cy="32" r="4.5" fill="white" opacity="0.85" filter="url(#ci-glow)" />
      <circle cx="32" cy="32" r="2.5" fill="white" opacity="1" />
      <ellipse cx="30.5" cy="30.5" rx="1.5" ry="1" fill="white" opacity="0.6" transform="rotate(-30 30.5 30.5)" />

      {/* Particles */}
      <circle cx="10" cy="22" r="0.8" fill="#fbbf24" opacity="0.5" />
      <circle cx="54" cy="20" r="0.7" fill="#fb923c" opacity="0.4" />
      <circle cx="12" cy="46" r="0.6" fill="#fbbf24" opacity="0.35" />
      <circle cx="52" cy="48" r="0.8" fill="#f87171" opacity="0.4" />
    </svg>
  );
}
