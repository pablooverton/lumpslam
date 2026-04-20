/**
 * Savings strategy resolver.
 *
 * Takes a SavingsStrategy (free cash flow + priority-ordered allocation rules)
 * and produces a per-year resolution of contributions and working-year
 * conversions. The engine consumes this to drive the accumulation phase.
 *
 * Key behavior:
 *
 *   - Free cash flow is expressed in *post-tax* dollars (what actually shows up
 *     in the household's bank account after payroll tax and withholding).
 *   - Pre-tax 401k contributions are *grossed up* from post-tax cash: routing
 *     $1 of post-tax cash into a pre-tax 401k produces $1 / (1 − marginalRate)
 *     of contribution, because the pre-tax deferral reduces taxable wages and
 *     the tax saved is reinvested.
 *   - Post-tax buckets (Roth 401k, backdoor Roth, mega backdoor, HSA, brokerage)
 *     consume free cash flow 1:1.
 *   - Working-year conversions consume free cash flow at the marginal tax rate
 *     (outside-cash tax sourcing). The conversion itself moves pre-tax → Roth;
 *     the rule's limit caps the gross conversion amount.
 *   - Employer match is free money: 0 post-tax cost, added to pre-tax balance.
 *
 * This design makes "same free cash flow, different allocation" an
 * apples-to-apples comparison across strategies — which is the whole point.
 */

import type {
  SavingsStrategy,
  AllocationRule,
} from '../types/profile';

export interface ResolvedYearAllocation {
  /** Calendar year of this allocation. */
  year: number;
  /** Gross contribution to pre-tax 401k / traditional IRA (grossed up from post-tax cash). */
  pretaxContribution: number;
  /** Gross contribution to Roth (backdoor + Roth 401k + mega backdoor, combined). */
  rothContribution: number;
  /** Gross HSA contribution. */
  hsaContribution: number;
  /** Gross taxable brokerage contribution. */
  brokerageContribution: number;
  /** Gross pre-tax → Roth conversion during this working year. */
  workingYearConversion: number;
  /** Tax paid on this year's working-year conversion (from free cash flow). */
  workingYearConversionTax: number;
  /** Employer match contribution to pre-tax (0 cost from free cash flow). */
  employerMatch: number;
  /** Free cash flow available this year (post-tax, real growth applied). */
  freeCashFlowAvailable: number;
  /** Free cash flow consumed by allocation rules. */
  freeCashFlowConsumed: number;
  /** Leftover free cash flow that no rule absorbed. */
  freeCashFlowRemaining: number;
}

export function resolveSavingsStrategy(
  strategy: SavingsStrategy,
  currentYear: number,
  workingYears: number,
): ResolvedYearAllocation[] {
  const out: ResolvedYearAllocation[] = [];
  const growthRate = strategy.freeCashFlowGrowth ?? 0;
  const marginalRate = strategy.marginalTaxRateFedState;

  for (let y = 0; y < workingYears; y++) {
    const year = currentYear + y;
    const fcf = strategy.annualFreeCashFlow * Math.pow(1 + growthRate, y);
    let available = fcf;

    let pretax = 0;
    let roth = 0;
    let hsa = 0;
    let brokerage = 0;
    let wyConv = 0;
    let wyConvTax = 0;
    let match = 0;

    for (const rule of strategy.rules) {
      if (!isActive(rule, year)) continue;
      if (available <= 0 && rule.kind !== 'employer_match') break;

      switch (rule.kind) {
        case 'employer_match': {
          // Employer match is free money — 0 cost from free cash flow.
          // `limit` is the annual match dollar amount (e.g., $5,000). No gross-up needed.
          // Simple model: flat dollars per year. If user wants match = N% of salary, they
          // compute that offline and pass it as limit.
          match += rule.limit ?? 0;
          break;
        }

        case 'hsa': {
          const limit = rule.limit ?? Infinity;
          const add = Math.min(limit, available);
          hsa += add;
          available -= add;
          break;
        }

        case 'backdoor_roth':
        case 'roth_401k':
        case 'mega_backdoor': {
          // All three are post-tax → Roth. 1:1 consumption from free cash flow.
          const limit = rule.limit ?? Infinity;
          const add = Math.min(limit, available);
          roth += add;
          available -= add;
          break;
        }

        case 'pretax_401k': {
          // Gross-up: $1 of post-tax cash produces $1/(1 − rate) of pre-tax contribution,
          // because raising the pretax % reduces taxable wages; the tax saved is
          // reinvested via the same contribution. Limit is expressed in GROSS contribution
          // dollars (matching how IRS limits are stated — $23,500 elective, etc.).
          const grossLimit = rule.limit ?? Infinity;
          const grossPossible = available / (1 - marginalRate);
          const grossAdd = Math.min(grossLimit, grossPossible);
          const postTaxCost = grossAdd * (1 - marginalRate);
          pretax += grossAdd;
          available -= postTaxCost;
          break;
        }

        case 'working_year_conversion': {
          // Conversion moves pre-tax → Roth. Tax is paid from outside cash at the
          // combined marginal rate. Rule's limit is the gross conversion amount.
          // Free cash flow consumed = conversion × marginalRate.
          const limit = rule.limit ?? Infinity;
          const maxConversionByCash = marginalRate > 0 ? available / marginalRate : Infinity;
          const conversion = Math.min(limit, maxConversionByCash);
          const tax = conversion * marginalRate;
          wyConv += conversion;
          wyConvTax += tax;
          available -= tax;
          break;
        }

        case 'brokerage': {
          const limit = rule.limit ?? Infinity;
          const add = Math.min(limit, available);
          brokerage += add;
          available -= add;
          break;
        }
      }
    }

    out.push({
      year,
      pretaxContribution: pretax,
      rothContribution: roth,
      hsaContribution: hsa,
      brokerageContribution: brokerage,
      workingYearConversion: wyConv,
      workingYearConversionTax: wyConvTax,
      employerMatch: match,
      freeCashFlowAvailable: fcf,
      freeCashFlowConsumed: fcf - available,
      freeCashFlowRemaining: Math.max(0, available),
    });
  }

  return out;
}

function isActive(rule: AllocationRule, year: number): boolean {
  if (rule.activateYear !== undefined && year < rule.activateYear) return false;
  if (rule.deactivateYear !== undefined && year > rule.deactivateYear) return false;
  return true;
}

/**
 * Aggregate totals across all resolved years — handy for reporting and
 * cross-strategy summary tables.
 */
export interface StrategyTotals {
  totalPretaxContributions: number;
  totalRothContributions: number;
  totalHsaContributions: number;
  totalBrokerageContributions: number;
  totalWorkingYearConversions: number;
  totalWorkingYearConversionTax: number;
  totalEmployerMatch: number;
  totalFreeCashFlowAvailable: number;
  totalFreeCashFlowConsumed: number;
  totalFreeCashFlowRemaining: number;
}

export function aggregateStrategyTotals(allocations: ResolvedYearAllocation[]): StrategyTotals {
  return allocations.reduce<StrategyTotals>(
    (acc, a) => ({
      totalPretaxContributions:       acc.totalPretaxContributions       + a.pretaxContribution,
      totalRothContributions:         acc.totalRothContributions         + a.rothContribution,
      totalHsaContributions:          acc.totalHsaContributions          + a.hsaContribution,
      totalBrokerageContributions:    acc.totalBrokerageContributions    + a.brokerageContribution,
      totalWorkingYearConversions:    acc.totalWorkingYearConversions    + a.workingYearConversion,
      totalWorkingYearConversionTax:  acc.totalWorkingYearConversionTax  + a.workingYearConversionTax,
      totalEmployerMatch:             acc.totalEmployerMatch             + a.employerMatch,
      totalFreeCashFlowAvailable:     acc.totalFreeCashFlowAvailable     + a.freeCashFlowAvailable,
      totalFreeCashFlowConsumed:      acc.totalFreeCashFlowConsumed      + a.freeCashFlowConsumed,
      totalFreeCashFlowRemaining:     acc.totalFreeCashFlowRemaining     + a.freeCashFlowRemaining,
    }),
    {
      totalPretaxContributions: 0,
      totalRothContributions: 0,
      totalHsaContributions: 0,
      totalBrokerageContributions: 0,
      totalWorkingYearConversions: 0,
      totalWorkingYearConversionTax: 0,
      totalEmployerMatch: 0,
      totalFreeCashFlowAvailable: 0,
      totalFreeCashFlowConsumed: 0,
      totalFreeCashFlowRemaining: 0,
    },
  );
}
