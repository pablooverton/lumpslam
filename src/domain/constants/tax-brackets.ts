export interface TaxBracket {
  rate: number;
  ceilingMFJ: number;   // Infinity for the top bracket
  ceilingSingle: number;
}

// Standard deduction (2025, post-OBBBA). Applied before bracket calculation.
// OBBBA (signed 2025-07-04) raised the 2025 MFJ standard deduction to $31,500
// ($15,750 single) and made the TCJA bracket structure permanent. IRS indexes these to
// inflation, so they represent "real" 2025 amounts (real-sticky in the engine).
export const STANDARD_DEDUCTION_2025 = {
  married_filing_jointly: 31_500,
  single: 15_750,
} as const;

// OBBBA senior deduction: $6,000 per person aged 65+, tax years 2025–2028 only,
// phased out at 6% of MAGI above $150k MFJ / $75k single. Modeled on the calendar
// year (engine year = calendar year), so it simply stops after 2028.
export const OBBBA_SENIOR_DEDUCTION_PER_PERSON = 6_000;
export const OBBBA_SENIOR_DEDUCTION_LAST_YEAR = 2028;

export function calculateSeniorDeduction(
  year: number,
  filingStatus: 'married_filing_jointly' | 'single',
  magi: number,
  personsAged65Plus: number
): number {
  if (year > OBBBA_SENIOR_DEDUCTION_LAST_YEAR || personsAged65Plus <= 0) return 0;
  const threshold = filingStatus === 'married_filing_jointly' ? 150_000 : 75_000;
  const base = OBBBA_SENIOR_DEDUCTION_PER_PERSON * personsAged65Plus;
  const phaseOut = Math.max(0, (magi - threshold) * 0.06);
  return Math.max(0, base - phaseOut);
}

// Return the taxable-income ceiling for a given bracket rate and filing status.
// Used by the conversion engine to compute how much headroom remains before the next bracket.
export function getBracketCeiling(
  targetBracket: string,   // e.g. '22%'
  filingStatus: 'married_filing_jointly' | 'single',
  brackets: TaxBracket[]
): number {
  const rate = parseFloat(targetBracket) / 100;
  const bracket = brackets.find(b => b.rate === rate);
  if (!bracket) throw new Error(`Unknown bracket rate: ${targetBracket}`);
  return filingStatus === 'married_filing_jointly' ? bracket.ceilingMFJ : bracket.ceilingSingle;
}

// 2025 federal ordinary income tax brackets
export const FEDERAL_INCOME_TAX_BRACKETS_2025: TaxBracket[] = [
  { rate: 0.10, ceilingMFJ: 23_850,    ceilingSingle: 11_925 },
  { rate: 0.12, ceilingMFJ: 96_950,    ceilingSingle: 48_475 },
  { rate: 0.22, ceilingMFJ: 206_700,   ceilingSingle: 103_350 },
  { rate: 0.24, ceilingMFJ: 394_600,   ceilingSingle: 197_300 },
  { rate: 0.32, ceilingMFJ: 501_050,   ceilingSingle: 250_525 },
  { rate: 0.35, ceilingMFJ: 751_600,   ceilingSingle: 626_350 },
  { rate: 0.37, ceilingMFJ: Infinity,  ceilingSingle: Infinity },
];

// 2025 long-term capital gains brackets
export interface CapGainsBracket {
  rate: number;
  ceilingMFJ: number;
  ceilingSingle: number;
}

export const LTCG_BRACKETS_2025: CapGainsBracket[] = [
  { rate: 0.00, ceilingMFJ: 96_700,   ceilingSingle: 48_350 },
  { rate: 0.15, ceilingMFJ: 600_050,  ceilingSingle: 533_400 },
  { rate: 0.20, ceilingMFJ: Infinity, ceilingSingle: Infinity },
];

// 2025 IRMAA Medicare surcharge brackets (MAGI from 2 years prior)
export interface IrmaaBracket {
  magiFloorMFJ: number;
  magiFloorSingle: number;
  partBSurchargePerPerson: number; // monthly additional premium per person
  partDSurchargePerPerson: number;
}

export const IRMAA_BRACKETS_2025: IrmaaBracket[] = [
  { magiFloorMFJ: 0,         magiFloorSingle: 0,        partBSurchargePerPerson: 0,      partDSurchargePerPerson: 0 },
  { magiFloorMFJ: 212_000,   magiFloorSingle: 106_000,  partBSurchargePerPerson: 74.00,  partDSurchargePerPerson: 13.70 },
  { magiFloorMFJ: 266_000,   magiFloorSingle: 133_000,  partBSurchargePerPerson: 185.00, partDSurchargePerPerson: 35.70 },
  { magiFloorMFJ: 334_000,   magiFloorSingle: 167_000,  partBSurchargePerPerson: 296.40, partDSurchargePerPerson: 57.80 },
  { magiFloorMFJ: 400_000,   magiFloorSingle: 200_000,  partBSurchargePerPerson: 407.40, partDSurchargePerPerson: 79.80 },
  { magiFloorMFJ: 750_000,   magiFloorSingle: 500_000,  partBSurchargePerPerson: 443.90, partDSurchargePerPerson: 85.80 },
];
