import { create } from 'zustand';
import type { User, AtheonLayer, IndustryVertical } from '@/types';
import { api } from '@/lib/api';
import type { ERPCompany } from '@/lib/api';

const SELECTED_COMPANY_LS_KEY = 'atheon_selected_company_id';

export type Theme = 'dark' | 'light';
export type AccentColor = 'indigo' | 'blue' | 'violet' | 'emerald' | 'rose';

// Swiss Calm Authority is single-accent (ledger green) + light-only. The
// runtime accent picker and theme toggle are retired: the accent lives in
// :root (src/index.css) and is never overridden at runtime. AccentColor is
// kept only so the settings UI keeps compiling until the shell is restyled.
const VALID_ACCENTS: readonly AccentColor[] = ['indigo', 'blue', 'violet', 'emerald', 'rose'];

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
  /** @deprecated Dark mode retired — the `theme` argument is ignored; the app is permanently light. */
  setTheme: (theme: Theme) => void;
  /** @deprecated Dark mode retired — keeps the theme light; kept only for existing call sites. */
  toggleTheme: () => void;
  setAccentColor: (color: AccentColor) => void;
  dismissOnboarding: () => void;
  setActiveTenant: (tenantId: string | null, tenantName: string | null, tenantIndustry: IndustryVertical | null) => void;
  setMfaEnforcementWarning: (w: MfaEnforcementWarning | null) => void;
  // Multi-company actions
  loadCompanies: () => Promise<void>;
  setSelectedCompanyId: (id: string | null) => void;
}

// Swiss Calm Authority is light-only; the legacy .atheon-dark class is
// never applied, so :root in index.css is the canonical (and only) theme.
const initialTheme: Theme = 'light';
// Migrate legacy accent values
const rawAccent = typeof window !== 'undefined' ? localStorage.getItem('atheon-accent') : null;
const legacyMap: Record<string, AccentColor> = { amber: 'indigo', teal: 'indigo', sky: 'blue', cyan: 'blue' };
const migratedAccent = rawAccent && legacyMap[rawAccent] ? legacyMap[rawAccent] : rawAccent;
if (rawAccent && legacyMap[rawAccent] && typeof window !== 'undefined') { localStorage.setItem('atheon-accent', legacyMap[rawAccent]); }
const savedAccent = (migratedAccent && VALID_ACCENTS.includes(migratedAccent as AccentColor) ? migratedAccent : null) as AccentColor | null;
const savedOnboarding = typeof window !== 'undefined' ? localStorage.getItem('atheon-onboarding-dismissed') === 'true' : false;
const savedSelectedCompanyId = typeof window !== 'undefined' ? localStorage.getItem(SELECTED_COMPANY_LS_KEY) : null;

// Light-only (Swiss): defensively clear any persisted dark class on load.
if (typeof document !== 'undefined') {
  document.body.classList.remove('atheon-dark');
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
  setTheme: () => {
    // Dark mode retired — the `theme` arg is ignored; always light.
    localStorage.setItem('atheon-theme', 'light');
    if (typeof document !== 'undefined') document.body.classList.remove('atheon-dark');
    set({ theme: 'light' });
  },
  toggleTheme: () => get().setTheme('light'),
  setAccentColor: (color) => {
    // Single-accent (ledger green): selection is persisted for the settings
    // UI but no longer overrides the CSS accent token.
    localStorage.setItem('atheon-accent', color);
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
