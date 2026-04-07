import type { SocialSecurityOption, SocialSecurityComparison } from '../types/social-security';

// Social Security delayed retirement credit: 8% per year after FRA
// Early claiming reduction: ~6.67%/yr for first 3 years before FRA, 5%/yr beyond that
export function calculateBenefitAtClaimAge(
  fraMonthlyBenefit: number,
  fullRetirementAge: number,
  claimAge: number
): number {
  const yearsDiff = claimAge - fullRetirementAge;

  if (yearsDiff >= 0) {
    // Delayed: 8% per year after FRA, capped at age 70
    const delayedYears = Math.min(yearsDiff, 70 - fullRetirementAge);
    return fraMonthlyBenefit * (1 + 0.08 * delayedYears);
  }

  // Early: different rates depending on how early
  const yearsEarly = Math.abs(yearsDiff);
  const firstThreeYears = Math.min(yearsEarly, 3);
  const additionalYears = Math.max(0, yearsEarly - 3);
  const reduction = firstThreeYears * (5 / 9 / 100) * 12 + additionalYears * (5 / 12 / 100) * 12;
  return fraMonthlyBenefit * (1 - reduction);
}

// Present value of lifetime SS benefits
export function calculateLifetimeBenefit(
  monthlyBenefit: number,
  claimAge: number,
  lifeExpectancy: number,
  discountRate = 0.03
): number {
  const annualBenefit = monthlyBenefit * 12;
  const years = Math.max(0, lifeExpectancy - claimAge);
  // PV of annuity: PV = PMT * (1 - (1+r)^-n) / r
  if (discountRate === 0) return annualBenefit * years;
  return annualBenefit * ((1 - Math.pow(1 + discountRate, -years)) / discountRate);
}

export function buildSocialSecurityComparison(
  clientFraMonthlyBenefit: number,
  clientFullRetirementAge: number,
  clientLifeExpectancy: number,
  spouseFraMonthlyBenefit: number | null,
  spouseFullRetirementAge: number | null,
  spouseLifeExpectancy: number | null,
  claimAgeRangeMin = 62,
  claimAgeRangeMax = 70
): SocialSecurityComparison {
  const options: SocialSecurityOption[] = [];

  // Test a few representative claim ages rather than every year
  const testAges = [62, 64, 65, 66, 67, 68, 69, 70].filter(
    (a) => a >= claimAgeRangeMin && a <= claimAgeRangeMax
  );

  let earliestLifetime = 0;

  for (const clientAge of testAges) {
    const clientMonthly = calculateBenefitAtClaimAge(
      clientFraMonthlyBenefit,
      clientFullRetirementAge,
      clientAge
    );
    const clientLifetime = calculateLifetimeBenefit(clientMonthly, clientAge, clientLifeExpectancy);

    let spouseMonthly: number | null = null;
    let spouseLifetime: number | null = null;

    if (spouseFraMonthlyBenefit && spouseFullRetirementAge && spouseLifeExpectancy) {
      // Spouse claims at same age for simplicity; could be parameterized
      spouseMonthly = calculateBenefitAtClaimAge(
        spouseFraMonthlyBenefit,
        spouseFullRetirementAge,
        clientAge
      );
      spouseLifetime = calculateLifetimeBenefit(spouseMonthly, clientAge, spouseLifeExpectancy);
    }

    const combined = clientLifetime + (spouseLifetime ?? 0);
    if (options.length === 0) earliestLifetime = combined;

    options.push({
      label: `Claim at ${clientAge}`,
      clientClaimAge: clientAge,
      spouseClaimAge: spouseFraMonthlyBenefit ? clientAge : null,
      clientMonthlyBenefit: clientMonthly,
      spouseMonthlyBenefit: spouseMonthly,
      lifetimeBenefitClient: clientLifetime,
      lifetimeBenefitSpouse: spouseLifetime,
      lifetimeBenefitCombined: combined,
      breakEvenAgeVsEarliest: options.length === 0 ? null : Math.round(clientAge + 8), // rough heuristic
    });
  }

  // Recommend the option with the highest combined lifetime benefit
  const recommended = options.reduce(
    (best, opt, idx) =>
      opt.lifetimeBenefitCombined > best.option.lifetimeBenefitCombined
        ? { option: opt, idx }
        : best,
    { option: options[0], idx: 0 }
  );

  return {
    options,
    recommendedOptionIndex: recommended.idx,
    lifetimeBenefitDifferenceVsEarliest:
      recommended.option.lifetimeBenefitCombined - earliestLifetime,
    taxEfficiencyNote:
      'Delaying SS reduces taxable income in early retirement, supporting ACA subsidy eligibility.',
  };
}
