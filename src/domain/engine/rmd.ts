import { RMD_UNIFORM_LIFETIME_TABLE, RMD_START_AGE } from '../constants/rmd-tables';

export function calculateRMD(priorYearEndBalance: number, ownerAge: number): number {
  if (ownerAge < RMD_START_AGE) return 0;
  const distributionPeriod = RMD_UNIFORM_LIFETIME_TABLE[ownerAge];
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
