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
  cobraMonths: number;                  // 0 = skip COBRA, go straight to ACA/bridge
  acaHouseholdSize?: number;            // people on ACA plan; determines subsidy cliff. Default: 2
  annualGrowthRate?: number;            // nominal portfolio growth rate. Default: 0.07
  retirementLocation?: 'us' | 'international'; // 'international' skips ACA season. Default: 'us'
  targetAnnualConversion?: number;      // if set, drives Roth conversion amount (e.g. 242_000)
                                        // instead of surplus-based calculation
  spendingEngine?: 'withdrawal_sequencing' | 'conversion_primary' | 'auto';
  // withdrawal_sequencing (default): draw from accounts to cover spending, convert surplus to Roth.
  //   Best for: brokerage-backed strategies, ACA cliff optimization (Mike & Laura archetype).
  // conversion_primary: convert targetAnnualConversion from pretax each year; all spending from Roth.
  //   MAGI = conversion only (not spending draws). Best for: no-brokerage, high pre-tax balance,
  //   $242k/yr conversion engine strategies (elective-conversion archetype).
  // auto: picks conversion_primary when targetAnnualConversion is set; otherwise withdrawal_sequencing.
}
