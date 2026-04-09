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
      <p className="text-gray-400 text-sm mb-6">
        Lifetime benefit comparison across claim ages. All values are present value at 3% discount rate.
      </p>

      <div className="p-4 rounded-lg border border-green-800 bg-green-950 mb-6">
        <p className="text-green-300 text-sm font-medium">Recommended: {recommended.label}</p>
        <p className="text-green-200 text-sm mt-1">
          Lifetime benefit advantage over claiming at 62:{' '}
          <span className="font-semibold text-white">
            {formatCurrency(ssComparison.lifetimeBenefitDifferenceVsEarliest)}
          </span>
        </p>
        <p className="text-gray-400 text-sm mt-2 leading-relaxed">{ssComparison.taxEfficiencyNote}</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800">
              <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Claim Age</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Client/mo</th>
              {profile.spouse && (
                <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Spouse/mo</th>
              )}
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Break-Even</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Lifetime (Client)</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">
                Lifetime (Combined)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {ssComparison.options.map((opt, idx) => {
              const isRecommended = idx === ssComparison.recommendedOptionIndex;
              const isSurvivor = opt.isSurvivorStrategy;
              return (
                <tr
                  key={`${opt.clientClaimAge}-${opt.spouseClaimAge ?? 'single'}-${idx}`}
                  className={`hover:bg-gray-800/50 ${
                    isSurvivor
                      ? 'bg-blue-950/40'
                      : isRecommended
                      ? 'bg-green-950/30'
                      : ''
                  }`}
                >
                  <td className="px-3 py-2.5 text-gray-300 font-medium">
                    {opt.label}
                    {isRecommended && (
                      <span className="ml-2 text-xs bg-green-700 text-green-100 px-1.5 py-0.5 rounded">
                        Recommended
                      </span>
                    )}
                    {isSurvivor && !isRecommended && (
                      <span className="ml-2 text-xs bg-blue-700 text-blue-100 px-1.5 py-0.5 rounded">
                        Survivor
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
                  <td className="px-3 py-2.5 text-right text-gray-500 text-xs">
                    {opt.breakEvenAgeVsEarliest != null
                      ? `age ${Math.round(opt.breakEvenAgeVsEarliest)}`
                      : '—'}
                  </td>
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

      {profile.spouse && (
        <p className="text-xs text-gray-600 mt-3 leading-relaxed">
          Survivor strategy: when the higher earner dies, the surviving spouse keeps whichever benefit is larger.
          Maximizing the higher earner&apos;s benefit at 70 creates the largest possible floor for the survivor —
          especially valuable given women&apos;s longer average life expectancy.
          Break-even ages are computed in nominal dollars (no discounting).
        </p>
      )}
      {!profile.spouse && (
        <p className="text-xs text-gray-600 mt-3 leading-relaxed">
          Break-even ages are computed in nominal dollars (no discounting).
          In present value terms (3% discount), break-even is typically 3–5 years later.
        </p>
      )}
    </div>
  );
}
