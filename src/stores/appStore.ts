import { create } from 'zustand';
import type { User, AtheonLayer, IndustryVertical } from '@/types';

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

function applyAccentColor(color: AccentColor, theme?: Theme) {
  const currentTheme = theme || (typeof document !== 'undefined' && document.body.classList.contains('atheon-dark') ? 'dark' : 'light');
  const map = currentTheme === 'dark' ? ACCENT_DARK : ACCENT_LIGHT;
  const vars = map[color];
  if (!vars || typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--accent', vars.accent);
  root.style.setProperty('--accent-hover', vars.hover);
  root.style.setProperty('--accent-glow', vars.glow);
  root.style.setProperty('--accent-subtle', vars.subtle);
  root.style.setProperty('--ring-focus', vars.glow);
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
  setUser: (user: User | null) => void;
  setCurrentLayer: (layer: AtheonLayer) => void;
  toggleSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setIndustry: (industry: IndustryVertical) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setAccentColor: (color: AccentColor) => void;
  dismissOnboarding: () => void;
}

const savedTheme = (typeof window !== 'undefined' ? localStorage.getItem('atheon-theme') : null) as Theme | null;
// Migrate legacy accent values
const rawAccent = typeof window !== 'undefined' ? localStorage.getItem('atheon-accent') : null;
const legacyMap: Record<string, AccentColor> = { amber: 'indigo', teal: 'indigo', sky: 'blue', cyan: 'blue' };
const migratedAccent = rawAccent && legacyMap[rawAccent] ? legacyMap[rawAccent] : rawAccent;
if (rawAccent && legacyMap[rawAccent] && typeof window !== 'undefined') { localStorage.setItem('atheon-accent', legacyMap[rawAccent]); }
const savedAccent = (migratedAccent && ACCENT_LIGHT[migratedAccent as AccentColor] ? migratedAccent : null) as AccentColor | null;
const savedOnboarding = typeof window !== 'undefined' ? localStorage.getItem('atheon-onboarding-dismissed') === 'true' : false;

// Apply saved theme to body on initial load
if (typeof document !== 'undefined') {
  if (savedTheme === 'dark') {
    document.body.classList.add('atheon-dark');
  }
  if (savedAccent && ACCENT_LIGHT[savedAccent]) {
    applyAccentColor(savedAccent, savedTheme || 'light');
  }
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  currentLayer: 'apex',
  sidebarOpen: true,
  industry: 'general',
  theme: savedTheme || 'light',
  accentColor: savedAccent || 'indigo',
  onboardingDismissed: savedOnboarding,
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
}));
