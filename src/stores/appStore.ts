import { create } from 'zustand';
import type { User, AtheonLayer, IndustryVertical } from '@/types';

export type Theme = 'dark' | 'light';
export type AccentColor = 'amber' | 'blue' | 'sky' | 'emerald' | 'rose';

const ACCENT_CSS_MAP: Record<AccentColor, { accent: string; hover: string; glow: string; subtle: string }> = {
  amber:   { accent: '#f5c542', hover: '#f0b429', glow: 'rgba(245, 197, 66, 0.12)', subtle: 'rgba(245, 197, 66, 0.08)' },
  blue:    { accent: '#3b82f6', hover: '#2563eb', glow: 'rgba(59, 130, 246, 0.12)', subtle: 'rgba(59, 130, 246, 0.08)' },
  sky:     { accent: '#0ea5e9', hover: '#0284c7', glow: 'rgba(14, 165, 233, 0.12)', subtle: 'rgba(14, 165, 233, 0.08)' },
  emerald: { accent: '#10b981', hover: '#059669', glow: 'rgba(16, 185, 129, 0.12)', subtle: 'rgba(16, 185, 129, 0.08)' },
  rose:    { accent: '#f43f5e', hover: '#e11d48', glow: 'rgba(244, 63, 94, 0.12)', subtle: 'rgba(244, 63, 94, 0.08)' },
};

function applyAccentColor(color: AccentColor) {
  const vars = ACCENT_CSS_MAP[color];
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
  if (savedTheme === 'light') {
    document.body.classList.add('atheon-light');
  }
  if (savedAccent && ACCENT_CSS_MAP[savedAccent]) {
    applyAccentColor(savedAccent);
  }
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  currentLayer: 'apex',
  sidebarOpen: true,
  industry: 'general',
  theme: savedTheme || 'dark',
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
      document.body.classList.toggle('atheon-light', theme === 'light');
    }
    set({ theme });
  },
  toggleTheme: () => set((s) => {
    const next = s.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('atheon-theme', next);
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('atheon-light', next === 'light');
    }
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
