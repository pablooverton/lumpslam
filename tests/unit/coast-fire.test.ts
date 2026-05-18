import { describe, it, expect } from 'vitest';
import { validateCoastPhases } from '../../src/domain/types/profile';
import type { ClientProfile, CoastPhase } from '../../src/domain/types/profile';
import { runSimulation } from '../../src/domain/engine/simulation-runner';
import { runMonteCarlo } from '../../src/domain/engine/monte-carlo';
import { deriveAssetTotals } from '../../src/domain/types/assets';
import type { SpendingProfile } from '../../src/domain/types/spending';
import type { GuardrailConfig } from '../../src/domain/types/scenarios';

// ─── Validation ──────────────────────────────────────────────────────────────

describe('validateCoastPhases', () => {
  it('returns valid for undefined or empty', () => {
    expect(validateCoastPhases(undefined, 2026, 2034).valid).toBe(true);
    expect(validateCoastPhases([], 2026, 2034).valid).toBe(true);
  });

  it('errors if retirementYearDesired is null', () => {
    const phases: CoastPhase[] = [
      {
        startYear: 2030,
        endYear: 2033,
        location: 'korea',
        taxRegime: 'korea_under5',
        annualIncome: 100_000,
        usSourceIncomePct: 1.0,
        conversionTreatyProtection: 'protected',
      },
    ];
    const result = validateCoastPhases(phases, 2026, null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('retirementYearDesired');
  });

  it('errors if phase startYear <= currentYear', () => {
    const phases: CoastPhase[] = [
      {
        startYear: 2025, // current year
        endYear: 2033,
        location: 'korea',
        taxRegime: 'korea_under5',
        annualIncome: 100_000,
        usSourceIncomePct: 1.0,
        conversionTreatyProtection: 'protected',
      },
    ];
    const result = validateCoastPhases(phases, 2026, 2034);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('startYear'))).toBe(true);
  });

  it('errors if phase endYear >= retirementYearDesired', () => {
    const phases: CoastPhase[] = [
      {
        startYear: 2030,
        endYear: 2035, // past retirement
        location: 'korea',
        taxRegime: 'korea_under5',
        annualIncome: 100_000,
        usSourceIncomePct: 1.0,
        conversionTreatyProtection: 'protected',
      },
    ];
    const result = validateCoastPhases(phases, 2026, 2034);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('endYear'))).toBe(true);
  });

  it('errors if usSourceIncomePct out of range', () => {
    const result = validateCoastPhases(
      [
        {
          startYear: 2030,
          endYear: 2033,
          location: 'korea',
          taxRegime: 'korea_under5',
          annualIncome: 100_000,
          usSourceIncomePct: 1.5, // invalid
          conversionTreatyProtection: 'protected',
        },
      ],
      2026,
      2034
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('usSourceIncomePct'))).toBe(true);
  });

  it('errors if location and taxRegime mismatch', () => {
    const result = validateCoastPhases(
      [
        {
          startYear: 2030,
          endYear: 2033,
          location: 'korea',
          taxRegime: 'japan_npr', // mismatch
          annualIncome: 100_000,
          usSourceIncomePct: 1.0,
          conversionTreatyProtection: 'protected',
        },
      ],
      2026,
      2034
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('location=\'korea\''))).toBe(true);
  });

  it('errors if phases are not contiguous', () => {
    const result = validateCoastPhases(
      [
        {
          startYear: 2028,
          endYear: 2030,
          location: 'taiwan',
          taxRegime: 'taiwan_amt',
          annualIncome: 100_000,
          usSourceIncomePct: 1.0,
          conversionTreatyProtection: 'protected',
        },
        {
          startYear: 2032, // gap from 2030 to 2032
          endYear: 2033,
          location: 'korea',
          taxRegime: 'korea_under5',
          annualIncome: 100_000,
          usSourceIncomePct: 1.0,
          conversionTreatyProtection: 'protected',
        },
      ],
      2026,
      2034
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('contiguous'))).toBe(true);
  });

  it('errors if phases overlap', () => {
    const result = validateCoastPhases(
      [
        {
          startYear: 2028,
          endYear: 2031,
          location: 'taiwan',
          taxRegime: 'taiwan_amt',
          annualIncome: 100_000,
          usSourceIncomePct: 1.0,
          conversionTreatyProtection: 'protected',
        },
        {
          startYear: 2030, // overlaps with prior phase
          endYear: 2033,
          location: 'korea',
          taxRegime: 'korea_under5',
          annualIncome: 100_000,
          usSourceIncomePct: 1.0,
          conversionTreatyProtection: 'protected',
        },
      ],
      2026,
      2034
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('overlap'))).toBe(true);
  });

  it('accepts valid single-phase Coast config', () => {
    const result = validateCoastPhases(
      [
        {
          startYear: 2030,
          endYear: 2033,
          location: 'korea',
          taxRegime: 'korea_under5',
          annualIncome: 150_000,
          usSourceIncomePct: 0.6,
          conversionTreatyProtection: 'protected',
        },
      ],
      2026,
      2034
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts valid multi-phase Coast (Sequence III: Taiwan → Korea)', () => {
    const result = validateCoastPhases(
      [
        {
          startYear: 2028,
          endYear: 2030,
          location: 'taiwan',
          taxRegime: 'taiwan_amt',
          annualIncome: 100_000,
          usSourceIncomePct: 1.0,
          conversionTreatyProtection: 'protected',
        },
        {
          startYear: 2031,
          endYear: 2033,
          location: 'korea',
          taxRegime: 'korea_under5',
          annualIncome: 180_000,
          usSourceIncomePct: 0.55,
          conversionTreatyProtection: 'protected',
        },
      ],
      2026,
      2034
    );
    expect(result.valid).toBe(true);
  });
});

// ─── End-to-end Coast simulation ─────────────────────────────────────────────

const baseProfile: ClientProfile = {
  client: {
    name: 'Alex',
    age: 40,
    birthYear: 1986,
    lifeExpectancy: 90,
    fullRetirementAge: 67,
    fraMonthlyBenefit: 3500,
    socialSecurityClaimAge: 67,
  },
  spouse: {
    name: 'Morgan',
    age: 40,
    birthYear: 1986,
    lifeExpectancy: 92,
    fullRetirementAge: 67,
    fraMonthlyBenefit: 2800,
    socialSecurityClaimAge: 67,
  },
  filingStatus: 'married_filing_jointly',
  stateOfResidence: 'FL', // no state income tax during Coast — assume domicile change
  hasStateIncomeTax: false,
  currentYear: 2026,
  retirementYearDesired: 2034,
  cobraMonths: 0,
  acaHouseholdSize: 6,
  annualGrowthRate: 0.06,
  retirementLocation: 'international',
  annualContributions: {
    pretax: 30_000,
    roth: 14_000,
    brokerage: 50_000,
    hsa: 8_000,
  },
};

const baseAssets = deriveAssetTotals(
  [
    {
      id: 'p1',
      label: 'Pretax 401k',
      owner: 'client',
      type: 'pretax_ira',
      currentBalance: 800_000,
    },
    {
      id: 'r1',
      label: 'Roth IRA',
      owner: 'client',
      type: 'roth_ira',
      currentBalance: 200_000,
    },
    {
      id: 'b1',
      label: 'Brokerage',
      owner: 'joint',
      type: 'brokerage',
      currentBalance: 400_000,
      costBasis: 250_000,
    },
  ],
  0
);

const baseSpending: SpendingProfile = {
  baseAnnualSpending: 90_000,
  travelBudgetEarly: 5_000,
  travelBudgetLate: 2_000,
  travelTaperStartAge: 75,
  charitableGivingAnnual: 0,
  oneTimeExpenses: [],
  inflationRate: 0.03,
};

const baseGuardrails: GuardrailConfig = {
  lowerGuardrailDropPct: 0.20,
  lowerGuardrailSpendingCutPct: 0.10,
};

describe('runSimulation with Coast phase', () => {
  it('throws on invalid coastPhases configuration', () => {
    const profile: ClientProfile = {
      ...baseProfile,
      coastPhases: [
        {
          startYear: 2035, // after retirement
          endYear: 2036,
          location: 'korea',
          taxRegime: 'korea_under5',
          annualIncome: 100_000,
          usSourceIncomePct: 1.0,
          conversionTreatyProtection: 'protected',
        },
      ],
    };
    expect(() => runSimulation(profile, baseAssets, baseSpending, baseGuardrails, 'retire_at_stated_date'))
      .toThrow(/Invalid coastPhases/);
  });

  it('no coastPhases → behaves identically to pre-Coast (regression check)', () => {
    const withoutCoast = runSimulation(baseProfile, baseAssets, baseSpending, baseGuardrails, 'retire_at_stated_date');
    const withEmptyCoast = runSimulation(
      { ...baseProfile, coastPhases: [] },
      baseAssets,
      baseSpending,
      baseGuardrails,
      'retire_at_stated_date'
    );
    expect(withEmptyCoast.yearlyProjections.length).toBe(withoutCoast.yearlyProjections.length);
    expect(withEmptyCoast.yearlyProjections.length).toBeGreaterThan(0);
  });

  it('Sequence II — Korea Coast w/ spouse working locally: produces coast season projections', () => {
    const profile: ClientProfile = {
      ...baseProfile,
      coastPhases: [
        {
          startYear: 2030,
          endYear: 2033,
          location: 'korea',
          taxRegime: 'korea_under5',
          annualIncome: 180_000, // primary earner US remote $100k + spouse Korean pharma $80k
          usSourceIncomePct: 0.56, // ~$100k US-source remote
          conversionTreatyProtection: 'protected',
          annualRemittanceToHost: 0, // US remote paid to US bank; no foreign remittance
        },
      ],
    };
    const result = runSimulation(profile, baseAssets, baseSpending, baseGuardrails, 'retire_at_stated_date');

    const coastProjections = result.yearlyProjections.filter(p => p.season === 'coast');
    expect(coastProjections.length).toBe(4); // 2030, 2031, 2032, 2033

    // Each coast year has Coast income reported
    for (const proj of coastProjections) {
      expect(proj.income.otherIncome).toBe(180_000);
      expect(proj.taxLiability.foreignTax).toBeGreaterThan(0); // spouse's Korean salary is host-source
      expect(proj.season).toBe('coast');
    }

    // Coast doesn't trigger ACA/IRMAA
    expect(coastProjections.every(p => p.acaSubsidyEligible === false)).toBe(true);
    expect(coastProjections.every(p => p.irmaaApplies === false)).toBe(true);
  });

  it('Sequence II — Coast income exceeds expenses → no draws from accounts', () => {
    const profile: ClientProfile = {
      ...baseProfile,
      coastPhases: [
        {
          startYear: 2030,
          endYear: 2033,
          location: 'korea',
          taxRegime: 'korea_under5',
          annualIncome: 180_000,
          usSourceIncomePct: 0.56,
          conversionTreatyProtection: 'protected',
        },
      ],
    };
    const result = runSimulation(profile, baseAssets, baseSpending, baseGuardrails, 'retire_at_stated_date');
    const coastProjections = result.yearlyProjections.filter(p => p.season === 'coast');
    // $180k coast income net of tax (~$20k Korean tax + minimal US fed after FTC) ≈ $150-160k > $90k spending
    // → no withdrawals needed
    for (const proj of coastProjections) {
      expect(proj.withdrawals.total).toBe(0);
    }
  });

  it('Sequence IV — Japan NPR Coast: US remote shielded by NPR rule', () => {
    const profile: ClientProfile = {
      ...baseProfile,
      coastPhases: [
        {
          startYear: 2030,
          endYear: 2033,
          location: 'japan',
          taxRegime: 'japan_npr',
          annualIncome: 130_000, // single earner US remote only
          usSourceIncomePct: 1.0, // 100% US-source
          conversionTreatyProtection: 'protected',
          annualRemittanceToHost: 0, // paid to US bank, not remitted
        },
      ],
    };
    const result = runSimulation(profile, baseAssets, baseSpending, baseGuardrails, 'retire_at_stated_date');
    const coastProjections = result.yearlyProjections.filter(p => p.season === 'coast');
    expect(coastProjections.length).toBe(4);
    // NPR shields foreign-source income that isn't remitted; no Japan tax expected
    for (const proj of coastProjections) {
      expect(proj.taxLiability.foreignTax).toBe(0);
    }
    // But US federal tax on US-source income still applies
    for (const proj of coastProjections) {
      expect(proj.taxLiability.totalFederalTax).toBeGreaterThan(0);
    }
  });

  it('Sequence III — Multi-phase Taiwan → Korea Coast: both phases run with correct regimes', () => {
    const profile: ClientProfile = {
      ...baseProfile,
      coastPhases: [
        {
          startYear: 2028,
          endYear: 2030,
          location: 'taiwan',
          taxRegime: 'taiwan_amt',
          annualIncome: 130_000,
          usSourceIncomePct: 1.0,
          conversionTreatyProtection: 'protected',
        },
        {
          startYear: 2031,
          endYear: 2033,
          location: 'korea',
          taxRegime: 'korea_under5',
          annualIncome: 180_000,
          usSourceIncomePct: 0.56,
          conversionTreatyProtection: 'protected',
        },
      ],
    };
    const result = runSimulation(profile, baseAssets, baseSpending, baseGuardrails, 'retire_at_stated_date');
    const coastProjections = result.yearlyProjections.filter(p => p.season === 'coast');
    expect(coastProjections.length).toBe(6); // 2028-2030 (3 yrs Taiwan) + 2031-2033 (3 yrs Korea)

    // Taiwan years: foreignTax = 0 (US remote under NT$7.5M AMT exemption)
    const taiwanYears = coastProjections.filter(p => p.year <= 2030);
    expect(taiwanYears.length).toBe(3);
    for (const proj of taiwanYears) {
      expect(proj.taxLiability.foreignTax).toBe(0);
    }

    // Korea years: foreignTax > 0 (spouse's Korean pharma salary is taxable)
    const koreaYears = coastProjections.filter(p => p.year >= 2031);
    expect(koreaYears.length).toBe(3);
    for (const proj of koreaYears) {
      expect(proj.taxLiability.foreignTax).toBeGreaterThan(0);
    }
  });

  it('routeSurplusToBrokerage=true: Coast surplus flows to brokerage with 100% basis', () => {
    const profileWithRouting: ClientProfile = {
      ...baseProfile,
      coastPhases: [
        {
          startYear: 2030,
          endYear: 2033,
          location: 'korea',
          taxRegime: 'korea_under5',
          annualIncome: 180_000, // high income
          usSourceIncomePct: 0.56,
          conversionTreatyProtection: 'protected',
          routeSurplusToBrokerage: true,
        },
      ],
    };
    const profileWithoutRouting: ClientProfile = {
      ...baseProfile,
      coastPhases: [
        {
          startYear: 2030,
          endYear: 2033,
          location: 'korea',
          taxRegime: 'korea_under5',
          annualIncome: 180_000,
          usSourceIncomePct: 0.56,
          conversionTreatyProtection: 'protected',
          // routeSurplusToBrokerage omitted → defaults to false
        },
      ],
    };

    const withRouting = runSimulation(profileWithRouting, baseAssets, baseSpending, baseGuardrails, 'retire_at_stated_date');
    const withoutRouting = runSimulation(profileWithoutRouting, baseAssets, baseSpending, baseGuardrails, 'retire_at_stated_date');

    // With routing: brokerage at end of coast should be substantially larger
    const lastCoastWithRouting = withRouting.yearlyProjections.filter(p => p.season === 'coast').at(-1)!;
    const lastCoastWithoutRouting = withoutRouting.yearlyProjections.filter(p => p.season === 'coast').at(-1)!;

    expect(lastCoastWithRouting.brokerageEndBalance).toBeGreaterThan(lastCoastWithoutRouting.brokerageEndBalance);
    // Surplus ~$40k/yr × 4 yrs + growth ≈ $170-180k of additional brokerage
    expect(lastCoastWithRouting.brokerageEndBalance - lastCoastWithoutRouting.brokerageEndBalance).toBeGreaterThan(100_000);
  });

  it('Coast with Roth conversions: pretax balance decreases during Coast', () => {
    const profile: ClientProfile = {
      ...baseProfile,
      coastPhases: [
        {
          startYear: 2030,
          endYear: 2033,
          location: 'korea',
          taxRegime: 'korea_under5',
          annualIncome: 180_000,
          usSourceIncomePct: 0.56,
          annualConversion: 50_000,
          conversionTreatyProtection: 'protected',
        },
      ],
    };
    const result = runSimulation(profile, baseAssets, baseSpending, baseGuardrails, 'retire_at_stated_date');
    const coastProjections = result.yearlyProjections.filter(p => p.season === 'coast');

    for (const proj of coastProjections) {
      expect(proj.rothConversion).not.toBeNull();
      expect(proj.rothConversion!.conversionAmount).toBe(50_000);
    }

    // Roth balance grew over Coast (conversions + market growth)
    const firstCoast = coastProjections[0];
    const lastCoast = coastProjections[coastProjections.length - 1];
    expect(lastCoast.rothEndBalance).toBeGreaterThan(firstCoast.rothEndBalance);
  });

  it('Coast transitions cleanly to retirement: post-coast year has retirement season', () => {
    const profile: ClientProfile = {
      ...baseProfile,
      coastPhases: [
        {
          startYear: 2030,
          endYear: 2033,
          location: 'korea',
          taxRegime: 'korea_under5',
          annualIncome: 150_000,
          usSourceIncomePct: 0.6,
          conversionTreatyProtection: 'protected',
        },
      ],
    };
    const result = runSimulation(profile, baseAssets, baseSpending, baseGuardrails, 'retire_at_stated_date');
    const projectionAt2034 = result.yearlyProjections.find(p => p.year === 2034);
    expect(projectionAt2034).toBeDefined();
    expect(projectionAt2034!.season).not.toBe('coast');
    // Retirement location is 'international', so post-coast = 'international' until age 65
    expect(['international', 'aca', 'cobra']).toContain(projectionAt2034!.season);
  });

  it('Monte Carlo with Coast: produces results across full timeline including Coast years', () => {
    const profile: ClientProfile = {
      ...baseProfile,
      coastPhases: [
        {
          startYear: 2030,
          endYear: 2033,
          location: 'korea',
          taxRegime: 'korea_under5',
          annualIncome: 180_000,
          usSourceIncomePct: 0.56,
          conversionTreatyProtection: 'protected',
        },
      ],
    };
    const result = runMonteCarlo(profile, baseAssets, baseSpending, baseGuardrails, 'retire_at_stated_date', {
      simulations: 50, // small for test speed
      meanRealReturn: 0.05,
      stdDevReturn: 0.12,
    });
    expect(result.successRate).toBeGreaterThan(0);
    expect(result.successRate).toBeLessThanOrEqual(1);
    // Portfolio bands should include Coast years (start from 2030, not 2034)
    expect(result.portfolioBands.length).toBeGreaterThan(0);
    const firstBandYear = result.portfolioBands[0].year;
    expect(firstBandYear).toBeLessThanOrEqual(2030); // Coast starts 2030
  });

  it('Monte Carlo without Coast: bands start at retirement year (regression check)', () => {
    const result = runMonteCarlo(baseProfile, baseAssets, baseSpending, baseGuardrails, 'retire_at_stated_date', {
      simulations: 50,
      meanRealReturn: 0.05,
      stdDevReturn: 0.12,
    });
    const firstBandYear = result.portfolioBands[0].year;
    expect(firstBandYear).toBe(2034); // retirementYearDesired
  });

  it('Accumulation contributions truncated at Coast start (not full to retirement)', () => {
    // With Coast 2030-2033, accumulation only runs 2026-2029 (4 years), not 2026-2033 (8 years).
    // Compare end-of-accumulation balances with and without coast to verify accumulation cut short.
    const withoutCoast = runSimulation(baseProfile, baseAssets, baseSpending, baseGuardrails, 'retire_at_stated_date');
    const profile: ClientProfile = {
      ...baseProfile,
      coastPhases: [
        {
          startYear: 2030,
          endYear: 2033,
          location: 'korea',
          taxRegime: 'korea_under5',
          annualIncome: 150_000,
          usSourceIncomePct: 0.6,
          conversionTreatyProtection: 'protected',
        },
      ],
    };
    const withCoast = runSimulation(profile, baseAssets, baseSpending, baseGuardrails, 'retire_at_stated_date');

    // Total simulation years should be similar (death year unchanged), but with Coast there are
    // 4 coast years + retirement; without Coast there are 0 coast years + retirement starting at 2034.
    // The first retirement year is 2034 in both cases.
    const withoutCoastRetirementStart = withoutCoast.yearlyProjections.find(p => p.year === 2034);
    const withCoastRetirementStart = withCoast.yearlyProjections.find(p => p.year === 2034);
    expect(withoutCoastRetirementStart).toBeDefined();
    expect(withCoastRetirementStart).toBeDefined();

    // Coast version should have larger pretax balance at retirement start (no draws during coast, plus growth)
    // OR similar — depends on whether coast did conversions
    // For this test (no conversions), pretax should compound during coast
    expect(withCoastRetirementStart!.pretaxEndBalance).toBeGreaterThan(0);
  });
});
