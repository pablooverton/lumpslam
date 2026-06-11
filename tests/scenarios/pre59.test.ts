/**
 * Pre-59½ realism — the engine no longer treats Roth as freely spendable.
 *
 * Encodes the out-of-band pre-59½ access audit: Roth draws follow IRS ordering
 * (contribution basis → seasoned conversions FIFO → unseasoned (10% penalty) → earnings
 * (income + 10% penalty)); pretax draws before 59½ carry 10% unless 72(t)/rule-of-55;
 * penalty gating uses the OLDER spouse's age. Growth pinned to 0 where dollar-exact
 * conservation is asserted: drop = spending + fed + state + penalty − SS.
 */
import { describe, it, expect } from 'vitest';
import { runSimulation } from '../../src/domain/engine/simulation-runner';
import { deriveAssetTotals } from '../../src/domain/types/assets';
import type { Account } from '../../src/domain/types/assets';
import type { ClientProfile, PersonProfile } from '../../src/domain/types/profile';
import type { SpendingProfile } from '../../src/domain/types/spending';
import type { GuardrailConfig } from '../../src/domain/types/scenarios';

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

function bareSpending(base: number): SpendingProfile {
  return {
    baseAnnualSpending: base,
    travelBudgetEarly: 0,
    travelBudgetLate: 0,
    travelTaperStartAge: 120,
    charitableGivingAnnual: 0,
    oneTimeExpenses: [],
    inflationRate: 0.03,
  };
}

function ladderProfile(overrides: Partial<ClientProfile> = {}): ClientProfile {
  return {
    client: person({ age: 45, birthYear: 1981, lifeExpectancy: 70 }),
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
    ...overrides,
  };
}

function ladderAccounts(rothContributionBasis: number): Account[] {
  return [
    { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 4_000_000 },
    { id: 'r', label: 'roth', owner: 'client', type: 'roth_ira', currentBalance: 1_000_000, rothContributionBasis },
  ];
}

// ─── The conversion-ladder gap, priced ───────────────────────────────────────

describe('pre-59½ — conversion ladder without basis pays the bridge penalty', () => {
  const spending = bareSpending(80_000);
  const result = runSimulation(
    ladderProfile(),
    deriveAssetTotals(ladderAccounts(0), 0),
    spending,
    NEVER_TRIGGER_GUARDRAILS,
    'retire_at_stated_date'
  );

  it('year 1 draws are penalized (no basis, fresh conversions unseasoned)', () => {
    const y = result.yearlyProjections[0];
    expect(y.taxLiability.earlyWithdrawalPenalty ?? 0).toBeGreaterThan(5_000);
    expect(y.preFiftyNineHalfShortfall ?? 0).toBeGreaterThan(50_000);
  });

  it('the ladder catches up before 59½: late-50s years draw seasoned lots penalty-free', () => {
    const at56 = result.yearlyProjections.find((p) => p.clientAge === 56)!;
    expect(at56.taxLiability.earlyWithdrawalPenalty ?? 0).toBeLessThan(1);
    expect(at56.preFiftyNineHalfShortfall ?? 0).toBeLessThan(1);
  });

  it('post-59½ years carry no penalty and no shortfall', () => {
    result.yearlyProjections
      .filter((p) => p.clientAge >= 60)
      .forEach((p) => {
        expect(p.taxLiability.earlyWithdrawalPenalty ?? 0).toBe(0);
        expect(p.preFiftyNineHalfShortfall ?? 0).toBe(0);
      });
  });

  it('penalties are funded — every year conserves with the penalty term (growth=0)', () => {
    for (const p of result.yearlyProjections) {
      const drop = p.portfolioStartBalance - p.portfolioEndBalance;
      const expected =
        spending.baseAnnualSpending +
        p.taxLiability.totalFederalTax +
        p.taxLiability.stateTax +
        (p.taxLiability.earlyWithdrawalPenalty ?? 0) -
        (p.income.socialSecurityClient + p.income.socialSecuritySpouse);
      expect(Math.abs(drop - expected)).toBeLessThan(1);
    }
  });

  it('lifetime aggregates sum the penalties and fold them into totalTaxPaid', () => {
    const summed = result.yearlyProjections.reduce(
      (s, p) => s + (p.taxLiability.earlyWithdrawalPenalty ?? 0),
      0
    );
    expect(summed).toBeGreaterThan(0);
    expect(result.lifetime.earlyWithdrawalPenaltiesPaid).toBeCloseTo(summed, 6);
    expect(result.lifetime.totalTaxPaid).toBeCloseTo(
      result.lifetime.federalTaxPaid + result.lifetime.stateTaxPaid + summed,
      6
    );
  });
});

describe('pre-59½ — contribution basis funds the 5-year runway (the audit claim, in-engine)', () => {
  const spending = bareSpending(80_000);
  const result = runSimulation(
    ladderProfile(),
    deriveAssetTotals(ladderAccounts(600_000), 0),
    spending,
    NEVER_TRIGGER_GUARDRAILS,
    'retire_at_stated_date'
  );

  it('with ~5×spend of basis, the bridge is penalty-free end to end', () => {
    const totalPenalties = result.yearlyProjections.reduce(
      (s, p) => s + (p.taxLiability.earlyWithdrawalPenalty ?? 0),
      0
    );
    expect(totalPenalties).toBeLessThan(1);
    expect(result.lifetime.earlyWithdrawalPenaltiesPaid).toBeLessThan(1);
  });
});

// ─── Pretax draws pre-59½ (sequencing) + exemption flags ─────────────────────

function pretaxDrawProfile(
  exemption: ClientProfile['pre59PenaltyExemption'],
  age: number
): ClientProfile {
  return {
    client: person({ age, birthYear: 2026 - age, lifeExpectancy: age + 4 }),
    spouse: null,
    filingStatus: 'married_filing_jointly',
    stateOfResidence: 'TX',
    hasStateIncomeTax: false,
    currentYear: 2026,
    retirementYearDesired: 2026,
    cobraMonths: 0,
    annualGrowthRate: 0,
    spendingEngine: 'withdrawal_sequencing',
    // self_insure season: no ACA MAGI cliff capping the pretax draw — the fixture wants the
    // full $100k gap drawn from pretax so the penalty math is exact.
    healthcareCoverage: 'self_insure',
    pre59PenaltyExemption: exemption,
  };
}

const pretaxOnly: Account[] = [
  { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 2_000_000 },
];

describe('pre-59½ — pretax gap draws and the exemption flags', () => {
  const spending = bareSpending(100_000);

  function year1Penalty(exemption: ClientProfile['pre59PenaltyExemption'], age: number): number {
    const r = runSimulation(
      pretaxDrawProfile(exemption, age),
      deriveAssetTotals(pretaxOnly, 0),
      spending,
      NEVER_TRIGGER_GUARDRAILS,
      'retire_at_stated_date'
    );
    return r.yearlyProjections[0].taxLiability.earlyWithdrawalPenalty ?? 0;
  }

  it('default: a $100k pretax draw at 50 carries the $10k penalty', () => {
    expect(year1Penalty('none', 50)).toBeCloseTo(10_000, 0);
  });

  it('72(t) exempts pretax draws at any age', () => {
    expect(year1Penalty('72t', 50)).toBe(0);
  });

  it('rule of 55: exempt at 56, still penalized at 54', () => {
    expect(year1Penalty('rule_of_55', 56)).toBe(0);
    expect(year1Penalty('rule_of_55', 54)).toBeCloseTo(10_000, 0);
  });

  it('no penalty from 59½ regardless of flag (integer age 60 here)', () => {
    expect(year1Penalty('none', 60)).toBe(0);
  });
});

// ─── Older-spouse gating ──────────────────────────────────────────────────────

describe('pre-59½ — penalty gating uses the older spouse', () => {
  const spending = bareSpending(100_000);

  it('client 50 with a 62-year-old spouse draws penalty-free (older accounts first)', () => {
    const profile: ClientProfile = {
      ...pretaxDrawProfile('none', 50),
      spouse: person({ age: 62, birthYear: 1964, lifeExpectancy: 80 }),
    };
    const r = runSimulation(
      profile,
      deriveAssetTotals(pretaxOnly, 0),
      spending,
      NEVER_TRIGGER_GUARDRAILS,
      'retire_at_stated_date'
    );
    expect(r.yearlyProjections[0].taxLiability.earlyWithdrawalPenalty ?? 0).toBe(0);
  });
});
