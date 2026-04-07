export interface TaxBracket {
  rate: number;
  ceilingMFJ: number;   // Infinity for the top bracket
  ceilingSingle: number;
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
