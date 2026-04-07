// 2025 ACA subsidy thresholds (400% FPL = subsidy cliff)
// FPL = Federal Poverty Level
export const ACA_FPL_2025 = {
  onePerson: 15_060,
  twoPersons: 20_440,
  perAdditionalPerson: 5_380,
};

// 400% FPL for a two-person household = the ACA subsidy cliff
// Exceeding this by $1 eliminates all subsidies
export const ACA_SUBSIDY_CLIFF_MFJ_2025 = ACA_FPL_2025.twoPersons * 4; // $81,760 — use $84,600 (current published figure)
// Note: The 2025 published 400% FPL cliff for 2-person household is $84,600
export const ACA_MAGI_CLIFF_2025 = 84_600;

// Estimated premium savings for a couple qualifying for ACA subsidies (benchmark plan)
export const ACA_ESTIMATED_ANNUAL_SAVINGS_COUPLE = 17_500; // midpoint of $15k-$20k range
