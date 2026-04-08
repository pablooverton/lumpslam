import type { ClientProfile } from '../types/profile';
import type { AssetSnapshot } from '../types/assets';
import type { SpendingProfile } from '../types/spending';
import type { GuardrailConfig, ScenarioResult, ScenarioType } from '../types/scenarios';
import type { YearlyProjection, IncomeBreakdown, WithdrawalBreakdown, TaxLiability, RothConversionEvent } from '../types/simulation';
import { classifySeasonForYear, calculateMAGI, assessAcaEligibility, calculateIrmaaSurcharge, getCobraWindowEnd } from './seasons';
import { calculateRothConversion } from './roth-conversion';
import { calculateRMD, projectInheritedIraDistributions } from './rmd';
import { calculateBenefitAtClaimAge } from './social-security';
import { calculateOrdinaryIncomeTax, getMarginalRate } from './tax-utils';
import { calculateSpendingCapacity } from './spending-capacity';
import { FEDERAL_INCOME_TAX_BRACKETS_2025 } from '../constants/tax-brackets';
import { getAcaCliff } from '../constants/aca-thresholds';
import { RMD_START_AGE } from '../constants/rmd-tables';

const DEFAULT_GROWTH_RATE = 0.07;
const INFLATION_RATE = 0.03;

export function runSimulation(
  profile: ClientProfile,
  assets: AssetSnapshot,
  spending: SpendingProfile,
  guardrails: GuardrailConfig,
  scenarioType: ScenarioType
): ScenarioResult {
  const growthRate = profile.annualGrowthRate ?? DEFAULT_GROWTH_RATE;
  const householdSize = profile.acaHouseholdSize ?? 2;

  // Resolve effective engine.
  // auto (default): conversion_primary when targetAnnualConversion is set, otherwise withdrawal_sequencing.
  const effectiveEngine: 'withdrawal_sequencing' | 'conversion_primary' =
    profile.spendingEngine === 'conversion_primary'
      ? 'conversion_primary'
      : profile.spendingEngine === 'withdrawal_sequencing'
      ? 'withdrawal_sequencing'
      : profile.targetAnnualConversion != null
      ? 'conversion_primary'
      : 'withdrawal_sequencing';

  const targetYear = profile.retirementYearDesired ?? profile.currentYear;
  const retirementYear =
    scenarioType === 'retire_now'
      ? profile.currentYear
      : scenarioType === 'retire_at_stated_date'
      ? targetYear
      : targetYear + 3; // "work 3 more years from your plan"

  const cobraEndYear = getCobraWindowEnd(retirementYear, profile.cobraMonths);

  const endYear =
    profile.currentYear +
    Math.max(
      profile.client.lifeExpectancy - profile.client.age,
      profile.spouse ? profile.spouse.lifeExpectancy - profile.spouse.age : 0
    );

  const yearsInRetirement = endYear - retirementYear;
  const workingYears = Math.max(0, retirementYear - profile.currentYear);
  const growthFactor = Math.pow(1 + growthRate, workingYears);

  let pretaxBalance = assets.totalPretax * growthFactor;
  let rothBalance = assets.totalRoth * growthFactor;
  let brokerageBalance = assets.totalBrokerage * growthFactor;
  let inheritedIraBalance = assets.totalInheritedIra * growthFactor;
  let hsaBalance = assets.totalHsa * growthFactor;

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

  const projectedAssets = {
    ...assets,
    totalPretax: pretaxBalance,
    totalRoth: rothBalance,
    totalBrokerage: brokerageBalance,
    totalInheritedIra: inheritedIraBalance,
    totalHsa: hsaBalance,
    totalLiquid: pretaxBalance + rothBalance + brokerageBalance + inheritedIraBalance + hsaBalance,
  };
  const capacityResult = calculateSpendingCapacity(
    projectedAssets,
    spending,
    guardrails,
    yearsInRetirement,
    projectedAnnualSS
  );

  const desiredSpending = spending.baseAnnualSpending;
  const yearlyProjections: YearlyProjection[] = [];

  const inheritedAccount = assets.accounts.find((a) => a.type === 'inherited_ira');
  const originalRemainingYears = inheritedAccount?.inheritedIraRemainingYears ?? 10;
  const adjustedRemainingYears = Math.max(0, originalRemainingYears - workingYears);

  const inheritedDistributions = projectInheritedIraDistributions(
    inheritedIraBalance,
    adjustedRemainingYears,
    growthRate
  );

  for (let year = retirementYear; year <= endYear; year++) {
    const yearIndex = year - retirementYear;
    const clientAge = profile.client.age + (year - profile.currentYear);
    const spouseAge = profile.spouse
      ? profile.spouse.age + (year - profile.currentYear)
      : null;

    if (
      clientAge > profile.client.lifeExpectancy &&
      (spouseAge === null || spouseAge > (profile.spouse?.lifeExpectancy ?? 0))
    ) break;

    const season = classifySeasonForYear(year, profile, cobraEndYear);
    const inflationFactor = Math.pow(1 + INFLATION_RATE, yearIndex);

    const travelBudget =
      clientAge >= spending.travelTaperStartAge
        ? spending.travelBudgetLate
        : spending.travelBudgetEarly;

    const mortgagePayment =
      (spending.mortgageAnnualPayment ?? 0) > 0 &&
      spending.mortgagePaidOffAge !== undefined &&
      clientAge <= spending.mortgagePaidOffAge
        ? spending.mortgageAnnualPayment!
        : 0;

    // HSA covers healthcare costs first; overflow hits spending pool
    const rawHealthcareCost = (spending.annualHealthcareCost ?? 0) * inflationFactor;
    const fromHsa = Math.min(rawHealthcareCost, hsaBalance);
    const healthcareOverflow = rawHealthcareCost - fromHsa;

    const annualSpending =
      (spending.baseAnnualSpending + travelBudget + spending.charitableGivingAnnual) * inflationFactor
      + mortgagePayment
      + healthcareOverflow;

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

    const rmd = clientAge >= RMD_START_AGE ? calculateRMD(pretaxBalance, clientAge) : 0;
    const inheritedDist = inheritedDistributions[yearIndex] ?? 0;

    const income: IncomeBreakdown = {
      socialSecurityClient: ssClientAnnual,
      socialSecuritySpouse: ssSpouseAnnual,
      requiredMinimumDistribution: rmd,
      inheritedIraDistribution: inheritedDist,
      otherIncome: 0,
      total: ssClientAnnual + ssSpouseAnnual + rmd + inheritedDist,
    };

    // ─── Per-year logic branches on engine ───────────────────────────────────

    let withdrawals: WithdrawalBreakdown;
    let magi: number;
    let rothConversion: RothConversionEvent | null = null;

    if (effectiveEngine === 'conversion_primary') {
      // ── Conversion-Primary Engine ──────────────────────────────────────────
      // The Roth conversion IS the income mechanism. Pretax only moves as conversion.
      // Taxes and all spending are funded from Roth. MAGI = conversion + SS only.
      //
      // Best for: no-brokerage, high pre-tax balance, $242k/yr engine strategies.
      // Matches the elective-conversion plan: pretax → Roth ($242k), Roth pays taxes + living.

      const targetConv = profile.targetAnnualConversion ?? 0;

      // RMD is forced at age 73+; net conversion target is reduced so total pretax
      // depletion = rmd + conversionAmount ≈ targetConv.
      const conversionTarget = Math.max(0, targetConv - rmd);
      const conversionAmount = Math.min(conversionTarget, pretaxBalance);

      // MAGI = conversion + RMD + SS (85% includable) + inherited IRA distributions
      const magiBase = conversionAmount + rmd + totalSSAnnual * 0.85 + inheritedDist;

      // Total income tax on this MAGI (covers both conversion tax and SS/RMD tax)
      const totalTax = calculateOrdinaryIncomeTax(magiBase, profile.filingStatus, FEDERAL_INCOME_TAX_BRACKETS_2025);
      const marginalRate = getMarginalRate(magiBase, profile.filingStatus, FEDERAL_INCOME_TAX_BRACKETS_2025);

      // Roth funds spending net of SS income (SS directly offsets spending needs)
      const rothSpendingDraw = Math.max(0, annualSpending - totalSSAnnual);

      // If Roth can't cover spending + taxes, draw emergency amount from pretax
      const totalRothNeed = totalTax + rothSpendingDraw;
      const rothAvailable = rothBalance + conversionAmount; // Roth balance after conversion in
      const emergencyPretaxDraw = Math.max(0, totalRothNeed - rothAvailable);

      magi = magiBase;

      rothConversion = {
        conversionAmount,
        marginalRate,
        taxOnConversion: totalTax,
        brokerageFundingAmount: 0,
        rothFundingAmount: totalTax, // taxes paid from Roth
      };

      withdrawals = {
        fromPretax: rmd + emergencyPretaxDraw, // only RMD and emergency; spending is from Roth
        fromBrokerage: 0,
        fromRoth: rothSpendingDraw,
        total: rmd + emergencyPretaxDraw + rothSpendingDraw,
      };

      // Portfolio updates
      const portfolioStart = pretaxBalance + rothBalance + brokerageBalance + inheritedIraBalance + hsaBalance;

      pretaxBalance = Math.max(0, pretaxBalance - rmd - emergencyPretaxDraw - conversionAmount);
      // Roth: gains conversion, pays taxes and spending
      rothBalance = Math.max(0, rothBalance + conversionAmount - totalTax - rothSpendingDraw);
      inheritedIraBalance = Math.max(0, inheritedIraBalance - inheritedDist);
      hsaBalance = Math.max(0, hsaBalance - fromHsa);

      pretaxBalance *= 1 + growthRate;
      brokerageBalance *= 1 + growthRate;
      rothBalance *= 1 + growthRate;
      inheritedIraBalance *= 1 + growthRate;
      hsaBalance *= 1 + growthRate;

      const portfolioEnd = pretaxBalance + rothBalance + brokerageBalance + inheritedIraBalance + hsaBalance;

      // ACA eligibility uses conversion-driven MAGI (may be over cliff — expected for this strategy)
      const acaResult = season === 'aca' ? assessAcaEligibility(magi, householdSize) : null;
      const irmaaSurcharge =
        season === 'medicare' || season === 'rmd'
          ? calculateIrmaaSurcharge(magi, profile.filingStatus)
          : 0;

      const taxLiability: TaxLiability = {
        ordinaryIncomeTax: 0, // all tax is on the conversion
        capitalGainsTax: 0,
        rothConversionTax: totalTax,
        totalFederalTax: totalTax,
        effectiveRate: magi > 0 ? totalTax / magi : 0,
      };

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
        magi,
        acaSubsidyEligible: acaResult?.eligible ?? false,
        estimatedAcaSavings: acaResult?.estimatedAnnualSavings ?? 0,
        irmaaApplies: irmaaSurcharge > 0,
        irmaaSurcharge,
      });

    } else {
      // ── Withdrawal-Sequencing Engine (original) ────────────────────────────
      // Draw from accounts in sequence to cover the spending gap, then convert
      // surplus bracket capacity to Roth. Tax paid from brokerage when available.
      //
      // Best for: brokerage-backed strategies, ACA cliff optimization.

      const incomeGap = Math.max(0, annualSpending - income.total);
      const nonEssentialSpend =
        (travelBudget + spending.charitableGivingAnnual) * inflationFactor;

      let fromBrokerage = 0;
      let fromPretax = 0;
      let fromRoth = 0;

      if (season === 'cobra' || season === 'international') {
        fromBrokerage = Math.min(nonEssentialSpend, brokerageBalance, incomeGap);
        const remainingGap = incomeGap - fromBrokerage;
        fromPretax = Math.min(remainingGap, pretaxBalance);
        fromRoth = Math.max(0, remainingGap - fromPretax);
      } else if (season === 'aca') {
        const ACA_CLIFF = getAcaCliff(householdSize);
        const passiveMagi = inheritedDist + totalSSAnnual * 0.85;
        const pretaxMagiCapacity = Math.max(0, ACA_CLIFF - passiveMagi - 1);
        fromBrokerage = Math.min(incomeGap, brokerageBalance);
        const afterBrokerage = incomeGap - fromBrokerage;
        fromPretax = Math.min(afterBrokerage, pretaxBalance, pretaxMagiCapacity);
        const afterPretax = afterBrokerage - fromPretax;
        fromRoth = Math.min(afterPretax, rothBalance);
      } else {
        fromPretax = Math.min(incomeGap, pretaxBalance);
        const remainingGap = incomeGap - fromPretax;
        fromBrokerage = Math.min(remainingGap, brokerageBalance);
        fromRoth = Math.max(0, remainingGap - fromBrokerage);
      }

      withdrawals = {
        fromPretax: fromPretax + rmd,
        fromBrokerage,
        fromRoth,
        total: fromPretax + rmd + fromBrokerage + fromRoth,
      };

      magi = calculateMAGI({
        socialSecurityIncludable: totalSSAnnual * 0.85,
        pretaxWithdrawals: fromPretax + rmd,
        rothConversionAmount: 0,
        capitalGainsRealized: 0,
        otherIncome: inheritedDist,
      });

      if ((season === 'cobra' || season === 'international' || season === 'medicare') && pretaxBalance > 0) {
        const surplus = capacityResult.spendingCapacity - spending.baseAnnualSpending;
        const TARGET_BRACKET_CEILING =
          profile.filingStatus === 'married_filing_jointly' ? 206_700 : 103_350;
        rothConversion = calculateRothConversion({
          currentMAGI: magi,
          surplusSpendingCapacity: Math.max(0, surplus),
          targetAmount: profile.targetAnnualConversion,
          pretaxBalance,
          brokerageBalance,
          filingStatus: profile.filingStatus,
          targetBracketCeiling: TARGET_BRACKET_CEILING,
        });
      }

      const magiWithConversion = magi + (rothConversion?.conversionAmount ?? 0);

      const acaResult = season === 'aca'
        ? assessAcaEligibility(magiWithConversion, householdSize)
        : null;
      const irmaaSurcharge =
        season === 'medicare' || season === 'rmd'
          ? calculateIrmaaSurcharge(magiWithConversion, profile.filingStatus)
          : 0;

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

      magi = magiWithConversion;

      const portfolioStart =
        pretaxBalance + rothBalance + brokerageBalance + inheritedIraBalance + hsaBalance;

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
        rothBalance
          - withdrawals.fromRoth
          + (rothConversion?.conversionAmount ?? 0)
          - (rothConversion?.rothFundingAmount ?? 0)
      );
      inheritedIraBalance = Math.max(0, inheritedIraBalance - inheritedDist);
      hsaBalance = Math.max(0, hsaBalance - fromHsa);

      pretaxBalance *= 1 + growthRate;
      brokerageBalance *= 1 + growthRate;
      rothBalance *= 1 + growthRate;
      inheritedIraBalance *= 1 + growthRate;
      hsaBalance *= 1 + growthRate;

      const portfolioEnd =
        pretaxBalance + rothBalance + brokerageBalance + inheritedIraBalance + hsaBalance;

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
        magi,
        acaSubsidyEligible: acaResult?.eligible ?? false,
        estimatedAcaSavings: acaResult?.estimatedAnnualSavings ?? 0,
        irmaaApplies: irmaaSurcharge > 0,
        irmaaSurcharge,
      });
    }
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
