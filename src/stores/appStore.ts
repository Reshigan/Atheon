import { create } from 'zustand';
import type { User, AtheonLayer, IndustryVertical } from '@/types';

export type Theme = 'dark' | 'light';

interface AppState {
  user: User | null;
  currentLayer: AtheonLayer;
  sidebarOpen: boolean;
  mobileSidebarOpen: boolean;
  industry: IndustryVertical;
  theme: Theme;
  onboardingDismissed: boolean;
  setUser: (user: User | null) => void;
  setCurrentLayer: (layer: AtheonLayer) => void;
  toggleSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setIndustry: (industry: IndustryVertical) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  dismissOnboarding: () => void;
}

const savedTheme = (typeof window !== 'undefined' ? localStorage.getItem('atheon-theme') : null) as Theme | null;
const savedOnboarding = typeof window !== 'undefined' ? localStorage.getItem('atheon-onboarding-dismissed') === 'true' : false;

// Apply saved theme to body on initial load
if (typeof document !== 'undefined' && savedTheme === 'light') {
  document.body.classList.add('atheon-light');
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  currentLayer: 'apex',
  sidebarOpen: true,
  industry: 'general',
  theme: savedTheme || 'dark',
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
  dismissOnboarding: () => {
    localStorage.setItem('atheon-onboarding-dismissed', 'true');
    set({ onboardingDismissed: true });
  },
}));
