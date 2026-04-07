'use client';

import { useSimulationStore } from '@/store/simulation.store';
import { useProfileStore } from '@/store/profile.store';
import { formatCurrency, formatPercent } from '@/lib/format';
import Link from 'next/link';

export default function RothPage() {
  const { scenarios } = useSimulationStore();
  const { profile, assets } = useProfileStore();
  const retireNow = scenarios.find((s) => s.scenarioType === 'retire_now');

  if (!retireNow || !profile || !assets) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-white mb-4">Roth Conversion Engine</h1>
        <p className="text-gray-400">
          <Link href="/profile" className="text-blue-400 underline">Run a simulation</Link> first.
        </p>
      </div>
    );
  }

  const conversionYears = retireNow.yearlyProjections.filter((p) => p.rothConversion !== null);
  const totalConverted = conversionYears.reduce(
    (s, p) => s + (p.rothConversion?.conversionAmount ?? 0),
    0
  );
  const totalTaxPaid = conversionYears.reduce(
    (s, p) => s + (p.rothConversion?.taxOnConversion ?? 0),
    0
  );

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-white mb-2">Roth Conversion Engine</h1>
      <p className="text-gray-400 text-sm mb-6">
        Two-event model: living expense withdrawal (Event 1) vs. surplus-funded conversion with
        brokerage-funded tax (Event 2).
      </p>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label="Pre-tax Total" value={formatCurrency(assets.totalPretax)} />
        <StatCard
          label="Total to Convert"
          value={formatCurrency(totalConverted)}
          sub={`over ${conversionYears.length} years`}
        />
        <StatCard
          label="Conversion Tax Paid"
          value={formatCurrency(totalTaxPaid)}
          sub="from brokerage account"
        />
      </div>

      <div className="p-4 rounded-lg border border-blue-800 bg-blue-950 text-sm text-blue-200 mb-6">
        <p className="font-medium text-blue-100 mb-1">Two-Event Tax Model</p>
        <p>
          Event 1: Pre-tax withdrawal for living expenses — tax embedded in the $141k withdrawal.
        </p>
        <p>
          Event 2: Surplus spending capacity funds the conversion. Only the Roth conversion tax
          (~$19k) is paid from brokerage — not the full conversion amount.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-800">
              <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Year</th>
              <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Season</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Converted</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Marginal Rate</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Tax (Event 2)</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Brokerage Used</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {conversionYears.map((p) => (
              <tr key={p.year} className="hover:bg-gray-800/50">
                <td className="px-3 py-2 text-gray-300">{p.year}</td>
                <td className="px-3 py-2 text-gray-400 capitalize">{p.season}</td>
                <td className="px-3 py-2 text-right text-green-400 font-medium">
                  {formatCurrency(p.rothConversion!.conversionAmount)}
                </td>
                <td className="px-3 py-2 text-right text-gray-300">
                  {formatPercent(p.rothConversion!.marginalRate)}
                </td>
                <td className="px-3 py-2 text-right text-yellow-400">
                  {formatCurrency(p.rothConversion!.taxOnConversion)}
                </td>
                <td className="px-3 py-2 text-right text-gray-300">
                  {formatCurrency(p.rothConversion!.brokerageFundingAmount)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-700 bg-gray-800">
              <td colSpan={2} className="px-3 py-2.5 text-gray-400 font-medium">
                Totals
              </td>
              <td className="px-3 py-2.5 text-right text-green-400 font-semibold">
                {formatCurrency(totalConverted)}
              </td>
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 text-right text-yellow-400 font-semibold">
                {formatCurrency(totalTaxPaid)}
              </td>
              <td className="px-3 py-2.5 text-right text-gray-300 font-semibold">
                {formatCurrency(totalTaxPaid)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-semibold text-white">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}
