import { describe, it, expect } from 'vitest';
import {
  createRothLedger,
  addContribution,
  addConversionLot,
  drawFromRoth,
  penaltyFreeCapacity,
} from '../../src/domain/engine/roth-ledger';

describe('drawFromRoth — IRS ordering', () => {
  it('contributions first, then seasoned lots FIFO, then unseasoned, then earnings', () => {
    const ledger = createRothLedger(100);
    addConversionLot(ledger, 2020, 50); // seasoned by 2026
    addConversionLot(ledger, 2024, 50); // unseasoned in 2026
    // balance conceptually 300 → 100 contrib + 100 lots + 100 earnings
    const comp = drawFromRoth(ledger, 280, 2026);
    expect(comp.fromContributions).toBe(100);
    expect(comp.fromSeasonedConversions).toBe(50);
    expect(comp.fromUnseasonedConversions).toBe(50);
    expect(comp.fromEarnings).toBe(80);
  });

  it('lots are consumed FIFO by conversion year regardless of seasoning', () => {
    const ledger = createRothLedger(0);
    addConversionLot(ledger, 2023, 40); // unseasoned in 2026 (3 years)
    addConversionLot(ledger, 2019, 40); // seasoned — but added second (out of order)
    // FIFO is array order; the engine always appends chronologically, so mimic that:
    // here 2023 is consumed first and is unseasoned.
    const comp = drawFromRoth(ledger, 40, 2026);
    expect(comp.fromUnseasonedConversions).toBe(40);
    expect(comp.fromSeasonedConversions).toBe(0);
  });

  it('seasoning boundary: exactly 5 calendar years is seasoned', () => {
    const ledger = createRothLedger(0);
    addConversionLot(ledger, 2021, 100);
    const comp2026 = drawFromRoth(ledger, 50, 2026); // 2026 − 2021 = 5 → seasoned
    expect(comp2026.fromSeasonedConversions).toBe(50);

    const ledger2 = createRothLedger(0);
    addConversionLot(ledger2, 2022, 100);
    const comp = drawFromRoth(ledger2, 50, 2026); // 4 years → unseasoned
    expect(comp.fromUnseasonedConversions).toBe(50);
  });

  it('partial draws persist remaining basis and lot amounts', () => {
    const ledger = createRothLedger(100);
    addConversionLot(ledger, 2020, 60);
    drawFromRoth(ledger, 120, 2026); // 100 contrib + 20 of the lot
    expect(ledger.contributionBasis).toBe(0);
    expect(ledger.lots).toHaveLength(1);
    expect(ledger.lots[0].amount).toBeCloseTo(40, 9);
  });

  it('addContribution grows basis; penaltyFreeCapacity = basis + seasoned lots', () => {
    const ledger = createRothLedger(10);
    addContribution(ledger, 90);
    addConversionLot(ledger, 2020, 25); // seasoned in 2026
    addConversionLot(ledger, 2025, 25); // not seasoned
    expect(penaltyFreeCapacity(ledger, 2026)).toBe(125);
  });

  it('draws beyond all tracked basis are earnings', () => {
    const ledger = createRothLedger(0);
    const comp = drawFromRoth(ledger, 75, 2026);
    expect(comp.fromEarnings).toBe(75);
  });
});
