/**
 * ssBenefitHaircutPct — political-risk / PIA-overstatement haircut applied to every
 * household SS benefit: the projection loop, the capacity heuristic, and the
 * claiming-age comparison (where it scales PIA, leaving break-even ages unchanged).
 */
import { describe, it, expect } from 'vitest';
import { runSimulation } from '../../src/domain/engine/simulation-runner';
import { buildSocialSecurityComparison } from '../../src/domain/engine/social-security';
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

describe('ssBenefitHaircutPct in the projection loop', () => {
  // Claim at 62 with FRA 67 and $2,500 FRA benefit → 70% × 2,500 × 12 = $21,000/yr.
  // A 20% haircut pays $16,800/yr.
  const base: ClientProfile = {
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

  const assets = deriveAssetTotals(accounts, 0);
  const plain = runSimulation(base, assets, spending, GUARDRAILS, 'retire_at_stated_date');
  const cut = runSimulation(
    { ...base, ssBenefitHaircutPct: 0.2 }, assets, spending, GUARDRAILS, 'retire_at_stated_date'
  );

  it('pays the full benefit at haircut 0 (default)', () => {
    expect(plain.yearlyProjections[0].income.socialSecurityClient).toBeCloseTo(21_000, 0);
  });

  it('pays (1 − haircut) × benefit with a 20% haircut', () => {
    expect(cut.yearlyProjections[0].income.socialSecurityClient).toBeCloseTo(16_800, 0);
  });
});

describe('ssBenefitHaircutPct in the claiming comparison', () => {
  const plain = buildSocialSecurityComparison(2_500, 67, 90, null, null, null);
  const cut = buildSocialSecurityComparison(2_500, 67, 90, null, null, null, 0.2);

  it('scales every claim-age option by the factor', () => {
    for (let i = 0; i < plain.options.length; i++) {
      expect(cut.options[i].clientMonthlyBenefit).toBeCloseTo(
        plain.options[i].clientMonthlyBenefit * 0.8, 6
      );
    }
  });

  it('leaves break-even ages unchanged (PIA scaling is linear)', () => {
    for (let i = 0; i < plain.options.length; i++) {
      const a = plain.options[i].breakEvenAgeVsEarliest;
      const b = cut.options[i].breakEvenAgeVsEarliest;
      if (a == null) {
        expect(b).toBeNull();
      } else {
        expect(b).toBeCloseTo(a, 6);
      }
    }
  });
});
