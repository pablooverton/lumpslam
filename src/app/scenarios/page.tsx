'use client';

import { useSimulationStore } from '@/store/simulation.store';
import { useProfileStore } from '@/store/profile.store';
import { formatCurrency, formatPercent } from '@/lib/format';
import type { ScenarioResult } from '@/domain/types/scenarios';
import Link from 'next/link';

const SCENARIO_LABELS: Record<string, string> = {
  retire_now: 'Retire Now',
  retire_at_stated_date: 'Retire at Stated Date',
  no_change: 'Status Quo',
};

export default function ScenariosPage() {
  const { scenarios, isStale, isRunning, runSimulations } = useSimulationStore();
  const { profile } = useProfileStore();

  if (!profile) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-white mb-4">Scenarios</h1>
        <p className="text-gray-400">
          <Link href="/profile" className="text-blue-400 underline">Enter your profile</Link> first, then run the simulation.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Three Baseline Scenarios</h1>
        <button
          onClick={runSimulations}
          disabled={isRunning}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isRunning ? 'Running…' : isStale ? 'Run Simulation' : 'Re-run'}
        </button>
      </div>

      {scenarios.length === 0 ? (
        <p className="text-gray-400">No results yet. Run the simulation to see your scenarios.</p>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {scenarios.map((s) => (
            <ScenarioCard key={s.scenarioType} scenario={s} />
          ))}
        </div>
      )}

      {scenarios.length > 0 && (
        <div className="mt-6 p-4 rounded-lg border border-gray-700 bg-gray-900 text-sm text-gray-400">
          <p className="font-medium text-gray-300 mb-1">Guardrail Model</p>
          <p>
            The lower guardrail triggers a 3% spending cut only if the portfolio drops{' '}
            <span className="text-white font-medium">29%</span> from its starting value.
            Low-growth / sideways markets are the most common trigger — not sudden crashes.
          </p>
        </div>
      )}
    </div>
  );
}

function ScenarioCard({ scenario }: { scenario: ScenarioResult }) {
  const isPositive = scenario.surplusOrDeficit >= 0;
  const successColor =
    scenario.probabilityOfSuccess >= 0.90
      ? 'text-green-400'
      : scenario.probabilityOfSuccess >= 0.70
      ? 'text-yellow-400'
      : 'text-red-400';

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-5">
      <h2 className="font-semibold text-white mb-4">{SCENARIO_LABELS[scenario.scenarioType]}</h2>

      <div className="space-y-3">
        <Stat label="Retirement Year" value={String(scenario.retirementYear)} />
        <Stat label="Spending Capacity" value={formatCurrency(scenario.spendingCapacity)} />
        <Stat label="Desired Spending" value={formatCurrency(scenario.desiredSpending)} />
        <Stat
          label="Surplus / Deficit"
          value={formatCurrency(Math.abs(scenario.surplusOrDeficit))}
          valueClass={isPositive ? 'text-green-400' : 'text-red-400'}
          prefix={isPositive ? '+' : '-'}
        />
        <Stat
          label="Probability of Success"
          value={formatPercent(scenario.probabilityOfSuccess)}
          valueClass={successColor}
        />
        <div className="border-t border-gray-700 pt-3">
          <p className="text-xs text-gray-500 mb-1">Lower Guardrail Trigger</p>
          <p className="text-sm text-gray-300">
            Portfolio must drop{' '}
            <span className="text-white font-medium">{formatCurrency(scenario.lowerGuardrailDollarDrop)}</span>{' '}
            before spending cut of{' '}
            <span className="text-white font-medium">{formatCurrency(scenario.lowerGuardrailSpendingCutDollars)}/mo</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass = 'text-white',
  prefix = '',
}: {
  label: string;
  value: string;
  valueClass?: string;
  prefix?: string;
}) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-400">{label}</span>
      <span className={`font-medium ${valueClass}`}>{prefix}{value}</span>
    </div>
  );
}
