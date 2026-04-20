export interface PersonProfile {
  name: string;
  age: number;
  birthYear: number;
  lifeExpectancy: number;
  fullRetirementAge: number;
  fraMonthlyBenefit: number; // estimated SS benefit at FRA, in today's dollars
  socialSecurityClaimAge: number;
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
                                        // Engine treats all inputs as today's real dollars; inflationFactor starts at 1.0
                                        // at retirement year (see roth-conversion inflation-indexing). Setting a nominal
                                        // value (e.g. 0.09) produces a unit mismatch and overstates portfolio. See README.
  retirementLocation?: 'us' | 'international'; // 'international' skips ACA season. Default: 'us'
  targetBracket?: '10%' | '12%' | '22%' | '24%' | '32%' | '35%';
  // If set, the engine fills exactly to this bracket ceiling each year via Roth conversion.
  // Conversion amount = (bracketCeiling + stdDeduction) × inflationFactor − RMD − SS_includable.
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
}
