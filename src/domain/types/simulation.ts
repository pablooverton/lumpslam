// 'international' = pre-Medicare years when retirementLocation=international.
// Same engine rules as 'cobra' (no MAGI cliff, free conversions) but distinct for display.
export type RetirementSeason = 'cobra' | 'aca' | 'medicare' | 'rmd' | 'international';

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
  magi: number;
  acaSubsidyEligible: boolean;
  estimatedAcaSavings: number;
  irmaaApplies: boolean;
  irmaaSurcharge: number;
}
