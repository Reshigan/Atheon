/**
 * Hero3D — Atheon soft blue fintech style
 * Matching the reference design with teal/blue gradient loops
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

  return (
    <div className={`relative ${className}`} style={{ width: dimensions.w, height: dimensions.h }}>
      {/* Ambient teal glow behind shape */}
      <div
        className="absolute inset-0 animate-pulse-glow"
        style={{
          background: 'radial-gradient(ellipse at 55% 40%, rgba(42,124,140,0.30) 0%, rgba(26,92,104,0.15) 25%, rgba(60,180,200,0.08) 45%, transparent 65%)',
          filter: 'blur(60px)',
        }}
      />

      {/* Main rotating container */}
      <div className="animate-hero-rotate" style={{ transformStyle: 'preserve-3d' }}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox={dimensions.vb}
          fill="none"
          width={dimensions.w}
          height={dimensions.h}
          style={{ filter: 'drop-shadow(0 40px 100px rgba(42,124,140,0.35)) drop-shadow(0 15px 40px rgba(26,92,104,0.20))' }}
        >
          <defs>
            {/* Main body gradient: teal → blue → purple */}
            <linearGradient id="h-body-warm" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#a7d8de" stopOpacity="1" />
              <stop offset="15%" stopColor="#5bb8c9" stopOpacity="0.95" />
              <stop offset="30%" stopColor="#2a7c8c" stopOpacity="0.9" />
              <stop offset="50%" stopColor="#1a5c68" stopOpacity="0.85" />
              <stop offset="70%" stopColor="#2563eb" stopOpacity="0.8" />
              <stop offset="85%" stopColor="#7c3aed" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0.6" />
            </linearGradient>
            <linearGradient id="h-body-cool" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.9" />
              <stop offset="25%" stopColor="#2563eb" stopOpacity="0.85" />
              <stop offset="50%" stopColor="#1a5c68" stopOpacity="0.8" />
              <stop offset="75%" stopColor="#2a7c8c" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#5bb8c9" stopOpacity="0.7" />
            </linearGradient>
            <linearGradient id="h-specular" x1="20%" y1="0%" x2="80%" y2="100%">
              <stop offset="0%" stopColor="white" stopOpacity="0.95" />
              <stop offset="30%" stopColor="#e0f4f7" stopOpacity="0.6" />
              <stop offset="60%" stopColor="#2a7c8c" stopOpacity="0.2" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
            <radialGradient id="h-inner-glow" cx="45%" cy="38%" r="50%">
              <stop offset="0%" stopColor="#e0f4f7" stopOpacity="0.9" />
              <stop offset="20%" stopColor="#5bb8c9" stopOpacity="0.6" />
              <stop offset="50%" stopColor="#1a5c68" stopOpacity="0.25" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            <radialGradient id="h-core" cx="42%" cy="35%" r="35%">
              <stop offset="0%" stopColor="white" stopOpacity="0.9" />
              <stop offset="40%" stopColor="#e0f4f7" stopOpacity="0.5" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            <linearGradient id="h-edge-blue" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.8" />
              <stop offset="40%" stopColor="#a78bfa" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#c084fc" stopOpacity="0.3" />
            </linearGradient>
            <pattern id="h-ribs" x="0" y="0" width="4.5" height="4.5" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
              <line x1="0" y1="0" x2="0" y2="4.5" stroke="rgba(255,255,255,0.14)" strokeWidth="0.5" />
            </pattern>
            <pattern id="h-ribs-fine" x="0" y="0" width="2.8" height="2.8" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)">
              <line x1="0" y1="0" x2="0" y2="2.8" stroke="rgba(255,255,255,0.08)" strokeWidth="0.3" />
            </pattern>
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

          {/* TWISTED TORUS / GLASS RIBBON */}
          <g style={{ transformOrigin: '300px 320px' }}>
            {/* Back part of torus */}
            <path
              d="M 180 160 C 100 200, 60 320, 100 420 C 140 520, 240 560, 320 540 C 400 520, 460 450, 480 370"
              stroke="url(#h-body-cool)" strokeWidth="55" fill="none" opacity="0.5" strokeLinecap="round"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 180 160 C 100 200, 60 320, 100 420 C 140 520, 240 560, 320 540 C 400 520, 460 450, 480 370;M 175 170 C 90 215, 55 330, 95 430 C 135 530, 235 565, 315 545 C 395 525, 455 455, 475 375;M 185 155 C 105 195, 65 315, 105 415 C 145 515, 245 555, 325 535 C 405 515, 465 445, 485 365;M 180 160 C 100 200, 60 320, 100 420 C 140 520, 240 560, 320 540 C 400 520, 460 450, 480 370" />
            </path>

            {/* Main outer torus ribbon */}
            <path
              d="M 440 180 C 520 240, 530 380, 480 460 C 430 540, 340 580, 260 560 C 180 540, 120 470, 100 380"
              stroke="url(#h-body-warm)" strokeWidth="60" fill="none" opacity="0.9" strokeLinecap="round"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 440 180 C 520 240, 530 380, 480 460 C 430 540, 340 580, 260 560 C 180 540, 120 470, 100 380;M 445 175 C 525 235, 535 375, 485 455 C 435 535, 345 575, 265 555 C 185 535, 125 465, 105 375;M 435 185 C 515 245, 525 385, 475 465 C 425 545, 335 585, 255 565 C 175 545, 115 475, 95 385;M 440 180 C 520 240, 530 380, 480 460 C 430 540, 340 580, 260 560 C 180 540, 120 470, 100 380" />
            </path>
            <path
              d="M 440 180 C 520 240, 530 380, 480 460 C 430 540, 340 580, 260 560 C 180 540, 120 470, 100 380"
              stroke="url(#h-ribs)" strokeWidth="58" fill="none" opacity="0.6" strokeLinecap="round"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 440 180 C 520 240, 530 380, 480 460 C 430 540, 340 580, 260 560 C 180 540, 120 470, 100 380;M 445 175 C 525 235, 535 375, 485 455 C 435 535, 345 575, 265 555 C 185 535, 125 465, 105 375;M 435 185 C 515 245, 525 385, 475 465 C 425 545, 335 585, 255 565 C 175 545, 115 475, 95 385;M 440 180 C 520 240, 530 380, 480 460 C 430 540, 340 580, 260 560 C 180 540, 120 470, 100 380" />
            </path>

            {/* Inner torus ribbon */}
            <path
              d="M 360 140 C 430 180, 470 280, 450 380 C 430 480, 360 530, 280 520 C 200 510, 140 440, 130 350"
              stroke="url(#h-body-cool)" strokeWidth="35" fill="none" opacity="0.75" strokeLinecap="round"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 360 140 C 430 180, 470 280, 450 380 C 430 480, 360 530, 280 520 C 200 510, 140 440, 130 350;M 365 135 C 435 175, 475 275, 455 375 C 435 475, 365 525, 285 515 C 205 505, 145 435, 135 345;M 355 145 C 425 185, 465 285, 445 385 C 425 485, 355 535, 275 525 C 195 515, 135 445, 125 355;M 360 140 C 430 180, 470 280, 450 380 C 430 480, 360 530, 280 520 C 200 510, 140 440, 130 350" />
            </path>

            {/* Upper crossing section */}
            <path
              d="M 200 130 C 270 100, 380 110, 440 180 C 480 230, 490 300, 470 360"
              stroke="url(#h-body-warm)" strokeWidth="48" fill="none" opacity="0.85" strokeLinecap="round"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 200 130 C 270 100, 380 110, 440 180 C 480 230, 490 300, 470 360;M 195 135 C 265 105, 375 115, 435 185 C 475 235, 485 305, 465 365;M 205 125 C 275 95, 385 105, 445 175 C 485 225, 495 295, 475 355;M 200 130 C 270 100, 380 110, 440 180 C 480 230, 490 300, 470 360" />
            </path>
            <path
              d="M 200 130 C 270 100, 380 110, 440 180 C 480 230, 490 300, 470 360"
              stroke="url(#h-ribs-fine)" strokeWidth="46" fill="none" opacity="0.5" strokeLinecap="round"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 200 130 C 270 100, 380 110, 440 180 C 480 230, 490 300, 470 360;M 195 135 C 265 105, 375 115, 435 185 C 475 235, 485 305, 465 365;M 205 125 C 275 95, 385 105, 445 175 C 485 225, 495 295, 475 355;M 200 130 C 270 100, 380 110, 440 180 C 480 230, 490 300, 470 360" />
            </path>

            {/* Bright white specular highlight */}
            <path
              d="M 220 125 C 300 95, 400 105, 450 170 C 485 220, 500 290, 485 350"
              stroke="white" strokeWidth="3" fill="none" opacity="0.7" strokeLinecap="round" filter="url(#h-glow)"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 220 125 C 300 95, 400 105, 450 170 C 485 220, 500 290, 485 350;M 215 130 C 295 100, 395 110, 445 175 C 480 225, 495 295, 480 355;M 225 120 C 305 90, 405 100, 455 165 C 490 215, 505 285, 490 345;M 220 125 C 300 95, 400 105, 450 170 C 485 220, 500 290, 485 350" />
            </path>

            {/* Secondary specular on outer ribbon */}
            <path
              d="M 460 200 C 510 260, 520 370, 475 440 C 430 510, 350 550, 280 540"
              stroke="white" strokeWidth="2.5" fill="none" opacity="0.5" strokeLinecap="round" filter="url(#h-glow)"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 460 200 C 510 260, 520 370, 475 440 C 430 510, 350 550, 280 540;M 465 195 C 515 255, 525 365, 480 435 C 435 505, 355 545, 285 535;M 455 205 C 505 265, 515 375, 470 445 C 425 515, 345 555, 275 545;M 460 200 C 510 260, 520 370, 475 440 C 430 510, 350 550, 280 540" />
            </path>

            {/* Blue edge glow — outer rim */}
            <path
              d="M 100 380 C 80 280, 120 180, 200 130"
              stroke="url(#h-edge-blue)" strokeWidth="20" fill="none" opacity="0.45" strokeLinecap="round" filter="url(#h-blur-sm)"
            >
              <animate attributeName="d" dur="12s" repeatCount="indefinite" values="M 100 380 C 80 280, 120 180, 200 130;M 105 375 C 85 275, 125 175, 205 125;M 95 385 C 75 285, 115 185, 195 135;M 100 380 C 80 280, 120 180, 200 130" />
            </path>
          </g>

          {/* Core light burst */}
          <ellipse cx="320" cy="300" rx="80" ry="70" fill="url(#h-core)" opacity="0.3" />
        </svg>
      </div>
    </div>
  );
}

/* Bold "A." text mark with teal accent */
export function AtheonTextMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" width={size} height={size} className={className}>
      <rect width="64" height="64" rx="14" fill="#1a2332" />
      {/* Bold serif A */}
      <path d="M 20 48 L 30.5 14 L 33.5 14 L 44 48 L 39.5 48 L 37 40 L 27 40 L 24.5 48 Z M 28.2 36.5 L 35.8 36.5 L 32 22.5 Z" fill="white" />
      {/* Teal dot */}
      <circle cx="48" cy="46" r={4.5} fill="#2a7c8c" />
    </svg>
  );
}

/* Inline "A." logo for sidebar and header */
export function AtheonLogoInline({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline font-serif font-black tracking-tight ${className}`} style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
      <span>A</span>
      <span style={{ color: 'var(--accent)', fontSize: '1.1em', lineHeight: 0 }}>.</span>
    </span>
  );
}
