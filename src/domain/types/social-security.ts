export interface SocialSecurityOption {
  label: string;
  clientClaimAge: number;
  spouseClaimAge: number | null;
  clientMonthlyBenefit: number;
  spouseMonthlyBenefit: number | null;
  lifetimeBenefitClient: number;
  lifetimeBenefitSpouse: number | null;
  lifetimeBenefitCombined: number;
  breakEvenAgeVsEarliest: number | null; // null for earliest option
}

export interface SocialSecurityComparison {
  options: SocialSecurityOption[];
  recommendedOptionIndex: number;
  lifetimeBenefitDifferenceVsEarliest: number;
  taxEfficiencyNote: string;
}
