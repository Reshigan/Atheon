/**
 * `<PageHeader>` — the Swiss masthead that opens a primary screen.
 *
 *   EYEBROW · letterspaced caps  (+ optional live tick)
 *   Display Title                (Archivo 900, text-display)
 *   Optional dek                 (muted, one restrained line)
 *   ──────────────────────────── 1.5px ink rule
 *
 * Authority comes from the type scale and the single hard rule beneath —
 * not from colour or ornament. The accent appears only as the eyebrow and
 * the optional live tick.
 */
import { cn } from "@/lib/utils";
import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Letterspaced caps kicker above the title. */
  eyebrow: string;
  /** Display title — rendered in Archivo 900. */
  title: string;
  /** Optional single supporting line. */
  dek?: string;
  /** Show a pulsing accent tick before the eyebrow (live / real-time data). */
  live?: boolean;
  /** Right-aligned actions (buttons, switchers). */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, title, dek, live, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn('pb-4 mb-6 border-b', className)}
      style={{ borderColor: 'var(--line-strong)', borderBottomWidth: '1.5px' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-eyebrow t-accent flex items-center gap-1.5 uppercase">
            {live && (
              <span
                aria-hidden
                className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ background: 'var(--accent)' }}
              />
            )}
            {eyebrow}
          </p>
          <h1 className="text-display t-primary mt-1.5 truncate">{title}</h1>
          {dek && <p className="text-body-sm t-muted mt-2 max-w-2xl">{dek}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
