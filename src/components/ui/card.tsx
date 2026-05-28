import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

export interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
  variant?: 'default' | 'black' | 'mint' | 'accent' | 'glass' | 'outline';
  /** Padding scale. `default` = 20px (most cards); `compact` = 12px
   *  (dense bento tiles, KPI mini-cards); `relaxed` = 28px (top-level
   *  hero cards that anchor a screen). Avoid freelance className overrides
   *  — pick a size and let the design tokens enforce rhythm. */
  size?: 'default' | 'compact' | 'relaxed';
  onClick?: () => void;
  style?: React.CSSProperties;
}

const variantClass: Record<string, string> = {
  default: 'card-glass',
  black: 'card-black',
  mint: 'card-mint',
  accent: 'card-teal',
  glass: 'card-glass',
  outline: 'card-glass',
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
        variantClass[variant] || 'card-glass',
        sizeClass[size],
        'rounded-2xl',
        hover && 'cursor-pointer hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-0.5',
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
