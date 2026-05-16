import type { AssetSnapshot } from '../types/assets';
import type { SpendingProfile } from '../types/spending';
import type { GuardrailConfig } from '../types/scenarios';

export interface SpendingCapacityResult {
  spendingCapacity: number;      // portfolio SWR + SS income (long-run)
  preSsCapacity: number;         // portfolio SWR only (no SS) — accurate for pre-SS years
  probabilityOfSuccess: number;  // baseline estimate; runner adjusts for pre-SS depletion
  surplusOrDeficit: number;
  lowerGuardrailDollarDrop: number;
  lowerGuardrailSpendingCutDollars: number;
  /** Stress WR used in probability calc — the WORSE of bridge-period vs post-SS draw rates.
   *  Exposed for diagnostic display. */
  stressWithdrawalRate: number;
  /** Bridge WR: rate during pre-SS years including mortgage + conversion taxes. */
  bridgeWithdrawalRate: number;
  /** Long-run WR: rate after SS arrives and (typically) mortgage is paid off. */
  longRunWithdrawalRate: number;
}

export interface CapacityContext {
  /** Pre-SS years where the portfolio absorbs all spending. 0 if SS already started. */
  bridgeYears: number;
  /** Real mortgage payment at retirement year start (real, deflated). 0 if no mortgage. */
  realMortgageAtRetirement: number;
  /** Estimated annual conversion tax during bridge years. 0 if no conversion engine. */
  estimatedAnnualConversionTax: number;
}

// Safe withdrawal rate heuristic — calibrated to approximate Monte Carlo success at the
// SAME spending policy (fixed essential spending, no dynamic adjustment unless guardrails
// are active in the simulator).
//
// CRITICAL FIX (2026-05-15 round 2): prior version computed only the long-run, SS-smoothed
// withdrawal rate. For early retirees with long pre-SS bridges and large fixed costs
// (mortgage, conversion taxes), this systematically overstated probability — heuristic
// returned 99% while Monte Carlo showed 60–70% for NC@50. New formula:
//
//   bridgeWR    = (essential + mortgage + estConversionTax) / portfolio
//   longRunWR   = max(0, essential − SS) / portfolio
//   stressWR    = max(bridgeWR, longRunWR)
//   probability = mapWRtoProb(stressWR, bridgeYears)
//
// During the bridge, the portfolio must cover the full draw at no-SS rates. Sequence-of-returns
// research (Bengen, Trinity, Big ERN) finds historical survival rates that decay non-linearly
// with WR. The linear mapping below is calibrated to roughly match MC results across the
// NC sweep (50→59) and K-Floor — exact MC remains the source of truth; this is a fast check.
export function calculateSpendingCapacity(
  assets: AssetSnapshot,
  spending: SpendingProfile,
  guardrails: GuardrailConfig,
  yearsInRetirement: number,
  annualSocialSecurityIncome: number = 0,
  context: CapacityContext = { bridgeYears: 0, realMortgageAtRetirement: 0, estimatedAnnualConversionTax: 0 }
): SpendingCapacityResult {
  const portfolio = assets.totalLiquid;

  const baseWithdrawalRate = yearsInRetirement <= 25 ? 0.045 : yearsInRetirement <= 35 ? 0.040 : 0.038;

  // Portfolio contribution + SS income = total spending capacity
  const portfolioContribution = portfolio * baseWithdrawalRate;
  const spendingCapacity = portfolioContribution + annualSocialSecurityIncome;

  const essentialSpending = spending.baseAnnualSpending;

  // ─── Two withdrawal rates ──────────────────────────────────────────────────
  // Bridge WR: pre-SS period. Portfolio absorbs full essential + mortgage + conversion tax.
  // This is the harder period — sequence-of-returns risk hits here.
  const bridgeAnnualDraw =
    essentialSpending + context.realMortgageAtRetirement + context.estimatedAnnualConversionTax;
  const bridgeWithdrawalRate = portfolio > 0 ? bridgeAnnualDraw / portfolio : 0;

  // Long-run WR: post-SS, typically post-mortgage. SS offsets essential; conversion may or may not
  // still be active. This is the easier period.
  const longRunAnnualDraw = Math.max(0, essentialSpending - annualSocialSecurityIncome);
  const longRunWithdrawalRate = portfolio > 0 ? longRunAnnualDraw / portfolio : 0;

  // Stress WR: the worse of the two. This drives the probability mapping. For retirees with no
  // pre-SS bridge (bridgeYears = 0), bridge and long-run converge; for early retirees the bridge
  // dominates. Bridge length affects sequence risk but is not modeled in this linear approx —
  // see Monte Carlo for accurate probability.
  const stressWithdrawalRate = Math.max(bridgeWithdrawalRate, longRunWithdrawalRate);

  // Heuristic probability mapping — Trinity-Study-aligned, calibrated against MC sweep
  // results from May 2026 (NC base case sweep, K-Floor, Mike & Laura).
  //   WR ≤ 3.5%: ~99% (very safe; Big ERN floor)
  //   WR = 4.0%: ~99% (Trinity Study standard for 30-yr horizon)
  //   WR = 5.0%: ~88%
  //   WR = 6.0%: ~77%
  //   WR = 7.0%: ~66%
  //   WR ≥ 8.5%: 50% floor
  // Cap is 99% (not 100%) so the heuristic never claims certainty.
  //
  // This mapping is INTENTIONALLY CONSERVATIVE: the heuristic underestimates probability for
  // scenarios where (a) bridge length is short, (b) post-SS coverage ratio is high, or
  // (c) the portfolio has substantial buffer beyond the stress withdrawal. MC captures these
  // effects; the heuristic does not. Heuristic = "is the stress WR in a safe band?" — for
  // anything tighter, run Monte Carlo via the `mc` CLI subcommand.
  const probabilityOfSuccess = Math.max(
    0.50,
    Math.min(0.99, 0.99 - (stressWithdrawalRate - 0.04) * 11)
  );

  const surplusOrDeficit = spendingCapacity - essentialSpending;

  // Lower guardrail: portfolio drop that triggers a spending cut
  const lowerGuardrailDollarDrop = portfolio * guardrails.lowerGuardrailDropPct;
  // Spending cut applies to variable spending (essential + lifestyle + charitable).
  // Mortgage and healthcare are non-discretionary, see simulation-runner guardrail logic.
  const variableSpending = spending.baseAnnualSpending + spending.travelBudgetEarly + spending.charitableGivingAnnual;
  const lowerGuardrailSpendingCutDollars =
    (variableSpending * guardrails.lowerGuardrailSpendingCutPct) / 12; // monthly

  return {
    spendingCapacity,
    preSsCapacity: portfolioContribution,
    probabilityOfSuccess,
    surplusOrDeficit,
    lowerGuardrailDollarDrop,
    lowerGuardrailSpendingCutDollars,
    stressWithdrawalRate,
    bridgeWithdrawalRate,
    longRunWithdrawalRate,
  };
}
