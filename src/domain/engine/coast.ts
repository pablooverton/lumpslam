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
} from '../constants/tax-brackets';
import { getStateInfo } from '../constants/states';

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
}

export function runCoastStep(inputs: CoastStepInputs): YearlyProjection {
  const { year, phase, profile, spending, growthRate, state } = inputs;
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
  const usSourceIncome = phase.annualIncome * phase.usSourceIncomePct;
  const hostSourceIncome = phase.annualIncome - usSourceIncome;
  const desiredConversion = phase.annualConversion ?? 0;

  // ─── Roth conversion (pretax → Roth) ─────────────────────────────────────
  const actualConversion = Math.min(desiredConversion, state.pretaxBalance);
  state.pretaxBalance -= actualConversion;
  state.rothBalance += actualConversion;

  // ─── US federal tax on US-source income + conversion ────────────────────
  // Standard deduction reduces taxable amount (assumes Coast household files US taxes).
  const stdDeduction = STANDARD_DEDUCTION_2025[profile.filingStatus];
  const usOrdinaryIncome = usSourceIncome + actualConversion;
  const usTaxableIncome = Math.max(0, usOrdinaryIncome - stdDeduction);
  const usFedTaxGross = calculateOrdinaryIncomeTax(
    usTaxableIncome,
    profile.filingStatus,
    FEDERAL_INCOME_TAX_BRACKETS_2025
  );

  // ─── Foreign tax via regime framework ────────────────────────────────────
  const foreignResult = calculateForeignTax(phase.taxRegime, {
    hostSourceIncome,
    foreignSourceIncome: usSourceIncome,
    rothConversionAmount: actualConversion,
    capitalGains: 0, // Set after brokerage draw if needed; first pass assumes no realized gains
    socialSecurityIncludable: 0, // SS not started during Coast
    remittedToHostCountry: phase.annualRemittanceToHost ?? 0,
    conversionTreatyProtection: phase.conversionTreatyProtection,
    taiwanAmtInclusionMode: phase.taiwanAmtInclusionMode,
  });

  // ─── FTC application ─────────────────────────────────────────────────────
  // Simplified: FTC offsets US fed tax up to the amount of foreign tax paid.
  // Real Form 1116 has per-category limits; this is a planning approximation.
  const foreignTax = foreignResult.foreignTax;
  const foreignTaxCredit = Math.min(foreignTax, usFedTaxGross);
  const usFedTaxAfterFtc = Math.max(0, usFedTaxGross - foreignTaxCredit);

  // ─── State tax ───────────────────────────────────────────────────────────
  // If profile maintains a US state domicile, state tax on US-source income applies.
  // For most Coast scenarios, family establishes Florida or other no-tax domicile
  // before going abroad. Profile.hasStateIncomeTax controls this.
  const stateRate = profile.hasStateIncomeTax
    ? getStateInfo(profile.stateOfResidence)?.topMarginalRate ?? 0
    : 0;
  const stateTax = usOrdinaryIncome * stateRate;

  const totalTaxLiability = usFedTaxAfterFtc + foreignTax + stateTax;

  // ─── Spending and shortfall draws ───────────────────────────────────────
  const baseSpending = spending.baseAnnualSpending;
  const netIncomeAfterTax = phase.annualIncome - totalTaxLiability;
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
  } else if (spendingShortfall < 0 && phase.routeSurplusToBrokerage) {
    // Surplus → taxable brokerage with 100% cost basis (post-tax cash contribution).
    surplusToBrokerage = -spendingShortfall;
    state.brokerageBalance += surplusToBrokerage;
    state.brokerageCostBasis += surplusToBrokerage;
  }
  // If surplus exists but routeSurplusToBrokerage is false (default): surplus is treated as
  // unmodeled cash (consumed for lifestyle, lost from investment perspective).

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
    inheritedIraDistribution: 0,
    otherIncome: phase.annualIncome,
    total: phase.annualIncome,
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

  // MAGI for US ACA purposes — irrelevant during Coast (abroad, not on ACA) but populated for table consistency
  const magi = usOrdinaryIncome + capitalGains;

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
    acaSubsidyEligible: false,
    estimatedAcaSavings: 0,
    irmaaApplies: false,
    irmaaSurcharge: 0,
    guardrailCutPct: 0,
    peakPortfolio: state.peakPortfolio,
  };
}
