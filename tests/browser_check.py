"""Smoke-test a real HTTPS deployment without a real key or paid inference.

Required: HARBORLINE_BASE_URL=https://your-deployment.example
Optional: CHROMIUM_EXECUTABLE_PATH, FINANCE_CLAIMS, FINANCE_EMPLOYEES
The two FINANCE_* paths must be supplied together and refer to the September
course dataset. Source code, network responses, and AI findings are not mocked.
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
    page = browser.new_page(
        viewport={"width": 1440, "height": 900}, device_scale_factor=1
    )
    page.set_default_timeout(10000)
    page.on("pageerror", lambda error: page_errors.append(str(error)))

    def record_api_request(request):
        if urlsplit(request.url).path == "/api/insights":
            # Only record the method. Never capture keys or request bodies.
            api_requests.append(request.method)

    page.on("request", record_api_request)

    try:
        response = page.goto(BASE_URL, wait_until="load", timeout=45000)
        assert response is not None and response.status == 200, (
            "The deployment did not return HTTP 200."
        )
        assert urlsplit(page.url).scheme == "https", "HTTPS was not preserved."
        expect(page.locator("#demo")).to_be_visible()
        checks.append("Actual HTTPS deployment and application assets loaded")

        page.locator("#demo").click()
        expect(page.locator("#kpi-claims")).to_have_text("10")
        expect(page.locator("#ai-local .ai-stat")).to_have_count(3)
        evidence = json.loads(page.locator("#ai-payload-preview").text_content())
        serialized_evidence = json.dumps(evidence)
        assert "DEMO-004" in serialized_evidence
        assert "Demo Airline" not in serialized_evidence
        assert "employee_id" not in serialized_evidence
        checks.append("Ten-claim demo and minimized AI evidence rendered")

        page.locator("#ai-run").click()
        expect(page.locator("#ai-status")).to_contain_text(
            "Enter your OpenRouter API key"
        )
        assert not api_requests, "An API request was sent without a key."

        # Intentionally too short to pass server validation. This is not a key.
        page.locator("#ai-key").fill("invalid-short")
        page.locator("#ai-run").click()
        expect(page.locator("#ai-status")).to_contain_text("consent")
        assert not api_requests, "An API request was sent without consent."
        checks.append("Missing-key and consent gates prevent API requests")

        page.locator("#ai-consent").check()
        deployment_host = urlsplit(page.url).netloc
        with page.expect_response(
            lambda result: (
                urlsplit(result.url).netloc == deployment_host
                and urlsplit(result.url).path == "/api/insights"
                and result.request.method == "POST"
            ),
            timeout=15000,
        ) as invalid_key_response:
            page.locator("#ai-run").click()
        rejected = invalid_key_response.value
        assert rejected.status == 400, "Short invalid key was not rejected."
        assert "valid OpenRouter API key" in rejected.json().get("error", "")
        expect(page.locator("#ai-status")).to_contain_text("valid OpenRouter API key")
        assert api_requests == ["POST"], "Unexpected number of AI requests."
        checks.append("Live API route rejects a short non-key before inference")

        page.locator("#ai-clear-key").click()
        expect(page.locator("#ai-key")).to_have_value("")
        expect(page.locator("#ai-key")).to_have_attribute("type", "password")
        checks.append("Clear key removes the input and restores masking")

        page.screenshot(path=str(ROOT / "tests/screenshot-desktop.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        expect(page.locator("#ai-run")).to_be_visible()
        expect(page.locator("#claims-file")).to_be_visible()
        assert page.evaluate(
            "document.documentElement.scrollWidth <= window.innerWidth"
        ), "The mobile page overflows horizontally."
        page.screenshot(path=str(ROOT / "tests/screenshot-mobile.png"), full_page=True)
        checks.append("Desktop and 390-pixel mobile layout checks passed")

        if claims_path and employees_path:
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
            evidence = json.loads(page.locator("#ai-payload-preview").text_content())
            assert evidence["summary"]["claims"] == 675
            assert evidence["summary"]["held"] == 127
            assert evidence["summary"]["positive_value_on_hold_usd"] == 33970.16
            assert len(evidence["example_priority_claims"]) <= 18
            assert api_requests == ["POST"], "Private import triggered an AI request."
            checks.append("Optional September CSV import reconciled all headline totals")
        else:
            skipped.append("September CSV import: FINANCE_* paths were not supplied")

        page.locator("#ai-clear-key").click()
        page.locator("#reset").click()
        expect(page.locator("#ai-key")).to_have_value("")
        expect(page.locator("#results")).to_be_hidden()
        expect(page.locator("#run")).to_be_disabled()
        assert not page_errors, page_errors
        checks.append("Review cleared with no uncaught JavaScript errors")
        print(json.dumps({
            "status": "PASS",
            "scope": "Real deployment smoke test; no real key or model inference",
            "checks_passed": len(checks),
            "checks": checks,
            "skipped": skipped,
            "page_errors": page_errors,
        }, indent=2))
    finally:
        # Also attempt cleanup if an assertion failed midway through the test.
        if not page.is_closed():
            for selector in ("#ai-clear-key", "#reset"):
                try:
                    if page.locator(selector).count():
                        page.locator(selector).click(timeout=1000)
                except Exception:
                    pass
        browser.close()
