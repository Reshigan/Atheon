import { create } from 'zustand';
import type { User, AtheonLayer, IndustryVertical } from '@/types';

export type Theme = 'dark' | 'light';
export type AccentColor = 'amber' | 'blue' | 'sky' | 'emerald' | 'rose';

type AccentVars = { accent: string; hover: string; glow: string; subtle: string };
const ACCENT_LIGHT: Record<AccentColor, AccentVars> = {
  amber:   { accent: '#e8a000', hover: '#d49200', glow: 'rgba(232, 160, 0, 0.12)', subtle: 'rgba(232, 160, 0, 0.06)' },
  blue:    { accent: '#2563eb', hover: '#1d4ed8', glow: 'rgba(37, 99, 235, 0.12)', subtle: 'rgba(37, 99, 235, 0.06)' },
  sky:     { accent: '#0284c7', hover: '#0369a1', glow: 'rgba(2, 132, 199, 0.12)', subtle: 'rgba(2, 132, 199, 0.06)' },
  emerald: { accent: '#059669', hover: '#047857', glow: 'rgba(5, 150, 105, 0.12)', subtle: 'rgba(5, 150, 105, 0.06)' },
  rose:    { accent: '#e11d48', hover: '#be123c', glow: 'rgba(225, 29, 72, 0.12)', subtle: 'rgba(225, 29, 72, 0.06)' },
};
const ACCENT_DARK: Record<AccentColor, AccentVars> = {
  amber:   { accent: '#f5c542', hover: '#f0b429', glow: 'rgba(245, 197, 66, 0.12)', subtle: 'rgba(245, 197, 66, 0.08)' },
  blue:    { accent: '#3b82f6', hover: '#2563eb', glow: 'rgba(59, 130, 246, 0.12)', subtle: 'rgba(59, 130, 246, 0.08)' },
  sky:     { accent: '#0ea5e9', hover: '#0284c7', glow: 'rgba(14, 165, 233, 0.12)', subtle: 'rgba(14, 165, 233, 0.08)' },
  emerald: { accent: '#10b981', hover: '#059669', glow: 'rgba(16, 185, 129, 0.12)', subtle: 'rgba(16, 185, 129, 0.08)' },
  rose:    { accent: '#f43f5e', hover: '#e11d48', glow: 'rgba(244, 63, 94, 0.12)', subtle: 'rgba(244, 63, 94, 0.08)' },
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
const savedAccent = (typeof window !== 'undefined' ? localStorage.getItem('atheon-accent') : null) as AccentColor | null;
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
  accentColor: savedAccent || 'amber',
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
    // Re-apply accent color for new theme
    const accent = (localStorage.getItem('atheon-accent') as AccentColor) || 'amber';
    applyAccentColor(accent, theme);
    set({ theme });
  },
  toggleTheme: () => set((s) => {
    const next = s.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('atheon-theme', next);
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('atheon-dark', next === 'dark');
    }
    // Re-apply accent color for new theme
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
