import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const defaultProps = (size = 18): Pick<SVGProps<SVGSVGElement>, 'width' | 'height' | 'viewBox' | 'fill' | 'xmlns'> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
});

/** Dashboard - Command centre grid with pulse dot */
export function IconDashboard({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="3" width="7" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="6.5" cy="6.5" r="1" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

/** Apex - Crown with rising signal bars */
export function IconApex({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <path d="M4 17L7 8l5 5 5-9 3 13H4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="6" r="1.5" fill="currentColor" opacity="0.5" />
      <path d="M6 20h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Pulse - Heartbeat/waveform line */
export function IconPulse({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <path d="M2 12h4l2-6 3 12 3-8 2 4h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

/** Catalysts - Lightning bolt with gear */
export function IconCatalysts({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="17" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
      <circle cx="17" cy="7" r="1" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/** Mind - Brain with neural connections */
export function IconMind({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <path d="M12 2C8 2 5 5 5 8.5c0 2 1 3.5 2.5 4.5L7 22h10l-.5-9c1.5-1 2.5-2.5 2.5-4.5C19 5 16 2 12 2z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 9c0 0 1.5 2 3 2s3-2 3-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />
      <circle cx="9.5" cy="7" r="1" fill="currentColor" opacity="0.5" />
      <circle cx="14.5" cy="7" r="1" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/** Memory - Database with graph nodes */
export function IconMemory({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <ellipse cx="12" cy="6" rx="8" ry="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

/** Chat - Speech bubble with dots */
export function IconChat({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <path d="M21 12c0 4.418-4.03 8-9 8-1.6 0-3.1-.36-4.4-1L3 21l1.8-3.6C3.66 16 3 14.1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="8.5" cy="12" r="1" fill="currentColor" opacity="0.6" />
      <circle cx="12" cy="12" r="1" fill="currentColor" opacity="0.6" />
      <circle cx="15.5" cy="12" r="1" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

/** Clients/Tenants - Building with people */
export function IconClients({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <rect x="3" y="6" width="12" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="6" y="9" width="2.5" height="2.5" rx="0.5" fill="currentColor" opacity="0.4" />
      <rect x="10" y="9" width="2.5" height="2.5" rx="0.5" fill="currentColor" opacity="0.4" />
      <rect x="6" y="14" width="2.5" height="2.5" rx="0.5" fill="currentColor" opacity="0.4" />
      <rect x="10" y="14" width="2.5" height="2.5" rx="0.5" fill="currentColor" opacity="0.4" />
      <path d="M15 10h3a2 2 0 012 2v9H15" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 6l6-3 6 3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/** IAM - Shield with key */
export function IconIAM({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <path d="M12 2L4 6v5c0 5.25 3.4 10.15 8 11.4 4.6-1.25 8-6.15 8-11.4V6l-8-4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 12v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 15h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Control Plane - CPU with connections */
export function IconControlPlane({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity="0.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Canonical API - Globe with code brackets */
export function IconCanonicalApi({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <ellipse cx="12" cy="12" rx="4" ry="9" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
      <path d="M3 12h18" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
      <path d="M5 7h14M5 17h14" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <path d="M9 10l-2 2 2 2M15 10l2 2-2 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** ERP Adapters - Plug with data flow */
export function IconERPAdapters({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <path d="M12 2v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 2v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 2v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="6" y="6" width="12" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 11v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="18" r="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="18" r="1" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/** Connectivity - Link chain with signals */
export function IconConnectivity({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <path d="M10 14l-2 2a3 3 0 010-4.24L10 9.76" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14 10l2-2a3 3 0 010 4.24L14 14.24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 14l4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 8a8 8 0 010-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.4" />
      <path d="M20 20a8 8 0 010-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.4" />
      <circle cx="6" cy="6" r="1.5" fill="currentColor" opacity="0.3" />
      <circle cx="18" cy="18" r="1.5" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

/** Audit - Clipboard with checkmark */
export function IconAudit({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 3V2a1 1 0 011-1h4a1 1 0 011 1v1" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 17h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.4" />
      <path d="M8 8h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}

/** Settings - Gear with sliders */
export function IconSettings({ size = 18, ...props }: IconProps) {
  return (
    <svg {...defaultProps(size)} {...props}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1" fill="currentColor" opacity="0.4" />
    </svg>
  );
}
