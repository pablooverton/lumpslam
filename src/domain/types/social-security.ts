export interface SocialSecurityOption {
  label: string;
  clientClaimAge: number;
  spouseClaimAge: number | null;
  clientMonthlyBenefit: number;
  spouseMonthlyBenefit: number | null;
  lifetimeBenefitClient: number;
  lifetimeBenefitSpouse: number | null;
  lifetimeBenefitCombined: number;
  breakEvenAgeVsEarliest: number | null; // age at which cumulative benefits equal claiming at 62
  isSurvivorStrategy?: boolean;           // higher earner at 70, lower earner at 62
}

export interface SocialSecurityComparison {
  options: SocialSecurityOption[];
  recommendedOptionIndex: number;
  lifetimeBenefitDifferenceVsEarliest: number;
  taxEfficiencyNote: string;
}
