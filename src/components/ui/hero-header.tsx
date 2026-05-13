/**
 * `<HeroHeader>` — the canonical page-band that opens every primary screen.
 *
 * Lifted from the Stitch \"Athens Executive Interface\" design where every
 * module screen (Apex, Pulse, Catalysts, ROI, Memory, Audit, Compliance,
 * IAM, Integrations, Chat, …) starts with the same shape:
 *
 *   ┌──┐  TITLE (text-headline-xl, tracking-tight)
 *   │🔷│  Subtitle (text-body-sm, t-muted)
 *   └──┘
 *
 * Phases C/F/G shipped this pattern inline on 10 different pages. This
 * primitive collapses the duplication and gives us one place to evolve the
 * shape (responsive density, optional badges, sticky-on-scroll, etc.).
 *
 * Accent presets correspond to the Stitch module palette:
 *   - sage    → executive surfaces (Apex / IAM / Audit / ROI / Chat)
 *   - sky     → process + data surfaces (Pulse / Memory / Integrations)
 *   - bronze  → operations (Catalysts / actions)
 *   - amber   → urgency
 *   - red     → critical / system alerts
 */
import type { ReactNode, ComponentType } from 'react';

type Accent = 'sage' | 'sky' | 'bronze' | 'amber' | 'red';

interface AccentTokens {
  bg: string;
  border: string;
  fg: string;
}

const ACCENT: Record<Accent, AccentTokens> = {
  sage:   { bg: 'rgba(163, 177, 138, 0.10)', border: 'rgba(163, 177, 138, 0.25)', fg: 'var(--accent)' },
  sky:    { bg: 'rgba(126, 179, 205, 0.10)', border: 'rgba(126, 179, 205, 0.25)', fg: 'var(--sky)' },
  bronze: { bg: 'rgba(205, 163, 126, 0.10)', border: 'rgba(205, 163, 126, 0.25)', fg: 'var(--bronze)' },
  amber:  { bg: 'rgba(251, 191, 36, 0.10)',  border: 'rgba(251, 191, 36, 0.25)',  fg: '#FBBF24' },
  red:    { bg: 'rgba(248, 113, 113, 0.10)', border: 'rgba(248, 113, 113, 0.25)', fg: '#F87171' },
};

export interface HeroHeaderProps {
  /** Lucide / Material / any icon component taking `className`. Rendered inside
   *  the bordered tile. */
  icon: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  /** The module name. Short — \"Apex\", \"Catalysts\", \"Memory\". */
  title: string;
  /** One-line context line. \"Executive Intelligence & Strategic Context\". */
  subtitle?: ReactNode;
  /** Accent preset for the icon tile. Defaults to sage. */
  accent?: Accent;
  /** Anything to drop to the right of the title — e.g. a freshness chip,
   *  a CSV export button, a CTA. */
  trailing?: ReactNode;
  className?: string;
}

export function HeroHeader({
  icon: Icon,
  title,
  subtitle,
  accent = 'sage',
  trailing,
  className = '',
}: HeroHeaderProps): JSX.Element {
  const tokens = ACCENT[accent];
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className="w-10 h-10 rounded flex items-center justify-center border flex-shrink-0"
        style={{ background: tokens.bg, borderColor: tokens.border }}
        aria-hidden="true"
      >
        <Icon className="w-5 h-5" style={{ color: tokens.fg }} />
      </div>
      <div className="flex-1 min-w-0">
        <h1 className="text-headline-xl font-bold t-primary tracking-tight leading-tight">{title}</h1>
        {subtitle && (
          <p className="text-body-sm t-muted mt-0.5">{subtitle}</p>
        )}
      </div>
      {trailing}
    </div>
  );
}
