import { getMarginalRate, remainingCapacityInBracket } from './tax-utils';
import { FEDERAL_INCOME_TAX_BRACKETS_2025 } from '../constants/tax-brackets';
import type { RothConversionEvent } from '../types/simulation';

export interface RothConversionInput {
  currentMAGI: number;                // MAGI before any conversion
  surplusSpendingCapacity: number;    // spending capacity minus desired spend
  pretaxBalance: number;
  brokerageBalance: number;
  filingStatus: 'married_filing_jointly' | 'single';
  targetBracketCeiling: number;       // fill up to this MAGI level (e.g. 22% bracket ceiling)
}

// Two-event Roth conversion model:
// Event 1: pretax withdrawal for living expenses + embedded tax — tracked in spending, not here
// Event 2: surplus used to fund a Roth conversion; tax on conversion paid from brokerage
export function calculateRothConversion(input: RothConversionInput): RothConversionEvent | null {
  const {
    currentMAGI,
    surplusSpendingCapacity,
    pretaxBalance,
    brokerageBalance,
    filingStatus,
    targetBracketCeiling,
  } = input;

  if (surplusSpendingCapacity <= 0 || pretaxBalance <= 0 || brokerageBalance <= 0) return null;

  // How much room is left in the target bracket?
  const bracketHeadroom = Math.max(0, targetBracketCeiling - currentMAGI);
  if (bracketHeadroom <= 0) return null;

  const marginalRate = getMarginalRate(currentMAGI, filingStatus, FEDERAL_INCOME_TAX_BRACKETS_2025);

  // Brokerage tax budget = surplus spending capacity (we use surplus to pay conversion tax)
  // Gross up: if marginalRate = 0.22, to convert $X, you need $X * 0.22 in brokerage tax budget
  // So: brokerageTaxBudget = surplusSpendingCapacity → conversionAmount = brokerageTaxBudget / marginalRate
  const brokerageTaxBudget = Math.min(surplusSpendingCapacity, brokerageBalance);
  const grossedUpConversion = brokerageTaxBudget / marginalRate;

  // Cap at bracket headroom and available pretax balance
  const conversionAmount = Math.min(grossedUpConversion, bracketHeadroom, pretaxBalance);
  const taxOnConversion = conversionAmount * marginalRate;
  const brokerageFundingAmount = taxOnConversion;

  return {
    conversionAmount,
    marginalRate,
    taxOnConversion,
    brokerageFundingAmount,
  };
}
