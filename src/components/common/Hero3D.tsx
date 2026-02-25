/**
 * Hero3D — Atheon Fluid Glass visualization
 * A stunning fluid, glossy 3D morphing shape inspired by abstract glass art.
 * Features warm amber/gold/red/purple colors, fine ribbed textures,
 * glossy reflections, and continuous smooth morphing animation.
 * Pure SVG + CSS animations, no external dependencies.
 */

interface Hero3DProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Hero3D({ size = 'lg', className = '' }: Hero3DProps) {
  const dimensions = {
    sm: { w: 200, h: 240, vb: '0 0 500 600' },
    md: { w: 360, h: 432, vb: '0 0 500 600' },
    lg: { w: 700, h: 840, vb: '0 0 500 600' },
  }[size];

  const ribs = Array.from({ length: 14 }, (_, i) => ({
    d: `M ${195 + i * 9} ${85 + i * 5} C ${305 + i * 5} ${140 + i * 9}, ${345 + i * 3} ${255 + i * 7}, ${315 - i * 5} ${385 + i * 3}`,
    color: i < 5 ? '#fde68a' : i < 10 ? '#f97316' : '#c084fc',
    w: 0.9 - i * 0.035,
    o: 0.22 - i * 0.012,
  }));

  return (
    <div className={`relative ${className}`} style={{ width: dimensions.w, height: dimensions.h }}>
      {/* Warm ambient glow */}
      <div
        className="absolute inset-0 animate-pulse-glow"
        style={{
          background: 'radial-gradient(ellipse at 55% 45%, rgba(249,115,22,0.25) 0%, rgba(220,60,60,0.1) 30%, rgba(140,40,200,0.06) 55%, transparent 70%)',
          filter: 'blur(50px)',
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
          style={{ filter: 'drop-shadow(0 30px 80px rgba(249,115,22,0.3)) drop-shadow(0 10px 30px rgba(220,60,60,0.2))' }}
        >
          <defs>
            <linearGradient id="fg-body-gold" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.9" />
              <stop offset="25%" stopColor="#f59e0b" stopOpacity="0.85" />
              <stop offset="50%" stopColor="#ea580c" stopOpacity="0.8" />
              <stop offset="75%" stopColor="#dc2626" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#9333ea" stopOpacity="0.6" />
            </linearGradient>
            <linearGradient id="fg-body-fire" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fde68a" stopOpacity="0.95" />
              <stop offset="20%" stopColor="#fbbf24" stopOpacity="0.9" />
              <stop offset="45%" stopColor="#ef4444" stopOpacity="0.8" />
              <stop offset="70%" stopColor="#be185d" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.5" />
            </linearGradient>
            <linearGradient id="fg-highlight" x1="30%" y1="0%" x2="70%" y2="100%">
              <stop offset="0%" stopColor="white" stopOpacity="0.9" />
              <stop offset="20%" stopColor="#fef3c7" stopOpacity="0.6" />
              <stop offset="50%" stopColor="#fbbf24" stopOpacity="0.3" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
            <linearGradient id="fg-edge-warm" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fde68a" stopOpacity="0.9" />
              <stop offset="30%" stopColor="#f97316" stopOpacity="0.8" />
              <stop offset="60%" stopColor="#ef4444" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#a855f7" stopOpacity="0.5" />
            </linearGradient>
            <linearGradient id="fg-edge-cool" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#c084fc" stopOpacity="0.7" />
              <stop offset="30%" stopColor="#ec4899" stopOpacity="0.6" />
              <stop offset="60%" stopColor="#ef4444" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0.4" />
            </linearGradient>
            <radialGradient id="fg-inner-glow" cx="45%" cy="40%" r="50%">
              <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.8" />
              <stop offset="25%" stopColor="#fbbf24" stopOpacity="0.5" />
              <stop offset="60%" stopColor="#ea580c" stopOpacity="0.2" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            <radialGradient id="fg-core-light" cx="40%" cy="35%" r="40%">
              <stop offset="0%" stopColor="white" stopOpacity="0.95" />
              <stop offset="30%" stopColor="#fef3c7" stopOpacity="0.7" />
              <stop offset="70%" stopColor="#f59e0b" stopOpacity="0.2" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
            <linearGradient id="fg-reflect" x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor="#f97316" stopOpacity="0.4" />
              <stop offset="30%" stopColor="#ef4444" stopOpacity="0.2" />
              <stop offset="60%" stopColor="#a855f7" stopOpacity="0.1" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
            <pattern id="fg-ribs" x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(25)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" />
            </pattern>
            <pattern id="fg-ribs-fine" x="0" y="0" width="3.5" height="3.5" patternUnits="userSpaceOnUse" patternTransform="rotate(-15)">
              <line x1="0" y1="0" x2="0" y2="3.5" stroke="rgba(255,255,255,0.08)" strokeWidth="0.4" />
            </pattern>
            <filter id="fg-blur"><feGaussianBlur stdDeviation="8" /></filter>
            <filter id="fg-blur-sm"><feGaussianBlur stdDeviation="3" /></filter>
            <filter id="fg-glow">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="fg-glow-strong">
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Ambient haze */}
          <ellipse cx="250" cy="280" rx="200" ry="160" fill="url(#fg-inner-glow)" opacity="0.3" filter="url(#fg-blur)" />

          {/* MAIN FLUID SHAPE */}
          <g style={{ transformOrigin: '250px 280px' }}>
            {/* Shadow / depth layer */}
            <path
              d="M 250 70 C 360 65, 430 170, 410 270 C 390 370, 345 440, 285 475 C 225 510, 165 480, 125 400 C 85 320, 70 220, 115 145 C 160 70, 210 70, 250 70 Z"
              fill="url(#fg-body-gold)" opacity="0.6" filter="url(#fg-blur-sm)"
            />
            {/* Main body fill */}
            <path
              d="M 250 75 C 355 70, 420 165, 405 265 C 390 365, 340 435, 285 465 C 230 495, 170 475, 135 400 C 100 325, 80 230, 120 150 C 160 75, 210 75, 250 75 Z"
              fill="url(#fg-body-fire)" opacity="0.85"
            >
              <animate attributeName="d" dur="8s" repeatCount="indefinite" values="M 250 75 C 355 70, 420 165, 405 265 C 390 365, 340 435, 285 465 C 230 495, 170 475, 135 400 C 100 325, 80 230, 120 150 C 160 75, 210 75, 250 75 Z;M 255 80 C 365 75, 425 175, 400 275 C 375 375, 330 445, 275 470 C 220 495, 160 465, 130 385 C 100 305, 75 220, 125 145 C 175 70, 215 80, 255 80 Z;M 248 70 C 350 65, 415 155, 408 258 C 400 360, 350 425, 290 458 C 230 490, 175 480, 140 410 C 105 340, 85 240, 118 155 C 155 70, 208 70, 248 70 Z;M 250 75 C 355 70, 420 165, 405 265 C 390 365, 340 435, 285 465 C 230 495, 170 475, 135 400 C 100 325, 80 230, 120 150 C 160 75, 210 75, 250 75 Z" />
            </path>
            {/* Ribbed texture overlay */}
            <path
              d="M 250 75 C 355 70, 420 165, 405 265 C 390 365, 340 435, 285 465 C 230 495, 170 475, 135 400 C 100 325, 80 230, 120 150 C 160 75, 210 75, 250 75 Z"
              fill="url(#fg-ribs)" opacity="0.5"
            >
              <animate attributeName="d" dur="8s" repeatCount="indefinite" values="M 250 75 C 355 70, 420 165, 405 265 C 390 365, 340 435, 285 465 C 230 495, 170 475, 135 400 C 100 325, 80 230, 120 150 C 160 75, 210 75, 250 75 Z;M 255 80 C 365 75, 425 175, 400 275 C 375 375, 330 445, 275 470 C 220 495, 160 465, 130 385 C 100 305, 75 220, 125 145 C 175 70, 215 80, 255 80 Z;M 248 70 C 350 65, 415 155, 408 258 C 400 360, 350 425, 290 458 C 230 490, 175 480, 140 410 C 105 340, 85 240, 118 155 C 155 70, 208 70, 248 70 Z;M 250 75 C 355 70, 420 165, 405 265 C 390 365, 340 435, 285 465 C 230 495, 170 475, 135 400 C 100 325, 80 230, 120 150 C 160 75, 210 75, 250 75 Z" />
            </path>
            {/* Fine secondary ribbing */}
            <path
              d="M 250 75 C 355 70, 420 165, 405 265 C 390 365, 340 435, 285 465 C 230 495, 170 475, 135 400 C 100 325, 80 230, 120 150 C 160 75, 210 75, 250 75 Z"
              fill="url(#fg-ribs-fine)" opacity="0.35"
            />
            {/* Inner flowing curves */}
            <path
              d="M 260 120 C 340 130, 380 210, 370 290 C 360 370, 310 410, 270 420 C 230 430, 190 400, 170 340 C 150 280, 160 200, 200 150 C 230 120, 250 120, 260 120 Z"
              fill="url(#fg-edge-warm)" opacity="0.5"
            >
              <animate attributeName="d" dur="8s" repeatCount="indefinite" values="M 260 120 C 340 130, 380 210, 370 290 C 360 370, 310 410, 270 420 C 230 430, 190 400, 170 340 C 150 280, 160 200, 200 150 C 230 120, 250 120, 260 120 Z;M 265 125 C 345 140, 385 220, 365 300 C 345 380, 300 420, 260 425 C 220 430, 185 395, 168 330 C 150 265, 155 195, 205 148 C 240 115, 255 125, 265 125 Z;M 258 115 C 335 125, 375 205, 372 285 C 368 365, 315 405, 275 418 C 235 430, 195 405, 175 345 C 155 285, 162 205, 198 152 C 228 118, 248 115, 258 115 Z;M 260 120 C 340 130, 380 210, 370 290 C 360 370, 310 410, 270 420 C 230 430, 190 400, 170 340 C 150 280, 160 200, 200 150 C 230 120, 250 120, 260 120 Z" />
            </path>
            {/* Purple/cool edge tones */}
            <path
              d="M 230 90 C 175 100, 120 180, 115 260 C 110 340, 140 400, 180 430 C 200 445, 230 445, 250 440"
              stroke="url(#fg-edge-cool)" strokeWidth="12" fill="none" opacity="0.5" strokeLinecap="round"
            >
              <animate attributeName="d" dur="8s" repeatCount="indefinite" values="M 230 90 C 175 100, 120 180, 115 260 C 110 340, 140 400, 180 430 C 200 445, 230 445, 250 440;M 235 95 C 180 108, 125 190, 118 268 C 112 348, 138 410, 175 438 C 195 452, 228 448, 248 442;M 228 85 C 170 95, 118 175, 112 255 C 108 335, 142 395, 182 428 C 202 442, 232 442, 252 438;M 230 90 C 175 100, 120 180, 115 260 C 110 340, 140 400, 180 430 C 200 445, 230 445, 250 440" />
            </path>
            {/* Bright glass specular */}
            <path
              d="M 280 140 C 330 160, 360 220, 350 280 C 340 330, 310 360, 280 370"
              stroke="url(#fg-highlight)" strokeWidth="6" fill="none" opacity="0.7" strokeLinecap="round" filter="url(#fg-glow)"
            >
              <animate attributeName="d" dur="8s" repeatCount="indefinite" values="M 280 140 C 330 160, 360 220, 350 280 C 340 330, 310 360, 280 370;M 285 145 C 338 168, 365 228, 348 288 C 335 338, 305 368, 275 375;M 278 135 C 325 155, 355 215, 352 275 C 342 325, 312 355, 282 365;M 280 140 C 330 160, 360 220, 350 280 C 340 330, 310 360, 280 370" />
            </path>
            {/* White specular rim */}
            <path
              d="M 260 80 C 350 85, 410 170, 400 265 C 395 330, 370 390, 330 430"
              stroke="white" strokeWidth="2" fill="none" opacity="0.6" strokeLinecap="round" filter="url(#fg-glow)"
            >
              <animate attributeName="d" dur="8s" repeatCount="indefinite" values="M 260 80 C 350 85, 410 170, 400 265 C 395 330, 370 390, 330 430;M 265 85 C 358 92, 415 180, 396 275 C 388 340, 362 400, 322 438;M 258 78 C 345 80, 405 165, 402 260 C 398 325, 372 385, 335 425;M 260 80 C 350 85, 410 170, 400 265 C 395 330, 370 390, 330 430" />
            </path>
            {/* Inner white edge */}
            <path
              d="M 135 390 C 115 340, 100 270, 115 200 C 130 140, 170 100, 220 85"
              stroke="white" strokeWidth="1.5" fill="none" opacity="0.35" strokeLinecap="round"
            />
            {/* Flowing rib lines */}
            {ribs.map((r, i) => (
              <path
                key={`rib-${i}`}
                d={r.d}
                stroke={r.color}
                strokeWidth={r.w}
                fill="none"
                opacity={r.o}
                strokeLinecap="round"
              />
            ))}
            {/* Core bright spot */}
            <ellipse cx="290" cy="230" rx="45" ry="55" fill="url(#fg-core-light)" opacity="0.5" filter="url(#fg-blur-sm)" className="animate-pulse-glow" />
            {/* Specular dots */}
            <circle cx="300" cy="180" r="3" fill="white" opacity="0.8" filter="url(#fg-glow)" />
            <circle cx="340" cy="250" r="2" fill="white" opacity="0.5" filter="url(#fg-glow)" />
            <circle cx="260" cy="350" r="2.5" fill="#fbbf24" opacity="0.4" filter="url(#fg-glow)" />
          </g>

          {/* Outer flowing ribbon arcs */}
          <g style={{ transformOrigin: '250px 280px' }}>
            <path
              d="M 310 70 C 420 100, 460 220, 430 340 C 410 420, 360 475, 290 490"
              stroke="url(#fg-edge-warm)" strokeWidth="3" fill="none" opacity="0.4" strokeLinecap="round"
            >
              <animate attributeName="d" dur="10s" repeatCount="indefinite" values="M 310 70 C 420 100, 460 220, 430 340 C 410 420, 360 475, 290 490;M 315 75 C 428 108, 465 230, 425 348 C 402 428, 352 480, 282 495;M 308 68 C 415 95, 455 215, 432 335 C 415 415, 365 472, 295 488;M 310 70 C 420 100, 460 220, 430 340 C 410 420, 360 475, 290 490" />
            </path>
            <path
              d="M 200 470 C 140 440, 80 360, 75 270 C 70 180, 110 110, 180 75"
              stroke="url(#fg-edge-cool)" strokeWidth="2.5" fill="none" opacity="0.3" strokeLinecap="round"
            >
              <animate attributeName="d" dur="10s" repeatCount="indefinite" values="M 200 470 C 140 440, 80 360, 75 270 C 70 180, 110 110, 180 75;M 195 475 C 132 445, 72 365, 70 272 C 65 178, 108 105, 185 72;M 205 468 C 145 435, 85 355, 78 268 C 72 182, 112 115, 178 78;M 200 470 C 140 440, 80 360, 75 270 C 70 180, 110 110, 180 75" />
            </path>
          </g>

          {/* Surface reflection */}
          <g opacity="0.2" style={{ transform: 'scaleY(-0.3) translateY(-1500px)' }}>
            <ellipse cx="250" cy="280" rx="140" ry="60" fill="url(#fg-reflect)" filter="url(#fg-blur)" />
          </g>

          {/* Ambient floating particles */}
          <g className="animate-particle-drift" opacity="0.6">
            <circle cx="380" cy="120" r="2.5" fill="#fbbf24" opacity="0.6" filter="url(#fg-glow)" />
            <circle cx="100" cy="200" r="2" fill="#c084fc" opacity="0.4" filter="url(#fg-glow)" />
            <circle cx="420" cy="380" r="1.8" fill="#ef4444" opacity="0.5" filter="url(#fg-glow)" />
            <circle cx="80" cy="400" r="2.2" fill="#f97316" opacity="0.35" filter="url(#fg-glow)" />
            <circle cx="440" cy="200" r="1.5" fill="#fde68a" opacity="0.5" filter="url(#fg-glow)" />
            <circle cx="60" cy="300" r="1.8" fill="#a855f7" opacity="0.3" filter="url(#fg-glow)" />
          </g>
        </svg>
      </div>
    </div>
  );
}

/* Small icon version for sidebar / favicon */
export function AtheonCrystalIcon({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" width={size} height={size} className={className}>
      <defs>
        <linearGradient id="si-body" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.9" />
          <stop offset="35%" stopColor="#f97316" stopOpacity="0.85" />
          <stop offset="65%" stopColor="#ef4444" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#a855f7" stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id="si-highlight" x1="30%" y1="0%" x2="70%" y2="100%">
          <stop offset="0%" stopColor="white" stopOpacity="0.9" />
          <stop offset="40%" stopColor="#fef3c7" stopOpacity="0.4" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
        <linearGradient id="si-edge" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#c084fc" stopOpacity="0.7" />
          <stop offset="50%" stopColor="#ec4899" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id="si-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1a1a2a" />
          <stop offset="100%" stopColor="#16161e" />
        </linearGradient>
        <filter id="si-glow">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#si-bg)" />
      <ellipse cx="34" cy="30" rx="18" ry="22" fill="#f97316" opacity="0.12" filter="url(#si-glow)" />
      <path
        d="M 32 10 C 44 10, 52 22, 50 34 C 48 46, 42 54, 36 57 C 30 60, 22 58, 18 50 C 14 42, 12 30, 18 20 C 24 10, 28 10, 32 10 Z"
        fill="url(#si-body)" opacity="0.85"
      />
      {Array.from({ length: 6 }).map((_, i) => (
        <path
          key={`sr-${i}`}
          d={`M ${27 + i * 2.5} ${14 + i * 2} C ${38 + i * 1.5} ${22 + i * 2.5}, ${42 + i} ${34 + i * 2}, ${38 - i} ${48 + i}`}
          stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" fill="none"
        />
      ))}
      <path
        d="M 28 12 C 20 16, 14 28, 15 38 C 16 48, 22 56, 30 58"
        stroke="url(#si-edge)" strokeWidth="2" fill="none" opacity="0.5" strokeLinecap="round"
      />
      <path
        d="M 34 12 C 44 14, 50 24, 49 34 C 48 42, 44 50, 38 54"
        stroke="url(#si-highlight)" strokeWidth="1.5" fill="none" opacity="0.6" strokeLinecap="round" filter="url(#si-glow)"
      />
      <ellipse cx="36" cy="28" rx="6" ry="8" fill="white" opacity="0.3" filter="url(#si-glow)" />
      <circle cx="38" cy="24" r="2" fill="white" opacity="0.7" filter="url(#si-glow)" />
    </svg>
  );
}
