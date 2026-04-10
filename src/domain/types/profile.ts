export interface PersonProfile {
  name: string;
  age: number;
  birthYear: number;
  lifeExpectancy: number;
  fullRetirementAge: number;
  fraMonthlyBenefit: number; // estimated SS benefit at FRA, in today's dollars
  socialSecurityClaimAge: number;
}

export interface AnnualContributions {
  pretax: number;    // 401k / traditional IRA contributions per year (combined household)
  roth: number;      // Roth IRA (including backdoor Roth) per year (combined household)
  brokerage: number; // taxable brokerage savings per year
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
  targetBracket?: '10%' | '12%' | '22%' | '24%' | '32%' | '35%';
  // If set, the engine fills exactly to this bracket ceiling each year via Roth conversion.
  // Conversion amount = (bracketCeiling + stdDeduction) × inflationFactor − RMD − SS_includable.
  // Automatically selects conversion_primary engine and adjusts for SS phase-in and RMDs.
  // Not set = surplus-driven conversions (withdrawal_sequencing archetype, e.g. Mike & Laura).
  spendingEngine?: 'withdrawal_sequencing' | 'conversion_primary' | 'auto';
  // withdrawal_sequencing (default): draw from accounts to cover spending, convert surplus to Roth.
  //   Best for: brokerage-backed strategies, ACA cliff optimization (Mike & Laura archetype).
  // conversion_primary: fill targetBracket from pretax each year; all spending from Roth.
  //   MAGI = conversion only (not spending draws). Best for: no-brokerage, high pre-tax balance.
  // auto: picks conversion_primary when targetBracket is set; otherwise withdrawal_sequencing.
  annualContributions?: AnnualContributions; // annual savings added each year during accumulation phase
}
