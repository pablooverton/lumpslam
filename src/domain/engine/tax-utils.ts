import { FEDERAL_INCOME_TAX_BRACKETS_2025, type TaxBracket } from '../constants/tax-brackets';

export function calculateOrdinaryIncomeTax(
  taxableIncome: number,
  filingStatus: 'married_filing_jointly' | 'single',
  brackets: TaxBracket[] = FEDERAL_INCOME_TAX_BRACKETS_2025
): number {
  let remaining = Math.max(0, taxableIncome);
  let tax = 0;
  let prevCeiling = 0;

  for (const bracket of brackets) {
    const ceiling = filingStatus === 'married_filing_jointly' ? bracket.ceilingMFJ : bracket.ceilingSingle;
    const bracketSize = ceiling - prevCeiling;
    const taxableInBracket = Math.min(remaining, bracketSize);
    tax += taxableInBracket * bracket.rate;
    remaining -= taxableInBracket;
    prevCeiling = ceiling;
    if (remaining <= 0) break;
  }

  return tax;
}

// Returns the marginal rate that applies at a given income level
export function getMarginalRate(
  taxableIncome: number,
  filingStatus: 'married_filing_jointly' | 'single',
  brackets: TaxBracket[] = FEDERAL_INCOME_TAX_BRACKETS_2025
): number {
  for (const bracket of brackets) {
    const ceiling = filingStatus === 'married_filing_jointly' ? bracket.ceilingMFJ : bracket.ceilingSingle;
    if (taxableIncome <= ceiling) return bracket.rate;
  }
  return brackets[brackets.length - 1].rate;
}

// Returns how much more income can be added before hitting the next bracket ceiling.
// At the exact ceiling, returns 0 (no headroom left in this bracket).
export function remainingCapacityInBracket(
  currentIncome: number,
  filingStatus: 'married_filing_jointly' | 'single',
  brackets: TaxBracket[] = FEDERAL_INCOME_TAX_BRACKETS_2025
): number {
  for (const bracket of brackets) {
    const ceiling = filingStatus === 'married_filing_jointly' ? bracket.ceilingMFJ : bracket.ceilingSingle;
    if (currentIncome <= ceiling) {
      return ceiling - currentIncome;
    }
  }
  return 0;
}
