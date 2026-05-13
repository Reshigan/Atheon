import { create } from 'zustand';
import type { User, AtheonLayer, IndustryVertical } from '@/types';
import { api } from '@/lib/api';
import type { ERPCompany } from '@/lib/api';

const SELECTED_COMPANY_LS_KEY = 'atheon_selected_company_id';

export type Theme = 'dark' | 'light';
export type AccentColor = 'indigo' | 'blue' | 'violet' | 'emerald' | 'rose';

type AccentVars = { accent: string; hover: string; glow: string; subtle: string };
const ACCENT_LIGHT: Record<AccentColor, AccentVars> = {
  indigo:  { accent: '#4f46e5', hover: '#4338ca', glow: 'rgba(79, 70, 229, 0.10)', subtle: 'rgba(79, 70, 229, 0.05)' },
  blue:    { accent: '#2563eb', hover: '#1d4ed8', glow: 'rgba(37, 99, 235, 0.10)', subtle: 'rgba(37, 99, 235, 0.05)' },
  violet:  { accent: '#7c3aed', hover: '#6d28d9', glow: 'rgba(124, 58, 237, 0.10)', subtle: 'rgba(124, 58, 237, 0.05)' },
  emerald: { accent: '#059669', hover: '#047857', glow: 'rgba(5, 150, 105, 0.10)', subtle: 'rgba(5, 150, 105, 0.05)' },
  rose:    { accent: '#e11d48', hover: '#be123c', glow: 'rgba(225, 29, 72, 0.10)', subtle: 'rgba(225, 29, 72, 0.05)' },
};
const ACCENT_DARK: Record<AccentColor, AccentVars> = {
  indigo:  { accent: '#818cf8', hover: '#6366f1', glow: 'rgba(129, 140, 248, 0.12)', subtle: 'rgba(129, 140, 248, 0.06)' },
  blue:    { accent: '#3b82f6', hover: '#2563eb', glow: 'rgba(59, 130, 246, 0.12)', subtle: 'rgba(59, 130, 246, 0.06)' },
  violet:  { accent: '#a78bfa', hover: '#8b5cf6', glow: 'rgba(167, 139, 250, 0.12)', subtle: 'rgba(167, 139, 250, 0.06)' },
  emerald: { accent: '#10b981', hover: '#059669', glow: 'rgba(16, 185, 129, 0.12)', subtle: 'rgba(16, 185, 129, 0.06)' },
  rose:    { accent: '#f43f5e', hover: '#e11d48', glow: 'rgba(244, 63, 94, 0.12)', subtle: 'rgba(244, 63, 94, 0.06)' },
};

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function applyAccentColor(color: AccentColor, theme?: Theme) {
  const currentTheme = theme || (typeof document !== 'undefined' && document.body.classList.contains('atheon-dark') ? 'dark' : 'light');
  const map = currentTheme === 'dark' ? ACCENT_DARK : ACCENT_LIGHT;
  const vars = map[color];
  if (!vars || typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--accent', vars.accent);
  root.style.setProperty('--accent-rgb', hexToRgb(vars.accent));
  root.style.setProperty('--accent-hover', vars.hover);
  root.style.setProperty('--accent-glow', vars.glow);
  root.style.setProperty('--accent-subtle', vars.subtle);
  root.style.setProperty('--ring-focus', vars.glow);
}

export interface MfaEnforcementWarning {
  daysRemaining: number;
  reason?: string;
  mfaSetupUrl?: string;
}

interface AppState {
  user: User | null;
  currentLayer: AtheonLayer;
  sidebarOpen: boolean;
  mobileSidebarOpen: boolean;
  industry: IndustryVertical;
  theme: Theme;
  accentColor: AccentColor;
  onboardingDismissed: boolean;
  // Tenant switching for platform admins
  activeTenantId: string | null;
  activeTenantName: string | null;
  activeTenantIndustry: IndustryVertical | null;
  // MFA grace-period warning — captured from the last login response (PR #221).
  mfaEnforcementWarning: MfaEnforcementWarning | null;
  // Multi-company scoping (PR #219/#220/#232) — null = consolidated across all companies
  companies: ERPCompany[];
  companiesLoaded: boolean;
  selectedCompanyId: string | null;
  setUser: (user: User | null) => void;
  setCurrentLayer: (layer: AtheonLayer) => void;
  toggleSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setIndustry: (industry: IndustryVertical) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setAccentColor: (color: AccentColor) => void;
  dismissOnboarding: () => void;
  setActiveTenant: (tenantId: string | null, tenantName: string | null, tenantIndustry: IndustryVertical | null) => void;
  setMfaEnforcementWarning: (w: MfaEnforcementWarning | null) => void;
  // Multi-company actions
  loadCompanies: () => Promise<void>;
  setSelectedCompanyId: (id: string | null) => void;
}

// Default to dark mode for first-time visitors — the Stitch "Athens Executive
// Interface" design system is dark-first (sage on #06090D abyss), so dark
// produces the highest-fidelity match for un-authed visitors.
// Users who explicitly toggle to light via Settings keep that choice
// (localStorage wins). Phase I previously made light the default; this
// (Phase R) reverts after the user signalled they want the live site to
// look like the Stitch design exactly.
const savedTheme = (typeof window !== 'undefined' ? localStorage.getItem('atheon-theme') : null) as Theme | null;
const initialTheme = savedTheme || 'dark';
// Migrate legacy accent values
const rawAccent = typeof window !== 'undefined' ? localStorage.getItem('atheon-accent') : null;
const legacyMap: Record<string, AccentColor> = { amber: 'indigo', teal: 'indigo', sky: 'blue', cyan: 'blue' };
const migratedAccent = rawAccent && legacyMap[rawAccent] ? legacyMap[rawAccent] : rawAccent;
if (rawAccent && legacyMap[rawAccent] && typeof window !== 'undefined') { localStorage.setItem('atheon-accent', legacyMap[rawAccent]); }
const savedAccent = (migratedAccent && ACCENT_LIGHT[migratedAccent as AccentColor] ? migratedAccent : null) as AccentColor | null;
const savedOnboarding = typeof window !== 'undefined' ? localStorage.getItem('atheon-onboarding-dismissed') === 'true' : false;
const savedSelectedCompanyId = typeof window !== 'undefined' ? localStorage.getItem(SELECTED_COMPANY_LS_KEY) : null;

// Apply saved theme to body on initial load
if (typeof document !== 'undefined') {
  if (initialTheme === 'dark') {
    document.body.classList.add('atheon-dark');
  }
  if (savedAccent && ACCENT_LIGHT[savedAccent]) {
    applyAccentColor(savedAccent, initialTheme);
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  currentLayer: 'apex',
  sidebarOpen: true,
  industry: ((typeof window !== 'undefined' ? localStorage.getItem('atheon-active-tenant-industry') : null) || 'general') as IndustryVertical,
  theme: initialTheme,
  accentColor: savedAccent || 'indigo',
  onboardingDismissed: savedOnboarding,
  activeTenantId: typeof window !== 'undefined' ? localStorage.getItem('atheon-active-tenant-id') : null,
  activeTenantName: typeof window !== 'undefined' ? localStorage.getItem('atheon-active-tenant-name') : null,
  activeTenantIndustry: (typeof window !== 'undefined' ? localStorage.getItem('atheon-active-tenant-industry') : null) as IndustryVertical | null,
  mfaEnforcementWarning: (() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem('atheon-mfa-warning');
      return raw ? (JSON.parse(raw) as MfaEnforcementWarning) : null;
    } catch { return null; }
  })(),
  companies: [],
  companiesLoaded: false,
  selectedCompanyId: savedSelectedCompanyId,
  setUser: (user) => set({ user }),
  setCurrentLayer: (layer) => set({ currentLayer: layer }),
  mobileSidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
  setIndustry: (industry) => set({ industry }),
  setTheme: (theme) => {
    localStorage.setItem('atheon-theme', theme);
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('atheon-dark', theme === 'dark');
    }
    const accent = (localStorage.getItem('atheon-accent') as AccentColor) || 'indigo';
    applyAccentColor(accent, theme);
    set({ theme });
  },
  toggleTheme: () => set((s) => {
    const next = s.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('atheon-theme', next);
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('atheon-dark', next === 'dark');
    }
    applyAccentColor(s.accentColor, next);
    return { theme: next };
  }),
  setAccentColor: (color) => {
    localStorage.setItem('atheon-accent', color);
    applyAccentColor(color);
    set({ accentColor: color });
  },
  dismissOnboarding: () => {
    localStorage.setItem('atheon-onboarding-dismissed', 'true');
    set({ onboardingDismissed: true });
  },
  setActiveTenant: (tenantId, tenantName, tenantIndustry) => {
    set({ activeTenantId: tenantId, activeTenantName: tenantName, activeTenantIndustry: tenantIndustry });
    // Persist to localStorage for page reload survival
    if (tenantId) {
      localStorage.setItem('atheon-active-tenant-id', tenantId);
      localStorage.setItem('atheon-active-tenant-name', tenantName || '');
      localStorage.setItem('atheon-active-tenant-industry', tenantIndustry || '');
    } else {
      localStorage.removeItem('atheon-active-tenant-id');
      localStorage.removeItem('atheon-active-tenant-name');
      localStorage.removeItem('atheon-active-tenant-industry');
    }
    // Also update industry filter to match the selected tenant's industry
    if (tenantIndustry) {
      set({ industry: tenantIndustry });
    }
    // Clear company selection when switching tenants — companies are tenant-scoped.
    // Companies will be reloaded for the new tenant by loadCompanies().
    if (typeof window !== 'undefined') localStorage.removeItem(SELECTED_COMPANY_LS_KEY);
    set({ companies: [], companiesLoaded: false, selectedCompanyId: null });
  },
  loadCompanies: async () => {
    try {
      const data = await api.companies.list();
      const companies = data.companies || [];
      set({ companies, companiesLoaded: true });
      // If the persisted selection is no longer present in the list (stale or
      // different tenant), clear it silently.
      const current = get().selectedCompanyId;
      if (current && !companies.some((c) => c.id === current)) {
        if (typeof window !== 'undefined') localStorage.removeItem(SELECTED_COMPANY_LS_KEY);
        set({ selectedCompanyId: null });
      }
    } catch {
      // Non-critical — tenants without any erp_companies rows will get [] via 200 here,
      // and any other failure (404, network) falls through to consolidated view.
      set({ companies: [], companiesLoaded: true });
    }
  },
  setSelectedCompanyId: (id) => {
    if (typeof window !== 'undefined') {
      if (id) localStorage.setItem(SELECTED_COMPANY_LS_KEY, id);
      else localStorage.removeItem(SELECTED_COMPANY_LS_KEY);
    }
    set({ selectedCompanyId: id });
  },
  setMfaEnforcementWarning: (w) => {
    if (typeof window !== 'undefined') {
      if (w) localStorage.setItem('atheon-mfa-warning', JSON.stringify(w));
      else localStorage.removeItem('atheon-mfa-warning');
    }
    set({ mfaEnforcementWarning: w });
  },
}));

/**
 * Hook: the currently selected company id (null = consolidated across all
 * companies). Catalyst/Apex/Pulse fetches should call this and pass the
 * result into api.* calls as the `companyId` argument.
 */
export function useSelectedCompanyId(): string | null {
  return useAppStore((s) => s.selectedCompanyId);
}
