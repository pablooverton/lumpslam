import { describe, it, expect } from 'vitest';
import {
  calculateOrdinaryIncomeTax,
  getMarginalRate,
  remainingCapacityInBracket,
} from '../../src/domain/engine/tax-utils';

describe('calculateOrdinaryIncomeTax (MFJ 2025 brackets)', () => {
  it('10% bracket only: $23,850 → $2,385', () => {
    expect(calculateOrdinaryIncomeTax(23_850, 'married_filing_jointly')).toBeCloseTo(2_385, 0);
  });

  it('12% bracket: $50,000 MFJ', () => {
    // 23850 * 10% + (50000 - 23850) * 12%
    const expected = 23_850 * 0.10 + (50_000 - 23_850) * 0.12;
    expect(calculateOrdinaryIncomeTax(50_000, 'married_filing_jointly')).toBeCloseTo(expected, 0);
  });

  it('22% bracket: $100,000 MFJ', () => {
    const expected =
      23_850 * 0.10 +
      (96_950 - 23_850) * 0.12 +
      (100_000 - 96_950) * 0.22;
    expect(calculateOrdinaryIncomeTax(100_000, 'married_filing_jointly')).toBeCloseTo(expected, 0);
  });

  it('zero income → zero tax', () => {
    expect(calculateOrdinaryIncomeTax(0, 'married_filing_jointly')).toBe(0);
  });

  it('single filer brackets are narrower than MFJ', () => {
    const single = calculateOrdinaryIncomeTax(50_000, 'single');
    const mfj = calculateOrdinaryIncomeTax(50_000, 'married_filing_jointly');
    expect(single).toBeGreaterThan(mfj);
  });
});

describe('getMarginalRate', () => {
  it('$20,000 MFJ → 10%', () => {
    expect(getMarginalRate(20_000, 'married_filing_jointly')).toBe(0.10);
  });

  it('$50,000 MFJ → 12%', () => {
    expect(getMarginalRate(50_000, 'married_filing_jointly')).toBe(0.12);
  });

  it('$100,000 MFJ → 22%', () => {
    expect(getMarginalRate(100_000, 'married_filing_jointly')).toBe(0.22);
  });

  it('$400,000 MFJ → 32%', () => {
    expect(getMarginalRate(400_000, 'married_filing_jointly')).toBe(0.32);
  });

  it('single at $50,000 is in 22% bracket (narrower brackets)', () => {
    expect(getMarginalRate(50_000, 'single')).toBe(0.22);
  });
});

describe('remainingCapacityInBracket', () => {
  it('$50,000 MFJ → room up to $96,950 = $46,950', () => {
    expect(remainingCapacityInBracket(50_000, 'married_filing_jointly')).toBeCloseTo(46_950, 0);
  });

  it('at exact bracket ceiling → 0 headroom', () => {
    expect(remainingCapacityInBracket(96_950, 'married_filing_jointly')).toBeCloseTo(0, 0);
  });

  it('$0 income → full 10% bracket available', () => {
    expect(remainingCapacityInBracket(0, 'married_filing_jointly')).toBeCloseTo(23_850, 0);
  });
});
