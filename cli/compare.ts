/**
 * Strategy-comparison harness.
 *
 * Reads a base profile + a strategies JSON (shared free cash flow, list of
 * SavingsStrategy overlays) and runs each strategy through runSimulation twice:
 * once with the profile as given (Korea-off / base case) and once with
 * retirementLocation='international' (Korea-on). Optionally runs Monte Carlo
 * for each to surface p10/p50/p90.
 *
 * Output: a ranked table on all three scoring axes (tax-minimizing,
 * legacy-maximizing, enjoyment-maximizing) for both Korea scenarios.
 */

import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';

import { deriveAssetTotals } from '../src/domain/types/assets';
import type { ClientProfile, AllocationRule } from '../src/domain/types/profile';
import type { Account } from '../src/domain/types/assets';
import type { SpendingProfile, OneTimeExpense } from '../src/domain/types/spending';
import type { GuardrailConfig, ScenarioResult } from '../src/domain/types/scenarios';
import { runSimulation } from '../src/domain/engine/simulation-runner';
import { runMonteCarlo, type MonteCarloResult } from '../src/domain/engine/monte-carlo';
import { getStateInfo } from '../src/domain/constants/states';

// ─── Profile-input schema (mirrors run.ts, extracted here to avoid circular imports) ───

interface PersonInput {
  name: string;
  age: number;
  lifeExpectancy: number;
  fullRetirementAge: number;
  fraMonthlyBenefit: number;
  socialSecurityClaimAge: number;
}

interface AccountInput {
  label: string;
  owner: 'client' | 'spouse' | 'joint';
  type: Account['type'];
  balance: number;
  costBasis?: number;
  inheritedYearsRemaining?: number;
}

interface SpendingInput {
  essential: number;
  lifestyleActive?: number;
  lifestyleSlower?: number;
  lifestyleTaperAge?: number;
  charitable?: number;
  lumpyExpenses?: Array<{ year: number; label: string; amount: number }>;
  inflationRate?: number;
  mortgageAnnualPayment?: number;
  mortgagePaidOffAge?: number;
  annualHealthcareCost?: number;
}

interface ProfileInput {
  client: PersonInput;
  spouse?: PersonInput | null;
  state: string;
  filingStatus?: 'married_filing_jointly' | 'single';
  currentYear: number;
  retirementYear: number;
  cobraMonths?: number;
  acaHouseholdSize?: number;
  annualGrowthRate?: number;
  retirementLocation?: 'us' | 'international';
  targetBracket?: '10%' | '12%' | '22%' | '24%' | '32%' | '35%';
  spendingEngine?: 'withdrawal_sequencing' | 'conversion_primary' | 'auto';
  accounts: AccountInput[];
  homeEquity?: number;
  spending: SpendingInput;
  guardrails?: {
    upperGrowthPct?: number;
    lowerDropPct?: number;
    lowerCutPct?: number;
  };
}

// ─── Strategies-input schema ──────────────────────────────────────────────────

interface StrategyOverlay {
  name: string;
  description?: string;
  rules: AllocationRule[];
}

interface StrategiesFile {
  annualFreeCashFlow: number;
  freeCashFlowGrowth?: number;
  marginalTaxRateFedState: number;
  strategies: StrategyOverlay[];
}

// ─── Load helpers ─────────────────────────────────────────────────────────────

function loadProfileInput(filePath: string): ProfileInput {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as ProfileInput;
}

function loadStrategiesFile(filePath: string): StrategiesFile {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as StrategiesFile;
}

function buildBase(input: ProfileInput): {
  profile: ClientProfile;
  accounts: Account[];
  homeEquity: number;
  spending: SpendingProfile;
  guardrails: GuardrailConfig;
} {
  const stateInfo = getStateInfo(input.state);
  const profile: ClientProfile = {
    client: {
      ...input.client,
      birthYear: input.currentYear - input.client.age,
    },
    spouse: input.spouse
      ? { ...input.spouse, birthYear: input.currentYear - input.spouse.age }
      : null,
    filingStatus: input.filingStatus ?? (input.spouse ? 'married_filing_jointly' : 'single'),
    stateOfResidence: input.state,
    hasStateIncomeTax: stateInfo?.hasIncomeTax ?? true,
    currentYear: input.currentYear,
    retirementYearDesired: input.retirementYear,
    cobraMonths: input.cobraMonths ?? 18,
    acaHouseholdSize: input.acaHouseholdSize,
    annualGrowthRate: input.annualGrowthRate != null ? input.annualGrowthRate / 100 : undefined,
    retirementLocation: input.retirementLocation,
    targetBracket: input.targetBracket,
    spendingEngine: input.spendingEngine,
  };

  const accounts: Account[] = input.accounts.map((a, i) => ({
    id: String(i + 1),
    label: a.label,
    owner: a.owner,
    type: a.type,
    currentBalance: a.balance,
    costBasis: a.costBasis,
    isInherited: a.type === 'inherited_ira',
    inheritedIraRemainingYears: a.inheritedYearsRemaining,
  }));

  const sp = input.spending;
  const lumpy: OneTimeExpense[] = (sp.lumpyExpenses ?? []).map((e) => ({
    year: e.year, label: e.label, amount: e.amount,
  }));
  const spending: SpendingProfile = {
    baseAnnualSpending: sp.essential,
    travelBudgetEarly: sp.lifestyleActive ?? 0,
    travelBudgetLate: sp.lifestyleSlower ?? 0,
    travelTaperStartAge: sp.lifestyleTaperAge ?? 75,
    charitableGivingAnnual: sp.charitable ?? 0,
    oneTimeExpenses: lumpy,
    inflationRate: (sp.inflationRate ?? 3) / 100,
    ...(sp.mortgageAnnualPayment && sp.mortgageAnnualPayment > 0 && {
      mortgageAnnualPayment: sp.mortgageAnnualPayment,
      mortgagePaidOffAge: sp.mortgagePaidOffAge,
    }),
    ...(sp.annualHealthcareCost && sp.annualHealthcareCost > 0 && {
      annualHealthcareCost: sp.annualHealthcareCost,
    }),
  };

  const g = input.guardrails ?? {};
  const guardrails: GuardrailConfig = {
    upperGuardrailGrowthPct: g.upperGrowthPct ?? 0.20,
    lowerGuardrailDropPct: g.lowerDropPct ?? 0.29,
    lowerGuardrailSpendingCutPct: g.lowerCutPct ?? 0.03,
  };

  return { profile, accounts, homeEquity: input.homeEquity ?? 0, spending, guardrails };
}

// ─── Comparison runner ────────────────────────────────────────────────────────

interface StrategyRun {
  strategyName: string;
  koreaOn: boolean;
  result: ScenarioResult;
  monteCarlo?: MonteCarloResult;
}

function runOne(
  baseProfile: ClientProfile,
  accounts: Account[],
  homeEquity: number,
  spending: SpendingProfile,
  guardrails: GuardrailConfig,
  overlay: StrategyOverlay,
  overlayDefaults: StrategiesFile,
  koreaOn: boolean,
  withMonteCarlo: boolean,
): StrategyRun {
  // Korea-on models relocation at retirement: no US marketplace (international season)
  // AND the household severs NC residency. The state-tax engine uses profile.stateOfResidence
  // and profile.hasStateIncomeTax, so we set both. Accumulation-phase state tax is unaffected
  // because the household remains in NC while working.
  const profile: ClientProfile = {
    ...baseProfile,
    retirementLocation: koreaOn ? 'international' : 'us',
    hasStateIncomeTax: koreaOn ? false : baseProfile.hasStateIncomeTax,
    savingsStrategy: {
      name: overlay.name,
      annualFreeCashFlow: overlayDefaults.annualFreeCashFlow,
      freeCashFlowGrowth: overlayDefaults.freeCashFlowGrowth,
      marginalTaxRateFedState: overlayDefaults.marginalTaxRateFedState,
      rules: overlay.rules,
    },
  };

  const assets = deriveAssetTotals(accounts, homeEquity);
  const result = runSimulation(profile, assets, spending, guardrails, 'retire_at_stated_date');

  const run: StrategyRun = { strategyName: overlay.name, koreaOn, result };

  if (withMonteCarlo) {
    run.monteCarlo = runMonteCarlo(profile, assets, spending, guardrails, 'retire_at_stated_date', {
      simulations: 1000,
      meanNominalReturn: profile.annualGrowthRate ?? 0.09,
      stdDevReturn: 0.14,
    });
  }

  return run;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const B = '\x1b[1m';
const DIM = '\x1b[2m';
const G = '\x1b[32m';
const Y = '\x1b[33m';
const C = '\x1b[36m';
const RS = '\x1b[0m';

function usd(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function pad(s: string, w: number, right = false): string {
  return right ? s.padStart(w) : s.padEnd(w);
}

function printTable(title: string, rows: StrategyRun[], sortBy: 'tax' | 'terminal' | 'enjoyment'): void {
  const sorted = [...rows].sort((a, b) => {
    if (sortBy === 'tax')       return a.result.lifetime.totalTaxPaid - b.result.lifetime.totalTaxPaid;
    if (sortBy === 'terminal')  return b.result.lifetime.terminal.total - a.result.lifetime.terminal.total;
    if (sortBy === 'enjoyment') return b.result.lifetime.earlyRetirementSpending - a.result.lifetime.earlyRetirementSpending;
    return 0;
  });

  console.log(`\n  ${B}${title}${RS}   ${DIM}(sorted by ${sortBy === 'tax' ? 'min tax' : sortBy === 'terminal' ? 'max terminal wealth' : 'max early-retirement spending'})${RS}\n`);
  const header =
    `  ${pad('Strategy', 28)}  ${pad('Korea', 6)}  ${pad('Lifetime Tax', 12, true)}  ${pad('Terminal $', 12, true)}  ${pad('Early 55–65', 12, true)}  ${pad('MC Success', 10, true)}  ${pad('Pretax Zero', 12, true)}`;
  console.log(DIM + header + RS);
  console.log(DIM + '  ' + '─'.repeat(header.length - 2) + RS);

  for (const r of sorted) {
    const lt = r.result.lifetime;
    const mcSuccess = r.monteCarlo ? pct(r.monteCarlo.successRate) : 'n/a';
    const depletionStr = lt.pretaxDepletionYear ? String(lt.pretaxDepletionYear) : 'never';
    const koreaMark = r.koreaOn ? `${C}on${RS}    ` : `${Y}off${RS}   `;
    console.log(
      `  ${pad(r.strategyName, 28)}  ${koreaMark}${pad(usd(lt.totalTaxPaid), 12, true)}  ${pad(usd(lt.terminal.total), 12, true)}  ${pad(usd(lt.earlyRetirementSpending), 12, true)}  ${pad(mcSuccess, 10, true)}  ${pad(depletionStr, 12, true)}`
    );
  }
}

function printStrategyDetail(runs: StrategyRun[]): void {
  console.log(`\n  ${B}Strategy details (Korea-off only, for readability)${RS}\n`);
  for (const r of runs.filter((x) => !x.koreaOn)) {
    const t = r.result.lifetime.strategyTotals;
    if (!t) continue;
    console.log(`  ${C}${r.strategyName}${RS}`);
    console.log(`    Pre-tax contributions (lifetime, nominal):  ${usd(t.totalPretaxContributions)}`);
    console.log(`    Roth contributions   (lifetime, nominal):   ${usd(t.totalRothContributions)}`);
    console.log(`    HSA contributions    (lifetime, nominal):   ${usd(t.totalHsaContributions)}`);
    console.log(`    Brokerage            (lifetime, nominal):   ${usd(t.totalBrokerageContributions)}`);
    console.log(`    Working-year conv    (lifetime, nominal):   ${usd(t.totalWorkingYearConversions)}`);
    console.log(`    Employer match       (lifetime, nominal):   ${usd(t.totalEmployerMatch)}`);
    console.log(`    Cash consumed / remaining:                   ${usd(t.totalFreeCashFlowConsumed)} / ${usd(t.totalFreeCashFlowRemaining)}`);
    console.log();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function runCompare(profilePath: string, strategiesPath: string, withMonteCarlo = false): StrategyRun[] {
  const profileInput = loadProfileInput(pathResolve(process.cwd(), profilePath));
  const strategiesInput = loadStrategiesFile(pathResolve(process.cwd(), strategiesPath));
  const { profile, accounts, homeEquity, spending, guardrails } = buildBase(profileInput);

  const runs: StrategyRun[] = [];
  for (const overlay of strategiesInput.strategies) {
    for (const koreaOn of [false, true]) {
      runs.push(runOne(profile, accounts, homeEquity, spending, guardrails, overlay, strategiesInput, koreaOn, withMonteCarlo));
    }
  }
  return runs;
}

export function printCompare(runs: StrategyRun[], jsonMode = false): void {
  if (jsonMode) {
    console.log(JSON.stringify(runs.map((r) => ({
      strategy: r.strategyName,
      koreaOn: r.koreaOn,
      lifetime: r.result.lifetime,
      probabilityOfSuccess: r.result.probabilityOfSuccess,
      monteCarlo: r.monteCarlo ? {
        successRate: r.monteCarlo.successRate,
        p10Final: r.monteCarlo.p10FinalPortfolio,
        medianFinal: r.monteCarlo.medianFinalPortfolio,
        p90Final: r.monteCarlo.p90FinalPortfolio,
      } : null,
    })), null, 2));
    return;
  }

  printTable('Tax-minimizing ranking', runs, 'tax');
  printTable('Legacy-maximizing ranking (terminal wealth)', runs, 'terminal');
  printTable('Enjoyment-maximizing ranking (early spending 55–65)', runs, 'enjoyment');
  printStrategyDetail(runs);
}
