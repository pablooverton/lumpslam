// IRS Uniform Lifetime Table (2022+ updated table, Pub 590-B Table III)
// Maps age → distribution period (used to calculate RMD)
// BUG FIX 2026-06-11: table previously ended at 95, and calculateRMD returned 0 for missing
// ages — any profile with life expectancy > 95 silently stopped taking RMDs (and paying RMD
// tax) at 96. Full table through 120+; ages beyond use the last entry (2.0).
export const RMD_UNIFORM_LIFETIME_TABLE: Record<number, number> = {
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9,
  78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7,
  84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9,
  90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5,  95: 8.9,
  96: 8.4,  97: 7.8,  98: 7.3,  99: 6.8,  100: 6.4, 101: 6.0,
  102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1,
  108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4, 112: 3.3, 113: 3.1,
  114: 3.0, 115: 2.9, 116: 2.8, 117: 2.7, 118: 2.5, 119: 2.3,
  120: 2.0,
};

// Distribution period for ages past the table's end (IRS: "120 and over" = 2.0).
export const RMD_MAX_TABLE_AGE = 120;

// RMD start age per SECURE Act 2.0. Legacy default; prefer getRmdStartAge(birthYear).
export const RMD_START_AGE = 73;

// RMD start age per SECURE Act 2.0, by birth year:
//   born 1951–1959 → 73; born 1960 or later → 75. (Pre-1951 → 72; earlier 70.5 not modeled.)
// Deriving from birth year fixes a latent bug: the flat 73 under-aged RMDs for anyone born ≥1960.
export function getRmdStartAge(birthYear: number): number {
  if (birthYear >= 1960) return 75;
  if (birthYear >= 1951) return 73;
  return 72;
}
