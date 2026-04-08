'use client';

import { useState, useMemo, useEffect } from 'react';
import { useProfileStore } from '@/store/profile.store';
import { useSimulationStore } from '@/store/simulation.store';
import { runSimulation } from '@/domain/engine/simulation-runner';
import { formatCurrency, formatPercent } from '@/lib/format';
import Link from 'next/link';

const RANGE = 11; // currentYear through currentYear+10

export default function ScenariosPage() {
  const { profile, assets, spending, guardrails } = useProfileStore();
  const { isStale, isRunning, runSimulations } = useSimulationStore();

  // Pre-compute all years across the slider range
  const yearData = useMemo(() => {
    if (!profile || !assets || !spending) return [];
    return Array.from({ length: RANGE }, (_, i) => {
      const year = profile.currentYear + i;
      const tweaked = { ...profile, retirementYearDesired: year };
      const result = runSimulation(tweaked, assets, spending, guardrails, 'retire_at_stated_date');
      return { year, result };
    });
  }, [profile, assets, spending, guardrails]);

  // Default to the profile's stated target year
  const defaultIndex = useMemo(() => {
    if (!profile || yearData.length === 0) return 0;
    const offset = (profile.retirementYearDesired ?? profile.currentYear) - profile.currentYear;
    return Math.max(0, Math.min(offset, RANGE - 1));
  }, [profile, yearData.length]);

  const [selectedIndex, setSelectedIndex] = useState(defaultIndex);

  useEffect(() => {
    setSelectedIndex(defaultIndex);
  }, [defaultIndex]);

  if (!profile || !assets || !spending) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-white mb-4">Retirement Date</h1>
        <p className="text-gray-400">
          <Link href="/profile" className="text-blue-400 underline">Enter your profile</Link> first.
        </p>
      </div>
    );
  }

  const selected = yearData[selectedIndex];
  const baseline = yearData[0];
  if (!selected || !baseline) return null;

  const targetYear  = profile.retirementYearDesired ?? profile.currentYear;
  const fraYear     = profile.currentYear + (profile.client.fullRetirementAge - profile.client.age);
  const clientAgeAt = (year: number) => profile.client.age + (year - profile.currentYear);

  const maxCapacity = Math.max(...yearData.map((d) => d.result.spendingCapacity));
  const minCapacity = Math.min(...yearData.map((d) => d.result.spendingCapacity));
  const capacityRange = maxCapacity - minCapacity || 1;

  const isPositive     = selected.result.surplusOrDeficit >= 0;
  const yearsWorked    = selectedIndex;
  const capacityDelta  = selected.result.spendingCapacity - baseline.result.spendingCapacity;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-white">When do you retire?</h1>
        <button
          onClick={runSimulations}
          disabled={isRunning}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isRunning ? 'Running…' : isStale ? 'Run Simulation' : 'Re-run'}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-8">
        Drag the slider to see how each additional year of work changes your retirement picture.
      </p>

      {/* ── Capacity bars + slider ── */}
      <div className="mb-6">

        {/* Bars — height proportional with a 15% floor so small differences are visible */}
        <div className="flex items-end gap-0.5 h-20 mb-2 px-0.5">
          {yearData.map((d, i) => {
            const normalised = 0.15 + 0.85 * ((d.result.spendingCapacity - minCapacity) / capacityRange);
            const isSelected = i === selectedIndex;
            const isTarget   = d.year === targetYear;
            return (
              <button
                key={d.year}
                type="button"
                onClick={() => setSelectedIndex(i)}
                className="flex-1 flex flex-col justify-end h-full group"
                title={`${d.year} · age ${clientAgeAt(d.year)}: ${formatCurrency(d.result.spendingCapacity)}/yr`}
              >
                <div
                  className={`w-full rounded-sm transition-colors ${
                    isSelected
                      ? 'bg-blue-500'
                      : isTarget
                      ? 'bg-blue-800 group-hover:bg-blue-700'
                      : 'bg-gray-700 group-hover:bg-gray-500'
                  }`}
                  style={{ height: `${normalised * 100}%` }}
                />
              </button>
            );
          })}
        </div>

        {/* Range slider */}
        <input
          type="range"
          min={0}
          max={RANGE - 1}
          value={selectedIndex}
          onChange={(e) => setSelectedIndex(Number(e.target.value))}
          className="w-full accent-blue-500 cursor-pointer"
        />

        {/* Year labels + anchors */}
        <div className="flex mt-1.5">
          {yearData.map((d, i) => {
            const isSelected = i === selectedIndex;
            const isNow      = d.year === profile.currentYear;
            const isTarget   = d.year === targetYear && targetYear !== profile.currentYear;
            const isFra      = d.year === fraYear && fraYear >= profile.currentYear && fraYear <= profile.currentYear + RANGE - 1;
            return (
              <div key={d.year} className="flex-1 flex flex-col items-center min-w-0">
                <span className={`text-xs truncate ${isSelected ? 'text-white font-medium' : 'text-gray-600'}`}>
                  {d.year}
                </span>
                <span className="text-xs mt-0.5 truncate">
                  {isNow    && <span className="text-gray-500">Now</span>}
                  {isTarget && <span className="text-blue-400">★</span>}
                  {isFra    && <span className="text-green-600">FRA</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Hero metrics ── */}
      <div className="rounded-lg border border-blue-700 bg-gray-900 p-6 mb-4">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold text-white">
              Retire {selected.year} · age {clientAgeAt(selected.year)}
            </h2>
            {profile.spouse && (
              <p className="text-sm text-gray-500 mt-0.5">
                {profile.spouse.name} age {profile.spouse.age + yearsWorked}
              </p>
            )}
            {yearsWorked > 0 && (
              <p className="text-sm text-gray-500 mt-0.5">
                {yearsWorked} more year{yearsWorked !== 1 ? 's' : ''} of work vs. retiring now
              </p>
            )}
          </div>

          {/* Delta badge */}
          {yearsWorked > 0 && (
            <div className={`text-right px-3 py-2 rounded-lg ${capacityDelta >= 0 ? 'bg-green-950 border border-green-800' : 'bg-red-950 border border-red-800'}`}>
              <p className="text-xs text-gray-400 mb-0.5">vs. retire now</p>
              <p className={`text-base font-bold ${capacityDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {capacityDelta >= 0 ? '+' : ''}{formatCurrency(capacityDelta)}/yr
              </p>
              <p className="text-xs text-gray-500">spending capacity</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-10 gap-y-4">
          <Metric
            label="Spending Capacity"
            value={formatCurrency(selected.result.spendingCapacity) + '/yr'}
            large
          />
          <Metric
            label="Probability of Success"
            value={formatPercent(selected.result.probabilityOfSuccess)}
            valueClass={
              selected.result.probabilityOfSuccess >= 0.9 ? 'text-green-400' :
              selected.result.probabilityOfSuccess >= 0.7 ? 'text-yellow-400' : 'text-red-400'
            }
            large
          />
          <Metric
            label="Surplus / Deficit"
            value={(isPositive ? '+' : '−') + formatCurrency(Math.abs(selected.result.surplusOrDeficit)) + '/yr'}
            valueClass={isPositive ? 'text-green-400' : 'text-red-400'}
          />
          <Metric
            label="Desired Spending"
            value={formatCurrency(selected.result.desiredSpending) + '/yr'}
          />
          <Metric
            label="Lower Guardrail Trigger"
            value={`Portfolio drops ${formatCurrency(selected.result.lowerGuardrailDollarDrop)}`}
          />
          <Metric
            label="Monthly Cut at Trigger"
            value={formatCurrency(selected.result.lowerGuardrailSpendingCutDollars) + '/mo'}
          />
        </div>
      </div>

      <p className="text-xs text-gray-600 leading-relaxed">
        Guardrail: a 3% monthly spending cut triggers only if the portfolio drops 29% from its
        starting value. Low-growth or sideways markets are the most common trigger — not sudden crashes.
        All figures are in today&apos;s dollars, inflated at {((spending.inflationRate ?? 0.03) * 100).toFixed(0)}%/year.
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  valueClass = 'text-white',
  large = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  large?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className={`font-semibold ${large ? 'text-xl' : 'text-sm'} ${valueClass}`}>{value}</p>
    </div>
  );
}
