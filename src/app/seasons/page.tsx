'use client';

import { useSimulationStore } from '@/store/simulation.store';
import { useProfileStore } from '@/store/profile.store';
import { formatCurrency } from '@/lib/format';
import type { YearlyProjection, RetirementSeason } from '@/domain/types/simulation';
import Link from 'next/link';

const SEASON_LABELS: Record<RetirementSeason, string> = {
  cobra: 'COBRA',
  aca: 'ACA Window',
  medicare: 'Medicare',
  rmd: 'RMD Era',
};

const SEASON_COLORS: Record<RetirementSeason, string> = {
  cobra: 'bg-purple-900 border-purple-700',
  aca: 'bg-blue-900 border-blue-700',
  medicare: 'bg-teal-900 border-teal-700',
  rmd: 'bg-orange-900 border-orange-700',
};

export default function SeasonsPage() {
  const { scenarios } = useSimulationStore();
  const { profile } = useProfileStore();
  const retireNow = scenarios.find((s) => s.scenarioType === 'retire_now');

  if (!profile || !retireNow) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-white mb-4">Four Seasons Strategy</h1>
        <p className="text-gray-400">
          <Link href="/profile" className="text-blue-400 underline">Run a simulation</Link> first.
        </p>
      </div>
    );
  }

  const projections = retireNow.yearlyProjections.slice(0, 30); // show first 30 years

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold text-white mb-2">Four Seasons Strategy</h1>
      <p className="text-gray-400 text-sm mb-6">
        Year-by-year withdrawal sequencing and tax management across all four retirement phases.
      </p>

      <div className="flex gap-4 mb-6">
        {(Object.entries(SEASON_LABELS) as [RetirementSeason, string][]).map(([key, label]) => (
          <div
            key={key}
            className={`px-3 py-1.5 rounded border text-xs font-medium text-white ${SEASON_COLORS[key]}`}
          >
            {label}
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800">
              <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Year</th>
              <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Age</th>
              <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Season</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">MAGI</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">ACA Eligible</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">From Pretax</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">From Brokerage</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Roth Conv.</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Total Tax</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Portfolio End</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {projections.map((p) => (
              <ProjectionRow key={p.year} projection={p} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectionRow({ projection: p }: { projection: YearlyProjection }) {
  const seasonLabel = SEASON_LABELS[p.season];
  const seasonClass =
    p.season === 'aca'
      ? 'text-blue-400'
      : p.season === 'cobra'
      ? 'text-purple-400'
      : p.season === 'medicare'
      ? 'text-teal-400'
      : 'text-orange-400';

  return (
    <tr className="hover:bg-gray-800/50 transition-colors">
      <td className="px-3 py-2 text-gray-300">{p.year}</td>
      <td className="px-3 py-2 text-gray-300">{p.clientAge}</td>
      <td className={`px-3 py-2 font-medium ${seasonClass}`}>{seasonLabel}</td>
      <td className="px-3 py-2 text-right text-gray-300">{formatCurrency(p.magi)}</td>
      <td className="px-3 py-2 text-right">
        {p.acaSubsidyEligible ? (
          <span className="text-green-400 font-medium">Yes</span>
        ) : (
          <span className="text-gray-600">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-gray-300">{formatCurrency(p.withdrawals.fromPretax)}</td>
      <td className="px-3 py-2 text-right text-gray-300">{formatCurrency(p.withdrawals.fromBrokerage)}</td>
      <td className="px-3 py-2 text-right text-gray-300">
        {p.rothConversion ? formatCurrency(p.rothConversion.conversionAmount) : '—'}
      </td>
      <td className="px-3 py-2 text-right text-gray-300">{formatCurrency(p.taxLiability.totalFederalTax)}</td>
      <td className="px-3 py-2 text-right text-gray-300">{formatCurrency(p.portfolioEndBalance, true)}</td>
    </tr>
  );
}
