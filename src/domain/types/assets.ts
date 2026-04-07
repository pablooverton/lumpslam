export type AccountType =
  | 'pretax_ira'
  | 'roth_ira'
  | 'brokerage'
  | 'inherited_ira'
  | 'hsa';

export interface Account {
  id: string;
  label: string;
  owner: 'client' | 'spouse' | 'joint';
  type: AccountType;
  currentBalance: number;
  costBasis?: number;               // brokerage only — portion that is return of basis
  isInherited?: boolean;
  inheritedIraRemainingYears?: number; // years left in 10-year rule
}

export interface AssetSnapshot {
  accounts: Account[];
  homeEquity: number;
  // derived totals — computed by deriveAssetTotals()
  totalPretax: number;
  totalRoth: number;
  totalBrokerage: number;
  totalInheritedIra: number;
  totalHsa: number;
  totalLiquid: number; // includes HSA
}

export function deriveAssetTotals(accounts: Account[], homeEquity: number): AssetSnapshot {
  const totalPretax = accounts
    .filter((a) => a.type === 'pretax_ira')
    .reduce((sum, a) => sum + a.currentBalance, 0);
  const totalRoth = accounts
    .filter((a) => a.type === 'roth_ira')
    .reduce((sum, a) => sum + a.currentBalance, 0);
  const totalBrokerage = accounts
    .filter((a) => a.type === 'brokerage')
    .reduce((sum, a) => sum + a.currentBalance, 0);
  const totalInheritedIra = accounts
    .filter((a) => a.type === 'inherited_ira')
    .reduce((sum, a) => sum + a.currentBalance, 0);
  const totalHsa = accounts
    .filter((a) => a.type === 'hsa')
    .reduce((sum, a) => sum + a.currentBalance, 0);
  const totalLiquid = totalPretax + totalRoth + totalBrokerage + totalInheritedIra + totalHsa;
  return { accounts, homeEquity, totalPretax, totalRoth, totalBrokerage, totalInheritedIra, totalHsa, totalLiquid };
}
