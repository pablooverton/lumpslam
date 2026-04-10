/**
 * CLI output formatters — pure Node.js, no dependencies.
 */

import type { ScenarioResult } from '../src/domain/types/scenarios';
import type { YearlyProjection, RetirementSeason } from '../src/domain/types/simulation';
import type { SocialSecurityComparison } from '../src/domain/types/social-security';
import type { OpportunityReport } from '../src/domain/types/opportunities';
import type { ContingencyReport } from '../src/domain/types/contingency';
import type { ClientProfile } from '../src/domain/types/profile';

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const B  = '\x1b[1m';   // bold
const DIM = '\x1b[2m';  // dim
const G  = '\x1b[32m';  // green
const R  = '\x1b[31m';  // red
const Y  = '\x1b[33m';  // yellow
const C  = '\x1b[36m';  // cyan
const W  = '\x1b[37m';  // white
const RS = '\x1b[0m';   // reset

// ─── Formatters ──────────────────────────────────────────────────────────────

function usd(n: number, compact = false): string {
  if (compact && Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (compact && Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function pad(s: string | number, width: number, right = false): string {
  const str = String(s);
  const padded = right ? str.padStart(width) : str.padEnd(width);
  return padded.slice(0, width);
}

// ─── Section header ──────────────────────────────────────────────────────────

export function header(title: string): void {
  const line = '─'.repeat(72);
  console.log(`\n${B}${C}${line}${RS}`);
  console.log(`${B}  ${title}${RS}`);
  console.log(`${C}${line}${RS}\n`);
}

export function subheader(title: string): void {
  console.log(`\n${B}${W}${title}${RS}`);
  console.log('─'.repeat(title.length));
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

export function printScenarios(scenarios: ScenarioResult[]): void {
  header('THREE BASELINE SCENARIOS');

  const cols = [
    { label: 'Retire Now',           s: scenarios[0] },
    { label: 'Target Retire Date',   s: scenarios[1] },
    { label: 'Work 3 More Years',    s: scenarios[2] },
  ];

  const W1 = 32;
  const W2 = 20;

  const row = (label: string, vals: string[], color = ''): void => {
    const l = pad(label, W1);
    const vs = vals.map((v) => `${color}${pad(v, W2, true)}${RS}`).join('');
    console.log(`  ${DIM}${l}${RS}${vs}`);
  };

  // Header row
  console.log(`  ${pad('', W1)}${cols.map((c) => `${B}${pad(c.label, W2, true)}${RS}`).join('')}`);
  console.log(`  ${pad('', W1)}${'─'.repeat(W2 * cols.length)}`);

  row('Retirement Year',       cols.map((c) => String(c.s.retirementYear)));
  row('Portfolio at Retirement', cols.map((c) => usd(c.s.yearlyProjections[0]?.portfolioStartBalance ?? 0, true)));
  row('Spending Capacity',     cols.map((c) => usd(c.s.spendingCapacity)));
  row('Desired Spending',      cols.map((c) => usd(c.s.desiredSpending)));

  // Surplus/deficit with colour
  console.log(
    `  ${DIM}${pad('Surplus / Deficit', W1)}${RS}` +
    cols.map((c) => {
      const pos = c.s.surplusOrDeficit >= 0;
      const color = pos ? G : R;
      const prefix = pos ? '+' : '';
      return `${color}${pad(prefix + usd(Math.abs(c.s.surplusOrDeficit)), W2, true)}${RS}`;
    }).join('')
  );

  // Probability with colour
  console.log(
    `  ${DIM}${pad('Probability of Success', W1)}${RS}` +
    cols.map((c) => {
      const p = c.s.probabilityOfSuccess;
      const color = p >= 0.90 ? G : p >= 0.70 ? Y : R;
      return `${color}${pad(pct(p), W2, true)}${RS}`;
    }).join('')
  );

  row('Lower Guardrail Drop',  cols.map((c) => usd(c.s.lowerGuardrailDollarDrop, true)));
  row('Monthly Cut at Trigger', cols.map((c) => `${usd(c.s.lowerGuardrailSpendingCutDollars)}/mo`));

  console.log();
}

// ─── Seasons ─────────────────────────────────────────────────────────────────

const SEASON_LABEL: Record<RetirementSeason, string> = {
  cobra:         'COBRA   ',
  aca:           'ACA     ',
  medicare:      'Medicare',
  rmd:           'RMD Era ',
  international: 'Intl    ',
};

const SEASON_COLOR: Record<RetirementSeason, string> = {
  cobra:         '\x1b[35m', // magenta
  aca:           '\x1b[34m', // blue
  medicare:      '\x1b[36m', // cyan
  rmd:           '\x1b[33m', // yellow
  international: '\x1b[95m', // bright magenta
};

export function printSeasons(projections: YearlyProjection[], years = 30): void {
  header('FOUR SEASONS — YEAR-BY-YEAR PROJECTION');

  const rows = projections.slice(0, years);

  const cols = [
    { h: 'Year',     w: 6,  rj: false },
    { h: 'Age',      w: 5,  rj: true  },
    { h: 'Season',   w: 10, rj: false },
    { h: 'SS Income',w: 11, rj: true  },
    { h: 'Roth Conv',w: 11, rj: true  },
    { h: 'Fed Tax',  w: 10, rj: true  },
    { h: 'Pretax Bal',w: 12, rj: true },
    { h: 'Roth Bal', w: 12, rj: true  },
    { h: 'Portfolio',w: 12, rj: true  },
  ];

  // Header
  const hdr = cols.map((c) => `${B}${pad(c.h, c.w, c.rj)}${RS}`).join(' ');
  console.log('  ' + hdr);
  console.log('  ' + '─'.repeat(cols.reduce((s, c) => s + c.w + 1, 0)));

  for (const p of rows) {
    const sc = SEASON_COLOR[p.season];
    const seasonStr = `${sc}${SEASON_LABEL[p.season]}${RS}`;
    const ssTotal = p.income.socialSecurityClient + p.income.socialSecuritySpouse;

    const cells = [
      pad(p.year,      cols[0].w, false),
      pad(p.clientAge, cols[1].w, true),
      seasonStr,
      ssTotal > 0
        ? `${G}${pad(usd(ssTotal, true), cols[3].w, true)}${RS}`
        : `${DIM}${pad('—', cols[3].w, true)}${RS}`,
      p.rothConversion
        ? `${G}${pad(usd(p.rothConversion.conversionAmount, true), cols[4].w, true)}${RS}`
        : `${DIM}${pad('—', cols[4].w, true)}${RS}`,
      pad(usd(p.taxLiability.totalFederalTax, true), cols[5].w, true),
      `\x1b[33m${pad(usd(p.pretaxEndBalance, true), cols[6].w, true)}${RS}`,
      `${G}${pad(usd(p.rothEndBalance, true), cols[7].w, true)}${RS}`,
      `${B}${pad(usd(p.portfolioEndBalance, true), cols[8].w, true)}${RS}`,
    ];

    // Re-join manually (season cell has ANSI codes that throw off padding)
    const line =
      cells[0] + ' ' + cells[1] + ' ' + cells[2] + ' ' +
      cells[3] + ' ' + cells[4] + ' ' + cells[5] + ' ' +
      cells[6] + ' ' + cells[7] + ' ' + cells[8];

    console.log('  ' + line);
  }

  console.log();
  console.log(`  ${DIM}Pretax Bal (amber) depletes via conversions. Roth Bal (green) accumulates.${RS}`);
  console.log(`  ${DIM}Showing first ${rows.length} years. Use: seasons <N> to change.${RS}\n`);
}

// ─── Roth ────────────────────────────────────────────────────────────────────

export function printRoth(projections: YearlyProjection[]): void {
  header('ROTH CONVERSION SCHEDULE');

  const convYears = projections.filter((p) => p.rothConversion !== null);

  if (convYears.length === 0) {
    console.log('  No Roth conversions projected in this scenario.\n');
    return;
  }

  const totalConverted = convYears.reduce((s, p) => s + (p.rothConversion?.conversionAmount ?? 0), 0);
  const totalTax       = convYears.reduce((s, p) => s + (p.rothConversion?.taxOnConversion ?? 0), 0);

  console.log(`  ${DIM}Two-event model: living expense withdrawal (Event 1) is in "Pretax" column.${RS}`);
  console.log(`  ${DIM}Event 2 shown here: surplus funds the conversion; tax paid from brokerage.${RS}\n`);

  const cols = [
    { h: 'Year',         w: 6,  rj: false },
    { h: 'Season',       w: 10, rj: false },
    { h: 'Converted',    w: 13, rj: true  },
    { h: 'Marg. Rate',   w: 12, rj: true  },
    { h: 'Conv. Tax',    w: 12, rj: true  },
    { h: 'Brok. Used',   w: 12, rj: true  },
  ];

  console.log('  ' + cols.map((c) => `${B}${pad(c.h, c.w, c.rj)}${RS}`).join(' '));
  console.log('  ' + '─'.repeat(cols.reduce((s, c) => s + c.w + 1, 0)));

  for (const p of convYears) {
    const r = p.rothConversion!;
    console.log(
      '  ' +
      pad(p.year,    6)  + ' ' +
      pad(p.season,  10) + ' ' +
      `${G}${pad(usd(r.conversionAmount), 13, true)}${RS}` + ' ' +
      pad(pct(r.marginalRate),            12, true)  + ' ' +
      `${Y}${pad(usd(r.taxOnConversion), 12, true)}${RS}` + ' ' +
      pad(usd(r.brokerageFundingAmount),  12, true)
    );
  }

  console.log('  ' + '─'.repeat(cols.reduce((s, c) => s + c.w + 1, 0)));
  console.log(
    '  ' + pad('TOTAL', 18) +
    `${G}${pad(usd(totalConverted), 13, true)}${RS}` +
    pad('', 13) +
    `${Y}${pad(usd(totalTax), 12, true)}${RS}`
  );
  console.log();
}

// ─── Social Security ─────────────────────────────────────────────────────────

export function printSS(comparison: SocialSecurityComparison, profile: ClientProfile): void {
  header('SOCIAL SECURITY CLAIMING ANALYSIS');

  const hasSpouse = profile.spouse !== null;

  const cols = [
    { h: 'Claim Age',        w: 11, rj: false },
    { h: 'Client/mo',        w: 12, rj: true  },
    ...(hasSpouse ? [{ h: 'Spouse/mo', w: 12, rj: true }] : []),
    { h: 'Lifetime (Client)',w: 18, rj: true  },
    { h: 'Combined',         w: 14, rj: true  },
  ];

  console.log('  ' + cols.map((c) => `${B}${pad(c.h, c.w, c.rj)}${RS}`).join(' '));
  console.log('  ' + '─'.repeat(cols.reduce((s, c) => s + c.w + 1, 0)));

  for (let i = 0; i < comparison.options.length; i++) {
    const opt = comparison.options[i];
    const isRec = i === comparison.recommendedOptionIndex;
    const marker = isRec ? `${G}→${RS}` : ' ';

    const cells = [
      pad(opt.label, 11),
      pad(usd(opt.clientMonthlyBenefit) + '/mo', 12, true),
      ...(hasSpouse ? [pad(usd(opt.spouseMonthlyBenefit ?? 0) + '/mo', 12, true)] : []),
      pad(usd(opt.lifetimeBenefitClient, true),   18, true),
      isRec
        ? `${G}${B}${pad(usd(opt.lifetimeBenefitCombined, true), 14, true)}${RS}`
        : pad(usd(opt.lifetimeBenefitCombined, true), 14, true),
    ];

    console.log(`  ${marker} ${cells.join(' ')}${isRec ? `  ${G}← Recommended${RS}` : ''}`);
  }

  const rec = comparison.options[comparison.recommendedOptionIndex];
  console.log();
  console.log(`  ${B}Recommended:${RS} ${G}${rec.label}${RS}`);
  console.log(`  Lifetime advantage vs. earliest: ${G}${B}${usd(comparison.lifetimeBenefitDifferenceVsEarliest)}${RS}`);
  console.log(`  ${DIM}${comparison.taxEfficiencyNote}${RS}\n`);
}

// ─── Opportunities ───────────────────────────────────────────────────────────

export function printOpportunities(report: OpportunityReport): void {
  header('OPTIMIZATION OPPORTUNITIES');

  console.log(
    `  ${report.applicableCount} of ${report.assessments.length} opportunities apply.` +
    (report.totalEstimatedLifetimeValue > 0
      ? `  ${G}Est. lifetime value: ${B}${usd(report.totalEstimatedLifetimeValue)}${RS}`
      : '')
  );
  console.log();

  for (const a of report.assessments) {
    const badge = a.applicable ? `${G}[✓ APPLICABLE]${RS}` : `${DIM}[  n/a      ]${RS}`;
    console.log(`  ${badge}  ${B}${a.label}${RS}`);
    console.log(`           ${DIM}${a.reason}${RS}`);
    if (a.estimatedLifetimeValue != null) {
      console.log(`           Est. lifetime value: ${G}${usd(a.estimatedLifetimeValue)}${RS}`);
    }
    console.log();
  }
}

// ─── Contingency ─────────────────────────────────────────────────────────────

export function printContingency(report: ContingencyReport, profile: ClientProfile): void {
  header('CONTINGENCY PLANNING');

  subheader('The Six Great Risks');
  console.log();

  const LIKELIHOOD_COLOR: Record<string, string> = { low: G, medium: Y, high: R };

  for (const risk of report.risks) {
    const lc = LIKELIHOOD_COLOR[risk.likelihood] ?? W;
    console.log(`  ${B}${risk.label}${RS}  ${lc}[${risk.likelihood} likelihood]${RS}`);
    console.log(`  ${DIM}${risk.mitigationStrategy}${RS}`);
    console.log(`  ${C}${risk.ifThenStatement}${RS}`);
    console.log();
  }

  subheader("Widow's Tax Penalty");
  console.log();

  for (const w of [report.widowsPenaltyClient, report.widowsPenaltySpouse].filter(Boolean)) {
    if (!w) continue;
    const survivor = w.survivingSpouse === 'client' ? profile.client.name : profile.spouse?.name ?? 'Spouse';
    const other    = w.survivingSpouse === 'client' ? profile.spouse?.name ?? 'Spouse' : profile.client.name;
    console.log(`  ${B}If ${other} passes first → ${survivor} survives${RS}`);
    console.log(`  SS income lost:          ${R}${usd(w.incomeLostFromSS)}/yr${RS}`);
    console.log(`  Income after loss:       ${usd(w.incomeAfterLoss)}/yr`);
    const coverColor = w.survivorCoveragePercent >= 0.9 ? G : Y;
    console.log(`  Survivor coverage:       ${coverColor}${pct(w.survivorCoveragePercent)}${RS}${w.canMaintainLifestyle ? ` ${G}(maintains lifestyle)${RS}` : ` ${Y}(may need adjustment)${RS}`}`);
    console.log(`  ${DIM}${w.singleFilerBracketNote}${RS}`);
    console.log();
  }
}
