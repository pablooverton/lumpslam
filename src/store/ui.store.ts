import { create } from 'zustand';
import type { ScenarioType } from '@/domain/types/scenarios';
import type { RetirementSeason } from '@/domain/types/simulation';

interface UIStore {
  activeScenario: ScenarioType;
  activeSeason: RetirementSeason | null;
  sideNavOpen: boolean;
  setActiveScenario: (s: ScenarioType) => void;
  setActiveSeason: (s: RetirementSeason | null) => void;
  toggleSideNav: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  activeScenario: 'retire_now',
  activeSeason: null,
  sideNavOpen: true,
  setActiveScenario: (activeScenario) => set({ activeScenario }),
  setActiveSeason: (activeSeason) => set({ activeSeason }),
  toggleSideNav: () => set((s) => ({ sideNavOpen: !s.sideNavOpen })),
}));
