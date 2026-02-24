/**
 * Hero3D — Advanced 3D crystalline visualization
 * A floating geometric polyhedron with orbital rings, energy particles, and depth layers.
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
          background: 'radial-gradient(circle at 50% 45%, rgba(14,165,233,0.25) 0%, rgba(6,182,212,0.1) 40%, transparent 70%)',
          filter: 'blur(20px)',
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
          style={{ filter: 'drop-shadow(0 20px 60px rgba(14,165,233,0.25))' }}
        >
          <defs>
            {/* Core crystal gradients */}
            <linearGradient id="h3d-face-1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.7" />
            </linearGradient>
            <linearGradient id="h3d-face-2" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.6" />
            </linearGradient>
            <linearGradient id="h3d-face-3" x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="#a5f3fc" stopOpacity="0.95" />
              <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#0369a1" stopOpacity="0.5" />
            </linearGradient>
            <linearGradient id="h3d-face-4" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="h3d-face-dark" x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="#0e7490" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#164e63" stopOpacity="0.4" />
            </linearGradient>
            {/* Shine / specular highlight */}
            <linearGradient id="h3d-shine" x1="30%" y1="0%" x2="70%" y2="100%">
              <stop offset="0%" stopColor="white" stopOpacity="0.95" />
              <stop offset="30%" stopColor="white" stopOpacity="0.4" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </linearGradient>
            {/* Orbital ring gradient */}
            <linearGradient id="h3d-ring" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0" />
              <stop offset="25%" stopColor="#22d3ee" stopOpacity="0.6" />
              <stop offset="50%" stopColor="#67e8f9" stopOpacity="0.8" />
              <stop offset="75%" stopColor="#22d3ee" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="h3d-ring2" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0" />
              <stop offset="30%" stopColor="#38bdf8" stopOpacity="0.4" />
              <stop offset="50%" stopColor="#7dd3fc" stopOpacity="0.6" />
              <stop offset="70%" stopColor="#38bdf8" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
            </linearGradient>
            {/* Particle glow */}
            <radialGradient id="h3d-particle" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="white" stopOpacity="1" />
              <stop offset="40%" stopColor="#67e8f9" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="h3d-core-glow" cx="50%" cy="45%" r="40%">
              <stop offset="0%" stopColor="#a5f3fc" stopOpacity="0.4" />
              <stop offset="60%" stopColor="#22d3ee" stopOpacity="0.1" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            {/* Filters */}
            <filter id="h3d-blur-sm">
              <feGaussianBlur stdDeviation="2" />
            </filter>
            <filter id="h3d-blur-md">
              <feGaussianBlur stdDeviation="4" />
            </filter>
            <filter id="h3d-glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="h3d-glow-strong">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* ── Background energy field ── */}
          <circle cx="200" cy="195" r="130" fill="url(#h3d-core-glow)" className="animate-pulse-glow" />

          {/* ── Outer orbital ring (tilted ellipse) ── */}
          <g className="animate-orbit" style={{ transformOrigin: '200px 195px' }}>
            <ellipse cx="200" cy="195" rx="155" ry="50" fill="none" stroke="url(#h3d-ring2)" strokeWidth="1" opacity="0.5" transform="rotate(-20 200 195)" />
            {/* Orbital particle on ring */}
            <circle cx="355" cy="195" r="3.5" fill="white" opacity="0.9" filter="url(#h3d-glow)" transform="rotate(-20 200 195)">
              <animateTransform attributeName="transform" type="rotate" from="-20 200 195" to="340 200 195" dur="20s" repeatCount="indefinite" additive="replace" />
            </circle>
          </g>

          {/* ── Inner orbital ring ── */}
          <g className="animate-orbit-reverse" style={{ transformOrigin: '200px 195px' }}>
            <ellipse cx="200" cy="195" rx="120" ry="38" fill="none" stroke="url(#h3d-ring)" strokeWidth="1.5" opacity="0.6" transform="rotate(15 200 195)" />
            {/* Orbital particle */}
            <circle cx="320" cy="195" r="3" fill="#67e8f9" opacity="0.95" filter="url(#h3d-glow)" transform="rotate(15 200 195)">
              <animateTransform attributeName="transform" type="rotate" from="375 200 195" to="15 200 195" dur="25s" repeatCount="indefinite" additive="replace" />
            </circle>
          </g>

          {/* ── Third subtle ring ── */}
          <ellipse cx="200" cy="195" rx="170" ry="28" fill="none" stroke="#38bdf8" strokeWidth="0.5" opacity="0.2" transform="rotate(40 200 195)" strokeDasharray="8 12" className="animate-orbit" style={{ transformOrigin: '200px 195px' }} />

          {/* ── The Crystal: Icosahedron-like polyhedron ── */}
          <g filter="url(#h3d-glow)">
            {/* Back faces (darker, behind) */}
            <polygon points="200,100 145,170 200,155" fill="url(#h3d-face-dark)" stroke="#38bdf8" strokeWidth="0.5" opacity="0.5" />
            <polygon points="200,100 255,170 200,155" fill="url(#h3d-face-dark)" stroke="#38bdf8" strokeWidth="0.5" opacity="0.4" />

            {/* Bottom pyramid faces */}
            <polygon points="145,170 200,290 165,220" fill="url(#h3d-face-2)" stroke="#22d3ee" strokeWidth="0.6" opacity="0.7" />
            <polygon points="255,170 200,290 235,220" fill="url(#h3d-face-dark)" stroke="#22d3ee" strokeWidth="0.6" opacity="0.6" />
            <polygon points="165,220 200,290 235,220" fill="url(#h3d-face-2)" stroke="#06b6d4" strokeWidth="0.5" opacity="0.65" />

            {/* Main front-left face */}
            <polygon points="200,100 145,170 165,220" fill="url(#h3d-face-1)" stroke="#22d3ee" strokeWidth="0.8" strokeOpacity="0.6" />
            {/* Main front-right face */}
            <polygon points="200,100 255,170 235,220" fill="url(#h3d-face-3)" stroke="#22d3ee" strokeWidth="0.8" strokeOpacity="0.6" />

            {/* Center diamond face — brightest */}
            <polygon points="200,100 165,220 235,220" fill="url(#h3d-face-4)" stroke="#67e8f9" strokeWidth="0.8" strokeOpacity="0.5" />

            {/* Side accent triangles */}
            <polygon points="145,170 125,210 165,220" fill="url(#h3d-face-2)" stroke="#22d3ee" strokeWidth="0.5" opacity="0.6" />
            <polygon points="255,170 275,210 235,220" fill="url(#h3d-face-dark)" stroke="#22d3ee" strokeWidth="0.5" opacity="0.5" />

            {/* Top crown facet */}
            <polygon points="175,110 200,100 225,110 200,130" fill="url(#h3d-face-1)" stroke="#67e8f9" strokeWidth="0.5" opacity="0.8" />
          </g>

          {/* ── Specular highlights on crystal ── */}
          <polygon points="200,105 170,155 195,145" fill="url(#h3d-shine)" opacity="0.55" />
          <polygon points="200,108 210,130 230,155 205,145" fill="url(#h3d-shine)" opacity="0.3" />

          {/* ── Crystal edges — wireframe glow ── */}
          <g stroke="#a5f3fc" strokeWidth="0.8" opacity="0.4" fill="none">
            <line x1="200" y1="100" x2="145" y2="170" />
            <line x1="200" y1="100" x2="255" y2="170" />
            <line x1="200" y1="100" x2="165" y2="220" />
            <line x1="200" y1="100" x2="235" y2="220" />
            <line x1="145" y1="170" x2="165" y2="220" />
            <line x1="255" y1="170" x2="235" y2="220" />
            <line x1="165" y1="220" x2="200" y2="290" />
            <line x1="235" y1="220" x2="200" y2="290" />
            <line x1="165" y1="220" x2="235" y2="220" />
            <line x1="145" y1="170" x2="125" y2="210" />
            <line x1="255" y1="170" x2="275" y2="210" />
          </g>

          {/* ── Vertex glow points ── */}
          <circle cx="200" cy="100" r="4" fill="white" opacity="0.95" filter="url(#h3d-glow)" />
          <circle cx="200" cy="100" r="8" fill="white" opacity="0.15" />
          <circle cx="145" cy="170" r="3" fill="#a5f3fc" opacity="0.8" filter="url(#h3d-glow)" />
          <circle cx="255" cy="170" r="3" fill="#a5f3fc" opacity="0.8" filter="url(#h3d-glow)" />
          <circle cx="165" cy="220" r="2.5" fill="#67e8f9" opacity="0.7" filter="url(#h3d-glow)" />
          <circle cx="235" cy="220" r="2.5" fill="#67e8f9" opacity="0.7" filter="url(#h3d-glow)" />
          <circle cx="200" cy="290" r="3.5" fill="white" opacity="0.85" filter="url(#h3d-glow)" />
          <circle cx="200" cy="290" r="7" fill="white" opacity="0.1" />
          <circle cx="125" cy="210" r="2" fill="#22d3ee" opacity="0.6" />
          <circle cx="275" cy="210" r="2" fill="#22d3ee" opacity="0.6" />

          {/* ── Floating energy particles ── */}
          <g className="animate-particle-drift">
            <circle cx="120" cy="140" r="2" fill="url(#h3d-particle)" />
            <circle cx="290" cy="130" r="1.5" fill="url(#h3d-particle)" />
            <circle cx="100" cy="250" r="1.8" fill="url(#h3d-particle)" />
            <circle cx="310" cy="260" r="2.2" fill="url(#h3d-particle)" />
            <circle cx="155" cy="310" r="1.5" fill="url(#h3d-particle)" />
            <circle cx="250" cy="100" r="1.8" fill="url(#h3d-particle)" />
          </g>
          <g className="animate-particle-drift" style={{ animationDelay: '-2s' }}>
            <circle cx="85" cy="180" r="1.5" fill="url(#h3d-particle)" />
            <circle cx="325" cy="190" r="1.8" fill="url(#h3d-particle)" />
            <circle cx="170" cy="85" r="1.3" fill="url(#h3d-particle)" />
            <circle cx="240" cy="310" r="2" fill="url(#h3d-particle)" />
            <circle cx="330" cy="150" r="1.2" fill="url(#h3d-particle)" />
          </g>
          <g className="animate-particle-drift" style={{ animationDelay: '-4s' }}>
            <circle cx="75" cy="230" r="1.2" fill="url(#h3d-particle)" />
            <circle cx="340" cy="220" r="1.6" fill="url(#h3d-particle)" />
            <circle cx="145" cy="95" r="1" fill="url(#h3d-particle)" />
            <circle cx="260" cy="305" r="1.5" fill="url(#h3d-particle)" />
          </g>

          {/* ── Inner core energy ── */}
          <circle cx="200" cy="190" r="18" fill="#a5f3fc" opacity="0.12" filter="url(#h3d-blur-md)" className="animate-pulse-glow" />
          <circle cx="200" cy="190" r="8" fill="white" opacity="0.15" filter="url(#h3d-blur-sm)" className="animate-pulse-glow" />

          {/* ── Energy beam lines from core ── */}
          <g opacity="0.2" stroke="#67e8f9" strokeWidth="0.5" className="animate-shimmer">
            <line x1="200" y1="190" x2="120" y2="140" />
            <line x1="200" y1="190" x2="290" y2="130" />
            <line x1="200" y1="190" x2="100" y2="250" />
            <line x1="200" y1="190" x2="310" y2="260" />
            <line x1="200" y1="190" x2="85" y2="180" />
            <line x1="200" y1="190" x2="325" y2="190" />
          </g>
        </svg>
      </div>
    </div>
  );
}

/**
 * Compact icon version for sidebar logo and favicon
 */
export function AtheonCrystalIcon({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" width={size} height={size} className={className}>
      <defs>
        <linearGradient id="ci-f1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
        <linearGradient id="ci-f2" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
        <linearGradient id="ci-f3" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#a5f3fc" />
          <stop offset="100%" stopColor="#0369a1" />
        </linearGradient>
        <linearGradient id="ci-shine" x1="30%" y1="0%" x2="70%" y2="100%">
          <stop offset="0%" stopColor="white" stopOpacity="0.9" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <filter id="ci-glow">
          <feGaussianBlur stdDeviation="1" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Crystal polyhedron */}
      <polygon points="32,8 18,26 22,42" fill="url(#ci-f1)" stroke="#22d3ee" strokeWidth="0.5" opacity="0.9" />
      <polygon points="32,8 46,26 42,42" fill="url(#ci-f3)" stroke="#22d3ee" strokeWidth="0.5" opacity="0.85" />
      <polygon points="32,8 22,42 42,42" fill="url(#ci-f2)" stroke="#67e8f9" strokeWidth="0.5" opacity="0.9" />
      <polygon points="22,42 32,56 42,42" fill="url(#ci-f2)" stroke="#06b6d4" strokeWidth="0.5" opacity="0.7" />
      {/* Side faces */}
      <polygon points="18,26 14,34 22,42" fill="url(#ci-f2)" stroke="#22d3ee" strokeWidth="0.3" opacity="0.6" />
      <polygon points="46,26 50,34 42,42" fill="url(#ci-f1)" stroke="#22d3ee" strokeWidth="0.3" opacity="0.5" />
      {/* Specular highlight */}
      <polygon points="32,10 24,24 30,22" fill="url(#ci-shine)" opacity="0.5" />
      {/* Vertex glows */}
      <circle cx="32" cy="8" r="2.5" fill="white" opacity="0.95" filter="url(#ci-glow)" />
      <circle cx="32" cy="56" r="2" fill="white" opacity="0.8" filter="url(#ci-glow)" />
      <circle cx="18" cy="26" r="1.5" fill="#a5f3fc" opacity="0.7" />
      <circle cx="46" cy="26" r="1.5" fill="#a5f3fc" opacity="0.7" />
      {/* Orbital ring hint */}
      <ellipse cx="32" cy="32" rx="28" ry="9" fill="none" stroke="#22d3ee" strokeWidth="0.6" opacity="0.35" transform="rotate(-15 32 32)" />
      {/* Particles */}
      <circle cx="10" cy="22" r="1" fill="#67e8f9" opacity="0.6" />
      <circle cx="54" cy="20" r="0.8" fill="#67e8f9" opacity="0.5" />
      <circle cx="12" cy="44" r="0.7" fill="#a5f3fc" opacity="0.4" />
      <circle cx="52" cy="46" r="0.9" fill="#a5f3fc" opacity="0.5" />
    </svg>
  );
}
