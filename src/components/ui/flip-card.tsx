import { ReactNode, useState } from 'react';

interface FlipCardProps {
  front: ReactNode;
  back: ReactNode;
  isFlipped?: boolean;
  onFlip?: () => void;
  className?: string;
  /** Fixed height (CSS value). When set, uses 3D flip with absolute positioning. */
  height?: string;
  /** Minimum height for auto-sizing cards. Uses content-swap transition instead of 3D flip. */
  minHeight?: string;
}

/**
 * FlipCard – click to reveal the back face.
 * Supports two modes:
 *   1. Fixed height (3D rotate) – pass `height`
 *   2. Auto height (content swap with fade) – pass `minHeight` or neither
 */
export function FlipCard({ front, back, isFlipped: controlledFlipped, onFlip, className = '', height, minHeight }: FlipCardProps) {
  const [internalFlipped, setInternalFlipped] = useState(false);
  const isControlled = controlledFlipped !== undefined;
  const flipped = isControlled ? controlledFlipped : internalFlipped;
  const toggle = onFlip ?? (isControlled ? () => {} : () => setInternalFlipped(f => !f));

  // Auto-height mode: content swap with fade
  if (!height) {
    return (
      <div
        className={`relative cursor-pointer transition-all duration-300 ${className}`}
        onClick={toggle}
        style={{ minHeight }}
      >
        <div className={`transition-opacity duration-300 ${flipped ? 'opacity-0 pointer-events-none absolute inset-0' : 'opacity-100'}`}>
          {front}
        </div>
        <div className={`transition-opacity duration-300 ${flipped ? 'opacity-100' : 'opacity-0 pointer-events-none absolute inset-0'}`}>
          {back}
        </div>
      </div>
    );
  }

  // Fixed-height mode: 3D flip
  return (
    <div
      className={`relative cursor-pointer ${className}`}
      onClick={toggle}
      style={{ height, perspective: '1000px' }}
    >
      <div
        className="relative w-full h-full transition-transform duration-500"
        style={{
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        <div className="absolute w-full h-full" style={{ backfaceVisibility: 'hidden' }}>
          {front}
        </div>
        <div className="absolute w-full h-full" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
          {back}
        </div>
      </div>
    </div>
  );
}

interface FlipCardContentProps {
  children: ReactNode;
  className?: string;
}

export function FlipCardFront({ children, className = '' }: FlipCardContentProps) {
  return (
    <div
      className={`w-full h-full rounded-md p-5 flex flex-col ${className}`}
      style={{
        background: 'var(--bg-card-solid)',
        border: '1px solid var(--border-card)',
      }}
    >
      {children}
    </div>
  );
}

export function FlipCardBack({ children, className = '' }: FlipCardContentProps) {
  return (
    <div
      className={`w-full h-full rounded-md p-5 flex flex-col ${className}`}
      style={{
        background: 'var(--bg-card-solid)',
        border: '1px solid var(--border-card)',
      }}
    >
      {children}
    </div>
  );
}
