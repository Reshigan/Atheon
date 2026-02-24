import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const defaultProps = (size = 18): Pick<SVGProps<SVGSVGElement>, 'width' | 'height' | 'viewBox' | 'fill' | 'xmlns'> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
});

/** Dashboard — 4-panel grid */
export function IconDashboard({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Apex — diamond / crystal peak */
export function IconApex({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <path d="M12 3L3 13h6l-1 8 10-12h-6l1-6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Pulse — heartbeat line */
export function IconPulse({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <path d="M3 12h3l2-7 4 14 3-9 2 4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Catalysts — sparkle / magic wand */
export function IconCatalysts({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <path d="M9.5 14.5L3 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 4l-4.5 10.5L20 10 14 4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="19" cy="5" r="1" fill="currentColor" opacity="0.5" />
      <circle cx="17" cy="2.5" r="0.5" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

/** Mind — brain outline */
export function IconMind({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <path d="M12 2a7 7 0 00-7 7c0 2.5 1.3 4.6 3.3 5.8L7.5 21h9l-.8-6.2A7 7 0 0012 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 10c1 1 2 1.5 3 1.5s2-.5 3-1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

/** Memory — stacked layers */
export function IconMemory({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <ellipse cx="12" cy="6" rx="8" ry="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 6v5c0 1.66 3.58 3 8 3s8-1.34 8-3V6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 11v5c0 1.66 3.58 3 8 3s8-1.34 8-3v-5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Chat — speech bubble */
export function IconChat({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <path d="M21 12c0 4.418-4.03 8-9 8-1.6 0-3.1-.36-4.4-1L3 21l1.8-3.6C3.66 16 3 14.1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="8.5" cy="12" r="0.75" fill="currentColor" opacity="0.5" />
      <circle cx="12" cy="12" r="0.75" fill="currentColor" opacity="0.5" />
      <circle cx="15.5" cy="12" r="0.75" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/** Clients — people group */
export function IconClients({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 20c0-3.31 2.69-6 6-6s6 2.69 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="17" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M17 14c2.76 0 5 2.24 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** IAM — shield */
export function IconIAM({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <path d="M12 2L4 6v5c0 5.25 3.4 10.15 8 11.4 4.6-1.25 8-6.15 8-11.4V6l-8-4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Control Plane — chip/CPU */
export function IconControlPlane({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Canonical API — globe */
export function IconCanonicalApi({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="12" cy="12" rx="4" ry="9" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
      <path d="M3 12h18" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
    </svg>
  );
}

/** ERP Adapters — plug */
export function IconERPAdapters({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <path d="M12 2v5M8 2v3M16 2v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="6" y="7" width="12" height="5" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 12v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="18" r="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Connectivity — chain links */
export function IconConnectivity({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <path d="M10 13a4 4 0 005.66 0l2-2a4 4 0 00-5.66-5.66l-1 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 11a4 4 0 00-5.66 0l-2 2a4 4 0 005.66 5.66l1-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Audit — clipboard check */
export function IconAudit({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 3V1h6v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Settings — gear */
export function IconSettings({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
