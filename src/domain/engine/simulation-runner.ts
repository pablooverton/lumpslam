import type { ClientProfile } from '../types/profile';
import type { AssetSnapshot } from '../types/assets';
import type { SpendingProfile } from '../types/spending';
import type { GuardrailConfig, ScenarioResult, ScenarioType } from '../types/scenarios';
import type { YearlyProjection, IncomeBreakdown, WithdrawalBreakdown, TaxLiability } from '../types/simulation';
import { classifySeasonForYear, calculateMAGI, assessAcaEligibility, calculateIrmaaSurcharge, getCobraWindowEnd } from './seasons';
import { calculateRothConversion } from './roth-conversion';
import { calculateRMD, projectInheritedIraDistributions } from './rmd';
import { calculateBenefitAtClaimAge } from './social-security';
import { calculateOrdinaryIncomeTax } from './tax-utils';
import { calculateSpendingCapacity } from './spending-capacity';
import { FEDERAL_INCOME_TAX_BRACKETS_2025 } from '../constants/tax-brackets';
import { RMD_START_AGE } from '../constants/rmd-tables';

const NOMINAL_GROWTH_RATE = 0.07;
const INFLATION_RATE = 0.03;

export function runSimulation(
  profile: ClientProfile,
  assets: AssetSnapshot,
  spending: SpendingProfile,
  guardrails: GuardrailConfig,
  scenarioType: ScenarioType
): ScenarioResult {
  const retirementYear =
    scenarioType === 'retire_now'
      ? profile.currentYear
      : scenarioType === 'retire_at_stated_date'
      ? (profile.retirementYearDesired ?? profile.currentYear)
      : profile.currentYear + 5; // 'no_change' — work 5 more years as fallback

  const cobraEndYear = getCobraWindowEnd(retirementYear, profile.cobraMonths);

  const endYear =
    profile.currentYear +
    Math.max(
      profile.client.lifeExpectancy - profile.client.age,
      profile.spouse ? profile.spouse.lifeExpectancy - profile.spouse.age : 0
    );

  const yearsInRetirement = endYear - retirementYear;

  // Project portfolio forward from today to retirement year.
  // Scenarios that retire later (e.g. 'retire_at_stated_date' in 12 years) get a
  // larger starting portfolio — this is the core difference between scenarios.
  const workingYears = Math.max(0, retirementYear - profile.currentYear);
  const growthFactor = Math.pow(1 + NOMINAL_GROWTH_RATE, workingYears);

  let pretaxBalance = assets.totalPretax * growthFactor;
  let rothBalance = assets.totalRoth * growthFactor;
  let brokerageBalance = assets.totalBrokerage * growthFactor;
  let inheritedIraBalance = assets.totalInheritedIra * growthFactor;

  // Project SS income at claim ages — this is what the portfolio doesn't need to fund
  const clientSSMonthly = calculateBenefitAtClaimAge(
    profile.client.fraMonthlyBenefit,
    profile.client.fullRetirementAge,
    profile.client.socialSecurityClaimAge
  );
  const spouseSSMonthly = profile.spouse
    ? calculateBenefitAtClaimAge(
        profile.spouse.fraMonthlyBenefit,
        profile.spouse.fullRetirementAge,
        profile.spouse.socialSecurityClaimAge
      )
    : 0;
  const projectedAnnualSS = (clientSSMonthly + spouseSSMonthly) * 12;

  // Spending capacity is calculated against the projected (at-retirement) portfolio
  const projectedAssets = {
    ...assets,
    totalPretax: pretaxBalance,
    totalRoth: rothBalance,
    totalBrokerage: brokerageBalance,
    totalInheritedIra: inheritedIraBalance,
    totalLiquid: pretaxBalance + rothBalance + brokerageBalance + inheritedIraBalance,
  };
  const capacityResult = calculateSpendingCapacity(
    projectedAssets,
    spending,
    guardrails,
    yearsInRetirement,
    projectedAnnualSS
  );

  // desiredSpending for capacity comparison = essential spending only (matches video "$126k desired")
  const desiredSpending = spending.baseAnnualSpending;

  const yearlyProjections: YearlyProjection[] = [];

  // Inherited IRA 10-year rule: deduct working years already consumed
  const inheritedAccount = assets.accounts.find((a) => a.type === 'inherited_ira');
  const originalRemainingYears = inheritedAccount?.inheritedIraRemainingYears ?? 10;
  const adjustedRemainingYears = Math.max(0, originalRemainingYears - workingYears);

  const inheritedDistributions = projectInheritedIraDistributions(
    inheritedIraBalance,
    adjustedRemainingYears,
    NOMINAL_GROWTH_RATE
  );

  for (let year = retirementYear; year <= endYear; year++) {
    const yearIndex = year - retirementYear;
    const clientAge = profile.client.age + (year - profile.currentYear);
    const spouseAge = profile.spouse
      ? profile.spouse.age + (year - profile.currentYear)
      : null;

    // Skip if both have exceeded life expectancy
    if (
      clientAge > profile.client.lifeExpectancy &&
      (spouseAge === null || spouseAge > (profile.spouse?.lifeExpectancy ?? 0))
    ) break;

    const season = classifySeasonForYear(year, profile, cobraEndYear);

    // Spending (inflation-adjusted from retirement year)
    const inflationFactor = Math.pow(1 + INFLATION_RATE, yearIndex);
    const travelBudget =
      clientAge >= spending.travelTaperStartAge
        ? spending.travelBudgetLate
        : spending.travelBudgetEarly;

    // Mortgage: fixed nominal P&I payment — NOT inflation-adjusted.
    // A 30-yr fixed rate mortgage stays the same dollar amount regardless of inflation.
    // Stops once the client passes mortgagePaidOffAge.
    const mortgagePayment =
      (spending.mortgageAnnualPayment ?? 0) > 0 &&
      spending.mortgagePaidOffAge !== undefined &&
      clientAge <= spending.mortgagePaidOffAge
        ? spending.mortgageAnnualPayment!
        : 0;

    const annualSpending =
      (spending.baseAnnualSpending + travelBudget + spending.charitableGivingAnnual) * inflationFactor
      + mortgagePayment;

    // Social Security income
    const ssClientMonthly =
      clientAge >= profile.client.socialSecurityClaimAge
        ? calculateBenefitAtClaimAge(
            profile.client.fraMonthlyBenefit,
            profile.client.fullRetirementAge,
            profile.client.socialSecurityClaimAge
          )
        : 0;
    const ssSpouseMonthly =
      profile.spouse && spouseAge !== null && spouseAge >= profile.spouse.socialSecurityClaimAge
        ? calculateBenefitAtClaimAge(
            profile.spouse.fraMonthlyBenefit,
            profile.spouse.fullRetirementAge,
            profile.spouse.socialSecurityClaimAge
          )
        : 0;
    const ssClientAnnual = ssClientMonthly * 12;
    const ssSpouseAnnual = ssSpouseMonthly * 12;
    const totalSSAnnual = ssClientAnnual + ssSpouseAnnual;

    // RMD
    const rmd = clientAge >= RMD_START_AGE ? calculateRMD(pretaxBalance, clientAge) : 0;

    // Inherited IRA distribution
    const inheritedDist = inheritedDistributions[yearIndex] ?? 0;

    const income: IncomeBreakdown = {
      socialSecurityClient: ssClientAnnual,
      socialSecuritySpouse: ssSpouseAnnual,
      requiredMinimumDistribution: rmd,
      inheritedIraDistribution: inheritedDist,
      otherIncome: 0,
      total: ssClientAnnual + ssSpouseAnnual + rmd + inheritedDist,
    };

    // Withdrawals: cover spending gap after income
    const incomeGap = Math.max(0, annualSpending - income.total);
    let fromBrokerage = 0;
    let fromPretax = 0;
    let fromRoth = 0;

    // Non-essential spending (lifestyle + charitable) — comes from brokerage in COBRA to preserve bracket headroom for Roth conversions
    const nonEssentialSpend =
      (travelBudget + spending.charitableGivingAnnual) * inflationFactor;

    if (season === 'cobra') {
      // COBRA strategy: cover non-essential from brokerage first to keep pretax withdrawals
      // low enough to leave bracket headroom for Roth conversions.
      fromBrokerage = Math.min(nonEssentialSpend, brokerageBalance, incomeGap);
      const remainingGap = incomeGap - fromBrokerage;
      fromPretax = Math.min(remainingGap, pretaxBalance);
      fromRoth = Math.max(0, remainingGap - fromPretax);
    } else if (season === 'aca') {
      // ACA strategy: keep MAGI STRICTLY below the $84,600 ACA cliff (cliff is exclusive).
      // Inherited IRA distributions and SS (if any) already count toward MAGI.
      const ACA_CLIFF = 84_600;
      const passiveMagi = inheritedDist + totalSSAnnual * 0.85;
      // Subtract 1 so pretax + passiveMagi stays at most $84,599 (strictly < $84,600)
      const pretaxMagiCapacity = Math.max(0, ACA_CLIFF - passiveMagi - 1);

      // 1. Draw from brokerage (return-of-basis — no MAGI impact)
      fromBrokerage = Math.min(incomeGap, brokerageBalance);
      const afterBrokerage = incomeGap - fromBrokerage;

      // 2. Draw from pretax up to ACA MAGI cliff
      fromPretax = Math.min(afterBrokerage, pretaxBalance, pretaxMagiCapacity);
      const afterPretax = afterBrokerage - fromPretax;

      // 3. Draw from Roth if still short (no MAGI impact)
      fromRoth = Math.min(afterPretax, rothBalance);
    } else {
      // Medicare / RMD: pretax first, then brokerage, then Roth
      fromPretax = Math.min(incomeGap, pretaxBalance);
      const remainingGap = incomeGap - fromPretax;
      fromBrokerage = Math.min(remainingGap, brokerageBalance);
      fromRoth = Math.max(0, remainingGap - fromBrokerage);
    }

    const withdrawals: WithdrawalBreakdown = {
      fromPretax: fromPretax + rmd,
      fromBrokerage,
      fromRoth,
      total: fromPretax + rmd + fromBrokerage + fromRoth,
    };

    // MAGI calculation
    const magi = calculateMAGI({
      socialSecurityIncludable: totalSSAnnual * 0.85,
      pretaxWithdrawals: fromPretax + rmd,
      rothConversionAmount: 0, // will add conversion below
      capitalGainsRealized: 0,
      otherIncome: inheritedDist,
    });

    // Roth conversion (only in cobra and medicare seasons, not ACA or RMD)
    let rothConversion = null;
    if ((season === 'cobra' || season === 'medicare') && pretaxBalance > 0) {
      // Surplus = total spending capacity minus essential spending only.
      // Lifestyle/charitable spending doesn't reduce the Roth conversion opportunity.
      const surplus = capacityResult.spendingCapacity - spending.baseAnnualSpending;
      // Target: fill up to the 22% bracket ceiling (not just 12%) to maximize conversions
      const TARGET_BRACKET_CEILING =
        profile.filingStatus === 'married_filing_jointly' ? 206_700 : 103_350;
      rothConversion = calculateRothConversion({
        currentMAGI: magi,
        surplusSpendingCapacity: Math.max(0, surplus),
        pretaxBalance,
        brokerageBalance,
        filingStatus: profile.filingStatus,
        targetBracketCeiling: TARGET_BRACKET_CEILING,
      });
    }

    const magiWithConversion = magi + (rothConversion?.conversionAmount ?? 0);

    // ACA eligibility
    const acaResult = season === 'aca' ? assessAcaEligibility(magiWithConversion) : null;
    const irmaaSurcharge =
      season === 'medicare' || season === 'rmd'
        ? calculateIrmaaSurcharge(magiWithConversion, profile.filingStatus)
        : 0;

    // Tax
    const ordinaryIncomeTax = calculateOrdinaryIncomeTax(
      magiWithConversion,
      profile.filingStatus,
      FEDERAL_INCOME_TAX_BRACKETS_2025
    );
    const rothConversionTax = rothConversion?.taxOnConversion ?? 0;

    const taxLiability: TaxLiability = {
      ordinaryIncomeTax,
      capitalGainsTax: 0,
      rothConversionTax,
      totalFederalTax: ordinaryIncomeTax + rothConversionTax,
      effectiveRate:
        magiWithConversion > 0
          ? (ordinaryIncomeTax + rothConversionTax) / magiWithConversion
          : 0,
    };

    // Portfolio updates
    const portfolioStart =
      pretaxBalance + rothBalance + brokerageBalance + inheritedIraBalance;

    pretaxBalance = Math.max(
      0,
      pretaxBalance - withdrawals.fromPretax - (rothConversion?.conversionAmount ?? 0)
    );
    brokerageBalance = Math.max(
      0,
      brokerageBalance - withdrawals.fromBrokerage - (rothConversion?.brokerageFundingAmount ?? 0)
    );
    rothBalance = Math.max(
      0,
      rothBalance - withdrawals.fromRoth + (rothConversion?.conversionAmount ?? 0)
    );
    inheritedIraBalance = Math.max(0, inheritedIraBalance - inheritedDist);

    // Apply nominal growth to all accounts
    pretaxBalance *= 1 + NOMINAL_GROWTH_RATE;
    brokerageBalance *= 1 + NOMINAL_GROWTH_RATE;
    rothBalance *= 1 + NOMINAL_GROWTH_RATE;
    inheritedIraBalance *= 1 + NOMINAL_GROWTH_RATE;

    const portfolioEnd =
      pretaxBalance + rothBalance + brokerageBalance + inheritedIraBalance;

    yearlyProjections.push({
      year,
      clientAge,
      spouseAge,
      season,
      income,
      withdrawals,
      rothConversion,
      taxLiability,
      portfolioStartBalance: portfolioStart,
      portfolioEndBalance: portfolioEnd,
      magi: magiWithConversion,
      acaSubsidyEligible: acaResult?.eligible ?? false,
      estimatedAcaSavings: acaResult?.estimatedAnnualSavings ?? 0,
      irmaaApplies: irmaaSurcharge > 0,
      irmaaSurcharge,
    });
  }

  return {
    scenarioType,
    retirementYear,
    spendingCapacity: capacityResult.spendingCapacity,
    desiredSpending,
    surplusOrDeficit: capacityResult.surplusOrDeficit,
    probabilityOfSuccess: capacityResult.probabilityOfSuccess,
    lowerGuardrailDollarDrop: capacityResult.lowerGuardrailDollarDrop,
    lowerGuardrailSpendingCutDollars: capacityResult.lowerGuardrailSpendingCutDollars,
    yearlyProjections,
  };
}
