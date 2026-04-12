'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useProfileStore } from '@/store/profile.store';
import { runMonteCarlo, type MonteCarloConfig, type MonteCarloResult, type PercentileBand } from '@/domain/engine/monte-carlo';
import { formatCurrency } from '@/lib/format';
import type { ScenarioType } from '@/domain/types/scenarios';

// ─── Portfolio preset configs ─────────────────────────────────────────────────

const PORTFOLIO_PRESETS = [
  { label: 'Conservative',    nominal: 0.07, stdDev: 0.09, desc: '40/60 stock/bond' },
  { label: '60/40 Boglehead', nominal: 0.08, stdDev: 0.12, desc: 'Boglehead baseline' },
  { label: '70/30',           nominal: 0.09, stdDev: 0.14, desc: 'Moderate equity tilt' },
  { label: '80/20',           nominal: 0.10, stdDev: 0.15, desc: 'Equity-heavy' },
  { label: '100% Equity',     nominal: 0.10, stdDev: 0.17, desc: 'Historical US equity' },
] as const;

// ─── Fan Chart ────────────────────────────────────────────────────────────────

function FanChart({ bands }: { bands: PercentileBand[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (bands.length === 0) return null;

  const W = 700;
  const H = 220;
  const PAD_L = 64;
  const PAD_R = 16;
  const PAD_T = 14;
  const PAD_B = 32;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const maxVal = Math.max(...bands.map((b) => b.p90));
  const yMax = Math.ceil(maxVal / 1_000_000) * 1_000_000 || 1_000_000;

  function xOf(i: number) { return PAD_L + (i / Math.max(bands.length - 1, 1)) * chartW; }
  function yOf(val: number) { return PAD_T + chartH - Math.max(0, val / yMax) * chartH; }

  function bandPath(upper: (b: PercentileBand) => number, lower: (b: PercentileBand) => number) {
    const top = bands.map((b, i) => `${xOf(i).toFixed(1)},${yOf(upper(b)).toFixed(1)}`).join(' ');
    const bot = [...bands].reverse().map((b, i) => `${xOf(bands.length - 1 - i).toFixed(1)},${yOf(Math.max(0, lower(b))).toFixed(1)}`).join(' ');
    return `M ${top} L ${bot} Z`;
  }

  function linePath(val: (b: PercentileBand) => number) {
    return bands.map((b, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)},${yOf(val(b)).toFixed(1)}`).join(' ');
  }

  // Y-axis labels
  const yTicks = Array.from({ length: 5 }, (_, i) => (i / 4) * yMax);

  const hoverBand = hoverIdx !== null ? bands[hoverIdx] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Grid lines */}
        {yTicks.map((v) => (
          <line key={v} x1={PAD_L} x2={W - PAD_R} y1={yOf(v)} y2={yOf(v)} stroke="#374151" strokeWidth="1" />
        ))}

        {/* p10–p90 outer band */}
        <path d={bandPath((b) => b.p90, (b) => b.p10)} fill="#1d4ed8" fillOpacity="0.15" />
        {/* p25–p75 inner band */}
        <path d={bandPath((b) => b.p75, (b) => b.p25)} fill="#2563eb" fillOpacity="0.25" />
        {/* Median line */}
        <path d={linePath((b) => b.median)} fill="none" stroke="#60a5fa" strokeWidth="2" />
        {/* p10 dashed floor */}
        <path d={linePath((b) => b.p10)} fill="none" stroke="#ef4444" strokeWidth="1" strokeDasharray="4,3" />
        {/* p90 dashed ceiling */}
        <path d={linePath((b) => b.p90)} fill="none" stroke="#4ade80" strokeWidth="1" strokeDasharray="4,3" />

        {/* Hover overlay — invisible rect per column */}
        {bands.map((b, i) => (
          <rect
            key={i}
            x={xOf(i) - chartW / bands.length / 2}
            y={PAD_T}
            width={chartW / bands.length}
            height={chartH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
          />
        ))}

        {/* Hover vertical line */}
        {hoverIdx !== null && (
          <line
            x1={xOf(hoverIdx)} x2={xOf(hoverIdx)}
            y1={PAD_T} y2={PAD_T + chartH}
            stroke="#9ca3af" strokeWidth="1" strokeDasharray="3,2"
          />
        )}

        {/* Y-axis labels */}
        {yTicks.map((v) => (
          <text key={v} x={PAD_L - 6} y={yOf(v) + 4} textAnchor="end" fontSize="10" fill="#6b7280">
            {v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(0)}M` : `$${(v / 1000).toFixed(0)}k`}
          </text>
        ))}

        {/* X-axis: show every 5th year label */}
        {bands.filter((_, i) => i % 5 === 0).map((b, _) => {
          const i = bands.findIndex((bb) => bb.year === b.year);
          return (
            <text key={b.year} x={xOf(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#6b7280">
              {b.year} (age {b.clientAge})
            </text>
          );
        })}
      </svg>

      {/* Hover tooltip */}
      {hoverBand && (
        <div className="absolute top-2 right-2 bg-gray-900 border border-gray-700 rounded p-2 text-xs space-y-0.5 min-w-[160px]">
          <div className="font-semibold text-white mb-1">{hoverBand.year} · Age {hoverBand.clientAge}</div>
          <div className="flex justify-between gap-4"><span className="text-green-400">90th pct</span><span>{formatCurrency(hoverBand.p90)}</span></div>
          <div className="flex justify-between gap-4"><span className="text-blue-300">75th pct</span><span>{formatCurrency(hoverBand.p75)}</span></div>
          <div className="flex justify-between gap-4"><span className="text-blue-400">Median</span><span>{formatCurrency(hoverBand.median)}</span></div>
          <div className="flex justify-between gap-4"><span className="text-blue-300">25th pct</span><span>{formatCurrency(hoverBand.p25)}</span></div>
          <div className="flex justify-between gap-4"><span className="text-red-400">10th pct</span><span>{formatCurrency(hoverBand.p10)}</span></div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block w-6 h-0.5 bg-green-400" style={{ borderTop: '1px dashed' }} /> 90th pct</span>
        <span className="flex items-center gap-1"><span className="inline-block w-6 h-2 bg-blue-600 opacity-40 rounded" /> p25–p75</span>
        <span className="flex items-center gap-1"><span className="inline-block w-6 h-0.5 bg-blue-400" /> Median</span>
        <span className="flex items-center gap-1"><span className="inline-block w-6 h-0.5 bg-red-400" style={{ borderTop: '1px dashed' }} /> 10th pct</span>
      </div>
    </div>
  );
}

// ─── Success rate gauge ───────────────────────────────────────────────────────

function SuccessGauge({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const color = pct >= 90 ? 'text-green-400' : pct >= 75 ? 'text-yellow-400' : 'text-red-400';
  const label = pct >= 90 ? 'Solid' : pct >= 80 ? 'Workable with guardrails' : pct >= 70 ? 'Risky — consider adjustments' : 'High failure risk';
  return (
    <div className="text-center">
      <div className={`text-5xl font-bold tabular-nums ${color}`}>{pct}%</div>
      <div className="text-gray-400 text-sm mt-1">Probability of Success</div>
      <div className={`text-xs mt-0.5 ${color}`}>{label}</div>
      <div className="text-xs text-gray-600 mt-2">Typical advisor target: 85–95% with guardrails</div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MonteCarloPage() {
  const { profile, assets, spending, guardrails } = useProfileStore();

  const [scenarioType, setScenarioType] = useState<ScenarioType>('retire_at_stated_date');
  const [presetIdx, setPresetIdx] = useState(1); // 60/40 default
  const [simCount, setSimCount] = useState(1000);
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const preset = PORTFOLIO_PRESETS[presetIdx];

  const handleRun = useCallback(() => {
    if (!profile || !assets || !spending) return;

    setRunning(true);
    setResult(null);

    // Yield to paint before blocking computation
    setTimeout(() => {
      const config: MonteCarloConfig = {
        simulations: simCount,
        meanNominalReturn: preset.nominal,
        stdDevReturn: preset.stdDev,
      };

      const t0 = performance.now();
      const mc = runMonteCarlo(profile, assets, spending, guardrails, scenarioType, config);
      const t1 = performance.now();

      setResult(mc);
      setElapsed(Math.round(t1 - t0));
      setRunning(false);
    }, 10);
  }, [profile, assets, spending, guardrails, scenarioType, presetIdx, simCount, preset]);

  if (!profile || !assets || !spending) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-white mb-4">Monte Carlo</h1>
        <p className="text-gray-400">
          <Link href="/profile" className="text-blue-400 underline">Enter your profile</Link> first.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Monte Carlo Simulation</h1>
        <p className="text-gray-400 text-sm mt-1">
          Runs {simCount.toLocaleString()} retirement trials, each with a randomized annual return sequence.
          Surfaces sequence-of-returns risk that a single deterministic projection cannot show.
        </p>
      </div>

      {/* Config */}
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 space-y-4">
        <div>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Retirement Scenario</p>
          <div className="flex gap-2">
            {([
              { type: 'retire_now'            as ScenarioType, label: 'Retire Now',   year: profile.currentYear },
              { type: 'retire_at_stated_date' as ScenarioType, label: 'Target Date',  year: profile.retirementYearDesired ?? profile.currentYear },
              { type: 'no_change'             as ScenarioType, label: '+3 Years',     year: (profile.retirementYearDesired ?? profile.currentYear) + 3 },
            ]).map(({ type, label, year }) => (
              <button
                key={type}
                type="button"
                onClick={() => setScenarioType(type)}
                className={`px-3 py-1.5 rounded border text-xs font-medium transition-colors ${
                  scenarioType === type
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                }`}
              >
                {label} <span className="opacity-60">{year}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Portfolio Allocation</p>
          <div className="flex gap-2 flex-wrap">
            {PORTFOLIO_PRESETS.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setPresetIdx(i)}
                className={`px-3 py-2 rounded border text-xs font-medium transition-colors text-center ${
                  presetIdx === i
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                }`}
              >
                <div className="font-semibold">{p.label}</div>
                <div className="opacity-60 mt-0.5">{(p.nominal * 100).toFixed(0)}% · σ={( p.stdDev * 100).toFixed(0)}%</div>
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-1.5">
            Mean: <span className="text-gray-400">{(preset.nominal * 100).toFixed(0)}% nominal</span>
            {' '}(≈{((preset.nominal - 0.03) * 100).toFixed(0)}% real) · Std dev: <span className="text-gray-400">{(preset.stdDev * 100).toFixed(0)}%</span> · {preset.desc}
          </p>
        </div>

        <div>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Simulation Count</p>
          <div className="flex gap-2">
            {[500, 1000, 2000, 5000].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSimCount(n)}
                className={`px-3 py-1.5 rounded border text-xs font-medium transition-colors ${
                  simCount === n
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                }`}
              >
                {n.toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="px-5 py-2.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? 'Running…' : `Run ${simCount.toLocaleString()} Simulations`}
        </button>
      </div>

      {/* Results */}
      {result && (
        <>
          {/* Summary row */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-1 rounded-lg border border-gray-700 bg-gray-900 p-4 flex items-center justify-center">
              <SuccessGauge rate={result.successRate} />
            </div>
            <div className="col-span-2 rounded-lg border border-gray-700 bg-gray-900 p-4">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-3">Final Portfolio Distribution</p>
              <div className="space-y-2">
                {[
                  { label: '90th percentile', val: result.p90FinalPortfolio, color: 'text-green-400' },
                  { label: '75th percentile', val: result.p75FinalPortfolio, color: 'text-blue-300' },
                  { label: 'Median (50th)',   val: result.medianFinalPortfolio, color: 'text-blue-400' },
                  { label: '25th percentile', val: result.p25FinalPortfolio, color: 'text-blue-300' },
                  { label: '10th percentile', val: result.p10FinalPortfolio, color: 'text-red-400' },
                ].map(({ label, val, color }) => (
                  <div key={label} className="flex justify-between items-center text-sm">
                    <span className={`text-xs ${color}`}>{label}</span>
                    <span className={`font-mono font-semibold ${val < 0 ? 'text-red-400' : 'text-white'}`}>
                      {val < 0 ? `-${formatCurrency(-val)}` : formatCurrency(val)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-600 mt-3">
                {result.simulations.toLocaleString()} trials · {elapsed}ms ·{' '}
                {preset.nominal * 100}% nominal mean · σ={preset.stdDev * 100}%
              </p>
            </div>
          </div>

          {/* Fan chart */}
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-3">Portfolio Trajectory Fan</p>
            <p className="text-xs text-gray-600 mb-3">
              Shaded bands show the range of outcomes across all trials. The red dashed floor (10th pct) is your stress scenario — sequence of bad returns early in retirement. Hover for year-by-year values.
            </p>
            <FanChart bands={result.portfolioBands} />
          </div>

          {/* Interpretation */}
          <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 text-sm text-gray-400 space-y-2">
            <p className="text-white font-medium text-xs uppercase tracking-wide mb-1">How to read this</p>
            <p>
              Each trial draws a new random return sequence from N({(preset.nominal * 100).toFixed(0)}%, {(preset.stdDev * 100).toFixed(0)}%) for every retirement year.
              A <strong className="text-white">bad sequence</strong> (large losses in the first 5–10 years) can permanently impair
              the portfolio even if long-run average returns are fine — this is sequence-of-returns risk.
            </p>
            <p>
              The <strong className="text-white">10th percentile floor</strong> is the stress scenario you should plan guardrails around,
              not the median. If the 10th pct floor depletes before your life expectancy, consider reducing spending,
              working longer, or increasing the guardrail cut.
            </p>
            <p>
              The deterministic projection on the Retirement Date page uses the flat mean ({(preset.nominal * 100).toFixed(0)}%) —
              that is roughly the median of these Monte Carlo results. The fan shows the uncertainty around that median.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
