import type { ClientProfile } from '../types/profile';
import { validateCoastPhases } from '../types/profile';
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
import { runCoastStep, type CoastStepState } from './coast';
import { FEDERAL_INCOME_TAX_BRACKETS_2025, STANDARD_DEDUCTION_2025, getBracketCeiling } from '../constants/tax-brackets';
import { getAcaCliff } from '../constants/aca-thresholds';
import { getRmdStartAge } from '../constants/rmd-tables';
import { getStateInfo } from '../constants/states';

// Engine simulates everything in current-year (profile.currentYear) real dollars.
// annualGrowthRate is REAL: 6% real ≈ 9% nominal at 3% inflation, the Boglehead 60/40 baseline.
// inflationRate is informational only — used to deflate fixed-nominal items (mortgage payments)
// to real terms. It does NOT inflate spending, tax brackets, conversion targets, or portfolio
// balances; those are all already real. See FINANCIAL-PRINCIPLES.md §17.
const DEFAULT_GROWTH_RATE = 0.06;

export function runSimulation(
  profile: ClientProfile,
  assets: AssetSnapshot,
  spending: SpendingProfile,
  guardrails: GuardrailConfig,
  scenarioType: ScenarioType,
  annualReturnSequence?: number[]  // Monte Carlo injection: per-year REAL returns during retirement. If omitted, uses flat annualGrowthRate.
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

  // ─── Coast phase validation & accumulation truncation ───────────────────
  // If profile.coastPhases is set, accumulation stops at the first coast phase start year
  // (rather than running all the way to retirementYear). Validation runs first to surface
  // configuration errors before any simulation work.
  const coastValidation = validateCoastPhases(profile.coastPhases, profile.currentYear, profile.retirementYearDesired ?? null);
  if (!coastValidation.valid) {
    throw new Error(
      `Invalid coastPhases configuration: ${coastValidation.errors.join('; ')}`
    );
  }
  const hasCoast = (profile.coastPhases?.length ?? 0) > 0;
  const firstCoastYear = hasCoast ? profile.coastPhases![0].startYear : null;
  const accumulationYears = firstCoastYear != null
    ? Math.max(0, firstCoastYear - profile.currentYear)
    : workingYears;

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
  // Working-year conversion tax is paid in real (today's) dollars per the savings-strategy
  // model — freeCashFlow is real and the tax is computed against it at the marginal rate.
  const workingYearConversionTaxByYear: number[] = [];

  // Resolved per-year allocations — populated only when savingsStrategy is set.
  // Resolved over accumulationYears (which equals workingYears when no coast phases).
  let resolvedAllocations: ResolvedYearAllocation[] | null = null;
  if (profile.savingsStrategy) {
    resolvedAllocations = resolveSavingsStrategy(
      profile.savingsStrategy,
      profile.currentYear,
      accumulationYears,
    );
  }

  for (let y = 0; y < accumulationYears; y++) {
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

    // Running HSA spend (deductibles, copays, dental, vision) drains the HSA each year
    // during accumulation as well as retirement. Without this, the HSA acts like a pure
    // investment vehicle, overstating its terminal balance by ~2-3x for typical families.
    const hsaRunningSpend = spending.hsaAnnualSpending ?? 0;
    hsaBalance = Math.max(0, hsaBalance - hsaRunningSpend);

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

  // ─── Coast phase loop ──────────────────────────────────────────────────
  // Runs between accumulation and retirement. Coast phases (if any) modify the
  // post-accumulation balances and produce YearlyProjection entries with season='coast'.
  // The retirement loop afterward sees the post-coast balances via projectedAssets.
  const coastProjections: YearlyProjection[] = [];
  if (hasCoast) {
    // Brokerage gain ratio computed against current accumulation-end balance.
    // This treats the basis as a fixed dollar amount (set at simulation entry) that
    // is allocated proportionally across the basis ratio of the brokerage balance.
    const totalBrokerageBasisCoast = assets.accounts
      .filter((a) => a.type === 'brokerage')
      .reduce((sum, a) => sum + (a.costBasis ?? a.currentBalance), 0);
    const brokerageGainRatioCoast =
      brokerageBalance > 0
        ? Math.max(0, Math.min(1, (brokerageBalance - totalBrokerageBasisCoast) / brokerageBalance))
        : 0;

    const coastState: CoastStepState = {
      pretaxBalance,
      rothBalance,
      brokerageBalance,
      inheritedIraBalance,
      hsaBalance,
      peakPortfolio: 0,
      brokerageCostBasis: totalBrokerageBasisCoast,
    };

    for (const phase of profile.coastPhases!) {
      for (let coastYear = phase.startYear; coastYear <= phase.endYear; coastYear++) {
        // Recompute gain ratio each year since cost basis changes when surplus is routed
        const liveGainRatio = coastState.brokerageBalance > 0
          ? Math.max(0, Math.min(1, (coastState.brokerageBalance - coastState.brokerageCostBasis) / coastState.brokerageBalance))
          : 0;
        const projection = runCoastStep({
          year: coastYear,
          phase,
          profile,
          spending,
          growthRate,
          state: coastState,
          brokerageGainRatio: liveGainRatio,
        });
        coastProjections.push(projection);
      }
    }

    // Sync coast-mutated balances back to outer-scope variables so projectedAssets reflects post-coast state
    pretaxBalance = coastState.pretaxBalance;
    rothBalance = coastState.rothBalance;
    brokerageBalance = coastState.brokerageBalance;
    inheritedIraBalance = coastState.inheritedIraBalance;
    hsaBalance = coastState.hsaBalance;
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

  // Engine is real-internal: projectedAssets and projectedAnnualSS are already in current-year
  // real dollars (accumulation grew them at the real rate, SS input is today's-dollar PIA with
  // actuarial adjustment for claim age). Spending inputs are real too. No deflation needed.

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

  // Desired spending = fixed costs the client must cover at retirement start, all in real dollars.
  // Computed BEFORE spending-capacity so we can pass mortgage + conversion tax into the heuristic.
  const clientAgeAtRetirement = profile.client.age + (retirementYear - profile.currentYear);
  const mortgageActiveAtRetirement =
    (spending.mortgageAnnualPayment ?? 0) > 0 &&
    clientAgeAtRetirement < (spending.mortgagePaidOffAge ?? 999);
  const realMortgageAtRetirement = mortgageActiveAtRetirement
    ? (spending.mortgageAnnualPayment ?? 0) / Math.pow(1 + spending.inflationRate, workingYears)
    : 0;
  const realHealthcareAtRetirement = spending.annualHealthcareCost ?? 0;
  const desiredSpending =
    spending.baseAnnualSpending + realMortgageAtRetirement + realHealthcareAtRetirement;
  const yearlyProjections: YearlyProjection[] = [];
  // Prepend Coast phase projections (if any) so downstream analytics (lifetime aggregates,
  // depletion checks, etc.) see them as part of the simulation timeline.
  if (coastProjections.length > 0) {
    yearlyProjections.push(...coastProjections);
  }
  const stdDeduction = STANDARD_DEDUCTION_2025[profile.filingStatus];

  // ─── Heuristic bridge context ──────────────────────────────────────────────
  // Pre-SS bridge length: years from retirement until the earlier of the two SS claim ages.
  const clientSsStartYear = profile.currentYear + (profile.client.socialSecurityClaimAge - profile.client.age);
  const spouseSsStartYear = profile.spouse
    ? profile.currentYear + (profile.spouse.socialSecurityClaimAge - profile.spouse.age)
    : clientSsStartYear;
  const earliestSsStartYear = Math.min(clientSsStartYear, spouseSsStartYear);
  const bridgeYears = Math.max(0, earliestSsStartYear - retirementYear);

  // Estimated annual conversion tax during bridge: only relevant when conversion engine is active.
  // Uses the same bracket-ceiling math the retirement loop uses, with SS=0 (bridge years).
  let estimatedAnnualConversionTax = 0;
  if (profile.targetBracket && projectedAssets.totalPretax > 0) {
    const bracketCeiling = getBracketCeiling(profile.targetBracket, profile.filingStatus, FEDERAL_INCOME_TAX_BRACKETS_2025);
    const conversionAmount = Math.min(bracketCeiling + stdDeduction, projectedAssets.totalPretax);
    const taxableIncome = Math.max(0, conversionAmount - stdDeduction);
    const fedTax = calculateOrdinaryIncomeTax(taxableIncome, profile.filingStatus, FEDERAL_INCOME_TAX_BRACKETS_2025);
    const stateInfo = getStateInfo(profile.stateOfResidence);
    const stateRateEst = stateInfo?.hasIncomeTax ? (stateInfo.topMarginalRate ?? 0) : 0;
    const stateTaxEst = conversionAmount * stateRateEst;
    estimatedAnnualConversionTax = fedTax + stateTaxEst;
  }

  const capacityResult = calculateSpendingCapacity(
    projectedAssets,
    spending,
    guardrails,
    yearsInRetirement,
    projectedAnnualSS,
    { bridgeYears, realMortgageAtRetirement, estimatedAnnualConversionTax }
  );

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

  // ─── Guardrail state ─────────────────────────────────────────────────────────
  // Track portfolio peak from retirement onward; apply spending cut to variable
  // components (essential + travel + charitable) when drawdown exceeds threshold.
  // Two-tier ratchet matching Guyton-Klinger style:
  //   - drawdown ≥ lowerGuardrailDropPct      → cut by lowerGuardrailSpendingCutPct
  //   - drawdown ≥ deepDropPct (default 2×)   → cut by deepCutPct (default 2×, capped 30%)
  //   - drawdown < recoveryThresholdPct       → restore to baseline (no cut)
  // Cuts apply ONLY to variable spending — mortgage, healthcare, taxes, lumpy expenses
  // are non-discretionary and remain unchanged.
  let peakPortfolio = 0;
  let currentGuardrailCutPct = 0;
  const firstTierDrop = guardrails.lowerGuardrailDropPct;
  const firstTierCut = guardrails.lowerGuardrailSpendingCutPct;
  const deepTierDrop = guardrails.deepDropPct ?? (firstTierDrop * 2);
  const deepTierCut = Math.min(0.30, guardrails.deepCutPct ?? (firstTierCut * 2));
  const recoveryThreshold = guardrails.recoveryThresholdPct ?? 0.10;

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

    // T5: one-time cash injections (house sale proceeds, inheritance) land in brokerage
    // at the start of the year, before withdrawals/conversions. Amount is in real dollars.
    const oneTimeIncomeThisYear = (spending.oneTimeIncomes ?? [])
      .filter((i) => i.year === year)
      .reduce((sum, i) => sum + i.amount, 0);
    if (oneTimeIncomeThisYear > 0) {
      brokerageBalance += oneTimeIncomeThisYear;
    }
    // Taxable injections (rare) bump MAGI for the year — track separately so the
    // conversion engine can subtract its room from the bracket capacity.
    const taxableOneTimeIncome = (spending.oneTimeIncomes ?? [])
      .filter((i) => i.year === year && i.taxable === true)
      .reduce((sum, i) => sum + i.amount, 0);

    const travelBudget =
      clientAge >= spending.travelTaperStartAge
        ? spending.travelBudgetLate
        : spending.travelBudgetEarly;

    // Mortgage is a fixed nominal payment; its real value shrinks each year of inflation.
    // realMortgageThisYear = nominal / (1+i)^(year - currentYear).
    const mortgagePayment =
      (spending.mortgageAnnualPayment ?? 0) > 0 &&
      spending.mortgagePaidOffAge !== undefined &&
      clientAge <= spending.mortgagePaidOffAge
        ? (spending.mortgageAnnualPayment ?? 0) /
          Math.pow(1 + spending.inflationRate, year - profile.currentYear)
        : 0;

    // T7: HSA-routed healthcare costs only apply at/after healthcareStartAge (default 65 = Medicare).
    // Pre-Medicare bridge years should fund coverage from baseAnnualSpending instead, since the HSA
    // can't pay ACA premiums. annualHealthcareCost typically represents Medicare Part B/D + Medigap.
    // Real-internal: healthcare cost is flat in real terms (assumes healthcare CPI ≈ general CPI).
    const healthcareStartAge = spending.healthcareStartAge ?? 65;
    const medicareCost = clientAge >= healthcareStartAge
      ? (spending.annualHealthcareCost ?? 0)
      : 0;
    // Running HSA spend (deductibles, copays, dental, vision) is also flat in real terms.
    const runningHsaSpend = spending.hsaAnnualSpending ?? 0;
    const rawHealthcareCost = medicareCost + runningHsaSpend;
    const fromHsa = Math.min(rawHealthcareCost, hsaBalance);
    const healthcareOverflow = rawHealthcareCost - fromHsa;

    const oneTimeExpense = spending.oneTimeExpenses.find((e) => e.year === year)?.amount ?? 0;
    // Self-insure budget applies only during the 'self_insure' season (pre-65). Post-65 the
    // user is on Medicare like everyone else and annualHealthcareCost takes over.
    const selfInsureCost =
      season === 'self_insure'
        ? (spending.selfInsuranceAnnualBudget ?? 0)
        : 0;

    // ─── Guardrail evaluation ────────────────────────────────────────────────
    // Compute portfolio at year start (after oneTimeIncome injection from earlier in this iter,
    // before any withdrawals). This is the basis for drawdown measurement.
    const portfolioAtYearStart =
      pretaxBalance + rothBalance + brokerageBalance + inheritedIraBalance + hsaBalance;
    if (portfolioAtYearStart > peakPortfolio) peakPortfolio = portfolioAtYearStart;
    const drawdownFromPeak = peakPortfolio > 0
      ? (peakPortfolio - portfolioAtYearStart) / peakPortfolio
      : 0;
    // Tier evaluation: ratchet up cuts as drawdown deepens; restore to baseline on recovery.
    if (drawdownFromPeak >= deepTierDrop) {
      currentGuardrailCutPct = deepTierCut;
    } else if (drawdownFromPeak >= firstTierDrop) {
      currentGuardrailCutPct = Math.max(currentGuardrailCutPct, firstTierCut);
    } else if (drawdownFromPeak < recoveryThreshold) {
      currentGuardrailCutPct = 0;
    }
    // Apply cut to VARIABLE spending only: essential + travel + charitable.
    // NOT to mortgage (contractual), healthcare (medical), taxes (driven by conversion), or
    // oneTimeExpense (capital). This matches how guardrails work in practice — you cut
    // lifestyle, you don't skip the mortgage.
    const variableSpending =
      spending.baseAnnualSpending + travelBudget + spending.charitableGivingAnnual;
    const adjustedVariable = variableSpending * (1 - currentGuardrailCutPct);

    const annualSpending =
      adjustedVariable
      + mortgagePayment
      + healthcareOverflow
      + selfInsureCost
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

    const rmdStartAge = getRmdStartAge(profile.client.birthYear);
    const rmd = clientAge >= rmdStartAge ? calculateRMD(pretaxBalance, clientAge, rmdStartAge) : 0;
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

      // Bracket-ceiling conversion: fill exactly to the target bracket. All amounts are in
      // current-year real dollars; tax brackets and the standard deduction are real-sticky
      // (the IRS indexes them to inflation), so we treat them as constant in real terms.
      // Formula: magiCapacity     = bracketCeiling + stdDeduction
      //          conversionAmount = magiCapacity − RMD − SS_includable − inheritedDist − taxableOneTime
      // This automatically:
      //   - shrinks the conversion as SS phases in (SS includable eats bracket headroom)
      //   - shrinks further as RMDs start at 73 (RMD displaces discretionary conversion)
      const ssIncludable = totalSSAnnual * 0.85;
      const bracketCeiling = getBracketCeiling(
        profile.targetBracket ?? '22%',
        profile.filingStatus,
        FEDERAL_INCOME_TAX_BRACKETS_2025
      );
      const magiCapacity = bracketCeiling + stdDeduction;
      // Taxable one-time income (rare) consumes bracket room before the conversion.
      const conversionTarget = Math.max(
        0,
        magiCapacity - rmd - ssIncludable - inheritedDist - taxableOneTimeIncome
      );
      const conversionAmount = Math.min(conversionTarget, pretaxBalance);

      // MAGI = conversion + RMD + SS (85% includable) + inherited IRA distributions + taxable injection
      const magiBase = conversionAmount + rmd + ssIncludable + inheritedDist + taxableOneTimeIncome;

      const taxableIncome = Math.max(0, magiBase - stdDeduction);
      const totalTax = calculateOrdinaryIncomeTax(taxableIncome, profile.filingStatus, FEDERAL_INCOME_TAX_BRACKETS_2025);
      const marginalRate = getMarginalRate(taxableIncome, profile.filingStatus, FEDERAL_INCOME_TAX_BRACKETS_2025);

      // State income tax on the conversion (non-SS ordinary income at the state top marginal rate).
      // BUG FIX 2026-05-28: this was previously computed only for the report object (~25 lines below)
      // and NEVER funded from the portfolio, so any state-tax profile (e.g. NC base case) effectively
      // simulated as if it paid $0 state tax. It must be drawn from Roth alongside federal tax.
      // stateRate is 0 unless the profile sets hasStateIncomeTax + stateOfResidence, so this is a
      // no-op for severed-residency scenarios (Korea/international keep stateRate 0).
      const stateTaxBase = Math.max(0, magiBase - ssIncludable);
      const stateTax = stateTaxBase * stateRate;

      // T6: lumpy expenses (e.g. rebuy a house) draw from brokerage first, Roth as overflow.
      // Recurring spending (annualSpending minus oneTimeExpense) still funds from Roth net of SS.
      const recurringSpending = Math.max(0, annualSpending - oneTimeExpense);
      const lumpyFromBrokerage = Math.min(oneTimeExpense, brokerageBalance);
      const lumpyOverflowToRoth = oneTimeExpense - lumpyFromBrokerage;
      const rothSpendingDraw = Math.max(0, recurringSpending - totalSSAnnual) + lumpyOverflowToRoth;

      // Funding cascade when Roth alone can't cover spending + taxes:
      //   Tier 1: Roth (rothAvailable = balance + conversion-in)
      //   Tier 2: emergency draw from pretax (preserves brokerage for tax-efficient growth)
      //   Tier 3: emergency draw from brokerage (last resort when both pretax and Roth depleted)
      // Bug fix 2026-05-15: prior code only had Tier 2 — when both Roth AND pretax were depleted
      // but brokerage had money, the engine silently failed to draw any spending. This made
      // extreme early-retirement scenarios appear feasible by phantom-zero-spending years.
      const totalRothNeed = totalTax + stateTax + rothSpendingDraw;
      const rothAvailable = rothBalance + conversionAmount;
      let unfundedFromRoth = Math.max(0, totalRothNeed - rothAvailable);

      const emergencyPretaxDraw = Math.min(unfundedFromRoth, pretaxBalance);
      unfundedFromRoth -= emergencyPretaxDraw;

      const emergencyBrokerageDraw = Math.min(unfundedFromRoth, brokerageBalance - lumpyFromBrokerage);
      // Note: unfundedFromRoth after this still > 0 means TRUE depletion — Roth+pretax+brokerage all empty.
      // The engine doesn't synthetically create money; the portfolio simply runs out and downstream
      // probability calc will flag it. MC depletion-floor (< $10k) will count the trial as a failure.

      magi = magiBase;

      rothConversion = {
        conversionAmount,
        marginalRate,
        taxOnConversion: totalTax,
        brokerageFundingAmount: 0,
        rothFundingAmount: totalTax + stateTax, // federal + state taxes paid from Roth
      };

      withdrawals = {
        fromPretax: rmd + emergencyPretaxDraw,
        fromBrokerage: lumpyFromBrokerage + emergencyBrokerageDraw,
        fromRoth: rothSpendingDraw,
        total: rmd + emergencyPretaxDraw + rothSpendingDraw + lumpyFromBrokerage + emergencyBrokerageDraw,
      };

      // Portfolio updates
      const portfolioStart = pretaxBalance + rothBalance + brokerageBalance + inheritedIraBalance + hsaBalance;

      pretaxBalance = Math.max(0, pretaxBalance - rmd - emergencyPretaxDraw - conversionAmount);
      // Roth: gains conversion, pays taxes (federal + state) and spending
      rothBalance = Math.max(0, rothBalance + conversionAmount - totalTax - stateTax - rothSpendingDraw);
      // T6: brokerage funds the lumpy expense; Tier-3 fallback also draws from brokerage when
      // Roth + pretax cannot cover annual spending.
      brokerageBalance = Math.max(0, brokerageBalance - lumpyFromBrokerage - emergencyBrokerageDraw);
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

      // State tax (stateTaxBase/stateTax computed above, where it is also funded from Roth).
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
        guardrailCutPct: currentGuardrailCutPct,
        peakPortfolio,
      });
      magiHistory.push(magi);

    } else {
      // ── Withdrawal-Sequencing Engine (original) ────────────────────────────
      // Draw from accounts in sequence to cover the spending gap, then convert
      // surplus bracket capacity to Roth. Tax paid from brokerage when available.
      //
      // Best for: brokerage-backed strategies, ACA cliff optimization.

      const incomeGap = Math.max(0, annualSpending - income.total);
      const nonEssentialSpend = travelBudget + spending.charitableGivingAnnual;

      let fromBrokerage = 0;
      let fromPretax = 0;
      let fromRoth = 0;

      if (season === 'cobra' || season === 'international' || season === 'self_insure') {
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

      if ((season === 'cobra' || season === 'international' || season === 'self_insure' || season === 'medicare' || season === 'rmd') && pretaxBalance > 0) {
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

      // Real-internal: MAGI is already in current-year real dollars; tax brackets and the
      // standard deduction are real-sticky (IRS indexes them), so compute tax directly.
      const taxableWC = Math.max(0, magiWithConversion - stdDeduction);
      const ordinaryIncomeTax = calculateOrdinaryIncomeTax(
        taxableWC,
        profile.filingStatus,
        FEDERAL_INCOME_TAX_BRACKETS_2025
      );
      const rothConversionTax = rothConversion?.taxOnConversion ?? 0;

      // State income tax on non-SS ordinary income at the state top marginal rate. stateRate is 0
      // unless the profile is state-taxed, so this is a no-op for severed-residency profiles.
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

      // BUG FIX 2026-05-29 (companion to the conversion-primary fix): fund state income tax from the
      // portfolio. Previously stateTax was reported in taxLiability but never deducted, so any
      // state-taxed profile using this branch understated its drag. Pay from Roth first
      // (MAGI-invisible, no tax-on-tax spiral), then brokerage, then pretax — computed against the
      // post-withdrawal, post-conversion balances so it never double-counts a draw.
      const rothAfter = Math.max(0,
        rothBalance - withdrawals.fromRoth
          + (rothConversion?.conversionAmount ?? 0)
          - (rothConversion?.rothFundingAmount ?? 0));
      const brokerageAfter = Math.max(0,
        brokerageBalance - withdrawals.fromBrokerage - (rothConversion?.brokerageFundingAmount ?? 0));
      const pretaxAfter = Math.max(0,
        pretaxBalance - withdrawals.fromPretax - (rothConversion?.conversionAmount ?? 0));
      let stateTaxRemaining = stateTax;
      const stateTaxFromRoth = Math.min(rothAfter, stateTaxRemaining);
      stateTaxRemaining -= stateTaxFromRoth;
      const stateTaxFromBrokerage = Math.min(brokerageAfter, stateTaxRemaining);
      stateTaxRemaining -= stateTaxFromBrokerage;
      const stateTaxFromPretax = Math.min(pretaxAfter, stateTaxRemaining);

      pretaxBalance = Math.max(
        0,
        pretaxBalance - withdrawals.fromPretax - (rothConversion?.conversionAmount ?? 0) - stateTaxFromPretax
      );
      brokerageBalance = Math.max(
        0,
        brokerageBalance - withdrawals.fromBrokerage - (rothConversion?.brokerageFundingAmount ?? 0) - stateTaxFromBrokerage
      );
      rothBalance = Math.max(
        0,
        rothBalance
          - withdrawals.fromRoth
          + (rothConversion?.conversionAmount ?? 0)
          - (rothConversion?.rothFundingAmount ?? 0)
          - stateTaxFromRoth
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
        guardrailCutPct: currentGuardrailCutPct,
        peakPortfolio,
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
  // All amounts are already in current-year (profile.currentYear) real dollars
  // because the engine is real-internal — sum directly without deflation.

  const accumulationConversionTaxReal = workingYearConversionTaxByYear.reduce(
    (sum, realTax) => sum + realTax,
    0,
  );

  let retirementFederalTaxReal = 0;
  let retirementStateTaxReal = 0;
  for (const proj of yearlyProjections) {
    retirementFederalTaxReal += proj.taxLiability.totalFederalTax;
    retirementStateTaxReal   += proj.taxLiability.stateTax;
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

  // Terminal balances: last projection's end balances, already in real dollars.
  const last = yearlyProjections[yearlyProjections.length - 1];
  const terminalPretaxReal    = last?.pretaxEndBalance    ?? 0;
  const terminalRothReal      = last?.rothEndBalance      ?? 0;
  const terminalBrokerageReal = last?.brokerageEndBalance ?? 0;
  // hsaBalance is tracked as a closure-level number; it gets drawn for healthcare through the loop.
  const terminalHsaReal = hsaBalance;
  const terminalTotalReal = terminalPretaxReal + terminalRothReal + terminalBrokerageReal + terminalHsaReal;

  // Pre-tax depletion: first year pretaxEndBalance drops to ~zero.
  // Using $1000 threshold (multi-million-scale engine; sub-$1k balance is effectively depleted).
  const depletionProj = yearlyProjections.find((p) => p.pretaxEndBalance <= 1000);
  const pretaxDepletionYear = depletionProj?.year ?? null;

  // Early-retirement spending: sum of annualSpending ages 55–65 (the "enjoyment window"),
  // already in real dollars. YearlyProjection doesn't surface per-year annualSpending, so we
  // approximate from withdrawals + SS income − taxes (the outflow side).
  let earlyRetirementSpendingReal = 0;
  for (const proj of yearlyProjections) {
    if (proj.clientAge >= 55 && proj.clientAge <= 65) {
      const spendingProxy =
        proj.withdrawals.fromRoth +
        proj.withdrawals.fromBrokerage +
        (proj.withdrawals.fromPretax - proj.income.requiredMinimumDistribution) +
        proj.income.socialSecurityClient + proj.income.socialSecuritySpouse -
        proj.taxLiability.totalFederalTax - proj.taxLiability.stateTax;
      earlyRetirementSpendingReal += Math.max(0, spendingProxy);
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
