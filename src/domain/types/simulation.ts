// 'international' = pre-Medicare years when retirementLocation=international.
// 'self_insure'   = pre-Medicare years when healthcareCoverage=self_insure.
// 'coast'         = years inside a CoastPhase (Asia-based working bridge before full retirement).
// All four of cobra/international/self_insure/coast share engine rules: no ACA MAGI cliff,
// free conversions, healthcare cost handled outside the ACA-subsidy framework.
export type RetirementSeason = 'cobra' | 'aca' | 'medicare' | 'rmd' | 'international' | 'self_insure' | 'coast';

export interface IncomeBreakdown {
  socialSecurityClient: number;
  socialSecuritySpouse: number;
  requiredMinimumDistribution: number;
  inheritedIraDistribution: number;
  otherIncome: number;
  total: number;
}

export interface WithdrawalBreakdown {
  fromPretax: number;
  fromBrokerage: number;
  fromRoth: number;
  total: number;
}

export interface TaxLiability {
  ordinaryIncomeTax: number;
  capitalGainsTax: number;
  rothConversionTax: number;
  totalFederalTax: number;
  stateTax: number;       // top-marginal-rate applied to non-SS income; approximation for planning
  effectiveRate: number;
  /** Foreign tax owed during a Coast or international phase. Defaults to 0 for US-domestic years. */
  foreignTax?: number;
  /** US Foreign Tax Credit applied against US federal income tax. Equals foreignTax (simplified FTC). */
  foreignTaxCredit?: number;
  /** 10% additional tax on early withdrawals (pre-59½ pretax draws, unseasoned conversion
   *  draws, Roth-earnings draws). Reported separately from totalFederalTax so bracket math
   *  stays verifiable; funded from the portfolio like any other tax. */
  earlyWithdrawalPenalty?: number;
}

export interface RothConversionEvent {
  conversionAmount: number;
  marginalRate: number;
  taxOnConversion: number;        // Event 2 — paid from brokerage or Roth
  brokerageFundingAmount: number; // brokerage drawn to cover tax (0 when no brokerage)
  rothFundingAmount: number;      // Roth drawn to cover tax when brokerage is insufficient
}

export interface YearlyProjection {
  year: number;
  clientAge: number;
  spouseAge: number | null;
  season: RetirementSeason;
  income: IncomeBreakdown;
  withdrawals: WithdrawalBreakdown;
  rothConversion: RothConversionEvent | null;
  taxLiability: TaxLiability;
  portfolioStartBalance: number;
  portfolioEndBalance: number;
  // Per-account end balances (for charting the conversion trajectory)
  pretaxEndBalance: number;
  rothEndBalance: number;
  brokerageEndBalance: number;
  magi: number;
  acaSubsidyEligible: boolean;
  estimatedAcaSavings: number;
  irmaaApplies: boolean;
  irmaaSurcharge: number;
  /** Guardrail state for this year. 0 = baseline spending; >0 = active cut as fraction. */
  guardrailCutPct: number;
  /** Maximum portfolio balance seen so far during retirement (peak from which drawdown is measured). */
  peakPortfolio: number;
  /** Pre-59½ only: dollars of this year's Roth draw that could NOT come from penalty-free
   *  sources (contribution basis + seasoned conversions) — i.e. the bridge gap funded from
   *  unseasoned conversions or earnings at a 10% penalty. 0 once the older spouse is 59½. */
  preFiftyNineHalfShortfall?: number;
}
