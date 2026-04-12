#!/usr/bin/env node
/**
 * Lumpsum CLI — run retirement simulations from a JSON profile file.
 *
 * Usage:
 *   npx tsx cli/run.ts <profile.json> [command] [options]
 *   npm run cli <profile.json> [command]
 *
 * Commands:
 *   (none) | scenarios    Three-scenario comparison (default)
 *   seasons [N]           Year-by-year table (N = years shown, default 30)
 *   roth                  Roth conversion schedule
 *   ss                    Social Security claiming analysis
 *   opportunities         Six optimization opportunity scanner
 *   contingency           Risk assessment + widow's penalty
 *   all                   Everything above
 *
 * Options:
 *   --json                Output raw JSON (pipe-friendly)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { deriveAssetTotals } from '../src/domain/types/assets';
import type { ClientProfile, PersonProfile, AnnualContributions } from '../src/domain/types/profile';
import type { Account } from '../src/domain/types/assets';
import type { SpendingProfile, OneTimeExpense } from '../src/domain/types/spending';
import type { GuardrailConfig } from '../src/domain/types/scenarios';
import { runSimulation } from '../src/domain/engine/simulation-runner';
import { buildSocialSecurityComparison } from '../src/domain/engine/social-security';
import { assessOpportunities } from '../src/domain/engine/opportunities';
import { buildContingencyReport } from '../src/domain/engine/contingency';
import { getStateInfo } from '../src/domain/constants/states';

import {
  printScenarios,
  printSeasons,
  printRoth,
  printSS,
  printOpportunities,
  printContingency,
  header,
} from './format-output';

// ─── Profile JSON schema ──────────────────────────────────────────────────────
// This is the format users write in their .json files.

interface PersonInput {
  name: string;
  age: number;
  lifeExpectancy: number;
  fullRetirementAge: number;
  /** Monthly SS benefit if claimed exactly at fullRetirementAge. Find at ssa.gov/myaccount */
  fraMonthlyBenefit: number;
  socialSecurityClaimAge: number;
}

interface AccountInput {
  label: string;
  owner: 'client' | 'spouse' | 'joint';
  /** "pretax_ira" | "roth_ira" | "brokerage" | "inherited_ira" */
  type: Account['type'];
  balance: number;
  /** Brokerage only: portion of balance that is return of basis (not taxable) */
  costBasis?: number;
  /** Inherited IRA only: years remaining in the 10-year distribution rule */
  inheritedYearsRemaining?: number;
}

interface SpendingInput {
  /** Fixed costs that don't change with activity: housing, utilities, groceries, insurance.
   *  Do NOT include healthcare here if using annualHealthcareCost below. */
  essential: number;
  /** Discretionary spending in active years (travel, dining, hobbies) */
  lifestyleActive?: number;
  /** Discretionary spending in slower years */
  lifestyleSlower?: number;
  /** Client age when lifestyle spending steps down */
  lifestyleTaperAge?: number;
  /** Annual charitable giving */
  charitable?: number;
  /** One-time / lumpy expenses (weddings, roof, car, etc.) */
  lumpyExpenses?: Array<{ year: number; label: string; amount: number }>;
  /** Inflation rate as a percentage, e.g. 3 means 3%. Default: 3 */
  inflationRate?: number;
  /** Fixed-rate mortgage P&I payment (nominal, not inflation-adjusted). Omit if no mortgage. */
  mortgageAnnualPayment?: number;
  /** Client age when mortgage is paid off (last payment year). */
  mortgagePaidOffAge?: number;
  /** If set, this amount is drawn from HSA each year before hitting the spending pool.
   *  Covers ACA premiums, Medicare Part B/D, Medigap, etc. */
  annualHealthcareCost?: number;
}

interface ProfileInput {
  client: PersonInput;
  /** Omit or set to null if single */
  spouse?: PersonInput | null;
  /** Two-letter state abbreviation, e.g. "TX" */
  state: string;
  /** "married_filing_jointly" | "single". Inferred from spouse presence if omitted. */
  filingStatus?: 'married_filing_jointly' | 'single';
  currentYear: number;
  /** The year you want to retire. "Retire Now" scenario uses currentYear. */
  retirementYear: number;
  /** Months of COBRA coverage after retirement. 0 = skip COBRA, go straight to ACA. Default: 18 */
  cobraMonths?: number;
  /** Number of people on ACA plan. Determines subsidy cliff: 2=$84,600 · 3=$106,120 · 4=$127,640. Default: 2 */
  acaHouseholdSize?: number;
  /** Nominal annual portfolio growth rate as a percentage, e.g. 9 means 9%. Default: 7 */
  annualGrowthRate?: number;
  /** "us" | "international". International skips ACA season (no cliff). Default: "us" */
  retirementLocation?: 'us' | 'international';
  /** Target federal bracket to fill via Roth conversion each year.
   *  Engine computes conversion = (bracketCeiling + stdDeduction) × inflationFactor − RMD − SS.
   *  Automatically selects conversion_primary engine. Omit for surplus-driven conversions. */
  targetBracket?: '10%' | '12%' | '22%' | '24%' | '32%' | '35%';
  /** Engine selection. "auto" (default): picks conversion_primary when targetBracket is set.
   *  "withdrawal_sequencing": draw accounts to cover spending, convert surplus to Roth.
   *  "conversion_primary": fill targetBracket from pretax; Roth pays taxes + spending. */
  spendingEngine?: 'withdrawal_sequencing' | 'conversion_primary' | 'auto';
  /** Annual contributions during accumulation (working) years. Added each year before growth.
   *  Omit if already retired. Typical: pretax=$46k (2×401k), roth=$14k (2× backdoor Roth), hsa=$8300 (maxed). */
  annualContributions?: {
    pretax: number;
    roth: number;
    brokerage: number;
    hsa?: number;
  };
  accounts: AccountInput[];
  /** Home equity — non-liquid, for reference only */
  homeEquity?: number;
  spending: SpendingInput;
  guardrails?: {
    /** Portfolio growth % that triggers an upper guardrail (spend more). Default: 0.20 */
    upperGrowthPct?: number;
    /** Portfolio drop % that triggers a lower guardrail (spend less). Default: 0.29 */
    lowerDropPct?: number;
    /** Spending cut % when lower guardrail hits. Default: 0.03 */
    lowerCutPct?: number;
  };
}

// ─── Load & validate profile ──────────────────────────────────────────────────

function loadProfile(filePath: string): {
  profile: ClientProfile;
  accounts: Account[];
  homeEquity: number;
  spending: SpendingProfile;
  guardrails: GuardrailConfig;
} {
  const raw = readFileSync(filePath, 'utf-8');
  let input: ProfileInput;

  try {
    input = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${filePath}: ${(e as Error).message}`);
  }

  // ── Client
  function mapPerson(p: PersonInput): PersonProfile {
    return {
      name: p.name,
      age: p.age,
      birthYear: input.currentYear - p.age,
      lifeExpectancy: p.lifeExpectancy,
      fullRetirementAge: p.fullRetirementAge,
      fraMonthlyBenefit: p.fraMonthlyBenefit,
      socialSecurityClaimAge: p.socialSecurityClaimAge,
    };
  }

  const stateInfo = getStateInfo(input.state);

  const annualContributions: AnnualContributions | undefined = input.annualContributions
    ? {
        pretax:    input.annualContributions.pretax,
        roth:      input.annualContributions.roth,
        brokerage: input.annualContributions.brokerage,
        hsa:       input.annualContributions.hsa ?? 0,
      }
    : undefined;

  const profile: ClientProfile = {
    client: mapPerson(input.client),
    spouse: input.spouse ? mapPerson(input.spouse) : null,
    filingStatus:
      input.filingStatus ??
      (input.spouse ? 'married_filing_jointly' : 'single'),
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
    annualContributions,
  };

  // ── Accounts
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

  // ── Spending
  const sp = input.spending;
  const lumpyExpenses: OneTimeExpense[] = (sp.lumpyExpenses ?? []).map((e) => ({
    year: e.year,
    label: e.label,
    amount: e.amount,
  }));

  const spending: SpendingProfile = {
    baseAnnualSpending: sp.essential,
    travelBudgetEarly: sp.lifestyleActive ?? 0,
    travelBudgetLate: sp.lifestyleSlower ?? 0,
    travelTaperStartAge: sp.lifestyleTaperAge ?? 75,
    charitableGivingAnnual: sp.charitable ?? 0,
    oneTimeExpenses: lumpyExpenses,
    inflationRate: (sp.inflationRate ?? 3) / 100,
    ...(sp.mortgageAnnualPayment && sp.mortgageAnnualPayment > 0 && {
      mortgageAnnualPayment: sp.mortgageAnnualPayment,
      mortgagePaidOffAge: sp.mortgagePaidOffAge,
    }),
    ...(sp.annualHealthcareCost && sp.annualHealthcareCost > 0 && {
      annualHealthcareCost: sp.annualHealthcareCost,
    }),
  };

  // ── Guardrails
  const g = input.guardrails ?? {};
  const guardrails: GuardrailConfig = {
    upperGuardrailGrowthPct: g.upperGrowthPct ?? 0.20,
    lowerGuardrailDropPct: g.lowerDropPct ?? 0.29,
    lowerGuardrailSpendingCutPct: g.lowerCutPct ?? 0.03,
  };

  return { profile, accounts, homeEquity: input.homeEquity ?? 0, spending, guardrails };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
${'\x1b[1m'}Lumpsum CLI${'\x1b[0m'} — retirement scenario analysis from JSON profiles

Usage:
  npx tsx cli/run.ts <profile.json> [command] [options]

Commands:
  scenarios         Three-scenario comparison (default)
  seasons [N]       Year-by-year table (N years, default 30)
  roth              Roth conversion schedule
  ss                Social Security timing analysis
  opportunities     Six optimization opportunity scanner
  contingency       Risk assessment + widow's penalty
  all               All of the above

Options:
  --json            Output raw JSON

Example:
  npx tsx cli/run.ts cli/profile-template.json
  npx tsx cli/run.ts cli/profile-template.json seasons 20
  npx tsx cli/run.ts cli/profile-template.json all --json > results.json
`);
    process.exit(0);
  }

  // Parse flags
  const jsonMode = args.includes('--json');
  const cleanArgs = args.filter((a) => !a.startsWith('--'));

  const filePath = resolve(process.cwd(), cleanArgs[0]);
  const command = cleanArgs[1] ?? 'scenarios';
  const commandArg = cleanArgs[2]; // e.g. number of years for 'seasons'

  // Load profile
  let loaded: ReturnType<typeof loadProfile>;
  try {
    loaded = loadProfile(filePath);
  } catch (e) {
    console.error(`\x1b[31mError loading profile:\x1b[0m ${(e as Error).message}`);
    process.exit(1);
  }

  const { profile, accounts, homeEquity, spending, guardrails } = loaded;
  const assets = deriveAssetTotals(accounts, homeEquity);

  // Run simulations
  const retireNow    = runSimulation(profile, assets, spending, guardrails, 'retire_now');
  const retireStated = runSimulation(profile, assets, spending, guardrails, 'retire_at_stated_date');
  const noChange     = runSimulation(profile, assets, spending, guardrails, 'no_change');
  const scenarios    = [retireNow, retireStated, noChange];

  // Lazy: only compute these if needed
  function getSSComparison() {
    return buildSocialSecurityComparison(
      profile.client.fraMonthlyBenefit,
      profile.client.fullRetirementAge,
      profile.client.lifeExpectancy,
      profile.spouse?.fraMonthlyBenefit ?? null,
      profile.spouse?.fullRetirementAge ?? null,
      profile.spouse?.lifeExpectancy ?? null,
    );
  }

  function getOpportunities() {
    return assessOpportunities(profile, assets, retireNow.yearlyProjections);
  }

  function getContingency() {
    const ss = getSSComparison();
    return buildContingencyReport(profile, assets, guardrails, retireNow, ss);
  }

  // JSON output mode
  if (jsonMode) {
    const output: Record<string, unknown> = { scenarios };
    if (command === 'all' || command === 'ss' || command === 'scenarios') {
      output.ssComparison = getSSComparison();
    }
    if (command === 'all' || command === 'opportunities') {
      output.opportunities = getOpportunities();
    }
    if (command === 'all' || command === 'contingency') {
      output.contingency = getContingency();
    }
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Formatted output
  const profileLine = `${profile.client.name}${profile.spouse ? ' & ' + profile.spouse.name : ''} | ${profile.stateOfResidence} | ${assets.totalLiquid.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} liquid | retire ${profile.retirementYearDesired}`;
  console.log(`\n  \x1b[2mProfile: ${profileLine}\x1b[0m`);

  switch (command) {
    case 'scenarios':
    default:
      printScenarios(scenarios);
      break;

    case 'seasons': {
      const years = commandArg ? parseInt(commandArg, 10) : 30;
      printSeasons(retireStated.yearlyProjections, years);
      break;
    }

    case 'roth':
      printRoth(retireStated.yearlyProjections);
      break;

    case 'ss':
      printSS(getSSComparison(), profile);
      break;

    case 'opportunities':
      printOpportunities(getOpportunities());
      break;

    case 'contingency':
      printContingency(getContingency(), profile);
      break;

    case 'all':
      printScenarios(scenarios);
      printSeasons(retireStated.yearlyProjections, 20);
      printRoth(retireStated.yearlyProjections);
      printSS(getSSComparison(), profile);
      printOpportunities(getOpportunities());
      printContingency(getContingency(), profile);
      break;
  }
}

main();
