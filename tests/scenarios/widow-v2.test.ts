/**
 * Widow analysis v2 (review Phase 3 #18):
 *   - death modeled at the deceased spouse's life expectancy; survivor inherits the
 *     AT-DEATH portfolio (v1 used the retirement-start balance)
 *   - survivor spending need = 80% of couple desired spending (v1 used 100%)
 *   - single-filer federal recompute (brackets + standard deduction) vs MFJ-equivalent —
 *     the difference is the widow's penalty in dollars; IRMAA at single thresholds 65+
 */
import { describe, it, expect } from 'vitest';
import { runSimulation } from '../../src/domain/engine/simulation-runner';
import { buildSocialSecurityComparison } from '../../src/domain/engine/social-security';
import { buildContingencyReport } from '../../src/domain/engine/contingency';
import { deriveAssetTotals } from '../../src/domain/types/assets';
import type { Account } from '../../src/domain/types/assets';
import type { ClientProfile } from '../../src/domain/types/profile';
import type { SpendingProfile } from '../../src/domain/types/spending';
import type { GuardrailConfig } from '../../src/domain/types/scenarios';

const GUARDRAILS: GuardrailConfig = {
  upperGuardrailGrowthPct: 0.2,
  lowerGuardrailDropPct: 0.99,
  lowerGuardrailSpendingCutPct: 0,
};

const SPENDING: SpendingProfile = {
  baseAnnualSpending: 100_000,
  travelBudgetEarly: 0, travelBudgetLate: 0, travelTaperStartAge: 120,
  charitableGivingAnnual: 0, oneTimeExpenses: [], inflationRate: 0.03,
};

function makeProfile(overrides: Partial<ClientProfile> = {}): ClientProfile {
  return {
    client: {
      name: 'C', age: 60, birthYear: 1966, lifeExpectancy: 95,
      fullRetirementAge: 67, fraMonthlyBenefit: 3_000, socialSecurityClaimAge: 67,
    },
    spouse: {
      name: 'S', age: 60, birthYear: 1966, lifeExpectancy: 75,
      fullRetirementAge: 67, fraMonthlyBenefit: 1_500, socialSecurityClaimAge: 67,
    },
    filingStatus: 'married_filing_jointly',
    stateOfResidence: 'TX',
    hasStateIncomeTax: false,
    currentYear: 2026,
    retirementYearDesired: 2026,
    cobraMonths: 0,
    annualGrowthRate: 0,
    spendingEngine: 'withdrawal_sequencing',
    ...overrides,
  };
}

describe('widow v2 — couple, spouse dies at life expectancy 75', () => {
  const profile = makeProfile();
  const accounts: Account[] = [
    { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 2_000_000 },
  ];
  const assets = deriveAssetTotals(accounts, 0);
  const result = runSimulation(profile, assets, SPENDING, GUARDRAILS, 'retire_at_stated_date');
  const ss = buildSocialSecurityComparison(3_000, 67, 95, 1_500, 67, 75);
  const report = buildContingencyReport(profile, assets, GUARDRAILS, result, ss);
  const w = report.widowsPenaltyClient; // spouse dies first, client survives

  it('models death in the year the spouse reaches life expectancy 75', () => {
    expect(w.atDeathYear).toBe(2041); // age 60 in 2026 → 75 in 2041
    expect(w.survivorAgeAtDeath).toBe(75);
  });

  it('uses the at-death portfolio from that projection year, not retirement start', () => {
    const deathProj = result.yearlyProjections.find((p) => p.year === 2041)!;
    expect(w.atDeathPortfolio).toBeCloseTo(deathProj.portfolioEndBalance, 6);
    expect(w.atDeathPortfolio).not.toBeCloseTo(
      result.yearlyProjections[0].portfolioStartBalance, -4
    );
  });

  it('models the survivor need at 80% of couple spending', () => {
    expect(w.survivorSpendingNeed).toBeCloseTo(result.desiredSpending * 0.8, 6);
  });

  it('reports a positive widow’s penalty (single vs MFJ-equivalent tax on the same income)', () => {
    expect(w.survivorFederalTaxSingle).toBeGreaterThan(w.mfjEquivalentFederalTax);
    expect(w.annualWidowsPenaltyTax).toBeCloseTo(
      w.survivorFederalTaxSingle - w.mfjEquivalentFederalTax, 6
    );
    expect(w.annualWidowsPenaltyTax).toBeGreaterThan(0);
  });

  it('coverage is net of single-filer tax and IRMAA', () => {
    expect(w.survivorCoveragePercent).toBeCloseTo(
      (w.incomeAfterLoss - w.survivorFederalTaxSingle - w.survivorIrmaaSurcharge) /
        w.survivorSpendingNeed,
      6
    );
  });

  it('handles the reverse direction (client dies last projection year) without degenerating', () => {
    const ws = report.widowsPenaltySpouse!;
    expect(ws.atDeathYear).toBe(2061); // client LE 95 = horizon end
    expect(Number.isFinite(ws.survivorCoveragePercent)).toBe(true);
  });
});

describe('widow v2 — IRMAA at single thresholds for a 65+ survivor with a large portfolio', () => {
  const profile = makeProfile();
  const accounts: Account[] = [
    { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 9_000_000 },
  ];
  const assets = deriveAssetTotals(accounts, 0);
  const result = runSimulation(profile, assets, SPENDING, GUARDRAILS, 'retire_at_stated_date');
  const ss = buildSocialSecurityComparison(3_000, 67, 95, 1_500, 67, 75);
  const report = buildContingencyReport(profile, assets, GUARDRAILS, result, ss);

  it('charges a single-threshold IRMAA surcharge on the survivor', () => {
    // ~$8M+ at death × ~4% SWR ≈ $350k+ ordinary income — far above the $106k single floor.
    expect(report.widowsPenaltyClient.survivorIrmaaSurcharge).toBeGreaterThan(0);
  });
});

describe('widow v2 — single filer degenerate case', () => {
  const profile = makeProfile({ spouse: null, filingStatus: 'single' });
  const accounts: Account[] = [
    { id: 'p', label: 'pretax', owner: 'client', type: 'pretax_ira', currentBalance: 2_000_000 },
  ];
  const assets = deriveAssetTotals(accounts, 0);
  const result = runSimulation(profile, assets, SPENDING, GUARDRAILS, 'retire_at_stated_date');
  const ss = buildSocialSecurityComparison(3_000, 67, 95, null, null, null);
  const report = buildContingencyReport(profile, assets, GUARDRAILS, result, ss);

  it('reports no widow’s penalty and keeps the full spending need', () => {
    const w = report.widowsPenaltyClient;
    expect(w.annualWidowsPenaltyTax).toBe(0);
    expect(w.incomeLostFromSS).toBe(0);
    expect(w.survivorSpendingNeed).toBeCloseTo(result.desiredSpending, 6);
    expect(w.singleFilerBracketNote).toContain('no widow');
    expect(report.widowsPenaltySpouse).toBeNull();
  });
});
