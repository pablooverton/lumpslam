'use client';

import { useSimulationStore } from '@/store/simulation.store';
import { useProfileStore } from '@/store/profile.store';
import type { ScenarioType } from '@/domain/types/scenarios';

const LABELS: Record<ScenarioType, string> = {
  retire_now:            'Retire Now',
  retire_at_stated_date: 'Target Date',
  no_change:             '+3 Years',
};

export function ScenarioSelector() {
  const { scenarios, selectedScenarioType, setSelectedScenarioType } = useSimulationStore();
  const { profile } = useProfileStore();

  if (scenarios.length === 0 || !profile) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">Scenario:</span>
      <div className="flex gap-1 rounded-lg bg-gray-800 p-1">
        {(Object.keys(LABELS) as ScenarioType[]).map((type) => {
          const scenario = scenarios.find((s) => s.scenarioType === type);
          if (!scenario) return null;
          const isSelected = selectedScenarioType === type;
          const retireAge = profile.client.age + (scenario.retirementYear - profile.currentYear);
          return (
            <button
              key={type}
              onClick={() => setSelectedScenarioType(type)}
              title={`Retire ${scenario.retirementYear} · age ${retireAge}`}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                isSelected
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {LABELS[type]}
              <span className="ml-1 opacity-60">{scenario.retirementYear}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
