/**
 * NIIT (3.8% on investment income above the $250k/$200k MAGI threshold) and the
 * sequencing-branch taxable one-time income fix (previously escaped MAGI/tax entirely).
 */
import { describe, it, expect } from 'vitest';
import { runSimulation } from '../../src/domain/engine/simulation-runner';
import { calculateNiit } from '../../src/domain/engine/tax-utils';
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

describe('calculateNiit', () => {
  it('zero below the MAGI threshold', () => {
    expect(calculateNiit(100_000, 240_000, 'married_filing_jointly')).toBe(0);
  });
  it('capped by MAGI excess over the threshold', () => {
    expect(calculateNiit(320_000, 320_000, 'married_filing_jointly')).toBeCloseTo(0.038 * 70_000, 6);
  });
  it('capped by investment income when MAGI excess is larger', () => {
    expect(calculateNiit(20_000, 400_000, 'married_filing_jointly')).toBeCloseTo(0.038 * 20_000, 6);
  });
  it('single threshold is $200k', () => {
    expect(calculateNiit(50_000, 220_000, 'single')).toBeCloseTo(0.038 * 20_000, 6);
  });
});

function baseProfile(): ClientProfile {
  return {
    client: {
      name: 'T', age: 66, birthYear: 1960, lifeExpectancy: 66,
      fullRetirementAge: 67, fraMonthlyBenefit: 0, socialSecurityClaimAge: 70,
    },
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
}

function bareSpending(base: number, overrides: Partial<SpendingProfile> = {}): SpendingProfile {
  return {
    baseAnnualSpending: base,
    travelBudgetEarly: 0, travelBudgetLate: 0, travelTaperStartAge: 120,
    charitableGivingAnnual: 0, oneTimeExpenses: [], inflationRate: 0.03,
    ...overrides,
  };
}

describe('NIIT — big-gains sequencing year pays 3.8% above the threshold and conserves', () => {
  const accounts: Account[] = [
    { id: 'b', label: 'brok', owner: 'client', type: 'brokerage', currentBalance: 5_000_000, costBasis: 1_000_000 },
  ];
  const spending = bareSpending(400_000);
  const result = runSimulation(baseProfile(), deriveAssetTotals(accounts, 0), spending, GUARDRAILS, 'retire_at_stated_date');
  const y = result.yearlyProjections[0];

  it('NIIT = 3.8% × (MAGI − 250k), capped by gains', () => {
    // $400k draw at 80% gain ratio → $320k gains = MAGI → excess $70k → $2,660.
    expect(y.capitalGainsRealized).toBeCloseTo(320_000, 0);
    expect(y.taxLiability.niit).toBeCloseTo(2_660, 0);
  });

  it('NIIT is funded — the year conserves to the dollar', () => {
    const drop = y.portfolioStartBalance - y.portfolioEndBalance;
    const expected =
      400_000 + y.taxLiability.totalFederalTax + y.taxLiability.stateTax
      + (y.taxLiability.earlyWithdrawalPenalty ?? 0);
    expect(Math.abs(drop - expected)).toBeLessThan(1);
  });
});

describe('taxable one-time income — sequencing branch taxes it (was: escaped entirely)', () => {
  const accounts: Account[] = [
    { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 2_000_000 },
  ];
  const spending = bareSpending(100_000, {
    oneTimeIncomes: [{ year: 2026, label: 'deferred comp', amount: 150_000, taxable: true }],
  });
  const result = runSimulation(baseProfile(), deriveAssetTotals(accounts, 0), spending, GUARDRAILS, 'retire_at_stated_date');
  const y = result.yearlyProjections[0];

  it('the injection enters MAGI', () => {
    // The injection banks to brokerage (not spendable income for the gap), so the year still
    // draws ~$100k from pretax: MAGI = 100k draw + 150k taxable injection = 250k.
    expect(y.magi).toBeCloseTo(250_000, 0);
  });

  it('tax on it is levied and funded (drop reflects taxes net of the injection)', () => {
    expect(y.taxLiability.totalFederalTax).toBeGreaterThan(10_000);
    // One-time income lands in brokerage before the start snapshot; spending and taxes
    // then drain the portfolio: drop = spending + taxes − (income.total = 0 SS).
    const drop = y.portfolioStartBalance - y.portfolioEndBalance;
    const expected = 100_000 + y.taxLiability.totalFederalTax + y.taxLiability.stateTax;
    expect(Math.abs(drop - expected)).toBeLessThan(1);
  });
});
