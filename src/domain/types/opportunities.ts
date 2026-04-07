export type OpportunityId =
  | 'aca_subsidies'
  | 'micro_roth_conversions'
  | 'concentrated_stock'
  | 'cost_basis_reset'
  | 'donor_advised_fund'
  | 'qualified_charitable_distributions';

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
