/**
 * validateCoastPhases — one-time flows dated inside a coast window are silently ignored
 * by the coast engine, so validation surfaces them as non-blocking warnings.
 */
import { describe, it, expect } from 'vitest';
import { validateCoastPhases } from '../../src/domain/types/profile';
import type { CoastPhase } from '../../src/domain/types/profile';

const PHASES: CoastPhase[] = [
  { startYear: 2030, endYear: 2033, location: 'us', annualIncome: 70_000, usSourceIncomePct: 1 },
];

describe('validateCoastPhases — one-time-flow warnings', () => {
  it('warns when a one-time income falls inside a coast window (still valid)', () => {
    const r = validateCoastPhases(PHASES, 2026, 2034, {
      incomes: [{ year: 2031, label: 'house sale', amount: 340_000 }],
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('house sale');
    expect(r.warnings[0]).toContain('IGNORED');
  });

  it('warns when a one-time expense falls inside a coast window', () => {
    const r = validateCoastPhases(PHASES, 2026, 2034, {
      expenses: [{ year: 2030, label: 'roof', amount: 30_000 }],
    });
    expect(r.valid).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('roof');
  });

  it('is silent for flows outside every coast window', () => {
    const r = validateCoastPhases(PHASES, 2026, 2034, {
      incomes: [{ year: 2034, label: 'house sale', amount: 340_000 }],
      expenses: [{ year: 2029, label: 'roof', amount: 30_000 }],
    });
    expect(r.valid).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it('keeps the no-phases fast path silent', () => {
    const r = validateCoastPhases(undefined, 2026, 2034, {
      incomes: [{ year: 2031, label: 'house sale', amount: 340_000 }],
    });
    expect(r.valid).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });
});
