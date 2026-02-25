import { useId, type SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const defaultProps = (size = 18): Pick<SVGProps<SVGSVGElement>, 'width' | 'height' | 'viewBox' | 'fill' | 'xmlns'> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
});

/** Glass gradient defs — unique per instance via useId */
function GlassGradient({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="3" y1="3" x2="21" y2="21">
        <stop offset="0%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.9" />
        <stop offset="100%" stopColor="rgb(var(--accent-rgb))" stopOpacity="0.6" />
      </linearGradient>
    </defs>
  );
}

/** Dashboard — glass 4-panel grid with rounded corners */
export function IconDashboard({ size = 18, ...props }: IconProps) {
  const gid = useId();
  return (
    <svg {...defaultProps(size)} {...props}>
      <GlassGradient id={gid} />
      <rect x="3" y="3" width="8" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="2.5" fill={`url(#${gid})`} opacity="0.15" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Apex — crystal prism peak with glass effect */
export function IconApex({ size = 18, ...props }: IconProps) {
  const gid = useId();
  return (
    <svg {...defaultProps(size)} {...props}>
      <GlassGradient id={gid} />
      <path d="M12 2L4 14h5.5l-1.5 8 10-12h-5.5l1.5-8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 2l-2 6h5.5l-3.5 4" fill={`url(#${gid})`} opacity="0.12" />
    </svg>
  );
}

/** Pulse — glass heartbeat with glow dot */
export function IconPulse({ size = 18, ...props }: IconProps) {
  const gid = useId();
  return (
    <svg {...defaultProps(size)} {...props}>
      <GlassGradient id={gid} />
      <path d="M3 12h3l2-7 4 14 3-9 2 4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2" fill={`url(#${gid})`} opacity="0.25" />
    </svg>
  );
}

/** Catalysts — glass sparkle wand with orbital dot */
export function IconCatalysts({ size = 18, ...props }: IconProps) {
  const gid = useId();
  return (
    <svg {...defaultProps(size)} {...props}>
      <GlassGradient id={gid} />
      <path d="M9.5 14.5L3 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 4l-4.5 10.5L20 10 14 4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M14 4l-4.5 10.5L20 10 14 4z" fill={`url(#${gid})`} opacity="0.10" />
      <circle cx="19" cy="5" r="1.5" fill={`url(#${gid})`} opacity="0.5" />
      <circle cx="17" cy="2.5" r="0.8" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

/** Mind — glass brain with inner glow */
export function IconMind({ size = 18, ...props }: IconProps) {
  const gid = useId();
  return (
    <svg {...defaultProps(size)} {...props}>
      <GlassGradient id={gid} />
      <path d="M12 2a7 7 0 00-7 7c0 2.5 1.3 4.6 3.3 5.8L7.5 21h9l-.8-6.2A7 7 0 0012 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 2a7 7 0 00-7 7c0 2.5 1.3 4.6 3.3 5.8L7.5 21h9l-.8-6.2A7 7 0 0012 2z" fill={`url(#${gid})`} opacity="0.08" />
      <path d="M9 10c1 1 2 1.5 3 1.5s2-.5 3-1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

/** Memory — glass stacked layers with depth */
export function IconMemory({ size = 18, ...props }: IconProps) {
  const gid = useId();
  return (
    <svg {...defaultProps(size)} {...props}>
      <GlassGradient id={gid} />
      <ellipse cx="12" cy="6" rx="8" ry="3" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="12" cy="6" rx="8" ry="3" fill={`url(#${gid})`} opacity="0.10" />
      <path d="M4 6v5c0 1.66 3.58 3 8 3s8-1.34 8-3V6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 11v5c0 1.66 3.58 3 8 3s8-1.34 8-3v-5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Chat — glass speech bubble with glow dots */
export function IconChat({ size = 18, ...props }: IconProps) {
  const gid = useId();
  return (
    <svg {...defaultProps(size)} {...props}>
      <GlassGradient id={gid} />
      <path d="M21 12c0 4.418-4.03 8-9 8-1.6 0-3.1-.36-4.4-1L3 21l1.8-3.6C3.66 16 3 14.1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M21 12c0 4.418-4.03 8-9 8-1.6 0-3.1-.36-4.4-1L3 21l1.8-3.6C3.66 16 3 14.1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" fill={`url(#${gid})`} opacity="0.08" />
      <circle cx="8.5" cy="12" r="0.85" fill="currentColor" opacity="0.45" />
      <circle cx="12" cy="12" r="0.85" fill="currentColor" opacity="0.45" />
      <circle cx="15.5" cy="12" r="0.85" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

/** Clients — glass people group */
export function IconClients({ size = 18, ...props }: IconProps) {
  const gid = useId();
  return (
    <svg {...defaultProps(size)} {...props}>
      <GlassGradient id={gid} />
      <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="7" r="3" fill={`url(#${gid})`} opacity="0.10" />
      <path d="M3 20c0-3.31 2.69-6 6-6s6 2.69 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="17" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M17 14c2.76 0 5 2.24 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** IAM — glass shield with inner check */
export function IconIAM({ size = 18, ...props }: IconProps) {
  const gid = useId();
  return (
    <svg {...defaultProps(size)} {...props}>
      <GlassGradient id={gid} />
      <path d="M12 2L4 6v5c0 5.25 3.4 10.15 8 11.4 4.6-1.25 8-6.15 8-11.4V6l-8-4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 2L4 6v5c0 5.25 3.4 10.15 8 11.4 4.6-1.25 8-6.15 8-11.4V6l-8-4z" fill={`url(#${gid})`} opacity="0.08" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Control Plane — glass chip/CPU with glow */
export function IconControlPlane({ size = 18, ...props }: IconProps) {
  const gid = useId();
  return (
    <svg {...defaultProps(size)} {...props}>
      <GlassGradient id={gid} />
      <rect x="6" y="6" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill={`url(#${gid})`} opacity="0.10" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Canonical API — glass globe with orbital lines */
export function IconCanonicalApi({ size = 18, ...props }: IconProps) {
  const gid = useId();
  return (
    <svg {...defaultProps(size)} {...props}>
      <GlassGradient id={gid} />
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="9" fill={`url(#${gid})`} opacity="0.06" />
      <ellipse cx="12" cy="12" rx="4" ry="9" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
      <path d="M3 12h18" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
      <path d="M5 7.5h14" stroke="currentColor" strokeWidth="0.8" opacity="0.25" />
      <path d="M5 16.5h14" stroke="currentColor" strokeWidth="0.8" opacity="0.25" />
    </svg>
  );
}

/** ERP Adapters — glass plug with connection glow */
export function IconERPAdapters({ size = 18, ...props }: IconProps) {
  const gid = useId();
  return (
    <svg {...defaultProps(size)} {...props}>
      <GlassGradient id={gid} />
      <path d="M12 2v5M8 2v3M16 2v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="6" y="7" width="12" height="5" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6" y="7" width="12" height="5" rx="2.5" fill={`url(#${gid})`} opacity="0.10" />
      <path d="M12 12v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="18" r="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Connectivity — glass chain links */
export function IconConnectivity({ size = 18, ...props }: IconProps) {
  const gid = useId();
  return (
    <svg {...defaultProps(size)} {...props}>
      <GlassGradient id={gid} />
      <path d="M10 13a4 4 0 005.66 0l2-2a4 4 0 00-5.66-5.66l-1 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 11a4 4 0 00-5.66 0l-2 2a4 4 0 005.66 5.66l1-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.5" fill={`url(#${gid})`} opacity="0.25" />
    </svg>
  );
}

/** Audit — glass clipboard with check */
export function IconAudit({ size = 18, ...props }: IconProps) {
  const gid = useId();
  return (
    <svg {...defaultProps(size)} {...props}>
      <GlassGradient id={gid} />
      <rect x="5" y="3" width="14" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5" y="3" width="14" height="18" rx="2.5" fill={`url(#${gid})`} opacity="0.06" />
      <path d="M9 3V1h6v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Settings — glass gear with inner glow */
export function IconSettings({ size = 18, ...props }: IconProps) {
  const gid = useId();
  return (
    <svg {...defaultProps(size)} {...props}>
      <GlassGradient id={gid} />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3" fill={`url(#${gid})`} opacity="0.15" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
