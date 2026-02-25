/**
 * Hero3D — Atheon Dramatic Morphing Glass
 * Inspired by the reference video: a 3D twisted glass torus/ribbon shape
 * with warm amber/gold → red → magenta → purple/blue gradient,
 * fine ribbed textures, glossy white specular highlights,
 * and smooth continuous morphing animation.
 * Pure SVG + CSS animations, no external dependencies.
 */

interface Hero3DProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Hero3D({ size = 'lg', className = '' }: Hero3DProps) {
  const dimensions = {
    sm: { w: 240, h: 280, vb: '0 0 600 700' },
    md: { w: 400, h: 470, vb: '0 0 600 700' },
    lg: { w: 700, h: 820, vb: '0 0 600 700' },
  }[size];

  /* Generate 30 fine rib lines that follow the torus cross-section */
  const ribLines = Array.from({ length: 30 }, (_, i) => {
    const t = i / 29;
    const angle = t * Math.PI * 2;
    const cx = 300 + Math.cos(angle) * 120;
    const cy = 320 + Math.sin(angle) * 160;
    const dx = Math.cos(angle + 0.4) * 80;
    const dy = Math.sin(angle + 0.4) * 100;
    return {
      d: `M ${cx - dx} ${cy - dy} Q ${cx} ${cy}, ${cx + dx} ${cy + dy}`,
      opacity: 0.08 + Math.sin(t * Math.PI) * 0.12,
      width: 0.4 + Math.sin(t * Math.PI) * 0.3,
    };
  });

  return (
    <div className={`relative ${className}`} style={{ width: dimensions.w, height: dimensions.h }}>
      {/* Ambient warm glow behind shape */}
      <div
        className="absolute inset-0 animate-pulse-glow"
        style={{
          background: 'radial-gradient(ellipse at 55% 40%, rgba(249,115,22,0.35) 0%, rgba(220,40,60,0.15) 25%, rgba(160,40,200,0.08) 45%, transparent 65%)',
          filter: 'blur(60px)',
        }}
      />

      {/* Main rotating container with 3D perspective */}
      <div className="animate-hero-rotate" style={{ transformStyle: 'preserve-3d' }}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox={dimensions.vb}
          fill="none"
          width={dimensions.w}
          height={dimensions.h}
          style={{ filter: 'drop-shadow(0 40px 100px rgba(249,115,22,0.4)) drop-shadow(0 15px 40px rgba(190,30,80,0.25))' }}
        >
          <defs>
            {/* Main body gradient: gold → orange → red → magenta → purple */}
            <linearGradient id="h-body-warm" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fde68a" stopOpacity="1" />
              <stop offset="15%" stopColor="#fbbf24" stopOpacity="0.95" />
              <stop offset="30%" stopColor="#f97316" stopOpacity="0.9" />
              <stop offset="50%" stopColor="#ef4444" stopOpacity="0.85" />
              <stop offset="70%" stopColor="#ec4899" stopOpacity="0.8" />
              <stop offset="85%" stopColor="#a855f7" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0.6" />
            </linearGradient>
            {/* Reverse gradient for inner surfaces */}
            <linearGradient id="h-body-cool" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.9" />
              <stop offset="25%" stopColor="#be185d" stopOpacity="0.85" />
              <stop offset="50%" stopColor="#ef4444" stopOpacity="0.8" />
              <stop offset="75%" stopColor="#f97316" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.7" />
            </linearGradient>
            {/* Highlight / specular gradient */}
            <linearGradient id="h-specular" x1="20%" y1="0%" x2="80%" y2="100%">
              <stop offset="0%" stopColor="white" stopOpacity="0.95" />
              <stop offset="30%" stopColor="#fef3c7" stopOpacity="0.6" />
              <stop offset="60%" stopColor="#fbbf24" stopOpacity="0.2" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
            {/* Inner glow */}
            <radialGradient id="h-inner-glow" cx="45%" cy="38%" r="50%">
              <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.9" />
              <stop offset="20%" stopColor="#fbbf24" stopOpacity="0.6" />
              <stop offset="50%" stopColor="#ea580c" stopOpacity="0.25" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            {/* Core light */}
            <radialGradient id="h-core" cx="42%" cy="35%" r="35%">
              <stop offset="0%" stopColor="white" stopOpacity="0.9" />
              <stop offset="40%" stopColor="#fef3c7" stopOpacity="0.5" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            {/* Edge glow for outer rim */}
            <linearGradient id="h-edge-blue" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.8" />
              <stop offset="40%" stopColor="#a78bfa" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#c084fc" stopOpacity="0.3" />
            </linearGradient>
            {/* Reflection gradient */}
            <linearGradient id="h-reflect" x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="#f97316" stopOpacity="0.5" />
              <stop offset="30%" stopColor="#ef4444" stopOpacity="0.25" />
              <stop offset="60%" stopColor="#a855f7" stopOpacity="0.1" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
            {/* Ribbed pattern */}
            <pattern id="h-ribs" x="0" y="0" width="4.5" height="4.5" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
              <line x1="0" y1="0" x2="0" y2="4.5" stroke="rgba(255,255,255,0.14)" strokeWidth="0.5" />
            </pattern>
            <pattern id="h-ribs-fine" x="0" y="0" width="2.8" height="2.8" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)">
              <line x1="0" y1="0" x2="0" y2="2.8" stroke="rgba(255,255,255,0.08)" strokeWidth="0.3" />
            </pattern>
            {/* Filters */}
            <filter id="h-blur"><feGaussianBlur stdDeviation="10" /></filter>
            <filter id="h-blur-sm"><feGaussianBlur stdDeviation="4" /></filter>
            <filter id="h-glow">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="h-glow-strong">
              <feGaussianBlur stdDeviation="10" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Ambient haze */}
          <ellipse cx="300" cy="320" rx="220" ry="180" fill="url(#h-inner-glow)" opacity="0.35" filter="url(#h-blur)" />

          {/* === TWISTED TORUS / GLASS RIBBON === */}
          <g style={{ transformOrigin: '300px 320px' }}>

            {/* Back part of torus - darker, creates depth */}
            <path
              d="M 180 160 C 100 200, 60 320, 100 420 C 140 520, 240 560, 320 540 C 400 520, 460 450, 480 370"
              stroke="url(#h-body-cool)" strokeWidth="55" fill="none" opacity="0.5" strokeLinecap="round"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 180 160 C 100 200, 60 320, 100 420 C 140 520, 240 560, 320 540 C 400 520, 460 450, 480 370;M 175 170 C 90 215, 55 330, 95 430 C 135 530, 235 565, 315 545 C 395 525, 455 455, 475 375;M 185 155 C 105 195, 65 315, 105 415 C 145 515, 245 555, 325 535 C 405 515, 465 445, 485 365;M 180 160 C 100 200, 60 320, 100 420 C 140 520, 240 560, 320 540 C 400 520, 460 450, 480 370" />
            </path>

            {/* Main outer torus ribbon — warm side */}
            <path
              d="M 440 180 C 520 240, 530 380, 480 460 C 430 540, 340 580, 260 560 C 180 540, 120 470, 100 380"
              stroke="url(#h-body-warm)" strokeWidth="60" fill="none" opacity="0.9" strokeLinecap="round"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 440 180 C 520 240, 530 380, 480 460 C 430 540, 340 580, 260 560 C 180 540, 120 470, 100 380;M 445 175 C 525 235, 535 375, 485 455 C 435 535, 345 575, 265 555 C 185 535, 125 465, 105 375;M 435 185 C 515 245, 525 385, 475 465 C 425 545, 335 585, 255 565 C 175 545, 115 475, 95 385;M 440 180 C 520 240, 530 380, 480 460 C 430 540, 340 580, 260 560 C 180 540, 120 470, 100 380" />
            </path>
            {/* Ribbed texture on outer ribbon */}
            <path
              d="M 440 180 C 520 240, 530 380, 480 460 C 430 540, 340 580, 260 560 C 180 540, 120 470, 100 380"
              stroke="url(#h-ribs)" strokeWidth="58" fill="none" opacity="0.6" strokeLinecap="round"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 440 180 C 520 240, 530 380, 480 460 C 430 540, 340 580, 260 560 C 180 540, 120 470, 100 380;M 445 175 C 525 235, 535 375, 485 455 C 435 535, 345 575, 265 555 C 185 535, 125 465, 105 375;M 435 185 C 515 245, 525 385, 475 465 C 425 545, 335 585, 255 565 C 175 545, 115 475, 95 385;M 440 180 C 520 240, 530 380, 480 460 C 430 540, 340 580, 260 560 C 180 540, 120 470, 100 380" />
            </path>

            {/* Inner torus ribbon — creates the twisted hollow effect */}
            <path
              d="M 360 140 C 430 180, 470 280, 450 380 C 430 480, 360 530, 280 520 C 200 510, 140 440, 130 350"
              stroke="url(#h-body-cool)" strokeWidth="35" fill="none" opacity="0.75" strokeLinecap="round"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 360 140 C 430 180, 470 280, 450 380 C 430 480, 360 530, 280 520 C 200 510, 140 440, 130 350;M 365 135 C 435 175, 475 275, 455 375 C 435 475, 365 525, 285 515 C 205 505, 145 435, 135 345;M 355 145 C 425 185, 465 285, 445 385 C 425 485, 355 535, 275 525 C 195 515, 135 445, 125 355;M 360 140 C 430 180, 470 280, 450 380 C 430 480, 360 530, 280 520 C 200 510, 140 440, 130 350" />
            </path>

            {/* Upper crossing section — creates the twist */}
            <path
              d="M 200 130 C 270 100, 380 110, 440 180 C 480 230, 490 300, 470 360"
              stroke="url(#h-body-warm)" strokeWidth="48" fill="none" opacity="0.85" strokeLinecap="round"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 200 130 C 270 100, 380 110, 440 180 C 480 230, 490 300, 470 360;M 195 135 C 265 105, 375 115, 435 185 C 475 235, 485 305, 465 365;M 205 125 C 275 95, 385 105, 445 175 C 485 225, 495 295, 475 355;M 200 130 C 270 100, 380 110, 440 180 C 480 230, 490 300, 470 360" />
            </path>
            {/* Fine ribs on upper section */}
            <path
              d="M 200 130 C 270 100, 380 110, 440 180 C 480 230, 490 300, 470 360"
              stroke="url(#h-ribs-fine)" strokeWidth="46" fill="none" opacity="0.5" strokeLinecap="round"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 200 130 C 270 100, 380 110, 440 180 C 480 230, 490 300, 470 360;M 195 135 C 265 105, 375 115, 435 185 C 475 235, 485 305, 465 365;M 205 125 C 275 95, 385 105, 445 175 C 485 225, 495 295, 475 355;M 200 130 C 270 100, 380 110, 440 180 C 480 230, 490 300, 470 360" />
            </path>

            {/* Bright white specular highlight — top edge */}
            <path
              d="M 220 125 C 300 95, 400 105, 450 170 C 485 220, 500 290, 485 350"
              stroke="white" strokeWidth="3" fill="none" opacity="0.7" strokeLinecap="round" filter="url(#h-glow)"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 220 125 C 300 95, 400 105, 450 170 C 485 220, 500 290, 485 350;M 215 130 C 295 100, 395 110, 445 175 C 480 225, 495 295, 480 355;M 225 120 C 305 90, 405 100, 455 165 C 490 215, 505 285, 490 345;M 220 125 C 300 95, 400 105, 450 170 C 485 220, 500 290, 485 350" />
            </path>

            {/* White specular — right curve */}
            <path
              d="M 490 350 C 485 420, 440 500, 370 540 C 320 565, 260 570, 210 550"
              stroke="white" strokeWidth="2.5" fill="none" opacity="0.55" strokeLinecap="round" filter="url(#h-glow)"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 490 350 C 485 420, 440 500, 370 540 C 320 565, 260 570, 210 550;M 485 355 C 480 425, 435 505, 365 545 C 315 570, 255 575, 205 555;M 495 345 C 490 415, 445 495, 375 535 C 325 560, 265 565, 215 545;M 490 350 C 485 420, 440 500, 370 540 C 320 565, 260 570, 210 550" />
            </path>

            {/* Inner specular edge — left side */}
            <path
              d="M 140 370 C 130 300, 155 220, 200 160 C 230 120, 270 105, 310 110"
              stroke="white" strokeWidth="1.8" fill="none" opacity="0.4" strokeLinecap="round"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 140 370 C 130 300, 155 220, 200 160 C 230 120, 270 105, 310 110;M 145 375 C 135 305, 160 225, 205 165 C 235 125, 275 110, 315 115;M 135 365 C 125 295, 150 215, 195 155 C 225 115, 265 100, 305 105;M 140 370 C 130 300, 155 220, 200 160 C 230 120, 270 105, 310 110" />
            </path>

            {/* Purple/blue outer glow edge */}
            <path
              d="M 160 150 C 110 190, 80 280, 90 370 C 100 460, 150 520, 220 550"
              stroke="url(#h-edge-blue)" strokeWidth="8" fill="none" opacity="0.5" strokeLinecap="round" filter="url(#h-glow)"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 160 150 C 110 190, 80 280, 90 370 C 100 460, 150 520, 220 550;M 155 155 C 105 195, 75 285, 85 375 C 95 465, 145 525, 215 555;M 165 145 C 115 185, 85 275, 95 365 C 105 455, 155 515, 225 545;M 160 150 C 110 190, 80 280, 90 370 C 100 460, 150 520, 220 550" />
            </path>

            {/* Fine flowing rib detail lines */}
            {ribLines.map((r, i) => (
              <path
                key={`rl-${i}`}
                d={r.d}
                stroke="rgba(255,255,255,0.9)"
                strokeWidth={r.width}
                fill="none"
                opacity={r.opacity}
                strokeLinecap="round"
              />
            ))}

            {/* Core bright area — amber glow in center */}
            <ellipse cx="340" cy="280" rx="60" ry="80" fill="url(#h-core)" opacity="0.45" filter="url(#h-blur-sm)" className="animate-pulse-glow" />

            {/* Hot specular dots */}
            <circle cx="350" cy="200" r="4" fill="white" opacity="0.85" filter="url(#h-glow-strong)" />
            <circle cx="400" cy="300" r="3" fill="white" opacity="0.6" filter="url(#h-glow)" />
            <circle cx="300" cy="420" r="3.5" fill="#fbbf24" opacity="0.5" filter="url(#h-glow)" />
            <circle cx="460" cy="250" r="2.5" fill="#ec4899" opacity="0.45" filter="url(#h-glow)" />
          </g>

          {/* Ground reflection */}
          <g opacity="0.15" style={{ transform: 'scaleY(-0.25) translateY(-2200px)' }}>
            <ellipse cx="300" cy="350" rx="180" ry="70" fill="url(#h-reflect)" filter="url(#h-blur)" />
          </g>

          {/* Ambient floating particles */}
          <g className="animate-particle-drift" opacity="0.7">
            <circle cx="450" cy="130" r="2.5" fill="#fbbf24" opacity="0.6" filter="url(#h-glow)" />
            <circle cx="80" cy="220" r="2" fill="#a855f7" opacity="0.45" filter="url(#h-glow)" />
            <circle cx="500" cy="430" r="2" fill="#ef4444" opacity="0.5" filter="url(#h-glow)" />
            <circle cx="60" cy="440" r="2.2" fill="#f97316" opacity="0.4" filter="url(#h-glow)" />
            <circle cx="520" cy="220" r="1.8" fill="#fde68a" opacity="0.55" filter="url(#h-glow)" />
            <circle cx="50" cy="340" r="2" fill="#6366f1" opacity="0.35" filter="url(#h-glow)" />
            <circle cx="280" cy="90" r="1.5" fill="#ec4899" opacity="0.4" filter="url(#h-glow)" />
          </g>
        </svg>
      </div>
    </div>
  );
}

/* Bold "A." text mark — matches "Do." reference style */
export function AtheonTextMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  const scale = size / 64;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" width={size} height={size} className={className}>
      <rect width="64" height="64" rx="14" fill="#1a1a1a" />
      {/* Bold serif A */}
      <path d="M 20 48 L 30.5 14 L 33.5 14 L 44 48 L 39.5 48 L 37 40 L 27 40 L 24.5 48 Z M 28.2 36.5 L 35.8 36.5 L 32 22.5 Z" fill="white" />
      {/* Amber dot */}
      <circle cx="48" cy="46" r={4.5 * (scale > 0 ? 1 : 1)} fill="#e8a000" />
    </svg>
  );
}

/* Inline "A." logo for sidebar and header — no background box */
export function AtheonLogoInline({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline font-serif font-black tracking-tight ${className}`} style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
      <span>A</span>
      <span style={{ color: '#e8a000', fontSize: '1.1em', lineHeight: 0 }}>.</span>
    </span>
  );
}
