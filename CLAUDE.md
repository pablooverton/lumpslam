# lumpsum — AI Agent Context

## What this is

A personal retirement planning tool (portfolio piece). Given a financial profile, it runs Monte
Carlo simulations and projects portfolio survival across retirement scenarios — coast FIRE, Roth
conversion ladders, foreign-tax modeling, contingency planning, spending capacity, Social
Security.

No backend. Fully client-side static site. Data lives in JSON profiles loaded into Zustand.
The `cli/` directory contains a headless TypeScript runner for the same engine.

## Stack

- Next.js 16 (app router, `output: 'export'` → **fully static**, no server)
- React 19, TypeScript strict
- Tailwind v4
- Zustand — client-side profile and simulation state
- Deploy: **GitHub Pages via `git push origin master`**

## Deploy convention

```bash
git push origin master
# GitHub Actions (deploy.yml) runs: npm ci → npm run build → publishes /out to GitHub Pages
```

The site lives under a sub-path. `NEXT_PUBLIC_BASE_PATH` is injected by CI; locally `npm run dev`
works at `localhost:3000/` with no base path. **Do not deploy via Vercel** — the `.vercel/`
directory is a stale artifact from an earlier experiment; ignore it.

## Structure

```
src/
  app/              # Next.js pages (fully static)
    profile/        # Profile input form
    scenarios/      # Scenario selector + results table
    monte-carlo/    # Monte Carlo simulation view
    roth/           # Roth conversion ladder
    contingency/    # Contingency / drawdown planning
    opportunities/  # Tax and savings opportunity flags
    seasons/        # Life seasons overview
    social-security/# Social Security benefit modeling
  components/       # PortfolioChart, ScenarioSelector, AppShell
  domain/
    engine/         # Pure computation — no I/O, no fetches, no Date.now()
      coast.ts, contingency.ts, foreign-tax.ts, monte-carlo.ts, opportunities.ts
      rmd.ts, roth-conversion.ts, savings-strategy.ts, seasons.ts
      simulation-runner.ts, social-security.ts, spending-capacity.ts, tax-utils.ts
    types/          # TypeScript types (profile, simulation, roth, scenarios, etc.)
    constants/      # Tax brackets, ACA thresholds, RMD tables, state tax data
  store/            # Zustand stores (profile.store.ts, simulation.store.ts)
  lib/              # Utilities (format.ts, export-markdown.ts)
cli/
  compare.ts        # Compare multiple scenario outputs headlessly
  format-output.ts  # CLI output formatting
  alice-bob-example.json   # Committed — anonymized example profile only
  personal-*.json          # GITIGNORED — real personal scenarios
  private-*.json           # GITIGNORED — real personal scenarios
  strategies/              # Strategy sub-profiles
```

## Key rules

### Pure engine

`src/domain/engine/` must stay pure: no React imports, no `fetch`, no `Date.now()`, no env
reads. All inputs flow through function parameters. This keeps the engine testable and
CLI-runnable without a browser.

### PII guard

`cli/personal-*.json` and `cli/private-*.json` are gitignored — real names, balances,
salaries, and SS estimates live there only. The only tracked profile is `alice-bob-example.json`
with anonymized round numbers. When working on real scenarios, use a gitignored file. Do not
`git add` personal profiles.

@AGENTS.md
