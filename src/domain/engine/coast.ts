// Coast FIRE phase engine.
//
// A Coast phase is a year-window between accumulation and full retirement where the
// household lives abroad and earns reduced income. During Coast:
//   - Portfolio does not receive contributions (compounds untouched)
//   - Coast income covers spending; deficit draws from brokerage (basis-aware), then Roth
//   - Optional Roth conversions add to MAGI and US federal tax
//   - Foreign tax computed via foreign-tax framework with country-specific regime
//   - US federal tax computed normally; Foreign Tax Credit offsets it
//   - State tax: respects profile.hasStateIncomeTax (NC domicile during Coast = NC tax owed)
//
// Output is a YearlyProjection per year, season='coast', for chaining with
// retirement loop. State (balances) is mutated in caller's variables for continuity.

import type { ClientProfile, CoastPhase } from '../types/profile';
import type { SpendingProfile } from '../types/spending';
import type {
  YearlyProjection,
  IncomeBreakdown,
  WithdrawalBreakdown,
  TaxLiability,
  RothConversionEvent,
} from '../types/simulation';
import { calculateForeignTax } from './foreign-tax';
import {
  calculateOrdinaryIncomeTax,
  getMarginalRate,
} from './tax-utils';
import {
  FEDERAL_INCOME_TAX_BRACKETS_2025,
  STANDARD_DEDUCTION_2025,
  getBracketCeiling,
} from '../constants/tax-brackets';
import { getStateInfo } from '../constants/states';
import {
  netAcaPremium,
  getAcaCliff,
  ACA_FULL_PREMIUM_PER_PERSON,
} from '../constants/aca-thresholds';

export interface CoastStepState {
  pretaxBalance: number;
  rothBalance: number;
  brokerageBalance: number;
  inheritedIraBalance: number;
  hsaBalance: number;
  /** Running peak portfolio for guardrail tracking (carries through from accumulation). */
  peakPortfolio: number;
  /** Brokerage cost basis (real USD). Updated when Coast surplus is added.
   *  Caller must initialize from current basis (or 0 if not tracked separately). */
  brokerageCostBasis: number;
}

export interface CoastStepInputs {
  year: number;
  phase: CoastPhase;
  profile: ClientProfile;
  spending: SpendingProfile;
  growthRate: number;
  state: CoastStepState;
  /** Portion of brokerage balance that is gain (taxable on withdrawal); 1 - gainRatio is basis.
   *  Engine recomputes this dynamically as state.brokerageBalance and state.brokerageCostBasis change. */
  brokerageGainRatio: number;
  /** This year's forced inherited-IRA distribution (10-year clock runs on calendar years).
   *  Taxed as US-source ordinary income; proceeds cover spending, excess reinvests in brokerage. */
  inheritedIraDistribution?: number;
}

export function runCoastStep(inputs: CoastStepInputs): YearlyProjection {
  const { year, phase, profile, spending, growthRate, state } = inputs;
  const inheritedIraDistribution = Math.min(
    inputs.inheritedIraDistribution ?? 0,
    state.inheritedIraBalance
  );
  const clientAge = profile.client.age + (year - profile.currentYear);
  const spouseAge = profile.spouse
    ? profile.spouse.age + (year - profile.currentYear)
    : null;

  const portfolioStartBalance =
    state.pretaxBalance +
    state.rothBalance +
    state.brokerageBalance +
    state.inheritedIraBalance +
    state.hsaBalance;

  // ─── Income from Coast phase ────────────────────────────────────────────
  const isUsCoast = phase.location === 'us';
  // US coast: all income is US-source by definition. Foreign coast: split per usSourceIncomePct.
  const usSourceIncome = isUsCoast
    ? phase.annualIncome
    : phase.annualIncome * phase.usSourceIncomePct;
  const hostSourceIncome = phase.annualIncome - usSourceIncome;
  const stdDeduction = STANDARD_DEDUCTION_2025[profile.filingStatus];

  // Conversion sizing. US coast with no explicit annualConversion: auto-fill the remaining room
  // up to profile.targetBracket *above* the coast salary — i.e. convert whatever cheap-bracket
  // room the salary leaves (this is the realistic "coast and keep laddering" behavior). Foreign
  // coast (or explicit annualConversion): use the given amount (default 0).
  let desiredConversion = phase.annualConversion ?? 0;
  if (isUsCoast && phase.annualConversion == null && profile.targetBracket) {
    const ceiling = getBracketCeiling(
      profile.targetBracket,
      profile.filingStatus,
      FEDERAL_INCOME_TAX_BRACKETS_2025
    );
    desiredConversion = Math.max(0, ceiling + stdDeduction - usSourceIncome);
  }

  // ─── Roth conversion (pretax → Roth) ─────────────────────────────────────
  const actualConversion = Math.min(desiredConversion, state.pretaxBalance);
  state.pretaxBalance -= actualConversion;
  state.rothBalance += actualConversion;

  // ─── Inherited-IRA distribution (forced, calendar clock) ─────────────────
  state.inheritedIraBalance = Math.max(0, state.inheritedIraBalance - inheritedIraDistribution);

  // ─── US federal tax on US-source income + conversion ────────────────────
  // Standard deduction reduces taxable amount (assumes Coast household files US taxes).
  // Inherited-IRA distributions are US-source ordinary income wherever the household lives.
  const usOrdinaryIncome = usSourceIncome + actualConversion + inheritedIraDistribution;
  const usTaxableIncome = Math.max(0, usOrdinaryIncome - stdDeduction);
  const usFedTaxGross = calculateOrdinaryIncomeTax(
    usTaxableIncome,
    profile.filingStatus,
    FEDERAL_INCOME_TAX_BRACKETS_2025
  );

  // ─── Foreign tax via regime framework (foreign coast only) + FTC ─────────
  // Simplified: FTC offsets US fed tax up to the amount of foreign tax paid.
  // Real Form 1116 has per-category limits; this is a planning approximation.
  let foreignTax = 0;
  let foreignTaxCredit = 0;
  if (!isUsCoast && phase.taxRegime) {
    const foreignResult = calculateForeignTax(phase.taxRegime, {
      hostSourceIncome,
      // US-source income from the host country's perspective; inherited-IRA distributions
      // received while host-resident are included (planning approximation — pension-article
      // treaty treatment varies by country).
      foreignSourceIncome: usSourceIncome + inheritedIraDistribution,
      rothConversionAmount: actualConversion,
      capitalGains: 0, // Set after brokerage draw if needed; first pass assumes no realized gains
      socialSecurityIncludable: 0, // SS not started during Coast
      remittedToHostCountry: phase.annualRemittanceToHost ?? 0,
      conversionTreatyProtection: phase.conversionTreatyProtection ?? 'fully_taxed',
      taiwanAmtInclusionMode: phase.taiwanAmtInclusionMode,
    });
    foreignTax = foreignResult.foreignTax;
    foreignTaxCredit = Math.min(foreignTax, usFedTaxGross);
  }
  const usFedTaxAfterFtc = Math.max(0, usFedTaxGross - foreignTaxCredit);

  // ─── State tax ───────────────────────────────────────────────────────────
  // If profile maintains a US state domicile, state tax on US-source income applies.
  // US coast stays domiciled (e.g. NC); foreign coast typically severs to a no-tax domicile.
  // Profile.hasStateIncomeTax controls this.
  const stateRate = profile.hasStateIncomeTax
    ? getStateInfo(profile.stateOfResidence)?.topMarginalRate ?? 0
    : 0;
  const stateTax = usOrdinaryIncome * stateRate;

  // ─── ACA net premium (US coast only) ─────────────────────────────────────
  // On the marketplace during the coast. MAGI = salary + conversion (SS not started; brokerage-
  // draw cap gains excluded — conservative for eligibility). Net premium follows the household-
  // size phase-out + 400% FPL cliff. For US-coast profiles the base essential should EXCLUDE
  // healthcare; the engine adds the size-aware ACA premium here.
  const usCoastHouseholdSize = phase.acaHouseholdSize ?? profile.acaHouseholdSize ?? 2;
  const usCoastMagi = usOrdinaryIncome; // salary + conversion
  const acaNetPremium = isUsCoast ? netAcaPremium(usCoastMagi, usCoastHouseholdSize) : 0;

  const totalTaxLiability = usFedTaxAfterFtc + foreignTax + stateTax;

  // ─── Spending and shortfall draws ───────────────────────────────────────
  // US coast adds the net ACA premium on top of base living (base essential should be ex-healthcare
  // for US-coast profiles). Foreign coast: acaNetPremium is 0 (healthcare handled by host regime).
  const baseSpending = spending.baseAnnualSpending + acaNetPremium;
  const netIncomeAfterTax = phase.annualIncome + inheritedIraDistribution - totalTaxLiability;
  const spendingShortfall = baseSpending - netIncomeAfterTax;

  let fromBrokerage = 0;
  let fromRoth = 0;
  let capitalGains = 0;
  let surplusToBrokerage = 0;
  if (spendingShortfall > 0) {
    fromBrokerage = Math.min(spendingShortfall, state.brokerageBalance);
    // Reduce balance and basis proportionally (basis pro-rates with draw)
    const drawBasisRatio = state.brokerageBalance > 0 ? state.brokerageCostBasis / state.brokerageBalance : 1;
    state.brokerageCostBasis -= fromBrokerage * drawBasisRatio;
    state.brokerageBalance -= fromBrokerage;
    capitalGains = fromBrokerage * (1 - drawBasisRatio);
    if (fromBrokerage < spendingShortfall) {
      const rothNeed = spendingShortfall - fromBrokerage;
      fromRoth = Math.min(rothNeed, state.rothBalance);
      state.rothBalance -= fromRoth;
    }
  } else if (spendingShortfall < 0) {
    const surplus = -spendingShortfall;
    // Surplus → taxable brokerage with 100% cost basis (post-tax cash contribution).
    // Forced inherited-IRA proceeds always reinvest — they are distributed principal, not
    // lifestyle cash. Salary surplus keeps the documented evaporate-by-default behavior
    // unless routeSurplusToBrokerage opts in.
    surplusToBrokerage = phase.routeSurplusToBrokerage
      ? surplus
      : Math.min(surplus, inheritedIraDistribution);
    state.brokerageBalance += surplusToBrokerage;
    state.brokerageCostBasis += surplusToBrokerage;
  }
  // Any remaining salary surplus is treated as unmodeled cash (consumed for lifestyle, lost
  // from the investment perspective).

  // ─── Apply growth ───────────────────────────────────────────────────────
  state.pretaxBalance       *= 1 + growthRate;
  state.rothBalance         *= 1 + growthRate;
  state.brokerageBalance    *= 1 + growthRate;
  state.inheritedIraBalance *= 1 + growthRate;
  state.hsaBalance          *= 1 + growthRate;

  const portfolioEndBalance =
    state.pretaxBalance +
    state.rothBalance +
    state.brokerageBalance +
    state.inheritedIraBalance +
    state.hsaBalance;
  state.peakPortfolio = Math.max(state.peakPortfolio, portfolioEndBalance);

  // ─── Construct outputs ──────────────────────────────────────────────────
  const income: IncomeBreakdown = {
    socialSecurityClient: 0,
    socialSecuritySpouse: 0,
    requiredMinimumDistribution: 0,
    inheritedIraDistribution,
    otherIncome: phase.annualIncome,
    total: phase.annualIncome + inheritedIraDistribution,
  };

  const withdrawals: WithdrawalBreakdown = {
    fromPretax: 0,
    fromBrokerage,
    fromRoth,
    total: fromBrokerage + fromRoth,
  };

  const rothConversion: RothConversionEvent | null =
    actualConversion > 0
      ? {
          conversionAmount: actualConversion,
          marginalRate: getMarginalRate(usTaxableIncome, profile.filingStatus),
          taxOnConversion: 0, // Tax embedded in usFedTaxAfterFtc + foreignTax; not separately broken out
          brokerageFundingAmount: 0, // Coast conversions: tax paid from current income, not from brokerage draw
          rothFundingAmount: 0,
        }
      : null;

  const totalForeignRelated =
    phase.annualIncome + actualConversion + capitalGains;
  const effectiveRate = totalForeignRelated > 0 ? totalTaxLiability / totalForeignRelated : 0;

  const taxLiability: TaxLiability = {
    ordinaryIncomeTax: usFedTaxAfterFtc,
    capitalGainsTax: 0, // Brokerage gains realized during draws aren't separately taxed for planning; conservative
    rothConversionTax: 0,
    totalFederalTax: usFedTaxAfterFtc,
    stateTax,
    foreignTax,
    foreignTaxCredit,
    effectiveRate,
  };

  // MAGI for US ACA purposes. Foreign coast: abroad, not on ACA. US coast: drives eligibility.
  const magi = usOrdinaryIncome + capitalGains;
  const acaEligible = isUsCoast ? usCoastMagi < getAcaCliff(usCoastHouseholdSize) : false;
  const acaFullPremium = isUsCoast
    ? ACA_FULL_PREMIUM_PER_PERSON * Math.max(1, Math.round(usCoastHouseholdSize))
    : 0;

  return {
    year,
    clientAge,
    spouseAge,
    season: 'coast',
    income,
    withdrawals,
    rothConversion,
    taxLiability,
    portfolioStartBalance,
    portfolioEndBalance,
    pretaxEndBalance: state.pretaxBalance,
    rothEndBalance: state.rothBalance,
    brokerageEndBalance: state.brokerageBalance,
    magi,
    acaSubsidyEligible: acaEligible,
    estimatedAcaSavings: isUsCoast ? Math.max(0, acaFullPremium - acaNetPremium) : 0,
    irmaaApplies: false,
    irmaaSurcharge: 0,
    guardrailCutPct: 0,
    peakPortfolio: state.peakPortfolio,
  };
}
