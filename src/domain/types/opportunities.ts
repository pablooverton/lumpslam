export type OpportunityId =
  | 'aca_subsidies'
  | 'micro_roth_conversions'
  | 'concentrated_stock'
  | 'cost_basis_reset'
  | 'donor_advised_fund'
  | 'qualified_charitable_distributions'
  | 'five_percent_precondition'
  | 'conversion_treadmill'
  | 'supercharge_irmaa_tier2'
  | 'cobra_brokerage_preservation'
  | 'roth_as_aca_bridge';

export interface OpportunityAssessment {
  id: OpportunityId;
  label: string;
  applicable: boolean;
  reason: string;
  estimatedAnnualValue: number | null;
  estimatedLifetimeValue: number | null;
}

export interface OpportunityReport {
  assessments: OpportunityAssessment[];
  applicableCount: number;
  totalEstimatedLifetimeValue: number;
}
