# Coast FIRE + Foreign Tax Framework — Architecture Plan

**Date:** 2026-05-17
**Status:** Plan for review before implementation
**Context:** The retirement-planning vault analysis identified a Coast FIRE phase (multi-year reduced-income working bridge in Asia between full US employment and full retirement) as a strategically important option not currently modeled by lumpsum. Implementing this requires (a) a new life-phase concept between accumulation and retirement, and (b) a foreign-country tax framework for both Coast and international retirement scenarios.

## Goals

1. Model a 2-5 year Coast phase where the household earns reduced income while living abroad
2. Compute foreign tax accurately during Coast (and during international retirement) using country-specific regimes
3. Allow optional Roth conversions during Coast
4. Maintain backward compatibility: existing profiles without Coast config produce identical results
5. Integrate with Monte Carlo so multiple Coast configurations can be MC-compared

## Non-Goals (this iteration)

- Currency exchange rate modeling (defer; assume real-dollar inputs)
- Coast contributions to 401k/Roth (assume none during Coast; portfolio compounds untouched)
- UI for Coast configuration (engine first; UI in separate pass)

## Locked Decisions (2026-05-17 user input)

| Decision | Choice | Rationale |
|---|---|---|
| Multi-country sequences | **Array of Coast phases v1** | Sequence III (Taiwan→Korea→NC) supported natively |
| Taiwan AMT inclusion rule default | **Conservative 100% inclusion** | Matches authoritative sources; safer planning default; user can override with `inclusionMode: '50pct'` |
| Roth conversion treaty interpretation | **Configurable per phase, REQUIRED, no default** | Forces explicit assumption; treaty ambiguity is real and shouldn't be silently optimistic |

## Architecture Decisions

### Decision 1: Life Phase vs. Healthcare Season

**Current:** `RetirementSeason` conflates life phase ("am I working?") with healthcare regime ("which insurance season?").

**Decision:** Don't refactor. Add `'coast'` as a new `RetirementSeason` value. Coast follows same engine rules as `'international'` for healthcare (no ACA MAGI cliff, free conversions, international healthcare costs from spending profile). Life phase distinction (working vs retired) is implicit in whether contributions are flowing.

**Rationale:** Refactoring `RetirementSeason` would touch 88 tests and many UI components. Additive approach minimizes blast radius.

### Decision 2: Foreign Tax as Pluggable Regime

**Decision:** New module `src/domain/engine/foreign-tax.ts` exports `calculateForeignTax(regime, inputs) → result`. Each regime is a pure function. Add regimes incrementally.

**Initial regimes:**
- `'none'` — US domestic baseline (returns 0)
- `'japan_npr'` — Foreign-source income exempt unless remitted; Japan-source taxed normally
- `'japan_full'` — Worldwide taxation; treaty offset for pension distributions (per US-Japan treaty Article 17)
- `'korea_under5'` — Foreign-source income only taxed if paid in or remitted to Korea
- `'korea_over5'` — Worldwide taxation; treaty offset for pension distributions (per US-Korea treaty Article 18)
- `'taiwan_amt'` — Basic Income Tax (AMT) with NT$7.5M exemption and 20% rate above threshold

**Rationale:** Regimes have wildly different mechanics. Keeping them as separate pure functions is clearer than a single configurable function. Easy to add Spain/Costa Rica/other regimes later.

### Decision 3: Coast Config Shape (LOCKED 2026-05-17 — array of phases)

```typescript
export interface CoastPhase {
  /** Year Coast phase begins (inclusive). */
  startYear: number;
  /** Last year of this Coast phase (inclusive). */
  endYear: number;
  /** Country of residence during this phase — drives healthcare regime defaults. */
  location: 'japan' | 'korea' | 'taiwan';
  /** Foreign tax regime during this phase (must align with location semantically). */
  taxRegime: ForeignTaxRegime;
  /** Combined household annual income during this phase (real dollars). */
  annualIncome: number;
  /** Fraction of annualIncome that is US-source (US remote work paid to US accounts).
   *  Range: 0.0 (all local foreign) to 1.0 (all US remote).
   *  E.g., 0.6 = primary earner US remote 60%, spouse local 40%. */
  usSourceIncomePct: number;
  /** Annual Roth conversion during this phase (real dollars). Default: 0. */
  annualConversion?: number;
  /** Annual remittance from US accounts to host country (for living expenses funded from
   *  taxable brokerage rather than coast income). Drives 'remitted to host' for NPR/under-5-year rules. */
  annualRemittanceToHost?: number;
  /** Treaty interpretation for Roth conversions during this phase. REQUIRED — no engine default.
   *  This forces the user to make an explicit assumption per phase. The Korea/Japan treaty
   *  interpretation for Roth conversions is genuinely ambiguous (vault 65/25/10 probability split). */
  conversionTreatyProtection: 'protected' | 'half_taxed' | 'fully_taxed';
}

// Added to ClientProfile:
/**
 * Array of Coast phases (chronologically ordered, non-overlapping, all entries
 * with startYear > currentYear AND endYear < retirementYearDesired).
 * If omitted or empty, no Coast modeling. Backward-compatible.
 */
coastPhases?: CoastPhase[];
```

**Validation rules (enforced at engine entry):**
- Phases ordered: `phases[i].endYear < phases[i+1].startYear`
- All phases bounded: `phase.startYear > profile.currentYear` AND `phase.endYear < profile.retirementYearDesired`
- `usSourceIncomePct` in `[0, 1]`
- `annualIncome` and `annualConversion` non-negative
- `conversionTreatyProtection` set (required, no default)

**Why array:** Supports Sequence III (Taiwan→Korea→NC) natively without engine kludges. Each Coast phase has its own tax regime, location, and income assumptions.

### Decision 4: Coast Loop in Simulation Runner

**Current loop:**
```
for y in 0..workingYears: accumulationStep()
for y in retirementYear..endYear: retirementStep()
```

**New loop:**
```
for y in 0..coastStartYear-currentYear: accumulationStep()       // full ADI income, contributions
for y in coastStartYear..retirementYear: coastStep()             // reduced income, no contributions, foreign tax
for y in retirementYear..endYear: retirementStep()               // existing logic
```

**`coastStep` responsibilities:**
1. Compute US federal tax on US-source income portion (using existing `calculateOrdinaryIncomeTax`)
2. Compute foreign tax via `calculateForeignTax(regime, inputs)`
3. Apply foreign tax credit (FTC) against US tax (lesser of foreign tax paid or US tax on same income)
4. Optional Roth conversion during Coast: add to MAGI, recompute tax
5. Income above spending → no draw, no contributions (just compounds)
6. Income below spending → draw from brokerage first (basis-aware), then Roth
7. Compute year-end balances with growth applied
8. Emit `YearlyProjection` with `season: 'coast'` and full tax breakdown

### Decision 5: Tax Liability Extended

Add foreign tax to `TaxLiability`:
```typescript
export interface TaxLiability {
  // ... existing fields ...
  foreignTax: number;           // NEW — tax owed to host country
  foreignTaxCredit: number;     // NEW — FTC applied against US federal
  effectiveRate: number;
}
```

The `totalFederalTax` already-displayed value is `usFederalTax - FTC` to reflect actual federal liability after credit.

## Vertical Slices

Implement and test one slice at a time. Each slice commits with passing tests.

### Slice 1 — Foreign tax framework foundation
- [ ] Add `ForeignTaxRegime` type
- [ ] Add `ForeignTaxInputs`, `ForeignTaxResult` types
- [ ] Implement `calculateForeignTax()` dispatcher (initially handles only `'none'`)
- [ ] Unit tests: `'none'` regime returns 0
- [ ] Commit

### Slice 2 — Japan NPR regime
- [ ] Implement Japan NPR logic in `foreign-tax.ts`
- [ ] Unit tests for NPR mechanics:
  - Foreign-source income not remitted → 0 tax
  - Foreign-source income fully remitted → standard Japanese rates
  - Mixed remittance → proportional
  - Roth conversions are foreign-source (US account), not remitted → 0 tax
- [ ] Commit

### Slice 3 — Korea regimes (under5 and over5)
- [ ] Implement Korea under-5-year logic
- [ ] Implement Korea over-5-year logic
- [ ] Unit tests for both
- [ ] Commit

### Slice 4 — Taiwan AMT regime
- [ ] Implement Taiwan AMT calculation
- [ ] Document the 50% vs 100% inclusion ambiguity in code comments; implement conservative full-inclusion as default with `inclusionMode` parameter
- [ ] Unit tests at multiple income levels
- [ ] Commit

### Slice 5 — Coast config types and validation
- [ ] Add `CoastConfig` type to `profile.ts`
- [ ] Add validation: coast.startYear > currentYear AND coast.startYear < retirementYearDesired
- [ ] Add validation: usSourceIncomePct in [0, 1]
- [ ] Unit tests for validation
- [ ] Commit

### Slice 6 — Coast loop in simulation runner
- [ ] Detect coast config; split accumulation loop
- [ ] Implement `coastStep` function (in simulation-runner.ts or new file)
- [ ] Emit YearlyProjection with `season: 'coast'`
- [ ] Integration test: golden scenario for Sequence II (Korea Coast w/ spouse working locally)
- [ ] Commit

### Slice 7 — Monte Carlo integration
- [ ] Verify Monte Carlo still works with Coast scenarios
- [ ] Add MC dimensions: foreign tax rate uncertainty (e.g., ±20%)
- [ ] Unit tests for MC + Coast
- [ ] Commit

### Slice 8 — Scenario doc + UI exposure (optional, defer if needed)
- [ ] Add Coast scenarios to scenario list
- [ ] Document Coast config in FINANCIAL-PRINCIPLES.md
- [ ] CLI command: `coast` shows Coast phase summary
- [ ] Defer UI; existing scenarios page would need Coast tab (separate work)

## Risks

| Risk | Mitigation |
|---|---|
| Foreign tax rules are complex and have interpretive ambiguity (Taiwan AMT, Korea/Japan treaty for IRAs) | Implement conservative defaults; document ambiguity in code; allow override params |
| Breaking 88 existing tests | All Coast features are gated on `profile.coast` being set; profiles without coast follow identical logic |
| FTC calculation is non-trivial (per-category limitation, carryover rules) | Simplify: apply overall FTC limit only; document deviation from real IRS Form 1116 |
| Real-world tax filings require CPA — engine is planning aid only | Add disclaimer in module docstring and UI |

## Open Questions

1. **Coast healthcare cost** — Should engine pull from `spending.internationalHealthcare` (if exists) or derive from `coast.location`? Suggest: per-location defaults overridable in spending profile.

2. **State tax during Coast** — If family maintains NC domicile (kids in school, house owned), NC may claim residency and tax worldwide income during Coast. If family establishes Florida domicile before Coast, no state tax. Engine should respect `profile.hasStateIncomeTax` and `profile.stateOfResidence` as the user-set value (out of scope for this iteration to model domicile transitions).

3. **Coast income growth** — Does Coast income grow with inflation? Real dollars convention says no growth needed (already real). Confirm.

4. **Multiple Coast phases** — User scenario mentioned "Taiwan → Korea → NC" — that's three locations. Engine currently supports one Coast. Future extension: array of CoastConfig with adjacent year ranges.

## What This Does NOT Solve

- The Taiwan AMT inclusion rule (50% vs 100%) is implemented with a default and parameter; CPA verification still required for real planning
- The Korea/Japan treaty interpretation for Roth conversions remains ambiguous; the engine implements a configurable assumption (default: conversions are treaty-protected); user can override
- Currency risk is not modeled; all inputs are real USD; recommend user stress-tests with adjusted COL inputs
