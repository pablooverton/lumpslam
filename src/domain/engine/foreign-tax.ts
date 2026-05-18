// Foreign tax regime calculations for Coast FIRE and international retirement.
//
// Each regime is a pure function: (inputs) → result. Inputs are in real USD;
// internal calculations convert to local currency where necessary using the
// default exchange rates from constants/foreign-tax.ts.
//
// CRITICAL CAVEATS — read before relying on output:
//
// 1. This is a planning aid. Cross-border tax filings require a CPA.
// 2. Japan NPR "remittance" rule is interpreted conservatively here: any foreign-source
//    income equal to or less than the remitted amount is treated as remitted income (taxable).
//    Real-world: characterization depends on year-end balances and whether remittance
//    can be traced to capital vs. income. Tax authorities differ on this.
// 3. Korea treaty Article 18 covers pension distributions explicitly; Roth CONVERSIONS
//    are ambiguous. This engine requires the user to declare conversionTreatyProtection
//    per phase rather than picking a default.
// 4. Taiwan AMT uses CONSERVATIVE 100% inclusion of foreign-source income above NT$1M.
//    Vault's "$0 tax up to NT$16M" claim depends on 50% inclusion, which most authoritative
//    sources do not describe. Use `inclusionMode: '50pct'` to model the optimistic case
//    for sensitivity testing.
// 5. Foreign Tax Credit (FTC) calculation is simplified: foreignTaxCredit equals foreignTax
//    in most cases. Real-world FTC has per-category limitations (Form 1116 categories) and
//    overall limit based on US tax on foreign income. For planning, the simplification is
//    appropriate; for actual filings, work with a CPA.

import type {
  ForeignTaxRegime,
  ForeignTaxInputs,
  ForeignTaxResult,
  ConversionTreatyProtection,
} from '../types/foreign-tax';
import {
  type ProgressiveBracket,
  JAPAN_NATIONAL_INCOME_TAX_BRACKETS,
  JAPAN_RESIDENT_TAX_RATE,
  DEFAULT_JPY_PER_USD,
  KOREA_NATIONAL_INCOME_TAX_BRACKETS,
  KOREA_LOCAL_TAX_SURCHARGE,
  DEFAULT_KRW_PER_USD,
  TAIWAN_BASIC_INCOME_EXEMPTION_TWD,
  TAIWAN_FOREIGN_SOURCE_INCLUSION_THRESHOLD_TWD,
  TAIWAN_AMT_RATE,
  DEFAULT_TWD_PER_USD,
} from '../constants/foreign-tax';

// ─── Bracket math helper ─────────────────────────────────────────────────────

/** Apply progressive brackets to a taxable income amount.
 *  Brackets must be sorted ascending by floor; final bracket has implicit Infinity ceiling.
 *  Returns total tax for the given income. */
export function applyProgressiveBrackets(
  taxableIncome: number,
  brackets: ProgressiveBracket[]
): number {
  if (taxableIncome <= 0) return 0;
  if (brackets.length === 0) return 0;

  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const current = brackets[i];
    const next = brackets[i + 1];
    const ceiling = next ? next.floor : Infinity;

    if (taxableIncome <= current.floor) break;

    const slabAmount = Math.min(taxableIncome, ceiling) - current.floor;
    tax += slabAmount * current.rate;

    if (taxableIncome <= ceiling) break;
  }
  return tax;
}

// ─── Conversion treaty helper ────────────────────────────────────────────────

/** Apply the declared treaty interpretation to a Roth conversion amount.
 *  Returns the portion of the conversion that is taxable in the host country. */
function taxableConversionAmount(
  rothConversionAmount: number,
  protection: ConversionTreatyProtection
): number {
  switch (protection) {
    case 'protected':
      return 0;
    case 'half_taxed':
      return rothConversionAmount * 0.5;
    case 'fully_taxed':
      return rothConversionAmount;
  }
}

// ─── Regime: none (US domestic baseline) ─────────────────────────────────────

function regimeNone(_inputs: ForeignTaxInputs): ForeignTaxResult {
  return {
    foreignTax: 0,
    foreignTaxCredit: 0,
    effectiveRate: 0,
    notes: ['No foreign tax regime applies (US domestic).'],
  };
}

// ─── Regime: japan_npr ───────────────────────────────────────────────────────
//
// Japan Non-Permanent Resident (NPR) rule: an individual who is not a Japanese
// national and has had residence in Japan for not more than 5 of the preceding
// 10 years is classified as NPR. NPR taxation:
//
//   - Japan-source income: TAXED at standard Japanese rates (national + resident)
//   - Foreign-source income paid in or remitted to Japan: TAXED
//   - Foreign-source income NOT remitted to Japan: NOT TAXED
//
// Roth conversions are foreign-source (they happen within US financial institutions)
// and are NOT remitted to Japan (no money leaves US accounts — it's a recharacterization).
// Under this engine, conversions are exempt under NPR by default unless the user
// declares them as fully or half taxed via conversionTreatyProtection.
//
// Remittance treatment: the engine treats `remittedToHostCountry` as remitted income up
// to the amount of `foreignSourceIncome + capitalGains` for the year. Excess remittance
// is treated as capital transfer (not taxable). This is a simplification — real-world
// characterization depends on traceability of funds.

function regimeJapanNpr(inputs: ForeignTaxInputs): ForeignTaxResult {
  const notes: string[] = [];

  // Step 1: Japan-source income is always taxable
  const japanSourceTaxable = inputs.hostSourceIncome;

  // Step 2: Determine portion of remittance that's treated as remittance of income
  // (vs. remittance of capital). Conservative: remitted amount counts as income up to
  // the year's foreign income + capital gains pool.
  const foreignIncomePool = inputs.foreignSourceIncome + inputs.capitalGains;
  const remittedIncome = Math.min(inputs.remittedToHostCountry, foreignIncomePool);
  if (inputs.remittedToHostCountry > foreignIncomePool) {
    notes.push(
      `Remitted $${inputs.remittedToHostCountry.toLocaleString()} exceeds year's foreign income pool $${foreignIncomePool.toLocaleString()}; excess $${(inputs.remittedToHostCountry - foreignIncomePool).toLocaleString()} treated as capital transfer (not taxed).`
    );
  } else if (inputs.remittedToHostCountry > 0) {
    notes.push(
      `Remitted $${inputs.remittedToHostCountry.toLocaleString()} treated as remittance of foreign-source income (taxable in Japan).`
    );
  }

  // Step 3: Roth conversion treatment per treaty interpretation
  const conversionTaxable = taxableConversionAmount(
    inputs.rothConversionAmount,
    inputs.conversionTreatyProtection
  );
  if (inputs.rothConversionAmount > 0) {
    notes.push(
      `Roth conversion $${inputs.rothConversionAmount.toLocaleString()}: treaty interpretation '${inputs.conversionTreatyProtection}' → $${conversionTaxable.toLocaleString()} taxable in Japan. NPR alone does NOT shield conversions — the foreign-source-not-remitted rule applies separately. The conversion happens in US accounts (no Japan remittance), so without treaty taxation it would be exempt; user's explicit treaty choice overrides that default.`
    );
  }

  // Under NPR, conversions are not remitted to Japan (they happen in US accounts).
  // The treaty protection question is therefore secondary — even fully_taxed treaty
  // interpretation requires the conversion to be classified as remitted to apply.
  // To respect the user's explicit treaty choice, we add the treaty-determined amount
  // to taxable Japanese income. If the user wants pure NPR shielding regardless of
  // treaty, they should set protection='protected'.

  // Step 4: Total taxable in Japan
  const taxableInJapanUsd = japanSourceTaxable + remittedIncome + conversionTaxable;
  const taxableInJapanJpy = taxableInJapanUsd * DEFAULT_JPY_PER_USD;

  // Step 5: Apply Japanese tax brackets (national + resident)
  const nationalTaxJpy = applyProgressiveBrackets(
    taxableInJapanJpy,
    JAPAN_NATIONAL_INCOME_TAX_BRACKETS
  );
  const residentTaxJpy = taxableInJapanJpy * JAPAN_RESIDENT_TAX_RATE;
  const totalTaxJpy = nationalTaxJpy + residentTaxJpy;
  const foreignTaxUsd = totalTaxJpy / DEFAULT_JPY_PER_USD;

  // Step 6: Effective rate (over total foreign-related income, for diagnostic display)
  const totalForeignRelated =
    inputs.foreignSourceIncome + inputs.capitalGains + inputs.rothConversionAmount;
  const effectiveRate = totalForeignRelated > 0 ? foreignTaxUsd / totalForeignRelated : 0;

  notes.push(
    `Japan NPR: $${taxableInJapanUsd.toLocaleString()} taxable (national + resident) = $${Math.round(foreignTaxUsd).toLocaleString()} USD tax.`
  );

  return {
    foreignTax: foreignTaxUsd,
    foreignTaxCredit: foreignTaxUsd, // Simplified — see module header note 5
    effectiveRate,
    notes,
  };
}

// ─── Regime: japan_full ──────────────────────────────────────────────────────
//
// Japan as full tax resident (year 6+): worldwide income taxation.
// US-Japan tax treaty Article 17 covers pensions in consideration of past employment —
// generally taxable only in state of residence (i.e., Japan). The Technical Explanation
// confirms IRAs/Roth IRAs/401(k)s are treated as pension funds for treaty purposes.
//
// Roth CONVERSIONS (recharacterization events, not distributions) are ambiguous under treaty.
// This regime applies the user's declared conversionTreatyProtection per phase.
// Roth DISTRIBUTIONS for past employment are stronger treaty-protected — modeled as
// 'protected' regardless of conversionTreatyProtection (which only governs conversions).
//
// Foreign Tax Credit: Japanese tax owed creates US FTC equal to Japanese tax (simplified).

function regimeJapanFull(inputs: ForeignTaxInputs): ForeignTaxResult {
  const notes: string[] = [];

  // Worldwide taxation: all income is taxable in Japan (subject to treaty offsets)
  // SS distributions: treaty-protected (pension for past employment)
  // Conversions: per declared treaty protection
  const conversionTaxable = taxableConversionAmount(
    inputs.rothConversionAmount,
    inputs.conversionTreatyProtection
  );
  if (inputs.rothConversionAmount > 0) {
    notes.push(
      `Roth conversion $${inputs.rothConversionAmount.toLocaleString()}: treaty interpretation '${inputs.conversionTreatyProtection}' → $${conversionTaxable.toLocaleString()} taxable in Japan.`
    );
  }
  if (inputs.socialSecurityIncludable > 0) {
    notes.push(
      `Social Security $${inputs.socialSecurityIncludable.toLocaleString()}: treated as treaty-protected pension distribution; not added to Japan taxable income.`
    );
  }

  // Build taxable Japan income (USD), then convert to JPY for bracket math
  const taxableUsd =
    inputs.hostSourceIncome +
    inputs.foreignSourceIncome +
    inputs.capitalGains +
    conversionTaxable;
  const taxableJpy = taxableUsd * DEFAULT_JPY_PER_USD;

  const nationalTaxJpy = applyProgressiveBrackets(
    taxableJpy,
    JAPAN_NATIONAL_INCOME_TAX_BRACKETS
  );
  const residentTaxJpy = taxableJpy * JAPAN_RESIDENT_TAX_RATE;
  const totalTaxJpy = nationalTaxJpy + residentTaxJpy;
  const foreignTaxUsd = totalTaxJpy / DEFAULT_JPY_PER_USD;

  const totalForeignRelated =
    inputs.foreignSourceIncome + inputs.capitalGains + inputs.rothConversionAmount;
  const effectiveRate = totalForeignRelated > 0 ? foreignTaxUsd / totalForeignRelated : 0;

  notes.push(
    `Japan full resident: worldwide taxation; $${taxableUsd.toLocaleString()} taxable → $${Math.round(foreignTaxUsd).toLocaleString()} USD tax.`
  );

  return {
    foreignTax: foreignTaxUsd,
    foreignTaxCredit: foreignTaxUsd,
    effectiveRate,
    notes,
  };
}

// ─── Regime: korea_under5 ────────────────────────────────────────────────────
//
// Korea residents who have been resident for 5 or fewer of the preceding 10 years
// are taxed on foreign-source income ONLY if it is paid in or remitted to Korea.
// Korean-source income is always taxed.
//
// Unlike Japan NPR, Korea's rule is simpler — the remitted portion of foreign income
// is taxable regardless of capital/income characterization. The engine treats
// `remittedToHostCountry` as the taxable amount, capped at total foreign income for the year.

function regimeKoreaUnder5(inputs: ForeignTaxInputs): ForeignTaxResult {
  const notes: string[] = [];

  // Korean-source income is fully taxed
  const koreaSourceTaxable = inputs.hostSourceIncome;

  // Foreign-source income taxable only if remitted to Korea
  const foreignIncomePool =
    inputs.foreignSourceIncome + inputs.capitalGains;
  const remittedTaxable = Math.min(inputs.remittedToHostCountry, foreignIncomePool);
  if (inputs.remittedToHostCountry > foreignIncomePool) {
    notes.push(
      `Remitted $${inputs.remittedToHostCountry.toLocaleString()} exceeds foreign income pool $${foreignIncomePool.toLocaleString()}; excess treated as capital transfer (not taxed).`
    );
  } else if (inputs.remittedToHostCountry > 0) {
    notes.push(
      `Remitted $${inputs.remittedToHostCountry.toLocaleString()} foreign-source income taxable in Korea (under-5-year rule).`
    );
  }

  // Roth conversions: under 5 years, the conversion is foreign-source (US account); not
  // remitted to Korea unless user explicitly says so. Treaty interpretation still applies
  // when conversions are characterized as Korean-taxable per user assumption.
  const conversionTaxable = taxableConversionAmount(
    inputs.rothConversionAmount,
    inputs.conversionTreatyProtection
  );
  if (inputs.rothConversionAmount > 0) {
    notes.push(
      `Roth conversion $${inputs.rothConversionAmount.toLocaleString()}: treaty interpretation '${inputs.conversionTreatyProtection}' → $${conversionTaxable.toLocaleString()} taxable in Korea (under-5-year rule does not separately shield conversions when treaty protection is non-protected).`
    );
  }

  const taxableUsd = koreaSourceTaxable + remittedTaxable + conversionTaxable;
  const taxableKrw = taxableUsd * DEFAULT_KRW_PER_USD;

  const nationalTaxKrw = applyProgressiveBrackets(
    taxableKrw,
    KOREA_NATIONAL_INCOME_TAX_BRACKETS
  );
  const localTaxKrw = nationalTaxKrw * KOREA_LOCAL_TAX_SURCHARGE;
  const totalTaxKrw = nationalTaxKrw + localTaxKrw;
  const foreignTaxUsd = totalTaxKrw / DEFAULT_KRW_PER_USD;

  const totalForeignRelated =
    inputs.foreignSourceIncome + inputs.capitalGains + inputs.rothConversionAmount;
  const effectiveRate = totalForeignRelated > 0 ? foreignTaxUsd / totalForeignRelated : 0;

  notes.push(
    `Korea under-5-year: $${taxableUsd.toLocaleString()} taxable → $${Math.round(foreignTaxUsd).toLocaleString()} USD tax (national + 10% local surcharge).`
  );

  return {
    foreignTax: foreignTaxUsd,
    foreignTaxCredit: foreignTaxUsd,
    effectiveRate,
    notes,
  };
}

// ─── Regime: korea_over5 ─────────────────────────────────────────────────────
//
// Korea residents who have been resident 5+ of the preceding 10 years are taxed
// on worldwide income. The US-Korea tax treaty Article 18 (and updated Art. 23 para 3)
// provides exclusive residence-state taxation for pension distributions for past employment.
// IRS has clarified IRAs/Roth IRAs are treated as pensions for treaty purposes.
//
// Roth CONVERSIONS are ambiguous — engine applies user's declared conversionTreatyProtection.
// Roth DISTRIBUTIONS are treaty-protected (treated as protected regardless of declaration).
// US Social Security is treated as treaty-protected pension (only 85% taxable in resident state).

function regimeKoreaOver5(inputs: ForeignTaxInputs): ForeignTaxResult {
  const notes: string[] = [];

  // Worldwide taxation: all income on the table, modulo treaty offsets
  const conversionTaxable = taxableConversionAmount(
    inputs.rothConversionAmount,
    inputs.conversionTreatyProtection
  );
  if (inputs.rothConversionAmount > 0) {
    notes.push(
      `Roth conversion $${inputs.rothConversionAmount.toLocaleString()}: treaty interpretation '${inputs.conversionTreatyProtection}' → $${conversionTaxable.toLocaleString()} taxable in Korea.`
    );
  }
  if (inputs.socialSecurityIncludable > 0) {
    notes.push(
      `Social Security $${inputs.socialSecurityIncludable.toLocaleString()}: treated as treaty-protected pension distribution; not added to Korea taxable income.`
    );
  }

  const taxableUsd =
    inputs.hostSourceIncome +
    inputs.foreignSourceIncome +
    inputs.capitalGains +
    conversionTaxable;
  const taxableKrw = taxableUsd * DEFAULT_KRW_PER_USD;

  const nationalTaxKrw = applyProgressiveBrackets(
    taxableKrw,
    KOREA_NATIONAL_INCOME_TAX_BRACKETS
  );
  const localTaxKrw = nationalTaxKrw * KOREA_LOCAL_TAX_SURCHARGE;
  const totalTaxKrw = nationalTaxKrw + localTaxKrw;
  const foreignTaxUsd = totalTaxKrw / DEFAULT_KRW_PER_USD;

  const totalForeignRelated =
    inputs.foreignSourceIncome + inputs.capitalGains + inputs.rothConversionAmount;
  const effectiveRate = totalForeignRelated > 0 ? foreignTaxUsd / totalForeignRelated : 0;

  notes.push(
    `Korea full resident (5+ years): worldwide taxation; $${taxableUsd.toLocaleString()} taxable → $${Math.round(foreignTaxUsd).toLocaleString()} USD tax (national + 10% local surcharge).`
  );

  return {
    foreignTax: foreignTaxUsd,
    foreignTaxCredit: foreignTaxUsd,
    effectiveRate,
    notes,
  };
}

// ─── Regime: taiwan_amt ──────────────────────────────────────────────────────
//
// Taiwan's Income Basic Tax Act (所得基本稅額條例) applies an Alternative Minimum Tax
// to residents whose Basic Income exceeds NT$7.5M (2026 exemption). The mechanism:
//
//   1. Foreign-source income BELOW NT$1M: fully exempt; not entered into Basic Income.
//   2. Foreign-source income AT or ABOVE NT$1M: included in Basic Income.
//      - INCLUSION MODE '100pct' (default, conservative): full amount included.
//      - INCLUSION MODE '50pct' (optional, optimistic): only 50% of the amount above NT$1M
//        is included. This matches the vault's original Taiwan analysis but most
//        authoritative tax sources do NOT describe this rule. Treat as sensitivity case only.
//   3. Basic Tax = max(0, Basic Income - NT$7.5M) × 20%.
//   4. Final foreign tax = max(regular Taiwan income tax, Basic Tax).
//      For retirees with no Taiwan-source income, regular tax = 0; only AMT matters.
//
// CRITICAL: Taiwan does not have a US tax treaty as of 2026 (H.R. 7180 was introduced
// but not enacted). Without treaty, there is no formal Roth conversion protection — the
// engine still respects the user's conversionTreatyProtection assumption since some
// practitioners argue characterization-based exclusion regardless of treaty.

function regimeTaiwanAmt(inputs: ForeignTaxInputs): ForeignTaxResult {
  const notes: string[] = [];
  const inclusionMode = inputs.taiwanAmtInclusionMode ?? '100pct';

  // Step 1: Determine foreign-source income subject to AMT consideration
  // (foreign source for Taiwan = US remote work + capital gains + conversions)
  const foreignSourceTotalUsd =
    inputs.foreignSourceIncome + inputs.capitalGains;
  const conversionTaxable = taxableConversionAmount(
    inputs.rothConversionAmount,
    inputs.conversionTreatyProtection
  );
  if (inputs.rothConversionAmount > 0) {
    notes.push(
      `Roth conversion $${inputs.rothConversionAmount.toLocaleString()}: treaty interpretation '${inputs.conversionTreatyProtection}' → $${conversionTaxable.toLocaleString()} treated as taxable foreign-source income for Taiwan AMT.`
    );
  }
  const foreignSourceWithConversionUsd = foreignSourceTotalUsd + conversionTaxable;
  const foreignSourceTwd = foreignSourceWithConversionUsd * DEFAULT_TWD_PER_USD;

  // Step 2: Apply NT$1M threshold rule
  let includedInBasicIncomeTwd = 0;
  if (foreignSourceTwd <= TAIWAN_FOREIGN_SOURCE_INCLUSION_THRESHOLD_TWD) {
    notes.push(
      `Foreign-source income NT$${Math.round(foreignSourceTwd).toLocaleString()} ≤ NT$1M threshold → fully exempt from Basic Income.`
    );
  } else {
    if (inclusionMode === '100pct') {
      includedInBasicIncomeTwd = foreignSourceTwd;
      notes.push(
        `Conservative 100% inclusion: NT$${Math.round(foreignSourceTwd).toLocaleString()} foreign income added to Basic Income.`
      );
    } else {
      // 50% inclusion of the amount ABOVE NT$1M threshold
      const aboveThreshold = foreignSourceTwd - TAIWAN_FOREIGN_SOURCE_INCLUSION_THRESHOLD_TWD;
      includedInBasicIncomeTwd = aboveThreshold * 0.5;
      notes.push(
        `Optimistic 50% inclusion (above NT$1M threshold): NT$${Math.round(includedInBasicIncomeTwd).toLocaleString()} added to Basic Income. NOTE: Most authoritative sources describe 100% inclusion; verify with CPA before relying.`
      );
    }
  }

  // Step 3: Add Taiwan-source income (always fully in Basic Income calculation)
  const taiwanSourceTwd = inputs.hostSourceIncome * DEFAULT_TWD_PER_USD;
  const basicIncomeTwd = includedInBasicIncomeTwd + taiwanSourceTwd;

  // Step 4: Apply AMT formula
  const amtBaseTwd = Math.max(0, basicIncomeTwd - TAIWAN_BASIC_INCOME_EXEMPTION_TWD);
  const amtTwd = amtBaseTwd * TAIWAN_AMT_RATE;
  const foreignTaxUsd = amtTwd / DEFAULT_TWD_PER_USD;

  // Diagnostic
  notes.push(
    `Basic Income NT$${Math.round(basicIncomeTwd).toLocaleString()} − exemption NT$${TAIWAN_BASIC_INCOME_EXEMPTION_TWD.toLocaleString()} = NT$${Math.round(amtBaseTwd).toLocaleString()} above threshold × 20% = NT$${Math.round(amtTwd).toLocaleString()} ≈ $${Math.round(foreignTaxUsd).toLocaleString()} USD.`
  );
  if (foreignTaxUsd === 0) {
    notes.push(
      `Result: $0 Taiwan AMT. Basic Income is within the NT$${TAIWAN_BASIC_INCOME_EXEMPTION_TWD.toLocaleString()} exemption.`
    );
  }

  const totalForeignRelated =
    inputs.foreignSourceIncome + inputs.capitalGains + inputs.rothConversionAmount;
  const effectiveRate = totalForeignRelated > 0 ? foreignTaxUsd / totalForeignRelated : 0;

  return {
    foreignTax: foreignTaxUsd,
    foreignTaxCredit: foreignTaxUsd,
    effectiveRate,
    notes,
  };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

/** Compute foreign tax for a year given the regime and inputs.
 *  Pure function; safe to call repeatedly during Monte Carlo. */
export function calculateForeignTax(
  regime: ForeignTaxRegime,
  inputs: ForeignTaxInputs
): ForeignTaxResult {
  switch (regime) {
    case 'none':
      return regimeNone(inputs);
    case 'japan_npr':
      return regimeJapanNpr(inputs);
    case 'japan_full':
      return regimeJapanFull(inputs);
    case 'korea_under5':
      return regimeKoreaUnder5(inputs);
    case 'korea_over5':
      return regimeKoreaOver5(inputs);
    case 'taiwan_amt':
      return regimeTaiwanAmt(inputs);
  }
}
