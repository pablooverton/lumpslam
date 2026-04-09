import type { OpportunityAssessment, OpportunityReport } from '../types/opportunities';
import type { ClientProfile } from '../types/profile';
import type { AssetSnapshot } from '../types/assets';
import type { YearlyProjection } from '../types/simulation';
import { ACA_MAGI_CLIFF_2025, ACA_ESTIMATED_ANNUAL_SAVINGS_COUPLE } from '../constants/aca-thresholds';

export function assessOpportunities(
  profile: ClientProfile,
  assets: AssetSnapshot,
  projections: YearlyProjection[]
): OpportunityReport {
  const assessments: OpportunityAssessment[] = [
    assessAcaSubsidies(profile, projections),
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
