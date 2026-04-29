import type { ClientProfile } from '@/domain/types/profile';
import type { Account } from '@/domain/types/assets';
import type { SpendingProfile } from '@/domain/types/spending';

export interface DemoEntry {
  key: string;
  label: string;
  tag: string;       // short descriptor shown in the dropdown
  situation: string; // one-sentence summary shown below the dropdown
  profile: ClientProfile;
  accounts: Account[];
  homeEquity: number;
  spending: SpendingProfile;
}

export const DEMOS: DemoEntry[] = [
  // ── 1. Mike & Laura — Near-Retirement Couple ──────────────────────────────
  {
    key: 'mike-laura',
    label: 'Mike & Laura',
    tag: 'Near-retirement couple, ACA cliff strategy',
    situation: 'Ages 59 & 61, retiring now. Brokerage funds Roth conversion taxes while staying under the ACA subsidy cliff during the pre-Medicare window.',
    profile: {
      client: { name: 'Mike', age: 59, birthYear: 1967, lifeExpectancy: 90, fullRetirementAge: 67, fraMonthlyBenefit: 3_200, socialSecurityClaimAge: 68 },
      spouse:  { name: 'Laura', age: 61, birthYear: 1965, lifeExpectancy: 95, fullRetirementAge: 67, fraMonthlyBenefit: 2_800, socialSecurityClaimAge: 68 },
      filingStatus: 'married_filing_jointly',
      stateOfResidence: 'TX', hasStateIncomeTax: false,
      currentYear: 2026, retirementYearDesired: 2026,
      cobraMonths: 12, acaHouseholdSize: 2,
    },
    accounts: [
      { id: '1', label: "Mike's IRA",      owner: 'client', type: 'pretax_ira',   currentBalance: 800_000 },
      { id: '2', label: "Laura's IRA",     owner: 'spouse', type: 'pretax_ira',   currentBalance: 900_000 },
      { id: '3', label: 'Joint Brokerage', owner: 'joint',  type: 'brokerage',    currentBalance: 250_000, costBasis: 175_000 },
      { id: '4', label: 'Inherited IRA',   owner: 'client', type: 'inherited_ira', currentBalance: 100_000, isInherited: true, inheritedIraRemainingYears: 8 },
    ],
    homeEquity: 600_000,
    spending: {
      baseAnnualSpending: 126_000,
      travelBudgetEarly: 25_000, travelBudgetLate: 12_000, travelTaperStartAge: 75,
      charitableGivingAnnual: 10_000,
      oneTimeExpenses: [
        { year: 2027, label: "Son's wedding", amount: 25_000 },
        { year: 2030, label: 'Roof replacement', amount: 18_000 },
      ],
      inflationRate: 0.03,
    },
  },

  // ── 2. Sofia & Marcus — FIRE at 42 ───────────────────────────────────────
  {
    key: 'sofia-marcus',
    label: 'Sofia & Marcus',
    tag: 'FIRE couple retiring at 42 — 23-year ACA window',
    situation: 'Both 42, retiring now with young kids on the plan. ACA subsidy management matters for 23 years until Medicare. Mortgage still running.',
    profile: {
      client: { name: 'Sofia',  age: 42, birthYear: 1984, lifeExpectancy: 90, fullRetirementAge: 67, fraMonthlyBenefit: 1_800, socialSecurityClaimAge: 67 },
      spouse:  { name: 'Marcus', age: 40, birthYear: 1986, lifeExpectancy: 88, fullRetirementAge: 67, fraMonthlyBenefit: 1_500, socialSecurityClaimAge: 67 },
      filingStatus: 'married_filing_jointly',
      stateOfResidence: 'CO', hasStateIncomeTax: true,
      currentYear: 2026, retirementYearDesired: 2026,
      cobraMonths: 0, acaHouseholdSize: 4,
    },
    accounts: [
      { id: '1', label: "Sofia's 401k",   owner: 'client', type: 'pretax_ira', currentBalance: 320_000 },
      { id: '2', label: "Marcus's 401k",  owner: 'spouse', type: 'pretax_ira', currentBalance: 210_000 },
      { id: '3', label: "Sofia's Roth",   owner: 'client', type: 'roth_ira',   currentBalance:  55_000 },
      { id: '4', label: "Marcus's Roth",  owner: 'spouse', type: 'roth_ira',   currentBalance:  30_000 },
      { id: '5', label: 'Joint Brokerage', owner: 'joint', type: 'brokerage',  currentBalance:  95_000, costBasis: 65_000 },
    ],
    homeEquity: 180_000,
    spending: {
      baseAnnualSpending: 68_000,
      travelBudgetEarly: 18_000, travelBudgetLate: 8_000, travelTaperStartAge: 65,
      charitableGivingAnnual: 3_000,
      oneTimeExpenses: [
        { year: 2032, label: 'College tuition (child 1)', amount: 30_000 },
        { year: 2035, label: 'College tuition (child 2)', amount: 30_000 },
      ],
      inflationRate: 0.03,
      mortgageAnnualPayment: 22_800,
      mortgagePaidOffAge: 62,
    },
  },

  // ── 3. Jennifer — Solo Pre-Tax Heavy ─────────────────────────────────────
  {
    key: 'jennifer',
    label: 'Jennifer',
    tag: 'Single, retiring at 62 — pre-tax heavy, Roth conversion window',
    situation: 'Single, 58, retiring in 4 years. $1.1M pre-tax with minimal Roth creates RMD risk. Goal: convert aggressively during the COBRA + ACA window before RMDs hit.',
    profile: {
      client: { name: 'Jennifer', age: 58, birthYear: 1968, lifeExpectancy: 92, fullRetirementAge: 67, fraMonthlyBenefit: 2_400, socialSecurityClaimAge: 70 },
      spouse: null,
      filingStatus: 'single',
      stateOfResidence: 'FL', hasStateIncomeTax: false,
      currentYear: 2026, retirementYearDesired: 2030,
      cobraMonths: 18, acaHouseholdSize: 1,
    },
    accounts: [
      { id: '1', label: 'Rollover IRA',    owner: 'client', type: 'pretax_ira', currentBalance: 1_100_000 },
      { id: '2', label: 'Roth IRA',        owner: 'client', type: 'roth_ira',   currentBalance:    65_000 },
      { id: '3', label: 'Brokerage',       owner: 'client', type: 'brokerage',  currentBalance:   175_000, costBasis: 120_000 },
    ],
    homeEquity: 380_000,
    spending: {
      baseAnnualSpending: 62_000,
      travelBudgetEarly: 20_000, travelBudgetLate: 9_000, travelTaperStartAge: 75,
      charitableGivingAnnual: 5_000,
      oneTimeExpenses: [],
      inflationRate: 0.03,
    },
  },

  // ── 4. Carlos & Elena — Retiring Abroad ──────────────────────────────────
  {
    key: 'carlos-elena',
    label: 'Carlos & Elena',
    tag: 'Retiring abroad at 54 — no ACA cliff, free Roth conversions',
    situation: 'Ages 54 & 51, retiring internationally. No ACA constraints means $242k/yr Roth conversions can run freely for 11 years before Medicare. HSA covers international coverage.',
    profile: {
      client: { name: 'Carlos', age: 54, birthYear: 1972, lifeExpectancy: 88, fullRetirementAge: 67, fraMonthlyBenefit: 2_600, socialSecurityClaimAge: 62 },
      spouse:  { name: 'Elena',  age: 51, birthYear: 1975, lifeExpectancy: 92, fullRetirementAge: 67, fraMonthlyBenefit: 1_200, socialSecurityClaimAge: 62 },
      filingStatus: 'married_filing_jointly',
      stateOfResidence: 'IL', hasStateIncomeTax: true,
      currentYear: 2026, retirementYearDesired: 2026,
      cobraMonths: 0, acaHouseholdSize: 2,
      retirementLocation: 'international',
      targetBracket: '22%' as const,
    },
    accounts: [
      { id: '1', label: "Carlos's IRA",  owner: 'client', type: 'pretax_ira', currentBalance: 1_400_000 },
      { id: '2', label: "Elena's IRA",   owner: 'spouse', type: 'pretax_ira', currentBalance:   580_000 },
      { id: '3', label: 'Roth IRA',      owner: 'client', type: 'roth_ira',   currentBalance:   220_000 },
      { id: '4', label: 'HSA',           owner: 'client', type: 'hsa',        currentBalance:    85_000 },
    ],
    homeEquity: 0,
    spending: {
      baseAnnualSpending: 52_000,
      travelBudgetEarly: 22_000, travelBudgetLate: 12_000, travelTaperStartAge: 72,
      charitableGivingAnnual: 8_000,
      oneTimeExpenses: [],
      inflationRate: 0.03,
      annualHealthcareCost: 14_000,
    },
  },

  // ── 5. David — RMD Countdown ─────────────────────────────────────────────
  {
    key: 'david',
    label: 'David',
    tag: 'Already retired at 71 — RMD bomb, charitable strategy',
    situation: 'Single, 71, already on Medicare and collecting SS (claimed at 70). $2.1M pre-tax triggers growing RMDs. Goal: Roth conversions + Qualified Charitable Distributions to defuse the tax bomb.',
    profile: {
      client: { name: 'David', age: 71, birthYear: 1955, lifeExpectancy: 88, fullRetirementAge: 67, fraMonthlyBenefit: 2_900, socialSecurityClaimAge: 70 },
      spouse: null,
      filingStatus: 'single',
      stateOfResidence: 'AZ', hasStateIncomeTax: true,
      currentYear: 2026, retirementYearDesired: 2026,
      cobraMonths: 0, acaHouseholdSize: 1,
    },
    accounts: [
      { id: '1', label: 'Rollover IRA',  owner: 'client', type: 'pretax_ira', currentBalance: 2_100_000 },
      { id: '2', label: 'Roth IRA',      owner: 'client', type: 'roth_ira',   currentBalance:    35_000 },
      { id: '3', label: 'Brokerage',     owner: 'client', type: 'brokerage',  currentBalance:    55_000, costBasis: 45_000 },
    ],
    homeEquity: 420_000,
    spending: {
      baseAnnualSpending: 52_000,
      travelBudgetEarly: 14_000, travelBudgetLate: 6_000, travelTaperStartAge: 78,
      charitableGivingAnnual: 22_000,
      oneTimeExpenses: [],
      inflationRate: 0.03,
    },
  },

  // ── 6. Alex & Morgan — Long-Horizon Accumulation + International ───────────
  {
    key: 'alex-morgan',
    label: 'Alex & Morgan',
    tag: 'Ages 41 & 38, retiring abroad 2041 — 15-yr accumulation, bracket-filling conversions',
    situation: 'Ages 41 & 38, retiring internationally in 2041. 15 working years of 401k + backdoor Roth contributions compound to ~$5M before retirement. No ACA cliff means conversions fill the 22% bracket freely from day one. Roth balance grows while pretax depletes gradually.',
    profile: {
      client: { name: 'Alex',   age: 41, birthYear: 1985, lifeExpectancy: 90, fullRetirementAge: 67, fraMonthlyBenefit: 2_750, socialSecurityClaimAge: 62 },
      spouse:  { name: 'Morgan', age: 38, birthYear: 1988, lifeExpectancy: 95, fullRetirementAge: 67, fraMonthlyBenefit: 2_600, socialSecurityClaimAge: 62 },
      filingStatus: 'married_filing_jointly',
      stateOfResidence: 'VA', hasStateIncomeTax: true,
      currentYear: 2026, retirementYearDesired: 2041,
      cobraMonths: 0, acaHouseholdSize: 4,
      retirementLocation: 'international',
      targetBracket: '22%' as const,
      annualContributions: { pretax: 46_000, roth: 14_000, brokerage: 0, hsa: 8_300 },
    },
    accounts: [
      { id: '1', label: "Alex's 401k",    owner: 'client', type: 'pretax_ira', currentBalance: 485_000 },
      { id: '2', label: "Morgan's 401k",  owner: 'spouse', type: 'pretax_ira', currentBalance: 255_000 },
      { id: '3', label: "Alex's Roth",    owner: 'client', type: 'roth_ira',   currentBalance:  88_000 },
      { id: '4', label: "Morgan's Roth",  owner: 'spouse', type: 'roth_ira',   currentBalance:  51_000 },
      { id: '5', label: 'Taxable Brokerage', owner: 'joint', type: 'brokerage', currentBalance: 5_000, costBasis: 5_000 },
      { id: '6', label: 'HSA',            owner: 'client', type: 'hsa',        currentBalance:  28_000 },
    ],
    homeEquity: 115_000,
    spending: {
      baseAnnualSpending: 118_000,
      travelBudgetEarly: 8_000, travelBudgetLate: 4_000, travelTaperStartAge: 75,
      charitableGivingAnnual: 0,
      oneTimeExpenses: [],
      inflationRate: 0.03,
      mortgageAnnualPayment: 46_200,
      mortgagePaidOffAge: 68,
      annualHealthcareCost: 15_000,
    },
  },
];
