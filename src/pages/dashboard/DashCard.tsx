import type { CSSProperties, ReactNode } from 'react';

interface DashCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function DashCard({ children, className = "", style }: DashCardProps) {
  return (
    <div
      className={`rounded-2xl p-5 ${className}`}
      style={{
        background: "var(--bg-card-solid)",
        border: "1px solid var(--border-card)",
        boxShadow: "0 2px 12px rgba(100, 120, 180, 0.07), 0 0 0 1px rgba(255,255,255,0.5)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function TintedCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl p-5 ${className}`}
      style={{
        background: "linear-gradient(135deg, rgba(163, 177, 138, 0.06), rgba(126, 179, 205, 0.03))",
        border: "1px solid rgba(163, 177, 138, 0.10)",
        boxShadow: "0 2px 12px rgba(163, 177, 138, 0.05)",
      }}
    >
      {children}
    </div>
  );
}
