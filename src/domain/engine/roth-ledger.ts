// Roth accessibility ledger — pre-59½ realism.
//
// Before 59½, Roth dollars are not freely spendable. IRS ordering rules for Roth IRA
// distributions: (1) contribution basis — anytime, tax- and penalty-free; (2) conversion
// principal, FIFO by conversion year — each conversion carries a 5-tax-year clock, and the
// 10% recapture penalty applies to the conversion's *taxable* portion when drawn unseasoned
// pre-59½ (no income tax — it was taxed at conversion); (3) earnings — pre-59½ draws are
// ordinary income + 10% penalty (post-59½ they are free, assuming the account's own 5-year
// clock is met, which this engine assumes).
//
// Modeling conventions (documented in pre59-access-audit-2026-06):
// - Household Roth accounts are pooled; penalty gating uses the OLDER spouse's age (draw
//   from the older spouse's accounts first — standard practice).
// - `annualContributions.roth` / savings-strategy Roth buckets are contribution basis. This
//   treats Roth-401k electives as IRA basis from day one; in reality they become basis at
//   the separation rollover, but the engine never draws Roth during working years, so the
//   timing is equivalent. Backdoor Roth conversions (~100% nontaxable) carry no recapture
//   penalty and are equivalent to basis — also folded into contributions.
// - Engine conversions (pretax → Roth) are fully taxable at conversion, so a whole lot is
//   penalty-bearing while unseasoned.
// - Market losses do not shrink basis (IRS basis is contribution dollars, not value). A
//   draw is bounded by the account balance by the caller; ledger entries persist until
//   consumed by draws.

export interface ConversionLot {
  /** Calendar year of the conversion. Seasoned when currentYear − year ≥ 5 (5-tax-year clock). */
  year: number;
  amount: number;
}

export interface RothLedger {
  /** Withdrawable-anytime contribution basis (direct + backdoor + elective-at-rollover). */
  contributionBasis: number;
  /** Conversion principal lots, FIFO. */
  lots: ConversionLot[];
}

export interface RothDrawComposition {
  fromContributions: number;
  fromSeasonedConversions: number;
  /** Penalty-bearing pre-59½: 10% recapture on the taxable-at-conversion portion (= whole lot here). */
  fromUnseasonedConversions: number;
  /** Pre-59½: ordinary income + 10% penalty. Post-59½: free. */
  fromEarnings: number;
}

export function createRothLedger(contributionBasis: number): RothLedger {
  return { contributionBasis: Math.max(0, contributionBasis), lots: [] };
}

export function addContribution(ledger: RothLedger, amount: number): void {
  ledger.contributionBasis += Math.max(0, amount);
}

export function addConversionLot(ledger: RothLedger, year: number, amount: number): void {
  if (amount <= 0) return;
  ledger.lots.push({ year, amount });
}

export function isLotSeasoned(lot: ConversionLot, currentYear: number): boolean {
  return currentYear - lot.year >= 5;
}

/**
 * Consume `amount` from the ledger in IRS order: contributions → seasoned conversions
 * (FIFO) → unseasoned conversions (FIFO) → earnings (the residual beyond tracked basis).
 * Mutates the ledger. The caller is responsible for bounding `amount` by the actual Roth
 * balance — earnings here are simply whatever the tracked basis cannot explain.
 */
export function drawFromRoth(
  ledger: RothLedger,
  amount: number,
  currentYear: number
): RothDrawComposition {
  let remaining = Math.max(0, amount);

  const fromContributions = Math.min(remaining, ledger.contributionBasis);
  ledger.contributionBasis -= fromContributions;
  remaining -= fromContributions;

  let fromSeasonedConversions = 0;
  let fromUnseasonedConversions = 0;
  // Lots are consumed FIFO regardless of seasoning (IRS: oldest conversion first); the
  // seasoning split only determines penalty treatment.
  for (const lot of ledger.lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.amount);
    lot.amount -= take;
    remaining -= take;
    if (isLotSeasoned(lot, currentYear)) fromSeasonedConversions += take;
    else fromUnseasonedConversions += take;
  }
  ledger.lots = ledger.lots.filter((l) => l.amount > 0.005);

  const fromEarnings = remaining;

  return { fromContributions, fromSeasonedConversions, fromUnseasonedConversions, fromEarnings };
}

/** Penalty-free capacity available right now (contributions + seasoned lots). */
export function penaltyFreeCapacity(ledger: RothLedger, currentYear: number): number {
  return (
    ledger.contributionBasis +
    ledger.lots.reduce((s, l) => s + (isLotSeasoned(l, currentYear) ? l.amount : 0), 0)
  );
}
