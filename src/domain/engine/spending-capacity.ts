import type { AssetSnapshot } from '../types/assets';
import type { SpendingProfile } from '../types/spending';
import type { GuardrailConfig } from '../types/scenarios';

export interface SpendingCapacityResult {
  spendingCapacity: number;
  probabilityOfSuccess: number;
  surplusOrDeficit: number;
  lowerGuardrailDollarDrop: number;
  lowerGuardrailSpendingCutDollars: number;
}

// Safe withdrawal rate approach with guardrail-adjusted probability estimate.
// Uses a heuristic probability model based on withdrawal rate relative to
// historical safe withdrawal research (not Monte Carlo).
//
// annualSocialSecurityIncome: projected combined SS at claim ages (Mike + Laura).
// SS is income the portfolio doesn't need to generate — it's added directly to capacity.
export function calculateSpendingCapacity(
  assets: AssetSnapshot,
  spending: SpendingProfile,
  guardrails: GuardrailConfig,
  yearsInRetirement: number,
  annualSocialSecurityIncome: number = 0
): SpendingCapacityResult {
  const portfolio = assets.totalLiquid;

  const baseWithdrawalRate = yearsInRetirement <= 25 ? 0.045 : yearsInRetirement <= 35 ? 0.040 : 0.038;

  // Portfolio contribution + SS income = total spending capacity
  const portfolioContribution = portfolio * baseWithdrawalRate;
  const spendingCapacity = portfolioContribution + annualSocialSecurityIncome;

  // Surplus/deficit and probability are computed against ESSENTIAL spending only.
  // Travel, charitable, and mortgage are modeled year-by-year in the projection loop.
  // This matches the reference model: "can the portfolio sustain the floor?"
  const essentialSpending = spending.baseAnnualSpending;

  // Portfolio-only withdrawal rate: SS covers part of essential, reducing portfolio draw
  const portfolioWithdrawalNeeded = Math.max(0, essentialSpending - annualSocialSecurityIncome);
  const withdrawalRate = portfolio > 0 ? portfolioWithdrawalNeeded / portfolio : 0;

  // Heuristic probability: 95% at 3.5% WR, declining toward 65% at 5.5% WR
  const probabilityOfSuccess = Math.max(
    0.50,
    Math.min(0.99, 0.95 - (withdrawalRate - 0.035) * 15)
  );

  const surplusOrDeficit = spendingCapacity - essentialSpending;

  // Lower guardrail: portfolio drop that triggers a spending cut
  const lowerGuardrailDollarDrop = portfolio * guardrails.lowerGuardrailDropPct;
  // Spending cut applies to total spending (essential + lifestyle + charitable)
  const totalSpending = spending.baseAnnualSpending + spending.travelBudgetEarly + spending.charitableGivingAnnual;
  const lowerGuardrailSpendingCutDollars =
    (totalSpending * guardrails.lowerGuardrailSpendingCutPct) / 12; // monthly

  return {
    spendingCapacity,
    probabilityOfSuccess,
    surplusOrDeficit,
    lowerGuardrailDollarDrop,
    lowerGuardrailSpendingCutDollars,
  };
}
