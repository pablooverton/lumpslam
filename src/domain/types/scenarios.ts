import type { YearlyProjection } from './simulation';

export type ScenarioType = 'retire_now' | 'retire_at_stated_date' | 'no_change';

export interface GuardrailConfig {
  upperGuardrailGrowthPct: number;      // portfolio growth % that triggers spending increase
  lowerGuardrailDropPct: number;        // portfolio drop % that triggers spending cut
  lowerGuardrailSpendingCutPct: number; // how much to cut spending (e.g. 0.03 = 3%)
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
}
