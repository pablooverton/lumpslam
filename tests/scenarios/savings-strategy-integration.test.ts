import { describe, it, expect } from 'vitest';
import { runSimulation } from '../../src/domain/engine/simulation-runner';
import { deriveAssetTotals } from '../../src/domain/types/assets';
import type { ClientProfile } from '../../src/domain/types/profile';
import type { Account } from '../../src/domain/types/assets';
import type { SpendingProfile } from '../../src/domain/types/spending';
import type { GuardrailConfig } from '../../src/domain/types/scenarios';

// Canonical anonymized profile shared between the legacy path (annualContributions)
// and the new path (savingsStrategy), to verify both produce comparable end-state
// balances when the strategy is tuned to emit the same contributions.

const baseProfile: ClientProfile = {
  client: {
    name: 'Alice', age: 40, birthYear: 1986,
    lifeExpectancy: 90, fullRetirementAge: 67,
    fraMonthlyBenefit: 2800, socialSecurityClaimAge: 62,
  },
  spouse: {
    name: 'Bob', age: 40, birthYear: 1986,
    lifeExpectancy: 90, fullRetirementAge: 67,
    fraMonthlyBenefit: 2600, socialSecurityClaimAge: 62,
  },
  filingStatus: 'married_filing_jointly',
  stateOfResidence: 'NC',
  hasStateIncomeTax: true,
  currentYear: 2026,
  retirementYearDesired: 2041,
  cobraMonths: 0,
  acaHouseholdSize: 4,
  annualGrowthRate: 0.06,
  retirementLocation: 'us',
  targetBracket: '22%',
};

const accounts: Account[] = [
  { id: '1', label: 'Pretax', owner: 'client', type: 'pretax_ira', currentBalance: 800_000 },
  { id: '2', label: 'Roth',   owner: 'client', type: 'roth_ira',   currentBalance: 150_000 },
  { id: '3', label: 'HSA',    owner: 'client', type: 'hsa',        currentBalance: 30_000 },
  { id: '4', label: 'Brk',    owner: 'joint',  type: 'brokerage',  currentBalance: 1_000, costBasis: 1_000 },
];

const spending: SpendingProfile = {
  baseAnnualSpending: 121_200,
  travelBudgetEarly: 8_000,
  travelBudgetLate: 4_000,
  travelTaperStartAge: 75,
  charitableGivingAnnual: 0,
  oneTimeExpenses: [],
  inflationRate: 0.03,
  mortgageAnnualPayment: 48_800,
  mortgagePaidOffAge: 69,
  annualHealthcareCost: 15_000,
};

const guardrails: GuardrailConfig = {
  upperGuardrailGrowthPct: 0.20,
  lowerGuardrailDropPct: 0.29,
  lowerGuardrailSpendingCutPct: 0.03,
};

describe('SavingsStrategy integration — lifetime aggregates', () => {
  it('legacy annualContributions path still works and produces lifetime aggregates', () => {
    const profile: ClientProfile = {
      ...baseProfile,
      annualContributions: { pretax: 5_000, roth: 44_000, brokerage: 0, hsa: 8_300 },
    };
    const assets = deriveAssetTotals(accounts, 122_000);
    const result = runSimulation(profile, assets, spending, guardrails, 'retire_at_stated_date');
    expect(result.lifetime).toBeDefined();
    expect(result.lifetime.totalTaxPaid).toBeGreaterThan(0);
    expect(result.lifetime.terminal.total).toBeGreaterThan(0);
    expect(result.lifetime.strategyTotals).toBeNull();
  });

  it('savingsStrategy path produces strategyTotals and populates lifetime', () => {
    const profile: ClientProfile = {
      ...baseProfile,
      savingsStrategy: {
        name: 'ldr-baseline',
        annualFreeCashFlow: 57_000,
        marginalTaxRateFedState: 0.2925,
        rules: [
          { kind: 'employer_match', limit: 5_000 },
          { kind: 'hsa', limit: 8_300 },
          { kind: 'backdoor_roth', limit: 14_000 },
          { kind: 'roth_401k', limit: 30_000 },
          { kind: 'brokerage' },
        ],
      },
    };
    const assets = deriveAssetTotals(accounts, 122_000);
    const result = runSimulation(profile, assets, spending, guardrails, 'retire_at_stated_date');
    expect(result.lifetime.strategyTotals).not.toBeNull();
    expect(result.lifetime.strategyTotals!.totalRothContributions).toBeGreaterThan(0);
    expect(result.lifetime.strategyTotals!.totalEmployerMatch).toBeGreaterThan(0);
    expect(result.lifetime.totalTaxPaid).toBeGreaterThan(0);
    expect(result.lifetime.terminal.total).toBeGreaterThan(0);
  });

  it('working-year conversions move dollars pre-tax → Roth and track tax', () => {
    const profile: ClientProfile = {
      ...baseProfile,
      savingsStrategy: {
        name: 'early-convert',
        annualFreeCashFlow: 60_000,
        marginalTaxRateFedState: 0.2925,
        rules: [
          { kind: 'employer_match', limit: 5_000 },
          { kind: 'hsa', limit: 8_300 },
          { kind: 'backdoor_roth', limit: 14_000 },
          { kind: 'roth_401k', limit: 30_000 },
          { kind: 'working_year_conversion', limit: 25_000, activateYear: 2028 },
          { kind: 'brokerage' },
        ],
      },
    };
    const assets = deriveAssetTotals(accounts, 122_000);
    const result = runSimulation(profile, assets, spending, guardrails, 'retire_at_stated_date');
    expect(result.lifetime.workingYearConversionTaxPaid).toBeGreaterThan(0);
    expect(result.lifetime.strategyTotals!.totalWorkingYearConversions).toBeGreaterThan(0);
  });

  it('two strategies with same free cash flow produce different terminal splits', () => {
    // All-Roth vs. all-pre-tax should produce meaningfully different bucket mixes.
    const strategyRoth: ClientProfile = {
      ...baseProfile,
      savingsStrategy: {
        name: 'all-roth',
        annualFreeCashFlow: 40_000,
        marginalTaxRateFedState: 0.2925,
        rules: [{ kind: 'roth_401k', limit: 1_000_000 }],
      },
    };
    const strategyPretax: ClientProfile = {
      ...baseProfile,
      savingsStrategy: {
        name: 'all-pretax',
        annualFreeCashFlow: 40_000,
        marginalTaxRateFedState: 0.2925,
        rules: [{ kind: 'pretax_401k', limit: 1_000_000 }],
      },
    };
    const assets = deriveAssetTotals(accounts, 122_000);
    const rothRun = runSimulation(strategyRoth,   assets, spending, guardrails, 'retire_at_stated_date');
    const preRun  = runSimulation(strategyPretax, assets, spending, guardrails, 'retire_at_stated_date');

    // Grossed-up pre-tax contributions are larger in nominal dollars than equivalent post-tax Roth.
    // Check that the pre-tax bucket in the pretax strategy received more $ than the pre-tax in the
    // Roth strategy.
    expect(preRun.lifetime.strategyTotals!.totalPretaxContributions)
      .toBeGreaterThan(rothRun.lifetime.strategyTotals!.totalPretaxContributions);
    expect(rothRun.lifetime.strategyTotals!.totalRothContributions)
      .toBeGreaterThan(preRun.lifetime.strategyTotals!.totalRothContributions);
  });
});
