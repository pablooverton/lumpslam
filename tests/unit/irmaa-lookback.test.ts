import { describe, it, expect } from 'vitest';
import {
  calculateIrmaaSurcharge,
  classifyIrmaaTier,
} from '../../src/domain/engine/seasons';

// The IRMAA 2-year lookback is material: a Roth conversion at age 65 doesn't trigger the
// Medicare surcharge until age 67. Modeling it in the same year over-penalizes conversion
// strategies and mis-times the cost. These tests lock in the lookback contract at the
// boundary between the engine and the caller (simulation-runner supplies the lookback).

describe('calculateIrmaaSurcharge — lookback semantics', () => {
  it('no surcharge below Tier 1 floor', () => {
    expect(calculateIrmaaSurcharge(200_000, 'married_filing_jointly')).toBe(0);
  });

  it('Tier 1 surcharge applied at the MFJ floor ($212k)', () => {
    const s = calculateIrmaaSurcharge(213_000, 'married_filing_jointly');
    expect(s).toBeGreaterThan(0);
    // Part B $74 + Part D $13.70 per person × 2 × 12 = $2,104.80/yr
    expect(s).toBeCloseTo(2_104.8, 0);
  });

  it('Tier 2 surcharge applied at $266k+ MFJ', () => {
    const s = calculateIrmaaSurcharge(270_000, 'married_filing_jointly');
    // ($185 + $35.70) × 2 × 12 = $5,296.80
    expect(s).toBeCloseTo(5_296.8, 0);
  });

  it('single filer surcharge is half the couple surcharge', () => {
    const couple = calculateIrmaaSurcharge(220_000, 'married_filing_jointly');
    const single = calculateIrmaaSurcharge(110_000, 'single');
    expect(single).toBeCloseTo(couple / 2, 0);
  });
});

describe('classifyIrmaaTier — tier introspection', () => {
  it('MAGI $200k (MFJ) → no surcharge tier', () => {
    const info = classifyIrmaaTier(200_000, 'married_filing_jointly');
    expect(info.tierIndex).toBe(0);
    expect(info.tierLabel).toBe('No surcharge');
    expect(info.annualSurchargeCouple).toBe(0);
  });

  it('MAGI $260k (MFJ) → Tier 1, reports room to Tier 2', () => {
    const info = classifyIrmaaTier(260_000, 'married_filing_jointly');
    expect(info.tierIndex).toBe(1);
    expect(info.tierLabel).toBe('Tier 1');
    expect(info.magiCeiling).toBe(266_000);
    expect(info.roomToNextTier).toBe(6_000);
    expect(info.nextTierJump).toBeGreaterThan(0);
  });

  it('top-tier MAGI reports Infinity for room', () => {
    const info = classifyIrmaaTier(1_000_000, 'married_filing_jointly');
    expect(info.roomToNextTier).toBe(Infinity);
    expect(info.nextTierJump).toBe(0);
  });
});
