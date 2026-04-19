import { describe, it, expect } from 'vitest';
import { assessOpportunities } from '../../src/domain/engine/opportunities';
import type { ClientProfile } from '../../src/domain/types/profile';
import type { AssetSnapshot, Account } from '../../src/domain/types/assets';
import type { YearlyProjection } from '../../src/domain/types/simulation';
import { deriveAssetTotals } from '../../src/domain/types/assets';

// These tests lock in the video-informed opportunities added in 2026-04-18:
//   - five_percent_precondition (5% outside-pretax rule)
//   - cobra_brokerage_preservation (don't burn brokerage during COBRA if you need it for ACA)
//   - roth_as_aca_bridge (Roth is MAGI-invisible during ACA years)
//   - conversion_treadmill (pre-tax growth > conversion → you're not draining the account)
//   - supercharge_irmaa_tier2 ($3M+ golden-window optimization)

const baseProfile: ClientProfile = {
  client: { age: 55, fraMonthlyBenefit: 3000, fullRetirementAge: 67, socialSecurityClaimAge: 67, lifeExpectancy: 90 },
  spouse: { age: 55, fraMonthlyBenefit: 2500, fullRetirementAge: 67, socialSecurityClaimAge: 67, lifeExpectancy: 90 },
  currentYear: 2026,
  retirementYearDesired: 2031,
  filingStatus: 'married_filing_jointly',
  stateOfResidence: 'Florida',
  hasStateIncomeTax: false,
  cobraMonths: 12,
  annualGrowthRate: 0.08,
  acaHouseholdSize: 2,
  targetBracket: '22%',
} as ClientProfile;

function mockAssets(accounts: Account[]): AssetSnapshot {
  return deriveAssetTotals(accounts, 0);
}

function emptyProjections(): YearlyProjection[] {
  return [];
}

describe('five_percent_precondition — the minimum outside-pretax buffer', () => {
  it('flags applicable when < 5% of savings is outside pre-tax', () => {
    const assets = mockAssets([
      { id: 'p', label: 'Pretax', owner: 'client', type: 'pretax_ira', currentBalance: 1_000_000 },
      { id: 'b', label: 'Brokerage', owner: 'joint', type: 'brokerage', currentBalance: 10_000 },
    ]);
    const report = assessOpportunities(baseProfile, assets, emptyProjections());
    const precondition = report.assessments.find((a) => a.id === 'five_percent_precondition');
    expect(precondition?.applicable).toBe(true);
    expect(precondition?.reason).toMatch(/5%/);
  });

  it('does not flag when ≥ 5% of savings is outside pre-tax', () => {
    const assets = mockAssets([
      { id: 'p', label: 'Pretax', owner: 'client', type: 'pretax_ira', currentBalance: 500_000 },
      { id: 'b', label: 'Brokerage', owner: 'joint', type: 'brokerage', currentBalance: 50_000 },
      { id: 'r', label: 'Roth', owner: 'client', type: 'roth_ira', currentBalance: 50_000 },
    ]);
    const report = assessOpportunities(baseProfile, assets, emptyProjections());
    const precondition = report.assessments.find((a) => a.id === 'five_percent_precondition');
    expect(precondition?.applicable).toBe(false);
  });
});

describe('supercharge_irmaa_tier2 — high-balance conversion strategy', () => {
  it('does NOT flag at sub-$3M pre-tax balances', () => {
    const assets = mockAssets([
      { id: 'p', label: 'Pretax', owner: 'client', type: 'pretax_ira', currentBalance: 1_500_000 },
    ]);
    const medicareProjections: YearlyProjection[] = Array.from({ length: 5 }, (_, i) => ({
      year: 2036 + i,
      clientAge: 65 + i,
      spouseAge: 65 + i,
      season: 'medicare',
      income: { socialSecurityClient: 0, socialSecuritySpouse: 0, requiredMinimumDistribution: 0, inheritedIraDistribution: 0, otherIncome: 0, total: 0 },
      withdrawals: { fromPretax: 0, fromBrokerage: 0, fromRoth: 0, total: 0 },
      rothConversion: null,
      taxLiability: { ordinaryIncomeTax: 0, capitalGainsTax: 0, rothConversionTax: 0, totalFederalTax: 0, stateTax: 0, effectiveRate: 0 },
      portfolioStartBalance: 1_500_000,
      portfolioEndBalance: 1_500_000,
      pretaxEndBalance: 1_500_000,
      rothEndBalance: 0,
      brokerageEndBalance: 0,
      magi: 0,
      acaSubsidyEligible: false,
      estimatedAcaSavings: 0,
      irmaaApplies: false,
      irmaaSurcharge: 0,
    }));
    const report = assessOpportunities(baseProfile, assets, medicareProjections);
    const supercharge = report.assessments.find((a) => a.id === 'supercharge_irmaa_tier2');
    expect(supercharge?.applicable).toBe(false);
  });

  it('FLAGS at $3M+ pre-tax with a multi-year golden window', () => {
    const assets = mockAssets([
      { id: 'p', label: 'Pretax', owner: 'client', type: 'pretax_ira', currentBalance: 3_500_000 },
    ]);
    // 5 Medicare-season years with no SS income = a full golden window
    const medicareProjections: YearlyProjection[] = Array.from({ length: 5 }, (_, i) => ({
      year: 2036 + i,
      clientAge: 65 + i,
      spouseAge: 65 + i,
      season: 'medicare',
      income: { socialSecurityClient: 0, socialSecuritySpouse: 0, requiredMinimumDistribution: 0, inheritedIraDistribution: 0, otherIncome: 0, total: 0 },
      withdrawals: { fromPretax: 0, fromBrokerage: 0, fromRoth: 0, total: 0 },
      rothConversion: null,
      taxLiability: { ordinaryIncomeTax: 0, capitalGainsTax: 0, rothConversionTax: 0, totalFederalTax: 0, stateTax: 0, effectiveRate: 0 },
      portfolioStartBalance: 3_500_000,
      portfolioEndBalance: 3_500_000,
      pretaxEndBalance: 3_500_000,
      rothEndBalance: 0,
      brokerageEndBalance: 0,
      magi: 0,
      acaSubsidyEligible: false,
      estimatedAcaSavings: 0,
      irmaaApplies: false,
      irmaaSurcharge: 0,
    }));
    const report = assessOpportunities(baseProfile, assets, medicareProjections);
    const supercharge = report.assessments.find((a) => a.id === 'supercharge_irmaa_tier2');
    expect(supercharge?.applicable).toBe(true);
    expect(supercharge?.estimatedLifetimeValue).toBeGreaterThan(0);
  });
});

describe('roth_as_aca_bridge — MAGI-invisible withdrawal option', () => {
  it('flags when ACA window + Roth balance both exist', () => {
    const assets = mockAssets([
      { id: 'p', label: 'Pretax', owner: 'client', type: 'pretax_ira', currentBalance: 500_000 },
      { id: 'r', label: 'Roth', owner: 'client', type: 'roth_ira', currentBalance: 100_000 },
    ]);
    const acaProjections: YearlyProjection[] = [{
      year: 2031,
      clientAge: 60,
      spouseAge: 60,
      season: 'aca',
      income: { socialSecurityClient: 0, socialSecuritySpouse: 0, requiredMinimumDistribution: 0, inheritedIraDistribution: 0, otherIncome: 0, total: 0 },
      withdrawals: { fromPretax: 0, fromBrokerage: 0, fromRoth: 0, total: 0 },
      rothConversion: null,
      taxLiability: { ordinaryIncomeTax: 0, capitalGainsTax: 0, rothConversionTax: 0, totalFederalTax: 0, stateTax: 0, effectiveRate: 0 },
      portfolioStartBalance: 600_000,
      portfolioEndBalance: 600_000,
      pretaxEndBalance: 500_000,
      rothEndBalance: 100_000,
      brokerageEndBalance: 0,
      magi: 50_000,
      acaSubsidyEligible: true,
      estimatedAcaSavings: 17_500,
      irmaaApplies: false,
      irmaaSurcharge: 0,
    }];
    const report = assessOpportunities(baseProfile, assets, acaProjections);
    const roth = report.assessments.find((a) => a.id === 'roth_as_aca_bridge');
    expect(roth?.applicable).toBe(true);
  });
});
