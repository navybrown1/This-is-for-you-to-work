"""Maintainer smoke test for an actual HTTPS Harborline deployment.

Required: HARBORLINE_BASE_URL=https://your-deployment.example
Optional: CHROMIUM_EXECUTABLE_PATH, FINANCE_CLAIMS, FINANCE_EMPLOYEES.
The paired FINANCE_* paths refer to the September course dataset.

No source injection, route mocks, real API keys, or model inference are used.
The sole AI request contains "bad", a three-character non-key that the server
must reject before contacting a provider. Run only where browser automation
is permitted. This script is maintained here, not evidence of a completed run.
"""

import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get("HARBORLINE_BASE_URL", "").strip()
parsed_url = urlsplit(BASE_URL)
if (
    parsed_url.scheme != "https"
    or not parsed_url.hostname
    or parsed_url.username
    or parsed_url.password
):
    raise SystemExit("Set HARBORLINE_BASE_URL to the deployment's HTTPS URL.")

claims_path = os.environ.get("FINANCE_CLAIMS", "").strip()
employees_path = os.environ.get("FINANCE_EMPLOYEES", "").strip()
if bool(claims_path) != bool(employees_path):
    raise SystemExit("Set both FINANCE_CLAIMS and FINANCE_EMPLOYEES, or neither.")
for path in (claims_path, employees_path):
    if path and not Path(path).expanduser().is_file():
        raise SystemExit("An optional FINANCE_* path is not a readable file.")

checks = []
skipped = []
page_errors = []
api_requests = []

with sync_playwright() as playwright:
    launch_options = {"headless": True}
    executable_path = os.environ.get("CHROMIUM_EXECUTABLE_PATH", "").strip()
    if executable_path:
        launch_options["executable_path"] = executable_path
    browser = playwright.chromium.launch(**launch_options)
    page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
    page.set_default_timeout(10000)
    page.on("pageerror", lambda error: page_errors.append(str(error)))

    def record_api_request(request):
        if urlsplit(request.url).path == "/api/insights":
            # Never record request bodies, keys, headers, or private source rows.
            api_requests.append(request.method)

    def view(name):
        page.locator('nav [data-view="' + name + '"]').click()
        expect(page.locator('[data-pane="' + name + '"]')).to_be_visible()

    def preview():
        return json.loads(page.locator("#ai-payload-preview").text_content())

    page.on("request", record_api_request)

    try:
        response = page.goto(BASE_URL, wait_until="load", timeout=45000)
        assert response is not None and response.status == 200
        assert urlsplit(page.url).scheme == "https"
        view("overview")
        expect(page.locator("#demo")).to_be_visible()
        checks.append("Actual HTTPS deployment and application assets loaded")

        # Connection configuration is available before importing a dataset.
        view("ai")
        expect(page.locator("#ai-no-data")).to_be_visible()
        page.locator("#ai-connect-open").click()
        expect(page.locator("#ai-provider")).to_have_value("openrouter")
        expect(page.locator("#ai-model")).to_have_value("openrouter/free")
        provider_ids = page.locator("#ai-provider option").evaluate_all(
            "options => options.map(option => option.value)"
        )
        assert set(provider_ids) == {
            "openrouter", "openai", "anthropic", "gemini", "groq",
            "deepseek", "mistral", "xai", "custom"
        }
        page.locator("#ai-provider").select_option("anthropic")
        page.locator("#ai-key").fill("synthetic-not-a-valid-key")
        page.locator("#ai-provider").select_option("openai")
        expect(page.locator("#ai-key")).to_have_value("")
        page.locator("#ai-provider").select_option("custom")
        expect(page.locator("#ai-base-url")).to_be_visible()
        page.locator("#ai-base-url").fill("https://api.example.com/v1")
        page.locator("#ai-model").fill("example-model")
        page.locator("#ai-provider").select_option("openrouter")
        expect(page.locator("#ai-model")).to_have_value("openrouter/free")
        expect(page.locator("#ai-key")).to_have_value("")
        assert not api_requests
        checks.append("Nine connection choices work and provider changes clear the key")

        view("overview")
        page.locator("#demo").click()
        expect(page.locator("#kpi-claims")).to_have_text("10")
        expect(page.locator("#kpi-held")).to_have_text("8")
        expect(page.locator("#dataset-status")).to_contain_text("SAMPLE DATA")
        view("ai")
        expect(page.locator("#ai-local .ai-priority-card")).to_have_count(3)
        evidence = preview()["evidence"]
        assert evidence["summary"]["claims"] == 10
        serialized = json.dumps(evidence)
        for private_value in ("Demo Airline", '"employee_id"', '"description"', '"merchant"'):
            assert private_value not in serialized
        checks.append("Ten-claim demo, calculated priorities, and minimized evidence rendered")

        # Follow a real source row from the queue into its AI investigation.
        view("claims")
        first_claim = page.locator("#claim-body [data-row]").first
        claim_id = first_claim.text_content().strip()
        first_claim.click()
        expect(page.locator("#claim-dialog")).to_be_visible()
        expect(page.locator("#dialog-title")).to_have_text(claim_id)
        page.locator("#claim-investigate").click()
        expect(page.locator('[data-pane="ai"]')).to_be_visible()
        expect(page.locator("#ai-scope")).to_have_value("claim")
        assert preview()["evidence"]["scope"]["selected_claim_id"] == claim_id
        page.locator("#ai-open-source").click()
        expect(page.locator("#dialog-title")).to_have_text(claim_id)
        page.locator("#close-dialog").click()
        page.locator("#ai-claim-select").select_option("7")
        refund = preview()["evidence"]
        assert refund["scope"]["selected_claim_id"] == "DEMO-008"
        assert refund["claim_details"][0]["amount_usd"] == -12
        assert refund["claim_details"][0]["is_refund"] is True
        assert refund["example_priority_claims"] == []
        checks.append("Claim investigation links back to source details and supports refunds")

        page.locator('[data-ai-task="patterns"]').click()
        assert preview()["evidence"]["scope"]["type"] == "review"
        assert preview()["mode"] == "patterns"
        page.locator('[data-ai-task="analysis"]').click()
        page.locator("#ai-run").click()
        expect(page.locator("#ai-status")).to_contain_text("Enter the API key issued by")
        assert not api_requests, "The app sent an API request without a key."
        page.locator("#ai-key").fill("bad")
        page.locator("#ai-run").click()
        expect(page.locator("#ai-status")).to_contain_text("allow data sharing")
        assert not api_requests, "The app sent an API request without consent."
        checks.append("Missing-key and consent errors are visible and prevent requests")

        page.locator("#ai-consent").check()
        deployment_host = urlsplit(page.url).netloc
        with page.expect_response(
            lambda result: (
                urlsplit(result.url).netloc == deployment_host
                and urlsplit(result.url).path == "/api/insights"
                and result.request.method == "POST"
            ),
            timeout=15000,
        ) as rejected_response:
            page.locator("#ai-run").click()
        rejected = rejected_response.value
        assert rejected.status == 400, "The three-character non-key was not rejected."
        assert "API key issued by" in rejected.json().get("error", "")
        expect(page.locator("#ai-status")).to_contain_text("API key issued by")
        expect(page.locator("#ai-output")).to_be_hidden()
        expect(page.locator("#ai-export")).to_be_disabled()
        assert api_requests == ["POST"]
        checks.append("Live API rejects a non-key without displaying invented AI output")

        page.locator("#ai-clear-key").click()
        expect(page.locator("#ai-key")).to_have_value("")
        expect(page.locator("#ai-key")).to_have_attribute("type", "password")
        expect(page.locator("#ai-consent")).not_to_be_checked()
        checks.append("Clearing the key restores masking and resets sharing consent")

        view("import")
        page.locator("#scenario-receipt").fill("100")
        page.locator("#scenario-meal").fill("100")
        page.locator("#scenario-hotel").fill("350")
        page.locator("#scenario-run").click()
        expect(page.locator("#scenario-output")).to_be_visible()
        expect(page.locator("#scenario-output")).to_contain_text("not savings")
        view("overview")
        expect(page.locator("#kpi-held")).to_have_text("8")
        checks.append("Policy scenario preview leaves the active review unchanged")

        # Capture synthetic data only, before any optional real CSV import.
        page.screenshot(path=str(ROOT / "tests/screenshot-desktop.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        for name in ("overview", "claims", "ai", "import"):
            view(name)
            assert page.evaluate(
                "document.documentElement.scrollWidth <= window.innerWidth"
            ), "Mobile horizontal overflow in " + name
        view("ai")
        expect(page.locator("#ai-run")).to_be_visible()
        page.screenshot(path=str(ROOT / "tests/screenshot-mobile.png"), full_page=True)
        checks.append("All four workspace sections fit a 390-pixel mobile viewport")

        if claims_path and employees_path:
            view("import")
            page.locator("#reset").click()
            page.locator("#claims-file").set_input_files(
                str(Path(claims_path).expanduser().resolve())
            )
            page.locator("#employees-file").set_input_files(
                str(Path(employees_path).expanduser().resolve())
            )
            expect(page.locator("#run")).to_be_enabled()
            page.locator("#run").click()
            expect(page.locator("#kpi-claims")).to_have_text("675")
            expect(page.locator("#kpi-held")).to_have_text("127")
            expect(page.locator("#kpi-held-amount")).to_have_text("$33,970.16")
            expect(page.locator("#net-total")).to_have_text("$141,741.97")
            evidence = preview()["evidence"]
            assert evidence["summary"]["claims"] == 675
            assert evidence["summary"]["held"] == 127
            assert evidence["summary"]["positive_value_on_hold_usd"] == 33970.16
            assert api_requests == ["POST"], "Importing private CSVs triggered an AI request."
            checks.append("Optional September import reconciled all headline totals")
        else:
            skipped.append("September CSV import: FINANCE_* paths were not supplied")

        view("import")
        page.locator("#reset").click()
        expect(page.locator("#results")).to_be_hidden()
        expect(page.locator("#run")).to_be_disabled()
        view("ai")
        expect(page.locator("#ai-no-data")).to_be_visible()
        expect(page.locator("#ai-review-tools")).to_be_hidden()
        expect(page.locator("#ai-key")).to_have_value("")
        assert not page_errors, page_errors
        checks.append("Clearing the review invalidates its AI context with no page errors")
        print(json.dumps({
            "status": "PASS",
            "scope": "Actual HTTPS deployment smoke test; no real key or model inference",
            "checks_passed": len(checks),
            "checks": checks,
            "skipped": skipped,
            "page_errors": page_errors,
        }, indent=2))
    finally:
        browser.close()

