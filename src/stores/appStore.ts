import { create } from 'zustand';
import type { User, AtheonLayer, IndustryVertical } from '@/types';

interface AppState {
  user: User | null;
  currentLayer: AtheonLayer;
  sidebarOpen: boolean;
  industry: IndustryVertical;
  setUser: (user: User | null) => void;
  setCurrentLayer: (layer: AtheonLayer) => void;
  toggleSidebar: () => void;
  setIndustry: (industry: IndustryVertical) => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: {
    id: '1',
    email: 'admin@vantax.co.za',
    name: 'Reshigan',
    role: 'admin',
    tenantId: 'vantax',
    permissions: ['*'],
  },
  currentLayer: 'apex',
  sidebarOpen: true,
  industry: 'general',
  setUser: (user) => set({ user }),
  setCurrentLayer: (layer) => set({ currentLayer: layer }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setIndustry: (industry) => set({ industry }),
}));
