export type RetirementSeason = 'cobra' | 'aca' | 'medicare' | 'rmd';

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
  effectiveRate: number;
}

export interface RothConversionEvent {
  conversionAmount: number;
  marginalRate: number;
  taxOnConversion: number;        // Event 2 — paid from brokerage
  brokerageFundingAmount: number; // brokerage drawn to cover this tax
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
