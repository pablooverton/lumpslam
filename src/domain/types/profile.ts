export interface PersonProfile {
  name: string;
  age: number;
  birthYear: number;
  lifeExpectancy: number;
  fullRetirementAge: number;
  fraMonthlyBenefit: number; // estimated SS benefit at FRA, in today's dollars
  socialSecurityClaimAge: number;
}

export interface ClientProfile {
  client: PersonProfile;
  spouse: PersonProfile | null;
  filingStatus: 'married_filing_jointly' | 'single';
  stateOfResidence: string;
  hasStateIncomeTax: boolean;
  currentYear: number;
  retirementYearDesired: number | null; // null = retire now
  cobraMonths: number; // typically 12–18
}
