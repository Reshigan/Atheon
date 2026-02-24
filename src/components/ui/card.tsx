import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

export interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export function Card({ children, className, hover, glow, onClick, style }: CardProps) {
  return (
    <div
      className={cn(
                'rounded-xl bg-white border border-gray-200 p-6 shadow-sm',
                hover && 'hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 cursor-pointer',
                glow && 'shadow-[0_0_20px_rgba(99,102,241,0.08)]',
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
  return <div className={cn('mb-4', className)}>{children}</div>;
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn('text-lg font-semibold text-gray-900', className)}>{children}</h3>;
}

export function CardDescription({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-sm text-gray-500 mt-1', className)}>{children}</p>;
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('', className)}>{children}</div>;
}
