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
  currentCombinedIncome: number;
  incomeAfterLoss: number;
  incomeLostFromSS: number;
  survivorCoveragePercent: number;
  canMaintainLifestyle: boolean;
  singleFilerBracketNote: string;
}

export interface ContingencyReport {
  risks: RiskAssessment[];
  widowsPenaltyClient: WidowsPenaltyAnalysis;
  widowsPenaltySpouse: WidowsPenaltyAnalysis | null;
}
