'use client';

import { useSimulationStore } from '@/store/simulation.store';
import { useProfileStore } from '@/store/profile.store';
import { formatCurrency } from '@/lib/format';
import Link from 'next/link';

export default function SocialSecurityPage() {
  const { ssComparison } = useSimulationStore();
  const { profile } = useProfileStore();

  if (!ssComparison || !profile) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-white mb-4">Social Security</h1>
        <p className="text-gray-400">
          <Link href="/profile" className="text-blue-400 underline">Run a simulation</Link> first.
        </p>
      </div>
    );
  }

  const recommended = ssComparison.options[ssComparison.recommendedOptionIndex];

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-white mb-2">Social Security Timing</h1>
      <p className="text-gray-400 text-sm mb-6">Lifetime benefit comparison across claim ages.</p>

      <div className="p-4 rounded-lg border border-green-800 bg-green-950 mb-6">
        <p className="text-green-300 text-sm font-medium">Recommended: {recommended.label}</p>
        <p className="text-green-200 text-sm mt-1">
          Lifetime benefit advantage over earliest claiming:{' '}
          <span className="font-semibold text-white">
            {formatCurrency(ssComparison.lifetimeBenefitDifferenceVsEarliest)}
          </span>
        </p>
        <p className="text-green-200 text-sm mt-1">{ssComparison.taxEfficiencyNote}</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800">
              <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Claim Age</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Client Monthly</th>
              {profile.spouse && (
                <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Spouse Monthly</th>
              )}
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Lifetime (Client)</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">
                Lifetime (Combined)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {ssComparison.options.map((opt, idx) => {
              const isRecommended = idx === ssComparison.recommendedOptionIndex;
              return (
                <tr
                  key={opt.clientClaimAge}
                  className={`hover:bg-gray-800/50 ${isRecommended ? 'bg-green-950/30' : ''}`}
                >
                  <td className="px-3 py-2.5 text-gray-300 font-medium">
                    {opt.label}
                    {isRecommended && (
                      <span className="ml-2 text-xs bg-green-700 text-green-100 px-1.5 py-0.5 rounded">
                        Recommended
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-300">
                    {formatCurrency(opt.clientMonthlyBenefit)}/mo
                  </td>
                  {profile.spouse && (
                    <td className="px-3 py-2.5 text-right text-gray-300">
                      {opt.spouseMonthlyBenefit
                        ? formatCurrency(opt.spouseMonthlyBenefit) + '/mo'
                        : '—'}
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-right text-gray-300">
                    {formatCurrency(opt.lifetimeBenefitClient)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium text-white">
                    {formatCurrency(opt.lifetimeBenefitCombined)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
