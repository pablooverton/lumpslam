import { RMD_UNIFORM_LIFETIME_TABLE, RMD_MAX_TABLE_AGE, RMD_START_AGE } from '../constants/rmd-tables';

export function calculateRMD(
  priorYearEndBalance: number,
  ownerAge: number,
  startAge: number = RMD_START_AGE
): number {
  if (ownerAge < startAge) return 0;
  // Ages past the table's end use the last entry ("120 and over" per IRS) — never 0, which
  // would silently stop RMDs for very long-lived profiles.
  const lookupAge = Math.min(ownerAge, RMD_MAX_TABLE_AGE);
  const distributionPeriod = RMD_UNIFORM_LIFETIME_TABLE[lookupAge];
  if (!distributionPeriod) return 0;
  return priorYearEndBalance / distributionPeriod;
}

// Project annual distributions from an inherited IRA under the 10-year rule
export function projectInheritedIraDistributions(
  currentBalance: number,
  yearsRemaining: number,
  growthRate = 0.07
): number[] {
  if (yearsRemaining <= 0) return [];

  const distributions: number[] = [];
  let balance = currentBalance;

  for (let y = yearsRemaining; y > 0; y--) {
    // Equal distributions over remaining years (simple strategy)
    const dist = balance / y;
    distributions.push(dist);
    balance = (balance - dist) * (1 + growthRate);
  }

  return distributions;
}
