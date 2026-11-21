# Harborline Finance · 3.0

An expense review workspace with local policy checks, traceable AI investigations, and a choice of AI providers.

**Production:** https://harborline-finance-ai.vercel.app

**Repository:** https://github.com/navybrown1/This-is-for-you-to-work

## The workspace

- **Overview:** current-review totals, reconciliation, calculated priorities, review coverage, departments, and policy signals. Department and rule controls open filtered claims.
- **Claim queue:** search every source row and inspect original values, hold reasons, related claims, and an investigation action.
- **AI workbench:** configure a provider before importing data, select evidence, run a specific task, inspect sources, ask follow-ups, and export a brief.
- **Data & policy:** import files, check settings, inspect data quality, and compare a draft policy scenario without changing the active review.

The interface has a persistent navigation rail, a distinct editorial landing view, an evidence dashboard, responsive layouts, keyboard controls, reduced-motion support, and explicit sample-data labels. Sample results never load automatically.

## Getting started and locating the data

1. Open **Data & policy**.
2. Select the claims CSV and employee reference CSV.
3. Select **Run review**. Every source row is checked locally.
4. Inspect **Claim queue**, or select a department, policy signal, or priority claim from Overview.
5. Optionally configure **AI workbench → AI connection**, then choose a task, inspect its evidence preview, and allow sharing before requesting AI.

For the course case, use `expense_claims_sep.csv` and `employees.csv` from the original package's `Data` folder. They are not embedded in the public app or repository. **Explore sample review** explicitly loads ten synthetic claims.

Required claims columns:

```text
claim_id,employee_id,expense_date,submit_date,category,merchant,amount_usd,receipt_attached,nights,fare_class,preapproval_id,attendees,description
```

Required employee columns:

```text
employee_id,department,office,level,cost_center
```

The checker preserves original strings and every source row. It does not guess missing values, remove suspected duplicates, or silently assign unmatched employees to a department.

## Connect your own AI service

Choose a provider and enter a key issued by that provider. Every model ID is editable. Presets are starting points, not guarantees of account access, remaining quota, or continued model availability.

| Connection | Initial model | API |
| --- | --- | --- |
| OpenRouter | `openrouter/free` | Chat Completions |
| OpenAI | `gpt-4.1-mini` | Chat Completions |
| Anthropic Claude | `claude-sonnet-4-6` | Native Messages |
| Google Gemini | `gemini-3.8-flash` | Native `generateContent` |
| Groq | `openai/gpt-oss-20b` | Chat Completions |
| DeepSeek | `deepseek-flash` | Chat Completions |
| Mistral | `mistral-small-latest` | Chat Completions |
| xAI Grok | `grok-4.7` | Chat Completions |
| Custom compatible endpoint | User-entered model | Public HTTPS Chat Completions with Bearer authentication |

OpenRouter defaults to `openrouter/free`, which selects available free models supporting the requested features. Free limits and availability apply. There is **no automatic paid fallback**. Users can explicitly select another model, including a paid one.

For a custom service, enter its API base URL and exact model ID. Harborline appends `/chat/completions` unless already present. The custom adapter expects a standard Chat Completions response, public HTTPS on port 443, and Bearer authentication. Embedded credentials, query parameters, redirects, and private/local addresses are rejected. Azure-specific authentication, local servers, non-chat APIs, and custom headers require dedicated adapters.

**Test connection** sends a tiny test prompt without claims, user questions, or conversation history. The provider may charge for this request. A successful test confirms completed text generation for that key/model; it does not prove every larger report or structured-output feature will succeed.

Keys are kept only in page memory. They are never saved in cookies, browser storage, source files, environment variables, or a database. Switching providers clears the key. Key clearing and page exit abort pending browser requests; page exit also clears the secret for back/forward-cache transitions. No real key is included in the repository or tests.

## Useful AI tasks

| Task | Result |
| --- | --- |
| Review brief | Material holds, supporting evidence, and concrete next checks for the current review. |
| Investigate a claim | An explanation of that claim's flags, exact policy facts, related claims, missing evidence, and verification steps. |
| Find the pattern | Comparison of supplied duplicate, split-purchase, and meal-limit groups with alternative explanations and document checks. |
| Draft a follow-up | A neutral, editable request for the evidence needed on a selected claim. Nothing is sent. |
| Ask a follow-up | A question answered within the current evidence scope, with up to three recent, shortened exchanges in context. |

Every claim is selectable, including refunds, invalid amounts, and claims without flags. Source-row labels distinguish repeated identifiers. **Investigate with AI** in a claim's details opens that exact claim's scope without sending a request automatically.

Findings can cite source rows. The server rejects citations outside the supplied evidence; the client links valid references to original claim details. This validates references, not every interpretation. Reviewers still check the reasoning.

Reports contain a summary, findings with evidence and next checks, next steps, limitations, and an answer or draft. Output is rendered as text. Exported Markdown briefs include provider, model, task, scope, generation time, source rows, coverage, and an AI-origin label. Model-authored links, images, and HTML are escaped.

AI does not approve, deny, resolve, or send claims. A priority is an amount-and-flag review heuristic, not a fraud probability. The AI is instructed to distinguish observations from hypotheses and to avoid unsupported amounts, allegations, approvals, and conclusions.

## Evidence scope and privacy

CSV parsing and policy checks run in the browser. Requesting AI sends reduced evidence through the same-origin Vercel function to the selected API service. The API key goes only to that selected service. For OpenRouter, the prompt may then be routed to a model provider; Harborline does not forward the user's OpenRouter key directly to that model provider.

Automatic evidence contains full-review aggregates, policy settings, rule and data quality counts, up to 16 departments, and explicitly scoped examples:

- **Review scope:** up to 18 positive held examples and their policy facts.
- **Claim scope:** the selected claim plus up to 24 related claims; no unrelated priority examples.
- **Patterns:** relevant groups, bounded member lists, and disclosed omissions.

Claim IDs, source rows, amounts, categories, departments, validity/presence indicators, and exact numeric policy facts are included. Automatic evidence omits employee-ID fields, employee names, merchant names, raw descriptions, approval IDs, and original CSV files.

**User-authored questions and recent conversation are included as previewed. They may contain information the user types and are not automatically redacted.** The full preview is visible before sharing consent.

Overall totals always describe the complete current review, even in a selected-claim investigation. Selected examples are not a representative sample. Larger detail lists can be reduced to fit the request budget, with coverage disclosed. The selected claim and full-review totals are preserved.

Provider, model, endpoint, data, or scope changes abort pending requests, reset consent, and invalidate previous context/results where appropriate. Late responses cannot replace newer work. Canceling a request does not guarantee that the provider stops processing or reverses charges already incurred.

The application does not persist or log keys, prompts, or generated responses. Hosting infrastructure may retain request metadata; API services and routing providers may retain content under their own policies.

## Finance calculations and policy scenarios

The original eight policy rules and data quality checks remain intact. Money is stored in integer cents. Refunds, unmatched references, malformed amounts, and suspected duplicates remain visible.

Receipt thresholds include the exact boundary; the submission-day limit is inclusive. Hotel checks compare total cents against nights multiplied by the cap, so a rounded nightly average cannot hide a one-cent excess. Refunds reduce net totals without offsetting positive meal or receipt/split spending. Department totals reconcile without counting held claims twice. CSV exports escape formula-like text while preserving numeric credits.

**Policy lab** compares draft receipt, meal, and hotel thresholds using the same calculation engine. It shows changes to hold counts and positive held value, plus links to affected source claims. Active settings, current results, and AI evidence remain unchanged. A reduced held value is a screening difference, not established savings. Policy changes require controller authorization.

Original September validation:

| Measure | Expected value |
| --- | ---: |
| Claims | 675 |
| Employees | 150 |
| Unique held claims | 127 |
| Positive value held | $33,970.16 |
| Positive submitted value | $142,339.52 |
| Credits and refunds | -$597.55 |
| Net submitted value | $141,741.97 |

## Development and verification

Production is a static page and a Node.js 22 Vercel function, with no application runtime dependencies. `jsdom` is development-only. Its supported Node versions include 22.22.2+ and 24.15.0+ for those major versions.

```bash
npm ci
npm test
```

Tests cover policy boundaries, exact cents, refunds, malformed input, CSV safety, reconciliation, each provider adapter, scoped evidence, privacy, budgets, citations, key/consent gates, cancellation, stale responses, navigation, and scenario isolation. The optional September test reads the course files locally if available; source data is never committed. The original independent 68-case suite was also run against this finance engine, including all 675 expected claim rows.

Provider tests use controlled HTTP doubles. DOM tests run actual shipped scripts with controlled responses in a simulated DOM. **These do not establish rendered browser/mobile layouts or successful calls with real account keys.** Authenticated generation requires a valid key and model access.

`tests/browser_check.py` is a separate maintainer smoke test for an actual HTTPS deployment. It exercises real desktop/mobile layouts without source injection or real provider inference. Run only where browser automation is permitted:

```bash
HARBORLINE_BASE_URL=https://harborline-finance-ai.vercel.app \
  python tests/browser_check.py
```

This optional script requires Playwright and an installed Chromium browser. Optional `FINANCE_CLAIMS` and `FINANCE_EMPLOYEES` point to the September files. The presence of this script does not mean it ran for every release.

### Source map

- `index.html`: page structure and retained deterministic finance engine.
- `styles.css`: responsive design, print layout, and accessibility states.
- `workspace.js`: navigation, overview interactions, and policy scenarios.
- `providers.js`: public provider presets shared by client and server, without keys.
- `ai-insights.js`: evidence, connection UI, request lifecycle, conversation, output, and exports.
- `api/insights.js`: provider relay and validated reports.
- `tests/`: core, evidence, provider, integration, DOM, and optional real-browser checks.
- `vercel.json`: function timeout and response security headers.

## Server boundaries

The relay accepts same-origin POST requests, returns no-store responses, validates inputs, bounds request/response size, applies an upstream deadline, and refuses redirects. Named providers have fixed destinations. Invalid inputs fail before model calls.

Custom endpoints receive public-address checks on every DNS result. The validated address is pinned to the TLS connection while retaining hostname verification. Private, reserved, mapped, tunnel, local, and redirect targets are rejected.

Limits: 70,000 request bytes; 48,000 evidence bytes; 1,200 question characters; six history messages of at most 3,000 characters; 512,000 response bytes; and a 55-second upstream deadline within the 60-second function limit. Browser evidence is bounded before submission. Empty, truncated, refused, or malformed results produce errors, never fabricated output.

## Deployment

The existing Vercel project follows `main`. Framework is Other, with no application build command, no required environment secrets, and a public production alias. Confirm the deployment's exact Git commit before calling a release complete.

Keep source CSVs, course workbooks, keys, `.env` files, and private exports out of Git and deployment artifacts. Ignore files already exclude them. This app does not submit coursework to Brightspace.

## Official implementation references

API details and model availability change. These primary references were checked for the 3.0 repair:

1. [OpenRouter Free Models Router](https://openrouter.ai/openrouter/free)
2. [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
3. [OpenAI GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
4. [OpenAI Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
5. [Claude Sonnet 4.6](https://platform.claude.com/docs/en/models/sonnet-4-6/overview)
6. [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
7. [Gemini models and pricing](https://ai.google.dev/gemini-api/docs/pricing)
8. [Gemini GenerateContent API](https://ai.google.dev/api/generate-content)
9. [Groq supported models](https://console.groq.com/docs/models)
10. [DeepSeek API](https://api-docs.deepseek.com/)
11. [Mistral API](https://docs.mistral.ai/api)
12. [xAI Grok 4.7](https://docs.x.ai/developers/models/grok-4.7)

Harborline Logistics is a CIS 9559 AI for Business teaching case. Policy effective January 1, 2026. Human reviewers remain responsible for receipts, approval authority, complete periods, and reimbursement decisions.
