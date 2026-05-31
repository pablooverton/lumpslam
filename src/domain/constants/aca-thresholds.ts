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

/**
 * Returns the ACA subsidy cliff (400% FPL) for the given household size.
 * Base: $84,600 for a 2-person household (2025 published figure).
 * Each additional person adds ~$21,520 (400% × $5,380 per-person FPL increment).
 */
export function getAcaCliff(householdSize: number): number {
  const size = Math.max(1, Math.round(householdSize));
  if (size <= 2) return ACA_MAGI_CLIFF_2025;
  return ACA_MAGI_CLIFF_2025 + (size - 2) * (ACA_FPL_2025.perAdditionalPerson * 4);
}

// ─── Net premium model (household-size-aware, with phase-out slope + cliff) ─────
//
// Full unsubsidized benchmark (silver) premium, rough planning average PER PERSON per year
// (real USD). Grounded in P's NC base case (~$52k full-price for a family of ~8 → ~$6,500/person).
// Adults run higher and children lower; this flat per-person average is a planning approximation.
// SENSITIVITY-TEST this — it is the single biggest external assumption in the US-coast ACA cost.
export const ACA_FULL_PREMIUM_PER_PERSON = 6500;

// Post-2025 (enhanced ARPA/IRA subsidies expired) applicable-percentage schedule: the share of
// MAGI a household is expected to contribute toward the benchmark plan, indexed by income as a
// % of FPL. At/above 400% FPL the cliff applies (subsidy → 0, pay full premium). Anchor points;
// linear interpolation between them. Reverts toward the pre-ARPA (original ACA) curve.
const APPLICABLE_PCT_SCHEDULE: ReadonlyArray<readonly [fplPct: number, pct: number]> = [
  [150, 0.04], [200, 0.065], [250, 0.083], [300, 0.095], [400, 0.095],
];

export function applicableContributionPct(fplRatioPct: number): number {
  const s = APPLICABLE_PCT_SCHEDULE;
  if (fplRatioPct <= s[0][0]) return s[0][1];
  if (fplRatioPct >= s[s.length - 1][0]) return s[s.length - 1][1];
  for (let i = 1; i < s.length; i++) {
    if (fplRatioPct <= s[i][0]) {
      const [x0, y0] = s[i - 1];
      const [x1, y1] = s[i];
      return y0 + ((y1 - y0) * (fplRatioPct - x0)) / (x1 - x0);
    }
  }
  return s[s.length - 1][1];
}

/**
 * Net ACA premium the household actually pays after the premium tax credit, given MAGI and
 * household size. Below 400% FPL: net = applicablePct(MAGI/FPL) × MAGI, capped at the full
 * benchmark premium. At/above 400% FPL (the cliff): net = full benchmark premium (subsidy lost).
 * The FPL anchor is derived from getAcaCliff (÷4) so the cliff and the ratio stay consistent.
 */
export function netAcaPremium(
  magi: number,
  householdSize: number,
  fullPremiumPerPerson = ACA_FULL_PREMIUM_PER_PERSON
): number {
  const size = Math.max(1, Math.round(householdSize));
  const fullPremium = fullPremiumPerPerson * size;
  const cliff = getAcaCliff(size); // 400% FPL by size
  if (magi >= cliff) return fullPremium;
  const fplRatioPct = (magi / (cliff / 4)) * 100;
  const expected = applicableContributionPct(fplRatioPct) * Math.max(0, magi);
  return Math.min(expected, fullPremium);
}
