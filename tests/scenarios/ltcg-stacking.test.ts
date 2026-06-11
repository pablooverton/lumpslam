/**
 * LTCG stacking — realized gains are taxed on the capital-gains schedule (0/15/20%),
 * stacked above ordinary taxable income, instead of at ordinary rates (sequencing) or
 * not at all (conversion_primary, coast). Gains stay in MAGI for ACA/IRMAA.
 */
import { describe, it, expect } from 'vitest';
import { runSimulation } from '../../src/domain/engine/simulation-runner';
import { calculateLtcgTax } from '../../src/domain/engine/tax-utils';
import { deriveAssetTotals } from '../../src/domain/types/assets';
import type { Account } from '../../src/domain/types/assets';
import type { ClientProfile, PersonProfile } from '../../src/domain/types/profile';
import type { SpendingProfile } from '../../src/domain/types/spending';
import type { GuardrailConfig } from '../../src/domain/types/scenarios';

const GUARDRAILS: GuardrailConfig = {
  upperGuardrailGrowthPct: 0.2,
  lowerGuardrailDropPct: 0.99,
  lowerGuardrailSpendingCutPct: 0,
};

function person(opts: Partial<PersonProfile> & { age: number; birthYear: number; lifeExpectancy: number }): PersonProfile {
  return { name: 'T', fullRetirementAge: 67, fraMonthlyBenefit: 0, socialSecurityClaimAge: 70, ...opts };
}

// ─── Helper math ──────────────────────────────────────────────────────────────

describe('calculateLtcgTax — stacking math (MFJ 2025: 0% to $96,700, then 15%)', () => {
  it('gains entirely inside the 0% bracket are tax-free', () => {
    expect(calculateLtcgTax(50_000, 20_000, 'married_filing_jointly')).toBe(0);
  });

  it('gains straddling the 0%/15% boundary are taxed only above it', () => {
    // floor 80,000 + gains 30,000 → 16,700 at 0%, 13,300 at 15%
    expect(calculateLtcgTax(30_000, 80_000, 'married_filing_jointly')).toBeCloseTo(13_300 * 0.15, 6);
  });

  it('a high ordinary floor pushes all gains to 15%', () => {
    expect(calculateLtcgTax(25_000, 206_700, 'married_filing_jointly')).toBeCloseTo(3_750, 6);
  });

  it('single-filer ceilings apply', () => {
    expect(calculateLtcgTax(10_000, 48_350, 'single')).toBeCloseTo(1_500, 6);
  });
});

// ─── The 0%-harvest in an ACA year (sequencing) ──────────────────────────────

describe('LTCG — ACA-year brokerage living realizes gains at 0% (the harvest)', () => {
  const profile: ClientProfile = {
    client: person({ age: 60, birthYear: 1966, lifeExpectancy: 63 }),
    spouse: null,
    filingStatus: 'married_filing_jointly',
    stateOfResidence: 'TX',
    hasStateIncomeTax: false,
    currentYear: 2026,
    retirementYearDesired: 2026,
    cobraMonths: 0,
    annualGrowthRate: 0,
    spendingEngine: 'withdrawal_sequencing',
  };
  const accounts: Account[] = [
    { id: 'b', label: 'brok', owner: 'client', type: 'brokerage', currentBalance: 2_000_000, costBasis: 1_000_000 },
  ];
  const spending: SpendingProfile = {
    baseAnnualSpending: 80_000,
    travelBudgetEarly: 0, travelBudgetLate: 0, travelTaperStartAge: 120,
    charitableGivingAnnual: 0, oneTimeExpenses: [], inflationRate: 0.03,
  };
  const result = runSimulation(profile, deriveAssetTotals(accounts, 0), spending, GUARDRAILS, 'retire_at_stated_date');
  const y = result.yearlyProjections[0];

  it('the year is an ACA year living off brokerage with 50% realized gains', () => {
    expect(y.season).toBe('aca');
    expect(y.withdrawals.fromBrokerage).toBeCloseTo(80_000, 0);
    expect(y.capitalGainsRealized).toBeCloseTo(40_000, 0);
    expect(y.magi).toBeCloseTo(40_000, 0); // gains stay in MAGI — under the cliff
    expect(y.acaSubsidyEligible).toBe(true);
  });

  it('zero federal tax: no ordinary income, gains inside the 0% bracket (was: ordinary-taxed)', () => {
    expect(y.taxLiability.capitalGainsTax).toBe(0);
    expect(y.taxLiability.totalFederalTax).toBe(0);
  });
});

// ─── Conversions push gains out of the 0% bracket (the interplay) ────────────

describe('LTCG — a bracket-filling conversion stacks gains into the 15% tier', () => {
  const profile: ClientProfile = {
    client: person({ age: 66, birthYear: 1960, lifeExpectancy: 66 }),
    spouse: null,
    filingStatus: 'married_filing_jointly',
    stateOfResidence: 'TX',
    hasStateIncomeTax: false,
    currentYear: 2026,
    retirementYearDesired: 2026,
    cobraMonths: 18, // cobra season: nonEssential spend draws brokerage first, and conversions fire
    annualGrowthRate: 0,
    spendingEngine: 'withdrawal_sequencing',
  };
  const accounts: Account[] = [
    { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 2_000_000 },
    { id: 'b', label: 'brok', owner: 'client', type: 'brokerage', currentBalance: 600_000, costBasis: 300_000 },
  ];
  const spending: SpendingProfile = {
    baseAnnualSpending: 80_000,
    travelBudgetEarly: 50_000, // routed to brokerage in cobra season → realizes gains
    travelBudgetLate: 50_000, travelTaperStartAge: 120,
    charitableGivingAnnual: 0, oneTimeExpenses: [], inflationRate: 0.03,
  };
  const result = runSimulation(profile, deriveAssetTotals(accounts, 0), spending, GUARDRAILS, 'retire_at_stated_date');
  const y = result.yearlyProjections[0];

  it('gains realized alongside a conversion are taxed at 15%, not 0% and not ordinary rates', () => {
    expect(y.rothConversion?.conversionAmount ?? 0).toBeGreaterThan(0);
    const gains = y.capitalGainsRealized ?? 0;
    expect(gains).toBeCloseTo(25_000, 0);
    // Ordinary floor (post-conversion taxable) sits above the $96,700 0%-ceiling → all 15%.
    expect(y.taxLiability.capitalGainsTax).toBeCloseTo(0.15 * gains, 0);
  });
});

// ─── conversion_primary lumpy draws (was: gains never taxed) ─────────────────

describe('LTCG — conversion_primary lumpy brokerage draw pays 15% above a 22% floor', () => {
  const profile: ClientProfile = {
    client: person({ age: 66, birthYear: 1960, lifeExpectancy: 66 }),
    spouse: null,
    filingStatus: 'married_filing_jointly',
    stateOfResidence: 'TX',
    hasStateIncomeTax: false,
    currentYear: 2026,
    retirementYearDesired: 2026,
    cobraMonths: 0,
    annualGrowthRate: 0,
    spendingEngine: 'conversion_primary',
    targetBracket: '22%',
  };
  const accounts: Account[] = [
    { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 2_000_000 },
    { id: 'r', label: 'roth', owner: 'client', type: 'roth_ira', currentBalance: 500_000, rothContributionBasis: 500_000 },
    { id: 'b', label: 'brok', owner: 'client', type: 'brokerage', currentBalance: 300_000, costBasis: 150_000 },
  ];
  const spending: SpendingProfile = {
    baseAnnualSpending: 100_000,
    travelBudgetEarly: 0, travelBudgetLate: 0, travelTaperStartAge: 120,
    charitableGivingAnnual: 0,
    oneTimeExpenses: [{ year: 2026, label: 'roof', amount: 50_000 }],
    inflationRate: 0.03,
  };
  const result = runSimulation(profile, deriveAssetTotals(accounts, 0), spending, GUARDRAILS, 'retire_at_stated_date');
  const y = result.yearlyProjections[0];

  it('the $25k of lumpy gains stacks above the 22%-filled floor at 15%', () => {
    expect(y.capitalGainsRealized).toBeCloseTo(25_000, 0);
    expect(y.taxLiability.capitalGainsTax).toBeCloseTo(3_750, 0);
    expect(y.magi).toBeCloseTo(236_700 + 25_000, 0); // conversion fill + gains
  });

  it('the gains tax is funded — the year conserves to the dollar (growth=0)', () => {
    const drop = y.portfolioStartBalance - y.portfolioEndBalance;
    const expected =
      150_000 + y.taxLiability.totalFederalTax + y.taxLiability.stateTax
      + (y.taxLiability.earlyWithdrawalPenalty ?? 0);
    expect(Math.abs(drop - expected)).toBeLessThan(1);
  });
});
