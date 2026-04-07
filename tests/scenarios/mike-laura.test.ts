/**
 * Mike & Laura Integration Test — reference scenario from the video.
 *
 * All expected values sourced from the video analysis in Retirement_Math_Details.md.
 * Tests marked [SHOULD FAIL] indicate known bugs that need fixing.
 */
import { describe, it, expect } from 'vitest';
import { deriveAssetTotals } from '../../src/domain/types/assets';
import { runSimulation } from '../../src/domain/engine/simulation-runner';
import { buildSocialSecurityComparison } from '../../src/domain/engine/social-security';
import { buildContingencyReport } from '../../src/domain/engine/contingency';
import type { ClientProfile } from '../../src/domain/types/profile';
import type { Account } from '../../src/domain/types/assets';
import type { SpendingProfile } from '../../src/domain/types/spending';
import type { GuardrailConfig } from '../../src/domain/types/scenarios';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const profile: ClientProfile = {
  client: {
    name: 'Mike',
    age: 59,
    birthYear: 1967,
    lifeExpectancy: 90,
    fullRetirementAge: 67,
    fraMonthlyBenefit: 3_200,
    socialSecurityClaimAge: 68,
  },
  spouse: {
    name: 'Laura',
    age: 61,
    birthYear: 1965,
    lifeExpectancy: 95,
    fullRetirementAge: 67,
    fraMonthlyBenefit: 2_800,
    socialSecurityClaimAge: 68,
  },
  filingStatus: 'married_filing_jointly',
  stateOfResidence: 'TX',
  hasStateIncomeTax: false,
  currentYear: 2026,
  retirementYearDesired: 2026,
  cobraMonths: 18,
};

const accounts: Account[] = [
  { id: '1', label: "Mike's IRA",       owner: 'client', type: 'pretax_ira',   currentBalance: 800_000 },
  { id: '2', label: "Laura's IRA",      owner: 'spouse', type: 'pretax_ira',   currentBalance: 900_000 },
  { id: '3', label: 'Joint Brokerage',  owner: 'joint',  type: 'brokerage',    currentBalance: 250_000, costBasis: 175_000 },
  { id: '4', label: 'Inherited IRA',    owner: 'client', type: 'inherited_ira', currentBalance: 100_000, inheritedIraRemainingYears: 8 },
];

const assets = deriveAssetTotals(accounts, 600_000);

const spending: SpendingProfile = {
  baseAnnualSpending: 126_000,     // essential — this is the "desired spending" for capacity test
  travelBudgetEarly: 25_000,
  travelBudgetLate: 12_000,
  travelTaperStartAge: 75,
  charitableGivingAnnual: 10_000,
  oneTimeExpenses: [],
  inflationRate: 0.03,
};

const guardrails: GuardrailConfig = {
  upperGuardrailGrowthPct: 0.20,
  lowerGuardrailDropPct: 0.29,
  lowerGuardrailSpendingCutPct: 0.03,
};

const result = runSimulation(profile, assets, spending, guardrails, 'retire_now');

// ─── Capacity & Surplus ───────────────────────────────────────────────────────
// Video: spending capacity $156k, desired $126k, surplus $30k

describe('Mike & Laura — spending capacity', () => {
  it('[BUG] spending capacity includes SS income and is ~$156k', () => {
    // Portfolio contribution: $2.05M × 4% = $82k
    // SS contribution (weighted): Mike $41k/yr + Laura $36k/yr = $77.76k/yr, weighted for years receiving
    // Expected total: ~$140k–$165k
    expect(result.spendingCapacity).toBeGreaterThanOrEqual(140_000);
    expect(result.spendingCapacity).toBeLessThanOrEqual(165_000);
  });

  it('[BUG] desired spending is base spending only ($126k), not total spending', () => {
    // The capacity comparison uses essential spending, not lifestyle+charitable
    // Video explicitly shows "$126,000 desired spending" vs "$156,000 capacity"
    expect(result.desiredSpending).toBe(126_000);
  });

  it('[BUG] surplus is ~$30k (capacity − desired)', () => {
    // Video: $156k − $126k = $30k surplus
    expect(result.surplusOrDeficit).toBeGreaterThan(20_000);
    expect(result.surplusOrDeficit).toBeLessThan(50_000);
  });

  it('[BUG] probability of success is ≥ 90%', () => {
    // Video: 95% probability of success
    expect(result.probabilityOfSuccess).toBeGreaterThanOrEqual(0.90);
  });
});

// ─── Guardrails ───────────────────────────────────────────────────────────────
// Video: portfolio must drop $600k (29%) before 3% cut ($400/month)

describe('Mike & Laura — guardrails', () => {
  it('lower guardrail dollar drop ≈ $600k (29% of $2.05M)', () => {
    // $2,050,000 × 0.29 = $594,500
    expect(result.lowerGuardrailDollarDrop).toBeCloseTo(594_500, -3); // within $1k
  });

  it('[BUG] monthly spending cut at lower guardrail ≈ $400/month', () => {
    // 3% of total actual spending ($161k) / 12 = $402.50/mo
    // The cut is on TOTAL spending, not just essential
    expect(result.lowerGuardrailSpendingCutDollars).toBeGreaterThanOrEqual(390);
    expect(result.lowerGuardrailSpendingCutDollars).toBeLessThanOrEqual(420);
  });
});

// ─── ACA Season ──────────────────────────────────────────────────────────────
// Video: ACA window from age 60 to 65 (2027-2032 for Mike)
// Key: MAGI must stay below $84,600 during ACA years

describe('Mike & Laura — ACA season MAGI management', () => {
  const acaYears = result.yearlyProjections.filter((y) => y.season === 'aca');

  it('ACA window exists (season = "aca" appears in projection)', () => {
    expect(acaYears.length).toBeGreaterThan(0);
  });

  it('[BUG] ALL ACA years have MAGI below $84,600 (the cliff)', () => {
    // Video: they manage MAGI below $84,600 throughout the ACA window
    // Bug: brokerage runs out early, causing MAGI spike in years 3-5
    const violating = acaYears.filter((y) => y.magi >= 84_600);
    expect(violating.length).toBe(0);
  });

  it('ACA years are eligible for subsidies', () => {
    // After fixing MAGI, all ACA years should show subsidy eligibility
    const ineligible = acaYears.filter((y) => !y.acaSubsidyEligible);
    expect(ineligible.length).toBe(0);
  });
});

// ─── Roth Conversions ─────────────────────────────────────────────────────────
// Video: ~$70k Roth conversion in Year 1 (COBRA season), funded by $30k surplus

describe('Mike & Laura — Roth conversions', () => {
  it('[BUG] Roth conversions fire during COBRA season', () => {
    const cobraConversions = result.yearlyProjections.filter(
      (y) => y.season === 'cobra' && y.rothConversion !== null
    );
    expect(cobraConversions.length).toBeGreaterThan(0);
  });

  it('[BUG] Year 1 Roth conversion is approximately $70k', () => {
    const year1 = result.yearlyProjections[0];
    expect(year1.rothConversion).not.toBeNull();
    expect(year1.rothConversion!.conversionAmount).toBeGreaterThan(50_000);
    expect(year1.rothConversion!.conversionAmount).toBeLessThan(100_000);
  });

  it('[BUG] Roth conversion tax (Event 2) is paid from brokerage', () => {
    const year1 = result.yearlyProjections[0];
    expect(year1.rothConversion?.brokerageFundingAmount).toBeGreaterThan(0);
  });

  it('Roth conversions do NOT fire during ACA season (would raise MAGI above cliff)', () => {
    const acaConversions = result.yearlyProjections.filter(
      (y) => y.season === 'aca' && y.rothConversion !== null
    );
    // Conversions during ACA would push MAGI over $84,600
    expect(acaConversions.length).toBe(0);
  });
});

// ─── Social Security ─────────────────────────────────────────────────────────
// Video: claim at 68 for both; Mike $3,456/mo, Laura $3,024/mo

describe('Mike & Laura — Social Security', () => {
  it('Mike SS at claim age 68 ≈ $3,456/mo (FRA $3,200 × 1.08)', () => {
    // SS starts when clientAge reaches 68
    const ssYear = result.yearlyProjections.find((y) => y.clientAge === 68);
    expect(ssYear).toBeDefined();
    // Annual SS for Mike: $3,456/mo × 12 = $41,472
    expect(ssYear!.income.socialSecurityClient).toBeCloseTo(41_472, -2);
  });

  it('Laura SS at claim age 68 ≈ $3,024/mo (FRA $2,800 × 1.08)', () => {
    const ssYear = result.yearlyProjections.find((y) => y.clientAge === 68);
    expect(ssYear).toBeDefined();
    // Annual SS for Laura: $3,024/mo × 12 = $36,288
    expect(ssYear!.income.socialSecuritySpouse).toBeCloseTo(36_288, -2);
  });

  it('SS income is zero before claim age', () => {
    // Mike claims at 68; at age 65, no SS yet
    const preSSYear = result.yearlyProjections.find((y) => y.clientAge === 65);
    expect(preSSYear?.income.socialSecurityClient).toBe(0);
  });
});

// ─── Widow's Penalty ──────────────────────────────────────────────────────────
// Video: >90% survivor coverage — survivor can maintain 100% lifestyle

describe("Mike & Laura — widow's penalty", () => {
  const ssComparison = buildSocialSecurityComparison(
    profile.client.fraMonthlyBenefit,
    profile.client.fullRetirementAge,
    profile.client.lifeExpectancy,
    profile.spouse!.fraMonthlyBenefit,
    profile.spouse!.fullRetirementAge,
    profile.spouse!.lifeExpectancy,
  );

  const contingency = buildContingencyReport(profile, assets, guardrails, result, ssComparison);

  it('[BUG] survivor coverage is >90% (can maintain lifestyle)', () => {
    // Video: "they have >90% survivor coverage"
    // Bug: currently only SS income is counted, not portfolio — gives 29.6%
    expect(contingency.widowsPenaltyClient.survivorCoveragePercent).toBeGreaterThan(0.90);
  });

  it('[BUG] can maintain lifestyle after either spouse passes', () => {
    expect(contingency.widowsPenaltyClient.canMaintainLifestyle).toBe(true);
    expect(contingency.widowsPenaltySpouse?.canMaintainLifestyle).toBe(true);
  });
});
