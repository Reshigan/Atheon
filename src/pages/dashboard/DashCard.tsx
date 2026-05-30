import type { CSSProperties, ReactNode } from 'react';

interface DashCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function DashCard({ children, className = "", style }: DashCardProps) {
  return (
    <div
      className={`rounded-md p-5 ${className}`}
      style={{
        background: "var(--bg-card-solid)",
        border: "1px solid var(--border-card)",
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
      className={`rounded-md p-5 ${className}`}
      style={{
        background: "rgb(var(--accent-rgb) / 0.05)",
        border: "1px solid rgb(var(--accent-rgb) / 0.10)",
      }}
    >
      {children}
    </div>
  );
}
