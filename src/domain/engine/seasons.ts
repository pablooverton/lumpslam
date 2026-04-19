import type { ClientProfile } from '../types/profile';
import type { RetirementSeason } from '../types/simulation';
import { getAcaCliff, ACA_ESTIMATED_ANNUAL_SAVINGS_COUPLE } from '../constants/aca-thresholds';
import { IRMAA_BRACKETS_2025 } from '../constants/tax-brackets';
import { RMD_START_AGE } from '../constants/rmd-tables';

export function getCobraWindowEnd(retirementYear: number, cobraMonths = 12): number {
  // Cobra ends partway through the year; we model it as ending at end of retirementYear + 1
  // if cobraMonths > 12, it spans into the second year
  return cobraMonths > 12 ? retirementYear + 1 : retirementYear;
}

export function classifySeasonForYear(
  year: number,
  profile: ClientProfile,
  cobraEndYear: number
): RetirementSeason {
  const clientAge = profile.currentYear
    ? profile.client.age + (year - profile.currentYear)
    : profile.client.age;

  // International retirement: no ACA season. Pre-Medicare years use the same engine rules
  // as COBRA (no MAGI cliff, unrestricted withdrawals) but are labeled 'international'
  // so the user isn't confused by 25 years of "COBRA" in the projection table.
  if (profile.retirementLocation === 'international') {
    if (clientAge < 65) return 'international';
    if (clientAge < RMD_START_AGE) return 'medicare';
    return 'rmd';
  }

  // US path: COBRA only applies when cobraMonths > 0
  if (profile.cobraMonths > 0 && year <= cobraEndYear) return 'cobra';
  if (clientAge < 65) return 'aca';
  if (clientAge < RMD_START_AGE) return 'medicare';
  return 'rmd';
}

export interface MagiComponents {
  socialSecurityIncludable: number; // 85% of SS is includable in MAGI
  pretaxWithdrawals: number;
  rothConversionAmount: number;
  capitalGainsRealized: number;
  otherIncome: number;
}

// MAGI for ACA purposes = AGI + non-taxable SS + foreign income (simplified here)
export function calculateMAGI(components: MagiComponents): number {
  return (
    components.socialSecurityIncludable +
    components.pretaxWithdrawals +
    components.rothConversionAmount +
    components.capitalGainsRealized +
    components.otherIncome
  );
}

export interface AcaEligibilityResult {
  eligible: boolean;
  magi: number;
  cliff: number;
  headroom: number; // dollars below cliff (negative if over)
  estimatedAnnualSavings: number;
}

export function assessAcaEligibility(magi: number, householdSize = 2): AcaEligibilityResult {
  const cliff = getAcaCliff(householdSize);
  const headroom = cliff - magi;
  const eligible = magi < cliff;
  return {
    eligible,
    magi,
    cliff,
    headroom,
    estimatedAnnualSavings: eligible ? ACA_ESTIMATED_ANNUAL_SAVINGS_COUPLE : 0,
  };
}

// IRMAA uses MAGI from 2 years prior (the "lookback MAGI"). Medicare in 2026 prices Part B/D
// surcharges based on your 2024 AGI. A big Roth conversion at age 65 doesn't trigger a surcharge
// until age 67. Callers must pass the correct lookback value; `currentYearMagi` is only accepted
// as a fallback for the first two years of Medicare when no lookback is available yet.
export function calculateIrmaaSurcharge(
  lookbackMagi: number,
  filingStatus: 'married_filing_jointly' | 'single'
): number {
  let surcharge = 0;
  for (const bracket of [...IRMAA_BRACKETS_2025].reverse()) {
    const floor =
      filingStatus === 'married_filing_jointly'
        ? bracket.magiFloorMFJ
        : bracket.magiFloorSingle;
    if (lookbackMagi >= floor) {
      // Two people on Medicare (couple)
      const people = filingStatus === 'married_filing_jointly' ? 2 : 1;
      surcharge =
        (bracket.partBSurchargePerPerson + bracket.partDSurchargePerPerson) * people * 12;
      break;
    }
  }
  return surcharge;
}

export interface IrmaaTierInfo {
  tierIndex: number;           // 0 = no surcharge, 5 = top tier
  tierLabel: string;           // e.g. "Tier 2" or "No surcharge"
  magiFloor: number;           // floor of the tier that applies
  magiCeiling: number;         // ceiling of the tier (Infinity for top)
  annualSurchargeCouple: number;
  roomToNextTier: number;      // headroom before next surcharge jump (Infinity if at top)
  nextTierJump: number;        // annual surcharge increase at next tier (0 at top)
}

// Decompose a MAGI value into its IRMAA tier characteristics. Used by the supercharge-analysis
// opportunity to show a user the cost of crossing into a higher tier vs. the tax saved from the
// additional conversion room unlocked.
export function classifyIrmaaTier(
  lookbackMagi: number,
  filingStatus: 'married_filing_jointly' | 'single'
): IrmaaTierInfo {
  const floorOf = (b: typeof IRMAA_BRACKETS_2025[number]) =>
    filingStatus === 'married_filing_jointly' ? b.magiFloorMFJ : b.magiFloorSingle;
  const people = filingStatus === 'married_filing_jointly' ? 2 : 1;

  let tierIndex = 0;
  for (let i = IRMAA_BRACKETS_2025.length - 1; i >= 0; i--) {
    if (lookbackMagi >= floorOf(IRMAA_BRACKETS_2025[i])) {
      tierIndex = i;
      break;
    }
  }
  const current = IRMAA_BRACKETS_2025[tierIndex];
  const next = IRMAA_BRACKETS_2025[tierIndex + 1];
  const magiFloor = floorOf(current);
  const magiCeiling = next ? floorOf(next) : Infinity;
  const annualSurchargeCouple =
    (current.partBSurchargePerPerson + current.partDSurchargePerPerson) * people * 12;
  const nextAnnualSurcharge = next
    ? (next.partBSurchargePerPerson + next.partDSurchargePerPerson) * people * 12
    : annualSurchargeCouple;

  return {
    tierIndex,
    tierLabel: tierIndex === 0 ? 'No surcharge' : `Tier ${tierIndex}`,
    magiFloor,
    magiCeiling,
    annualSurchargeCouple,
    roomToNextTier: next ? magiCeiling - lookbackMagi : Infinity,
    nextTierJump: nextAnnualSurcharge - annualSurchargeCouple,
  };
}
