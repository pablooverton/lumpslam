import type { ClientProfile } from '../types/profile';
import type { AssetSnapshot } from '../types/assets';
import type { SpendingProfile } from '../types/spending';
import type { GuardrailConfig, LifetimeAggregates, ScenarioResult, ScenarioType, StrategyTotalsSummary } from '../types/scenarios';
import type { YearlyProjection, IncomeBreakdown, WithdrawalBreakdown, TaxLiability, RothConversionEvent } from '../types/simulation';
import { classifySeasonForYear, calculateMAGI, assessAcaEligibility, calculateIrmaaSurcharge, getCobraWindowEnd } from './seasons';
import { calculateRothConversion } from './roth-conversion';
import { calculateRMD, projectInheritedIraDistributions } from './rmd';
import { calculateBenefitAtClaimAge } from './social-security';
import { calculateOrdinaryIncomeTax, getMarginalRate } from './tax-utils';
import { calculateSpendingCapacity } from './spending-capacity';
import { resolveSavingsStrategy, aggregateStrategyTotals, type ResolvedYearAllocation } from './savings-strategy';
import { FEDERAL_INCOME_TAX_BRACKETS_2025, STANDARD_DEDUCTION_2025, getBracketCeiling } from '../constants/tax-brackets';
import { getAcaCliff } from '../constants/aca-thresholds';
import { RMD_START_AGE } from '../constants/rmd-tables';
import { getStateInfo } from '../constants/states';

// REAL growth rate default. Engine models everything in today's real dollars.
// 6% real ≈ 9% nominal at 3% inflation — Boglehead 60/40 baseline.
const DEFAULT_GROWTH_RATE = 0.06;

export function runSimulation(
  profile: ClientProfile,
  assets: AssetSnapshot,
  spending: SpendingProfile,
  guardrails: GuardrailConfig,
  scenarioType: ScenarioType,
  annualReturnSequence?: number[]  // Monte Carlo injection: per-year nominal returns during retirement. If omitted, uses flat annualGrowthRate.
): ScenarioResult {
  const baseGrowthRate = profile.annualGrowthRate ?? DEFAULT_GROWTH_RATE;
  // For backward compat: flat growthRate used in accumulation phase and as fallback
  const growthRate = baseGrowthRate;
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
  //
  // Two paths:
  //   1. profile.savingsStrategy — rule-based allocation of free cash flow (preferred for
  //      strategy-comparison work; see src/domain/engine/savings-strategy.ts).
  //   2. profile.annualContributions — flat per-year contributions (legacy path, backward compat).
  // If both are set, savingsStrategy takes precedence.
  const contrib = profile.annualContributions;
  let pretaxBalance = assets.totalPretax;
  let rothBalance = assets.totalRoth;
  let brokerageBalance = assets.totalBrokerage;
  let inheritedIraBalance = assets.totalInheritedIra;
  let hsaBalance = assets.totalHsa;

  // Tracked across accumulation years for lifetime-aggregate reporting.
  // Working-year conversion tax is paid in nominal dollars the year it is incurred;
  // we accumulate it in nominal and deflate at aggregation time.
  const workingYearConversionTaxByYear: number[] = [];

  // Resolved per-year allocations — populated only when savingsStrategy is set.
  let resolvedAllocations: ResolvedYearAllocation[] | null = null;
  if (profile.savingsStrategy) {
    resolvedAllocations = resolveSavingsStrategy(
      profile.savingsStrategy,
      profile.currentYear,
      workingYears,
    );
  }

  for (let y = 0; y < workingYears; y++) {
    let addPretax = 0;
    let addRoth = 0;
    let addBrokerage = 0;
    let addHsa = 0;
    let wyConversion = 0;
    let wyConversionTax = 0;

    if (resolvedAllocations) {
      const a = resolvedAllocations[y];
      addPretax    = a.pretaxContribution + a.employerMatch;
      addRoth      = a.rothContribution;
      addBrokerage = a.brokerageContribution;
      addHsa       = a.hsaContribution;
      wyConversion = a.workingYearConversion;
      wyConversionTax = a.workingYearConversionTax;
    } else {
      addPretax    = contrib?.pretax    ?? 0;
      addRoth      = contrib?.roth      ?? 0;
      addBrokerage = contrib?.brokerage ?? 0;
      addHsa       = contrib?.hsa       ?? 0;
    }

    // Apply contributions first, then working-year conversion (cap at available pretax),
    // then growth. Order matters: conversion must move dollars *before* growth so that the
    // converted dollars compound inside the Roth wrapper rather than the pre-tax.
    pretaxBalance    = pretaxBalance    + addPretax;
    rothBalance      = rothBalance      + addRoth;
    brokerageBalance = brokerageBalance + addBrokerage;
    hsaBalance       = hsaBalance       + addHsa;

    const actualConversion = Math.min(wyConversion, pretaxBalance);
    pretaxBalance -= actualConversion;
    rothBalance   += actualConversion;

    pretaxBalance       = pretaxBalance       * (1 + growthRate);
    rothBalance         = rothBalance         * (1 + growthRate);
    brokerageBalance    = brokerageBalance    * (1 + growthRate);
    inheritedIraBalance = inheritedIraBalance * (1 + growthRate);
    hsaBalance          = hsaBalance          * (1 + growthRate);

    workingYearConversionTaxByYear.push(wyConversionTax);
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
  //      profiles that are entirely pre-tax (no taxable brokerage throughout accumulation).
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

  // Brokerage gain ratio: portion of each brokerage withdrawal that is realized gain (and
  // therefore adds to MAGI). Basis is return of capital and is MAGI-invisible.
  // Key for the $50k-brokerage / ACA-cliff case from the "Tax Strategies by Balance" video:
  // a $21k withdrawal at 100% basis contributes $0 to MAGI, preserving the ACA subsidy.
  const totalBrokerageBasis = assets.accounts
    .filter((a) => a.type === 'brokerage')
    .reduce((sum, a) => sum + (a.costBasis ?? a.currentBalance), 0);
  const brokerageGainRatio =
    assets.totalBrokerage > 0
      ? Math.max(0, Math.min(1, (assets.totalBrokerage - totalBrokerageBasis) / assets.totalBrokerage))
      : 0;

  const capacityResult = calculateSpendingCapacity(
    realProjectedAssets,
    spending,
    guardrails,
    yearsInRetirement,
    realProjectedAnnualSS
  );

  // Desired spending = all fixed costs the client must cover at retirement start, in real terms.
  // Essential (baseAnnualSpending) is already in real (current-year) dollars.
  // Healthcare (annualHealthcareCost) is a real base that inflates each year — Year-0 cost = entered value.
  // Mortgage is a nominal fixed payment; deflate to real by dividing by inflationAtRetirement so the
  // comparison with spending capacity (which is also in real terms) is apples-to-apples.
  const clientAgeAtRetirement = profile.client.age + (retirementYear - profile.currentYear);
  const mortgageActiveAtRetirement =
    (spending.mortgageAnnualPayment ?? 0) > 0 &&
    clientAgeAtRetirement < (spending.mortgagePaidOffAge ?? 999);
  const realMortgageAtRetirement = mortgageActiveAtRetirement
    ? (spending.mortgageAnnualPayment ?? 0) / inflationAtRetirement
    : 0;
  const realHealthcareAtRetirement = spending.annualHealthcareCost ?? 0;
  const desiredSpending =
    spending.baseAnnualSpending + realMortgageAtRetirement + realHealthcareAtRetirement;
  const yearlyProjections: YearlyProjection[] = [];
  const stdDeduction = STANDARD_DEDUCTION_2025[profile.filingStatus];

  // IRMAA surcharges are based on MAGI from 2 years prior (the "lookback MAGI"). Tracking per-year
  // MAGI history lets us price this correctly: a big Roth conversion in year N triggers an IRMAA
  // increase in year N+2, not year N. Initialized empty — the first two Medicare years have no
  // lookback available and fall back to current-year MAGI.
  const magiHistory: number[] = [];
  const getLookbackMagi = (currentMagi: number): number =>
    magiHistory.length >= 2 ? magiHistory[magiHistory.length - 2] : currentMagi;

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

    // Per-year growth rate: Monte Carlo injects a return sequence; deterministic runs use flat rate.
    const yearGrowthRate = annualReturnSequence?.[yearIndex] ?? growthRate;

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
      // Matches the elective-conversion archetype: pretax → Roth ($242k), Roth pays taxes + living.

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

      pretaxBalance *= 1 + yearGrowthRate;
      brokerageBalance *= 1 + yearGrowthRate;
      rothBalance *= 1 + yearGrowthRate;
      inheritedIraBalance *= 1 + yearGrowthRate;
      hsaBalance *= 1 + yearGrowthRate;

      const portfolioEnd = pretaxBalance + rothBalance + brokerageBalance + inheritedIraBalance + hsaBalance;

      // ACA eligibility uses conversion-driven MAGI (may be over cliff — expected for this strategy)
      const acaResult = season === 'aca' ? assessAcaEligibility(magi, householdSize) : null;
      const irmaaSurcharge =
        season === 'medicare' || season === 'rmd'
          ? calculateIrmaaSurcharge(getLookbackMagi(magi), profile.filingStatus)
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
      magiHistory.push(magi);

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
        // Plan the sequence so MAGI stays under the cliff. Brokerage withdrawals now count their
        // realized-gain portion (brokerageGainRatio × amount); only basis is MAGI-invisible.
        // Roth is pulled before pretax when brokerage's MAGI impact would otherwise exceed the
        // cliff — this captures the video-informed "Roth as ACA bridge" strategy.
        const ACA_CLIFF = getAcaCliff(householdSize);
        const passiveMagi = inheritedDist + totalSSAnnual * 0.85;
        const totalMagiHeadroom = Math.max(0, ACA_CLIFF - passiveMagi - 1);
        // How much brokerage can we pull before its gains alone exhaust the cliff?
        const brokerageCapByMagi =
          brokerageGainRatio > 0 ? totalMagiHeadroom / brokerageGainRatio : Infinity;
        fromBrokerage = Math.min(incomeGap, brokerageBalance, brokerageCapByMagi);
        const magiAfterBrokerage = passiveMagi + fromBrokerage * brokerageGainRatio;
        const pretaxMagiCapacity = Math.max(0, ACA_CLIFF - magiAfterBrokerage - 1);
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

      // Only the realized-gain portion of a brokerage withdrawal counts toward MAGI;
      // basis is return of capital (MAGI-invisible). This enables the $50k-brokerage / ACA-cliff
      // preservation pattern where the brokerage funds spending but does not blow past the cliff.
      const brokerageRealizedGains = fromBrokerage * brokerageGainRatio;

      magi = calculateMAGI({
        socialSecurityIncludable: totalSSAnnual * 0.85,
        pretaxWithdrawals: fromPretax + rmd,
        rothConversionAmount: 0,
        capitalGainsRealized: brokerageRealizedGains,
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
          ? calculateIrmaaSurcharge(getLookbackMagi(magiWithConversion), profile.filingStatus)
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

      pretaxBalance *= 1 + yearGrowthRate;
      brokerageBalance *= 1 + yearGrowthRate;
      rothBalance *= 1 + yearGrowthRate;
      inheritedIraBalance *= 1 + yearGrowthRate;
      hsaBalance *= 1 + yearGrowthRate;

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
      magiHistory.push(magi);
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

  // ─── Lifetime aggregates ──────────────────────────────────────────────────
  // Strategy-comparison harness needs a single scalar per strategy on several
  // axes: total tax paid (min = tax-minimizing), terminal wealth (max = legacy),
  // early-retirement spending (max = enjoyment), pre-tax depletion year.
  // All amounts deflated to current-year (profile.currentYear) real dollars.
  const inflationRate = spending.inflationRate;
  const deflate = (nominal: number, yearOffset: number): number =>
    nominal / Math.pow(1 + inflationRate, yearOffset);

  // Working-year conversion tax (nominal) → real. y-offset is the accumulation year index.
  const accumulationConversionTaxReal = workingYearConversionTaxByYear.reduce(
    (sum, nominalTax, y) => sum + deflate(nominalTax, y),
    0,
  );

  // Retirement-phase tax: sum federal + state per year from yearlyProjections,
  // deflating nominal amounts to real current-year dollars.
  let retirementFederalTaxReal = 0;
  let retirementStateTaxReal = 0;
  for (const proj of yearlyProjections) {
    const yOffset = proj.year - profile.currentYear;
    retirementFederalTaxReal += deflate(proj.taxLiability.totalFederalTax, yOffset);
    retirementStateTaxReal   += deflate(proj.taxLiability.stateTax,        yOffset);
  }

  // Working-year state tax on conversions (proportion of combined rate that is state).
  const combinedRate = profile.savingsStrategy?.marginalTaxRateFedState ?? 0;
  const stateRateForStrategy = combinedRate > 0 && stateRate > 0
    ? Math.min(stateRate / combinedRate, 1)
    : 0;
  const accumulationStateTaxReal = accumulationConversionTaxReal * stateRateForStrategy;
  const accumulationFederalTaxReal = accumulationConversionTaxReal - accumulationStateTaxReal;

  const lifetimeFederalTaxReal = retirementFederalTaxReal + accumulationFederalTaxReal;
  const lifetimeStateTaxReal   = retirementStateTaxReal   + accumulationStateTaxReal;

  // Terminal balances: last projection's end balances, deflated to real.
  const last = yearlyProjections[yearlyProjections.length - 1];
  const terminalYearOffset = last ? last.year - profile.currentYear : 0;
  const terminalPretaxReal    = last ? deflate(last.pretaxEndBalance,    terminalYearOffset) : 0;
  const terminalRothReal      = last ? deflate(last.rothEndBalance,      terminalYearOffset) : 0;
  const terminalBrokerageReal = last ? deflate(last.brokerageEndBalance, terminalYearOffset) : 0;
  // hsaBalance is tracked as a closure-level number; it gets drawn for healthcare through the loop.
  const terminalHsaReal = deflate(hsaBalance, terminalYearOffset);
  const terminalTotalReal = terminalPretaxReal + terminalRothReal + terminalBrokerageReal + terminalHsaReal;

  // Pre-tax depletion: first year pretaxEndBalance drops to ~zero.
  // Using $1000 threshold (multi-million-scale engine; sub-$1k balance is effectively depleted).
  const depletionProj = yearlyProjections.find((p) => p.pretaxEndBalance <= 1000);
  const pretaxDepletionYear = depletionProj?.year ?? null;

  // Early-retirement spending: sum of annualSpending ages 55–65 (the "enjoyment window"),
  // reconstructed in real current-year dollars. YearlyProjection doesn't surface per-year
  // annualSpending, so we approximate from withdrawals + SS income + taxes (the outflow side).
  let earlyRetirementSpendingReal = 0;
  for (const proj of yearlyProjections) {
    if (proj.clientAge >= 55 && proj.clientAge <= 65) {
      const yOffset = proj.year - profile.currentYear;
      const spendingProxy =
        proj.withdrawals.fromRoth +
        proj.withdrawals.fromBrokerage +
        (proj.withdrawals.fromPretax - proj.income.requiredMinimumDistribution) +
        proj.income.socialSecurityClient + proj.income.socialSecuritySpouse -
        proj.taxLiability.totalFederalTax - proj.taxLiability.stateTax;
      earlyRetirementSpendingReal += Math.max(0, deflate(spendingProxy, yOffset));
    }
  }

  const strategyTotals: StrategyTotalsSummary | null = resolvedAllocations
    ? (() => {
        const t = aggregateStrategyTotals(resolvedAllocations);
        return {
          totalPretaxContributions:      t.totalPretaxContributions,
          totalRothContributions:        t.totalRothContributions,
          totalHsaContributions:         t.totalHsaContributions,
          totalBrokerageContributions:   t.totalBrokerageContributions,
          totalWorkingYearConversions:   t.totalWorkingYearConversions,
          totalEmployerMatch:            t.totalEmployerMatch,
          totalFreeCashFlowConsumed:     t.totalFreeCashFlowConsumed,
          totalFreeCashFlowRemaining:    t.totalFreeCashFlowRemaining,
        };
      })()
    : null;

  const lifetime: LifetimeAggregates = {
    federalTaxPaid: lifetimeFederalTaxReal,
    stateTaxPaid: lifetimeStateTaxReal,
    totalTaxPaid: lifetimeFederalTaxReal + lifetimeStateTaxReal,
    workingYearConversionTaxPaid: accumulationConversionTaxReal,
    terminal: {
      pretax: terminalPretaxReal,
      roth: terminalRothReal,
      brokerage: terminalBrokerageReal,
      hsa: terminalHsaReal,
      total: terminalTotalReal,
    },
    pretaxDepletionYear,
    earlyRetirementSpending: earlyRetirementSpendingReal,
    strategyTotals,
  };

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
    lifetime,
  };
}
