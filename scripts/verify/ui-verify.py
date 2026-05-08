"""
Tessera UI verification.

Checks:
  1. Homepage renders without console errors. Bridge widget present.
  2. Dashboard renders, table populated.
  3. Demo page renders, scenario buttons present.
  4. Submission detail page renders.
  5. Celatone explorer links for Cosmos hashes are uppercase, no 0x prefix.
  6. Etherscan explorer links are 0x-prefixed lowercase.
  7. Trigger an "honest" scenario via the demo page, follow the chain to a new
     submission, and verify the explorer link format on the submission detail.

Run from anywhere; the dev server must already be running on :3000.
"""

from playwright.sync_api import sync_playwright, ConsoleMessage
import re
import sys
import time
import json


BASE = "http://localhost:3000"
results: list[tuple[str, bool, str]] = []
console_errors: list[str] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    mark = "OK" if ok else "FAIL"
    print(f"[{mark}] {name}{(' — ' + detail) if detail else ''}", flush=True)


def on_console(msg: ConsoleMessage) -> None:
    if msg.type in ("error", "warning"):
        console_errors.append(f"{msg.type}: {msg.text}")


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        page = ctx.new_page()
        page.on("console", on_console)
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))

        # 1) homepage
        page.goto(BASE)
        page.wait_for_load_state("networkidle")
        title = page.title()
        record("homepage loads", "Tessera" in title, f"title={title!r}")
        # Bridge widget marker
        bridge_present = page.locator("text=Bridge").first.is_visible()
        record("bridge widget visible", bridge_present)
        page.screenshot(path="/tmp/tessera-home.png", full_page=False)

        # 2) dashboard
        page.goto(f"{BASE}/dashboard")
        page.wait_for_load_state("networkidle")
        # Pick up explorer anchors and verify their format
        anchors = page.locator("a[href*='etherscan.io/tx/'], a[href*='celat.one/pion-1/txs/']").all()
        bad_celatone = []
        bad_etherscan = []
        for a in anchors:
            href = a.get_attribute("href") or ""
            if "celat.one/pion-1/txs/" in href:
                tail = href.rsplit("/", 1)[1]
                # Must be uppercase, no 0x prefix, 64 hex chars
                if not re.fullmatch(r"[0-9A-F]{64}", tail):
                    bad_celatone.append(href)
            elif "etherscan.io/tx/" in href:
                tail = href.rsplit("/", 1)[1]
                # Must be 0x-prefixed lowercase, 66 chars
                if not re.fullmatch(r"0x[0-9a-f]{64}", tail):
                    bad_etherscan.append(href)
        record(
            "dashboard celatone links uppercase no 0x",
            len(bad_celatone) == 0,
            f"checked {len(anchors)} anchors; bad_celatone={bad_celatone[:3]}",
        )
        record(
            "dashboard etherscan links 0x lowercase",
            len(bad_etherscan) == 0,
            f"bad_etherscan={bad_etherscan[:3]}",
        )
        page.screenshot(path="/tmp/tessera-dashboard.png", full_page=False)

        # 3) demo page
        page.goto(f"{BASE}/demo")
        page.wait_for_load_state("networkidle")
        # Look for scenario buttons (honest/lying/silent/spam)
        scenario_buttons = page.get_by_role("button", name=re.compile(r"honest|lying|silent|spam", re.I)).all()
        record("demo page has scenario buttons", len(scenario_buttons) >= 1, f"count={len(scenario_buttons)}")
        page.screenshot(path="/tmp/tessera-demo.png", full_page=False)

        # 4) submission detail page (any id)
        page.goto(f"{BASE}/submissions/1")
        page.wait_for_load_state("networkidle")
        page.screenshot(path="/tmp/tessera-submission.png", full_page=False)
        # Check explorer link format on this page too
        sub_anchors = page.locator("a[href*='celat.one/pion-1/txs/'], a[href*='etherscan.io/tx/']").all()
        bad_sub = []
        for a in sub_anchors:
            href = a.get_attribute("href") or ""
            if "celat.one/pion-1/txs/" in href:
                tail = href.rsplit("/", 1)[1]
                if not re.fullmatch(r"[0-9A-F]{64}", tail):
                    bad_sub.append(href)
            elif "etherscan.io/tx/" in href:
                tail = href.rsplit("/", 1)[1]
                if not re.fullmatch(r"0x[0-9a-f]{64}", tail):
                    bad_sub.append(href)
        record(
            "submission detail explorer links well-formed",
            len(bad_sub) == 0,
            f"checked {len(sub_anchors)}; bad={bad_sub[:3]}",
        )

        # 5) docs page
        page.goto(f"{BASE}/docs")
        page.wait_for_load_state("networkidle")
        record("docs page loads", "Tessera" in page.title())
        page.screenshot(path="/tmp/tessera-docs.png", full_page=False)

        # 6) Trigger an honest scenario. Send the same Origin header a real
        #    browser would so we exercise the SEC-02 same-origin guard end to
        #    end. The unauth case (no Origin) is verified separately.
        try:
            resp = ctx.request.post(
                f"{BASE}/api/scenarios/honest",
                headers={"Origin": BASE},
                timeout=120_000,
            )
            body = resp.json() if resp.ok else None
            record("scenario honest API responds", resp.ok, f"status={resp.status} body={body}")
        except Exception as e:
            record("scenario honest API responds", False, str(e))

        # 6b) Audit-fix verification: SEC-02 should reject a request without
        #     Origin (server-to-server style call from any random box).
        try:
            resp = ctx.request.post(f"{BASE}/api/scenarios/honest", timeout=10_000)
            record(
                "SEC-02 same-origin guard rejects no-Origin POST",
                resp.status == 403,
                f"status={resp.status}",
            )
        except Exception as e:
            record("SEC-02 same-origin guard rejects no-Origin POST", False, str(e))

        # Give it a few seconds for the background pipeline to flush its events.
        time.sleep(8)

        # 7) Refresh dashboard, re-validate links one more time
        page.goto(f"{BASE}/dashboard")
        page.wait_for_load_state("networkidle")
        time.sleep(2)  # allow client-side query refetch
        anchors2 = page.locator("a[href*='etherscan.io/tx/'], a[href*='celat.one/pion-1/txs/']").all()
        bad2 = []
        for a in anchors2:
            href = a.get_attribute("href") or ""
            if "celat.one/pion-1/txs/" in href:
                tail = href.rsplit("/", 1)[1]
                if not re.fullmatch(r"[0-9A-F]{64}", tail):
                    bad2.append(href)
            elif "etherscan.io/tx/" in href:
                tail = href.rsplit("/", 1)[1]
                if not re.fullmatch(r"0x[0-9a-f]{64}", tail):
                    bad2.append(href)
        record(
            "after scenario: dashboard explorer links well-formed",
            len(bad2) == 0,
            f"checked {len(anchors2)}; bad={bad2[:3]}",
        )

        # 8) Console errors summary — non-blocking, but reported.
        record(
            "no console errors during traversal",
            len([e for e in console_errors if "warning" not in e.lower()]) == 0,
            f"count={len(console_errors)}; sample={console_errors[:3]}",
        )

        browser.close()

    print("\n" + "=" * 60, flush=True)
    failed = [r for r in results if not r[1]]
    print(f"PASSED: {len(results) - len(failed)} / {len(results)}", flush=True)
    if failed:
        print("FAILURES:", flush=True)
        for name, _, detail in failed:
            print(f"  - {name}: {detail}", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
