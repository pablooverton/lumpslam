import { z } from 'zod';

export const PersonProfileSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().min(40).max(90),
  birthYear: z.number().int().min(1930).max(2000),
  lifeExpectancy: z.number().int().min(70).max(110),
  fullRetirementAge: z.number().min(62).max(70),
  fraMonthlyBenefit: z.number().min(0),
  socialSecurityClaimAge: z.number().min(62).max(70),
});

export const AccountSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  owner: z.enum(['client', 'spouse', 'joint']),
  type: z.enum(['pretax_ira', 'roth_ira', 'brokerage', 'inherited_ira']),
  currentBalance: z.number().min(0),
  costBasis: z.number().min(0).optional(),
  isInherited: z.boolean().optional(),
  inheritedIraRemainingYears: z.number().int().min(1).max(10).optional(),
});

export const SpendingProfileSchema = z.object({
  baseAnnualSpending: z.number().min(0),
  travelBudgetEarly: z.number().min(0),
  travelBudgetLate: z.number().min(0),
  travelTaperStartAge: z.number().int().min(60).max(90),
  charitableGivingAnnual: z.number().min(0),
  oneTimeExpenses: z.array(
    z.object({ year: z.number().int(), label: z.string(), amount: z.number().min(0) })
  ),
  inflationRate: z.number().min(0.01).max(0.10),
});

export type PersonProfileInput = z.infer<typeof PersonProfileSchema>;
export type AccountInput = z.infer<typeof AccountSchema>;
export type SpendingProfileInput = z.infer<typeof SpendingProfileSchema>;
