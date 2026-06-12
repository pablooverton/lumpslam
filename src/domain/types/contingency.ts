export type RiskType =
  | 'market_crash'
  | 'overspending'
  | 'low_growth'
  | 'runaway_inflation'
  | 'unexpected_major_expense'
  | 'incorrect_assumptions';

export interface RiskAssessment {
  type: RiskType;
  label: string;
  likelihood: 'low' | 'medium' | 'high';
  mitigationStrategy: string;
  ifThenStatement: string;
}

export interface WidowsPenaltyAnalysis {
  survivingSpouse: 'client' | 'spouse';
  /** Couple SS at the recommended claiming option (annual). */
  currentCombinedIncome: number;
  /** Survivor gross income: the surviving (larger) SS check + SWR capacity on the at-death portfolio. */
  incomeAfterLoss: number;
  incomeLostFromSS: number;
  /** Modeled death year — the deceased spouse reaches their life expectancy. */
  atDeathYear: number;
  /** Survivor's age in the death year. */
  survivorAgeAtDeath: number;
  /** Portfolio (real) at the end of the death year. The survivor inherits this, not the
   *  retirement-start balance the v1 analysis used. */
  atDeathPortfolio: number;
  /** Survivor spending need = 80% of couple desired spending (fixed costs don't halve). */
  survivorSpendingNeed: number;
  /** Federal tax on the survivor's ordinary income under SINGLE brackets + deduction. */
  survivorFederalTaxSingle: number;
  /** The same income taxed MFJ — the difference is the widow's penalty. */
  mfjEquivalentFederalTax: number;
  /** survivorFederalTaxSingle − mfjEquivalentFederalTax, floored at 0. */
  annualWidowsPenaltyTax: number;
  /** IRMAA at SINGLE thresholds (one person) when the survivor is 65+ at death. */
  survivorIrmaaSurcharge: number;
  /** Net-of-tax coverage: (gross income − single-filer tax − IRMAA) / survivorSpendingNeed. */
  survivorCoveragePercent: number;
  canMaintainLifestyle: boolean;
  singleFilerBracketNote: string;
}

export interface ContingencyReport {
  risks: RiskAssessment[];
  widowsPenaltyClient: WidowsPenaltyAnalysis;
  widowsPenaltySpouse: WidowsPenaltyAnalysis | null;
}
