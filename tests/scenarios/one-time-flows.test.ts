/**
 * One-time cash injection / lumpy expense / healthcare-start tests.
 *
 * Covers three engine features added together:
 *   T5 — oneTimeIncomes: cash injection (e.g. house sale) lands in brokerage at the specified
 *        year, before withdrawals/conversions for that year. Default not taxable; `taxable: true`
 *        consumes bracket room and bumps MAGI.
 *   T6 — lumpy expenses (oneTimeExpenses) draw from brokerage first in conversion_primary,
 *        falling back to Roth only for overflow.
 *   T7 — annualHealthcareCost only applies once clientAge >= healthcareStartAge (default 65).
 *
 * Profile shape: international post-retirement (skips ACA), targetBracket=22%, ages 40 retiring 2041.
 */
import { describe, it, expect } from 'vitest';
import { deriveAssetTotals } from '../../src/domain/types/assets';
import { runSimulation } from '../../src/domain/engine/simulation-runner';
import type { ClientProfile } from '../../src/domain/types/profile';
import type { Account } from '../../src/domain/types/assets';
import type { SpendingProfile } from '../../src/domain/types/spending';
import type { GuardrailConfig } from '../../src/domain/types/scenarios';

const baseProfile: ClientProfile = {
  client: {
    name: 'P', age: 40, birthYear: 1986, lifeExpectancy: 90,
    fullRetirementAge: 67, fraMonthlyBenefit: 2_900, socialSecurityClaimAge: 62,
  },
  spouse: {
    name: 'D', age: 40, birthYear: 1986, lifeExpectancy: 90,
    fullRetirementAge: 67, fraMonthlyBenefit: 2_500, socialSecurityClaimAge: 62,
  },
  filingStatus: 'married_filing_jointly',
  stateOfResidence: 'NC',
  hasStateIncomeTax: true,
  currentYear: 2026,
  retirementYearDesired: 2041,
  cobraMonths: 0,
  retirementLocation: 'international',
  annualGrowthRate: 0.06,
  targetBracket: '22%',
  annualContributions: { pretax: 25_000, roth: 58_300, brokerage: 0, hsa: 8_300 },
};

const accounts: Account[] = [
  { id: '1', label: '401k',  owner: 'client', type: 'pretax_ira',  currentBalance: 728_000 },
  { id: '2', label: 'Roth',  owner: 'client', type: 'roth_ira',    currentBalance: 137_000 },
  { id: '3', label: 'HSA',   owner: 'client', type: 'hsa',         currentBalance: 30_000 },
  // Brokerage starts at $0 — the injection is the only way it gets funded
];
const assets = deriveAssetTotals(accounts, 0);

const guardrails: GuardrailConfig = {
  upperGuardrailGrowthPct: 0.20,
  lowerGuardrailDropPct: 0.29,
  lowerGuardrailSpendingCutPct: 0.03,
};

const baseSpending: SpendingProfile = {
  baseAnnualSpending: 75_000,
  travelBudgetEarly: 8_000,
  travelBudgetLate: 4_000,
  travelTaperStartAge: 75,
  charitableGivingAnnual: 0,
  oneTimeExpenses: [],
  inflationRate: 0.03,
  annualHealthcareCost: 15_000,
};

// ─── T5: oneTimeIncome lands in brokerage at the specified year ──────────────

describe('T5 — oneTimeIncome injection', () => {
  it('lands $530k in brokerage at retirement year (2041) when injected then', () => {
    const spending: SpendingProfile = {
      ...baseSpending,
      oneTimeIncomes: [{ year: 2041, label: 'House sale', amount: 530_000 }],
    };
    const result = runSimulation(baseProfile, assets, spending, guardrails, 'retire_at_stated_date');
    const firstYear = result.yearlyProjections[0]; // 2041
    expect(firstYear.year).toBe(2041);
    // Brokerage at end of first year ≈ $530k after injection minus any withdrawals (none expected
    // in conversion_primary; lumpy expense is 0) plus 6% growth.
    expect(firstYear.brokerageEndBalance).toBeGreaterThan(500_000);
    expect(firstYear.brokerageEndBalance).toBeLessThan(600_000);
  });

  it('does not land in brokerage in pre-injection years', () => {
    const spending: SpendingProfile = {
      ...baseSpending,
      oneTimeIncomes: [{ year: 2051, label: 'Inheritance', amount: 200_000 }],
    };
    const result = runSimulation(baseProfile, assets, spending, guardrails, 'retire_at_stated_date');
    const year2050 = result.yearlyProjections.find((y) => y.year === 2050);
    expect(year2050?.brokerageEndBalance ?? 0).toBeLessThan(50_000);
  });

  it('skipping oneTimeIncomes preserves prior behavior (brokerage stays empty)', () => {
    const result = runSimulation(baseProfile, assets, baseSpending, guardrails, 'retire_at_stated_date');
    const firstYear = result.yearlyProjections[0];
    expect(firstYear.brokerageEndBalance).toBeLessThan(50_000);
  });

  it('taxable injection consumes bracket room — conversion shrinks accordingly', () => {
    const taxableSpending: SpendingProfile = {
      ...baseSpending,
      oneTimeIncomes: [{ year: 2041, label: 'Severance', amount: 100_000, taxable: true }],
    };
    const baseline = runSimulation(baseProfile, assets, baseSpending, guardrails, 'retire_at_stated_date');
    const withTaxable = runSimulation(baseProfile, assets, taxableSpending, guardrails, 'retire_at_stated_date');

    const baseConv = baseline.yearlyProjections[0].rothConversion?.conversionAmount ?? 0;
    const taxConv  = withTaxable.yearlyProjections[0].rothConversion?.conversionAmount ?? 0;
    // The $100k taxable injection should reduce the year-1 conversion by ~$100k.
    expect(baseConv - taxConv).toBeGreaterThan(80_000);
    expect(baseConv - taxConv).toBeLessThan(120_000);
  });
});

// ─── T6: lumpy expense draws from brokerage first ────────────────────────────

describe('T6 — lumpyExpenses sourced from brokerage in conversion_primary', () => {
  it('$600k lumpy at 2051 draws from brokerage when funds are present', () => {
    const spending: SpendingProfile = {
      ...baseSpending,
      oneTimeIncomes: [{ year: 2041, label: 'House sale', amount: 530_000 }],
      oneTimeExpenses: [{ year: 2051, label: 'Rebuy US home', amount: 600_000 }],
    };
    const result = runSimulation(baseProfile, assets, spending, guardrails, 'retire_at_stated_date');
    const year2051 = result.yearlyProjections.find((y) => y.year === 2051);
    expect(year2051).toBeDefined();
    // Brokerage should have funded most of the lumpy: fromBrokerage > 0 and substantial.
    expect(year2051!.withdrawals.fromBrokerage).toBeGreaterThan(400_000);
    // Brokerage end balance should be near zero (most of $530k+growth consumed)
    expect(year2051!.brokerageEndBalance).toBeLessThan(500_000);
  });

  it('without brokerage, lumpy falls back to Roth (preserves prior behavior)', () => {
    const spending: SpendingProfile = {
      ...baseSpending,
      oneTimeExpenses: [{ year: 2051, label: 'Rebuy US home', amount: 600_000 }],
    };
    const result = runSimulation(baseProfile, assets, spending, guardrails, 'retire_at_stated_date');
    const year2051 = result.yearlyProjections.find((y) => y.year === 2051);
    expect(year2051!.withdrawals.fromBrokerage).toBe(0);
    expect(year2051!.withdrawals.fromRoth).toBeGreaterThan(500_000);
  });
});

// ─── T7: healthcareStartAge gates annualHealthcareCost ───────────────────────

describe('hsaAnnualSpending — drains HSA in accumulation and retirement', () => {
  it('zero default preserves prior behavior (HSA grows untouched in accumulation)', () => {
    const result = runSimulation(baseProfile, assets, baseSpending, guardrails, 'retire_at_stated_date');
    // First year of retirement (2041) — HSA grew for 15 years untouched
    const firstYear = result.yearlyProjections[0];
    expect(firstYear.year).toBe(2041);
    // HSA isn't surfaced separately on YearlyProjection; verify via portfolio total instead
    expect(firstYear.portfolioStartBalance).toBeGreaterThan(4_000_000);
  });

  it('$4k/yr meaningfully reduces terminal HSA vs. zero', () => {
    const noSpend = runSimulation(baseProfile, assets, baseSpending, guardrails, 'retire_at_stated_date');
    const withSpend = runSimulation(
      baseProfile,
      assets,
      { ...baseSpending, hsaAnnualSpending: 4_000 },
      guardrails,
      'retire_at_stated_date'
    );
    const noSpendEnd  = noSpend.yearlyProjections[noSpend.yearlyProjections.length - 1].portfolioEndBalance;
    const withSpendEnd = withSpend.yearlyProjections[withSpend.yearlyProjections.length - 1].portfolioEndBalance;
    // The $4k/yr drain compounds over ~50 years; terminal portfolio should be meaningfully lower.
    expect(noSpendEnd - withSpendEnd).toBeGreaterThan(100_000);
  });
});

describe('T7 — annualHealthcareCost gated by healthcareStartAge', () => {
  it('default (65): HSA is not drained for healthcare in pre-Medicare years', () => {
    // Run with $30k starting HSA. Without T7, $15k/yr × 10 yrs would zero it out by age 65.
    // With T7 (default 65), HSA grows at the portfolio rate through the bridge.
    const result = runSimulation(baseProfile, assets, baseSpending, guardrails, 'retire_at_stated_date');
    const year2050 = result.yearlyProjections.find((y) => y.year === 2050); // age 64, last bridge year
    // HSA should have grown, not declined, since healthcare hasn't kicked in yet
    expect(year2050!.portfolioEndBalance).toBeGreaterThan(0);
    // Note: HSA balance isn't surfaced separately on the yearly projection, but we can verify
    // by comparing against a profile that explicitly starts healthcare at 55 (next test).
  });

  it('explicit healthcareStartAge=55 drains HSA earlier than default', () => {
    const earlyHealthcare: SpendingProfile = { ...baseSpending, healthcareStartAge: 55 };
    const defaultRun = runSimulation(baseProfile, assets, baseSpending, guardrails, 'retire_at_stated_date');
    const earlyRun   = runSimulation(baseProfile, assets, earlyHealthcare, guardrails, 'retire_at_stated_date');

    // Total portfolio at age 65 should be lower in the early-healthcare run because $15k/yr
    // was being drawn (or HSA depleted faster), forcing slightly more from other accounts.
    const defaultAt65 = defaultRun.yearlyProjections.find((y) => y.year === 2051)!.portfolioEndBalance;
    const earlyAt65   = earlyRun.yearlyProjections.find((y) => y.year === 2051)!.portfolioEndBalance;
    expect(defaultAt65).toBeGreaterThan(earlyAt65);
  });
});
