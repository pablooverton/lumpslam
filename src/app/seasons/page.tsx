'use client';

import { useSimulationStore } from '@/store/simulation.store';
import { useProfileStore } from '@/store/profile.store';
import { formatCurrency } from '@/lib/format';
import { PortfolioChart } from '@/components/PortfolioChart';
import type { YearlyProjection, RetirementSeason } from '@/domain/types/simulation';
import Link from 'next/link';

const SEASON_LABELS: Record<RetirementSeason, string> = {
  cobra: 'COBRA',
  aca: 'ACA Window',
  medicare: 'Medicare',
  rmd: 'RMD Era',
  international: 'International',
};

const SEASON_COLORS: Record<RetirementSeason, string> = {
  cobra:         'border-purple-600 bg-purple-950',
  aca:           'border-blue-600   bg-blue-950',
  medicare:      'border-teal-600   bg-teal-950',
  rmd:           'border-orange-600 bg-orange-950',
  international: 'border-violet-600 bg-violet-950',
};

const SEASON_TEXT: Record<RetirementSeason, string> = {
  cobra:         'text-purple-400',
  aca:           'text-blue-400',
  medicare:      'text-teal-400',
  rmd:           'text-orange-400',
  international: 'text-violet-400',
};

// ── Phase summary helper ────────────────────────────────────────────────────

interface PhaseSummary {
  season: RetirementSeason;
  startYear: number;
  endYear: number;
  years: number;
  avgConversion: number;
  totalTax: number;
  avgSS: number;
  startRoth: number;
  endRoth: number;
  endPretax: number;
}

function buildPhaseSummaries(projections: YearlyProjection[]): PhaseSummary[] {
  const phases: PhaseSummary[] = [];
  let i = 0;
  while (i < projections.length) {
    const season = projections[i].season;
    const group: YearlyProjection[] = [];
    while (i < projections.length && projections[i].season === season) {
      group.push(projections[i]);
      i++;
    }
    const avgConversion =
      group.reduce((s, p) => s + (p.rothConversion?.conversionAmount ?? 0), 0) / group.length;
    const totalTax = group.reduce((s, p) => s + p.taxLiability.totalFederalTax, 0);
    const avgSS = group.reduce((s, p) => s + p.income.socialSecurityClient + p.income.socialSecuritySpouse, 0) / group.length;
    phases.push({
      season,
      startYear: group[0].year,
      endYear: group[group.length - 1].year,
      years: group.length,
      avgConversion,
      totalTax,
      avgSS,
      startRoth: group[0].rothEndBalance - (group[0].rothConversion?.conversionAmount ?? 0),
      endRoth: group[group.length - 1].rothEndBalance,
      endPretax: group[group.length - 1].pretaxEndBalance,
    });
  }
  return phases;
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function SeasonsPage() {
  const { scenarios } = useSimulationStore();
  const { profile } = useProfileStore();
  const retireStated = scenarios.find((s) => s.scenarioType === 'retire_at_stated_date');

  if (!profile || !retireStated) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-white mb-4">Four Seasons Strategy</h1>
        <p className="text-gray-400">
          <Link href="/profile" className="text-blue-400 underline">Run a simulation</Link> first.
        </p>
      </div>
    );
  }

  const allProjections = retireStated.yearlyProjections;
  const projections = allProjections.slice(0, 35);
  const phases = buildPhaseSummaries(allProjections);

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold text-white mb-1">Four Seasons Strategy</h1>
      <p className="text-gray-400 text-sm mb-6">
        Year-by-year withdrawal sequencing and tax management across all four retirement phases.
      </p>

      {/* ── Season legend ── */}
      <div className="flex flex-wrap gap-3 mb-6">
        {(Object.entries(SEASON_LABELS) as [RetirementSeason, string][]).map(([key, label]) => (
          <div
            key={key}
            className={`px-3 py-1.5 rounded border text-xs font-medium text-white ${SEASON_COLORS[key]}`}
          >
            {label}
          </div>
        ))}
      </div>

      {/* ── Portfolio trajectory chart ── */}
      <section className="mb-8 rounded-xl border border-gray-700 bg-gray-900 p-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">
          Portfolio Trajectory — Account Breakdown
        </h2>
        <PortfolioChart projections={allProjections} />
      </section>

      {/* ── Phase summary cards ── */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Phase Summaries
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {phases.slice(0, 4).map((ph) => (
            <PhaseCard key={ph.season} phase={ph} />
          ))}
        </div>
      </section>

      {/* ── Year-by-year table ── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Year-by-Year Detail
        </h2>
        <div className="overflow-x-auto rounded-lg border border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800">
                <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Year</th>
                <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Age</th>
                <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Season</th>
                <th className="text-right px-3 py-2.5 text-gray-400 font-medium">MAGI</th>
                <th className="text-right px-3 py-2.5 text-gray-400 font-medium">SS Income</th>
                <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Roth Conv.</th>
                <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Fed Tax</th>
                <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Pretax Bal</th>
                <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Roth Bal</th>
                <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Portfolio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {projections.map((p) => (
                <ProjectionRow key={p.year} projection={p} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-600 mt-2">
          Showing first {projections.length} retirement years. Roth Conv. = annual pretax→Roth conversion.
          Pretax Bal and Roth Bal show end-of-year account balances.
        </p>
      </section>
    </div>
  );
}

// ── Phase card ──────────────────────────────────────────────────────────────

function PhaseCard({ phase }: { phase: PhaseSummary }) {
  const colorClass = SEASON_COLORS[phase.season];
  const textClass  = SEASON_TEXT[phase.season];
  return (
    <div className={`rounded-xl border p-4 ${colorClass}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${textClass}`}>
        {SEASON_LABELS[phase.season]}
      </p>
      <p className="text-xs text-gray-400 mb-3">
        {phase.startYear}–{phase.endYear} · {phase.years} yr{phase.years !== 1 ? 's' : ''}
      </p>
      <div className="space-y-1.5 text-xs">
        <PhaseMetric label="Avg conversion" value={phase.avgConversion > 0 ? formatCurrency(phase.avgConversion, true) : '—'} />
        <PhaseMetric label="Total fed tax" value={formatCurrency(phase.totalTax, true)} dim />
        {phase.avgSS > 0 && <PhaseMetric label="Avg SS income" value={formatCurrency(phase.avgSS, true)} />}
        <PhaseMetric label="Pretax at end" value={formatCurrency(phase.endPretax, true)} dim />
        <PhaseMetric label="Roth at end" value={formatCurrency(phase.endRoth, true)} highlight />
      </div>
    </div>
  );
}

function PhaseMetric({
  label, value, dim, highlight,
}: { label: string; value: string; dim?: boolean; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className={highlight ? 'text-green-400 font-medium' : dim ? 'text-gray-500' : 'text-gray-200'}>
        {value}
      </span>
    </div>
  );
}

// ── Table row ───────────────────────────────────────────────────────────────

function ProjectionRow({ projection: p }: { projection: YearlyProjection }) {
  const textClass = SEASON_TEXT[p.season];
  const ssTotal = p.income.socialSecurityClient + p.income.socialSecuritySpouse;

  return (
    <tr className="hover:bg-gray-800/50 transition-colors">
      <td className="px-3 py-2 text-gray-300">{p.year}</td>
      <td className="px-3 py-2 text-gray-300">{p.clientAge}</td>
      <td className={`px-3 py-2 font-medium ${textClass}`}>{SEASON_LABELS[p.season]}</td>
      <td className="px-3 py-2 text-right text-gray-300 tabular-nums">{formatCurrency(p.magi, true)}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {ssTotal > 0 ? (
          <span className="text-green-400">{formatCurrency(ssTotal, true)}</span>
        ) : (
          <span className="text-gray-600">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {p.rothConversion ? (
          <span className="text-green-300 font-medium">
            {formatCurrency(p.rothConversion.conversionAmount, true)}
          </span>
        ) : (
          <span className="text-gray-600">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-amber-400 tabular-nums">
        {formatCurrency(p.taxLiability.totalFederalTax, true)}
      </td>
      <td className="px-3 py-2 text-right text-amber-300 tabular-nums">
        {formatCurrency(p.pretaxEndBalance, true)}
      </td>
      <td className="px-3 py-2 text-right text-green-400 tabular-nums">
        {formatCurrency(p.rothEndBalance, true)}
      </td>
      <td className="px-3 py-2 text-right text-white font-medium tabular-nums">
        {formatCurrency(p.portfolioEndBalance, true)}
      </td>
    </tr>
  );
}
