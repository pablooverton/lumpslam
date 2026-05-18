// Foreign tax framework for Coast FIRE and international retirement modeling.
//
// Each ForeignTaxRegime represents a specific country + residency-duration combination
// with distinct mechanics. The mechanics are NOT a simple effective-rate multiplier —
// e.g., Japan NPR exempts foreign-source income that isn't remitted; Korea under-5
// applies a similar rule; Taiwan applies AMT with a high exemption floor.
//
// All inputs and outputs are in real USD. Country thresholds (e.g., Taiwan's NT$7.5M
// AMT exemption) are converted via the regime's internal exchange-rate assumption.
//
// IMPORTANT: This is a planning aid. Real-world tax filings require a cross-border CPA.
// Documented assumptions and ambiguities are in src/domain/engine/foreign-tax.ts.

export type ForeignTaxRegime =
  | 'none'           // US domestic baseline (no foreign tax). Used during accumulation in US.
  | 'japan_npr'      // Japan Non-Permanent Resident (years 1-5): foreign-source income exempt if not remitted to Japan; Japan-source taxed.
  | 'japan_full'     // Japan full tax resident (year 6+): worldwide taxation; treaty offsets pension distributions per US-Japan treaty Article 17.
  | 'korea_under5'   // Korea, less than 5 of 10 preceding years resident: foreign-source income taxed only if paid in or remitted to Korea.
  | 'korea_over5'    // Korea, 5+ of 10 preceding years resident: worldwide taxation; treaty offsets pension distributions per US-Korea treaty Article 18.
  | 'taiwan_amt';    // Taiwan: Income Basic Tax (AMT) applies foreign-source income above NT$1M threshold; 20% rate on Basic Income above NT$7.5M exemption.

/** Treaty interpretation for Roth conversions under foreign tax regime.
 *  REQUIRED per phase — no engine default (the ambiguity is real; vault assessment is 65/25/10 split).
 *  - 'protected': Conversions treated as treaty-protected pension recharacterization; no foreign tax.
 *  - 'half_taxed': Conversions treated as 50% taxable in host country.
 *  - 'fully_taxed': Conversions taxed at host country progressive rates as ordinary income. */
export type ConversionTreatyProtection = 'protected' | 'half_taxed' | 'fully_taxed';

/** Inputs to a foreign tax regime calculation for a single tax year. All amounts in real USD. */
export interface ForeignTaxInputs {
  /** Income earned within the host country (e.g., Korean pharma salary for the locally-employed spouse). Always fully taxable in host country. */
  hostSourceIncome: number;
  /** Income earned outside the host country (e.g., US remote work salary, US investment income).
   *  Tax treatment depends on regime — exempt under NPR/under5 if not remitted; taxed under full-resident regimes. */
  foreignSourceIncome: number;
  /** Roth conversion amount for the year (recharacterization within US accounts).
   *  Tax treatment depends on regime AND conversionTreatyProtection. */
  rothConversionAmount: number;
  /** US capital gains realized in the year (from brokerage sales). Foreign-source by location of accounts. */
  capitalGains: number;
  /** Includable portion of US Social Security (typically 85% under US-Korea/Japan treaty).
   *  Treatment varies; engine treats as pension under treaty if regime is full-resident. */
  socialSecurityIncludable: number;
  /** Total amount of foreign-source income/capital remitted to host country during the year.
   *  Drives the NPR/under5 remittance rules. */
  remittedToHostCountry: number;
  /** Required: treaty interpretation for Roth conversions during this phase. No engine default. */
  conversionTreatyProtection: ConversionTreatyProtection;
  /** For Taiwan AMT only: foreign-source income inclusion rate above NT$1M threshold.
   *  - '100pct' (default in engine if omitted with taiwan_amt regime) — conservative; matches
   *    what most authoritative tax sources describe.
   *  - '50pct' — matches vault's original Taiwan analysis; optimistic interpretation. Use for
   *    sensitivity testing only; verify with CPA before relying.
   *  Ignored for non-Taiwan regimes. */
  taiwanAmtInclusionMode?: '100pct' | '50pct';
}

/** Result of a foreign tax regime calculation. */
export interface ForeignTaxResult {
  /** Total tax owed to the host country (real USD). */
  foreignTax: number;
  /** US Foreign Tax Credit available against US federal income tax.
   *  Simplified: equal to foreignTax in most cases (overall FTC limit applies — not modeled per-category). */
  foreignTaxCredit: number;
  /** Effective rate of host country tax on the total foreign-related income (foreignSourceIncome + capitalGains + rothConversionAmount). */
  effectiveRate: number;
  /** Diagnostic notes about how the calculation was performed (for UI display and CPA verification). */
  notes: string[];
}
