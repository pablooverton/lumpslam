/**
 * ACA MAGI counts 100% of Social Security — the non-taxable portion is added back.
 * Tax MAGI (and the IRMAA lookback) keep the 85% income-tax inclusion. Bites ACA years
 * with early-claimed SS (62–64).
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

describe('ACA MAGI — early-claimed SS counts at 100% in the cliff planner', () => {
  // SS at 62 with FRA 67 and $2,500 FRA benefit → 70% × 2,500 × 12 = $21,000/yr.
  // ACA cliff (household 2) = $84,600. The planner must reserve room for the FULL $21k,
  // not the 85% taxable slice — pretax capacity = 84,600 − 21,000 − 1 = $63,599.
  const profile: ClientProfile = {
    client: {
      name: 'T', age: 62, birthYear: 1964, lifeExpectancy: 64,
      fullRetirementAge: 67, fraMonthlyBenefit: 2_500, socialSecurityClaimAge: 62,
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
  const accounts: Account[] = [
    { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 2_000_000 },
  ];
  const spending: SpendingProfile = {
    baseAnnualSpending: 120_000,
    travelBudgetEarly: 0, travelBudgetLate: 0, travelTaperStartAge: 120,
    charitableGivingAnnual: 0, oneTimeExpenses: [], inflationRate: 0.03,
  };
  const result = runSimulation(profile, deriveAssetTotals(accounts, 0), spending, GUARDRAILS, 'retire_at_stated_date');
  const y = result.yearlyProjections[0];

  it('is an ACA year with SS flowing', () => {
    expect(y.season).toBe('aca');
    expect(y.income.socialSecurityClient).toBeCloseTo(21_000, 0);
  });

  it('pretax draw is capped against 100% of SS (was: only the 85% taxable slice)', () => {
    expect(y.withdrawals.fromPretax).toBeCloseTo(63_599, 0);
  });

  it('reported tax MAGI keeps the 85% inclusion; ACA MAGI lands exactly under the cliff', () => {
    expect(y.magi).toBeCloseTo(63_599 + 21_000 * 0.85, 0); // 81,449
    // ACA assessment adds the 15% back: 81,449 + 3,150 = 84,599 < 84,600 → still eligible.
    expect(y.acaSubsidyEligible).toBe(true);
  });
});
