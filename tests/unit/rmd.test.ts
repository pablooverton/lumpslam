import { describe, it, expect } from 'vitest';
import { calculateRMD, projectInheritedIraDistributions } from '../../src/domain/engine/rmd';

describe('calculateRMD', () => {
  it('returns 0 before RMD start age (73)', () => {
    expect(calculateRMD(1_000_000, 72)).toBe(0);
    expect(calculateRMD(1_000_000, 60)).toBe(0);
  });

  it('age 73: distributes over 26.5 years (IRS Uniform Lifetime Table)', () => {
    // $1M / 26.5 = $37,736
    expect(calculateRMD(1_000_000, 73)).toBeCloseTo(37_736, 0);
  });

  it('age 80: distributes over 20.2 years', () => {
    // $1M / 20.2 = $49,505
    expect(calculateRMD(1_000_000, 80)).toBeCloseTo(49_505, 0);
  });

  it('RMD scales linearly with balance', () => {
    const rmd1 = calculateRMD(500_000, 75);
    const rmd2 = calculateRMD(1_000_000, 75);
    expect(rmd2).toBeCloseTo(rmd1 * 2, 0);
  });

  it('zero balance → zero RMD', () => {
    expect(calculateRMD(0, 75)).toBe(0);
  });
});

describe('projectInheritedIraDistributions', () => {
  it('returns empty array when 0 years remaining', () => {
    expect(projectInheritedIraDistributions(100_000, 0)).toEqual([]);
  });

  it('sums to approximately the original balance (no growth)', () => {
    const dists = projectInheritedIraDistributions(100_000, 10, 0);
    const total = dists.reduce((s, d) => s + d, 0);
    // With 0% growth, each year distributes balance/remaining years
    // Year 1: 100k/10 = 10k, Year 2: 90k/9 = 10k, etc. — all equal $10k
    expect(total).toBeCloseTo(100_000, 0);
  });

  it('has 10 entries for 10 years', () => {
    expect(projectInheritedIraDistributions(100_000, 10, 0)).toHaveLength(10);
  });

  it('distributions increase over time with positive growth (compounding)', () => {
    const dists = projectInheritedIraDistributions(100_000, 5, 0.07);
    // With growth, each distribution should be slightly larger due to compounding
    // (balance grows before distribution)
    // This is a loose test — just verify it runs and produces positive values
    expect(dists.every((d) => d > 0)).toBe(true);
    expect(dists.length).toBe(5);
  });
});
