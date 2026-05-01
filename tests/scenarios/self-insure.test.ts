/**
 * Self-insure path — engine behavior when client.healthcareCoverage === 'self_insure'.
 *
 * Pre-Medicare years are classified as 'self_insure' season (parallel to 'international').
 * Engine should:
 *   - Skip ACA subsidy classification (acaSubsidyEligible always false)
 *   - Skip IRMAA pre-65 (already true via season-gating)
 *   - Add selfInsuranceAnnualBudget × inflationFactor to spending in self_insure years only
 *   - Allow Roth conversions during self_insure years (no MAGI cliff to manage)
 *
 * Post-65 the user is on Medicare like everyone else, so IRMAA can still apply.
 */
import { describe, it, expect } from 'vitest';
import { deriveAssetTotals } from '../../src/domain/types/assets';
import { runSimulation } from '../../src/domain/engine/simulation-runner';
import { classifySeasonForYear, getCobraWindowEnd } from '../../src/domain/engine/seasons';
import type { ClientProfile } from '../../src/domain/types/profile';
import type { Account } from '../../src/domain/types/assets';
import type { SpendingProfile } from '../../src/domain/types/spending';
import type { GuardrailConfig } from '../../src/domain/types/scenarios';

const guardrails: GuardrailConfig = {
  upperGuardrailGrowthPct: 0.20,
  lowerGuardrailDropPct: 0.25,
  lowerGuardrailSpendingCutPct: 0.03,
};

// Already-retired single client at age 50 with $1M pretax IRA, no brokerage —
// shaped after Ryan's Lump Slam export so the regression matches the report.
function makeRyanLikeProfile(coverage: 'standard' | 'self_insure'): {
  profile: ClientProfile;
  accounts: Account[];
  spending: SpendingProfile;
} {
  const profile: ClientProfile = {
    client: {
      name: 'R',
      age: 50,
      birthYear: 1976,
      lifeExpectancy: 90,
      fullRetirementAge: 67,
      fraMonthlyBenefit: 1_500,
      socialSecurityClaimAge: 62,
    },
    spouse: null,
    filingStatus: 'single',
    stateOfResidence: 'NH',
    hasStateIncomeTax: false,
    currentYear: 2026,
    retirementYearDesired: 2026,
    cobraMonths: coverage === 'self_insure' ? 0 : 18,
    acaHouseholdSize: 1,
    annualGrowthRate: 0.08,
    ...(coverage === 'self_insure' && { healthcareCoverage: 'self_insure' as const }),
  };
  const accounts: Account[] = [
    { id: '1', label: 'IRA', owner: 'client', type: 'pretax_ira', currentBalance: 1_000_000 },
  ];
  const spending: SpendingProfile = {
    baseAnnualSpending: 50_000,
    travelBudgetEarly: 10_000,
    travelBudgetLate: 0,
    travelTaperStartAge: 65,
    charitableGivingAnnual: 0,
    oneTimeExpenses: [],
    inflationRate: 0.03,
    annualHealthcareCost: 5_000,
    ...(coverage === 'self_insure' && { selfInsuranceAnnualBudget: 18_000 }),
  };
  return { profile, accounts, spending };
}

describe('classifySeasonForYear — self_insure', () => {
  const profile: ClientProfile = {
    client: { name: 'R', age: 50, birthYear: 1976, lifeExpectancy: 90, fullRetirementAge: 67, fraMonthlyBenefit: 1500, socialSecurityClaimAge: 62 },
    spouse: null,
    filingStatus: 'single',
    stateOfResidence: 'NH',
    hasStateIncomeTax: false,
    currentYear: 2026,
    retirementYearDesired: 2026,
    cobraMonths: 0,
    healthcareCoverage: 'self_insure',
  };

  it('pre-65 year → self_insure (not aca, not cobra)', () => {
    const cobraEnd = getCobraWindowEnd(2026, 0);
    expect(classifySeasonForYear(2030, profile, cobraEnd)).toBe('self_insure');
  });

  it('age 65 → medicare (Medicare still kicks in by default)', () => {
    // Client is 50 in 2026; age 65 = year 2041
    const cobraEnd = getCobraWindowEnd(2026, 0);
    expect(classifySeasonForYear(2041, profile, cobraEnd)).toBe('medicare');
  });

  it('age 73+ → rmd', () => {
    const cobraEnd = getCobraWindowEnd(2026, 0);
    expect(classifySeasonForYear(2049, profile, cobraEnd)).toBe('rmd');
  });

  it('international takes precedence over self_insure', () => {
    const intlProfile = { ...profile, retirementLocation: 'international' as const };
    const cobraEnd = getCobraWindowEnd(2026, 0);
    expect(classifySeasonForYear(2030, intlProfile, cobraEnd)).toBe('international');
  });
});

describe('Self-insure engine path — Ryan-like profile', () => {
  const { profile, accounts, spending } = makeRyanLikeProfile('self_insure');
  const assets = deriveAssetTotals(accounts, 0);
  const result = runSimulation(profile, assets, spending, guardrails, 'retire_now');

  it('pre-65 projections are labeled self_insure (not aca)', () => {
    const preMedicareYears = result.yearlyProjections.filter((y) => y.clientAge < 65);
    expect(preMedicareYears.length).toBeGreaterThan(0);
    for (const y of preMedicareYears) {
      expect(y.season).toBe('self_insure');
    }
  });

  it('ACA subsidy is never marked eligible during self_insure years', () => {
    const preMedicareYears = result.yearlyProjections.filter((y) => y.clientAge < 65);
    for (const y of preMedicareYears) {
      expect(y.acaSubsidyEligible).toBe(false);
      expect(y.estimatedAcaSavings).toBe(0);
    }
  });

  it('IRMAA does not apply pre-65 (only Medicare/RMD years price IRMAA)', () => {
    const preMedicareYears = result.yearlyProjections.filter((y) => y.clientAge < 65);
    for (const y of preMedicareYears) {
      expect(y.irmaaSurcharge).toBe(0);
      expect(y.irmaaApplies).toBe(false);
    }
  });

  it('Roth conversions can run freely pre-65 (no MAGI cliff capping them)', () => {
    // With $1M pretax and no brokerage, conversion_primary auto-fires. The 22% bracket
    // ceiling for a single filer is well above the $84,600 ACA cliff, so the conversion
    // amount should clearly exceed what an ACA-managed run would cap it at.
    const yearOne = result.yearlyProjections[0];
    expect(yearOne.rothConversion).not.toBeNull();
    expect(yearOne.rothConversion!.conversionAmount).toBeGreaterThan(90_000);
  });
});

describe('Self-insure budget — applies pre-65 only, isolated comparison', () => {
  // Compare two self-insure runs that differ ONLY in selfInsuranceAnnualBudget.
  // This isolates the budget's effect from any season-classification differences.
  const withBudget = (() => {
    const { profile, accounts, spending } = makeRyanLikeProfile('self_insure');
    return runSimulation(profile, deriveAssetTotals(accounts, 0), spending, guardrails, 'retire_now');
  })();
  const withoutBudget = (() => {
    const { profile, accounts, spending } = makeRyanLikeProfile('self_insure');
    const zeroBudget: SpendingProfile = { ...spending, selfInsuranceAnnualBudget: 0 };
    return runSimulation(profile, deriveAssetTotals(accounts, 0), zeroBudget, guardrails, 'retire_now');
  })();

  it('budget run withdraws more in self_insure (pre-65) years', () => {
    const totalSelfInsureWithdrawals = (proj: typeof withBudget) =>
      proj.yearlyProjections
        .filter((y) => y.season === 'self_insure')
        .reduce((s, y) => s + y.withdrawals.total, 0);
    expect(totalSelfInsureWithdrawals(withBudget))
      .toBeGreaterThan(totalSelfInsureWithdrawals(withoutBudget));
  });

  it('first self_insure year reflects ~budget × (1+inflation)^0 added cost', () => {
    // Year 0 of retirement should have ~$18k more drawn than the zero-budget run.
    // The conversion-primary engine funds spending from Roth, so withdrawals.fromRoth
    // is the right comparison axis.
    const w = withBudget.yearlyProjections[0];
    const z = withoutBudget.yearlyProjections[0];
    const delta = w.withdrawals.total - z.withdrawals.total;
    // Allow ±$1500 tolerance; tax-bracket math may shift by a small amount.
    expect(delta).toBeGreaterThan(16_500);
    expect(delta).toBeLessThan(19_500);
  });
});
