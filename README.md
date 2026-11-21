# Harborline Finance AI

An evidence-first **expense compliance checker** with optional AI-assisted review, built for the *CIS 9559 AI for Business* finance teaching case. Built with plain JavaScript and a small Vercel serverless function. No database, account signup, or third-party client packages.

## Quick start

1. Open the deployed site, or open `index.html` with `ai-insights.js` in the same directory for **local** screening. Live AI features require a deployment with `/api/insights`.
2. Choose `expense_claims_sep.csv` under **Expense claims** and `employees.csv` under **Employee reference**. These files come from the separate, privately distributed course pack; **not from this public repository**.
3. Click **Check claims**. Read held-claim explanations, departmental summaries, and the data-quality notes. Export a review CSV if needed.
4. The **Intelligence desk** immediately shows calculated review priorities without a key or network request.
5. Optional AI: enter your **OpenAI API key**, choose an available model, inspect the JSON evidence preview, tick the explicit consent box, then click **Generate AI executive review** or **Ask AI**.
6. Click **Clear key** or close the tab to remove the entered key. The app does not persist it in localStorage, a database, repository, or Vercel environment variables.

**Try the app without any files:** Use **Explore with synthetic demo data**, which loads ten explicitly fictitious claims and four fictitious employees. This is not the course dataset.

## Features

- Eight policy rules: submit-date window, receipts, daily meals, hotel nights, airfare approvals, entertainment details/approvals, possible splits, and possible duplicates.
- Retains all source claims, including refunds and data-quality exceptions; monetary totals are integer-cent based and reconcile to source rows.
- Searchable review queue with claim-level evidence, CSV export, department summaries, policy controls, printing, and privacy-conscious synthetic demo.
- **Offline local intelligence**: review share, held value, department concentration, and first-to-inspect claims by a documented heuristic. It is not a fraud score.
- **Optional OpenAI**: a structured executive review with findings, cited claim IDs and rule codes, action list, limitations, and follow-up questions based on *reduced evidence only*.
- Supported models: `gpt-6-luna` (default) and `gpt-6.2-astra` (advanced). Model access and API fees depend on the key holder's account.

## Key and data privacy

**Local screening sends no CSV data to any server.** The optional AI request sends the entered key and a **reduced JSON snapshot** via HTTPS to this app's same-origin Vercel function (`api/insights.js`), which forwards it to OpenAI's Responses API. The snapshot contains summary totals, policy thresholds, up to 16 department aggregates, policy and data-rule counts, data-quality counts, and up to 18 claim ID/source-row/amount/rule examples. Explicit coverage counts disclose every truncation; examples are selected priorities, not a representative sample. It excludes CSV bytes, employee names and IDs, merchants, raw descriptions, and HR records. The exact JSON is visible before sending. Consent is required for **each newly loaded review**. The AI route requests `store: false` from OpenAI. This does not override OpenAI's API privacy or abuse-monitoring policies.

The app holds a user-provided API key in the page until cleared or the tab closes. During an AI request it also passes through the Vercel function and to OpenAI; the application does not persist or log it. **Never paste a real API key into source code, GitHub issues, screenshots, or chat messages.** This is a public demo, so use an API key with appropriate limits. OpenAI charges API usage according to the account; these charges are distinct from ChatGPT subscriptions.

The OpenAI prompt instructs the model to treat data as untrusted evidence and not to invent facts, approvals, losses, or fraud claims. AI output is not a substitute for verifying receipts, management approvals, policy versions, and accounting history. No claim is automatically approved or rejected.

## Deploy to Vercel

Connect this GitHub repository as a new Vercel project with the **Other** framework preset. No build command, special output directory, or API environment variables are required. Vercel serves `index.html` and `ai-insights.js` statically, and deploys `api/insights.js` as a Node serverless function. `vercel.json` sets a 60-second function limit and security headers. Node.js 22 is pinned. Preview and individual deployment URLs retain Vercel authentication; the production domain is public. `.vercelignore` keeps tests and documentation out of the served site.

## Verification

- Original finance engine: 68 independent logic and edge-case regression checks passed using the September course dataset and provided fixtures.
- API/data minimization: nine automated tests in `tests/ai.test.cjs` passed, including malformed model output, refusals, partial-output rejection, and evidence coverage.
- `tests/browser_check.py` checks an actual HTTPS deployment, local demo behavior, API-key and consent gates, server rejection of a deliberately invalid short key, responsive layout, and optional September CSV uploads. It never makes a paid AI call. Run it with `HARBORLINE_BASE_URL` set to the deployment URL; supply `FINANCE_CLAIMS` and `FINANCE_EMPLOYEES` for the optional private dataset check.
- **A live OpenAI call with a real paid key has not been made.** Mock responses demonstrate the interface and proxy contract without charging anyone. Check the first production API request with a key before relying on AI output.

Run unit tests with `npm test` (Node.js 22). The optional browser test is at `tests/browser_check.py` and uses an installed Playwright/Chromium environment; it is not part of the deployment.

## AI request reliability

The proxy uses Structured Outputs, a low reasoning effort and an 8,000-token total output budget. Requests time out after 55 seconds on the server and 65 seconds in the browser. Duplicate submissions are blocked while a request is active. Refusals, malformed findings, and incomplete responses produce explicit errors rather than partial findings. Timeouts and incomplete responses can still incur provider usage; the app does not automatically retry. These limits are engineering choices, not latency guarantees.

## Provenance / sources

- Local case policy: `TE_Policy.docx` from the user's finance assignment package (not publicly distributed in the repository).
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) and [GPT-6.2 Astra](https://developers.openai.com/api/docs/models/gpt-6.2-astra)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Reasoning tokens and output budgets](https://developers.openai.com/api/docs/guides/reasoning)
- [OpenAI API pricing](https://platform.openai.com/pricing/)

**Teaching case only.** All determinations require review by a responsible human.
