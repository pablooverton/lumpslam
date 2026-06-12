import type { YearlyProjection } from './simulation';

export type ScenarioType = 'retire_now' | 'retire_at_stated_date' | 'no_change';

export interface GuardrailConfig {
  upperGuardrailGrowthPct: number;      // portfolio growth % that triggers spending increase
  lowerGuardrailDropPct: number;        // portfolio drop % from peak that triggers spending cut
  lowerGuardrailSpendingCutPct: number; // how much to cut spending at first tier (e.g. 0.10 = 10%)
  /** If set, deep drawdowns trigger a second-tier cut. Default: 2× lowerGuardrailDropPct.
   *  e.g. 0.20 first-tier + 0.40 deep-tier = 10% cut at 20% drop, 20% cut at 40% drop. */
  deepDropPct?: number;
  /** Spending cut at deep tier. Default: 2× lowerGuardrailSpendingCutPct, capped at 0.30 (30%). */
  deepCutPct?: number;
  /** Drawdown below this threshold restores baseline spending (un-cut). Default: 0.10 (10%).
   *  Prevents oscillation. Must be < lowerGuardrailDropPct. */
  recoveryThresholdPct?: number;
}

export interface ScenarioResult {
  scenarioType: ScenarioType;
  retirementYear: number;
  spendingCapacity: number;      // long-run capacity: portfolio SWR + SS income
  preSsCapacity: number;         // portfolio SWR only (before SS starts) — use this for early-retirement scenarios
  desiredSpending: number;
  surplusOrDeficit: number;
  probabilityOfSuccess: number;  // 0–1; adjusted downward if portfolio depletes before SS starts
  lowerGuardrailDollarDrop: number;   // absolute dollar drop that triggers lower guardrail
  lowerGuardrailSpendingCutDollars: number; // monthly dollar cut at lower guardrail
  yearlyProjections: YearlyProjection[];
  /** Lifetime aggregates used by the strategy-comparison harness.
   *  All amounts in current-year (profile.currentYear) real dollars. */
  lifetime: LifetimeAggregates;
  /** Non-blocking configuration warnings: the run completed, but part of the modeling intent
   *  was silently unrepresentable (one-time flows inside coast windows, discarded savings
   *  cash flow). Surface these to the user. */
  warnings?: string[];
}

export interface LifetimeAggregates {
  /** Sum of federal tax across all years (working + retirement), real dollars. Includes working-year conversion tax. */
  federalTaxPaid: number;
  /** Sum of state tax across all years, real dollars. */
  stateTaxPaid: number;
  /** Sum of 10% early-withdrawal penalties (pre-59½), real dollars. Kept separate from
   *  federalTaxPaid so bracket-math identities stay verifiable. */
  earlyWithdrawalPenaltiesPaid: number;
  /** Total federal + state tax + early-withdrawal penalties, real dollars. */
  totalTaxPaid: number;
  /** Total conversion tax paid during working years (outside-cash sourcing), real dollars. */
  workingYearConversionTaxPaid: number;
  /** Terminal balance per bucket at end of projection, real dollars. */
  terminal: {
    pretax: number;
    roth: number;
    brokerage: number;
    hsa: number;
    total: number;
  };
  /** First year pre-tax balance hits zero (or near-zero ≤ $1000). null if never depleted. */
  pretaxDepletionYear: number | null;
  /** Sum of annualSpending across ages 55–65 (pre-Medicare window), real dollars.
   *  The "enjoyment-maximizing" metric. */
  earlyRetirementSpending: number;
  /** Strategy-resolver totals, if a SavingsStrategy was used. null when using flat annualContributions. */
  strategyTotals: StrategyTotalsSummary | null;
}

export interface StrategyTotalsSummary {
  totalPretaxContributions: number;
  totalRothContributions: number;
  totalHsaContributions: number;
  totalBrokerageContributions: number;
  totalWorkingYearConversions: number;
  totalEmployerMatch: number;
  totalFreeCashFlowConsumed: number;
  totalFreeCashFlowRemaining: number;
}
