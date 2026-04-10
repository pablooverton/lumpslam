'use client';

import { useState, useMemo, useEffect } from 'react';
import { useProfileStore } from '@/store/profile.store';
import { useSimulationStore } from '@/store/simulation.store';
import { runSimulation } from '@/domain/engine/simulation-runner';
import { formatCurrency, formatPercent } from '@/lib/format';
import Link from 'next/link';

const BAR_MAX_PX = 72;
const BAR_MIN_PX = 8;

export default function ScenariosPage() {
  const { profile, assets, spending, guardrails } = useProfileStore();
  const { isStale, isRunning, runSimulations } = useSimulationStore();

  // Pre-compute simulations for target ± 5 years, clamped to [currentYear, lifeExpYear - 5]
  const yearData = useMemo(() => {
    if (!profile || !assets || !spending) return [];

    const target    = profile.retirementYearDesired ?? profile.currentYear;
    const lifeExpYr = profile.currentYear + (profile.client.lifeExpectancy - profile.client.age);
    const minYear   = profile.currentYear;
    const maxYear   = Math.min(target + 5, lifeExpYr - 5);
    const safeMax   = Math.max(minYear + 1, maxYear); // always at least 2 years

    const results = [];
    for (let year = minYear; year <= safeMax; year++) {
      const tweaked = { ...profile, retirementYearDesired: year };
      const result  = runSimulation(tweaked, assets, spending, guardrails, 'retire_at_stated_date');
      results.push({ year, result });
    }
    return results;
  }, [profile, assets, spending, guardrails]);

  // Default slider index = position of profile's target year in the data
  const defaultIndex = useMemo(() => {
    if (!profile || yearData.length === 0) return 0;
    const target = profile.retirementYearDesired ?? profile.currentYear;
    const idx = yearData.findIndex((d) => d.year === target);
    return idx >= 0 ? idx : 0;
  }, [profile, yearData]);

  const [selectedIndex, setSelectedIndex] = useState(defaultIndex);
  useEffect(() => { setSelectedIndex(defaultIndex); }, [defaultIndex]);

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

  if (yearData.length === 0) return null;

  const selected   = yearData[selectedIndex];
  const targetYear = profile.retirementYearDesired ?? profile.currentYear;
  const fraYear    = profile.currentYear + (profile.client.fullRetirementAge - profile.client.age);
  const targetData = yearData.find((d) => d.year === targetYear) ?? yearData[0];

  const clientAgeAt = (year: number) => profile.client.age + (year - profile.currentYear);

  const maxCap = Math.max(...yearData.map((d) => d.result.spendingCapacity));
  const minCap = Math.min(...yearData.map((d) => d.result.spendingCapacity));
  const capRange = maxCap - minCap || 1;

  const yearsDiff      = selected.year - targetYear; // negative = earlier, positive = later
  const capacityDelta  = selected.result.spendingCapacity - targetData.result.spendingCapacity;
  const isPositive     = selected.result.surplusOrDeficit >= 0;

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
        Drag the slider to see how your retirement picture changes with each additional year of work.
      </p>

      {/* ── Bars ── absolute pixel heights so they always render */}
      <div
        className="flex items-end gap-1 mb-2"
        style={{ height: `${BAR_MAX_PX + 4}px` }}
      >
        {yearData.map((d, i) => {
          const t      = (d.result.spendingCapacity - minCap) / capRange;
          const barH   = Math.round(BAR_MIN_PX + (BAR_MAX_PX - BAR_MIN_PX) * t);
          const isSel  = i === selectedIndex;
          const isTgt  = d.year === targetYear;
          return (
            <div
              key={d.year}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedIndex(i)}
              onKeyDown={(e) => e.key === 'Enter' && setSelectedIndex(i)}
              className={`flex-1 rounded-t cursor-pointer transition-colors ${
                isSel  ? 'bg-blue-500' :
                isTgt  ? 'bg-blue-800 hover:bg-blue-700' :
                         'bg-gray-700 hover:bg-gray-500'
              }`}
              style={{ height: `${barH}px` }}
              title={`${d.year} · age ${clientAgeAt(d.year)}: ${formatCurrency(d.result.spendingCapacity)}/yr`}
            />
          );
        })}
      </div>

      {/* ── Slider ── */}
      <input
        type="range"
        min={0}
        max={yearData.length - 1}
        value={selectedIndex}
        onChange={(e) => setSelectedIndex(Number(e.target.value))}
        className="w-full accent-blue-500 cursor-pointer mb-1"
      />

      {/* ── Year labels ── */}
      <div className="flex mb-8">
        {yearData.map((d, i) => {
          const isSel    = i === selectedIndex;
          const isNow    = d.year === profile.currentYear;
          const isTgt    = d.year === targetYear && targetYear !== profile.currentYear;
          const isFra    = d.year === fraYear;
          return (
            <div key={d.year} className="flex-1 flex flex-col items-center min-w-0">
              <span className={`text-xs ${isSel ? 'text-white font-semibold' : 'text-gray-600'}`}>
                {d.year}
              </span>
              <span className="text-xs mt-0.5 leading-none">
                {isNow && <span className="text-gray-500">Now</span>}
                {isTgt && <span className="text-blue-400">★</span>}
                {isFra && !isTgt && !isNow && <span className="text-green-600">FRA</span>}
              </span>
            </div>
          );
        })}
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
                {profile.spouse.name} · age {profile.spouse.age + (selected.year - profile.currentYear)}
              </p>
            )}
            {yearsDiff !== 0 && (
              <p className="text-sm text-gray-500 mt-0.5">
                {Math.abs(yearsDiff)} year{Math.abs(yearsDiff) !== 1 ? 's' : ''} {yearsDiff < 0 ? 'earlier' : 'later'} than target
              </p>
            )}
          </div>

          {yearsDiff !== 0 && (
            <div className={`text-right px-3 py-2 rounded-lg border ${
              capacityDelta >= 0
                ? 'bg-green-950 border-green-800'
                : 'bg-red-950 border-red-800'
            }`}>
              <p className="text-xs text-gray-400 mb-0.5">vs. retire {targetYear}</p>
              <p className={`text-base font-bold ${capacityDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {capacityDelta >= 0 ? '+' : ''}{formatCurrency(capacityDelta)}/yr
              </p>
              <p className="text-xs text-gray-500">spending capacity</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-10 gap-y-4">
          <Metric label="Spending Capacity"      value={formatCurrency(selected.result.spendingCapacity) + '/yr'} large />
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
          <Metric label="Desired Spending"           value={formatCurrency(selected.result.desiredSpending) + '/yr'} />
          <Metric label="Lower Guardrail Trigger"    value={'Drop ' + formatCurrency(selected.result.lowerGuardrailDollarDrop)} />
          <Metric label="Monthly Cut at Trigger"     value={formatCurrency(selected.result.lowerGuardrailSpendingCutDollars) + '/mo'} />
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 mt-4">
        <p className="text-xs font-semibold text-gray-400 mb-2">How to read Probability of Success</p>
        <p className="text-xs text-gray-500 leading-relaxed mb-2">
          This is <strong className="text-gray-300">not a Monte Carlo simulation.</strong> It is a historical
          heuristic: the Safe Withdrawal Rate (SWR) is set at 4.5% for retirements under 30 years, 4.0% for
          30–35 years, and 3.8% beyond 35 years — rates derived from historical US market data. The probability
          is an estimate of how often a similar strategy would have survived over rolling 30-year periods in
          history.
        </p>
        <p className="text-xs text-gray-500 leading-relaxed mb-2">
          <span className="text-green-400 font-medium">≥ 90%</span> — solid.{' '}
          <span className="text-yellow-400 font-medium">70–89%</span> — workable with guardrails active.{' '}
          <span className="text-red-400 font-medium">&lt; 70%</span> — consider working longer or reducing spending.
        </p>
        <p className="text-xs text-gray-500 leading-relaxed">
          If the portfolio depletes before Social Security begins, the probability is capped — the tool penalizes
          plans that require SS to rescue a failing portfolio. A 99% target is overly conservative for most
          plans; 85–95% with guardrails is the typical advisor range.
        </p>
      </div>
      <p className="text-xs text-gray-600 leading-relaxed mt-3">
        Guardrail: a 3% monthly spending cut triggers only if the portfolio drops 29% from its starting value.
        All projections inflate spending at {((spending.inflationRate ?? 0.03) * 100).toFixed(0)}%/yr.
      </p>
    </div>
  );
}

function Metric({
  label, value, valueClass = 'text-white', large = false,
}: {
  label: string; value: string; valueClass?: string; large?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className={`font-semibold ${large ? 'text-xl' : 'text-sm'} ${valueClass}`}>{value}</p>
    </div>
  );
}
