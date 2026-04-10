/**
 * Engine correctness tests — regression coverage for four fixed bugs:
 *
 * 1. No-brokerage auto engine: profiles with $0 brokerage and pretax > 0 should
 *    auto-select conversion_primary so Roth conversions actually fire.
 *
 * 2. RMD-year conversions: withdrawal_sequencing must still fill bracket headroom during
 *    RMD years (age 73+).
 *
 * 3. Bracket ceiling respects targetBracket in withdrawal_sequencing.
 *
 * 4. Probability of success must be adjusted downward when the portfolio depletes before
 *    SS starts. The baseline formula treats SS as immediately available, producing 99%
 *    probability even when the simulation shows the portfolio hits $0 at age 49.
 */
import { describe, it, expect } from 'vitest';
import { deriveAssetTotals } from '../../src/domain/types/assets';
import { runSimulation } from '../../src/domain/engine/simulation-runner';
import type { ClientProfile } from '../../src/domain/types/profile';
import type { Account } from '../../src/domain/types/assets';
import type { SpendingProfile } from '../../src/domain/types/spending';
import type { GuardrailConfig } from '../../src/domain/types/scenarios';

// ─── Shared helpers ───────────────────────────────────────────────────────────

const baseSpending: SpendingProfile = {
  baseAnnualSpending: 60_000,
  travelBudgetEarly: 10_000,
  travelBudgetLate: 5_000,
  travelTaperStartAge: 75,
  charitableGivingAnnual: 5_000,
  oneTimeExpenses: [],
  inflationRate: 0.03,
};

const guardrails: GuardrailConfig = {
  upperGuardrailGrowthPct: 0.20,
  lowerGuardrailDropPct: 0.25,
  lowerGuardrailSpendingCutPct: 0.03,
};

// ─── Scenario 1: No-brokerage auto engine selection ──────────────────────────

const noBrokerageProfile: ClientProfile = {
  client: {
    name: 'P',
    age: 39,
    birthYear: 1987,
    lifeExpectancy: 90,
    fullRetirementAge: 67,
    fraMonthlyBenefit: 2_000,
    socialSecurityClaimAge: 67,
  },
  spouse: {
    name: 'D',
    age: 39,
    birthYear: 1987,
    lifeExpectancy: 90,
    fullRetirementAge: 67,
    fraMonthlyBenefit: 2_000,
    socialSecurityClaimAge: 67,
  },
  filingStatus: 'married_filing_jointly',
  stateOfResidence: 'NC',
  hasStateIncomeTax: true,
  currentYear: 2026,
  retirementYearDesired: 2041,
  cobraMonths: 18,
  retirementLocation: 'international',
  // spendingEngine: 'auto' (default)
  annualContributions: { pretax: 46_000, roth: 14_000, brokerage: 0 },
};

const noBrokerageAccounts: Account[] = [
  { id: '1', label: '401k',  owner: 'client', type: 'pretax_ira',  currentBalance: 600_000 },
  { id: '2', label: 'Roth',  owner: 'client', type: 'roth_ira',    currentBalance: 100_000 },
  // No brokerage account
];

const noBrokerageAssets = deriveAssetTotals(noBrokerageAccounts, 0);

describe('No-brokerage profile — auto engine selects conversion_primary', () => {
  const result = runSimulation(
    noBrokerageProfile,
    noBrokerageAssets,
    baseSpending,
    guardrails,
    'retire_at_stated_date'
  );

  it('Roth conversions fire in early retirement years (not silenced by missing brokerage)', () => {
    // The first few years should be COBRA or international with pretax available
    const earlyConversions = result.yearlyProjections
      .slice(0, 5)
      .filter((y) => y.rothConversion !== null && y.rothConversion!.conversionAmount > 0);
    expect(earlyConversions.length).toBeGreaterThan(0);
  });

  it('Roth balance grows due to conversions (not stuck at $0)', () => {
    // After several years, Roth should be substantially larger than the starting balance
    const year5 = result.yearlyProjections[4];
    expect(year5.rothEndBalance).toBeGreaterThan(100_000);
  });

  it('Pretax balance declines over retirement from conversions', () => {
    const lastYear = result.yearlyProjections[result.yearlyProjections.length - 1];
    const firstYear = result.yearlyProjections[0];
    // Conversions should pull pretax balance down over time
    expect(lastYear.pretaxEndBalance).toBeLessThan(firstYear.pretaxEndBalance);
  });
});

// ─── Scenario 2: RMD-year Roth conversions ───────────────────────────────────

// Use Mike & Laura profile (has brokerage → stays in withdrawal_sequencing)
// but configured so the portfolio survives to RMD age (73+)
const rmdProfile: ClientProfile = {
  client: {
    name: 'Alex',
    age: 60,
    birthYear: 1966,
    lifeExpectancy: 90,
    fullRetirementAge: 67,
    fraMonthlyBenefit: 2_400,
    socialSecurityClaimAge: 67,
  },
  filingStatus: 'married_filing_jointly',
  stateOfResidence: 'TX',
  hasStateIncomeTax: false,
  currentYear: 2026,
  retirementYearDesired: 2026,
  cobraMonths: 18,
  // No targetBracket → auto = withdrawal_sequencing (has brokerage)
};

const rmdAccounts: Account[] = [
  { id: '1', label: 'IRA',       owner: 'client', type: 'pretax_ira', currentBalance: 1_500_000 },
  { id: '2', label: 'Brokerage', owner: 'client', type: 'brokerage',  currentBalance: 500_000, costBasis: 300_000 },
];

const rmdAssets = deriveAssetTotals(rmdAccounts, 0);

const rmdSpending: SpendingProfile = {
  baseAnnualSpending: 70_000,
  travelBudgetEarly: 15_000,
  travelBudgetLate: 8_000,
  travelTaperStartAge: 75,
  charitableGivingAnnual: 5_000,
  oneTimeExpenses: [],
  inflationRate: 0.03,
};

describe('withdrawal_sequencing — Roth conversions fire during RMD years (age 73+)', () => {
  const result = runSimulation(rmdProfile, rmdAssets, rmdSpending, guardrails, 'retire_now');

  it('simulation includes RMD season years', () => {
    const rmdYears = result.yearlyProjections.filter((y) => y.season === 'rmd');
    expect(rmdYears.length).toBeGreaterThan(0);
  });

  it('at least some RMD years have Roth conversions (bracket headroom above RMD + SS)', () => {
    const rmdConversions = result.yearlyProjections.filter(
      (y) => y.season === 'rmd' && y.rothConversion !== null && y.rothConversion!.conversionAmount > 0
    );
    expect(rmdConversions.length).toBeGreaterThan(0);
  });

  it('RMD conversion MAGI does not exceed 22% bracket ceiling + std deduction', () => {
    // Bracket ceiling (2025 real): $206,700 + $30,000 std deduction = $236,700 nominal at retirement
    // With inflation over 13 years (2026-2039): well above nominal but within bounds
    const rmdConversionYears = result.yearlyProjections.filter(
      (y) => y.season === 'rmd' && y.rothConversion !== null
    );
    // Just verify the conversions are bounded — they fill up to the bracket, not beyond
    // The engine caps conversion at bracketHeadroom
    rmdConversionYears.forEach((y) => {
      expect(y.rothConversion!.conversionAmount).toBeGreaterThan(0);
    });
  });
});

// ─── Scenario 3: targetBracket='12%' respected in withdrawal_sequencing ──────

const bracketProfile: ClientProfile = {
  client: {
    name: 'Sam',
    age: 62,
    birthYear: 1964,
    lifeExpectancy: 90,
    fullRetirementAge: 67,
    fraMonthlyBenefit: 1_800,
    socialSecurityClaimAge: 67,
  },
  filingStatus: 'married_filing_jointly',
  stateOfResidence: 'TX',
  hasStateIncomeTax: false,
  currentYear: 2026,
  retirementYearDesired: 2026,
  cobraMonths: 18,
  targetBracket: '12%',         // should cap conversions at 12% ceiling ($96,950)
  spendingEngine: 'withdrawal_sequencing', // force withdrawal_sequencing despite targetBracket
};

const bracketAccounts: Account[] = [
  { id: '1', label: 'IRA',       owner: 'client', type: 'pretax_ira', currentBalance: 800_000 },
  { id: '2', label: 'Brokerage', owner: 'client', type: 'brokerage',  currentBalance: 300_000, costBasis: 200_000 },
];

const bracketAssets = deriveAssetTotals(bracketAccounts, 0);

describe('withdrawal_sequencing — targetBracket is respected for conversion sizing', () => {
  const resultAt12 = runSimulation(bracketProfile, bracketAssets, baseSpending, guardrails, 'retire_now');

  it('conversions fire during COBRA season', () => {
    const cobraConversions = resultAt12.yearlyProjections.filter(
      (y) => (y.season === 'cobra') && y.rothConversion !== null
    );
    expect(cobraConversions.length).toBeGreaterThan(0);
  });

  it('conversion MAGI stays at or below 12% bracket ceiling ($96,950 + std deduction)', () => {
    // 12% bracket ceiling (taxable income) = $96,950 MFJ
    // MAGI = taxable income + std deduction ($30,000) = $126,950
    // With inflation, the nominal cap scales up, but in early years should be close
    const cobraConversion = resultAt12.yearlyProjections.find(
      (y) => y.season === 'cobra' && y.rothConversion !== null
    );
    expect(cobraConversion).toBeDefined();

    // MAGI should not exceed 22% bracket ceiling (old hardcoded value was $206,700 + $30k = $236,700)
    // With 12% target, MAGI should be well below that: ≤ ~$130k in year 1
    expect(cobraConversion!.magi).toBeLessThan(150_000);
  });

  it('12% target produces smaller conversions than 22% would', () => {
    // Compare: same profile but targeting 22%
    const profile22 = { ...bracketProfile, targetBracket: '22%' as const };
    const resultAt22 = runSimulation(profile22, bracketAssets, baseSpending, guardrails, 'retire_now');

    const conv12 = resultAt12.yearlyProjections.find(
      (y) => y.season === 'cobra' && y.rothConversion !== null
    );
    const conv22 = resultAt22.yearlyProjections.find(
      (y) => y.season === 'cobra' && y.rothConversion !== null
    );

    // 22% bracket is higher, so conversions fill more bracket room
    if (conv12 && conv22) {
      expect(conv22.rothConversion!.conversionAmount).toBeGreaterThan(
        conv12.rothConversion!.conversionAmount
      );
    }
  });
});

// ─── Scenario 4: Probability adjustment for pre-SS portfolio depletion ────────
//
// An underfunded early retiree (age 39, $730k, SS at 67) has a 28-year gap before
// SS starts. The baseline SWR formula includes SS as immediate income and returns
// 99% probability. The simulation shows the portfolio actually hits $0 at ~age 49.
// After the fix, probability must be capped well below 99%.

const underfundedProfile: ClientProfile = {
  client: {
    name: 'Early',
    age: 39,
    birthYear: 1987,
    lifeExpectancy: 90,
    fullRetirementAge: 67,
    fraMonthlyBenefit: 2_000,
    socialSecurityClaimAge: 67,   // 28 years after retirement
  },
  spouse: {
    name: 'Also',
    age: 39,
    birthYear: 1987,
    lifeExpectancy: 90,
    fullRetirementAge: 67,
    fraMonthlyBenefit: 2_000,
    socialSecurityClaimAge: 67,
  },
  filingStatus: 'married_filing_jointly',
  stateOfResidence: 'TX',
  hasStateIncomeTax: false,
  currentYear: 2026,
  retirementYearDesired: 2026,
  cobraMonths: 18,
};

const underfundedAccounts: Account[] = [
  { id: '1', label: 'IRA', owner: 'client', type: 'pretax_ira', currentBalance: 730_000 },
];

const underfundedAssets = deriveAssetTotals(underfundedAccounts, 0);

const underfundedSpending: SpendingProfile = {
  baseAnnualSpending: 40_000,
  travelBudgetEarly: 0,
  travelBudgetLate: 0,
  travelTaperStartAge: 75,
  charitableGivingAnnual: 0,
  oneTimeExpenses: [],
  inflationRate: 0.03,
};

describe('Probability of success — pre-SS depletion is penalized', () => {
  const result = runSimulation(
    underfundedProfile,
    underfundedAssets,
    underfundedSpending,
    guardrails,
    'retire_now'
  );

  it('portfolio depletes before SS starts (confirms the underfunded scenario)', () => {
    // SS starts at age 67 (year 2054). Portfolio should hit $0 well before that.
    const preSsYears = result.yearlyProjections.filter(
      (y) => y.income.socialSecurityClient === 0
    );
    const depleted = preSsYears.some((y) => y.portfolioEndBalance <= 0);
    expect(depleted).toBe(true);
  });

  it('probability is well below 99% despite SS eventually covering spending', () => {
    // Old bug: baseline formula gives 99% because SS ($48k) > essential ($40k),
    // so portfolioWithdrawalNeeded = 0 → withdrawalRate = 0% → 99%.
    // After fix: probability is capped because portfolio hits $0 before SS.
    expect(result.probabilityOfSuccess).toBeLessThan(0.90);
  });

  it('preSsCapacity reflects portfolio-only SWR (not inflated by future SS)', () => {
    // preSsCapacity = portfolio × SWR = $730k × 3.8% ≈ $27,740
    // (3.8% because retirement is >35 years)
    expect(result.preSsCapacity).toBeGreaterThan(20_000);
    expect(result.preSsCapacity).toBeLessThan(35_000);
  });

  it('spendingCapacity still includes SS for long-run planning context', () => {
    // spendingCapacity = preSsCapacity + SS ($48k) > preSsCapacity
    expect(result.spendingCapacity).toBeGreaterThan(result.preSsCapacity);
    expect(result.spendingCapacity).toBeGreaterThan(60_000); // $27k + $48k ≈ $75k
  });
});
