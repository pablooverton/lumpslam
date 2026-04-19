# Financial Principles

This document explains every financial principle encoded in the Lumpsum engine. It is a reference for users who want to understand *why* a projection looks the way it does, and for contributors who need to extend the engine without breaking the underlying model.

The tool is a **planning aid**, not financial advice. It is opinionated — it encodes the opinions of a set of professional retirement advisors whose frameworks are explicit and testable. Where the default framework disagrees with conventional advice, the disagreement is deliberate and documented below.

---

## Table of Contents

1. [The Five Milestones Framework](#1-the-five-milestones-framework)
2. [The Gap: Required Portfolio Income](#2-the-gap-required-portfolio-income)
3. [The Four Seasons of Retirement](#3-the-four-seasons-of-retirement)
4. [Safe Withdrawal Rates and Guardrails](#4-safe-withdrawal-rates-and-guardrails)
5. [MAGI: The Master Variable](#5-magi-the-master-variable)
6. [The ACA Subsidy Cliff](#6-the-aca-subsidy-cliff)
7. [IRMAA and the Two-Year Lookback](#7-irmaa-and-the-two-year-lookback)
8. [Cost Basis: Why Brokerage Withdrawals Are Not All Taxable](#8-cost-basis-why-brokerage-withdrawals-are-not-all-taxable)
9. [Roth Conversions: Optimization, Not Enablement](#9-roth-conversions-optimization-not-enablement)
10. [The Balance-Dependent Playbook](#10-the-balance-dependent-playbook)
11. [The Conversion Treadmill](#11-the-conversion-treadmill)
12. [The Supercharge Strategy](#12-the-supercharge-strategy)
13. [Required Minimum Distributions](#13-required-minimum-distributions)
14. [Social Security Actuarial Adjustments](#14-social-security-actuarial-adjustments)
15. [The Widow's Penalty](#15-the-widows-penalty)
16. [Inherited IRAs and the 10-Year Rule](#16-inherited-iras-and-the-10-year-rule)
17. [Real vs. Nominal Dollars](#17-real-vs-nominal-dollars)
18. [Probability of Success](#18-probability-of-success)

---

## 1. The Five Milestones Framework

Retirement readiness is not one number. It is five distinct conditions, and you need all five.

1. **Stop treating Roth conversions as a retirement enabler.** A conversion moves money between account types and triggers a tax bill. It does not create spending capacity. If the portfolio math does not work before a conversion, no amount of converting will fix it. Conversions exist to optimize the tax treatment of money you were already going to have — a future benefit, not a current one. See [section 9](#9-roth-conversions-optimization-not-enablement).

2. **Know your gap.** Total retirement spending minus guaranteed income (Social Security, pensions) equals the amount the portfolio must generate. This is a different number than "can I retire on $X million" — a household with $60k of SS needs a very different portfolio than one with $30k. See [section 2](#2-the-gap-required-portfolio-income).

3. **Have a health insurance plan.** Employer coverage disappears on day one of retirement. Three regimes follow: COBRA (up to 18 months), ACA marketplace (to 65), Medicare (65+). Each has its own cost structure, its own MAGI interactions, and its own enrollment windows. "I'll figure it out later" is not a plan.

4. **Build a multi-year tax-efficient withdrawal roadmap.** The conventional sequence (taxable → tax-deferred → Roth) is oversimplified to the point of being wrong. The right sequence depends on the season, the cliff, and the balance. See [section 3](#3-the-four-seasons-of-retirement) and [section 10](#10-the-balance-dependent-playbook).

5. **Document guardrails with specific numbers.** "I'll cut back if markets drop" is not a plan. A real plan has a specific portfolio threshold, a specific adjustment size, and a specific recovery condition. See [section 4](#4-safe-withdrawal-rates-and-guardrails).

The engine scores each of these implicitly: the spending-capacity module checks the gap, the season classifier builds the health insurance roadmap, the opportunity module surfaces guardrail status, and the Roth conversion logic is deliberately not the first thing the engine computes.

---

## 2. The Gap: Required Portfolio Income

**Required Portfolio Income = Desired Spending − Guaranteed Income**

Most households inflate the retirement number by ignoring guaranteed income. Example: a couple wants $125k/yr and expects $45k/yr of combined Social Security. They only need the portfolio to generate **$80k/yr** — not $125k. At a 4% SWR, that's a $2M portfolio, not $3.1M.

The engine computes this as `portfolioWithdrawalNeeded` in `spending-capacity.ts`. The spending-capacity dashboard shows the surplus/deficit against essential spending only (not including discretionary travel or charitable giving) — the floor test, not the ceiling.

**Why essential only?** Because travel and charitable are variable — you adjust them in a down market. Essential is what must be funded unconditionally. If the portfolio cannot sustain essential, the plan does not work regardless of market returns. If it can sustain essential with a margin for travel, the plan works with dignity.

---

## 3. The Four Seasons of Retirement

A retirement is not a monolithic phase. It is four seasons, each with a different MAGI regime, a different healthcare cost structure, and a different optimal withdrawal sequence.

| Season | Duration | Healthcare | MAGI Cliff | Primary Lever |
|---|---|---|---|---|
| **COBRA** | 0–18 months | Former employer at group rate | None (part-W-2 year already over cliff) | Preserve brokerage for the ACA window |
| **ACA** | Until age 65 | Marketplace with subsidies | $84,600 MFJ (400% FPL) | Manage MAGI under the cliff |
| **Medicare** | 65 to SS claim (or RMD) | Parts A/B/D + Medigap | IRMAA tiers start at $212k MFJ | Roth conversion "golden window" |
| **RMD** | 73+ (2026 rule) | Same as Medicare | Same IRMAA tiers | Drawdown sequencing, QCDs |

An **International** variant replaces ACA for households retiring abroad: no US marketplace, typically paying out-of-pocket or for local universal coverage. The engine treats it like an extended COBRA (unrestricted withdrawals, no MAGI cliff) but displays a distinct label to avoid confusing users.

These seasons are classified in `seasons.ts` (`classifySeasonForYear`) and they drive every per-year decision in the simulation loop.

---

## 4. Safe Withdrawal Rates and Guardrails

### Base SWR

The engine uses a duration-scaled base withdrawal rate derived from 30-year US historical rolling returns:

- ≤ 25 years: 4.5%
- 26–35 years: 4.0%
- > 35 years: 3.8%

This is not the Bengen 1994 "4% forever" number. It is a modernization that acknowledges longer retirements (more years at risk), higher equity valuations (lower expected forward returns), and the availability of guardrails (the SWR is a starting point, not a ceiling).

### Dynamic Guardrails

A guardrails system converts the static SWR into a dynamic one. The engine tracks two thresholds:

- **Lower guardrail**: portfolio drops by `lowerGuardrailDropPct` (default ~29%) → cut spending by `lowerGuardrailSpendingCutPct`
- **Upper guardrail**: portfolio grows by a matching fraction → increase spending

The mathematical insight: with guardrails, a starting withdrawal rate of 5%+ can achieve a 95%+ historical success rate because the rate is not fixed. Guardrails impose discipline at both ends — you cut when you need to and you spend more when you can. Without them, conservative retirees die with huge portfolios and aggressive retirees run out.

### Why the Lower Cut Is Small

The default spending cut at the lower guardrail is a few hundred dollars per month — not austerity. Most market corrections are temporary, and a household that cuts 5–10% of spending for 1–3 years typically recovers fully. Cutting 50% "to be safe" destroys quality of life far beyond what the math requires.

Guardrails are implemented in `spending-capacity.ts` with configuration in `GuardrailConfig`. The dashboard shows the *dollar* trigger threshold, not just the percentage, because the behavioral research is clear: a specific number is actionable; a percentage is not.

---

## 5. MAGI: The Master Variable

**MAGI** (Modified Adjusted Gross Income) controls three income-sensitive systems simultaneously:

1. **ACA premium subsidy eligibility** — cliff at $84,600 MFJ (2025 figure)
2. **IRMAA Medicare surcharges** — tiered at $212k / $266k / $334k / $400k / $750k MFJ
3. **Federal tax bracket** — controls marginal tax on next dollar

The engine's `calculateMAGI()` function (`seasons.ts`) is deliberately explicit about its components:

```ts
MAGI = 0.85 × Social Security
     + Pretax Withdrawals
     + Roth Conversion Amount
     + Capital Gains Realized (gain portion of brokerage, not basis)
     + Other Income (inherited IRA distributions, pensions, etc.)
```

**What is NOT in MAGI:**
- Roth withdrawals (principal and earnings after 59½/5-year rule)
- Return of basis on brokerage
- HSA withdrawals for qualified medical expenses

The exclusion of Roth withdrawals is the single most powerful lever a retiree has. It turns the Roth account into a MAGI-invisible spending source that can bridge the ACA cliff or keep an IRMAA tier from jumping. See [section 6](#6-the-aca-subsidy-cliff).

---

## 6. The ACA Subsidy Cliff

**The Rule.** For 2025 plan years, a household over 400% of the Federal Poverty Level loses 100% of premium subsidies. For a two-person household, that cliff is $84,600. One dollar over and the subsidy — which can be $15k–$20k/year for a mid-50s couple — vanishes entirely.

This is called a **cliff**, not a phase-out. There is no gradient. The 2021 American Rescue Plan temporarily converted it to a phase-out but that provision has political risk and the engine treats the cliff as the base case.

**The Implication.** Every dollar of MAGI between $80k and $84,600 is normal income; the next dollar costs the household $15k–$20k. The effective marginal rate on that one dollar is thousands of percent. No tax planning strategy matters more than staying under the cliff during the ACA years.

### Sequencing to Stay Under the Cliff

The engine's ACA-season logic in `simulation-runner.ts` executes this sequence:

1. Compute passive MAGI (85% of SS + inherited IRA distributions)
2. Compute total MAGI headroom = cliff − passive MAGI − $1
3. Pull brokerage up to the MAGI limit (remember: only the **gain ratio** counts toward MAGI)
4. Pull pretax up to the remaining MAGI headroom
5. Pull Roth (MAGI-invisible) for the rest

The order is **not** "brokerage → pretax → Roth" mechanically. It is "brokerage-then-pretax up to the MAGI line, Roth to bridge." A household with $100k basis in a $100k brokerage account can withdraw the entire brokerage without a dollar of MAGI. A household with $0 basis in a $100k brokerage has $100k of MAGI on the same withdrawal.

### The 400% FPL Formula

`getAcaCliff(householdSize)` applies:

- Two persons: $84,600 (published 2025 figure)
- Each additional person: +$21,520 (400% × $5,380 per-person FPL increment)

The FPL numbers come from HHS poverty guidelines, updated annually.

---

## 7. IRMAA and the Two-Year Lookback

**IRMAA** (Income-Related Monthly Adjustment Amount) is a surcharge on Medicare Part B and Part D premiums for higher-income enrollees. It is NOT tax — it is a direct premium increase — but functionally it behaves like a tax on MAGI above certain thresholds.

### 2025 MFJ Thresholds

| Tier | MAGI Floor (MFJ) | Additional Part B + D / Year (couple) |
|---|---|---|
| 0 | $0 | $0 |
| 1 | $212,000 | ~$2,100 |
| 2 | $266,000 | ~$5,300 |
| 3 | $334,000 | ~$8,500 |
| 4 | $400,000 | ~$11,700 |
| 5 | $750,000 | ~$12,700 |

### The Two-Year Lookback

Medicare 2026 premiums are priced on 2024 MAGI. A Roth conversion at age 65 does not increase premiums until age 67. The engine models this with `magiHistory[year-2]` in `simulation-runner.ts`. Most retirement calculators use same-year MAGI and therefore overstate the immediate cost of conversions and mis-time the pain.

**Practical consequence.** A retiree who wants to do aggressive conversions right at 65 can reason: *"the IRMAA cost won't hit until I'm 67, and by then I may be below the tier again."* This is structurally different from a tax bracket, which hits immediately.

### The Cliff Structure

IRMAA is a **cliff at each tier**, not a phase-in. One dollar over a tier floor charges the full tier's surcharge for the whole year. The engine's `classifyIrmaaTier()` function exposes the room-to-next-tier so that the UI can show "you have $6,000 of conversion room before the next IRMAA jump."

---

## 8. Cost Basis: Why Brokerage Withdrawals Are Not All Taxable

A brokerage account is a taxable account, but "taxable" does not mean every withdrawn dollar is income. When you sell a share:

- The **basis** (what you paid) is return of capital — tax-free
- The **gain** (current price minus basis) is a capital gain — taxed as short- or long-term

Only the gain portion hits MAGI. This is why a $50k brokerage account with $50k basis (recently contributed, no appreciation) can fund $50k of spending with **zero MAGI impact**, and why the same-dollar withdrawal from a $50k brokerage with $10k basis would add $40k to MAGI.

The engine tracks this in two places:

1. `Account.costBasis` — per-account basis tracking
2. `brokerageGainRatio` in `simulation-runner.ts` — aggregate ratio used each year to decompose withdrawals

The simplification: the engine treats the gain ratio as constant over the retirement (it does not track basis recovery as withdrawals happen). For planning, this is close enough; for tax prep, run your actual numbers.

**Why it matters at the $1M balance level.** A household with $1M pretax and $50k brokerage can use the brokerage to cover $50k of ACA-years spending without MAGI impact — capturing ~$45k in ACA subsidies over 2 years on $50k of brokerage deployed. That is a **~90% controllable return** — not a market return; a tax-planning return — that no market strategy can replicate.

---

## 9. Roth Conversions: Optimization, Not Enablement

A Roth conversion is the act of paying tax today to move money from a pretax account (traditional IRA or 401(k)) into a Roth account. Future withdrawals from the Roth are tax-free. Future RMDs on the converted amount are zero.

### What Conversions Do

- Reduce future RMDs at age 73+
- Reduce future tax-bracket pressure in the RMD era
- Leave heirs tax-free accounts instead of tax-burdened ones (the inherited Roth is also subject to the 10-year rule but the distributions are tax-free)

### What Conversions Do NOT Do

- Create spending capacity
- Increase the portfolio's income generation ability
- "Help you retire" in the sense of making an otherwise-impossible retirement possible

This is the single most misunderstood point in retirement planning. A household that cannot retire without doing conversions also cannot retire with them — the conversion *costs money today* and merely shifts where the money is taxed. If the math doesn't work before, it doesn't work after.

### When Conversions Pay Off

Conversions are a bet that the **future marginal rate** on the pretax account (driven by RMDs, IRMAA, and possibly higher tax brackets) will be higher than the **current marginal rate** during the conversion. The golden window for conversions is:

- **Medicare to SS claim age (65 to 67–70)** — post-ACA-cliff (no subsidy concern), pre-SS (no SS income eating bracket room), low to moderate withdrawal needs
- **Retirement to Medicare (for households whose balance is not high enough to blow the ACA cliff with conversions)** — also low-income window, but the ACA cliff makes this tricky at higher balances

The engine's `calculateRothConversion()` function in `roth-conversion.ts` implements two modes:

1. **Surplus-driven**: take the spending-capacity surplus, buy as much conversion as that surplus can fund via brokerage-paid tax, capped at the target bracket ceiling
2. **Target-driven**: convert a user-specified annual amount, capped at the bracket ceiling and pretax balance, paying tax from either brokerage or Roth itself

The second mode matches the "$242k annual conversion" patterns common in high-balance households.

---

## 10. The Balance-Dependent Playbook

The right strategy is not the same at every balance. The engine recognizes three balance regimes and the interactions change materially between them.

### ~$1M Pretax + Modest Brokerage (case 1)

**The anti-pattern.** Conventional advice says "spend taxable first." During COBRA, a household following this advice burns their $50k brokerage on year-1 living expenses. By the time ACA arrives, there's no brokerage left to manage MAGI under the cliff — the lever is gone.

**The correct move.** During COBRA (a partial-W-2 year, already over the cliff anyway), fund spending from pretax — you're already in the bracket. Preserve the brokerage for the ACA years where its MAGI-invisible gain-ratio is the only thing that keeps you under $84,600.

**Social Security's role at this wealth.** Safety net. Delay to 70 if possible; pull forward if markets drop early. SS is the triage tool, not the optimization.

### ~$2M Pretax + Some Roth (case 2)

**The anti-pattern.** Treating Roth as sacred — "I'll spend it last." Keeping Roth untouched during ACA years forces MAGI up on pretax draws, which blows the subsidy.

**The correct move.** Use Roth during ACA years as a MAGI bridge. Roth is MAGI-invisible. A $51k Roth draw during ACA lets you keep a $79k pretax draw *under the cliff*, unlocking $23k/yr in subsidies. Then during Medicare golden-window years, convert heavily to rebuild the Roth — the engine shows ~6–7× rebuild of the Roth bucket over the golden window.

**SS role.** Still safety net.

### $3M+ Pretax with Multiple Buckets (case 3)

**Two counterintuitive moves:**

**Move A: Do NOT start Roth conversions at retirement.** The instinct is "I have a low-income window, convert now." But if there's an ACA window (ages 60–64), conversions stack on top of pretax income and blow the subsidy. Wait until 65, when Medicare replaces ACA and the $84,600 cliff disappears. The $46k in ACA subsidies over 2 years dwarfs the tax savings from 2 years of conversions at the low end.

**Move B: Supercharge through IRMAA Tier 2.** See [section 12](#12-the-supercharge-strategy).

**SS role at $3M+.** Not a safety net anymore — a **tax planning decision**. Delay to 70 because the conversion room between Medicare (65) and SS claim (70) with no SS competing for MAGI is worth far more than earlier claiming's risk mitigation.

The engine's opportunity module flags each of these patterns: `cobra_brokerage_preservation`, `roth_as_aca_bridge`, `supercharge_irmaa_tier2`.

---

## 11. The Conversion Treadmill

A diagnostic the engine runs on every profile: **is the conversion rate outpacing portfolio growth?**

If pretax grows at 8% per year (≈ $160k/yr on a $2M balance) and the conversion target is $120k/yr, the pretax balance is *growing faster than it is being converted*. The household will arrive at RMD age 73 with a pretax balance larger than the one they started retirement with. RMDs in that scenario will still be massive; the conversions merely slowed the increase.

The `conversion_treadmill` opportunity check compares the average annual conversion against the annual growth on current pretax. When the conversion is losing, the fix is either:

1. **Raise the target bracket** (22% → 24%) — unlocks ~$188k/yr of additional conversion room, at the cost of an extra 2% marginal rate on that slice
2. **Reduce the growth assumption** — if you want to compare in real terms, set `annualGrowthRate` to 6% and inputs/outputs move to real dollars

Without this diagnostic, users feel like they're doing the right thing (converting every year) while mathematically standing still.

---

## 12. The Supercharge Strategy

For high-balance households ($3M+ pretax), hugging the first IRMAA tier is often suboptimal. The engine flags this explicitly with the `supercharge_irmaa_tier2` opportunity.

**The math:**

- Staying at IRMAA Tier 0 ceiling (~$212k MAGI MFJ) means ~$120k–$150k of annual conversion after passive MAGI
- Pushing to IRMAA Tier 2 ceiling (the Tier 3 floor, ~$334k MAGI MFJ) unlocks ~$122k of additional conversion room
- Cost: ~$5,300/yr in IRMAA surcharges for a couple × 2-year lookback effective window × 5 golden-window years ≈ **$26,500 lifetime cost**
- Benefit: ~$122k/yr × 5 years × 8-point tax rate differential (22–24% now vs. 30–32% RMD-era) ≈ **$49k lifetime tax savings**
- Net: ~$22k benefit, or a ~2× return on the IRMAA cost — in a planning horizon where most strategies yield single-digit percentages

This only makes sense when:

1. Pretax balance is ≥ $3M (below this, the additional conversion room isn't needed — Tier 0 is enough)
2. A multi-year golden window exists (retirement 65 to SS claim 70 = 5 years)
3. The household is willing to accept premium surcharges that feel like additional tax

It is the kind of move that looks wrong on the surface ("why would I pay extra premiums?") and is right on the math. The engine surfaces it as an opportunity because users will not find it on their own.

---

## 13. Required Minimum Distributions

At age 73 (SECURE Act 2.0 rule, starting 2023), the IRS mandates annual withdrawals from pretax accounts based on the Uniform Lifetime Table. The RMD fraction starts at ~3.77% and grows each year as life expectancy shrinks.

```
RMD[year] = pretax_balance[year-end prior] / divisor[age]
```

The divisors live in `rmd-tables.ts` and reflect the 2022 IRS update.

### Why RMDs Dominate High-Balance Tax Planning

RMDs are the forcing function that makes Roth conversions valuable. Without RMDs, a household could leave pretax untouched indefinitely. With them:

- $3M pretax at 73 → ~$113k first-year RMD
- Combined with SS (say $60k) → MAGI base of $154k before any discretionary draw
- That MAGI already puts the household in the 22% bracket, near IRMAA Tier 0's ceiling, and growing with every year of RMD table changes

The goal of pre-RMD Roth conversions is to **reduce the balance subject to RMDs** so that the forced withdrawals don't compress tax planning flexibility in the 70s and 80s.

### Qualified Charitable Distributions

After age 70½, a charitably-inclined household can direct up to $105k/yr from IRA to a qualified charity, which satisfies RMD without hitting MAGI. This is strictly better than withdrawing, donating cash, and itemizing — because it keeps MAGI lower, preserving IRMAA tier and other income-sensitive benefits. The engine flags this in the `qualified_charitable_distributions` opportunity.

---

## 14. Social Security Actuarial Adjustments

Social Security benefits are claimed sometime between 62 and 70. The monthly benefit amount depends on when:

- **Before Full Retirement Age (FRA)**: benefit reduced by 5/9% per month for the first 36 months, 5/12% per month beyond that
- **At FRA**: unadjusted monthly benefit (the "primary insurance amount," PIA)
- **After FRA**: benefit increased by 2/3% per month (8% per year) of delay

For a household with FRA of 67:
- Claiming at 62: ~70% of PIA (30% reduction)
- Claiming at 67: 100% of PIA
- Claiming at 70: 124% of PIA (8% × 3 years)

### The Break-Even Math

Delaying from 62 to 70 means giving up 8 years × PIA in exchange for 24% higher monthly benefit for life. The break-even age is typically around 78–82 depending on discounting and inflation assumptions.

### Why Delay Usually Wins

- Longevity: if you live past 82, delay wins on cash flow
- Inflation: SS adjusts via COLA (Cost of Living Adjustment); a larger base means larger absolute dollar increases each year
- Widow's penalty: the surviving spouse can claim the larger of the two benefits. Delaying the higher earner's claim increases the survivor's lifetime income
- Tax planning: during the 65–70 window, no SS means a larger Roth conversion room

### When Claiming Early Makes Sense

- Short life expectancy
- Immediate cash flow need (portfolio otherwise depletes)
- Higher-earner spouse at FRA already claimed

The engine implements this in `social-security.ts` via `calculateBenefitAtClaimAge()`. The simulation holds SS at the nominal claim-age amount without applying COLA during the projection — this is conservative (real purchasing power decays) and matches the reference advisor's base case.

---

## 15. The Widow's Penalty

When one spouse passes, two things happen:

1. **Survivor's Social Security**: the survivor keeps the larger of the two benefits; the smaller one disappears. Household SS drops by the smaller spouse's amount.
2. **Filing status change**: after the year of death, the survivor files as single. Tax brackets compress (single bracket ceilings are roughly half the MFJ ceilings), IRMAA tiers compress similarly, and the standard deduction is cut in half.

The combined effect is severe: the same income that sat in the 22% bracket as MFJ can push into the 32% bracket as single, and the same MAGI that was in IRMAA Tier 1 can jump to Tier 3. This is called the **widow's penalty** and it is one of the strongest arguments for:

- Delaying the higher earner's SS claim (the survivor keeps it)
- Aggressive pre-death Roth conversions (pay tax at MFJ rates now, distribute tax-free later)
- Living below means in the MFJ era if one spouse is significantly older or in poor health

The engine models this in `contingency.ts` via `ContingencyReport`, which computes the survivor's spending capacity assuming the higher-earner's SS is preserved and the lower-earner's disappears. The dashboard shows a "coverage ratio" — the fraction of lifestyle spending that the survivor scenario supports.

---

## 16. Inherited IRAs and the 10-Year Rule

Under SECURE Act 1.0 (2019), non-spouse beneficiaries of an inherited IRA must fully distribute the account within 10 years of the original owner's death. For pretax inherited IRAs, every distribution is taxable. For inherited Roths, distributions are tax-free but the 10-year clock still runs.

The engine projects inherited IRA distributions in `rmd.ts` via `projectInheritedIraDistributions()`, using a schedule that balances growth against the 10-year cap. The distributions count toward MAGI (as "other income"), which matters for ACA and IRMAA interactions in the years the account is drawn down.

**Strategic implication.** An inherited IRA concentrates tax pressure in the decade after inheritance. A household that inherits at 60 faces pretax MAGI contributions through age 70 — exactly the ACA and Medicare golden-window years. The conventional "spread evenly over 10 years" approach is rarely optimal; the right schedule front-loads the distributions in the lowest-MAGI years.

---

## 17. Real vs. Nominal Dollars

A retirement projection that doesn't distinguish real from nominal dollars is misleading. The engine is explicit:

- **Nominal dollars** include inflation. A $100k withdrawal in 2045 at 3% inflation equals ~$55k in 2025 purchasing power.
- **Real dollars** remove inflation. The same $100k in 2045 nominal is $55k "in 2025 dollars."

The engine grows the portfolio at the user's `annualGrowthRate` (nominal by default, 8%) and then *deflates* the portfolio back to real terms before computing spending capacity. Without this, a 15-year runway at 9% nominal makes the capacity look ~1.56× larger than real purchasing power.

**What is specified in real 2025 dollars:**
- `baseAnnualSpending`
- `annualHealthcareCost`
- Standard deduction (the IRS indexes these, so they are real)
- Tax bracket ceilings (also indexed; engine inflates them year-by-year implicitly via the deflation pattern)

**What is specified in nominal dollars:**
- `mortgageAnnualPayment` (fixed rate, nominal by construction)

Inside the simulation loop, each year applies `inflationFactor = (1 + inflation)^yearsSinceRetirement` to real-dollar inputs so they scale with time. The tax is computed in real space, then scaled back up to nominal for display.

---

## 18. Probability of Success

The dashboard shows a "probability of success" — the chance that the plan funds essential spending for the full retirement horizon. It is **not** a Monte Carlo simulation. It is a historical heuristic based on 30-year rolling US market periods:

- **≥ 90%**: solid plan
- **70–89%**: workable with guardrails
- **< 70%**: consider working longer or reducing spending

### The Pre-SS Depletion Cap

A failure mode in naive heuristics: treating SS as immediately available. Example: retire at 39, claim SS at 67. A 4% SWR says the portfolio can support a given spending level if we average it across all 51 years. But if the portfolio runs out at age 49 (18 years before SS starts), there is no rescue — the household is broke in their 50s regardless of what happens at 67.

The engine's `simulation-runner.ts` post-simulation pass inspects the projection. If the portfolio depletes during the pre-SS window, probability is capped proportionally:

- Depletes at year 0 of N pre-SS years → cap at 50%
- Depletes at year N-1 of N pre-SS years → cap at 85%

Never above 85% when pre-SS depletion is present, never below 50%.

### Monte Carlo (Optional)

The engine supports a Monte Carlo runner (`monte-carlo.ts`) that injects a per-year return sequence sampled from historical distributions. This produces a true distribution of outcomes rather than a single heuristic. It is slower and the output is harder to reason about — but for sophisticated users, it answers the "what's the worst case" question more rigorously than the historical heuristic.

A 99% target is overly conservative for most households. The advisor consensus is **85–95% with guardrails** — high enough that statistical failure is unlikely, low enough that you aren't dying with a huge unused portfolio.

---

## Appendix: Notable Disagreements with Conventional Advice

The engine intentionally disagrees with conventional wisdom at several points. These are not bugs; they are modeling choices informed by the underlying math.

| Conventional Advice | Engine's Position |
|---|---|
| Spend taxable first, tax-deferred second, Roth last | Sequence depends on the season — Roth before pretax during ACA years is often correct |
| Roth conversions are free tax optimization | Conversions cost real money today; they are bets on future tax rates |
| Claim SS at 62 "because you might not live long" | At $3M+, delay to 70 is a tax-optimization move, not a longevity bet |
| Keep MAGI under the first IRMAA tier | At $3M+, intentionally crossing into Tier 2 can be mathematically optimal |
| 4% SWR is sacred | 4% is a starting point; guardrails make 5%+ historically viable |
| Monte Carlo is the gold standard | A well-designed historical heuristic plus guardrails is more actionable for most users |

---

## Glossary

- **MAGI** — Modified Adjusted Gross Income. Master variable for ACA, IRMAA, and tax bracket positioning.
- **RMD** — Required Minimum Distribution. Mandatory annual withdrawal from pretax accounts at age 73+.
- **SWR** — Safe Withdrawal Rate. The fraction of portfolio withdrawn annually that historically survives a 30-year retirement.
- **FRA** — Full Retirement Age. The age at which Social Security pays 100% of the Primary Insurance Amount.
- **PIA** — Primary Insurance Amount. Social Security benefit at Full Retirement Age.
- **IRMAA** — Income-Related Monthly Adjustment Amount. Surcharge on Medicare Part B and Part D for higher-income enrollees.
- **ACA** — Affordable Care Act. Marketplace health insurance with income-based subsidies.
- **COBRA** — Consolidated Omnibus Budget Reconciliation Act. Bridge health insurance for up to 18 months post-employment at group rates plus a 2% admin fee.
- **FPL** — Federal Poverty Level. Used by ACA to compute subsidy eligibility (400% FPL = cliff).
- **LTCG** — Long-Term Capital Gain. Gain on an asset held > 1 year; preferential tax rates (0/15/20%).
- **QCD** — Qualified Charitable Distribution. Direct IRA-to-charity transfer that satisfies RMD without increasing MAGI.
