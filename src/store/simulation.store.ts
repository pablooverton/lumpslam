import { create } from 'zustand';
import type { ScenarioResult, ScenarioType } from '@/domain/types/scenarios';
import type { SocialSecurityComparison } from '@/domain/types/social-security';
import type { OpportunityReport } from '@/domain/types/opportunities';
import type { ContingencyReport } from '@/domain/types/contingency';
import { runSimulation } from '@/domain/engine/simulation-runner';
import { buildSocialSecurityComparison } from '@/domain/engine/social-security';
import { assessOpportunities } from '@/domain/engine/opportunities';
import { buildContingencyReport } from '@/domain/engine/contingency';
import { useProfileStore } from './profile.store';

interface SimulationStore {
  scenarios: ScenarioResult[];
  ssComparison: SocialSecurityComparison | null;
  opportunities: OpportunityReport | null;
  // Contingency is computed for all three scenarios so pages can switch without re-running.
  contingencies: Partial<Record<ScenarioType, ContingencyReport>>;
  selectedScenarioType: ScenarioType;
  setSelectedScenarioType: (type: ScenarioType) => void;
  isStale: boolean;
  isRunning: boolean;
  runSimulations: () => void;
  markStale: () => void;
}

export const useSimulationStore = create<SimulationStore>((set) => ({
  scenarios: [],
  ssComparison: null,
  opportunities: null,
  contingencies: {},
  selectedScenarioType: 'retire_at_stated_date',
  isStale: true,
  isRunning: false,

  markStale: () => set({ isStale: true }),

  setSelectedScenarioType: (type) => set({ selectedScenarioType: type }),

  runSimulations: () => {
    const { profile, assets, spending, guardrails } = useProfileStore.getState();
    if (!profile || !assets || !spending) return;

    set({ isRunning: true });

    const retireNow    = runSimulation(profile, assets, spending, guardrails, 'retire_now');
    const retireStated = runSimulation(profile, assets, spending, guardrails, 'retire_at_stated_date');
    const noChange     = runSimulation(profile, assets, spending, guardrails, 'no_change');

    const ssComparison = buildSocialSecurityComparison(
      profile.client.fraMonthlyBenefit,
      profile.client.fullRetirementAge,
      profile.client.lifeExpectancy,
      profile.spouse?.fraMonthlyBenefit ?? null,
      profile.spouse?.fullRetirementAge ?? null,
      profile.spouse?.lifeExpectancy ?? null
    );

    const opportunities = assessOpportunities(profile, assets, retireNow.yearlyProjections);

    // Compute contingency for all three scenarios — different retirement dates mean
    // different portfolio sizes, which affects survivor coverage and guardrail amounts.
    const contingencies: Partial<Record<ScenarioType, ContingencyReport>> = {
      retire_now:             buildContingencyReport(profile, assets, guardrails, retireNow,    ssComparison),
      retire_at_stated_date:  buildContingencyReport(profile, assets, guardrails, retireStated, ssComparison),
      no_change:              buildContingencyReport(profile, assets, guardrails, noChange,      ssComparison),
    };

    set({
      scenarios: [retireNow, retireStated, noChange],
      ssComparison,
      opportunities,
      contingencies,
      isStale: false,
      isRunning: false,
    });
  },
}));
