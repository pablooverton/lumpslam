/**
 * State model v2 — progressive bracket steps for the big progressive states (coarse,
 * planning-grade), flat top-marginal fallback elsewhere, and the sequencing-branch fix
 * that includes conversions in the state base.
 */
import { describe, it, expect } from 'vitest';
import { calculateStateTax, getStateInfo } from '../../src/domain/constants/states';
import { runSimulation } from '../../src/domain/engine/simulation-runner';
import { deriveAssetTotals } from '../../src/domain/types/assets';
import type { Account } from '../../src/domain/types/assets';
import type { ClientProfile } from '../../src/domain/types/profile';
import type { SpendingProfile } from '../../src/domain/types/spending';

describe('calculateStateTax', () => {
  it('flat states use topMarginalRate on the full base (NC stays deliberately 4.5%)', () => {
    expect(calculateStateTax(getStateInfo('NC'), 100_000, 'married_filing_jointly')).toBeCloseTo(4_500, 6);
  });

  it('no-income-tax states are 0', () => {
    expect(calculateStateTax(getStateInfo('TX'), 100_000, 'married_filing_jointly')).toBe(0);
  });

  it('CA uses progressive steps — not 13.3% on every dollar', () => {
    // Coarse table: 3% × 100k + 8% × 40k + 9.3% × 60k = $11,780 effective ≈ 5.9%,
    // vs $26,600 under the old flat-13.3% model.
    const tax = calculateStateTax(getStateInfo('CA'), 200_000, 'married_filing_jointly');
    expect(tax).toBeCloseTo(11_780, 0);
    expect(tax).toBeLessThan(200_000 * 0.133 * 0.5);
  });

  it('NY mid-income lands near its statutory effective rate', () => {
    // 5.25% × 160k + 6% × 40k = $10,800 on $200k MFJ (≈5.4% effective).
    expect(calculateStateTax(getStateInfo('NY'), 200_000, 'married_filing_jointly')).toBeCloseTo(10_800, 0);
  });
});

describe('sequencing branch — conversions are state-taxed (2026-06-11 fix)', () => {
  const profile: ClientProfile = {
    client: {
      name: 'T', age: 66, birthYear: 1960, lifeExpectancy: 66,
      fullRetirementAge: 67, fraMonthlyBenefit: 0, socialSecurityClaimAge: 70,
    },
    spouse: null,
    filingStatus: 'married_filing_jointly',
    stateOfResidence: 'NC',
    hasStateIncomeTax: true,
    currentYear: 2026,
    retirementYearDesired: 2026,
    cobraMonths: 0,
    annualGrowthRate: 0,
    spendingEngine: 'withdrawal_sequencing',
  };
  const accounts: Account[] = [
    { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 2_000_000 },
    { id: 'b', label: 'brok', owner: 'client', type: 'brokerage', currentBalance: 500_000, costBasis: 500_000 },
  ];
  const spending: SpendingProfile = {
    baseAnnualSpending: 80_000,
    travelBudgetEarly: 0, travelBudgetLate: 0, travelTaperStartAge: 120,
    charitableGivingAnnual: 0, oneTimeExpenses: [], inflationRate: 0.03,
  };
  const result = runSimulation(profile, deriveAssetTotals(accounts, 0), spending, {
    upperGuardrailGrowthPct: 0.2, lowerGuardrailDropPct: 0.99, lowerGuardrailSpendingCutPct: 0,
  }, 'retire_at_stated_date');
  const y = result.yearlyProjections[0];

  it('a conversion fires and NC tax covers the full MAGI including the conversion', () => {
    expect(y.rothConversion?.conversionAmount ?? 0).toBeGreaterThan(0);
    // No SS, basis-only brokerage (no gains): state base = full reported MAGI.
    expect(y.taxLiability.stateTax).toBeCloseTo(0.045 * y.magi, 0);
  });

  it('the state tax on the conversion is funded — the year conserves (growth=0)', () => {
    const drop = y.portfolioStartBalance - y.portfolioEndBalance;
    const expected =
      spending.baseAnnualSpending + y.taxLiability.totalFederalTax + y.taxLiability.stateTax
      + (y.taxLiability.earlyWithdrawalPenalty ?? 0);
    expect(Math.abs(drop - expected)).toBeLessThan(1);
  });
});
