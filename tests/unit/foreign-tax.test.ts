import { describe, it, expect } from 'vitest';
import {
  calculateForeignTax,
  applyProgressiveBrackets,
} from '../../src/domain/engine/foreign-tax';
import type { ForeignTaxInputs } from '../../src/domain/types/foreign-tax';
import {
  JAPAN_NATIONAL_INCOME_TAX_BRACKETS,
  JAPAN_RESIDENT_TAX_RATE,
  DEFAULT_JPY_PER_USD,
} from '../../src/domain/constants/foreign-tax';

// ─── applyProgressiveBrackets ────────────────────────────────────────────────

describe('applyProgressiveBrackets', () => {
  const simpleBrackets = [
    { floor: 0, rate: 0.10 },
    { floor: 1000, rate: 0.20 },
    { floor: 5000, rate: 0.30 },
  ];

  it('returns 0 for zero or negative income', () => {
    expect(applyProgressiveBrackets(0, simpleBrackets)).toBe(0);
    expect(applyProgressiveBrackets(-100, simpleBrackets)).toBe(0);
  });

  it('taxes income within first bracket at first rate', () => {
    // $500 × 10% = $50
    expect(applyProgressiveBrackets(500, simpleBrackets)).toBe(50);
  });

  it('taxes income spanning two brackets correctly', () => {
    // $2000 = $1000 × 10% + $1000 × 20% = $100 + $200 = $300
    expect(applyProgressiveBrackets(2000, simpleBrackets)).toBe(300);
  });

  it('taxes income spanning all brackets correctly', () => {
    // $7000 = $1000 × 10% + $4000 × 20% + $2000 × 30% = $100 + $800 + $600 = $1500
    expect(applyProgressiveBrackets(7000, simpleBrackets)).toBe(1500);
  });

  it('handles empty brackets', () => {
    expect(applyProgressiveBrackets(10_000, [])).toBe(0);
  });
});

// ─── 'none' regime ───────────────────────────────────────────────────────────

describe('calculateForeignTax — none regime', () => {
  const defaultInputs: ForeignTaxInputs = {
    hostSourceIncome: 0,
    foreignSourceIncome: 100_000,
    rothConversionAmount: 50_000,
    capitalGains: 10_000,
    socialSecurityIncludable: 0,
    remittedToHostCountry: 0,
    conversionTreatyProtection: 'protected',
  };

  it('returns zero tax regardless of income', () => {
    const result = calculateForeignTax('none', defaultInputs);
    expect(result.foreignTax).toBe(0);
    expect(result.foreignTaxCredit).toBe(0);
    expect(result.effectiveRate).toBe(0);
  });

  it('includes a diagnostic note', () => {
    const result = calculateForeignTax('none', defaultInputs);
    expect(result.notes.length).toBeGreaterThan(0);
    expect(result.notes[0]).toContain('No foreign tax');
  });
});

// ─── 'japan_npr' regime ──────────────────────────────────────────────────────

describe('calculateForeignTax — japan_npr regime', () => {
  const baseInputs: ForeignTaxInputs = {
    hostSourceIncome: 0,
    foreignSourceIncome: 100_000,    // primary earner US remote work
    rothConversionAmount: 0,
    capitalGains: 0,
    socialSecurityIncludable: 0,
    remittedToHostCountry: 0,
    conversionTreatyProtection: 'protected',
  };

  it('foreign-source income NOT remitted → zero Japan tax', () => {
    const result = calculateForeignTax('japan_npr', baseInputs);
    expect(result.foreignTax).toBe(0);
    expect(result.effectiveRate).toBe(0);
  });

  it('Japan-source income fully taxed at standard rates', () => {
    // Hypothetical: $50k Japan-source salary at expected effective ~20% rate range
    const result = calculateForeignTax('japan_npr', {
      ...baseInputs,
      foreignSourceIncome: 0,
      hostSourceIncome: 50_000,
    });
    expect(result.foreignTax).toBeGreaterThan(0);
    // $50k = ¥7.25M (at 145¥/$): hits 20% bracket (¥3.3M-6.95M is 20%, ¥6.95M-9M is 23%)
    // National tax: ¥1.95M × 5% + ¥1.35M × 10% + ¥3.65M × 20% + ¥300k × 23% = ¥97.5k + ¥135k + ¥730k + ¥69k = ¥1.0315M
    // Resident tax: ¥7.25M × 10% = ¥725k
    // Total ¥1.7565M / 145 ≈ $12.1k
    expect(result.foreignTax).toBeCloseTo(12_113, -2); // Within ~$100
  });

  it('remitted foreign income → taxed in Japan', () => {
    // Family remits $80k of US capital gains to Japan for living expenses
    const result = calculateForeignTax('japan_npr', {
      ...baseInputs,
      foreignSourceIncome: 0,
      capitalGains: 100_000,
      remittedToHostCountry: 80_000,
    });
    // $80k counts as remitted income (less than $100k capital gains pool)
    expect(result.foreignTax).toBeGreaterThan(0);
    expect(result.notes.some(n => n.includes('treated as remittance'))).toBe(true);
  });

  it('remittance exceeding income pool → excess treated as capital transfer', () => {
    // Remit $100k but only $50k of foreign income+gains for the year
    const result = calculateForeignTax('japan_npr', {
      ...baseInputs,
      foreignSourceIncome: 30_000,
      capitalGains: 20_000,
      remittedToHostCountry: 100_000,
    });
    // Only $50k counts as remittance of income; $50k excess is capital
    expect(result.notes.some(n => n.includes('exceeds year\'s foreign income pool'))).toBe(true);
    expect(result.notes.some(n => n.includes('capital transfer'))).toBe(true);
  });

  it('Roth conversion with treaty protection=protected → no Japan tax on conversion', () => {
    const result = calculateForeignTax('japan_npr', {
      ...baseInputs,
      rothConversionAmount: 242_000,
      conversionTreatyProtection: 'protected',
    });
    expect(result.foreignTax).toBe(0);
  });

  it('Roth conversion with treaty protection=half_taxed → 50% taxable in Japan', () => {
    const result = calculateForeignTax('japan_npr', {
      ...baseInputs,
      rothConversionAmount: 242_000,
      conversionTreatyProtection: 'half_taxed',
    });
    // $121k taxable at Japan progressive rates: ¥17.545M (at 145¥/$)
    // Hits the 33% bracket. Substantial tax.
    expect(result.foreignTax).toBeGreaterThan(20_000);
    expect(result.notes.some(n => n.includes('half_taxed'))).toBe(true);
  });

  it('Roth conversion with treaty protection=fully_taxed → full Japan tax', () => {
    const result = calculateForeignTax('japan_npr', {
      ...baseInputs,
      rothConversionAmount: 242_000,
      conversionTreatyProtection: 'fully_taxed',
    });
    // $242k taxable; significant tax
    expect(result.foreignTax).toBeGreaterThan(50_000);
    expect(result.notes.some(n => n.includes('fully_taxed'))).toBe(true);
  });

  it('single-earner coast scenario: US remote $100k, Roth conv $0, no remittance → zero Japan tax', () => {
    // This is the ideal NPR setup — US remote work fully shielded
    const result = calculateForeignTax('japan_npr', {
      hostSourceIncome: 0,
      foreignSourceIncome: 100_000,
      rothConversionAmount: 0,
      capitalGains: 0,
      socialSecurityIncludable: 0,
      remittedToHostCountry: 0,
      conversionTreatyProtection: 'protected',
    });
    expect(result.foreignTax).toBe(0);
  });

  it('single-earner coast + Roth conversion + small remittance from gains for expenses', () => {
    // Realistic Coast scenario: $100k US remote, $50k conversion, $80k remittance for living
    // No conversion taxed (protected); but if $50k of capital gains remitted, that's taxable
    const result = calculateForeignTax('japan_npr', {
      hostSourceIncome: 0,
      foreignSourceIncome: 100_000,
      rothConversionAmount: 50_000,
      capitalGains: 0,
      socialSecurityIncludable: 0,
      remittedToHostCountry: 80_000,
      conversionTreatyProtection: 'protected',
    });
    // $80k remitted, $100k foreign income pool → $80k taxable in Japan
    expect(result.foreignTax).toBeGreaterThan(0);
    // Should be roughly Japan tax on $80k ≈ ¥11.6M
    // National: ¥1.95M×5% + ¥1.35M×10% + ¥3.65M×20% + ¥2.05M×23% + ¥2.6M×33% = ¥97.5k+135k+730k+471.5k+858k = ¥2.292M
    // Resident: ¥11.6M × 10% = ¥1.16M
    // Total ¥3.452M / 145 ≈ $23.8k
    expect(result.foreignTax).toBeCloseTo(23_807, -3); // Within ~$1k
  });

  it('effective rate calculated over total foreign-related income', () => {
    const result = calculateForeignTax('japan_npr', {
      ...baseInputs,
      foreignSourceIncome: 100_000,
      remittedToHostCountry: 100_000,
      conversionTreatyProtection: 'protected',
    });
    expect(result.effectiveRate).toBeGreaterThan(0);
    expect(result.effectiveRate).toBeLessThan(0.55); // Top Japanese rate
  });
});

// ─── 'japan_full' regime ─────────────────────────────────────────────────────

describe('calculateForeignTax — japan_full regime', () => {
  const base: ForeignTaxInputs = {
    hostSourceIncome: 0,
    foreignSourceIncome: 0,
    rothConversionAmount: 0,
    capitalGains: 0,
    socialSecurityIncludable: 0,
    remittedToHostCountry: 0,
    conversionTreatyProtection: 'protected',
  };

  it('worldwide US remote income fully taxed (no NPR shield post-year-5)', () => {
    const result = calculateForeignTax('japan_full', { ...base, foreignSourceIncome: 100_000 });
    // $100k = ¥14.5M; substantial tax
    expect(result.foreignTax).toBeGreaterThan(20_000);
  });

  it('SS distributions treaty-protected (not added to Japan taxable)', () => {
    const result = calculateForeignTax('japan_full', { ...base, socialSecurityIncludable: 40_000 });
    expect(result.foreignTax).toBe(0);
    expect(result.notes.some(n => n.includes('Social Security'))).toBe(true);
  });

  it('Roth conversion treaty=protected → no Japan tax on conversion', () => {
    const result = calculateForeignTax('japan_full', {
      ...base,
      rothConversionAmount: 242_000,
      conversionTreatyProtection: 'protected',
    });
    expect(result.foreignTax).toBe(0);
  });

  it('Roth conversion treaty=fully_taxed → substantial Japan tax', () => {
    const result = calculateForeignTax('japan_full', {
      ...base,
      rothConversionAmount: 242_000,
      conversionTreatyProtection: 'fully_taxed',
    });
    // $242k = ¥35.09M; pushes well into 33-40% brackets
    expect(result.foreignTax).toBeGreaterThan(80_000);
  });

  it('worldwide effective rate substantially higher than US-only', () => {
    const result = calculateForeignTax('japan_full', {
      ...base,
      foreignSourceIncome: 100_000,
      conversionTreatyProtection: 'protected',
    });
    expect(result.effectiveRate).toBeGreaterThan(0.15);
  });
});

// ─── 'korea_under5' regime ───────────────────────────────────────────────────

describe('calculateForeignTax — korea_under5 regime', () => {
  const base: ForeignTaxInputs = {
    hostSourceIncome: 0,
    foreignSourceIncome: 0,
    rothConversionAmount: 0,
    capitalGains: 0,
    socialSecurityIncludable: 0,
    remittedToHostCountry: 0,
    conversionTreatyProtection: 'protected',
  };

  it('US remote work not remitted → zero Korea tax', () => {
    const result = calculateForeignTax('korea_under5', { ...base, foreignSourceIncome: 100_000 });
    expect(result.foreignTax).toBe(0);
  });

  it('Korean-source income (locally-employed spouse pharma salary) fully taxed', () => {
    const result = calculateForeignTax('korea_under5', { ...base, hostSourceIncome: 80_000 });
    // $80k = ₩108M; substantial Korean tax
    expect(result.foreignTax).toBeGreaterThan(10_000);
    expect(result.notes.some(n => n.includes('Korea under-5-year'))).toBe(true);
  });

  it('remitted foreign income taxed', () => {
    const result = calculateForeignTax('korea_under5', {
      ...base,
      foreignSourceIncome: 100_000,
      remittedToHostCountry: 80_000,
    });
    expect(result.foreignTax).toBeGreaterThan(0);
    expect(result.notes.some(n => n.includes('taxable in Korea'))).toBe(true);
  });

  it('Coast scenario: $100k US remote (not remitted) + $80k host-country pharma', () => {
    const result = calculateForeignTax('korea_under5', {
      hostSourceIncome: 80_000,
      foreignSourceIncome: 100_000,
      rothConversionAmount: 0,
      capitalGains: 0,
      socialSecurityIncludable: 0,
      remittedToHostCountry: 0,
      conversionTreatyProtection: 'protected',
    });
    // Only host-source $80k taxed; US remote is shielded by non-remittance
    expect(result.foreignTax).toBeGreaterThan(10_000);
    expect(result.foreignTax).toBeLessThan(20_000);
  });

  it('Roth conversion treaty=protected during under-5-year window → no Korea tax', () => {
    const result = calculateForeignTax('korea_under5', {
      ...base,
      rothConversionAmount: 242_000,
      conversionTreatyProtection: 'protected',
    });
    expect(result.foreignTax).toBe(0);
  });
});

// ─── 'korea_over5' regime ────────────────────────────────────────────────────

describe('calculateForeignTax — korea_over5 regime', () => {
  const base: ForeignTaxInputs = {
    hostSourceIncome: 0,
    foreignSourceIncome: 0,
    rothConversionAmount: 0,
    capitalGains: 0,
    socialSecurityIncludable: 0,
    remittedToHostCountry: 0,
    conversionTreatyProtection: 'protected',
  };

  it('worldwide taxation: US remote income now fully taxed', () => {
    const result = calculateForeignTax('korea_over5', { ...base, foreignSourceIncome: 100_000 });
    expect(result.foreignTax).toBeGreaterThan(15_000);
    expect(result.notes.some(n => n.includes('5+ years'))).toBe(true);
  });

  it('SS distributions treaty-protected (pension for past employment)', () => {
    const result = calculateForeignTax('korea_over5', { ...base, socialSecurityIncludable: 40_000 });
    expect(result.foreignTax).toBe(0);
  });

  it('Roth distribution context: conversions done before year 5; only distributions remain', () => {
    // Year 6+ in Korea, no more conversions happening, just SS + small brokerage gains
    const result = calculateForeignTax('korea_over5', {
      ...base,
      socialSecurityIncludable: 40_000,
      capitalGains: 5_000,
    });
    // Only $5k capital gains taxable (SS is treaty-protected)
    expect(result.foreignTax).toBeGreaterThan(0);
    expect(result.foreignTax).toBeLessThan(2_000);
  });

  it('adverse case: conversion at year 5+ with fully_taxed treaty interpretation', () => {
    // Worst case scenario from vault: $242k conversion taxed at Korean rates
    const result = calculateForeignTax('korea_over5', {
      ...base,
      rothConversionAmount: 242_000,
      conversionTreatyProtection: 'fully_taxed',
    });
    // $242k = ₩327M; deep into 38-42% brackets
    expect(result.foreignTax).toBeGreaterThan(70_000);
  });
});

// ─── 'taiwan_amt' regime ─────────────────────────────────────────────────────

describe('calculateForeignTax — taiwan_amt regime', () => {
  const base: ForeignTaxInputs = {
    hostSourceIncome: 0,
    foreignSourceIncome: 0,
    rothConversionAmount: 0,
    capitalGains: 0,
    socialSecurityIncludable: 0,
    remittedToHostCountry: 0,
    conversionTreatyProtection: 'protected',
  };

  it('foreign-source income below NT$1M threshold → fully exempt', () => {
    // $20k = ~NT$628k, well below NT$1M
    const result = calculateForeignTax('taiwan_amt', { ...base, foreignSourceIncome: 20_000 });
    expect(result.foreignTax).toBe(0);
    expect(result.notes.some(n => n.includes('threshold → fully exempt'))).toBe(true);
  });

  it('100% inclusion default: $100k US remote → AMT', () => {
    // $100k = NT$3.14M; under NT$7.5M exemption with no other income → still $0
    const result = calculateForeignTax('taiwan_amt', { ...base, foreignSourceIncome: 100_000 });
    expect(result.foreignTax).toBe(0);
    expect(result.notes.some(n => n.includes('100% inclusion'))).toBe(true);
  });

  it('100% inclusion default: $250k breaches exemption → AMT triggers', () => {
    // $250k = NT$7.85M; over NT$7.5M exemption → ~NT$350k × 20% = NT$70k ≈ $2.2k
    const result = calculateForeignTax('taiwan_amt', { ...base, foreignSourceIncome: 250_000 });
    expect(result.foreignTax).toBeGreaterThan(1_500);
    expect(result.foreignTax).toBeLessThan(3_000);
  });

  it('vault Roth conversion scenario: $242k under 100% inclusion → still $0', () => {
    // $242k = NT$7.6M; conservative inclusion treats as Basic Income; still below NT$7.5M after no Taiwan income
    // Actually wait: NT$7.6M is ABOVE NT$7.5M (slightly). Let me check.
    // $242k * 31.4 = NT$7,598,800; exemption = NT$7,500,000
    // Basic Income above exemption = NT$98,800; AMT = NT$19,760 = $629 USD
    const result = calculateForeignTax('taiwan_amt', {
      ...base,
      rothConversionAmount: 242_000,
      conversionTreatyProtection: 'fully_taxed', // pessimistic treaty for AMT analysis
    });
    // Thin buffer; small tax under conservative interpretation
    expect(result.foreignTax).toBeGreaterThan(500);
    expect(result.foreignTax).toBeLessThan(1_500);
  });

  it('vault $242k conversion with treaty=protected (conversion not foreign income) → $0', () => {
    // With protected treaty, conversion is shielded → no foreign income for AMT
    const result = calculateForeignTax('taiwan_amt', {
      ...base,
      rothConversionAmount: 242_000,
      conversionTreatyProtection: 'protected',
    });
    expect(result.foreignTax).toBe(0);
  });

  it('50% inclusion mode: $242k conversion with full treaty taxability → still $0 (matches vault original)', () => {
    // 50% mode: above-threshold amount * 50% included. (NT$7.6M - NT$1M) * 50% = NT$3.3M Basic Income
    // NT$3.3M is well below NT$7.5M exemption → $0
    const result = calculateForeignTax('taiwan_amt', {
      ...base,
      rothConversionAmount: 242_000,
      conversionTreatyProtection: 'fully_taxed',
      taiwanAmtInclusionMode: '50pct',
    });
    expect(result.foreignTax).toBe(0);
  });

  it('50% inclusion mode: ~$500k conversion (vault claim of $0 up to $503k) → still $0', () => {
    // $500k = NT$15.7M; above NT$1M threshold; 50% mode: (NT$15.7M - NT$1M) * 50% = NT$7.35M
    // Just below NT$7.5M → $0 AMT
    const result = calculateForeignTax('taiwan_amt', {
      ...base,
      rothConversionAmount: 500_000,
      conversionTreatyProtection: 'fully_taxed',
      taiwanAmtInclusionMode: '50pct',
    });
    expect(result.foreignTax).toBe(0);
  });

  it('50% mode: $600k conversion exceeds even 50% vault buffer → AMT triggers', () => {
    const result = calculateForeignTax('taiwan_amt', {
      ...base,
      rothConversionAmount: 600_000,
      conversionTreatyProtection: 'fully_taxed',
      taiwanAmtInclusionMode: '50pct',
    });
    expect(result.foreignTax).toBeGreaterThan(0);
  });

  it('diagnostic note includes inclusion mode warning when 50pct is used', () => {
    const result = calculateForeignTax('taiwan_amt', {
      ...base,
      foreignSourceIncome: 200_000,
      taiwanAmtInclusionMode: '50pct',
    });
    expect(result.notes.some(n => n.includes('verify with CPA'))).toBe(true);
  });

  it('Coast scenario: $100k US remote, no conversion, no Taiwan income → $0', () => {
    const result = calculateForeignTax('taiwan_amt', {
      hostSourceIncome: 0,
      foreignSourceIncome: 100_000,
      rothConversionAmount: 0,
      capitalGains: 0,
      socialSecurityIncludable: 0,
      remittedToHostCountry: 0,
      conversionTreatyProtection: 'protected',
    });
    expect(result.foreignTax).toBe(0);
  });
});
