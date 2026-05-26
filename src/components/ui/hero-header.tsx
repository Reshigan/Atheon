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
  /** Small-caps editorial line above the title — v2 eyebrow. Defaults to
   *  \"ATHEON · ENTERPRISE INTELLIGENCE\" when omitted. Pass null to hide. */
  eyebrow?: ReactNode | null;
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
  eyebrow,
  accent = 'sage',
  trailing,
  className = '',
}: HeroHeaderProps): JSX.Element {
  const tokens = ACCENT[accent];
  const showEyebrow = eyebrow !== null;
  const eyebrowContent = eyebrow === undefined
    ? <>Atheon <span className="opacity-50 mx-1">·</span> Enterprise Intelligence</>
    : eyebrow;
  return (
    <div className={`relative flex items-center gap-4 ${className}`}>
      {/* v2: stronger icon tile — navy/sage gradient with subtle inset highlight */}
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center border flex-shrink-0 shadow-sm relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${tokens.bg}, ${tokens.bg.replace('0.10', '0.04')})`,
          borderColor: tokens.border,
        }}
        aria-hidden="true"
      >
        <span
          className="absolute inset-0 opacity-60"
          style={{ background: `radial-gradient(120% 80% at 0% 0%, ${tokens.bg.replace('0.10', '0.25')} 0%, transparent 60%)` }}
        />
        <Icon className="w-5 h-5 relative" style={{ color: tokens.fg }} />
      </div>
      <div className="flex-1 min-w-0">
        {showEyebrow && (
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.18em] mb-0.5"
            style={{ color: tokens.fg, opacity: 0.85 }}
          >
            {eyebrowContent}
          </p>
        )}
        <h1 className="text-headline-xl font-bold t-primary tracking-tight leading-tight">{title}</h1>
        {subtitle && (
          <p className="text-body-sm t-muted mt-0.5">{subtitle}</p>
        )}
      </div>
      {trailing && <div className="flex-shrink-0">{trailing}</div>}
    </div>
  );
}
