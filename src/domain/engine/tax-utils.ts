import {
  FEDERAL_INCOME_TAX_BRACKETS_2025,
  LTCG_BRACKETS_2025,
  type CapGainsBracket,
  type TaxBracket,
} from '../constants/tax-brackets';

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

// Long-term capital gains stack ON TOP of ordinary taxable income: the gains occupy
// [ordinaryTaxableIncome, ordinaryTaxableIncome + taxableGains] on the LTCG schedule
// (0% / 15% / 20% by bracket). Ordinary income fills from the bottom, so conversions and
// pretax draws push gains out of the 0% bracket — the interplay the planner needs to price.
// Callers pass TAXABLE gains: any standard deduction unused by ordinary income shelters
// gains first (taxableGains = max(0, ordMagi + gains − std) − max(0, ordMagi − std)).
export function calculateLtcgTax(
  taxableGains: number,
  ordinaryTaxableIncome: number,
  filingStatus: 'married_filing_jointly' | 'single',
  brackets: CapGainsBracket[] = LTCG_BRACKETS_2025
): number {
  const floor = Math.max(0, ordinaryTaxableIncome);
  const top = floor + Math.max(0, taxableGains);
  let tax = 0;
  let prevCeiling = 0;
  for (const bracket of brackets) {
    const ceiling = filingStatus === 'married_filing_jointly' ? bracket.ceilingMFJ : bracket.ceilingSingle;
    const overlap = Math.max(0, Math.min(top, ceiling) - Math.max(floor, prevCeiling));
    tax += overlap * bracket.rate;
    prevCeiling = ceiling;
    if (ceiling >= top) break;
  }
  return tax;
}

// Net Investment Income Tax: 3.8% on investment income above the MAGI threshold
// ($250k MFJ / $200k single). The thresholds are statutorily NOT inflation-indexed; the
// real-internal engine treats them as real-sticky like everything else — a documented,
// slightly optimistic simplification (in reality the unindexed threshold bites more over
// time). The engine's modeled investment income is realized capital gains.
export function calculateNiit(
  investmentIncome: number,
  magi: number,
  filingStatus: 'married_filing_jointly' | 'single'
): number {
  const threshold = filingStatus === 'married_filing_jointly' ? 250_000 : 200_000;
  const base = Math.min(Math.max(0, investmentIncome), Math.max(0, magi - threshold));
  return 0.038 * base;
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
