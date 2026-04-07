import type { ClientProfile } from '../types/profile';
import type { RetirementSeason } from '../types/simulation';
import { ACA_MAGI_CLIFF_2025, ACA_ESTIMATED_ANNUAL_SAVINGS_COUPLE } from '../constants/aca-thresholds';
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

  if (year <= cobraEndYear) return 'cobra';
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
  const cliff = ACA_MAGI_CLIFF_2025;
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

export function calculateIrmaaSurcharge(
  magi: number,
  filingStatus: 'married_filing_jointly' | 'single'
): number {
  let surcharge = 0;
  for (const bracket of [...IRMAA_BRACKETS_2025].reverse()) {
    const floor =
      filingStatus === 'married_filing_jointly'
        ? bracket.magiFloorMFJ
        : bracket.magiFloorSingle;
    if (magi >= floor) {
      // Two people on Medicare (couple)
      const people = filingStatus === 'married_filing_jointly' ? 2 : 1;
      surcharge =
        (bracket.partBSurchargePerPerson + bracket.partDSurchargePerPerson) * people * 12;
      break;
    }
  }
  return surcharge;
}
