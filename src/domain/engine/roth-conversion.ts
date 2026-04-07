import { getMarginalRate, remainingCapacityInBracket } from './tax-utils';
import { FEDERAL_INCOME_TAX_BRACKETS_2025 } from '../constants/tax-brackets';
import type { RothConversionEvent } from '../types/simulation';

export interface RothConversionInput {
  currentMAGI: number;                // MAGI before any conversion
  surplusSpendingCapacity: number;    // spending capacity minus desired spend (surplus-driven mode)
  targetAmount?: number;              // if set, convert this amount regardless of surplus
  pretaxBalance: number;
  brokerageBalance: number;
  filingStatus: 'married_filing_jointly' | 'single';
  targetBracketCeiling: number;       // fill up to this MAGI level (e.g. 22% bracket ceiling)
}

// Two-event Roth conversion model:
// Event 1: pretax withdrawal for living expenses + embedded tax — tracked in spending, not here
// Event 2: conversion amount; tax paid from brokerage if available, otherwise from Roth
export function calculateRothConversion(input: RothConversionInput): RothConversionEvent | null {
  const {
    currentMAGI,
    surplusSpendingCapacity,
    targetAmount,
    pretaxBalance,
    brokerageBalance,
    filingStatus,
    targetBracketCeiling,
  } = input;

  if (pretaxBalance <= 0) return null;

  // How much room is left in the target bracket?
  const bracketHeadroom = Math.max(0, targetBracketCeiling - currentMAGI);
  if (bracketHeadroom <= 0) return null;

  const marginalRate = getMarginalRate(currentMAGI, filingStatus, FEDERAL_INCOME_TAX_BRACKETS_2025);

  let conversionAmount: number;

  if (targetAmount != null) {
    // Target-driven: user specifies desired annual conversion (e.g. $242k).
    // Does not require brokerage — taxes paid from Roth if no brokerage available.
    conversionAmount = Math.min(targetAmount, bracketHeadroom, pretaxBalance);
  } else {
    // Surplus-driven (original behavior): brokerage funds the conversion tax.
    // Requires positive brokerage balance.
    if (surplusSpendingCapacity <= 0 || brokerageBalance <= 0) return null;

    // Brokerage tax budget = surplus spending capacity
    // Gross up: if marginalRate = 0.22, to convert $X, you need $X * 0.22 in brokerage tax budget
    const brokerageTaxBudget = Math.min(surplusSpendingCapacity, brokerageBalance);
    const grossedUpConversion = brokerageTaxBudget / marginalRate;
    conversionAmount = Math.min(grossedUpConversion, bracketHeadroom, pretaxBalance);
  }

  if (conversionAmount <= 0) return null;

  const taxOnConversion = conversionAmount * marginalRate;

  // Pay tax from brokerage first; overflow comes from Roth (e.g. no-brokerage scenario)
  const brokerageFundingAmount = Math.min(taxOnConversion, brokerageBalance);
  const rothFundingAmount = taxOnConversion - brokerageFundingAmount;

  return {
    conversionAmount,
    marginalRate,
    taxOnConversion,
    brokerageFundingAmount,
    rothFundingAmount,
  };
}
