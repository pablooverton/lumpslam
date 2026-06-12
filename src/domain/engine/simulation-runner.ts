import type { ClientProfile } from '../types/profile';
import { validateCoastPhases } from '../types/profile';
import type { AssetSnapshot } from '../types/assets';
import type { SpendingProfile } from '../types/spending';
import type { GuardrailConfig, LifetimeAggregates, ScenarioResult, ScenarioType, StrategyTotalsSummary } from '../types/scenarios';
import type { YearlyProjection, IncomeBreakdown, WithdrawalBreakdown, TaxLiability, RothConversionEvent } from '../types/simulation';
import { classifySeasonForYear, calculateMAGI, assessAcaEligibility, calculateIrmaaSurcharge, getCobraWindowEnd } from './seasons';
import { calculateRothConversion } from './roth-conversion';
import { createRothLedger, addContribution, addConversionLot, drawFromRoth } from './roth-ledger';
import { calculateRMD, projectInheritedIraDistributions } from './rmd';
import { calculateBenefitAtClaimAge } from './social-security';
import { calculateLtcgTax, calculateNiit, calculateOrdinaryIncomeTax, getMarginalRate } from './tax-utils';
import { calculateSpendingCapacity } from './spending-capacity';
import { resolveSavingsStrategy, aggregateStrategyTotals, type ResolvedYearAllocation } from './savings-strategy';
import { runCoastStep, type CoastStepState } from './coast';
import { FEDERAL_INCOME_TAX_BRACKETS_2025, STANDARD_DEDUCTION_2025, calculateSeniorDeduction, getBracketCeiling } from '../constants/tax-brackets';
import { getAcaCliff } from '../constants/aca-thresholds';
import { getRmdStartAge } from '../constants/rmd-tables';
import { calculateStateTax, getStateInfo } from '../constants/states';

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
  const stateInfoResolved = profile.hasStateIncomeTax
    ? getStateInfo(profile.stateOfResidence)
    : undefined;
  // Flat top-marginal rate — still used for the working-year fed/state split and the bridge
  // heuristic. Year-by-year retirement state tax goes through stateTaxOn (progressive steps
  // for states that define them; flat otherwise).
  const stateRate = stateInfoResolved?.topMarginalRate ?? 0;
  const stateTaxOn = (base: number): number =>
    calculateStateTax(stateInfoResolved, base, profile.filingStatus);

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
  const coastValidation = validateCoastPhases(
    profile.coastPhases,
    profile.currentYear,
    profile.retirementYearDesired ?? null,
    { incomes: spending.oneTimeIncomes, expenses: spending.oneTimeExpenses }
  );
  if (!coastValidation.valid) {
    throw new Error(
      `Invalid coastPhases configuration: ${coastValidation.errors.join('; ')}`
    );
  }
  // Non-blocking issues (silently-dropped one-time flows, discarded savings cash) ride on the
  // result instead of failing the run.
  const simulationWarnings: string[] = [...coastValidation.warnings];
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

  // ─── Inherited-IRA 10-year clock ─────────────────────────────────────────
  // BUG FIX 2026-06-11: the IRS 10-year window runs on calendar years, not retirement years.
  // Previously no distributions were modeled before retirement at all, so any profile with
  // workingYears ≥ the remaining window silently never distributed — the balance compounded
  // untaxed forever inside portfolio totals. Distributions now run through accumulation and
  // coast years too: equal annual amounts over the remaining window, taxed at the working-year
  // marginal rate when a savings strategy provides one (0 otherwise — the engine has no other
  // working-year tax model), net proceeds reinvested in brokerage.
  const inheritedAccount = assets.accounts.find((a) => a.type === 'inherited_ira');
  const inheritedOriginalRemainingYears = inheritedAccount?.inheritedIraRemainingYears ?? 10;
  const accumulationMarginalRate = profile.savingsStrategy?.marginalTaxRateFedState ?? 0;
  let accumulationInheritedTaxReal = 0;

  // ─── Pre-59½ Roth accessibility ledger ───────────────────────────────────
  // Tracks contribution basis and 5-year conversion lots so Roth draws follow IRS ordering
  // rules instead of being freely spendable (see roth-ledger.ts and the modeling conventions
  // documented there; encodes the out-of-band pre-59½ access audit into the engine).
  // Penalty gating uses the OLDER spouse's age — household accounts are pooled, and a couple
  // draws the older spouse's accounts first. Integer age 59 is treated as still under 59½.
  const rothLedger = createRothLedger(assets.totalRothContributionBasis);
  const pre59Exemption = profile.pre59PenaltyExemption ?? 'none';
  const gatingAgeForYear = (year: number): number => {
    const c = profile.client.age + (year - profile.currentYear);
    const s = profile.spouse ? profile.spouse.age + (year - profile.currentYear) : c;
    return Math.max(c, s);
  };
  // Pretax-draw penalty rate. The 72(t)/rule-of-55 exemptions are pretax-side only; Roth
  // draws always follow the ordering rules regardless of the flag.
  const pretaxPenaltyRateAt = (gatingAge: number): number => {
    if (gatingAge >= 59.5) return 0;
    if (pre59Exemption === '72t') return 0;
    if (pre59Exemption === 'rule_of_55' && gatingAge >= 55) return 0;
    return 0.10;
  };

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
    // Roth contributions are withdrawable basis (direct + backdoor + elective-at-rollover —
    // see roth-ledger.ts for why electives count as basis from day one).
    addContribution(rothLedger, addRoth);

    // Running HSA spend (deductibles, copays, dental, vision) drains the HSA each year
    // during accumulation as well as retirement. Without this, the HSA acts like a pure
    // investment vehicle, overstating its terminal balance by ~2-3x for typical families.
    const hsaRunningSpend = spending.hsaAnnualSpending ?? 0;
    hsaBalance = Math.max(0, hsaBalance - hsaRunningSpend);

    const actualConversion = Math.min(wyConversion, pretaxBalance);
    pretaxBalance -= actualConversion;
    rothBalance   += actualConversion;
    addConversionLot(rothLedger, profile.currentYear + y, actualConversion);

    // Inherited-IRA distribution for this calendar year (see clock note above the loop).
    const inheritedYearsLeft = inheritedOriginalRemainingYears - y;
    if (inheritedIraBalance > 0 && inheritedYearsLeft >= 1) {
      const dist = inheritedIraBalance / inheritedYearsLeft;
      inheritedIraBalance -= dist;
      const distTax = dist * accumulationMarginalRate;
      brokerageBalance += dist - distTax;
      accumulationInheritedTaxReal += distTax;
    }

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
        // Inherited-IRA clock keeps running through coast years (calendar-based — see the
        // clock note above the accumulation loop). The distribution is handed to the coast
        // step, which taxes it as US-source ordinary income and conserves the proceeds.
        const coastYearsElapsed = coastYear - profile.currentYear;
        const coastInheritedYearsLeft = inheritedOriginalRemainingYears - coastYearsElapsed;
        const coastInheritedDist =
          coastState.inheritedIraBalance > 0 && coastInheritedYearsLeft >= 1
            ? coastState.inheritedIraBalance / coastInheritedYearsLeft
            : 0;
        const projection = runCoastStep({
          year: coastYear,
          phase,
          profile,
          spending,
          growthRate,
          state: coastState,
          brokerageGainRatio: liveGainRatio,
          inheritedIraDistribution: coastInheritedDist,
          rothLedger,
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

  // Political-risk / PIA haircut: scales every household SS benefit — the projection loop,
  // the capacity heuristic (via projectedAnnualSS), and the claiming comparison (via its own
  // parameter). See FINANCIAL-PRINCIPLES §14 for the fraMonthlyBenefit input convention
  // (statement PIA assumes continued earnings; early retirees should use a $0-future-earnings
  // estimate or this haircut).
  const ssHaircutFactor = 1 - (profile.ssBenefitHaircutPct ?? 0);
  const clientSSMonthly = ssHaircutFactor * calculateBenefitAtClaimAge(
    profile.client.fraMonthlyBenefit,
    profile.client.fullRetirementAge,
    profile.client.socialSecurityClaimAge
  );
  const spouseSSMonthly = profile.spouse
    ? ssHaircutFactor * calculateBenefitAtClaimAge(
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
  // Seeded with coast-year MAGIs so the 2-year lookback prices correctly in the first two
  // retirement years after a coast (previously fell back to current-year MAGI there).
  const magiHistory: number[] = coastProjections.map((p) => p.magi);
  const getLookbackMagi = (currentMagi: number): number =>
    magiHistory.length >= 2 ? magiHistory[magiHistory.length - 2] : currentMagi;

  // Pre-retirement years already took their distributions (accumulation + coast loops above),
  // so the balance arriving here is mid-schedule; the retirement loop distributes whatever
  // window remains. The window never silently expires with a balance left.
  const adjustedRemainingYears = Math.max(0, inheritedOriginalRemainingYears - workingYears);

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

    // OBBBA senior deduction (2025–2028): persons aged 65+ this year. The deduction itself
    // is MAGI-phase-out dependent and computed in each branch's tax math.
    const personsAged65Plus = (clientAge >= 65 ? 1 : 0) + ((spouseAge ?? 0) >= 65 ? 1 : 0);

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
        ? ssHaircutFactor * calculateBenefitAtClaimAge(
            profile.client.fraMonthlyBenefit,
            profile.client.fullRetirementAge,
            profile.client.socialSecurityClaimAge
          )
        : 0;
    const ssSpouseMonthly =
      profile.spouse && spouseAge !== null && spouseAge >= profile.spouse.socialSecurityClaimAge
        ? ssHaircutFactor * calculateBenefitAtClaimAge(
            profile.spouse.fraMonthlyBenefit,
            profile.spouse.fullRetirementAge,
            profile.spouse.socialSecurityClaimAge
          )
        : 0;
    // Real-internal engine: a benefit held flat in real dollars IS a fully CPI-COLA'd benefit
    // (SS COLAs track CPI) — the standard planning assumption, not a conservative one.
    // Benefit-cut / political risk is modeled via profile.ssBenefitHaircutPct instead.
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
      // IRS rule: the year's RMD must be satisfied before any conversion — cap the conversion
      // at the pretax balance net of the RMD so the two together can never overdraw the account.
      const conversionAmount = Math.min(conversionTarget, Math.max(0, pretaxBalance - rmd));
      // The conversion starts its own 5-year clock; this year's draws consume older money
      // first (FIFO), so the fresh lot is reachable only after basis and older lots.
      addConversionLot(rothLedger, year, conversionAmount);

      // MAGI = conversion + RMD + SS (85% includable) + inherited IRA distributions + taxable injection
      const magiBase = conversionAmount + rmd + ssIncludable + inheritedDist + taxableOneTimeIncome;

      // OBBBA senior deduction on the base liability (re-derived from the final MAGI in the
      // one-pass extra block below; conversion sizing keeps the plain standard deduction —
      // slightly conservative under-fill in 65+ years through 2028).
      const seniorDeductionBase = calculateSeniorDeduction(
        year, profile.filingStatus, magiBase, personsAged65Plus
      );
      const taxableIncome = Math.max(0, magiBase - stdDeduction - seniorDeductionBase);
      const totalTax = calculateOrdinaryIncomeTax(taxableIncome, profile.filingStatus, FEDERAL_INCOME_TAX_BRACKETS_2025);
      const marginalRate = getMarginalRate(taxableIncome, profile.filingStatus, FEDERAL_INCOME_TAX_BRACKETS_2025);

      // State income tax on the conversion (non-SS ordinary income at the state top marginal rate).
      // BUG FIX 2026-05-28: this was previously computed only for the report object (~25 lines below)
      // and NEVER funded from the portfolio, so any state-tax profile (e.g. NC base case) effectively
      // simulated as if it paid $0 state tax. It must be drawn from Roth alongside federal tax.
      // stateRate is 0 unless the profile sets hasStateIncomeTax + stateOfResidence, so this is a
      // no-op for severed-residency scenarios (Korea/international keep stateRate 0).
      const stateTaxBase = Math.max(0, magiBase - ssIncludable);
      const stateTax = stateTaxOn(stateTaxBase);

      // T6: lumpy expenses (e.g. rebuy a house) draw from brokerage first, Roth as overflow.
      //
      // BUG FIX 2026-06-11: RMD and inherited-IRA proceeds previously vanished — withdrawn from
      // pretax (and taxed via magiBase) but never spent nor reinvested. Cash income (SS + RMD +
      // inherited distributions) now covers recurring spending, then lumpy overflow, then the
      // year's tax bill; any remainder is reinvested in brokerage. Roth only funds what cash
      // income cannot.
      const recurringSpending = Math.max(0, annualSpending - oneTimeExpense);
      const lumpyFromBrokerage = Math.min(oneTimeExpense, brokerageBalance);
      const lumpyOverflowNeed = oneTimeExpense - lumpyFromBrokerage;

      const cashIncome = totalSSAnnual + rmd + inheritedDist;
      const cashUsedForSpending = Math.min(cashIncome, recurringSpending + lumpyOverflowNeed);
      const cashLeftAfterSpending = cashIncome - cashUsedForSpending;
      const cashUsedForTaxes = Math.min(cashLeftAfterSpending, totalTax + stateTax);
      const excessIncomeToBrokerage = cashLeftAfterSpending - cashUsedForTaxes;

      const rothSpendingNeed = recurringSpending + lumpyOverflowNeed - cashUsedForSpending;
      const rothTaxNeed = totalTax + stateTax - cashUsedForTaxes;

      // Funding cascade when Roth alone can't cover spending + taxes:
      //   Tier 1: Roth (rothAvailable = balance + conversion-in)
      //   Tier 2: emergency draw from pretax (preserves brokerage for tax-efficient growth)
      //   Tier 3: emergency draw from brokerage (last resort when both pretax and Roth depleted)
      // Bug fix 2026-05-15: prior code only had Tier 2 — when both Roth AND pretax were depleted
      // but brokerage had money, the engine silently failed to draw any spending. This made
      // extreme early-retirement scenarios appear feasible by phantom-zero-spending years.
      const totalRothNeed = rothTaxNeed + rothSpendingNeed;
      const rothAvailable = rothBalance + conversionAmount;
      let unfundedFromRoth = Math.max(0, totalRothNeed - rothAvailable);
      const rothOutflow = totalRothNeed - unfundedFromRoth;
      // Consume the accessibility ledger in IRS order; the composition drives pre-59½
      // penalties and earnings income in the one-pass block below.
      const rothDrawComposition = drawFromRoth(rothLedger, rothOutflow, year);

      const emergencyPretaxDraw = Math.min(
        unfundedFromRoth,
        Math.max(0, pretaxBalance - rmd - conversionAmount)
      );
      unfundedFromRoth -= emergencyPretaxDraw;

      const emergencyBrokerageDraw = Math.min(unfundedFromRoth, brokerageBalance - lumpyFromBrokerage);
      // Note: unfundedFromRoth after this still > 0 means TRUE depletion — Roth+pretax+brokerage all empty.
      // The engine doesn't synthetically create money; the portfolio simply runs out and downstream
      // probability calc will flag it. MC depletion-floor (< $10k) will count the trial as a failure.

      // BUG FIX 2026-06-11 (#3): the emergency pretax draw is ordinary income, and brokerage
      // draws (lumpy + emergency) realize gains — none of this previously entered MAGI or the
      // tax bill, so precisely the stressed years near the feasibility boundary were
      // under-taxed. One-pass gross-up: tax the extra income at the bracket-true increment
      // (gains at ordinary rates for now; LTCG stacking is a planned refinement), fund it from
      // whatever remains (Roth → pretax → brokerage), and report the grossed-up MAGI so
      // ACA/IRMAA see it. The funding draws themselves are not re-taxed — documented one-pass
      // approximation.
      const emergencyRealizedGains =
        (lumpyFromBrokerage + emergencyBrokerageDraw) * brokerageGainRatio;
      // Pre-59½ consequences of this year's draws: Roth-earnings draws are ordinary income;
      // unseasoned-conversion and earnings draws carry the 10% recapture; emergency pretax
      // draws carry 10% unless the profile's exemption (72t / rule-of-55) applies. Post-59½
      // all of this is 0 (earnings draws become qualified).
      const gatingAge = gatingAgeForYear(year);
      const isPre59 = gatingAge < 59.5;
      const rothEarningsDrawn = isPre59 ? rothDrawComposition.fromEarnings : 0;
      const rothPenalty = isPre59
        ? 0.10 * (rothDrawComposition.fromUnseasonedConversions + rothDrawComposition.fromEarnings)
        : 0;
      const pretaxDrawPenalty = pretaxPenaltyRateAt(gatingAge) * emergencyPretaxDraw;
      const earlyWithdrawalPenalty = rothPenalty + pretaxDrawPenalty;

      // Ordinary extras (emergency pretax draw, Roth-earnings income) raise the bracket
      // floor; realized gains stack above it on the LTCG schedule (2026-06-11 — previously
      // gains here escaped tax entirely, then briefly were ordinary-taxed). State taxes
      // gains as ordinary income. The senior deduction is re-derived from the final MAGI;
      // the extra-tax increment absorbs any difference from the base pass.
      const extraOrdinaryIncome = emergencyPretaxDraw + rothEarningsDrawn;
      const extraTaxableIncome = extraOrdinaryIncome + emergencyRealizedGains;
      const seniorDeduction = calculateSeniorDeduction(
        year, profile.filingStatus, magiBase + extraTaxableIncome, personsAged65Plus
      );
      const taxableWithExtra = Math.max(
        0, magiBase + extraOrdinaryIncome - stdDeduction - seniorDeduction
      );
      const extraFederalTax =
        calculateOrdinaryIncomeTax(taxableWithExtra, profile.filingStatus, FEDERAL_INCOME_TAX_BRACKETS_2025)
        - totalTax;
      const taxableGains =
        Math.max(0, magiBase + extraOrdinaryIncome + emergencyRealizedGains - stdDeduction - seniorDeduction) -
        taxableWithExtra;
      const capitalGainsTax = calculateLtcgTax(taxableGains, taxableWithExtra, profile.filingStatus);
      const niit = calculateNiit(
        emergencyRealizedGains, magiBase + extraTaxableIncome, profile.filingStatus
      );
      const extraStateTax = stateTaxOn(stateTaxBase + extraTaxableIncome) - stateTax;
      const extraTaxNeed = extraFederalTax + capitalGainsTax + niit + extraStateTax + earlyWithdrawalPenalty;

      const rothLeftAfterOutflow = Math.max(0, rothAvailable - rothOutflow);
      const extraFromRoth = Math.min(extraTaxNeed, rothLeftAfterOutflow);
      const pretaxLeft = Math.max(0, pretaxBalance - rmd - conversionAmount - emergencyPretaxDraw);
      const extraFromPretax = Math.min(extraTaxNeed - extraFromRoth, pretaxLeft);
      const brokerageLeft = Math.max(0, brokerageBalance - lumpyFromBrokerage - emergencyBrokerageDraw);
      const extraFromBrokerage = Math.min(extraTaxNeed - extraFromRoth - extraFromPretax, brokerageLeft);
      // The funding draw itself consumes the ledger but is not re-penalized (one-pass).
      drawFromRoth(rothLedger, extraFromRoth, year);

      magi = magiBase + extraTaxableIncome;

      // Roth outflow is attributed to taxes first ("Roth pays taxes + living"); the remainder
      // is spending. Emergency draws cover whatever Roth could not.
      const rothFundingForTaxes = Math.min(rothTaxNeed, rothOutflow);
      const rothSpendingDraw = rothOutflow - rothFundingForTaxes;

      // Component split for reporting: ordinary tax is what the year would owe with no
      // conversion; the conversion's share is the bracket-true increment on top; gains are
      // their own LTCG component. Sums to the single computed liability — no double count.
      const totalFederalLiability = totalTax + extraFederalTax + capitalGainsTax + niit;
      const taxableExConversion = Math.max(
        0,
        magiBase + extraOrdinaryIncome - conversionAmount - stdDeduction - seniorDeduction
      );
      const ordinaryIncomeTax = calculateOrdinaryIncomeTax(
        taxableExConversion,
        profile.filingStatus,
        FEDERAL_INCOME_TAX_BRACKETS_2025
      );
      const rothConversionTax = totalTax + extraFederalTax - ordinaryIncomeTax;

      rothConversion = {
        conversionAmount,
        marginalRate,
        taxOnConversion: rothConversionTax,
        brokerageFundingAmount: 0,
        rothFundingAmount: rothFundingForTaxes + extraFromRoth, // taxes paid from Roth, net of cash income
      };

      withdrawals = {
        fromPretax: rmd + emergencyPretaxDraw + extraFromPretax,
        fromBrokerage: lumpyFromBrokerage + emergencyBrokerageDraw + extraFromBrokerage,
        fromRoth: rothSpendingDraw,
        total: rmd + emergencyPretaxDraw + extraFromPretax + rothSpendingDraw
          + lumpyFromBrokerage + emergencyBrokerageDraw + extraFromBrokerage,
      };

      // Portfolio updates
      const portfolioStart = pretaxBalance + rothBalance + brokerageBalance + inheritedIraBalance + hsaBalance;

      pretaxBalance = Math.max(
        0,
        pretaxBalance - rmd - emergencyPretaxDraw - conversionAmount - extraFromPretax
      );
      // Roth: gains conversion, pays taxes (federal + state) and spending net of cash income
      rothBalance = Math.max(0, rothBalance + conversionAmount - rothOutflow - extraFromRoth);
      // T6: brokerage funds the lumpy expense; Tier-3 fallback also draws from brokerage when
      // Roth + pretax cannot cover annual spending. Excess cash income (large-RMD years) is
      // reinvested here.
      brokerageBalance = Math.max(
        0,
        brokerageBalance - lumpyFromBrokerage - emergencyBrokerageDraw - extraFromBrokerage
          + excessIncomeToBrokerage
      );
      inheritedIraBalance = Math.max(0, inheritedIraBalance - inheritedDist);
      hsaBalance = Math.max(0, hsaBalance - fromHsa);

      pretaxBalance *= 1 + yearGrowthRate;
      brokerageBalance *= 1 + yearGrowthRate;
      rothBalance *= 1 + yearGrowthRate;
      inheritedIraBalance *= 1 + yearGrowthRate;
      hsaBalance *= 1 + yearGrowthRate;

      const portfolioEnd = pretaxBalance + rothBalance + brokerageBalance + inheritedIraBalance + hsaBalance;

      // ACA eligibility uses conversion-driven MAGI (may be over cliff — expected for this
      // strategy), with the non-taxable 15% of SS added back (ACA MAGI counts 100% of SS).
      const acaResult = season === 'aca'
        ? assessAcaEligibility(magi + totalSSAnnual * 0.15, householdSize)
        : null;
      const irmaaSurcharge =
        season === 'medicare' || season === 'rmd'
          ? calculateIrmaaSurcharge(getLookbackMagi(magi), profile.filingStatus, personsAged65Plus)
          : 0;

      // State tax (stateTaxBase/stateTax computed above, where it is also funded from Roth).
      const taxLiability: TaxLiability = {
        ordinaryIncomeTax,
        capitalGainsTax,
        rothConversionTax,
        totalFederalTax: totalFederalLiability,
        stateTax: stateTax + extraStateTax,
        effectiveRate: magi > 0 ? totalFederalLiability / magi : 0,
        earlyWithdrawalPenalty,
        niit,
      };
      const preFiftyNineHalfShortfall = isPre59
        ? rothDrawComposition.fromUnseasonedConversions + rothDrawComposition.fromEarnings
        : 0;
      const capitalGainsRealized = emergencyRealizedGains;

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
        preFiftyNineHalfShortfall,
        capitalGainsRealized,
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

      // The RMD leaves pretax regardless of the spending gap (withdrawals.fromPretax adds it
      // below) — gap draws may only touch what remains, or large-RMD years overdraw the account.
      const pretaxAvailableForGap = Math.max(0, pretaxBalance - rmd);

      let fromBrokerage = 0;
      let fromPretax = 0;
      let fromRoth = 0;

      if (season === 'cobra' || season === 'international' || season === 'self_insure') {
        fromBrokerage = Math.min(nonEssentialSpend, brokerageBalance, incomeGap);
        const remainingGap = incomeGap - fromBrokerage;
        fromPretax = Math.min(remainingGap, pretaxAvailableForGap);
        fromRoth = Math.max(0, remainingGap - fromPretax);
      } else if (season === 'aca') {
        // Plan the sequence so MAGI stays under the cliff. Brokerage withdrawals now count their
        // realized-gain portion (brokerageGainRatio × amount); only basis is MAGI-invisible.
        // Roth is pulled before pretax when brokerage's MAGI impact would otherwise exceed the
        // cliff — this captures the video-informed "Roth as ACA bridge" strategy.
        const ACA_CLIFF = getAcaCliff(householdSize);
        // ACA MAGI counts 100% of Social Security — the non-taxable portion is added back
        // (85% is the income-tax inclusion cap only). Bites ACA years with early-claimed SS.
        const passiveMagi = inheritedDist + totalSSAnnual + taxableOneTimeIncome;
        const totalMagiHeadroom = Math.max(0, ACA_CLIFF - passiveMagi - 1);
        // How much brokerage can we pull before its gains alone exhaust the cliff?
        const brokerageCapByMagi =
          brokerageGainRatio > 0 ? totalMagiHeadroom / brokerageGainRatio : Infinity;
        fromBrokerage = Math.min(incomeGap, brokerageBalance, brokerageCapByMagi);
        const magiAfterBrokerage = passiveMagi + fromBrokerage * brokerageGainRatio;
        const pretaxMagiCapacity = Math.max(0, ACA_CLIFF - magiAfterBrokerage - 1);
        const afterBrokerage = incomeGap - fromBrokerage;
        fromPretax = Math.min(afterBrokerage, pretaxAvailableForGap, pretaxMagiCapacity);
        const afterPretax = afterBrokerage - fromPretax;
        fromRoth = Math.min(afterPretax, rothBalance);
      } else {
        fromPretax = Math.min(incomeGap, pretaxAvailableForGap);
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

      // Pre-59½ Roth ordering: the spending draw consumes the accessibility ledger now so its
      // composition (penalty + any earnings income) is known before the tax math. The season
      // planners above did not anticipate earnings income, so a pre-59½ ACA year drawing Roth
      // earnings can exceed the cliff — the eligibility assessment below sees the honest MAGI.
      const rothDrawComposition = drawFromRoth(rothLedger, fromRoth, year);
      const gatingAge = gatingAgeForYear(year);
      const isPre59 = gatingAge < 59.5;
      const rothEarningsDrawn = isPre59 ? rothDrawComposition.fromEarnings : 0;

      magi = calculateMAGI({
        socialSecurityIncludable: totalSSAnnual * 0.85,
        pretaxWithdrawals: fromPretax + rmd,
        rothConversionAmount: 0,
        capitalGainsRealized: brokerageRealizedGains,
        // BUG FIX 2026-06-11: taxable one-time injections previously escaped MAGI and tax
        // entirely in this branch (conversion-primary handled them).
        otherIncome: inheritedDist + rothEarningsDrawn + taxableOneTimeIncome,
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
          // Net of this year's withdrawals — the conversion moves what is actually still there.
          pretaxBalance: Math.max(0, pretaxBalance - withdrawals.fromPretax),
          brokerageBalance,
          filingStatus: profile.filingStatus,
          targetBracketCeiling: TARGET_BRACKET_CEILING,
        });
      }

      const magiWithConversion = magi + (rothConversion?.conversionAmount ?? 0);
      if (rothConversion) addConversionLot(rothLedger, year, rothConversion.conversionAmount);

      // ACA assessment adds back the non-taxable 15% of SS (ACA MAGI counts 100% of SS);
      // the reported magi stays tax-MAGI (85% SS) for bracket math and the IRMAA lookback.
      const acaResult = season === 'aca'
        ? assessAcaEligibility(magiWithConversion + totalSSAnnual * 0.15, householdSize)
        : null;
      const irmaaSurcharge =
        season === 'medicare' || season === 'rmd'
          ? calculateIrmaaSurcharge(getLookbackMagi(magiWithConversion), profile.filingStatus, personsAged65Plus)
          : 0;

      // Real-internal: MAGI is already in current-year real dollars; tax brackets and the
      // standard deduction are real-sticky (IRS indexes them), so compute tax directly.
      //
      // BUG FIX 2026-06-11: federal ordinary income tax was reported here but NEVER deducted
      // from the portfolio — only the conversion's marginal-rate tax estimate (via the
      // rothConversion funding amounts) and, since 2026-05-29, state tax were funded. Federal
      // sibling of the state-tax bug fixed in 3b30a41. Liability is now computed once on full
      // MAGI (with conversion); the conversion's share is the bracket-true increment
      // tax(with) − tax(without), reported as a component of totalFederalTax rather than added
      // on top (the old form double-counted it in totalFederalTax/lifetime aggregates).
      // LTCG (2026-06-11): realized brokerage gains stay in MAGI (ACA/IRMAA see them) but are
      // taxed on the capital-gains schedule stacked above ordinary taxable income — previously
      // they were taxed at ordinary rates. Deductions (standard + OBBBA senior) unused by
      // ordinary income shelter gains first.
      const seniorDeduction = calculateSeniorDeduction(
        year, profile.filingStatus, magiWithConversion, personsAged65Plus
      );
      const deduction = stdDeduction + seniorDeduction;
      const ordinaryMagiWithConversion = magiWithConversion - brokerageRealizedGains;
      const taxableWithConversion = Math.max(0, ordinaryMagiWithConversion - deduction);
      const totalOrdinaryLiability = calculateOrdinaryIncomeTax(
        taxableWithConversion,
        profile.filingStatus,
        FEDERAL_INCOME_TAX_BRACKETS_2025
      );
      const taxableBase = Math.max(0, magi - brokerageRealizedGains - deduction);
      const ordinaryIncomeTax = calculateOrdinaryIncomeTax(
        taxableBase,
        profile.filingStatus,
        FEDERAL_INCOME_TAX_BRACKETS_2025
      );
      const rothConversionTax = totalOrdinaryLiability - ordinaryIncomeTax;
      const taxableGains =
        Math.max(0, ordinaryMagiWithConversion + brokerageRealizedGains - deduction) -
        taxableWithConversion;
      const capitalGainsTax = calculateLtcgTax(taxableGains, taxableWithConversion, profile.filingStatus);
      const niit = calculateNiit(brokerageRealizedGains, magiWithConversion, profile.filingStatus);
      const totalFederalLiability = totalOrdinaryLiability + capitalGainsTax + niit;

      // State income tax on non-SS income (progressive steps where the state defines them).
      // stateTaxOn is 0 unless the profile is state-taxed — no-op for severed residency.
      // BUG FIX 2026-06-11 (#14): the conversion was previously excluded from this branch's
      // state base; states tax conversions as ordinary income, same as federal.
      const stateTaxBase = Math.max(0, magiWithConversion - totalSSAnnual * 0.85);
      const stateTax = stateTaxOn(stateTaxBase);

      // Pre-59½ penalties: 10% on the pretax gap draw (unless the profile's exemption
      // applies) and on the penalized portions of the Roth spending draw. The tax-funding
      // draws in the cascade below are not re-penalized (one-pass).
      const rothPenalty = isPre59
        ? 0.10 * (rothDrawComposition.fromUnseasonedConversions + rothDrawComposition.fromEarnings)
        : 0;
      const pretaxDrawPenalty = pretaxPenaltyRateAt(gatingAge) * fromPretax;
      const earlyWithdrawalPenalty = rothPenalty + pretaxDrawPenalty;

      const taxLiability: TaxLiability = {
        ordinaryIncomeTax,
        capitalGainsTax,
        rothConversionTax,
        totalFederalTax: totalFederalLiability,
        stateTax,
        effectiveRate:
          magiWithConversion > 0 ? totalFederalLiability / magiWithConversion : 0,
        earlyWithdrawalPenalty,
        niit,
      };
      const preFiftyNineHalfShortfall = isPre59
        ? rothDrawComposition.fromUnseasonedConversions + rothDrawComposition.fromEarnings
        : 0;
      const capitalGainsRealized = brokerageRealizedGains;

      magi = magiWithConversion;

      const portfolioStart =
        pretaxBalance + rothBalance + brokerageBalance + inheritedIraBalance + hsaBalance;

      // ─── Tax funding ───────────────────────────────────────────────────────
      // Balances left after the spending withdrawals and the conversion transfer — funding
      // draws are computed against these so they can never overdraw a dollar the withdrawals
      // already spent.
      const rothAfter = Math.max(0,
        rothBalance - withdrawals.fromRoth + (rothConversion?.conversionAmount ?? 0));
      const brokerageAfter = Math.max(0,
        brokerageBalance - withdrawals.fromBrokerage);
      const pretaxAfter = Math.max(0,
        pretaxBalance - withdrawals.fromPretax - (rothConversion?.conversionAmount ?? 0));

      // Conversion-increment tax: brokerage first (the surplus-funded conversion model), Roth
      // as overflow — the same split calculateRothConversion estimates, but sized to the
      // bracket-true increment rather than the flat marginal-rate guess.
      const convTaxFromBrokerage = Math.min(rothConversionTax, brokerageAfter);
      const convTaxFromRoth = Math.min(rothConversionTax - convTaxFromBrokerage, rothAfter);
      if (rothConversion) {
        rothConversion = {
          ...rothConversion,
          taxOnConversion: rothConversionTax,
          brokerageFundingAmount: convTaxFromBrokerage,
          rothFundingAmount: convTaxFromRoth,
        };
      }

      // Non-conversion federal tax + state tax + early-withdrawal penalties (+ any conversion
      // tax brokerage/Roth couldn't cover): Roth → brokerage → pretax cascade. MAGI-invisible
      // sources first to avoid a tax-on-tax spiral; pretax is the last resort and that portion
      // is not grossed up — same documented simplification as the state-tax fix. Anything still
      // unfunded after pretax is true depletion; downstream depletion/probability checks flag it.
      let residualTax =
        ordinaryIncomeTax + capitalGainsTax + niit + stateTax + earlyWithdrawalPenalty
        + (rothConversionTax - convTaxFromBrokerage - convTaxFromRoth);

      // BUG FIX 2026-06-11: excess cash income over spending (large-RMD years, SS above spending)
      // previously vanished — withdrawn and taxed but neither spent nor reinvested. It now pays
      // the tax bill first; the remainder is reinvested in brokerage.
      const excessIncome = Math.max(0, income.total - annualSpending);
      const residualFromCash = Math.min(excessIncome, residualTax);
      residualTax -= residualFromCash;
      const excessIncomeToBrokerage = excessIncome - residualFromCash;

      const residualFromRoth = Math.min(Math.max(0, rothAfter - convTaxFromRoth), residualTax);
      residualTax -= residualFromRoth;
      const residualFromBrokerage = Math.min(
        Math.max(0, brokerageAfter - convTaxFromBrokerage),
        residualTax
      );
      residualTax -= residualFromBrokerage;
      const residualFromPretax = Math.min(pretaxAfter, residualTax);
      // Tax-funding Roth draws consume the ledger but are not re-penalized (one-pass).
      drawFromRoth(rothLedger, convTaxFromRoth + residualFromRoth, year);

      pretaxBalance = Math.max(
        0,
        pretaxBalance - withdrawals.fromPretax - (rothConversion?.conversionAmount ?? 0) - residualFromPretax
      );
      brokerageBalance = Math.max(
        0,
        brokerageBalance - withdrawals.fromBrokerage - convTaxFromBrokerage - residualFromBrokerage
          + excessIncomeToBrokerage
      );
      rothBalance = Math.max(
        0,
        rothBalance
          - withdrawals.fromRoth
          + (rothConversion?.conversionAmount ?? 0)
          - convTaxFromRoth
          - residualFromRoth
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
        preFiftyNineHalfShortfall,
        capitalGainsRealized,
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
  let penaltiesPaidReal = 0;
  for (const proj of yearlyProjections) {
    retirementFederalTaxReal += proj.taxLiability.totalFederalTax;
    retirementStateTaxReal   += proj.taxLiability.stateTax;
    penaltiesPaidReal        += proj.taxLiability.earlyWithdrawalPenalty ?? 0;
  }

  // Working-year state tax on conversions (proportion of combined rate that is state).
  const combinedRate = profile.savingsStrategy?.marginalTaxRateFedState ?? 0;
  const stateRateForStrategy = combinedRate > 0 && stateRate > 0
    ? Math.min(stateRate / combinedRate, 1)
    : 0;
  // Inherited-IRA distributions taken during accumulation share the same combined-rate split.
  const accumulationStateTaxReal =
    (accumulationConversionTaxReal + accumulationInheritedTaxReal) * stateRateForStrategy;
  const accumulationFederalTaxReal =
    accumulationConversionTaxReal + accumulationInheritedTaxReal - accumulationStateTaxReal;

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
    earlyWithdrawalPenaltiesPaid: penaltiesPaidReal,
    totalTaxPaid: lifetimeFederalTaxReal + lifetimeStateTaxReal + penaltiesPaidReal,
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
    ...(simulationWarnings.length > 0 && { warnings: simulationWarnings }),
  };
}
