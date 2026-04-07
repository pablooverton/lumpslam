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
  spendingCapacity: number;
  desiredSpending: number;
  surplusOrDeficit: number;
  probabilityOfSuccess: number; // 0–1
  lowerGuardrailDollarDrop: number;   // absolute dollar drop that triggers lower guardrail
  lowerGuardrailSpendingCutDollars: number; // monthly dollar cut at lower guardrail
  yearlyProjections: YearlyProjection[];
}
