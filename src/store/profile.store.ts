import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ClientProfile } from '@/domain/types/profile';
import type { AssetSnapshot } from '@/domain/types/assets';
import type { SpendingProfile } from '@/domain/types/spending';
import type { GuardrailConfig } from '@/domain/types/scenarios';

interface ProfileStore {
  profile: ClientProfile | null;
  assets: AssetSnapshot | null;
  spending: SpendingProfile | null;
  guardrails: GuardrailConfig;
  setProfile: (p: ClientProfile) => void;
  setAssets: (a: AssetSnapshot) => void;
  setSpending: (s: SpendingProfile) => void;
  setGuardrails: (g: GuardrailConfig) => void;
  reset: () => void;
}

const DEFAULT_GUARDRAILS: GuardrailConfig = {
  upperGuardrailGrowthPct: 0.20,
  lowerGuardrailDropPct: 0.29,
  lowerGuardrailSpendingCutPct: 0.03,
};

export const useProfileStore = create<ProfileStore>()(
  persist(
    (set) => ({
      profile: null,
      assets: null,
      spending: null,
      guardrails: DEFAULT_GUARDRAILS,
      setProfile: (profile) => set({ profile }),
      setAssets: (assets) => set({ assets }),
      setSpending: (spending) => set({ spending }),
      setGuardrails: (guardrails) => set({ guardrails }),
      reset: () =>
        set({ profile: null, assets: null, spending: null, guardrails: DEFAULT_GUARDRAILS }),
    }),
    { name: 'lumpslam-profile' }
  )
);
