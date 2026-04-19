# Lumpsum

A browser-based retirement planning engine that models the tax-aware withdrawal sequencing, Roth conversion, and Social Security timing decisions most calculators skip. Built as a typed domain model first, with a CLI and a Next.js UI over the same engine.

**Live tool:** [https://pablooverton.github.io/lumpslam/](https://pablooverton.github.io/lumpslam/)

**Deep dive:** [`FINANCIAL-PRINCIPLES.md`](./FINANCIAL-PRINCIPLES.md) — the financial model, documented at length.

---

## Why It Exists

Most retirement calculators answer one question: "can I retire?" They do it with a 4% rule, a single projection, and a probability number. That is not the question that matters.

The question that matters is: **for each year of my retirement, what is the right withdrawal sequence, the right conversion amount, the right MAGI target?** Getting that wrong doesn't just reduce the portfolio by a few percent — it can cost six figures in missed ACA subsidies, mis-timed IRMAA surcharges, or over-converted Roth balances that never repay their tax cost.

Lumpsum implements that year-by-year decision engine. It models the four seasons of retirement (COBRA → ACA → Medicare → RMD), the MAGI cliff at $84,600, the IRMAA two-year lookback, the gain-ratio decomposition of brokerage withdrawals, and a balance-dependent playbook that differs materially between $1M, $2M, and $3M+ households.

---

## What It Does

Given a client profile (ages, account balances, cost bases, spending targets, SS expectations, state of residence), the engine produces a year-by-year projection containing:

- **Spending capacity** — 4% SWR from portfolio + projected Social Security = total funded capacity, with guardrail triggers
- **Four seasons classification** — for each projected year, the applicable healthcare regime and MAGI cliff
- **Withdrawal sequence** — season-aware draws across pretax, brokerage (basis-split), and Roth
- **Roth conversion engine** — fills to target bracket ceiling, with MAGI headroom accounting for SS includable, RMDs, and inherited IRA distributions
- **IRMAA with 2-year lookback** — conversions at age 65 correctly price surcharges at age 67
- **Social Security actuarial math** — delayed credits (8%/yr), early reduction (5/9% + 5/12% per month)
- **Widow's penalty** — survivor income analysis using filing-status-compressed brackets
- **Inherited IRA** — SECURE Act 10-year rule with per-year distribution planning
- **Opportunity scan** — eleven diagnostic checks, including the conversion treadmill, the IRMAA Tier 2 supercharge, and the 5% outside-pretax precondition

See [`FINANCIAL-PRINCIPLES.md`](./FINANCIAL-PRINCIPLES.md) for the full model.

---

## Architecture

```
src/domain/          — pure TypeScript engine (no React, no I/O)
  constants/         — tax brackets, ACA cliff, RMD tables, state taxes
  types/             — profile, assets, spending, simulation, SS, contingency, opportunities
  engine/            — tax-utils, seasons, rmd, social-security, roth-conversion,
                       spending-capacity, simulation-runner, opportunities, contingency,
                       monte-carlo
src/app/             — Next.js pages (profile, scenarios, seasons, roth, SS, opportunities,
                       contingency, monte-carlo)
src/components/      — UI components (SVG portfolio chart, scenario selector, phase cards)
src/store/           — Zustand split-store (profile persisted to localStorage, simulation derived)
cli/                 — CLI entry point (tsx run.ts profile.json [command])
tests/unit/          — tax math, SS, RMD, MAGI/ACA/IRMAA, season classification, opportunities
tests/scenarios/     — full-simulation integration tests (Mike & Laura golden, engine correctness)
```

The engine is framework-agnostic. Both the browser (Zustand) and the CLI (JSON input) call the same `runSimulation()` function. The engine has zero React, zero Next.js, zero I/O — it is a pure function of `(profile, assets, spending, guardrails, scenarioType)`.

**Test count:** 88 tests, all passing.

---

## Key Technical Decisions

| Decision | Rationale |
|---|---|
| Pure domain engine, no React deps | CLI + browser share identical code; tests run without Next.js overhead |
| Static export (`output: 'export'`) | Hosted on GitHub Pages; no server; works offline from the `out/` directory |
| Zustand split-store pattern | Profile (persisted) separate from simulation (derived); avoids reactive loops on expensive recomputes |
| SWR = 4.5 / 4.0 / 3.8% by retirement length | Matches historical 30-year rolling research; guardrails handle dynamic adjustment |
| ACA cliff $84,599 cap | Cliff is exclusive — at exactly $84,600 all subsidies are lost (all-or-nothing) |
| Brokerage basis split for MAGI | Only the gain ratio counts toward MAGI; a $50k basis / $50k balance brokerage is MAGI-invisible |
| IRMAA 2-year lookback | Conversions at 65 price surcharges at 67; tracked via per-year MAGI history |
| Test-driven bug discovery | Six analytical bugs found and fixed via integration tests before manual testing |

---

## Development

```bash
# install
npm install

# dev server
npm run dev

# run tests
npx vitest run

# CLI
npm run cli -- profile.json seasons
npm run cli -- profile.json roth
npm run cli -- profile.json contingency

# build (static export to ./out)
npm run build
```

---

## Notable Lessons Encoded in the Engine

The engine codifies financial frameworks from professional retirement advisors. Several of these disagree with conventional advice; they are deliberate:

- **Roth conversions are not a retirement enabler.** If the math doesn't work before a conversion, it doesn't work after. Conversions optimize the tax treatment of money you were already going to have; they do not create spending capacity.
- **Sequence beats which-account.** "Spend taxable first" is oversimplified to the point of being wrong during the ACA window — it strips the MAGI-management lever at exactly the moment you need it.
- **Roth is an ACA bridge, not a last resort.** Roth withdrawals are MAGI-invisible. During ACA years, pulling Roth to keep MAGI under the cliff is often the highest-value move available.
- **IRMAA Tier 2 is sometimes correct.** At $3M+ pre-tax with a multi-year pre-SS window, intentionally triggering Tier 2 surcharges to unlock conversion room has a ~2× return vs. hugging Tier 0.
- **The conversion treadmill is real.** If pre-tax grows faster than your conversion rate, the account isn't shrinking — you're just slowing the growth. Raise the target bracket or accept the RMD-era tax bill.

See [`FINANCIAL-PRINCIPLES.md`](./FINANCIAL-PRINCIPLES.md) § 9–12 for the math.

---

## Disclaimer

For educational purposes only. Not financial advice. The engine is a planning aid that makes explicit the assumptions behind its recommendations. Run your actual numbers with a licensed advisor before acting on any projection.
