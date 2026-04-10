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
import { FEDERAL_INCOME_TAX_BRACKETS_2025, STANDARD_DEDUCTION_2025, getBracketCeiling } from '../constants/tax-brackets';
import { getAcaCliff } from '../constants/aca-thresholds';
import { RMD_START_AGE } from '../constants/rmd-tables';
import { getStateInfo } from '../constants/states';

const DEFAULT_GROWTH_RATE = 0.07;

export function runSimulation(
  profile: ClientProfile,
  assets: AssetSnapshot,
  spending: SpendingProfile,
  guardrails: GuardrailConfig,
  scenarioType: ScenarioType
): ScenarioResult {
  const growthRate = profile.annualGrowthRate ?? DEFAULT_GROWTH_RATE;
  const householdSize = profile.acaHouseholdSize ?? 2;
  const stateRate = profile.hasStateIncomeTax
    ? (getStateInfo(profile.stateOfResidence)?.topMarginalRate ?? 0)
    : 0;

  // Engine selection is deferred — see below after accumulation phase.

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

  // Accumulation phase: grow balances year-by-year, adding annual contributions each year.
  // This models the reality of ongoing 401k/Roth/brokerage deposits during working years.
  // Without contributions, the engine only compounds current balances — understating retirement assets.
  const contrib = profile.annualContributions;
  let pretaxBalance = assets.totalPretax;
  let rothBalance = assets.totalRoth;
  let brokerageBalance = assets.totalBrokerage;
  let inheritedIraBalance = assets.totalInheritedIra;
  let hsaBalance = assets.totalHsa;

  for (let y = 0; y < workingYears; y++) {
    pretaxBalance    = (pretaxBalance    + (contrib?.pretax    ?? 0)) * (1 + growthRate);
    rothBalance      = (rothBalance      + (contrib?.roth      ?? 0)) * (1 + growthRate);
    brokerageBalance = (brokerageBalance + (contrib?.brokerage ?? 0)) * (1 + growthRate);
    inheritedIraBalance = inheritedIraBalance * (1 + growthRate);
    hsaBalance          = hsaBalance          * (1 + growthRate);
  }

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

  // Resolve effective engine — done after accumulation so we can inspect projected balances.
  // auto (default):
  //   1. conversion_primary if targetBracket is set (user is targeting a bracket ceiling)
  //   2. conversion_primary if no brokerage at retirement — surplus-driven conversions require
  //      brokerage; without it, withdrawal_sequencing silently produces zero conversions for
  //      profiles that are entirely pre-tax (e.g. a user: $0 brokerage throughout).
  //   3. withdrawal_sequencing otherwise
  const effectiveEngine: 'withdrawal_sequencing' | 'conversion_primary' =
    profile.spendingEngine === 'conversion_primary'
      ? 'conversion_primary'
      : profile.spendingEngine === 'withdrawal_sequencing'
      ? 'withdrawal_sequencing'
      : profile.targetBracket != null
      ? 'conversion_primary'
      : projectedAssets.totalBrokerage === 0 && projectedAssets.totalPretax > 0
      ? 'conversion_primary'
      : 'withdrawal_sequencing';

  // The projected portfolio and SS are in nominal retirement-year dollars (grown at nominal rate).
  // spending.baseAnnualSpending is in today's (current-year) real dollars.
  // To compare apples-to-apples, deflate the projected portfolio and SS back to real terms
  // before computing spending capacity. Without this, a 15-year runway at 9% nominal makes the
  // capacity look ~1.56× larger than the real purchasing power actually is.
  const inflationAtRetirement = Math.pow(1 + spending.inflationRate, workingYears);
  const realProjectedLiquid = projectedAssets.totalLiquid / inflationAtRetirement;
  const realProjectedAssets = { ...projectedAssets, totalLiquid: realProjectedLiquid };
  const realProjectedAnnualSS = projectedAnnualSS / inflationAtRetirement;

  const capacityResult = calculateSpendingCapacity(
    realProjectedAssets,
    spending,
    guardrails,
    yearsInRetirement,
    realProjectedAnnualSS
  );

  // Desired spending = essential base only (matches the advisor reference model).
  // Mortgage, travel, and charitable are modeled year-by-year in the projection loop.
  const desiredSpending = spending.baseAnnualSpending;
  const yearlyProjections: YearlyProjection[] = [];
  const stdDeduction = STANDARD_DEDUCTION_2025[profile.filingStatus];

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
    const inflationFactor = Math.pow(1 + spending.inflationRate, yearIndex);

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

    const oneTimeExpense = spending.oneTimeExpenses.find((e) => e.year === year)?.amount ?? 0;
    const annualSpending =
      (spending.baseAnnualSpending + travelBudget + spending.charitableGivingAnnual) * inflationFactor
      + mortgagePayment
      + healthcareOverflow
      + oneTimeExpense;

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
    // SS kept at nominal claim-age amount (no automatic COLA applied).
    // Conservative: real purchasing power of SS declines with inflation.
    // Matches the reference video model and is appropriate for stress-testing.
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

      // Bracket-ceiling conversion: fill exactly to the target bracket in real 2025 dollars.
      // Formula: nominalMagiCapacity = (bracketCeiling + stdDeduction) × inflationFactor
      //          conversionAmount     = nominalMagiCapacity − RMD − SS_includable − inheritedDist
      // This automatically:
      //   - adjusts for inflation (inflationFactor grows the nominal target each year)
      //   - shrinks the conversion as SS phases in (SS includable eats bracket headroom)
      //   - shrinks further as RMDs start at 73 (RMD displaces discretionary conversion)
      const ssIncludable = totalSSAnnual * 0.85;
      const bracketCeiling = getBracketCeiling(
        profile.targetBracket ?? '22%',
        profile.filingStatus,
        FEDERAL_INCOME_TAX_BRACKETS_2025
      );
      const nominalMagiCapacity = (bracketCeiling + stdDeduction) * inflationFactor;
      const conversionTarget = Math.max(0, nominalMagiCapacity - rmd - ssIncludable - inheritedDist);
      const conversionAmount = Math.min(conversionTarget, pretaxBalance);

      // MAGI = conversion + RMD + SS (85% includable) + inherited IRA distributions
      const magiBase = conversionAmount + rmd + ssIncludable + inheritedDist;

      // Deflate nominal MAGI to 2025 real dollars, subtract standard deduction, calculate
      // tax in real terms, then scale back to nominal. Models IRS bracket inflation-indexing.
      const realMagi = magiBase / inflationFactor;
      const realTaxableIncome = Math.max(0, realMagi - stdDeduction);
      const realTax = calculateOrdinaryIncomeTax(realTaxableIncome, profile.filingStatus, FEDERAL_INCOME_TAX_BRACKETS_2025);
      const totalTax = realTax * inflationFactor;
      const marginalRate = getMarginalRate(realTaxableIncome, profile.filingStatus, FEDERAL_INCOME_TAX_BRACKETS_2025);

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

      // State tax: most states don't tax SS; applied to non-SS income at top marginal rate
      const stateTaxBase = Math.max(0, magi - totalSSAnnual * 0.85);
      const stateTax = stateTaxBase * stateRate;
      const taxLiability: TaxLiability = {
        ordinaryIncomeTax: 0, // all tax is on the conversion
        capitalGainsTax: 0,
        rothConversionTax: totalTax,
        totalFederalTax: totalTax,
        stateTax,
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
        pretaxEndBalance: pretaxBalance,
        rothEndBalance: rothBalance,
        brokerageEndBalance: brokerageBalance,
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

      if ((season === 'cobra' || season === 'international' || season === 'medicare' || season === 'rmd') && pretaxBalance > 0) {
        const surplus = capacityResult.spendingCapacity - spending.baseAnnualSpending;
        const TARGET_BRACKET_CEILING = getBracketCeiling(
          profile.targetBracket ?? '22%',
          profile.filingStatus,
          FEDERAL_INCOME_TAX_BRACKETS_2025
        );
        rothConversion = calculateRothConversion({
          currentMAGI: magi,
          surplusSpendingCapacity: Math.max(0, surplus),
          targetAmount: undefined,
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

      // Deflate to 2025 real dollars, subtract standard deduction, scale tax back to nominal.
      const realMagiWC = magiWithConversion / inflationFactor;
      const realTaxableWC = Math.max(0, realMagiWC - stdDeduction);
      const ordinaryIncomeTax = calculateOrdinaryIncomeTax(
        realTaxableWC,
        profile.filingStatus,
        FEDERAL_INCOME_TAX_BRACKETS_2025
      ) * inflationFactor;
      const rothConversionTax = rothConversion?.taxOnConversion ?? 0;

      const stateTaxBase = Math.max(0, magi - totalSSAnnual * 0.85);
      const stateTax = stateTaxBase * stateRate;
      const taxLiability: TaxLiability = {
        ordinaryIncomeTax,
        capitalGainsTax: 0,
        rothConversionTax,
        totalFederalTax: ordinaryIncomeTax + rothConversionTax,
        stateTax,
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
        pretaxEndBalance: pretaxBalance,
        rothEndBalance: rothBalance,
        brokerageEndBalance: brokerageBalance,
        magi,
        acaSubsidyEligible: acaResult?.eligible ?? false,
        estimatedAcaSavings: acaResult?.estimatedAnnualSavings ?? 0,
        irmaaApplies: irmaaSurcharge > 0,
        irmaaSurcharge,
      });
    }
  }

  // Post-simulation probability adjustment for pre-SS portfolio depletion.
  //
  // The baseline formula in calculateSpendingCapacity treats SS as immediately available,
  // which overstates probability for early retirees with long SS gaps. Example: retiring at
  // 39 with SS at 67 and a $730k portfolio — the formula says 99% but the simulation shows
  // the portfolio hits $0 at age 49, 18 years before SS starts.
  //
  // Fix: inspect the actual projection. If the portfolio depletes during the pre-SS window,
  // cap probability based on how early it happens (earlier = worse = lower cap).
  //   depletes at year 0 of N pre-SS years → cap at ~50%
  //   depletes at year N-1 of N pre-SS years → cap at ~85%
  const preSsYears = yearlyProjections.filter(
    (y) => y.income.socialSecurityClient === 0 && y.income.socialSecuritySpouse === 0
  );
  let finalProbability = capacityResult.probabilityOfSuccess;
  if (preSsYears.length > 0) {
    const depletionIndex = preSsYears.findIndex((y) => y.portfolioEndBalance <= 0);
    if (depletionIndex >= 0) {
      const depletionFraction = depletionIndex / preSsYears.length;
      const probabilityCap = 0.50 + depletionFraction * 0.35;
      finalProbability = Math.min(finalProbability, probabilityCap);
    }
  }

  return {
    scenarioType,
    retirementYear,
    spendingCapacity: capacityResult.spendingCapacity,
    preSsCapacity: capacityResult.preSsCapacity,
    desiredSpending,
    surplusOrDeficit: capacityResult.surplusOrDeficit,
    probabilityOfSuccess: finalProbability,
    lowerGuardrailDollarDrop: capacityResult.lowerGuardrailDollarDrop,
    lowerGuardrailSpendingCutDollars: capacityResult.lowerGuardrailSpendingCutDollars,
    yearlyProjections,
  };
}
