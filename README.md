# Harborline Finance AI

An evidence-first **expense compliance checker** with optional AI-assisted review, built for the *CIS 9559 AI for Business* finance teaching case. Built with plain JavaScript and a small Vercel serverless function. No database, account signup, or third-party client packages.

## Quick start

1. Open the deployed site, or open `index.html` with `ai-insights.js` in the same directory for **local** screening. Live AI features require a deployment with `/api/insights`.
2. Choose `expense_claims_sep.csv` under **Expense claims** and `employees.csv` under **Employee reference**. These files come from the separate, privately distributed course pack; **not from this public repository**.
3. Click **Check claims**. Read held-claim explanations, departmental summaries, and the data-quality notes. Export a review CSV if needed.
4. The **Intelligence desk** immediately shows calculated review priorities without a key or network request.
5. Optional AI: enter your **OpenRouter API key**, use the **Auto Free** model router, inspect the JSON evidence preview, tick the explicit consent box, then click **Generate AI executive review** or **Ask AI**.
6. Click **Clear key** or close the tab to remove the entered key. The app does not persist it in localStorage, a database, repository, or Vercel environment variables.

**Try the app without any files:** Use **Explore with synthetic demo data**, which loads ten explicitly fictitious claims and four fictitious employees. This is not the course dataset.

## Features

- Eight policy rules: submit-date window, receipts, daily meals, hotel nights, airfare approvals, entertainment details/approvals, possible splits, and possible duplicates.
- Retains all source claims, including refunds and data-quality exceptions; monetary totals are integer-cent based and reconcile to source rows.
- Searchable review queue with claim-level evidence, CSV export, department summaries, policy controls, printing, and privacy-conscious synthetic demo.
- **Offline local intelligence**: review share, held value, department concentration, and first-to-inspect claims by a documented heuristic. It is not a fraud score.
- **Optional OpenRouter Auto Free**: a structured executive review with findings, cited claim IDs and rule codes, action list, limitations, and follow-up questions based on *reduced evidence only*.
- Routing is fixed to `openrouter/free`, which automatically chooses a free model. Do not replace it with `openrouter/auto`, which may choose paid models. Free model calls have $0 token pricing and request limits.

## Key and data privacy

**Local screening sends no CSV data to any server.** The optional AI request sends the entered OpenRouter key and a **reduced JSON snapshot** via HTTPS to the same-origin Vercel function (`api/insights.js`), which forwards them to OpenRouter's Chat Completions API and a selected free-model provider. The snapshot contains summary totals, policy thresholds, up to 16 department aggregates, rule and data-quality counts, and up to 18 selected claim ID/amount/rule examples with coverage notes. It excludes full CSV bytes, employee names and IDs, merchants, and raw descriptions. Review the exact JSON and consent before each newly loaded review. OpenRouter and the routed provider have their own processing and retention policies; the application does not persist these requests.

The OpenRouter API key stays in the page until cleared or the tab closes. During an AI request it passes through the Vercel function to OpenRouter and its selected model provider, but the app does not persist or log it. **Never paste a real key into GitHub, chat, code or screenshots.** The `openrouter/free` model costs $0 in model tokens, subject to OpenRouter free-tier quotas. Other routes may incur charges.

The AI instructions tell the model to treat data as untrusted evidence and not to invent facts, approvals, losses, or fraud claims. AI output is not a substitute for verifying receipts, management approvals, policy versions, and accounting history. No claim is automatically approved or rejected.

## Deploy to Vercel

Connect this GitHub repository as a new Vercel project with the **Other** framework preset. No build command, special output directory, or API environment variables are required. Vercel serves `index.html` and `ai-insights.js` statically, and deploys `api/insights.js` as a Node serverless function. `vercel.json` sets a 60-second function limit and security headers. Node.js 22 is pinned. Preview and individual deployment URLs retain Vercel authentication; the production domain is public. `.vercelignore` keeps tests and documentation out of the served site.

## Verification

- Original finance engine: 68 independent logic and edge-case regression checks passed using the September course dataset and provided fixtures.
- API/data minimization: nine automated tests in `tests/ai.test.cjs` passed, including malformed model output, refusals, partial-output rejection, and evidence coverage.
- `tests/browser_check.py` checks an actual HTTPS deployment, local demo behavior, API-key and consent gates, server rejection of a deliberately invalid short key, responsive layout, and optional September CSV uploads. It never makes a paid AI call. Run it with `HARBORLINE_BASE_URL` set to the deployment URL; supply `FINANCE_CLAIMS` and `FINANCE_EMPLOYEES` for the optional private dataset check.
- **A live OpenRouter request with a real user key has not been made.** Mock responses demonstrate the interface and proxy contract without charging anyone. Check the first production API request with a key before relying on AI output.

Run unit tests with `npm test` (Node.js 22). The optional browser test is at `tests/browser_check.py` and uses an installed Playwright/Chromium environment; it is not part of the deployment.

## AI request reliability

The proxy uses strict JSON Schema output, `require_parameters: true` provider filtering, and a 5,000-token maximum output budget. Requests time out after 55 seconds on the server and 65 seconds in the browser. Duplicate submissions are blocked while a request is active. Refusals, malformed findings, and incomplete responses produce explicit errors rather than partial findings. Timeouts and incomplete responses can still incur provider usage; the app does not automatically retry. These limits are engineering choices, not latency guarantees.

## Provenance / sources

- Local case policy: `TE_Policy.docx` from the user's finance assignment package (not publicly distributed in the repository).
- [OpenRouter Chat Completions API](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request)
- [OpenRouter Free Models Router](https://openrouter.ai/openrouter/free)
- [OpenRouter structured outputs](https://openrouter.ai/docs/features/structured-outputs)
- [OpenRouter free model limits](https://openrouter.ai/collections/free-models)
- [OpenRouter pricing](https://openrouter.ai/pricing)

**Teaching case only.** All determinations require review by a responsible human.
