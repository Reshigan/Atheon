import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

export interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
  /** Swiss surfaces. `default` = white field + 1px hairline + sharp corners,
   *  no shadow. `panel` = borderless with a 1.5px ink top-rule (section
   *  blocks). `accent` = hairline tinted with the ledger accent for a single
   *  emphasis card. `raised`/`outline` retained for compatibility. */
  variant?: 'default' | 'raised' | 'accent' | 'panel' | 'outline';
  /** Padding scale. `default` = 20px (most cards); `compact` = 12px
   *  (dense bento tiles, KPI mini-cards); `relaxed` = 28px (top-level
   *  hero cards that anchor a screen). Avoid freelance className overrides
   *  — pick a size and let the design tokens enforce rhythm. */
  size?: 'default' | 'compact' | 'relaxed';
  onClick?: () => void;
  style?: React.CSSProperties;
}

const variantClass: Record<NonNullable<CardProps['variant']>, string> = {
  default: 'card-swiss',
  raised:  'card-swiss',
  accent:  'card-accent',
  panel:   'card-panel',
  outline: 'bg-transparent border border-[var(--border-card)] rounded-md',
};

const sizeClass: Record<NonNullable<CardProps['size']>, string> = {
  compact: 'p-3',
  default: 'p-5',
  relaxed: 'p-7',
};

export function Card({
  children, className, hover, glow,
  variant = 'default', size = 'default',
  onClick, style,
}: CardProps) {
  return (
    <div
      className={cn(
        variantClass[variant] || 'card-swiss',
        sizeClass[size],
        hover && 'cursor-pointer transition-colors hover:bg-[var(--bg-card-hover)]',
        glow && 'animate-glow-pulse',
        className
      )}
      onClick={onClick}
      style={style}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-3', className)}>{children}</div>;
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn('text-headline-lg t-primary', className)}>{children}</h3>;
}

export function CardDescription({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-caption t-muted mt-0.5', className)}>{children}</p>;
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('', className)}>{children}</div>;
}
