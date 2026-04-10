'use client';

import type { YearlyProjection } from '@/domain/types/simulation';
import { formatCurrency } from '@/lib/format';

interface PortfolioChartProps {
  projections: YearlyProjection[];
  /** How many years to display. Default: all */
  years?: number;
}

// Pure SVG stacked area chart — no dependencies.
// Shows pretax (amber), Roth (green), brokerage (blue) balances over time.
// On hover, shows a tooltip with exact values for that year.
export function PortfolioChart({ projections, years }: PortfolioChartProps) {
  const data = years ? projections.slice(0, years) : projections;
  if (data.length === 0) return null;

  const W = 700;
  const H = 200;
  const PAD_L = 60;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 28;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  // Max total for y-axis scaling
  const maxTotal = Math.max(...data.map((p) => p.portfolioEndBalance));
  const yMax = Math.ceil(maxTotal / 1_000_000) * 1_000_000; // round to nearest $1M

  function xOf(i: number) {
    return PAD_L + (i / (data.length - 1)) * chartW;
  }
  function yOf(val: number) {
    return PAD_T + chartH - (val / yMax) * chartH;
  }

  // Build stacked area paths: bottom=brokerage, mid=roth, top=pretax
  function polyPoints(
    bottomFn: (p: YearlyProjection) => number,
    topFn: (p: YearlyProjection) => number
  ): string {
    const forward = data.map((p, i) => `${xOf(i)},${yOf(topFn(p))}`).join(' ');
    const backward = [...data]
      .reverse()
      .map((p, ri) => {
        const i = data.length - 1 - ri;
        return `${xOf(i)},${yOf(bottomFn(p))}`;
      })
      .join(' ');
    return `${forward} ${backward}`;
  }

  // Top portfolio line
  function linePath(fn: (p: YearlyProjection) => number): string {
    return data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(fn(p))}`).join(' ');
  }

  // Y-axis gridlines at round $M marks
  const gridLines: number[] = [];
  for (let v = 0; v <= yMax; v += yMax / 4) gridLines.push(v);

  // Season coloring: shade background by season
  const seasonBands: Array<{ x: number; w: number; season: string }> = [];
  let bandStart = 0;
  let bandSeason = data[0]?.season;
  data.forEach((p, i) => {
    if (p.season !== bandSeason || i === data.length - 1) {
      const x0 = xOf(bandStart);
      const x1 = xOf(i === data.length - 1 ? i : i - 1);
      seasonBands.push({ x: x0, w: x1 - x0, season: bandSeason });
      bandStart = i;
      bandSeason = p.season;
    }
  });

  const SEASON_FILL: Record<string, string> = {
    cobra: 'rgba(168,85,247,0.06)',
    aca: 'rgba(59,130,246,0.06)',
    medicare: 'rgba(20,184,166,0.06)',
    rmd: 'rgba(251,146,60,0.08)',
    international: 'rgba(168,85,247,0.06)',
  };

  return (
    <div className="relative">
      {/* Legend */}
      <div className="flex gap-5 mb-3 text-xs text-gray-400">
        <LegendDot color="#f59e0b" label="Pre-tax (depleting)" />
        <LegendDot color="#22c55e" label="Roth (growing)" />
        <LegendDot color="#3b82f6" label="Brokerage" />
        <span className="ml-auto text-gray-600 italic">hover for values</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: '220px' }}
        role="img"
        aria-label="Portfolio balance trajectory by account type"
      >
        {/* Season background bands */}
        {seasonBands.map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={PAD_T}
            width={b.w}
            height={chartH}
            fill={SEASON_FILL[b.season] ?? 'transparent'}
          />
        ))}

        {/* Y-axis gridlines */}
        {gridLines.map((v) => {
          const y = yOf(v);
          return (
            <g key={v}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#374151" strokeWidth={0.5} />
              <text
                x={PAD_L - 6}
                y={y + 4}
                textAnchor="end"
                fontSize={9}
                fill="#6b7280"
              >
                {v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v === 0 ? '$0' : `$${(v / 1000).toFixed(0)}k`}
              </text>
            </g>
          );
        })}

        {/* Stacked areas — brokerage (bottom) */}
        <polygon
          points={polyPoints(
            () => 0,
            (p) => p.brokerageEndBalance
          )}
          fill="#3b82f6"
          fillOpacity={0.25}
        />

        {/* Roth area (above brokerage) */}
        <polygon
          points={polyPoints(
            (p) => p.brokerageEndBalance,
            (p) => p.brokerageEndBalance + p.rothEndBalance
          )}
          fill="#22c55e"
          fillOpacity={0.30}
        />

        {/* Pretax area (top) */}
        <polygon
          points={polyPoints(
            (p) => p.brokerageEndBalance + p.rothEndBalance,
            (p) => p.portfolioEndBalance
          )}
          fill="#f59e0b"
          fillOpacity={0.30}
        />

        {/* Total portfolio line */}
        <path
          d={linePath((p) => p.portfolioEndBalance)}
          fill="none"
          stroke="rgba(255,255,255,0.5)"
          strokeWidth={1.5}
        />

        {/* Roth line */}
        <path
          d={linePath((p) => p.brokerageEndBalance + p.rothEndBalance)}
          fill="none"
          stroke="#22c55e"
          strokeWidth={1}
          strokeDasharray="3 2"
        />

        {/* Hover dots — invisible but wide hit area */}
        {data.map((p, i) => (
          <g key={p.year}>
            <title>
              {p.year} (age {p.clientAge})
              {'\n'}Pre-tax: {formatCurrency(p.pretaxEndBalance, false)}
              {'\n'}Roth: {formatCurrency(p.rothEndBalance, false)}
              {'\n'}Total: {formatCurrency(p.portfolioEndBalance, false)}
            </title>
            <rect
              x={xOf(i) - 4}
              y={PAD_T}
              width={8}
              height={chartH}
              fill="transparent"
              className="cursor-crosshair"
            />
            <circle
              cx={xOf(i)}
              cy={yOf(p.portfolioEndBalance)}
              r={2}
              fill="rgba(255,255,255,0.4)"
            />
          </g>
        ))}

        {/* X-axis: year labels every ~5 */}
        {data
          .filter((_, i) => i === 0 || (data[i].year % 5 === 0) || i === data.length - 1)
          .map((p, _, arr) => {
            const i = data.indexOf(p);
            return (
              <text
                key={p.year}
                x={xOf(i)}
                y={H - 4}
                textAnchor="middle"
                fontSize={9}
                fill="#6b7280"
              >
                {p.year}
              </text>
            );
          })}

        {/* Chart border */}
        <rect
          x={PAD_L}
          y={PAD_T}
          width={chartW}
          height={chartH}
          fill="none"
          stroke="#374151"
          strokeWidth={0.5}
        />
      </svg>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block w-2.5 h-2.5 rounded-sm"
        style={{ background: color, opacity: 0.7 }}
      />
      {label}
    </span>
  );
}
