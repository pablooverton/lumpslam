import { describe, it, expect } from 'vitest';
import {
  calculateMAGI,
  assessAcaEligibility,
  calculateIrmaaSurcharge,
  classifySeasonForYear,
  getCobraWindowEnd,
} from '../../src/domain/engine/seasons';
import type { ClientProfile } from '../../src/domain/types/profile';

// ─── MAGI ────────────────────────────────────────────────────────────────────

describe('calculateMAGI', () => {
  it('only pretax withdrawals → MAGI equals withdrawals', () => {
    const magi = calculateMAGI({
      socialSecurityIncludable: 0,
      pretaxWithdrawals: 50_000,
      rothConversionAmount: 0,
      capitalGainsRealized: 0,
      otherIncome: 0,
    });
    expect(magi).toBe(50_000);
  });

  it('SS income: only 85% is includable', () => {
    // $40,000 SS × 85% = $34,000 includable
    const magi = calculateMAGI({
      socialSecurityIncludable: 40_000 * 0.85,
      pretaxWithdrawals: 0,
      rothConversionAmount: 0,
      capitalGainsRealized: 0,
      otherIncome: 0,
    });
    expect(magi).toBeCloseTo(34_000, 0);
  });

  it('Roth conversions add to MAGI', () => {
    const magi = calculateMAGI({
      socialSecurityIncludable: 0,
      pretaxWithdrawals: 40_000,
      rothConversionAmount: 30_000,
      capitalGainsRealized: 0,
      otherIncome: 0,
    });
    expect(magi).toBe(70_000);
  });

  it('brokerage return-of-basis does NOT appear in MAGI', () => {
    // This is the fundamental ACA strategy: brokerage withdrawal of basis = 0 MAGI
    const magi = calculateMAGI({
      socialSecurityIncludable: 0,
      pretaxWithdrawals: 0,
      rothConversionAmount: 0,
      capitalGainsRealized: 0, // cost basis portion only
      otherIncome: 0,
    });
    expect(magi).toBe(0);
  });
});

// ─── ACA Eligibility ─────────────────────────────────────────────────────────

describe('assessAcaEligibility', () => {
  it('MAGI below cliff → eligible', () => {
    const result = assessAcaEligibility(50_000);
    expect(result.eligible).toBe(true);
    expect(result.estimatedAnnualSavings).toBeGreaterThan(0);
  });

  it('MAGI exactly at cliff ($84,600) → NOT eligible (cliff is exclusive)', () => {
    const result = assessAcaEligibility(84_600);
    // $84,600 is the threshold — equal to or above loses subsidies
    expect(result.eligible).toBe(false);
  });

  it('MAGI $1 over cliff ($84,601) → not eligible', () => {
    const result = assessAcaEligibility(84_601);
    expect(result.eligible).toBe(false);
    expect(result.estimatedAnnualSavings).toBe(0);
  });

  it('reports correct headroom', () => {
    const result = assessAcaEligibility(60_000);
    expect(result.headroom).toBeCloseTo(84_600 - 60_000, 0);
  });
});

// ─── IRMAA ────────────────────────────────────────────────────────────────────

describe('calculateIrmaaSurcharge', () => {
  it('below first IRMAA bracket → no surcharge', () => {
    expect(calculateIrmaaSurcharge(100_000, 'married_filing_jointly')).toBe(0);
  });

  it('above first MFJ IRMAA threshold ($212,000) → surcharge applies', () => {
    expect(calculateIrmaaSurcharge(220_000, 'married_filing_jointly')).toBeGreaterThan(0);
  });

  it('single filer threshold is half of MFJ', () => {
    // Single threshold starts at $106,000
    const singleSurcharge = calculateIrmaaSurcharge(110_000, 'single');
    expect(singleSurcharge).toBeGreaterThan(0);
    // Same income below MFJ threshold = no surcharge MFJ
    const mfjNoSurcharge = calculateIrmaaSurcharge(110_000, 'married_filing_jointly');
    expect(mfjNoSurcharge).toBe(0);
  });
});

// ─── Season Classification ────────────────────────────────────────────────────

describe('classifySeasonForYear', () => {
  const mockProfile: ClientProfile = {
    client: { name: 'Test', age: 59, birthYear: 1967, lifeExpectancy: 90, fullRetirementAge: 67, fraMonthlyBenefit: 3000, socialSecurityClaimAge: 68 },
    spouse: null,
    filingStatus: 'single',
    stateOfResidence: 'TX',
    hasStateIncomeTax: false,
    currentYear: 2026,
    retirementYearDesired: 2026,
    cobraMonths: 18,
  };

  it('year of retirement (cobra period) → cobra', () => {
    const cobraEnd = getCobraWindowEnd(2026, 18);
    expect(classifySeasonForYear(2026, mockProfile, cobraEnd)).toBe('cobra');
  });

  it('first year after cobra, client age < 65 → aca', () => {
    // Client retires at 59 in 2026, COBRA ends in 2027, then ACA from 2028 (age 61)
    const cobraEnd = getCobraWindowEnd(2026, 18);
    expect(classifySeasonForYear(2028, mockProfile, cobraEnd)).toBe('aca');
  });

  it('client age 65-72 → medicare', () => {
    // Client is 59 in 2026; age 65 = year 2032
    const cobraEnd = getCobraWindowEnd(2026, 18);
    expect(classifySeasonForYear(2032, mockProfile, cobraEnd)).toBe('medicare');
  });

  it('client age 73+ → rmd', () => {
    // Age 73 = year 2040
    const cobraEnd = getCobraWindowEnd(2026, 18);
    expect(classifySeasonForYear(2040, mockProfile, cobraEnd)).toBe('rmd');
  });
});
