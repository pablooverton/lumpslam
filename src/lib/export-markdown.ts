import type { ClientProfile } from '@/domain/types/profile';
import type { AssetSnapshot, Account } from '@/domain/types/assets';
import type { SpendingProfile } from '@/domain/types/spending';
import type { ScenarioResult } from '@/domain/types/scenarios';
import type { SocialSecurityComparison } from '@/domain/types/social-security';
import type { OpportunityReport } from '@/domain/types/opportunities';
import { formatCurrency, formatPercent } from '@/lib/format';

function cur(n: number) {
  return formatCurrency(n);
}

function pct(n: number) {
  return formatPercent(n);
}

const SEASON_LABEL: Record<string, string> = {
  cobra: 'COBRA',
  aca: 'ACA',
  medicare: 'Medicare',
  rmd: 'RMD Era',
};

export function buildMarkdownExport(params: {
  profile: ClientProfile;
  assets: AssetSnapshot;
  spending: SpendingProfile;
  accounts: Account[];
  scenarios: ScenarioResult[];
  ssComparison: SocialSecurityComparison | null;
  opportunities: OpportunityReport | null;
}): string {
  const { profile, assets, spending, accounts, scenarios, ssComparison, opportunities } = params;
  const retireNow = scenarios.find((s) => s.scenarioType === 'retire_now');
  const retireStated = scenarios.find((s) => s.scenarioType === 'retire_at_stated_date');
  const noChange = scenarios.find((s) => s.scenarioType === 'no_change');

  const lines: string[] = [];
  const exportDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // ── Header ────────────────────────────────────────────────────────────────
  const names = profile.spouse
    ? `${profile.client.name} & ${profile.spouse.name}`
    : profile.client.name;
  lines.push(`# Lump Slam — ${names}`);
  lines.push(`> Exported ${exportDate}`);
  lines.push('');

  // ── Profile ───────────────────────────────────────────────────────────────
  lines.push('## Profile');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Client | ${profile.client.name}, age ${profile.client.age} |`);
  if (profile.spouse) {
    lines.push(`| Spouse | ${profile.spouse.name}, age ${profile.spouse.age} |`);
  }
  lines.push(`| Filing Status | ${profile.filingStatus === 'married_filing_jointly' ? 'Married Filing Jointly' : 'Single'} |`);
  lines.push(`| State | ${profile.stateOfResidence}${profile.hasStateIncomeTax ? '' : ' (no income tax)'} |`);
  lines.push(`| Current Year | ${profile.currentYear} |`);
  lines.push(`| Target Retirement Year | ${profile.retirementYearDesired ?? profile.currentYear} |`);
  lines.push(`| Retirement Location | ${profile.retirementLocation === 'international' ? 'International (no ACA cliff)' : 'US'} |`);
  lines.push(`| COBRA Months | ${profile.cobraMonths} |`);
  lines.push(`| ACA Household Size | ${profile.acaHouseholdSize ?? 2} |`);
  lines.push(`| Annual Growth Rate | ${((profile.annualGrowthRate ?? 0.07) * 100).toFixed(1)}% nominal |`);
  if (profile.targetAnnualConversion) {
    lines.push(`| Target Annual Roth Conversion | ${cur(profile.targetAnnualConversion)} |`);
  }
  lines.push(`| Spending Engine | ${profile.spendingEngine ?? 'auto'} |`);
  lines.push('');

  // SS claim ages
  lines.push('### Social Security');
  lines.push('');
  lines.push('| Person | FRA | FRA Monthly Benefit | Claim Age |');
  lines.push('|--------|-----|---------------------|-----------|');
  lines.push(`| ${profile.client.name} | ${profile.client.fullRetirementAge} | ${cur(profile.client.fraMonthlyBenefit * 12)}/yr | ${profile.client.socialSecurityClaimAge} |`);
  if (profile.spouse) {
    lines.push(`| ${profile.spouse.name} | ${profile.spouse.fullRetirementAge} | ${cur(profile.spouse.fraMonthlyBenefit * 12)}/yr | ${profile.spouse.socialSecurityClaimAge} |`);
  }
  lines.push('');

  // ── Accounts ──────────────────────────────────────────────────────────────
  lines.push('## Accounts & Assets');
  lines.push('');
  lines.push('| Account | Owner | Type | Balance |');
  lines.push('|---------|-------|------|---------|');
  for (const a of accounts) {
    lines.push(`| ${a.label} | ${a.owner} | ${a.type} | ${cur(a.currentBalance)} |`);
  }
  lines.push('');
  lines.push('| | |');
  lines.push('|-|-|');
  lines.push(`| **Total Liquid** | **${cur(assets.totalLiquid)}** |`);
  lines.push(`| Pre-tax | ${cur(assets.totalPretax)} |`);
  lines.push(`| Roth | ${cur(assets.totalRoth)} |`);
  lines.push(`| Brokerage | ${cur(assets.totalBrokerage)} |`);
  if (assets.totalHsa > 0) {
    lines.push(`| HSA | ${cur(assets.totalHsa)} |`);
  }
  lines.push('');

  // ── Spending ──────────────────────────────────────────────────────────────
  lines.push('## Spending');
  lines.push('');
  lines.push('| Category | Annual Amount |');
  lines.push('|----------|---------------|');
  lines.push(`| Essential (base) | ${cur(spending.baseAnnualSpending)} |`);
  lines.push(`| Lifestyle — active years | ${cur(spending.travelBudgetEarly)} |`);
  lines.push(`| Lifestyle — slower years (after age ${spending.travelTaperStartAge}) | ${cur(spending.travelBudgetLate)} |`);
  lines.push(`| Charitable giving | ${cur(spending.charitableGivingAnnual)} |`);
  if (spending.annualHealthcareCost && spending.annualHealthcareCost > 0) {
    lines.push(`| Healthcare (from HSA) | ${cur(spending.annualHealthcareCost)} |`);
  }
  if (spending.mortgageAnnualPayment && spending.mortgageAnnualPayment > 0) {
    lines.push(`| Mortgage P&I | ${cur(spending.mortgageAnnualPayment)} (paid off age ${spending.mortgagePaidOffAge ?? '?'}) |`);
  }
  lines.push(`| Inflation Rate | ${pct(spending.inflationRate)} |`);
  if (spending.oneTimeExpenses.length > 0) {
    lines.push('');
    lines.push('**One-time expenses:**');
    for (const e of spending.oneTimeExpenses) {
      lines.push(`- ${e.year}: ${e.label} — ${cur(e.amount)}`);
    }
  }
  lines.push('');

  // ── Scenarios ─────────────────────────────────────────────────────────────
  lines.push('## Scenarios');
  lines.push('');
  const scenarioList = [
    ['Retire Now', retireNow],
    ['Target Retire Date', retireStated],
    ['Status Quo', noChange],
  ] as const;

  lines.push('| | Retire Now | Target Retire Date | Status Quo |');
  lines.push('|-|-----------|-------------------|------------|');

  function row(label: string, fn: (s: ScenarioResult) => string) {
    const cols = scenarioList.map(([, s]) => (s ? fn(s) : '—'));
    lines.push(`| ${label} | ${cols.join(' | ')} |`);
  }

  row('Retirement Year', (s) => String(s.retirementYear));
  row('Spending Capacity', (s) => cur(s.spendingCapacity));
  row('Desired Spending', (s) => cur(s.desiredSpending));
  row('Surplus / Deficit', (s) => `${s.surplusOrDeficit >= 0 ? '+' : ''}${cur(s.surplusOrDeficit)}`);
  row('Probability of Success', (s) => pct(s.probabilityOfSuccess));
  row('Lower Guardrail Drop', (s) => cur(s.lowerGuardrailDollarDrop));
  row('Monthly Cut at Trigger', (s) => `${cur(s.lowerGuardrailSpendingCutDollars)}/mo`);
  lines.push('');

  // ── Four Seasons ──────────────────────────────────────────────────────────
  if (retireNow && retireNow.yearlyProjections.length > 0) {
    lines.push('## Four Seasons — Year-by-Year Projection');
    lines.push('');
    lines.push('| Year | Age | Season | MAGI | ACA Eligible | From Pretax | From Brokerage | Roth Conv | Fed Tax | Portfolio End |');
    lines.push('|------|-----|--------|------|:------------:|-------------|----------------|-----------|---------|---------------|');
    for (const p of retireNow.yearlyProjections) {
      lines.push(
        `| ${p.year} | ${p.clientAge} | ${SEASON_LABEL[p.season] ?? p.season} | ${cur(p.magi)} | ${p.acaSubsidyEligible ? 'Yes' : '—'} | ${cur(p.withdrawals.fromPretax)} | ${cur(p.withdrawals.fromBrokerage)} | ${p.rothConversion ? cur(p.rothConversion.conversionAmount) : '—'} | ${cur(p.taxLiability.totalFederalTax)} | ${cur(p.portfolioEndBalance)} |`
      );
    }
    lines.push('');
  }

  // ── Roth Conversions ──────────────────────────────────────────────────────
  if (retireNow) {
    const conversionYears = retireNow.yearlyProjections.filter((p) => p.rothConversion !== null);
    if (conversionYears.length > 0) {
      const totalConverted = conversionYears.reduce((s, p) => s + (p.rothConversion?.conversionAmount ?? 0), 0);
      const totalTax = conversionYears.reduce((s, p) => s + (p.rothConversion?.taxOnConversion ?? 0), 0);

      lines.push('## Roth Conversion Schedule');
      lines.push('');
      lines.push(`Total converted: **${cur(totalConverted)}** over ${conversionYears.length} years | Total tax paid: **${cur(totalTax)}**`);
      lines.push('');
      lines.push('| Year | Season | Converted | Marginal Rate | Conv Tax | Brokerage Used |');
      lines.push('|------|--------|-----------|---------------|----------|----------------|');
      for (const p of conversionYears) {
        const rc = p.rothConversion!;
        lines.push(
          `| ${p.year} | ${p.season} | ${cur(rc.conversionAmount)} | ${pct(rc.marginalRate)} | ${cur(rc.taxOnConversion)} | ${cur(rc.brokerageFundingAmount)} |`
        );
      }
      lines.push('');
    }
  }

  // ── Social Security ───────────────────────────────────────────────────────
  if (ssComparison) {
    const rec = ssComparison.options[ssComparison.recommendedOptionIndex];
    lines.push('## Social Security Analysis');
    lines.push('');
    lines.push(`Recommended: claim at **age ${rec.clientClaimAge}** — lifetime advantage vs earliest: **${cur(ssComparison.lifetimeBenefitDifferenceVsEarliest)}**`);
    lines.push('');
    lines.push('| Claim Age | Client/mo | Spouse/mo | Client Lifetime | Combined |');
    lines.push('|-----------|-----------|-----------|-----------------|----------|');
    for (const opt of ssComparison.options) {
      const isRec = opt === rec;
      lines.push(
        `| ${isRec ? '**' : ''}${opt.clientClaimAge}${isRec ? ' ★**' : ''} | ${cur(opt.clientMonthlyBenefit)}/mo | ${opt.spouseMonthlyBenefit ? cur(opt.spouseMonthlyBenefit) + '/mo' : '—'} | ${cur(opt.lifetimeBenefitClient)} | ${cur(opt.lifetimeBenefitCombined)} |`
      );
    }
    lines.push('');
    if (ssComparison.taxEfficiencyNote) {
      lines.push(`> ${ssComparison.taxEfficiencyNote}`);
      lines.push('');
    }
  }

  // ── Opportunities ─────────────────────────────────────────────────────────
  if (opportunities) {
    lines.push('## Optimization Opportunities');
    lines.push('');
    lines.push(`${opportunities.applicableCount} of ${opportunities.assessments.length} opportunities apply. Est. lifetime value: **${cur(opportunities.totalEstimatedLifetimeValue)}**`);
    lines.push('');
    for (const o of opportunities.assessments) {
      const badge = o.applicable ? '✓ Applicable' : 'N/A';
      lines.push(`**${badge}: ${o.label}**`);
      lines.push(`${o.reason}`);
      if (o.estimatedLifetimeValue) {
        lines.push(`Est. lifetime value: ${cur(o.estimatedLifetimeValue)}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
