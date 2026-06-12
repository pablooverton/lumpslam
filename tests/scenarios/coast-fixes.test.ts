/**
 * Coast-phase fixes (review Phase 3 #17):
 *   1. Mortgage P&I is charged during coast years (deflated nominal, retirement-loop convention)
 *      and stops after mortgagePaidOffAge.
 *   2. magiHistory is seeded from coast years, so the IRMAA 2-year lookback prices correctly
 *      in the first two retirement years after a coast.
 *   3. One-time flows dated inside a coast window attach a warning to the scenario result.
 */
import { describe, it, expect } from 'vitest';
import { runSimulation } from '../../src/domain/engine/simulation-runner';
import { deriveAssetTotals } from '../../src/domain/types/assets';
import type { Account } from '../../src/domain/types/assets';
import type { ClientProfile } from '../../src/domain/types/profile';
import type { SpendingProfile } from '../../src/domain/types/spending';
import type { GuardrailConfig } from '../../src/domain/types/scenarios';

const GUARDRAILS: GuardrailConfig = {
  upperGuardrailGrowthPct: 0.2,
  lowerGuardrailDropPct: 0.99,
  lowerGuardrailSpendingCutPct: 0,
};

function bareSpending(base: number): SpendingProfile {
  return {
    baseAnnualSpending: base,
    travelBudgetEarly: 0, travelBudgetLate: 0, travelTaperStartAge: 120,
    charitableGivingAnnual: 0, oneTimeExpenses: [], inflationRate: 0.03,
  };
}

describe('coast charges the mortgage', () => {
  // Client 50 in 2026; coast 2028–2031 (ages 52–55); mortgage paid off at 53 → charged in
  // 2028 (52) and 2029 (53), not 2030–2031. Brokerage is 100% basis, growth 0, income 0,
  // conversions 0 — the only difference between the runs is the mortgage itself.
  const base: ClientProfile = {
    client: {
      name: 'T', age: 50, birthYear: 1976, lifeExpectancy: 70,
      fullRetirementAge: 67, fraMonthlyBenefit: 0, socialSecurityClaimAge: 70,
    },
    spouse: null,
    filingStatus: 'married_filing_jointly',
    stateOfResidence: 'TX',
    hasStateIncomeTax: false,
    currentYear: 2026,
    retirementYearDesired: 2032,
    cobraMonths: 0,
    annualGrowthRate: 0,
    spendingEngine: 'withdrawal_sequencing',
    coastPhases: [
      { startYear: 2028, endYear: 2031, location: 'us', annualIncome: 0, usSourceIncomePct: 1, annualConversion: 0 },
    ],
  };
  const accounts: Account[] = [
    { id: 'b', label: 'brokerage', owner: 'client', type: 'brokerage', currentBalance: 2_000_000, costBasis: 2_000_000 },
  ];
  const assets = deriveAssetTotals(accounts, 0);

  const noMortgage = runSimulation(base, assets, bareSpending(50_000), GUARDRAILS, 'retire_at_stated_date');
  const withMortgage = runSimulation(
    base, assets,
    { ...bareSpending(50_000), mortgageAnnualPayment: 24_000, mortgagePaidOffAge: 53 },
    GUARDRAILS, 'retire_at_stated_date'
  );

  const coastOf = (r: typeof noMortgage) =>
    new Map(r.yearlyProjections.filter((p) => p.season === 'coast').map((p) => [p.year, p]));

  it('coast withdrawals rise by exactly the deflated nominal payment while unpaid', () => {
    const a = coastOf(withMortgage); const b = coastOf(noMortgage);
    // 2028: $24,000 / 1.03² = $22,622.30 real
    expect(a.get(2028)!.withdrawals.total - b.get(2028)!.withdrawals.total)
      .toBeCloseTo(24_000 / 1.03 ** 2, 0);
    // 2029 (payoff age 53): still charged — $24,000 / 1.03³
    expect(a.get(2029)!.withdrawals.total - b.get(2029)!.withdrawals.total)
      .toBeCloseTo(24_000 / 1.03 ** 3, 0);
  });

  it('stops charging after mortgagePaidOffAge', () => {
    const a = coastOf(withMortgage); const b = coastOf(noMortgage);
    expect(a.get(2030)!.withdrawals.total - b.get(2030)!.withdrawals.total).toBeCloseTo(0, 6);
    expect(a.get(2031)!.withdrawals.total - b.get(2031)!.withdrawals.total).toBeCloseTo(0, 6);
  });
});

describe('IRMAA lookback is seeded from coast-year MAGI', () => {
  // Client 62 in 2026; coast 2027–2028 (ages 63–64) converting $300k/yr; retire 2029 at 65
  // (Medicare). The 2-year lookback for 2029 lands on 2027's $300k coast MAGI. Single filer
  // at $300k ≥ the $200k single floor → tier-4 surcharge for one person:
  // (407.40 + 79.80) × 12 = $5,846.40. Pre-fix, the lookback fell back to the (low)
  // current-year MAGI and priced no surcharge at all.
  const profile: ClientProfile = {
    client: {
      name: 'T', age: 62, birthYear: 1964, lifeExpectancy: 72,
      fullRetirementAge: 67, fraMonthlyBenefit: 0, socialSecurityClaimAge: 70,
    },
    spouse: null,
    filingStatus: 'single',
    stateOfResidence: 'TX',
    hasStateIncomeTax: false,
    currentYear: 2026,
    retirementYearDesired: 2029,
    cobraMonths: 0,
    annualGrowthRate: 0,
    spendingEngine: 'withdrawal_sequencing',
    coastPhases: [
      { startYear: 2027, endYear: 2028, location: 'us', annualIncome: 0, usSourceIncomePct: 1, annualConversion: 300_000 },
    ],
  };
  const accounts: Account[] = [
    { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 1_000_000 },
    { id: 'b', label: 'brokerage', owner: 'client', type: 'brokerage', currentBalance: 1_500_000, costBasis: 1_500_000 },
  ];
  const result = runSimulation(
    profile, deriveAssetTotals(accounts, 0), bareSpending(40_000), GUARDRAILS, 'retire_at_stated_date'
  );
  const byYear = new Map(result.yearlyProjections.map((p) => [p.year, p]));

  it('coast years carry the conversion MAGI', () => {
    expect(byYear.get(2027)!.magi).toBeGreaterThanOrEqual(300_000);
    expect(byYear.get(2028)!.magi).toBeGreaterThanOrEqual(300_000);
  });

  it('first retirement year prices IRMAA on the coast-year lookback MAGI', () => {
    expect(byYear.get(2029)!.irmaaSurcharge).toBeCloseTo((407.40 + 79.80) * 12, 0);
  });

  it('lookback rolls off once post-coast MAGI enters the window', () => {
    // 2031 looks back to 2029 (low retirement-year MAGI) → no surcharge.
    expect(byYear.get(2031)!.irmaaSurcharge).toBe(0);
  });
});

describe('one-time flows inside coast windows attach a warning to the result', () => {
  const profile: ClientProfile = {
    client: {
      name: 'T', age: 50, birthYear: 1976, lifeExpectancy: 70,
      fullRetirementAge: 67, fraMonthlyBenefit: 0, socialSecurityClaimAge: 70,
    },
    spouse: null,
    filingStatus: 'married_filing_jointly',
    stateOfResidence: 'TX',
    hasStateIncomeTax: false,
    currentYear: 2026,
    retirementYearDesired: 2032,
    cobraMonths: 0,
    annualGrowthRate: 0,
    spendingEngine: 'withdrawal_sequencing',
    coastPhases: [
      { startYear: 2028, endYear: 2031, location: 'us', annualIncome: 60_000, usSourceIncomePct: 1, annualConversion: 0 },
    ],
  };
  const accounts: Account[] = [
    { id: 'b', label: 'brokerage', owner: 'client', type: 'brokerage', currentBalance: 2_000_000, costBasis: 2_000_000 },
  ];
  const spending: SpendingProfile = {
    ...bareSpending(50_000),
    oneTimeIncomes: [{ year: 2030, label: 'house sale', amount: 340_000 }],
  };
  const result = runSimulation(
    profile, deriveAssetTotals(accounts, 0), spending, GUARDRAILS, 'retire_at_stated_date'
  );

  it('surfaces the dropped flow', () => {
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w) => w.includes('house sale') && w.includes('IGNORED'))).toBe(true);
  });
});
