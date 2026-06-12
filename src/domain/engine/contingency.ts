import type { ContingencyReport, RiskAssessment, WidowsPenaltyAnalysis } from '../types/contingency';
import type { ClientProfile, PersonProfile } from '../types/profile';
import type { AssetSnapshot } from '../types/assets';
import type { GuardrailConfig, ScenarioResult } from '../types/scenarios';
import type { SocialSecurityComparison } from '../types/social-security';
import { calculateOrdinaryIncomeTax } from './tax-utils';
import { classifyIrmaaTier } from './seasons';
import {
  FEDERAL_INCOME_TAX_BRACKETS_2025,
  STANDARD_DEDUCTION_2025,
} from '../constants/tax-brackets';

/** Survivor households spend ~75–85% of the couple budget (housing and most fixed costs
 *  don't halve); 80% is the standard planning factor. */
const SURVIVOR_SPENDING_FACTOR = 0.80;

export function buildContingencyReport(
  profile: ClientProfile,
  assets: AssetSnapshot,
  guardrails: GuardrailConfig,
  scenario: ScenarioResult,
  ssComparison: SocialSecurityComparison
): ContingencyReport {
  const risks = buildRiskAssessments(guardrails, scenario);
  const widowsPenaltyClient = analyzeWidowsPenalty('client', profile, scenario, ssComparison);
  const widowsPenaltySpouse = profile.spouse
    ? analyzeWidowsPenalty('spouse', profile, scenario, ssComparison)
    : null;

  return { risks, widowsPenaltyClient, widowsPenaltySpouse };
}

function buildRiskAssessments(
  guardrails: GuardrailConfig,
  scenario: ScenarioResult
): RiskAssessment[] {
  const dropPct = Math.round(guardrails.lowerGuardrailDropPct * 100);
  const cutPct = Math.round(guardrails.lowerGuardrailSpendingCutPct * 100);

  return [
    {
      type: 'market_crash',
      label: 'Sudden Market Crash',
      likelihood: 'low',
      mitigationStrategy: `Portfolio must drop ${dropPct}% before spending guardrail triggers.`,
      ifThenStatement: `If the market drops ${dropPct}%, then reduce spending by ${cutPct}% ($${scenario.lowerGuardrailSpendingCutDollars.toFixed(0)}/month).`,
    },
    {
      type: 'overspending',
      label: 'Overspending / Lifestyle Creep',
      likelihood: 'medium',
      mitigationStrategy: 'Link accounts to budgeting tools for real-time tracking. Annual spending review.',
      ifThenStatement: 'If actual spending exceeds plan by 10%, then review and rebalance spending categories.',
    },
    {
      type: 'low_growth',
      label: 'Low Growth / Sideways Markets',
      likelihood: 'medium',
      mitigationStrategy: 'Most common guardrail trigger. Guardrail system automatically adjusts spending in low-growth decades.',
      ifThenStatement: 'If portfolio grows less than 2% real for 3+ consecutive years, then reduce discretionary spending proactively.',
    },
    {
      type: 'runaway_inflation',
      label: 'Runaway Inflation',
      likelihood: 'low',
      mitigationStrategy: 'All spending modeled in inflation-adjusted (real) dollars. Spending capacity recalculated annually.',
      ifThenStatement: 'If inflation exceeds 5% for 2+ years, then revisit real withdrawal rate assumptions.',
    },
    {
      type: 'unexpected_major_expense',
      label: 'Unexpected Major Expense',
      likelihood: 'medium',
      mitigationStrategy: `$${scenario.surplusOrDeficit.toFixed(0)}/year surplus provides buffer. Home equity also available as last resort.`,
      ifThenStatement: 'If a major unplanned expense (>$50k) occurs, then draw from brokerage first, not pre-tax accounts.',
    },
    {
      type: 'incorrect_assumptions',
      label: 'Incorrect Assumptions (Garbage In, Garbage Out)',
      likelihood: 'medium',
      mitigationStrategy: 'Annual plan review. Update income, spending, and balance inputs each year.',
      ifThenStatement: 'If any major assumption changes (income, health, family), then re-run the full simulation.',
    },
  ];
}

function analyzeWidowsPenalty(
  survivingSpouse: 'client' | 'spouse',
  profile: ClientProfile,
  scenario: ScenarioResult,
  ssComparison: SocialSecurityComparison
): WidowsPenaltyAnalysis {
  const recommended = ssComparison.options[ssComparison.recommendedOptionIndex];
  const clientMonthly = recommended.clientMonthlyBenefit;
  const spouseMonthly = recommended.spouseMonthlyBenefit ?? 0;

  const combinedAnnualSS = (clientMonthly + spouseMonthly) * 12;
  // Survivor keeps the higher of the two SS checks
  const survivorAnnualSS = Math.max(clientMonthly, spouseMonthly) * 12;
  const lostSS = combinedAnnualSS - survivorAnnualSS;

  const survivor: PersonProfile =
    survivingSpouse === 'client' ? profile.client : (profile.spouse ?? profile.client);
  const deceased: PersonProfile | null =
    survivingSpouse === 'client' ? profile.spouse : profile.client;

  const projections = scenario.yearlyProjections;
  const lastProj = projections[projections.length - 1];

  // Death is modeled in the year the deceased spouse reaches their life expectancy. If that
  // falls before retirement, the first projection (retirement start) stands in — the engine
  // does not simulate accumulation-phase death. Single filers get the degenerate no-loss case.
  const deathProj =
    deceased == null
      ? projections[0]
      : projections.find((p) => {
          const age = survivingSpouse === 'client' ? p.spouseAge : p.clientAge;
          return age != null && age >= deceased.lifeExpectancy;
        }) ?? lastProj;

  const survivorAgeAtDeath =
    (survivingSpouse === 'client' ? deathProj?.clientAge : deathProj?.spouseAge) ?? survivor.age;
  const atDeathPortfolio = deathProj?.portfolioEndBalance ?? 0;
  const pretaxShareAtDeath =
    atDeathPortfolio > 0 ? (deathProj?.pretaxEndBalance ?? 0) / atDeathPortfolio : 0;

  // Survivor inherits the at-death portfolio; SWR capacity over the survivor's remaining horizon.
  const survivorYearsRemaining = Math.max(10, survivor.lifeExpectancy - survivorAgeAtDeath);
  const survivorSWR =
    survivorYearsRemaining <= 25 ? 0.045 : survivorYearsRemaining <= 35 ? 0.040 : 0.038;
  const portfolioWithdrawalCapacity = atDeathPortfolio * survivorSWR;
  const survivorTotalIncome = survivorAnnualSS + portfolioWithdrawalCapacity;

  // A one-person household needs ~80% of the couple budget, not 100% (v1 used 100%).
  const survivorSpendingNeed =
    scenario.desiredSpending * (deceased == null ? 1 : SURVIVOR_SPENDING_FACTOR);

  // Single-filer recompute (planning-grade): ordinary income = the pretax share of the SWR
  // draw + the 85% taxable slice of SS. Realized gains are ignored — taxable basis steps up
  // at death, and Roth/basis draws are tax-free. Senior deduction (2025–28 sunset) omitted.
  const ordinaryIncome = portfolioWithdrawalCapacity * pretaxShareAtDeath + 0.85 * survivorAnnualSS;
  const singleTaxable = Math.max(0, ordinaryIncome - STANDARD_DEDUCTION_2025.single);
  const mfjTaxable = Math.max(0, ordinaryIncome - STANDARD_DEDUCTION_2025.married_filing_jointly);
  const survivorFederalTaxSingle = calculateOrdinaryIncomeTax(
    singleTaxable, 'single', FEDERAL_INCOME_TAX_BRACKETS_2025
  );
  const mfjEquivalentFederalTax = calculateOrdinaryIncomeTax(
    mfjTaxable, 'married_filing_jointly', FEDERAL_INCOME_TAX_BRACKETS_2025
  );
  const annualWidowsPenaltyTax =
    deceased == null ? 0 : Math.max(0, survivorFederalTaxSingle - mfjEquivalentFederalTax);

  // IRMAA compresses to single thresholds for one person on Medicare.
  const survivorIrmaaSurcharge =
    deceased != null && survivorAgeAtDeath >= 65
      ? classifyIrmaaTier(ordinaryIncome, 'single').annualSurchargeCouple
      : 0;

  const survivorNetIncome =
    survivorTotalIncome - survivorFederalTaxSingle - survivorIrmaaSurcharge;
  const survivorCoveragePercent =
    survivorSpendingNeed > 0 ? survivorNetIncome / survivorSpendingNeed : 1;
  const canMaintain = survivorCoveragePercent >= 0.9;

  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const singleFilerBracketNote =
    deceased == null
      ? 'Single filer — no widow’s penalty applies; shown for completeness.'
      : `Single-filer recompute on the ${deathProj?.year} at-death portfolio: ${fmt(survivorFederalTaxSingle)} federal vs ${fmt(mfjEquivalentFederalTax)} MFJ-equivalent (+${fmt(annualWidowsPenaltyTax)}/yr widow’s penalty)` +
        (survivorIrmaaSurcharge > 0
          ? `, plus ${fmt(survivorIrmaaSurcharge)}/yr IRMAA at single thresholds`
          : '') +
        `. Survivor need modeled at ${Math.round(SURVIVOR_SPENDING_FACTOR * 100)}% of couple spending; coverage is net of single-filer tax.`;

  return {
    survivingSpouse,
    currentCombinedIncome: combinedAnnualSS,
    incomeAfterLoss: survivorTotalIncome,
    incomeLostFromSS: lostSS,
    atDeathYear: deathProj?.year ?? scenario.retirementYear,
    survivorAgeAtDeath,
    atDeathPortfolio,
    survivorSpendingNeed,
    survivorFederalTaxSingle,
    mfjEquivalentFederalTax,
    annualWidowsPenaltyTax,
    survivorIrmaaSurcharge,
    survivorCoveragePercent,
    canMaintainLifestyle: canMaintain,
    singleFilerBracketNote,
  };
}
