import type { OpportunityAssessment, OpportunityReport } from '../types/opportunities';
import type { ClientProfile } from '../types/profile';
import type { AssetSnapshot } from '../types/assets';
import type { YearlyProjection } from '../types/simulation';
import { ACA_MAGI_CLIFF_2025, ACA_ESTIMATED_ANNUAL_SAVINGS_COUPLE } from '../constants/aca-thresholds';
import { IRMAA_BRACKETS_2025, FEDERAL_INCOME_TAX_BRACKETS_2025, getBracketCeiling } from '../constants/tax-brackets';

export function assessOpportunities(
  profile: ClientProfile,
  assets: AssetSnapshot,
  projections: YearlyProjection[]
): OpportunityReport {
  const assessments: OpportunityAssessment[] = [
    assessFivePercentPrecondition(assets),
    assessAcaSubsidies(profile, projections),
    assessCobraBrokeragePreservation(assets, projections),
    assessRothAsAcaBridge(assets, projections),
    assessConversionTreadmill(profile, assets, projections),
    assessSuperchargeIrmaaTier2(profile, assets, projections),
    assessMicroRothConversions(profile, assets, projections),
    assessConcentratedStock(assets),
    assessCostBasisReset(assets, projections),
    assessDonorAdvisedFund(assets),
    assessQualifiedCharitableDistributions(profile, projections),
  ];

  const applicable = assessments.filter((a) => a.applicable);
  const totalEstimatedLifetimeValue = applicable.reduce(
    (sum, a) => sum + (a.estimatedLifetimeValue ?? 0),
    0
  );

  return {
    assessments,
    applicableCount: applicable.length,
    totalEstimatedLifetimeValue,
  };
}

function assessAcaSubsidies(
  profile: ClientProfile,
  projections: YearlyProjection[]
): OpportunityAssessment {
  const acaYears = projections.filter((p) => p.season === 'aca');
  const anyEligible = acaYears.some((p) => p.acaSubsidyEligible);
  const yearsEligible = acaYears.filter((p) => p.acaSubsidyEligible).length;

  return {
    id: 'aca_subsidies',
    label: 'ACA Healthcare Subsidies',
    applicable: anyEligible,
    reason: anyEligible
      ? `MAGI can be managed below $${ACA_MAGI_CLIFF_2025.toLocaleString()} during the ACA window by drawing from the brokerage account.`
      : 'Income is projected to exceed the ACA subsidy cliff.',
    estimatedAnnualValue: anyEligible ? ACA_ESTIMATED_ANNUAL_SAVINGS_COUPLE : null,
    estimatedLifetimeValue: anyEligible ? ACA_ESTIMATED_ANNUAL_SAVINGS_COUPLE * yearsEligible : null,
  };
}

function assessMicroRothConversions(
  profile: ClientProfile,
  assets: AssetSnapshot,
  projections: YearlyProjection[]
): OpportunityAssessment {
  const applicable = assets.totalPretax > 500_000;
  const totalConverted = projections.reduce(
    (sum, p) => sum + (p.rothConversion?.conversionAmount ?? 0),
    0
  );

  return {
    id: 'micro_roth_conversions',
    label: 'Micro Roth Conversions',
    applicable,
    reason: applicable
      ? `$${assets.totalPretax.toLocaleString()} in pre-tax accounts creates RMD risk. Conversions during low-income years reduce the future tax torpedo.`
      : 'Pre-tax balances are below threshold where Roth conversions provide meaningful benefit.',
    estimatedAnnualValue: null, // complex to estimate without full projection
    estimatedLifetimeValue: applicable ? totalConverted * 0.10 : null, // rough tax savings estimate
  };
}

function assessConcentratedStock(assets: AssetSnapshot): OpportunityAssessment {
  // Check if any brokerage account has a very low cost basis (concentrated position)
  const brokerageAccounts = assets.accounts.filter((a) => a.type === 'brokerage');
  const hasConcentratedPosition = brokerageAccounts.some(
    (a) => a.costBasis !== undefined && a.currentBalance > 0 && (a.costBasis / a.currentBalance) < 0.25
  );

  return {
    id: 'concentrated_stock',
    label: 'Concentrated Stock Position Rebalancing',
    applicable: hasConcentratedPosition,
    reason: hasConcentratedPosition
      ? 'Low-cost-basis brokerage positions create capital gains risk. Tax-loss harvesting or strategic rebalancing may help.'
      : 'No concentrated stock positions identified.',
    estimatedAnnualValue: null,
    estimatedLifetimeValue: null,
  };
}

function assessCostBasisReset(
  assets: AssetSnapshot,
  projections: YearlyProjection[]
): OpportunityAssessment {
  // Cost basis reset is beneficial during 0% LTCG years (low income years)
  const zeroGainYears = projections.filter((p) => p.magi < 96_700 && p.season === 'aca').length;
  const applicable = zeroGainYears > 0 && assets.totalBrokerage > 0;

  return {
    id: 'cost_basis_reset',
    label: 'Cost Basis Reset (Tax-Gain Harvesting)',
    applicable,
    reason: applicable
      ? `${zeroGainYears} projected years with MAGI below the 0% LTCG threshold — selling and rebuying appreciated shares resets basis tax-free.`
      : 'Income is projected too high to benefit from 0% long-term capital gains rate.',
    estimatedAnnualValue: null,
    estimatedLifetimeValue: null,
  };
}

function assessDonorAdvisedFund(assets: AssetSnapshot): OpportunityAssessment {
  // DAF is most powerful when you have appreciated brokerage assets AND charitable intent.
  // Donating the shares directly avoids capital gains tax on the appreciation AND gets a
  // deduction at full fair market value — double benefit vs. selling and donating cash.
  const brokerageAccounts = assets.accounts.filter((a) => a.type === 'brokerage');
  const hasAppreciatedAssets = brokerageAccounts.some(
    (a) => a.costBasis !== undefined && a.currentBalance > 0 && a.costBasis < a.currentBalance * 0.80
  );
  return {
    id: 'donor_advised_fund',
    label: 'Donor-Advised Fund (DAF)',
    applicable: hasAppreciatedAssets,
    reason: hasAppreciatedAssets
      ? 'You have appreciated brokerage positions. Donating shares directly to a DAF avoids capital gains tax on the gain and earns a deduction at full market value — more efficient than selling first and donating cash.'
      : 'No significantly appreciated brokerage positions found. DAF benefit is highest when donating low-basis shares.',
    estimatedAnnualValue: null,
    estimatedLifetimeValue: null,
  };
}

function assessQualifiedCharitableDistributions(
  profile: ClientProfile,
  projections: YearlyProjection[]
): OpportunityAssessment {
  // QCDs are only available from IRAs at age 70½+
  const clientAge = profile.client.age;
  const applicable = clientAge >= 70 || projections.some((p) => p.clientAge >= 70);

  return {
    id: 'qualified_charitable_distributions',
    label: 'Qualified Charitable Distributions (QCDs)',
    applicable,
    reason: applicable
      ? 'QCDs allow up to $105,000/year directly from IRA to charity, excluded from MAGI — highly effective during RMD years.'
      : 'QCDs require the account owner to be age 70½ or older.',
    estimatedAnnualValue: null,
    estimatedLifetimeValue: null,
  };
}

// ── Video-informed opportunities ────────────────────────────────────────────
// The five assessments below encode lessons from "Retire Tomorrow" (5 milestones) and
// "Tax Strategies by IRA/401k Balance" (supercharge strategy, balance-dependent sequencing).

// Precondition check: without ≥5% of savings outside pre-tax, MAGI-management strategies
// collapse. There's no brokerage (or Roth) to fund the ACA-cliff preservation or to pay
// conversion tax. A profile below this threshold needs a different playbook entirely.
function assessFivePercentPrecondition(assets: AssetSnapshot): OpportunityAssessment {
  const total = assets.totalLiquid;
  const outsidePretax = assets.totalRoth + assets.totalBrokerage + assets.totalHsa;
  const ratio = total > 0 ? outsidePretax / total : 0;
  const belowThreshold = ratio < 0.05;
  return {
    id: 'five_percent_precondition',
    label: 'Non-Pretax Buffer ≥ 5%',
    applicable: belowThreshold,
    reason: belowThreshold
      ? `Only ${(ratio * 100).toFixed(1)}% of savings is outside pre-tax accounts. MAGI-management strategies (ACA cliff, IRMAA tiering, tax-free conversion funding) collapse below the 5% threshold — the lever disappears. Priority shifts to building outside-pretax bandwidth before retirement.`
      : `${(ratio * 100).toFixed(1)}% of savings sits outside pre-tax — enough headroom to run MAGI-management strategies effectively.`,
    estimatedAnnualValue: null,
    estimatedLifetimeValue: null,
  };
}

// Brokerage preservation during COBRA: in a partial W-2 year (COBRA) the household already has
// wage income, so the ACA subsidy isn't accessible yet. Burning brokerage for non-essential
// spending here strips the one MAGI-control lever that funds ACA-cliff management in the next
// 2-10 years. The video calls this the single biggest mistake at the $1M balance level.
function assessCobraBrokeragePreservation(
  assets: AssetSnapshot,
  projections: YearlyProjection[]
): OpportunityAssessment {
  const acaYears = projections.filter((p) => p.season === 'aca');
  if (acaYears.length === 0 || assets.totalBrokerage <= 0) {
    return {
      id: 'cobra_brokerage_preservation',
      label: 'Preserve Brokerage Through COBRA',
      applicable: false,
      reason: 'No ACA window in this projection, or no brokerage to preserve — pattern does not apply.',
      estimatedAnnualValue: null,
      estimatedLifetimeValue: null,
    };
  }
  // Approximate the annual MAGI gap the brokerage would need to close during ACA years.
  const annualSubsidyGap = ACA_ESTIMATED_ANNUAL_SAVINGS_COUPLE;
  // Rough: assume ~$30-50k/yr of brokerage is consumed to keep MAGI below cliff.
  const projectedBrokerageNeedPerYear = 40_000;
  const neededThroughAcaWindow = projectedBrokerageNeedPerYear * acaYears.length;
  const shortfall = neededThroughAcaWindow - assets.totalBrokerage;
  const applicable = shortfall > 0;
  return {
    id: 'cobra_brokerage_preservation',
    label: 'Preserve Brokerage Through COBRA',
    applicable,
    reason: applicable
      ? `Brokerage ($${assets.totalBrokerage.toLocaleString()}) is projected short of the ~$${neededThroughAcaWindow.toLocaleString()} of MAGI-control room needed across ${acaYears.length} ACA years. Conventional "spend taxable first" during COBRA strips this lever — during a partial-W-2 year, fund spending from pre-tax (already in the bracket) and hold brokerage for the upcoming ACA window.`
      : 'Brokerage balance appears sufficient to sustain MAGI management through the projected ACA window.',
    estimatedAnnualValue: annualSubsidyGap,
    estimatedLifetimeValue: annualSubsidyGap * acaYears.length,
  };
}

// Roth as ACA bridge: Roth withdrawals are MAGI-invisible. If a projection has an ACA window
// AND a Roth balance, Roth can fund spending without touching the cliff — a better sequence
// than pretax when the household is on subsidies. Quantifies the subsidy value preserved.
function assessRothAsAcaBridge(
  assets: AssetSnapshot,
  projections: YearlyProjection[]
): OpportunityAssessment {
  const acaYears = projections.filter((p) => p.season === 'aca');
  const eligibleAcaYears = acaYears.filter((p) => p.acaSubsidyEligible);
  const hasRoth = assets.totalRoth > 0;
  const applicable = acaYears.length > 0 && hasRoth;
  return {
    id: 'roth_as_aca_bridge',
    label: 'Roth as ACA-Cliff Bridge',
    applicable,
    reason: applicable
      ? `Roth balance ($${assets.totalRoth.toLocaleString()}) is MAGI-invisible — withdrawing it during the ${acaYears.length}-year ACA window does not count against the $${ACA_MAGI_CLIFF_2025.toLocaleString()} cliff. Treating Roth as "last-resort" is the wrong default pre-65; it is the most efficient cliff-preservation tool when brokerage basis is thin.`
      : 'No ACA window or no Roth balance — pattern does not apply.',
    estimatedAnnualValue: eligibleAcaYears.length > 0 ? ACA_ESTIMATED_ANNUAL_SAVINGS_COUPLE : null,
    estimatedLifetimeValue: eligibleAcaYears.length > 0
      ? ACA_ESTIMATED_ANNUAL_SAVINGS_COUPLE * eligibleAcaYears.length
      : null,
  };
}

// Treadmill check: if the pre-tax balance grows faster than the planned conversion rate, the
// conversion strategy is fighting compound growth and RMDs will be large anyway. Flag the gap
// between current conversion rate and portfolio growth rate — a signal that the target bracket
// may need to move up (24% or 32%) to actually drain pre-tax before age 73.
function assessConversionTreadmill(
  profile: ClientProfile,
  assets: AssetSnapshot,
  projections: YearlyProjection[]
): OpportunityAssessment {
  const growthRate = profile.annualGrowthRate ?? 0.08;
  // Average annual conversion across the projection (Roth conversion events only).
  const conversionYears = projections.filter((p) => (p.rothConversion?.conversionAmount ?? 0) > 0);
  if (conversionYears.length === 0 || assets.totalPretax <= 0) {
    return {
      id: 'conversion_treadmill',
      label: 'Conversion Treadmill Check',
      applicable: false,
      reason: 'No active Roth conversions in this projection, or no pre-tax balance — treadmill check does not apply.',
      estimatedAnnualValue: null,
      estimatedLifetimeValue: null,
    };
  }
  const avgConversion =
    conversionYears.reduce((sum, p) => sum + (p.rothConversion!.conversionAmount), 0) /
    conversionYears.length;
  const annualGrowthDollars = assets.totalPretax * growthRate;
  const treadmill = avgConversion < annualGrowthDollars;
  // Roughly estimate the RMD tax savings from pushing up to 24% bracket instead of 22%:
  // incremental conversion room ~= (24% ceiling − 22% ceiling) for MFJ ≈ $188k/yr.
  const b24 = getBracketCeiling('24%', profile.filingStatus, FEDERAL_INCOME_TAX_BRACKETS_2025);
  const b22 = getBracketCeiling('22%', profile.filingStatus, FEDERAL_INCOME_TAX_BRACKETS_2025);
  const additionalAnnualConversion = Math.max(0, b24 - b22);
  // Tax cost today vs. deferred RMD tax (typically ~24% vs. ~32% if RMDs swell to $300k+):
  // ballpark 8% of the additional conversion as lifetime tax savings per year.
  const estLifetimeSavings = treadmill ? additionalAnnualConversion * 0.08 * conversionYears.length : 0;
  return {
    id: 'conversion_treadmill',
    label: 'Conversion Treadmill Check',
    applicable: treadmill,
    reason: treadmill
      ? `Pre-tax is growing ~$${Math.round(annualGrowthDollars).toLocaleString()}/yr while conversions only move ~$${Math.round(avgConversion).toLocaleString()}/yr. At this rate the pre-tax balance won't meaningfully shrink before age 73, and RMDs will still be sized to push you into high brackets. Consider raising target bracket to 24% to actually drain the account.`
      : `Conversions (~$${Math.round(avgConversion).toLocaleString()}/yr) are outpacing pre-tax growth (~$${Math.round(annualGrowthDollars).toLocaleString()}/yr) — the balance is genuinely shrinking over time.`,
    estimatedAnnualValue: null,
    estimatedLifetimeValue: treadmill ? estLifetimeSavings : null,
  };
}

// Supercharge analysis: at high pre-tax balances ($3M+), stopping conversions at IRMAA Tier 1
// is often suboptimal. Pushing through to Tier 2 buys ~$120k/yr of additional conversion room
// at a cost of ~$5,770/yr in IRMAA surcharges per person. The video's math: ~4:1 benefit ratio
// over 5 years. This assessment flags when the profile fits and estimates the net value.
function assessSuperchargeIrmaaTier2(
  profile: ClientProfile,
  assets: AssetSnapshot,
  projections: YearlyProjection[]
): OpportunityAssessment {
  const highBalance = assets.totalPretax >= 3_000_000;
  const medicareYears = projections.filter((p) => p.season === 'medicare');
  const goldenWindowYears = medicareYears.filter(
    (p) => p.income.socialSecurityClient + p.income.socialSecuritySpouse === 0
  );
  const applicable = highBalance && goldenWindowYears.length >= 2;

  const tier1 = IRMAA_BRACKETS_2025[1];
  const tier2 = IRMAA_BRACKETS_2025[2];
  const tier3 = IRMAA_BRACKETS_2025[3];
  // Willingness to pay Tier 2 surcharge unlocks MAGI room from Tier 1 floor all the way to
  // Tier 3 floor (the top of Tier 2). That's the full conversion room unlocked — not just
  // the width between Tier 1 and Tier 2 floors.
  const tier2Room =
    profile.filingStatus === 'married_filing_jointly'
      ? tier3.magiFloorMFJ - tier1.magiFloorMFJ
      : tier3.magiFloorSingle - tier1.magiFloorSingle;
  const tier2SurchargeAnnual =
    (tier2.partBSurchargePerPerson + tier2.partDSurchargePerPerson) *
    (profile.filingStatus === 'married_filing_jointly' ? 2 : 1) *
    12;

  // Extra conversion room above Tier 1 × assumed 8-percentage-point future RMD-tax savings
  // (22-24% now vs. 30-32% future marginal rate at $300k+ RMDs) minus surcharge cost.
  const annualExtraConversion = tier2Room; // ~$122k for MFJ
  const perYearNetBenefit = annualExtraConversion * 0.08 - tier2SurchargeAnnual;
  const lifetimeNetBenefit = applicable ? perYearNetBenefit * goldenWindowYears.length : 0;

  return {
    id: 'supercharge_irmaa_tier2',
    label: 'Supercharge Conversions Through IRMAA Tier 2',
    applicable,
    reason: applicable
      ? `At $${(assets.totalPretax / 1_000_000).toFixed(1)}M pre-tax with ${goldenWindowYears.length} Medicare-golden-window years (pre-SS), conversion room up to IRMAA Tier 1 is insufficient to meaningfully drain pre-tax. Extending to Tier 2 unlocks ~$${annualExtraConversion.toLocaleString()}/yr of additional conversion room at a cost of ~$${Math.round(tier2SurchargeAnnual).toLocaleString()}/yr in surcharges. Net benefit over the golden window: ~$${Math.round(lifetimeNetBenefit).toLocaleString()}.`
      : highBalance
        ? 'High pre-tax balance but insufficient golden-window years (retire-to-SS gap) to make the supercharge worth the IRMAA cost.'
        : 'Pre-tax balance below the ~$3M threshold where pushing past Tier 1 IRMAA consistently beats staying conservative.',
    estimatedAnnualValue: applicable ? perYearNetBenefit : null,
    estimatedLifetimeValue: applicable ? lifetimeNetBenefit : null,
  };
}
