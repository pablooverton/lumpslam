import { describe, it, expect } from 'vitest';
import {
  resolveSavingsStrategy,
  aggregateStrategyTotals,
} from '../../src/domain/engine/savings-strategy';
import type { SavingsStrategy } from '../../src/domain/types/profile';

const combinedRate = 0.2925; // 24% federal + 5.25% NC

describe('resolveSavingsStrategy', () => {
  it('routes to HSA first when HSA is first priority', () => {
    const strategy: SavingsStrategy = {
      name: 'test-hsa-first',
      annualFreeCashFlow: 20_000,
      marginalTaxRateFedState: combinedRate,
      rules: [
        { kind: 'hsa', limit: 8_300 },
        { kind: 'brokerage' },
      ],
    };
    const [first] = resolveSavingsStrategy(strategy, 2026, 1);
    expect(first.hsaContribution).toBe(8_300);
    expect(first.brokerageContribution).toBe(20_000 - 8_300);
    expect(first.freeCashFlowRemaining).toBe(0);
  });

  it('pre-tax 401k is grossed up from post-tax cash', () => {
    const strategy: SavingsStrategy = {
      name: 'test-pretax-grossup',
      annualFreeCashFlow: 10_000,
      marginalTaxRateFedState: combinedRate,
      rules: [{ kind: 'pretax_401k', limit: 100_000 }],
    };
    const [first] = resolveSavingsStrategy(strategy, 2026, 1);
    // $10,000 post-tax / (1 − 0.2925) = $14,134.28 gross contribution
    expect(first.pretaxContribution).toBeCloseTo(10_000 / (1 - combinedRate), 0);
    // All free cash flow consumed
    expect(first.freeCashFlowRemaining).toBe(0);
  });

  it('Roth 401k consumes free cash flow 1:1', () => {
    const strategy: SavingsStrategy = {
      name: 'test-roth',
      annualFreeCashFlow: 14_000,
      marginalTaxRateFedState: combinedRate,
      rules: [{ kind: 'roth_401k', limit: 23_500 }],
    };
    const [first] = resolveSavingsStrategy(strategy, 2026, 1);
    expect(first.rothContribution).toBe(14_000);
    expect(first.freeCashFlowRemaining).toBe(0);
  });

  it('working-year conversion consumes cash at the marginal tax rate', () => {
    const strategy: SavingsStrategy = {
      name: 'test-conversion',
      annualFreeCashFlow: 5_850, // enough to pay tax on $20k conversion at 29.25%
      marginalTaxRateFedState: combinedRate,
      rules: [{ kind: 'working_year_conversion', limit: 20_000 }],
    };
    const [first] = resolveSavingsStrategy(strategy, 2026, 1);
    expect(first.workingYearConversion).toBeCloseTo(20_000, 0);
    expect(first.workingYearConversionTax).toBeCloseTo(5_850, 0);
    expect(first.freeCashFlowRemaining).toBeCloseTo(0, 0);
  });

  it('working-year conversion caps at available cash when limit is generous', () => {
    const strategy: SavingsStrategy = {
      name: 'test-conversion-cash-capped',
      annualFreeCashFlow: 5_850,
      marginalTaxRateFedState: combinedRate,
      rules: [{ kind: 'working_year_conversion', limit: 1_000_000 }],
    };
    const [first] = resolveSavingsStrategy(strategy, 2026, 1);
    // Max conversion = $5,850 / 0.2925 = $20,000 before tax exhausts cash
    expect(first.workingYearConversion).toBeCloseTo(20_000, 0);
  });

  it('activateYear defers a rule until a later year', () => {
    const strategy: SavingsStrategy = {
      name: 'test-activate',
      annualFreeCashFlow: 10_000,
      marginalTaxRateFedState: combinedRate,
      rules: [{ kind: 'mega_backdoor', limit: 15_000, activateYear: 2028 }],
    };
    const years = resolveSavingsStrategy(strategy, 2026, 3);
    expect(years[0].rothContribution).toBe(0); // 2026: not active
    expect(years[1].rothContribution).toBe(0); // 2027: not active
    expect(years[2].rothContribution).toBe(10_000); // 2028: active
  });

  it('priority order flows from first to last rule', () => {
    // LDR canonical ordering: match → HSA → backdoor → Roth 401k → mega → brokerage
    const strategy: SavingsStrategy = {
      name: 'ldr-baseline',
      annualFreeCashFlow: 60_000,
      marginalTaxRateFedState: combinedRate,
      rules: [
        { kind: 'employer_match', limit: 5_000 },
        { kind: 'hsa', limit: 8_300 },
        { kind: 'backdoor_roth', limit: 14_000 },
        { kind: 'roth_401k', limit: 30_000 }, // less than $47k combined elective limit to fit in $60k
        { kind: 'brokerage' },
      ],
    };
    const [first] = resolveSavingsStrategy(strategy, 2026, 1);
    expect(first.employerMatch).toBe(5_000);
    expect(first.hsaContribution).toBe(8_300);
    expect(first.rothContribution).toBe(14_000 + 30_000);
    expect(first.brokerageContribution).toBe(60_000 - 8_300 - 14_000 - 30_000);
  });

  it('freeCashFlowGrowth applies real growth year-over-year', () => {
    const strategy: SavingsStrategy = {
      name: 'test-growth',
      annualFreeCashFlow: 50_000,
      freeCashFlowGrowth: 0.03,
      marginalTaxRateFedState: combinedRate,
      rules: [{ kind: 'brokerage' }],
    };
    const years = resolveSavingsStrategy(strategy, 2026, 3);
    expect(years[0].freeCashFlowAvailable).toBeCloseTo(50_000, 0);
    expect(years[1].freeCashFlowAvailable).toBeCloseTo(50_000 * 1.03, 0);
    expect(years[2].freeCashFlowAvailable).toBeCloseTo(50_000 * 1.03 * 1.03, 0);
  });

  it('unallocated cash lands in freeCashFlowRemaining (no implicit brokerage)', () => {
    const strategy: SavingsStrategy = {
      name: 'test-unallocated',
      annualFreeCashFlow: 30_000,
      marginalTaxRateFedState: combinedRate,
      rules: [{ kind: 'roth_401k', limit: 10_000 }],
    };
    const [first] = resolveSavingsStrategy(strategy, 2026, 1);
    expect(first.rothContribution).toBe(10_000);
    expect(first.freeCashFlowRemaining).toBe(20_000);
  });
});

describe('aggregateStrategyTotals', () => {
  it('sums contributions across years', () => {
    const strategy: SavingsStrategy = {
      name: 'test-totals',
      annualFreeCashFlow: 20_000,
      marginalTaxRateFedState: combinedRate,
      rules: [{ kind: 'roth_401k', limit: 20_000 }],
    };
    const allocations = resolveSavingsStrategy(strategy, 2026, 5);
    const totals = aggregateStrategyTotals(allocations);
    expect(totals.totalRothContributions).toBe(100_000);
    expect(totals.totalFreeCashFlowConsumed).toBe(100_000);
  });
});
