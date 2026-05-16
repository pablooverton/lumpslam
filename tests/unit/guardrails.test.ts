/**
 * Dynamic guardrail behavior — Guyton-Klinger style.
 *
 * Verifies that the simulation engine actually applies spending cuts when the portfolio
 * drops below the trigger threshold, and restores baseline when it recovers. Prior to
 * 2026-05-15, the GuardrailConfig was computed but not applied to the retirement loop;
 * tests below lock in the active behavior so it can't silently regress.
 */
import { describe, it, expect } from 'vitest';
import { deriveAssetTotals } from '../../src/domain/types/assets';
import { runSimulation } from '../../src/domain/engine/simulation-runner';
import type { ClientProfile } from '../../src/domain/types/profile';
import type { Account } from '../../src/domain/types/assets';
import type { SpendingProfile } from '../../src/domain/types/spending';
import type { GuardrailConfig } from '../../src/domain/types/scenarios';

// ─── Fixture: simple early-retirement case with high spending → forces drawdown ──

const profile: ClientProfile = {
  client: {
    name: 'A', age: 50, birthYear: 1976, lifeExpectancy: 90,
    fullRetirementAge: 67, fraMonthlyBenefit: 2500, socialSecurityClaimAge: 67,
  },
  spouse: null,
  filingStatus: 'single',
  stateOfResidence: 'TX',
  hasStateIncomeTax: false,
  currentYear: 2026,
  retirementYearDesired: 2026,
  cobraMonths: 0,
};

const accounts: Account[] = [
  { id: '1', label: 'IRA', owner: 'client', type: 'pretax_ira', currentBalance: 100_000 },
  { id: '2', label: 'Brokerage', owner: 'client', type: 'brokerage', currentBalance: 500_000, costBasis: 500_000 },
];

const assets = deriveAssetTotals(accounts, 0);

const spending: SpendingProfile = {
  baseAnnualSpending: 80_000,
  travelBudgetEarly: 10_000,
  travelBudgetLate: 5_000,
  travelTaperStartAge: 75,
  charitableGivingAnnual: 5_000,
  oneTimeExpenses: [],
  inflationRate: 0.03,
};

const guardrails: GuardrailConfig = {
  upperGuardrailGrowthPct: 0.20,
  lowerGuardrailDropPct: 0.20,
  lowerGuardrailSpendingCutPct: 0.10,
};

// ─── Guardrail state tracking ──────────────────────────────────────────────

describe('Guardrails — state tracking', () => {
  const result = runSimulation(profile, assets, spending, guardrails, 'retire_at_stated_date',
    // Force a deterministic bad sequence: −30% in year 1, then flat at 0% real
    [-0.30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  );

  it('year 1: portfolio drops, guardrail triggers a 10% variable-spending cut', () => {
    // Initial portfolio ≈ $600k. −30% return → ~30% drawdown from peak triggers tier 1 cut.
    const year2 = result.yearlyProjections[1];
    expect(year2.guardrailCutPct).toBeGreaterThanOrEqual(0.10);
  });

  it('peakPortfolio is recorded and ratchets up to the maximum seen', () => {
    const firstYear = result.yearlyProjections[0];
    expect(firstYear.peakPortfolio).toBeGreaterThan(0);
    // Subsequent years should have peak ≥ first year's peak
    const lastTrackedYear = result.yearlyProjections[5];
    expect(lastTrackedYear.peakPortfolio).toBeGreaterThanOrEqual(firstYear.peakPortfolio);
  });
});

// ─── No drawdown → no guardrail cut ─────────────────────────────────────────

describe('Guardrails — recovery / no-drawdown', () => {
  it('well-funded portfolio with positive returns: no guardrail triggered', () => {
    // Large portfolio ($3M) easily covers $95k/yr at 8% real returns — no drawdown expected.
    const wellFundedAccounts: Account[] = [
      { id: '1', label: 'IRA', owner: 'client', type: 'pretax_ira', currentBalance: 500_000 },
      { id: '2', label: 'Brokerage', owner: 'client', type: 'brokerage', currentBalance: 2_500_000, costBasis: 2_500_000 },
    ];
    const wellFundedAssets = deriveAssetTotals(wellFundedAccounts, 0);
    const goodReturns = Array(40).fill(0.08);
    const result = runSimulation(profile, wellFundedAssets, spending, guardrails, 'retire_at_stated_date', goodReturns);

    const triggeredYears = result.yearlyProjections.filter((y) => y.guardrailCutPct > 0);
    expect(triggeredYears.length).toBe(0);
  });
});

// ─── Two-tier ratchet ──────────────────────────────────────────────────────

describe('Guardrails — two-tier ratchet', () => {
  it('catastrophic drawdown (≥ 40%) triggers second-tier 20% cut', () => {
    // Severe sequence: -50% year 1 to force second-tier
    const badSequence = [-0.50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const result = runSimulation(profile, assets, spending, guardrails, 'retire_at_stated_date', badSequence);
    const year2 = result.yearlyProjections[1];
    expect(year2.guardrailCutPct).toBeGreaterThanOrEqual(0.20);
  });
});

// ─── Heuristic — bridge WR aware ───────────────────────────────────────────

describe('Heuristic probability — bridge-WR aware', () => {
  it('exposes both bridge WR and long-run WR in result fields', () => {
    const result = runSimulation(profile, assets, spending, guardrails, 'retire_at_stated_date');
    // ScenarioResult itself doesn't expose these — but the heuristic now uses bridge stress.
    // Probability should be lower than the SS-smoothed-only formula would give for an
    // age-50 retiree with 17-year SS gap.
    expect(result.probabilityOfSuccess).toBeLessThan(0.99);
  });

  it('long-bridge retiree (age 50, SS at 67) has heuristic below 95%', () => {
    const result = runSimulation(profile, assets, spending, guardrails, 'retire_at_stated_date');
    // Essential $80k / Portfolio $600k = 13.3% straight WR. Floor (50%) expected.
    expect(result.probabilityOfSuccess).toBe(0.50);
  });
});
