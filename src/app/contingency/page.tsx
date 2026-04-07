'use client';

import { useSimulationStore } from '@/store/simulation.store';
import { useProfileStore } from '@/store/profile.store';
import { formatCurrency, formatPercent } from '@/lib/format';
import Link from 'next/link';

const LIKELIHOOD_COLOR: Record<string, string> = {
  low: 'text-green-400',
  medium: 'text-yellow-400',
  high: 'text-red-400',
};

export default function ContingencyPage() {
  const { contingency } = useSimulationStore();
  const { profile } = useProfileStore();

  if (!contingency || !profile) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-white mb-4">Contingency Planning</h1>
        <p className="text-gray-400">
          <Link href="/profile" className="text-blue-400 underline">Run a simulation</Link> first.
        </p>
      </div>
    );
  }

  const { risks, widowsPenaltyClient, widowsPenaltySpouse } = contingency;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-white mb-2">Contingency Planning</h1>
      <p className="text-gray-400 text-sm mb-6">
        Six great risks, modeled. Plus the widow's tax penalty.
      </p>

      <h2 className="text-lg font-semibold text-white mb-3">The Six Great Risks</h2>
      <div className="space-y-3 mb-8">
        {risks.map((risk) => (
          <div key={risk.type} className="rounded-lg border border-gray-700 bg-gray-900 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-white text-sm">{risk.label}</span>
              <span
                className={`text-xs font-medium capitalize ${LIKELIHOOD_COLOR[risk.likelihood]}`}
              >
                {risk.likelihood} likelihood
              </span>
            </div>
            <p className="text-gray-400 text-sm mb-2">{risk.mitigationStrategy}</p>
            <p className="text-blue-300 text-sm font-mono bg-blue-950/30 border border-blue-900 rounded px-3 py-1.5">
              {risk.ifThenStatement}
            </p>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-semibold text-white mb-3">The Widow's Tax Penalty</h2>
      <div className="space-y-3">
        {[widowsPenaltyClient, widowsPenaltySpouse].filter(Boolean).map((w) => {
          if (!w) return null;
          return (
            <div key={w.survivingSpouse} className="rounded-lg border border-gray-700 bg-gray-900 p-4">
              <h3 className="font-medium text-white text-sm mb-3 capitalize">
                If{' '}
                {w.survivingSpouse === 'client'
                  ? profile.spouse?.name ?? 'Spouse'
                  : profile.client.name}{' '}
                passes first
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Fact label="Income Lost (SS)" value={formatCurrency(w.incomeLostFromSS)} />
                <Fact label="Income After Loss" value={formatCurrency(w.incomeAfterLoss)} />
                <Fact
                  label="Survivor Coverage"
                  value={formatPercent(w.survivorCoveragePercent)}
                  valueClass={
                    w.survivorCoveragePercent >= 0.9 ? 'text-green-400' : 'text-yellow-400'
                  }
                />
                <Fact
                  label="Can Maintain Lifestyle"
                  value={w.canMaintainLifestyle ? 'Yes' : 'At Risk'}
                  valueClass={w.canMaintainLifestyle ? 'text-green-400' : 'text-red-400'}
                />
              </div>
              <p className="text-gray-500 text-xs mt-3">{w.singleFilerBracketNote}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  valueClass = 'text-white',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div>
      <p className="text-gray-500 text-xs">{label}</p>
      <p className={`font-medium ${valueClass}`}>{value}</p>
    </div>
  );
}
