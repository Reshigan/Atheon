import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

export interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
  variant?: 'default' | 'black' | 'mint' | 'accent' | 'glass' | 'outline';
  onClick?: () => void;
  style?: React.CSSProperties;
}

const variantClass: Record<string, string> = {
  default: 'card-dark',
  black: 'card-black',
  mint: 'card-mint',
  accent: 'card-teal',
  glass: 'card-glass',
  outline: 'card-dark',
};

export function Card({ children, className, hover, glow, variant = 'default', onClick, style }: CardProps) {
  return (
    <div
      className={cn(
        variantClass[variant] || 'card-dark',
        'p-5 rounded-xl',
        hover && 'cursor-pointer hover:shadow-[var(--shadow-card-hover)]',
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
  return <h3 className={cn('text-sm font-semibold t-primary', className)}>{children}</h3>;
}

export function CardDescription({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-xs t-muted mt-0.5', className)}>{children}</p>;
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('', className)}>{children}</div>;
}
