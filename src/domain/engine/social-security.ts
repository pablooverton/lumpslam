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

// Break-even age: the age at which cumulative benefits from a later claim equal the earlier claim.
// Formula: T = (ageLater * monthlyLater - ageEarlier * monthlyEarlier) / (monthlyLater - monthlyEarlier)
// Returns null if the later option never catches up (same or lower monthly benefit).
function computeBreakEven(
  ageEarlier: number,
  monthlyEarlier: number,
  ageLater: number,
  monthlyLater: number
): number | null {
  if (monthlyLater <= monthlyEarlier) return null;
  return (ageLater * monthlyLater - ageEarlier * monthlyEarlier) / (monthlyLater - monthlyEarlier);
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

  // Test representative claim ages
  const testAges = [62, 64, 65, 66, 67, 68, 69, 70].filter(
    (a) => a >= claimAgeRangeMin && a <= claimAgeRangeMax
  );

  let earliestLifetime = 0;
  let earliestClientMonthly: number | null = null;
  let earliestClientAge: number | null = null;

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
      // Standard options: both claim at the same age
      spouseMonthly = calculateBenefitAtClaimAge(
        spouseFraMonthlyBenefit,
        spouseFullRetirementAge,
        clientAge
      );
      spouseLifetime = calculateLifetimeBenefit(spouseMonthly, clientAge, spouseLifeExpectancy);
    }

    const combined = clientLifetime + (spouseLifetime ?? 0);
    if (earliestClientMonthly === null) {
      earliestLifetime = combined;
      earliestClientMonthly = clientMonthly;
      earliestClientAge = clientAge;
    }

    const breakEven =
      earliestClientMonthly === null || earliestClientAge === null || options.length === 0
        ? null
        : computeBreakEven(earliestClientAge, earliestClientMonthly, clientAge, clientMonthly);

    options.push({
      label: `Claim at ${clientAge}`,
      clientClaimAge: clientAge,
      spouseClaimAge: spouseFraMonthlyBenefit ? clientAge : null,
      clientMonthlyBenefit: clientMonthly,
      spouseMonthlyBenefit: spouseMonthly,
      lifetimeBenefitClient: clientLifetime,
      lifetimeBenefitSpouse: spouseLifetime,
      lifetimeBenefitCombined: combined,
      breakEvenAgeVsEarliest: breakEven,
    });
  }

  // ── Couple survivor strategy ───────────────────────────────────────────────
  // Bogleheads consensus: higher earner delays to 70 to maximize survivor benefit;
  // lower earner can claim at 62 to generate income during the delay window.
  // This strategy often wins on combined lifetime value AND provides longevity insurance.
  if (spouseFraMonthlyBenefit && spouseFullRetirementAge && spouseLifeExpectancy) {
    const clientIsHigher = clientFraMonthlyBenefit >= spouseFraMonthlyBenefit;

    const higherFraMonthly  = clientIsHigher ? clientFraMonthlyBenefit   : spouseFraMonthlyBenefit;
    const higherFRA         = clientIsHigher ? clientFullRetirementAge   : spouseFullRetirementAge;
    const higherLifeExp     = clientIsHigher ? clientLifeExpectancy      : spouseLifeExpectancy;
    const higherMonthly70   = calculateBenefitAtClaimAge(higherFraMonthly, higherFRA, 70);

    const lowerFraMonthly   = clientIsHigher ? spouseFraMonthlyBenefit   : clientFraMonthlyBenefit;
    const lowerFRA          = clientIsHigher ? spouseFullRetirementAge   : clientFullRetirementAge;
    const lowerLifeExp      = clientIsHigher ? spouseLifeExpectancy      : clientLifeExpectancy;
    const lowerMonthly62    = calculateBenefitAtClaimAge(lowerFraMonthly, lowerFRA, 62);

    const survivorClientMonthly = clientIsHigher ? higherMonthly70 : lowerMonthly62;
    const survivorSpouseMonthly = clientIsHigher ? lowerMonthly62  : higherMonthly70;
    const survivorClientAge     = clientIsHigher ? 70              : 62;
    const survivorSpouseAge     = clientIsHigher ? 62              : 70;

    const survivorClientPV = calculateLifetimeBenefit(survivorClientMonthly, survivorClientAge, clientLifeExpectancy);
    const survivorSpousePV = calculateLifetimeBenefit(survivorSpouseMonthly, survivorSpouseAge, spouseLifeExpectancy);

    options.push({
      label: clientIsHigher
        ? 'Survivor Strategy: Client at 70 / Spouse at 62'
        : 'Survivor Strategy: Spouse at 70 / Client at 62',
      clientClaimAge:       survivorClientAge,
      spouseClaimAge:       survivorSpouseAge,
      clientMonthlyBenefit: survivorClientMonthly,
      spouseMonthlyBenefit: survivorSpouseMonthly,
      lifetimeBenefitClient:   survivorClientPV,
      lifetimeBenefitSpouse:   survivorSpousePV,
      lifetimeBenefitCombined: survivorClientPV + survivorSpousePV,
      breakEvenAgeVsEarliest:  null,
      isSurvivorStrategy: true,
    });
  }

  // ── Recommendation ────────────────────────────────────────────────────────
  // Couples: always recommend survivor strategy (higher earner to 70 maximizes survivor payout).
  // Singles: recommend max PV option.
  let recommendedIdx: number;

  const survivorIdx = options.findIndex((o) => o.isSurvivorStrategy);
  if (survivorIdx >= 0) {
    recommendedIdx = survivorIdx;
  } else {
    recommendedIdx = options.reduce(
      (bestIdx, opt, idx) =>
        opt.lifetimeBenefitCombined > options[bestIdx].lifetimeBenefitCombined ? idx : bestIdx,
      0
    );
  }

  const rec = options[recommendedIdx];

  let taxEfficiencyNote: string;
  if (rec.isSurvivorStrategy) {
    taxEfficiencyNote =
      'Survivor strategy: when the higher earner dies, the survivor keeps whichever SS benefit is larger. ' +
      'Delaying the larger benefit to 70 maximizes this lifetime floor — often worth far more than the PV math alone shows.';
  } else {
    const breakEven = rec.breakEvenAgeVsEarliest;
    const beStr = breakEven != null
      ? ` Break-even vs. claiming at 62: age ${Math.round(breakEven)}.`
      : '';
    taxEfficiencyNote =
      `Each year of delay after FRA earns an 8% guaranteed credit — among the best risk-free returns available.${beStr}` +
      ' Delaying also keeps early-retirement income lower, supporting ACA subsidy eligibility.';
  }

  return {
    options,
    recommendedOptionIndex: recommendedIdx,
    lifetimeBenefitDifferenceVsEarliest:
      rec.lifetimeBenefitCombined - earliestLifetime,
    taxEfficiencyNote,
  };
}
