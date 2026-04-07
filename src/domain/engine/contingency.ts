import type { ContingencyReport, RiskAssessment, WidowsPenaltyAnalysis } from '../types/contingency';
import type { ClientProfile } from '../types/profile';
import type { AssetSnapshot } from '../types/assets';
import type { GuardrailConfig, ScenarioResult } from '../types/scenarios';
import type { SocialSecurityComparison } from '../types/social-security';

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
  const survivorAnnualSS =
    survivingSpouse === 'client'
      ? Math.max(clientMonthly, spouseMonthly) * 12
      : Math.max(spouseMonthly, clientMonthly) * 12;
  const lostSS = combinedAnnualSS - survivorAnnualSS;

  // Survivor inherits the full portfolio — add its withdrawal capacity to SS income.
  // Use the starting portfolio balance (projected at retirement).
  const startingPortfolio = scenario.yearlyProjections[0]?.portfolioStartBalance ?? 0;
  const survivorLifeExpectancy =
    survivingSpouse === 'client' ? profile.client.lifeExpectancy : (profile.spouse?.lifeExpectancy ?? 90);
  const survivorAge =
    survivingSpouse === 'client' ? profile.client.age : (profile.spouse?.age ?? 60);
  const survivorYearsInRetirement = Math.max(10, survivorLifeExpectancy - survivorAge);
  const survivorSWR = survivorYearsInRetirement <= 25 ? 0.045 : survivorYearsInRetirement <= 35 ? 0.040 : 0.038;
  const portfolioWithdrawalCapacity = startingPortfolio * survivorSWR;

  const survivorTotalIncome = survivorAnnualSS + portfolioWithdrawalCapacity;
  const desiredSpending = scenario.desiredSpending; // baseAnnualSpending after fix
  const survivorCoveragePercent = desiredSpending > 0 ? survivorTotalIncome / desiredSpending : 1;
  const canMaintain = survivorCoveragePercent >= 0.9;

  return {
    survivingSpouse,
    currentCombinedIncome: combinedAnnualSS,
    incomeAfterLoss: survivorTotalIncome,
    incomeLostFromSS: lostSS,
    survivorCoveragePercent,
    canMaintainLifestyle: canMaintain,
    singleFilerBracketNote:
      'Surviving spouse files as Single — tax brackets are roughly half of MFJ, increasing effective tax rate on the same income.',
  };
}
