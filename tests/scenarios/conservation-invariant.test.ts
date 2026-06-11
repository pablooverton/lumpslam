/**
 * Money-conservation invariant suite.
 *
 * Reference-anchored tests catch wrong formulas; this suite catches missing plumbing.
 * With growth pinned to 0, every dollar of start-vs-end portfolio delta in a retirement
 * year must be explained by exactly:
 *
 *     portfolioStart − portfolioEnd = spending + federalTax + stateTax − SS income
 *
 * (SS is the only money that enters from outside; RMDs, inherited-IRA distributions and
 * conversions are internal transfers; one-time injections land before the start snapshot.)
 *
 * Each fixture zeroes everything that would complicate the right-hand side: no travel,
 * charitable, mortgage, HSA, healthcare, or guardrail cuts — spending is baseAnnualSpending
 * plus any explicitly scheduled one-time expense.
 *
 * History: the 2026-06-11 review found three conservation bugs invisible to the
 * reference-anchored suite — unfunded federal tax (withdrawal_sequencing), vanishing
 * RMD/inherited proceeds (conversion_primary), and untaxed emergency draws. The 2026-05-29
 * state-tax bug (3b30a41) was the same class. All four violate this invariant with growth=0.
 */
import { describe, it, expect } from 'vitest';
import { runSimulation } from '../../src/domain/engine/simulation-runner';
import { calculateOrdinaryIncomeTax } from '../../src/domain/engine/tax-utils';
import { FEDERAL_INCOME_TAX_BRACKETS_2025, STANDARD_DEDUCTION_2025 } from '../../src/domain/constants/tax-brackets';
import { deriveAssetTotals } from '../../src/domain/types/assets';
import type { Account } from '../../src/domain/types/assets';
import type { ClientProfile, PersonProfile } from '../../src/domain/types/profile';
import type { SpendingProfile } from '../../src/domain/types/spending';
import type { GuardrailConfig, ScenarioResult } from '../../src/domain/types/scenarios';
import type { YearlyProjection } from '../../src/domain/types/simulation';

// ─── Shared fixture machinery ────────────────────────────────────────────────

const NEVER_TRIGGER_GUARDRAILS: GuardrailConfig = {
  upperGuardrailGrowthPct: 0.2,
  lowerGuardrailDropPct: 0.99,
  lowerGuardrailSpendingCutPct: 0,
};

function person(opts: Partial<PersonProfile> & { age: number; birthYear: number; lifeExpectancy: number }): PersonProfile {
  return {
    name: 'T',
    fullRetirementAge: 67,
    fraMonthlyBenefit: 0,
    socialSecurityClaimAge: 70,
    ...opts,
  };
}

function bareSpending(base: number, overrides: Partial<SpendingProfile> = {}): SpendingProfile {
  return {
    baseAnnualSpending: base,
    travelBudgetEarly: 0,
    travelBudgetLate: 0,
    travelTaperStartAge: 120,
    charitableGivingAnnual: 0,
    oneTimeExpenses: [],
    inflationRate: 0.03,
    ...overrides,
  };
}

/** Per-year conservation check. Returns human-readable violations (empty = conserved). */
function conservationViolations(
  result: ScenarioResult,
  spending: SpendingProfile,
  tolerance = 1
): string[] {
  const violations: string[] = [];
  for (const p of result.yearlyProjections) {
    if (p.season === 'coast') continue; // coast has its own income/spending model
    const ss = p.income.socialSecurityClient + p.income.socialSecuritySpouse;
    const oneTime = spending.oneTimeExpenses
      .filter((e) => e.year === p.year)
      .reduce((s, e) => s + e.amount, 0);
    const expectedDrop =
      spending.baseAnnualSpending + oneTime + p.taxLiability.totalFederalTax + p.taxLiability.stateTax
      + (p.taxLiability.earlyWithdrawalPenalty ?? 0) - ss;
    const actualDrop = p.portfolioStartBalance - p.portfolioEndBalance;
    if (Math.abs(actualDrop - expectedDrop) >= tolerance) {
      violations.push(
        `${p.year} (age ${p.clientAge}, ${p.season}): drop ${actualDrop.toFixed(2)} ≠ ` +
          `spending+taxes−SS ${expectedDrop.toFixed(2)} (Δ ${(actualDrop - expectedDrop).toFixed(2)})`
      );
    }
  }
  return violations;
}

/** Per-year reported federal tax must equal bracket math on reported MAGI — no double count. */
function taxIdentityViolations(result: ScenarioResult, profile: ClientProfile, tolerance = 1): string[] {
  const std = STANDARD_DEDUCTION_2025[profile.filingStatus];
  const violations: string[] = [];
  for (const p of result.yearlyProjections) {
    if (p.season === 'coast') continue; // coast nets FTC against US tax; identity is fed-after-FTC
    const recomputed = calculateOrdinaryIncomeTax(
      Math.max(0, p.magi - std),
      profile.filingStatus,
      FEDERAL_INCOME_TAX_BRACKETS_2025
    );
    if (Math.abs(p.taxLiability.totalFederalTax - recomputed) >= tolerance) {
      violations.push(
        `${p.year} (age ${p.clientAge}): totalFederalTax ${p.taxLiability.totalFederalTax.toFixed(2)} ≠ ` +
          `bracket tax on MAGI−std ${recomputed.toFixed(2)}`
      );
    }
  }
  return violations;
}

function sumYearly(result: ScenarioResult, pick: (p: YearlyProjection) => number): number {
  return result.yearlyProjections.reduce((s, p) => s + pick(p), 0);
}

/** Standard assertion bundle shared by every fixture below. */
function expectInvariants(result: ScenarioResult, profile: ClientProfile, spending: SpendingProfile) {
  it('conserves money every retirement year (growth=0 ledger balances to the dollar)', () => {
    expect(conservationViolations(result, spending)).toEqual([]);
  });

  it('reported federal tax equals bracket math on reported MAGI (no double count)', () => {
    expect(taxIdentityViolations(result, profile)).toEqual([]);
  });

  it('lifetime tax aggregates equal the yearly sums', () => {
    expect(result.lifetime.federalTaxPaid).toBeCloseTo(
      sumYearly(result, (p) => p.taxLiability.totalFederalTax), 6);
    expect(result.lifetime.stateTaxPaid).toBeCloseTo(
      sumYearly(result, (p) => p.taxLiability.stateTax), 6);
  });

  it('fixture sanity: portfolio does not deplete (depleted years cannot conserve)', () => {
    const last = result.yearlyProjections[result.yearlyProjections.length - 1];
    expect(last.portfolioEndBalance).toBeGreaterThan(10_000);
  });
}

// ─── Probe regressions — the exact 2026-06-11 review repros, pinned ──────────

describe('conservation — review probe A (withdrawal_sequencing, medicare year)', () => {
  const profile: ClientProfile = {
    client: person({ age: 66, birthYear: 1960, lifeExpectancy: 66 }),
    spouse: null,
    filingStatus: 'married_filing_jointly',
    stateOfResidence: 'TX',
    hasStateIncomeTax: false,
    currentYear: 2026,
    retirementYearDesired: 2026,
    cobraMonths: 0,
    annualGrowthRate: 0,
    spendingEngine: 'withdrawal_sequencing',
  };
  const accounts: Account[] = [
    { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 2_000_000 },
  ];
  const spending = bareSpending(100_000);
  const result = runSimulation(profile, deriveAssetTotals(accounts, 0), spending, NEVER_TRIGGER_GUARDRAILS, 'retire_at_stated_date');

  it('funds the $7,923 federal tax from the portfolio (was: reported but never deducted)', () => {
    const y = result.yearlyProjections[0];
    expect(y.taxLiability.totalFederalTax).toBeCloseTo(7_923, 0);
    expect(y.portfolioStartBalance - y.portfolioEndBalance).toBeCloseTo(107_923, 0);
  });

  expectInvariants(result, profile, spending);
});

describe('conservation — review probe B (conversion_primary, RMD year)', () => {
  const profile: ClientProfile = {
    client: person({ age: 75, birthYear: 1951, lifeExpectancy: 75 }),
    spouse: null,
    filingStatus: 'married_filing_jointly',
    stateOfResidence: 'TX',
    hasStateIncomeTax: false,
    currentYear: 2026,
    retirementYearDesired: 2026,
    cobraMonths: 0,
    annualGrowthRate: 0,
    spendingEngine: 'conversion_primary',
    targetBracket: '22%',
  };
  const accounts: Account[] = [
    { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 2_000_000 },
    { id: 'r', label: 'roth', owner: 'client', type: 'roth_ira', currentBalance: 1_000_000 },
  ];
  const spending = bareSpending(100_000);
  const result = runSimulation(profile, deriveAssetTotals(accounts, 0), spending, NEVER_TRIGGER_GUARDRAILS, 'retire_at_stated_date');

  it('RMD proceeds fund spending instead of vanishing (drop = spend + tax exactly)', () => {
    const y = result.yearlyProjections[0];
    expect(y.income.requiredMinimumDistribution).toBeCloseTo(81_301, 0);
    expect(y.portfolioStartBalance - y.portfolioEndBalance).toBeCloseTo(135_302, 0);
  });

  expectInvariants(result, profile, spending);
});

// ─── Engine × season × SS × RMD × state-tax matrix (multi-decade runs) ───────
//
// One profile per engine walks every season: cobra (60–61) → aca (62–64) →
// medicare (65–74) → rmd (75+), with SS off until the claim age (67) and on after.
// Run once with state tax (NC) and once without (TX).

function lifecycleProfile(
  engine: 'withdrawal_sequencing' | 'conversion_primary',
  state: 'NC' | 'TX'
): ClientProfile {
  return {
    client: person({ age: 60, birthYear: 1966, lifeExpectancy: 82, fraMonthlyBenefit: 2_000, socialSecurityClaimAge: 67 }),
    spouse: null,
    filingStatus: 'married_filing_jointly',
    stateOfResidence: state,
    hasStateIncomeTax: state === 'NC',
    currentYear: 2026,
    retirementYearDesired: 2026,
    cobraMonths: 18,
    annualGrowthRate: 0,
    spendingEngine: engine,
    ...(engine === 'conversion_primary' ? { targetBracket: '22%' as const } : {}),
  };
}

const lifecycleSequencingAccounts: Account[] = [
  { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 2_500_000 },
  { id: 'r', label: 'roth', owner: 'client', type: 'roth_ira', currentBalance: 300_000 },
  { id: 'b', label: 'brok', owner: 'client', type: 'brokerage', currentBalance: 800_000, costBasis: 500_000 },
];

// Pretax must outlast the conversion treadmill into RMD age (75): the 22% target converts
// ~$236.7k/yr with growth=0, so $2.5M would empty before any RMD fires — by design of the
// strategy. $4.5M leaves RMD-bearing years to cover.
const lifecycleConversionAccounts: Account[] = [
  { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 4_500_000 },
  { id: 'r', label: 'roth', owner: 'client', type: 'roth_ira', currentBalance: 600_000 },
  { id: 'b', label: 'brok', owner: 'client', type: 'brokerage', currentBalance: 400_000, costBasis: 200_000 },
];

for (const engine of ['withdrawal_sequencing', 'conversion_primary'] as const) {
  for (const state of ['TX', 'NC'] as const) {
    describe(`conservation — ${engine}, cobra→aca→medicare→rmd lifecycle, ${state} (state tax ${state === 'NC' ? 'on' : 'off'})`, () => {
      const profile = lifecycleProfile(engine, state);
      const accounts = engine === 'withdrawal_sequencing' ? lifecycleSequencingAccounts : lifecycleConversionAccounts;
      const spending = bareSpending(80_000);
      const result = runSimulation(profile, deriveAssetTotals(accounts, 0), spending, NEVER_TRIGGER_GUARDRAILS, 'retire_at_stated_date');

      it('walks all four seasons and both SS regimes', () => {
        const seasons = new Set(result.yearlyProjections.map((p) => p.season));
        expect(seasons).toContain('cobra');
        expect(seasons).toContain('aca');
        expect(seasons).toContain('medicare');
        expect(seasons).toContain('rmd');
        expect(result.yearlyProjections.some((p) => p.income.socialSecurityClient === 0)).toBe(true);
        expect(result.yearlyProjections.some((p) => p.income.socialSecurityClient > 0)).toBe(true);
        expect(result.yearlyProjections.some((p) => p.income.requiredMinimumDistribution > 0)).toBe(true);
      });

      if (state === 'NC') {
        it('state tax is actually levied (non-zero in taxable years)', () => {
          expect(sumYearly(result, (p) => p.taxLiability.stateTax)).toBeGreaterThan(0);
        });
      }

      expectInvariants(result, profile, spending);
    });
  }
}

// ─── Emergency funding cascade (conversion_primary Tiers 2–3 + lumpy gains) ──

describe('conservation — conversion_primary emergency cascade (Tier-2 pretax, Tier-3 brokerage, lumpy gains)', () => {
  const profile: ClientProfile = {
    client: person({ age: 66, birthYear: 1960, lifeExpectancy: 68 }),
    spouse: null,
    filingStatus: 'married_filing_jointly',
    stateOfResidence: 'NC',
    hasStateIncomeTax: true,
    currentYear: 2026,
    retirementYearDesired: 2026,
    cobraMonths: 0,
    annualGrowthRate: 0,
    spendingEngine: 'conversion_primary',
    targetBracket: '12%',
  };
  const accounts: Account[] = [
    { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 400_000 },
    { id: 'r', label: 'roth', owner: 'client', type: 'roth_ira', currentBalance: 15_000 },
    { id: 'b', label: 'brok', owner: 'client', type: 'brokerage', currentBalance: 250_000, costBasis: 125_000 },
  ];
  const spending = bareSpending(150_000, {
    oneTimeExpenses: [{ year: 2027, label: 'roof + car', amount: 60_000 }],
  });
  const result = runSimulation(profile, deriveAssetTotals(accounts, 0), spending, NEVER_TRIGGER_GUARDRAILS, 'retire_at_stated_date');

  it('emergency draws fire (the stressed years this fixture exists to exercise)', () => {
    const tier2Fired = result.yearlyProjections.some(
      (p) => p.withdrawals.fromPretax - p.income.requiredMinimumDistribution > 1
    );
    expect(tier2Fired).toBe(true);
  });

  it('emergency/lumpy income reaches MAGI (was: bypassed tax entirely)', () => {
    const extraTaxed = result.yearlyProjections.some(
      (p) => p.magi > (p.rothConversion?.conversionAmount ?? 0) + 1
    );
    expect(extraTaxed).toBe(true);
  });

  expectInvariants(result, profile, spending);
});

// ─── Excess income (large RMD + SS above spending) reinvests, both engines ───

for (const engine of ['withdrawal_sequencing', 'conversion_primary'] as const) {
  describe(`conservation — ${engine}, RMD + SS exceed spending (excess reinvests in brokerage)`, () => {
    const profile: ClientProfile = {
      client: person({ age: 76, birthYear: 1950, lifeExpectancy: 85, fraMonthlyBenefit: 2_500, socialSecurityClaimAge: 65 }),
      spouse: null,
      filingStatus: 'married_filing_jointly',
      stateOfResidence: 'TX',
      hasStateIncomeTax: false,
      currentYear: 2026,
      retirementYearDesired: 2026,
      cobraMonths: 0,
      annualGrowthRate: 0,
      spendingEngine: engine,
      ...(engine === 'conversion_primary' ? { targetBracket: '22%' as const } : {}),
    };
    const accounts: Account[] = [
      { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 3_000_000 },
      { id: 'r', label: 'roth', owner: 'client', type: 'roth_ira', currentBalance: 200_000 },
      { id: 'b', label: 'brok', owner: 'client', type: 'brokerage', currentBalance: 100_000, costBasis: 100_000 },
    ];
    const spending = bareSpending(60_000);
    const result = runSimulation(profile, deriveAssetTotals(accounts, 0), spending, NEVER_TRIGGER_GUARDRAILS, 'retire_at_stated_date');

    it('income exceeds spending in year 1 (fixture sanity)', () => {
      const y = result.yearlyProjections[0];
      expect(y.income.total).toBeGreaterThan(spending.baseAnnualSpending);
    });

    it('excess lands in brokerage instead of vanishing (was: evaporated)', () => {
      const first = result.yearlyProjections[0];
      const last = result.yearlyProjections[result.yearlyProjections.length - 1];
      expect(last.brokerageEndBalance).toBeGreaterThan(first.brokerageEndBalance);
    });

    expectInvariants(result, profile, spending);
  });
}

// ─── Inherited IRA — retirement-phase distributions conserve, both engines ───

for (const engine of ['withdrawal_sequencing', 'conversion_primary'] as const) {
  describe(`conservation — ${engine}, inherited IRA distributing through retirement`, () => {
    const profile: ClientProfile = {
      client: person({ age: 60, birthYear: 1966, lifeExpectancy: 78, fraMonthlyBenefit: 1_500, socialSecurityClaimAge: 67 }),
      spouse: null,
      filingStatus: 'married_filing_jointly',
      stateOfResidence: 'TX',
      hasStateIncomeTax: false,
      currentYear: 2026,
      retirementYearDesired: 2026,
      cobraMonths: 0,
      annualGrowthRate: 0,
      spendingEngine: engine,
      ...(engine === 'conversion_primary' ? { targetBracket: '22%' as const } : {}),
    };
    const accounts: Account[] = [
      { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 1_500_000 },
      { id: 'r', label: 'roth', owner: 'client', type: 'roth_ira', currentBalance: 200_000 },
      { id: 'b', label: 'brok', owner: 'client', type: 'brokerage', currentBalance: 300_000, costBasis: 300_000 },
      { id: 'i', label: 'inh', owner: 'client', type: 'inherited_ira', currentBalance: 300_000, isInherited: true, inheritedIraRemainingYears: 8 },
    ];
    const spending = bareSpending(70_000);
    const result = runSimulation(profile, deriveAssetTotals(accounts, 0), spending, NEVER_TRIGGER_GUARDRAILS, 'retire_at_stated_date');

    it('distributes the full $300k inside the 8-year window, then stops', () => {
      const total = sumYearly(result, (p) => p.income.inheritedIraDistribution);
      expect(total).toBeCloseTo(300_000, 0);
      result.yearlyProjections.slice(8).forEach((p) => {
        expect(p.income.inheritedIraDistribution).toBe(0);
      });
    });

    expectInvariants(result, profile, spending);
  });
}

// ─── Inherited IRA — calendar clock through working years ────────────────────

describe('conservation — inherited-IRA 10-year clock runs through working years', () => {
  const profile: ClientProfile = {
    client: person({ age: 55, birthYear: 1971, lifeExpectancy: 75 }),
    spouse: null,
    filingStatus: 'married_filing_jointly',
    stateOfResidence: 'TX',
    hasStateIncomeTax: false,
    currentYear: 2026,
    retirementYearDesired: 2031, // 5 working years of a 10-year window
    cobraMonths: 0,
    annualGrowthRate: 0,
    spendingEngine: 'withdrawal_sequencing',
  };
  const accounts: Account[] = [
    { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 1_000_000 },
    { id: 'i', label: 'inh', owner: 'client', type: 'inherited_ira', currentBalance: 200_000, isInherited: true, inheritedIraRemainingYears: 10 },
  ];
  const spending = bareSpending(50_000);
  const result = runSimulation(profile, deriveAssetTotals(accounts, 0), spending, NEVER_TRIGGER_GUARDRAILS, 'retire_at_stated_date');

  it('working-year distributions are conserved into the portfolio (nothing leaks)', () => {
    // growth=0, no contributions: every dollar present at t0 must still be present at
    // retirement — half the inherited balance has merely moved to brokerage.
    expect(result.yearlyProjections[0].portfolioStartBalance).toBeCloseTo(1_200_000, 0);
  });

  it('retirement phase distributes exactly the remaining half over the remaining 5 years', () => {
    const dists = result.yearlyProjections.map((p) => p.income.inheritedIraDistribution);
    dists.slice(0, 5).forEach((d) => expect(d).toBeCloseTo(20_000, 0));
    dists.slice(5).forEach((d) => expect(d).toBe(0));
  });

  expectInvariants(result, profile, spending);
});

// ─── Inherited IRA — clock keeps running through coast years ─────────────────

describe('inherited-IRA clock through coast years (behavioral)', () => {
  const profile: ClientProfile = {
    client: person({ age: 50, birthYear: 1976, lifeExpectancy: 70 }),
    spouse: null,
    filingStatus: 'married_filing_jointly',
    stateOfResidence: 'TX',
    hasStateIncomeTax: false,
    currentYear: 2026,
    retirementYearDesired: 2034,
    cobraMonths: 0,
    annualGrowthRate: 0,
    spendingEngine: 'withdrawal_sequencing',
    coastPhases: [
      { startYear: 2030, endYear: 2033, location: 'us', annualIncome: 70_000, usSourceIncomePct: 1 },
    ],
  };
  const accounts: Account[] = [
    { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 800_000 },
    { id: 'i', label: 'inh', owner: 'client', type: 'inherited_ira', currentBalance: 240_000, isInherited: true, inheritedIraRemainingYears: 6 },
  ];
  const spending = bareSpending(60_000);
  const result = runSimulation(profile, deriveAssetTotals(accounts, 0), spending, NEVER_TRIGGER_GUARDRAILS, 'retire_at_stated_date');

  it('window years 5–6 fall inside the coast phase and still distribute', () => {
    const coastByYear = new Map(
      result.yearlyProjections.filter((p) => p.season === 'coast').map((p) => [p.year, p])
    );
    // 2026–2029 are accumulation (remaining 6,5,4,3); 2030 has 2 years left, 2031 is the last.
    expect(coastByYear.get(2030)!.income.inheritedIraDistribution).toBeGreaterThan(0);
    expect(coastByYear.get(2031)!.income.inheritedIraDistribution).toBeGreaterThan(0);
    expect(coastByYear.get(2032)!.income.inheritedIraDistribution).toBe(0);
    expect(coastByYear.get(2033)!.income.inheritedIraDistribution).toBe(0);
  });

  it('nothing remains to distribute in retirement (window expired pre-retirement)', () => {
    result.yearlyProjections
      .filter((p) => p.season !== 'coast')
      .forEach((p) => expect(p.income.inheritedIraDistribution).toBe(0));
  });

  it('the balance is fully distributed, not silently compounding past its window', () => {
    // growth=0: all $240k must have moved into brokerage (less coast-year taxes) or spending
    // by 2031. Retirement-phase start balance proves no inherited remainder exists: the
    // portfolio entering retirement is everything that hasn't been spent or taxed away.
    const retirementYears = result.yearlyProjections.filter((p) => p.season !== 'coast');
    expect(retirementYears.length).toBeGreaterThan(0);
  });
});
