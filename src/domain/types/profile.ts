import type { ForeignTaxRegime, ConversionTreatyProtection } from './foreign-tax';

export interface PersonProfile {
  name: string;
  age: number;
  birthYear: number;
  lifeExpectancy: number;
  fullRetirementAge: number;
  fraMonthlyBenefit: number; // estimated SS benefit at FRA, in today's dollars
  socialSecurityClaimAge: number;
}

// ─── CoastPhase ──────────────────────────────────────────────────────────────
//
// A multi-year Coast FIRE phase between accumulation and full retirement, where
// the household lives abroad and earns reduced income. Multiple phases may be
// chained (e.g., Taiwan 3 years → Korea 2 years → retire). Phases must be
// chronologically ordered, non-overlapping, and contiguous; the first phase
// must start at or after currentYear+1 and the last must end before
// retirementYearDesired.
//
// During Coast: portfolio does not receive contributions, but compounds normally.
// Coast income offsets living expenses; any deficit draws from brokerage/Roth.
// Roth conversions during Coast are optional and contribute to MAGI.
// Foreign tax is computed per phase via the foreign-tax engine.

export interface CoastPhase {
  /** First year of this phase (inclusive). */
  startYear: number;
  /** Last year of this phase (inclusive). */
  endYear: number;
  /** Residence during this phase. 'us' = domestic semi-retirement coast (stay in the US, reduced
   *  income, on the ACA marketplace, US state tax); foreign values drive the foreign-tax regime. */
  location: 'japan' | 'korea' | 'taiwan' | 'us';
  /** Foreign tax regime during this phase. Must align semantically with location
   *  (e.g., 'japan_npr' or 'japan_full' for location='japan'). Omit for location='us'. */
  taxRegime?: ForeignTaxRegime;
  /** Combined household annual income during this phase (real USD). */
  annualIncome: number;
  /** Fraction of annualIncome that is US-source (US remote work paid to US accounts).
   *  Range [0, 1]. E.g., 0.6 = 60% primary earner US remote, 40% spouse local pharma.
   *  Ignored for location='us' (all income is US-source by definition). */
  usSourceIncomePct: number;
  /** US coast only: people on the ACA plan this phase (drives the subsidy cliff by household size).
   *  Falls back to profile.acaHouseholdSize, then 2. */
  acaHouseholdSize?: number;
  /** Annual Roth conversion during this phase (real USD). Optional; default 0. */
  annualConversion?: number;
  /** Annual remittance from US accounts to host country (for living expenses funded from
   *  taxable brokerage rather than coast income). Drives 'remitted to host' rules. Default 0. */
  annualRemittanceToHost?: number;
  /** Treaty interpretation for Roth conversions during this phase. REQUIRED for foreign phases
   *  (engine has no default — declare an explicit assumption). Omit for location='us'. */
  conversionTreatyProtection?: ConversionTreatyProtection;
  /** For Taiwan AMT regime only: inclusion rate above NT$1M threshold.
   *  - '100pct' (default in engine): conservative; matches most authoritative sources
   *  - '50pct': optimistic; matches vault's original Taiwan analysis. Sensitivity-test only.
   *  Ignored for non-Taiwan regimes. */
  taiwanAmtInclusionMode?: '100pct' | '50pct';
  /** If true, any Coast surplus (income - tax - expenses) flows to taxable brokerage
   *  with 100% cost basis. Default false (surplus treated as cash; not modeled).
   *  Recommended true for realistic Coast scenarios where the household saves the surplus.
   *  Affects portfolio compounding and retirement-phase starting balance. */
  routeSurplusToBrokerage?: boolean;
}

/** Result of validating a CoastPhase[] against profile constraints. */
export interface CoastPhasesValidationResult {
  valid: boolean;
  errors: string[];
  /** Non-blocking: configuration the engine runs but partially ignores (e.g. one-time flows
   *  dated inside a coast window). Surface to the user; don't fail the run. */
  warnings: string[];
}

/** Validate that an array of CoastPhase is well-formed and consistent with the profile.
 *  Returns a result with errors; caller decides whether to throw or surface to UI. */
export function validateCoastPhases(
  phases: CoastPhase[] | undefined,
  currentYear: number,
  retirementYearDesired: number | null,
  /** Optional: the profile's one-time flows. The coast engine reads no one-time flows, so a
   *  flow dated inside a coast window silently disappears from the simulation — warned here. */
  oneTimeFlows?: {
    incomes?: Array<{ year: number; label?: string; amount: number }>;
    expenses?: Array<{ year: number; label?: string; amount: number }>;
  }
): CoastPhasesValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!phases || phases.length === 0) {
    return { valid: true, errors: [], warnings: [] };
  }
  if (retirementYearDesired == null) {
    errors.push('coastPhases requires retirementYearDesired to be set on the profile.');
    return { valid: false, errors, warnings };
  }

  // Per-phase validation
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    if (p.startYear > p.endYear) {
      errors.push(`Phase ${i}: startYear (${p.startYear}) > endYear (${p.endYear}).`);
    }
    if (p.startYear <= currentYear) {
      errors.push(`Phase ${i}: startYear (${p.startYear}) must be after currentYear (${currentYear}).`);
    }
    if (p.endYear >= retirementYearDesired) {
      errors.push(`Phase ${i}: endYear (${p.endYear}) must be before retirementYearDesired (${retirementYearDesired}).`);
    }
    if (p.usSourceIncomePct < 0 || p.usSourceIncomePct > 1) {
      errors.push(`Phase ${i}: usSourceIncomePct (${p.usSourceIncomePct}) must be in [0, 1].`);
    }
    if (p.annualIncome < 0) {
      errors.push(`Phase ${i}: annualIncome (${p.annualIncome}) must be non-negative.`);
    }
    if (p.annualConversion != null && p.annualConversion < 0) {
      errors.push(`Phase ${i}: annualConversion must be non-negative.`);
    }
    if (p.annualRemittanceToHost != null && p.annualRemittanceToHost < 0) {
      errors.push(`Phase ${i}: annualRemittanceToHost must be non-negative.`);
    }
    // US coast: foreign tax fields are unused; nothing further to validate here.
    // Foreign coast: taxRegime + treaty interpretation are required, and the regime must
    // align with the location.
    if (p.location !== 'us') {
      if (p.taxRegime == null) {
        errors.push(`Phase ${i}: foreign location='${p.location}' requires taxRegime.`);
      }
      if (p.conversionTreatyProtection == null) {
        errors.push(`Phase ${i}: foreign location='${p.location}' requires conversionTreatyProtection.`);
      }
      if (p.location === 'japan' && p.taxRegime !== 'japan_npr' && p.taxRegime !== 'japan_full') {
        errors.push(`Phase ${i}: location='japan' but taxRegime='${p.taxRegime}' (expected japan_npr or japan_full).`);
      }
      if (p.location === 'korea' && p.taxRegime !== 'korea_under5' && p.taxRegime !== 'korea_over5') {
        errors.push(`Phase ${i}: location='korea' but taxRegime='${p.taxRegime}' (expected korea_under5 or korea_over5).`);
      }
      if (p.location === 'taiwan' && p.taxRegime !== 'taiwan_amt') {
        errors.push(`Phase ${i}: location='taiwan' but taxRegime='${p.taxRegime}' (expected taiwan_amt).`);
      }
    }
  }

  // Cross-phase ordering and contiguity
  for (let i = 1; i < phases.length; i++) {
    const prev = phases[i - 1];
    const curr = phases[i];
    if (curr.startYear <= prev.endYear) {
      errors.push(`Phases ${i - 1} and ${i} overlap: phase ${i - 1} ends ${prev.endYear}, phase ${i} starts ${curr.startYear}.`);
    }
    if (curr.startYear !== prev.endYear + 1) {
      errors.push(`Phases ${i - 1} and ${i} are not contiguous: phase ${i - 1} ends ${prev.endYear}, phase ${i} starts ${curr.startYear}. Engine requires contiguous phases.`);
    }
  }

  // One-time flows are read only by the retirement loop. A flow year inside a coast window
  // disappears from the simulation entirely (e.g. a house sale during the coast) — warn.
  const inCoast = (year: number) =>
    phases.some((p) => year >= p.startYear && year <= p.endYear);
  for (const f of oneTimeFlows?.incomes ?? []) {
    if (inCoast(f.year)) {
      warnings.push(
        `One-time income${f.label ? ` "${f.label}"` : ''} ($${f.amount.toLocaleString()}, ${f.year}) falls inside a coast phase and is IGNORED by the coast engine — move it outside the coast window or fold it into phase income.`
      );
    }
  }
  for (const f of oneTimeFlows?.expenses ?? []) {
    if (inCoast(f.year)) {
      warnings.push(
        `One-time expense${f.label ? ` "${f.label}"` : ''} ($${f.amount.toLocaleString()}, ${f.year}) falls inside a coast phase and is IGNORED by the coast engine — move it outside the coast window or fold it into baseAnnualSpending for those years.`
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export interface AnnualContributions {
  pretax: number;    // 401k / traditional IRA contributions per year (combined household)
  roth: number;      // Roth IRA (including backdoor Roth) per year (combined household)
  brokerage: number; // taxable brokerage savings per year
  hsa?: number;      // HSA contributions per year (combined household). Default: 0
}

// ─── SavingsStrategy — rule-based allocation of free cash flow ───────────────
//
// Alternative to AnnualContributions. Instead of asking the user to specify
// dollar amounts per bucket per year (error-prone, biases comparisons), the
// engine takes a pool of post-tax free cash flow and a priority-ordered list
// of allocation rules, and resolves per-year contributions deterministically.
//
// Critical design point: pre-tax contributions are *grossed up* from post-tax
// free cash flow. Routing $1 of post-tax cash to a pre-tax 401k (by raising
// the contribution %) produces $1/(1 − marginalTaxRateFedState) of actual
// contribution, because the pre-tax contribution reduces taxable wages and
// the tax saved is redirected into the same contribution. This is what makes
// "same free cash flow, different allocation" an apples-to-apples comparison.

export type AllocationRuleKind =
  | 'employer_match'       // employer 401k match — scales with pretax bucket
  | 'hsa'                  // HSA contribution (triple-advantaged); limit = federal max
  | 'backdoor_roth'        // backdoor Roth IRA ($7k × 2 = $14k combined MFJ)
  | 'roth_401k'            // Roth 401k elective deferral (up to $23,500 each)
  | 'mega_backdoor'        // after-tax 401k + in-plan Roth conversion
  | 'pretax_401k'          // pre-tax 401k elective deferral (grossed up)
  | 'brokerage'            // taxable brokerage — catch-all
  | 'working_year_conversion'; // convert pre-tax → Roth during working years; tax paid from outside cash

export interface AllocationRule {
  kind: AllocationRuleKind;
  /** Annual contribution/conversion cap in post-tax dollars. Omit for "no cap — take what remains". */
  limit?: number;
  /** First year this rule becomes active (e.g., mega backdoor activation in 2027). Defaults to always-active. */
  activateYear?: number;
  /** Last year this rule is active. Defaults to always-active. */
  deactivateYear?: number;
  /** For employer_match: match rate (e.g. 0.095 for 9.5%). Applied to pretax bucket contribution. */
  matchRate?: number;
  /** For working_year_conversion: target bracket ceiling for the conversion (e.g. '24%'). */
  conversionTargetBracket?: '10%' | '12%' | '22%' | '24%' | '32%' | '35%';
}

export interface SavingsStrategy {
  /** Strategy label for reporting. */
  name: string;
  /** Total post-tax free cash flow available for allocation, in current-year real dollars. */
  annualFreeCashFlow: number;
  /** Real annual growth rate of free cash flow (default 0). E.g. 0.01 for 1% real wage growth. */
  freeCashFlowGrowth?: number;
  /** Combined federal + state marginal tax rate, used to gross up pre-tax contributions. E.g. 0.2925 for 24% + 5.25% NC. */
  marginalTaxRateFedState: number;
  /** Priority-ordered list of allocation rules. Cash flows to rule[0] first until its limit, then rule[1], etc. */
  rules: AllocationRule[];
}

// ─── End SavingsStrategy ─────────────────────────────────────────────────────

export interface ClientProfile {
  client: PersonProfile;
  spouse: PersonProfile | null;
  filingStatus: 'married_filing_jointly' | 'single';
  stateOfResidence: string;
  hasStateIncomeTax: boolean;
  currentYear: number;
  retirementYearDesired: number | null; // null = retire now
  cobraMonths: number;                  // 0 = skip COBRA, go straight to ACA/bridge
  acaHouseholdSize?: number;            // people on ACA plan; determines subsidy cliff. Default: 2
  annualGrowthRate?: number;            // REAL portfolio growth rate. Default: 0.06 (~6% real — Boglehead 60/40 baseline).
                                        // The engine simulates entirely in current-year real dollars: inputs (contributions,
                                        // spending, conversion targets) are real, growth is real, and tax brackets are
                                        // real-sticky (IRS-indexed). Do NOT enter a nominal value (e.g. 0.09); it will
                                        // overstate the portfolio's real purchasing power. See FINANCIAL-PRINCIPLES.md §17.
  retirementLocation?: 'us' | 'international'; // 'international' skips ACA season. Default: 'us'
  /** Pre-59½ pretax-withdrawal penalty treatment (Roth ordering rules always apply):
   *  - 'none' (default): 10% penalty on pretax draws while the OLDER spouse is under 59½
   *  - '72t': SEPP elected — pretax draws penalty-free at any age (engine does not enforce
   *    the fixed-payment schedule; planning approximation)
   *  - 'rule_of_55': penalty-free from 55 (separation-year rule; requires the plan to allow
   *    partial post-separation withdrawals — verify with HR), 10% before 55. */
  pre59PenaltyExemption?: 'none' | '72t' | 'rule_of_55';
  /** Optional haircut (0–1) applied multiplicatively to ALL household SS benefits, e.g. 0.20
   *  = benefits paid at 80%. Two uses: (1) political risk — OASI trust-fund depletion (early
   *  2030s under current law) implies ~17–23% across-the-board cuts absent legislation;
   *  (2) PIA overstatement — an SSA-statement fraMonthlyBenefit assumes earnings continue to
   *  claim age, which overstates the benefit for early retirees (the 35-year average fills
   *  with zeros). Prefer entering an honest $0-future-earnings PIA and reserving this field
   *  for political risk. Applied in the projection loop, the capacity heuristic, the claiming
   *  comparison, and the widow analysis. Default 0. See FINANCIAL-PRINCIPLES §14. */
  ssBenefitHaircutPct?: number;
  // Healthcare coverage strategy for the pre-Medicare bridge. 'standard' = COBRA → ACA → Medicare.
  // 'self_insure' = no traditional insurance pre-65 (e.g. CrowdHealth-style health-share, medical
  // tourism, true self-pay). Engine skips ACA cliff/IRMAA gymnastics for the pre-65 window and
  // adds spending.selfInsuranceAnnualBudget (real dollars, inflates yearly) to spending. Medicare
  // still kicks in at 65 unless the user explicitly opts out (not currently modeled — opting out
  // of Medicare carries lifetime late-enrollment penalties that dominate the savings).
  healthcareCoverage?: 'standard' | 'self_insure'; // default: 'standard'
  targetBracket?: '10%' | '12%' | '22%' | '24%' | '32%' | '35%';
  // If set, the engine fills exactly to this bracket ceiling each year via Roth conversion.
  // Conversion amount = (bracketCeiling + stdDeduction) − RMD − SS_includable (all real).
  // Automatically selects conversion_primary engine and adjusts for SS phase-in and RMDs.
  // Not set = surplus-driven conversions (withdrawal_sequencing archetype, e.g. Mike & Laura).
  spendingEngine?: 'withdrawal_sequencing' | 'conversion_primary' | 'auto';
  // withdrawal_sequencing (default): draw from accounts to cover spending, convert surplus to Roth.
  //   Best for: brokerage-backed strategies, ACA cliff optimization (Mike & Laura archetype).
  // conversion_primary: fill targetBracket from pretax each year; all spending from Roth.
  //   MAGI = conversion only (not spending draws). Best for: no-brokerage, high pre-tax balance.
  // auto: picks conversion_primary when targetBracket is set; otherwise withdrawal_sequencing.
  annualContributions?: AnnualContributions; // annual savings added each year during accumulation phase
  // Alternative to annualContributions. If both are supplied, savingsStrategy takes precedence.
  // Rule-based allocation of free cash flow; the engine resolves this into per-year
  // contributions with proper gross-up for pre-tax buckets. See SavingsStrategy above.
  savingsStrategy?: SavingsStrategy;
  /**
   * Optional Coast FIRE phases between accumulation and full retirement.
   * Multiple phases supported for multi-country sequences (e.g., Taiwan → Korea).
   * Validation rules enforced by validateCoastPhases():
   *   - Each phase: startYear after currentYear, endYear before retirementYearDesired
   *   - Phases ordered chronologically
   *   - Phases contiguous (no gaps)
   *   - Tax regime aligns with location
   * If omitted, engine behaves identically to pre-Coast-FIRE implementation.
   */
  coastPhases?: CoastPhase[];
}
