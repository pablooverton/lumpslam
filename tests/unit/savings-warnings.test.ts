/**
 * getSavingsStrategyWarnings — leftover free cash flow that no rule absorbs is discarded;
 * the strategy should warn unless a catch-all rule exists to absorb it.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveSavingsStrategy,
  getSavingsStrategyWarnings,
} from '../../src/domain/engine/savings-strategy';
import { runSimulation } from '../../src/domain/engine/simulation-runner';
import { deriveAssetTotals } from '../../src/domain/types/assets';
import type { Account } from '../../src/domain/types/assets';
import type { ClientProfile, SavingsStrategy } from '../../src/domain/types/profile';
import type { SpendingProfile } from '../../src/domain/types/spending';
import type { GuardrailConfig } from '../../src/domain/types/scenarios';

function strategy(rules: SavingsStrategy['rules']): SavingsStrategy {
  return { name: 'T', annualFreeCashFlow: 100_000, marginalTaxRateFedState: 0.29, rules };
}

describe('getSavingsStrategyWarnings', () => {
  it('warns when leftover cash is discarded with no catch-all', () => {
    const s = strategy([{ kind: 'hsa', limit: 8_300 }]);
    const allocations = resolveSavingsStrategy(s, 2026, 3);
    const warnings = getSavingsStrategyWarnings(s, allocations);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('DISCARDED');
    expect(warnings[0]).toContain('3 years');
    // 3 × (100k − 8.3k) = $275,100 dropped
    expect(warnings[0]).toContain('275,100');
  });

  it('is silent when a no-limit brokerage catch-all absorbs the remainder', () => {
    const s = strategy([{ kind: 'hsa', limit: 8_300 }, { kind: 'brokerage' }]);
    const allocations = resolveSavingsStrategy(s, 2026, 3);
    expect(getSavingsStrategyWarnings(s, allocations)).toHaveLength(0);
  });

  it('is silent when rules consume the full cash flow anyway', () => {
    const s = strategy([{ kind: 'roth_401k', limit: 100_000 }]);
    const allocations = resolveSavingsStrategy(s, 2026, 2);
    expect(getSavingsStrategyWarnings(s, allocations)).toHaveLength(0);
  });
});

describe('runner attaches savings-strategy warnings to the result', () => {
  const profile: ClientProfile = {
    client: {
      name: 'T', age: 55, birthYear: 1971, lifeExpectancy: 70,
      fullRetirementAge: 67, fraMonthlyBenefit: 0, socialSecurityClaimAge: 70,
    },
    spouse: null,
    filingStatus: 'married_filing_jointly',
    stateOfResidence: 'TX',
    hasStateIncomeTax: false,
    currentYear: 2026,
    retirementYearDesired: 2029,
    cobraMonths: 0,
    annualGrowthRate: 0,
    spendingEngine: 'withdrawal_sequencing',
    savingsStrategy: strategy([{ kind: 'hsa', limit: 8_300 }]),
  };
  const accounts: Account[] = [
    { id: 'b', label: 'brokerage', owner: 'client', type: 'brokerage', currentBalance: 2_000_000, costBasis: 2_000_000 },
  ];
  const spending: SpendingProfile = {
    baseAnnualSpending: 60_000,
    travelBudgetEarly: 0, travelBudgetLate: 0, travelTaperStartAge: 120,
    charitableGivingAnnual: 0, oneTimeExpenses: [], inflationRate: 0.03,
  };
  const guardrails: GuardrailConfig = {
    upperGuardrailGrowthPct: 0.2, lowerGuardrailDropPct: 0.99, lowerGuardrailSpendingCutPct: 0,
  };

  it('surfaces the discarded-cash warning on ScenarioResult.warnings', () => {
    const result = runSimulation(profile, deriveAssetTotals(accounts, 0), spending, guardrails, 'retire_at_stated_date');
    expect(result.warnings?.some((w) => w.includes('DISCARDED'))).toBe(true);
  });
});
