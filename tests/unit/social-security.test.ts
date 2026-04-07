import { describe, it, expect } from 'vitest';
import { calculateBenefitAtClaimAge, calculateLifetimeBenefit } from '../../src/domain/engine/social-security';

// FRA = 67 for anyone born 1960+, which is Mike (born 1966)
const FRA_MONTHLY = 3_200;
const FRA = 67;

describe('calculateBenefitAtClaimAge', () => {
  it('at FRA → full benefit', () => {
    expect(calculateBenefitAtClaimAge(FRA_MONTHLY, FRA, 67)).toBeCloseTo(3_200, 0);
  });

  it('claim at 70 → +24% (3 years × 8%)', () => {
    expect(calculateBenefitAtClaimAge(FRA_MONTHLY, FRA, 70)).toBeCloseTo(3_968, 0);
  });

  it('claim at 68 → +8% (1 year delayed)', () => {
    expect(calculateBenefitAtClaimAge(FRA_MONTHLY, FRA, 68)).toBeCloseTo(3_456, 0);
  });

  it('claim at 62 → -30% (5 years early: 20% + 10%)', () => {
    // First 3 years early: 3 × 6.67% = 20%
    // Next 2 years early:  2 × 5.00% = 10%
    // Total reduction: 30%
    expect(calculateBenefitAtClaimAge(FRA_MONTHLY, FRA, 62)).toBeCloseTo(3_200 * 0.70, 0);
  });

  it('claim at 64 → -20% (3 years early)', () => {
    // 3 × 6.67% = 20%
    expect(calculateBenefitAtClaimAge(FRA_MONTHLY, FRA, 64)).toBeCloseTo(3_200 * 0.80, 0);
  });

  it('delayed credits cap at 70 (no credit beyond age 70)', () => {
    // Age 71 should give same as age 70
    const at70 = calculateBenefitAtClaimAge(FRA_MONTHLY, FRA, 70);
    const at71 = calculateBenefitAtClaimAge(FRA_MONTHLY, FRA, 71);
    expect(at71).toBeCloseTo(at70, 0);
  });
});

describe('calculateLifetimeBenefit', () => {
  it('claiming at 62 vs 70: later claim has higher lifetime value given long life expectancy', () => {
    // Life expectancy 90, FRA 67, $3200/mo benefit
    const lifetime62 = calculateLifetimeBenefit(
      calculateBenefitAtClaimAge(FRA_MONTHLY, FRA, 62),
      62, 90
    );
    const lifetime70 = calculateLifetimeBenefit(
      calculateBenefitAtClaimAge(FRA_MONTHLY, FRA, 70),
      70, 90
    );
    expect(lifetime70).toBeGreaterThan(lifetime62);
  });

  it('claiming early is better if life expectancy is short', () => {
    // Life expectancy 72, FRA 67
    const lifetime62 = calculateLifetimeBenefit(
      calculateBenefitAtClaimAge(FRA_MONTHLY, FRA, 62),
      62, 72
    );
    const lifetime70 = calculateLifetimeBenefit(
      calculateBenefitAtClaimAge(FRA_MONTHLY, FRA, 70),
      70, 72
    );
    // Claiming at 70 then dying at 72 = only 2 years of higher benefit
    // Claiming at 62 = 10 years of lower benefit
    expect(lifetime62).toBeGreaterThan(lifetime70);
  });
});
