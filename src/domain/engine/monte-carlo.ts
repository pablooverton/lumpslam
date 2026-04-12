/**
 * Monte Carlo simulation engine for retirement planning.
 *
 * Runs N independent trials, each with a randomized annual return sequence drawn
 * from a normal distribution. The flat deterministic return in runSimulation() is
 * replaced by a per-year draw — this surfaces sequence-of-returns risk that a
 * single-rate projection cannot show.
 *
 * Distribution: Normal(mean, stdDev) per year, clamped to [-0.60, +0.60].
 * Log-normal is theoretically more precise, but for 30-40 year retirement horizons
 * the practical difference is negligible and normal is more transparent.
 *
 * Boglehead-calibrated defaults:
 *   Portfolio      | Nominal mean | Std dev
 *   60/40 blended  |    8%        |  12%    ← default
 *   70/30 tilt     |    9%        |  14%
 *   80/20 equity   |   10%        |  15%
 *   100% equity    |   10%        |  17%
 *   Conservative   |    7%        |   9%
 */

import type { ClientProfile } from '../types/profile';
import type { AssetSnapshot } from '../types/assets';
import type { SpendingProfile } from '../types/spending';
import type { GuardrailConfig, ScenarioType } from '../types/scenarios';
import { runSimulation } from './simulation-runner';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MonteCarloConfig {
  simulations: number;        // number of trials. 1000 = fast; 5000 = tighter CI
  meanNominalReturn: number;  // arithmetic mean annual nominal return, e.g. 0.08
  stdDevReturn: number;       // annualized std dev of annual returns, e.g. 0.12 for 60/40
}

export interface PercentileBand {
  year: number;
  clientAge: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
}

export interface MonteCarloResult {
  successRate: number;           // fraction of trials where portfolio never depletes
  medianFinalPortfolio: number;
  p10FinalPortfolio: number;     // 10th percentile — stress scenario
  p25FinalPortfolio: number;
  p75FinalPortfolio: number;
  p90FinalPortfolio: number;
  portfolioBands: PercentileBand[];
  config: MonteCarloConfig;
  simulations: number;           // actual trial count run
}

// ─── Random number generation ─────────────────────────────────────────────────

/** Box-Muller transform: produces a standard normal N(0,1) sample. */
function randomNormal(): number {
  const u = 1 - Math.random(); // avoid log(0)
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Generate one year's nominal return: mean + stdDev * Z, clamped to [-60%, +60%]. */
function sampleReturn(mean: number, stdDev: number): number {
  const r = mean + stdDev * randomNormal();
  return Math.max(-0.6, Math.min(0.6, r));
}

// ─── Percentile utility ───────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

// ─── Main runner ──────────────────────────────────────────────────────────────

export function runMonteCarlo(
  profile: ClientProfile,
  assets: AssetSnapshot,
  spending: SpendingProfile,
  guardrails: GuardrailConfig,
  scenarioType: ScenarioType,
  config: MonteCarloConfig,
): MonteCarloResult {
  // Determine retirement span
  const targetYear = profile.retirementYearDesired ?? profile.currentYear;
  const retirementYear =
    scenarioType === 'retire_now'         ? profile.currentYear
    : scenarioType === 'retire_at_stated_date' ? targetYear
    : targetYear + 3;

  const endYear =
    profile.currentYear +
    Math.max(
      profile.client.lifeExpectancy - profile.client.age,
      profile.spouse ? profile.spouse.lifeExpectancy - profile.spouse.age : 0
    );

  const retirementYears = Math.max(1, endYear - retirementYear + 1);

  // Collect per-year and final-portfolio outcomes across all trials
  const finalPortfolios: number[] = [];
  let successCount = 0;

  // portfoliosByYear[yearIndex] = array of portfolio values across trials
  const portfoliosByYear: number[][] = Array.from({ length: retirementYears }, () => []);

  for (let sim = 0; sim < config.simulations; sim++) {
    // Generate a unique return sequence for this trial
    const returnSequence = Array.from({ length: retirementYears }, () =>
      sampleReturn(config.meanNominalReturn, config.stdDevReturn)
    );

    const result = runSimulation(
      profile, assets, spending, guardrails, scenarioType, returnSequence
    );

    // Collect year-by-year portfolio values
    result.yearlyProjections.forEach((proj, i) => {
      if (i < retirementYears) {
        portfoliosByYear[i].push(proj.portfolioEndBalance);
      }
    });

    const finalBalance = result.yearlyProjections.at(-1)?.portfolioEndBalance ?? 0;
    finalPortfolios.push(finalBalance);
    if (finalBalance > 0) successCount++;
  }

  // Sort final portfolios for percentiles
  finalPortfolios.sort((a, b) => a - b);

  // Build per-year percentile bands
  const portfolioBands: PercentileBand[] = portfoliosByYear
    .map((yearValues, i) => {
      if (yearValues.length === 0) return null;
      yearValues.sort((a, b) => a - b);
      const year = retirementYear + i;
      const clientAge = profile.client.age + (year - profile.currentYear);
      return {
        year,
        clientAge,
        p10:    percentile(yearValues, 0.10),
        p25:    percentile(yearValues, 0.25),
        median: percentile(yearValues, 0.50),
        p75:    percentile(yearValues, 0.75),
        p90:    percentile(yearValues, 0.90),
      };
    })
    .filter((b): b is PercentileBand => b !== null);

  return {
    successRate: successCount / config.simulations,
    medianFinalPortfolio:  percentile(finalPortfolios, 0.50),
    p10FinalPortfolio:     percentile(finalPortfolios, 0.10),
    p25FinalPortfolio:     percentile(finalPortfolios, 0.25),
    p75FinalPortfolio:     percentile(finalPortfolios, 0.75),
    p90FinalPortfolio:     percentile(finalPortfolios, 0.90),
    portfolioBands,
    config,
    simulations: config.simulations,
  };
}
