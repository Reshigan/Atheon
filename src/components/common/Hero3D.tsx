/**
 * Hero3D — Atheon-branded 3D "A" visualization
 * A stylized letter "A" built from crystalline geometric facets
 * with orbital rings, energy particles, and depth layers.
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
            {/* Crystal face gradients — left side lighter */}
            <linearGradient id="h3d-a-left" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#a5f3fc" stopOpacity="0.95" />
              <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.7" />
            </linearGradient>
            {/* Right side deeper */}
            <linearGradient id="h3d-a-right" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.6" />
            </linearGradient>
            {/* Center / crossbar face */}
            <linearGradient id="h3d-a-center" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.9" />
              <stop offset="50%" stopColor="#67e8f9" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.9" />
            </linearGradient>
            {/* Inner triangle cutout (negative space) */}
            <linearGradient id="h3d-a-inner" x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="#0e7490" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#164e63" stopOpacity="0.2" />
            </linearGradient>
            {/* Dark side faces */}
            <linearGradient id="h3d-a-dark" x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="#0e7490" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#164e63" stopOpacity="0.3" />
            </linearGradient>
            {/* Bright highlight face */}
            <linearGradient id="h3d-a-bright" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#cffafe" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.7" />
            </linearGradient>
            {/* Shine / specular highlight */}
            <linearGradient id="h3d-shine" x1="30%" y1="0%" x2="70%" y2="100%">
              <stop offset="0%" stopColor="white" stopOpacity="0.95" />
              <stop offset="30%" stopColor="white" stopOpacity="0.4" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </linearGradient>
            {/* Orbital ring gradients */}
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
          <circle cx="200" cy="200" r="140" fill="url(#h3d-core-glow)" className="animate-pulse-glow" />

          {/* ── Outer orbital ring ── */}
          <g className="animate-orbit" style={{ transformOrigin: '200px 200px' }}>
            <ellipse cx="200" cy="200" rx="165" ry="48" fill="none" stroke="url(#h3d-ring2)" strokeWidth="1" opacity="0.5" transform="rotate(-18 200 200)" />
            <circle cx="365" cy="200" r="3.5" fill="white" opacity="0.9" filter="url(#h3d-glow)" transform="rotate(-18 200 200)">
              <animateTransform attributeName="transform" type="rotate" from="-18 200 200" to="342 200 200" dur="20s" repeatCount="indefinite" additive="replace" />
            </circle>
          </g>

          {/* ── Inner orbital ring ── */}
          <g className="animate-orbit-reverse" style={{ transformOrigin: '200px 200px' }}>
            <ellipse cx="200" cy="200" rx="130" ry="36" fill="none" stroke="url(#h3d-ring)" strokeWidth="1.5" opacity="0.6" transform="rotate(12 200 200)" />
            <circle cx="330" cy="200" r="3" fill="#67e8f9" opacity="0.95" filter="url(#h3d-glow)" transform="rotate(12 200 200)">
              <animateTransform attributeName="transform" type="rotate" from="372 200 200" to="12 200 200" dur="25s" repeatCount="indefinite" additive="replace" />
            </circle>
          </g>

          {/* ── Third subtle ring ── */}
          <ellipse cx="200" cy="200" rx="180" ry="26" fill="none" stroke="#38bdf8" strokeWidth="0.5" opacity="0.2" transform="rotate(38 200 200)" strokeDasharray="8 12" className="animate-orbit" style={{ transformOrigin: '200px 200px' }} />

          {/* ═══════════════════════════════════════════
              The Atheon "A" — built from crystal facets
              Points: apex(200,75), footL(120,310), footR(280,310)
              Crossbar at y≈230, inner triangle above crossbar
              3D depth via left/right lighting difference
          ═══════════════════════════════════════════ */}

          <g filter="url(#h3d-glow)">
            {/* ── Left leg outer face (bright, lit side) ── */}
            <polygon points="200,75 120,310 155,310" fill="url(#h3d-a-left)" stroke="#22d3ee" strokeWidth="0.8" strokeOpacity="0.6" />
            {/* Left leg inner face */}
            <polygon points="200,75 155,310 175,230" fill="url(#h3d-a-bright)" stroke="#67e8f9" strokeWidth="0.6" strokeOpacity="0.4" />

            {/* ── Right leg outer face (darker, shadow side) ── */}
            <polygon points="200,75 280,310 245,310" fill="url(#h3d-a-right)" stroke="#22d3ee" strokeWidth="0.8" strokeOpacity="0.6" />
            {/* Right leg inner face */}
            <polygon points="200,75 245,310 225,230" fill="url(#h3d-a-dark)" stroke="#38bdf8" strokeWidth="0.6" strokeOpacity="0.4" />

            {/* ── Crossbar — the horizontal bar of the A ── */}
            <polygon points="155,230 175,230 225,230 245,230 238,250 162,250" fill="url(#h3d-a-center)" stroke="#67e8f9" strokeWidth="0.7" strokeOpacity="0.5" />

            {/* ── Inner triangle (negative space above crossbar) ── */}
            <polygon points="200,130 175,230 225,230" fill="url(#h3d-a-inner)" stroke="#22d3ee" strokeWidth="0.5" strokeOpacity="0.3" />

            {/* ── Left foot base (3D thickness) ── */}
            <polygon points="120,310 155,310 162,250 128,250" fill="url(#h3d-a-dark)" stroke="#0e7490" strokeWidth="0.4" opacity="0.6" />
            {/* ── Right foot base (3D thickness) ── */}
            <polygon points="280,310 245,310 238,250 272,250" fill="url(#h3d-a-dark)" stroke="#0e7490" strokeWidth="0.4" opacity="0.5" />

            {/* ── Left 3D depth face (side bevel) ── */}
            <polygon points="120,310 128,250 135,280" fill="url(#h3d-a-left)" stroke="#22d3ee" strokeWidth="0.3" opacity="0.4" />
            {/* ── Right 3D depth face (side bevel) ── */}
            <polygon points="280,310 272,250 265,280" fill="url(#h3d-a-right)" stroke="#22d3ee" strokeWidth="0.3" opacity="0.35" />

            {/* ── Apex crown facet (top bevel) ── */}
            <polygon points="190,82 200,75 210,82 200,95" fill="url(#h3d-a-bright)" stroke="#67e8f9" strokeWidth="0.5" opacity="0.85" />
          </g>

          {/* ── Specular highlights on the A ── */}
          <polygon points="200,78 170,160 190,150" fill="url(#h3d-shine)" opacity="0.5" />
          <polygon points="200,80 195,120 182,175 175,230 180,225" fill="url(#h3d-shine)" opacity="0.25" />
          <polygon points="155,232 245,232 238,248 162,248" fill="white" opacity="0.08" />

          {/* ── Wireframe edge glow ── */}
          <g stroke="#a5f3fc" strokeWidth="0.8" opacity="0.35" fill="none">
            {/* Outer edges */}
            <line x1="200" y1="75" x2="120" y2="310" />
            <line x1="200" y1="75" x2="280" y2="310" />
            <line x1="120" y1="310" x2="155" y2="310" />
            <line x1="280" y1="310" x2="245" y2="310" />
            {/* Inner edges */}
            <line x1="200" y1="75" x2="175" y2="230" />
            <line x1="200" y1="75" x2="225" y2="230" />
            {/* Crossbar */}
            <line x1="155" y1="230" x2="245" y2="230" />
            <line x1="162" y1="250" x2="238" y2="250" />
            {/* Inner triangle */}
            <line x1="175" y1="230" x2="225" y2="230" />
            <line x1="200" y1="130" x2="175" y2="230" />
            <line x1="200" y1="130" x2="225" y2="230" />
            {/* Foot connections */}
            <line x1="155" y1="310" x2="162" y2="250" />
            <line x1="245" y1="310" x2="238" y2="250" />
          </g>

          {/* ── Vertex glow points ── */}
          {/* Apex — brightest */}
          <circle cx="200" cy="75" r="5" fill="white" opacity="0.95" filter="url(#h3d-glow)" />
          <circle cx="200" cy="75" r="10" fill="white" opacity="0.15" />
          {/* Feet */}
          <circle cx="120" cy="310" r="3" fill="#a5f3fc" opacity="0.7" filter="url(#h3d-glow)" />
          <circle cx="280" cy="310" r="3" fill="#a5f3fc" opacity="0.7" filter="url(#h3d-glow)" />
          <circle cx="155" cy="310" r="2" fill="#67e8f9" opacity="0.5" />
          <circle cx="245" cy="310" r="2" fill="#67e8f9" opacity="0.5" />
          {/* Crossbar corners */}
          <circle cx="155" cy="230" r="2.5" fill="#67e8f9" opacity="0.6" filter="url(#h3d-glow)" />
          <circle cx="245" cy="230" r="2.5" fill="#67e8f9" opacity="0.6" filter="url(#h3d-glow)" />
          {/* Inner apex */}
          <circle cx="200" cy="130" r="2" fill="white" opacity="0.6" />

          {/* ── Floating energy particles ── */}
          <g className="animate-particle-drift">
            <circle cx="110" cy="150" r="2" fill="url(#h3d-particle)" />
            <circle cx="300" cy="140" r="1.5" fill="url(#h3d-particle)" />
            <circle cx="90" cy="260" r="1.8" fill="url(#h3d-particle)" />
            <circle cx="320" cy="270" r="2.2" fill="url(#h3d-particle)" />
            <circle cx="145" cy="330" r="1.5" fill="url(#h3d-particle)" />
            <circle cx="260" cy="90" r="1.8" fill="url(#h3d-particle)" />
          </g>
          <g className="animate-particle-drift" style={{ animationDelay: '-2s' }}>
            <circle cx="75" cy="190" r="1.5" fill="url(#h3d-particle)" />
            <circle cx="335" cy="200" r="1.8" fill="url(#h3d-particle)" />
            <circle cx="160" cy="75" r="1.3" fill="url(#h3d-particle)" />
            <circle cx="250" cy="330" r="2" fill="url(#h3d-particle)" />
            <circle cx="340" cy="160" r="1.2" fill="url(#h3d-particle)" />
          </g>
          <g className="animate-particle-drift" style={{ animationDelay: '-4s' }}>
            <circle cx="65" cy="240" r="1.2" fill="url(#h3d-particle)" />
            <circle cx="350" cy="230" r="1.6" fill="url(#h3d-particle)" />
            <circle cx="135" cy="85" r="1" fill="url(#h3d-particle)" />
            <circle cx="270" cy="325" r="1.5" fill="url(#h3d-particle)" />
          </g>

          {/* ── Inner core energy (centered on A) ── */}
          <circle cx="200" cy="200" r="20" fill="#a5f3fc" opacity="0.1" filter="url(#h3d-blur-md)" className="animate-pulse-glow" />
          <circle cx="200" cy="180" r="8" fill="white" opacity="0.12" filter="url(#h3d-blur-sm)" className="animate-pulse-glow" />

          {/* ── Energy beam lines from apex ── */}
          <g opacity="0.15" stroke="#67e8f9" strokeWidth="0.5" className="animate-shimmer">
            <line x1="200" y1="75" x2="110" y2="150" />
            <line x1="200" y1="75" x2="300" y2="140" />
            <line x1="200" y1="75" x2="90" y2="260" />
            <line x1="200" y1="75" x2="320" y2="270" />
            <line x1="200" y1="75" x2="75" y2="190" />
            <line x1="200" y1="75" x2="335" y2="200" />
          </g>
        </svg>
      </div>
    </div>
  );
}

/**
 * AtheonLogo — Compact "A" icon for sidebar, header, and favicon.
 * Crystalline letter "A" with faceted faces and orbital ring accent.
 */
export function AtheonCrystalIcon({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" width={size} height={size} className={className}>
      <defs>
        <linearGradient id="ci-al" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a5f3fc" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.8" />
        </linearGradient>
        <linearGradient id="ci-ar" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#0284c7" stopOpacity="0.65" />
        </linearGradient>
        <linearGradient id="ci-ac" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#67e8f9" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="ci-ad" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#0e7490" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#164e63" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="ci-ab" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#cffafe" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="ci-sh" x1="30%" y1="0%" x2="70%" y2="100%">
          <stop offset="0%" stopColor="white" stopOpacity="0.9" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <filter id="ci-glow">
          <feGaussianBlur stdDeviation="1" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Left leg outer */}
      <polygon points="32,6 12,54 18,54" fill="url(#ci-al)" stroke="#22d3ee" strokeWidth="0.5" opacity="0.9" />
      {/* Left leg inner */}
      <polygon points="32,6 18,54 24,38" fill="url(#ci-ab)" stroke="#67e8f9" strokeWidth="0.4" opacity="0.8" />

      {/* Right leg outer */}
      <polygon points="32,6 52,54 46,54" fill="url(#ci-ar)" stroke="#22d3ee" strokeWidth="0.5" opacity="0.85" />
      {/* Right leg inner */}
      <polygon points="32,6 46,54 40,38" fill="url(#ci-ad)" stroke="#38bdf8" strokeWidth="0.4" opacity="0.7" />

      {/* Crossbar */}
      <polygon points="21,38 24,38 40,38 43,38 41,42 23,42" fill="url(#ci-ac)" stroke="#67e8f9" strokeWidth="0.4" strokeOpacity="0.5" />

      {/* Inner triangle */}
      <polygon points="32,18 24,38 40,38" fill="url(#ci-ad)" stroke="#22d3ee" strokeWidth="0.3" opacity="0.5" />

      {/* Foot bases */}
      <polygon points="12,54 18,54 23,42 16,42" fill="url(#ci-ad)" stroke="#0e7490" strokeWidth="0.3" opacity="0.5" />
      <polygon points="52,54 46,54 41,42 48,42" fill="url(#ci-ad)" stroke="#0e7490" strokeWidth="0.3" opacity="0.45" />

      {/* Specular highlight */}
      <polygon points="32,8 25,28 30,25" fill="url(#ci-sh)" opacity="0.45" />

      {/* Apex crown */}
      <polygon points="29,9 32,6 35,9 32,14" fill="url(#ci-ab)" stroke="#67e8f9" strokeWidth="0.3" opacity="0.8" />

      {/* Vertex glows */}
      <circle cx="32" cy="6" r="2.5" fill="white" opacity="0.95" filter="url(#ci-glow)" />
      <circle cx="12" cy="54" r="1.5" fill="#a5f3fc" opacity="0.7" />
      <circle cx="52" cy="54" r="1.5" fill="#a5f3fc" opacity="0.7" />
      <circle cx="24" cy="38" r="1.2" fill="#67e8f9" opacity="0.6" />
      <circle cx="40" cy="38" r="1.2" fill="#67e8f9" opacity="0.6" />

      {/* Orbital ring */}
      <ellipse cx="32" cy="34" rx="28" ry="8" fill="none" stroke="#22d3ee" strokeWidth="0.6" opacity="0.3" transform="rotate(-12 32 34)" />

      {/* Particles */}
      <circle cx="8" cy="24" r="0.9" fill="#67e8f9" opacity="0.5" />
      <circle cx="56" cy="22" r="0.7" fill="#67e8f9" opacity="0.4" />
      <circle cx="10" cy="46" r="0.6" fill="#a5f3fc" opacity="0.35" />
      <circle cx="54" cy="48" r="0.8" fill="#a5f3fc" opacity="0.4" />
    </svg>
  );
}
