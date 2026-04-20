# PII-guard rule (MUST FOLLOW)

This is a portfolio-piece retirement tool. **Never commit real personal financial data.**

- No real names, balances, salaries, or SS estimates in `cli/*.json` profiles tracked by git
- Use the `alice-bob-*.json` files as reference examples (anonymized round numbers, generic names)
- Any profile containing real data must go in a gitignored path. See `.gitignore` for the patterns (`cli/personal-*.json`, `cli/*-personal.json`, `cli/private-*.json`)
- Do not reference real client names in source code comments (use "the user" / "the profile" / archetype names like "the elective-conversion archetype")
- If asked to model a scenario against real numbers, do the work in a gitignored profile. Do not commit.
- If in doubt, ask before `git add`

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
