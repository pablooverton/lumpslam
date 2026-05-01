import type { ClientProfile, PersonProfile } from '@/domain/types/profile';
import type { Account } from '@/domain/types/assets';
import type { SpendingProfile, OneTimeExpense } from '@/domain/types/spending';

export interface FormState {
  client: PersonProfile;
  hasSpouse: boolean;
  spouse: PersonProfile;
  filingStatus: 'married_filing_jointly' | 'single';
  stateAbbreviation: string;
  hasStateIncomeTax: boolean;
  currentYear: number;
  retirementYearDesired: number;
  retireOutsideUS: boolean;
  healthBridge: 'cobra' | 'aca' | 'spouse_employer' | 'self_insure';  // US only
  selfInsuranceAnnualBudget: number;  // only used when healthBridge === 'self_insure'
  dependentsOnPlan: number;          // children/other dependents (not client or spouse) on health plan
  growthScenario: 'pessimistic' | 'conservative' | 'moderate' | 'optimistic' | 'historical';
  accounts: Account[];
  homeEquity: number;
  essentialAnnualSpending: number;   // maps to baseAnnualSpending (exclude healthcare if using HSA)
  annualHealthcareCost: number;      // 0 = included in essential; >0 = drawn from HSA first
  lifestyleSpendingActive: number;   // maps to travelBudgetEarly
  lifestyleSpendingSlower: number;   // maps to travelBudgetLate
  lifestyleTaperAge: number;         // maps to travelTaperStartAge
  charitableGivingAnnual: number;
  oneTimeExpenses: OneTimeExpense[];
  inflationRate: number;
  mortgageAnnualPayment: number;   // 0 = no mortgage
  mortgagePaidOffAge: number;      // client age at payoff
  // Expert/advisor settings
  targetBracket?: '10%' | '12%' | '22%' | '24%' | '32%' | '35%';
  annualContributions: { pretax: number; roth: number; brokerage: number; hsa: number };
}

export const BLANK_PERSON: PersonProfile = {
  name: '',
  age: 0,
  birthYear: 0,
  lifeExpectancy: 90,
  fullRetirementAge: 67,
  fraMonthlyBenefit: 0,
  socialSecurityClaimAge: 67,
};

export function buildFormState(
  profile: ClientProfile | null,
  accounts: Account[],
  homeEquity: number,
  spending: SpendingProfile | null,
): FormState {
  return {
    client: profile?.client ?? { ...BLANK_PERSON },
    hasSpouse: profile?.spouse != null,
    spouse: profile?.spouse ?? { ...BLANK_PERSON },
    filingStatus: profile?.filingStatus ?? 'married_filing_jointly',
    stateAbbreviation: profile?.stateOfResidence ?? '',
    hasStateIncomeTax: profile?.hasStateIncomeTax ?? true,
    currentYear: profile?.currentYear ?? new Date().getFullYear(),
    retirementYearDesired: profile?.retirementYearDesired ?? new Date().getFullYear() + 5,
    retireOutsideUS: profile?.retirementLocation === 'international',
    healthBridge:
      profile?.healthcareCoverage === 'self_insure'
        ? 'self_insure'
        : (profile?.cobraMonths ?? 0) > 0
        ? 'cobra'
        : 'aca',
    selfInsuranceAnnualBudget: spending?.selfInsuranceAnnualBudget ?? 0,
    dependentsOnPlan: Math.max(0, (profile?.acaHouseholdSize ?? 2) - 1 - (profile?.spouse ? 1 : 0)),
    growthScenario: (() => {
      // Map a stored REAL growth rate back to the closest preset.
      const r = profile?.annualGrowthRate ?? 0.05;
      if (r <= 0.035) return 'pessimistic';
      if (r <= 0.045) return 'conservative';
      if (r <= 0.055) return 'moderate';
      if (r <= 0.065) return 'optimistic';
      return 'historical';
    })(),
    accounts: accounts.length > 0 ? accounts : [{ id: '1', label: '', owner: 'client', type: 'pretax_ira', currentBalance: 0 }],
    homeEquity,
    essentialAnnualSpending: spending?.baseAnnualSpending ?? 0,
    annualHealthcareCost: spending?.annualHealthcareCost ?? 0,
    lifestyleSpendingActive: spending?.travelBudgetEarly ?? 0,
    lifestyleSpendingSlower: spending?.travelBudgetLate ?? 0,
    lifestyleTaperAge: spending?.travelTaperStartAge ?? 75,
    charitableGivingAnnual: spending?.charitableGivingAnnual ?? 0,
    oneTimeExpenses: spending?.oneTimeExpenses ?? [],
    inflationRate: spending?.inflationRate ?? 0.03,
    mortgageAnnualPayment: spending?.mortgageAnnualPayment ?? 0,
    mortgagePaidOffAge: spending?.mortgagePaidOffAge ?? 69,
    targetBracket: profile?.targetBracket,
    annualContributions: {
      pretax:    profile?.annualContributions?.pretax    ?? 0,
      roth:      profile?.annualContributions?.roth      ?? 0,
      brokerage: profile?.annualContributions?.brokerage ?? 0,
      hsa:       profile?.annualContributions?.hsa       ?? 0,
    },
  };
}
