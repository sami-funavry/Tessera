"""
Demo page UX verification.

Goals:
  1. /demo loads with the page scrolled to TOP (window.scrollY ~ 0).
  2. Streaming events do NOT scroll the window down. After events appear,
     window.scrollY is still ~ 0.
  3. The log container does its own auto-scroll to the top (where new entries
     land) — log container.scrollTop stays near 0 after a fresh event.
  4. A "Clear" button is present, accessible, and toggles the log between
     populated and empty states.
  5. Triggering scenarios injects per-run separator markers ("Run N · …"),
     visible between event groups.

The dev server must already be running on :3000.
"""

from playwright.sync_api import sync_playwright
import re
import sys
import time


BASE = "http://localhost:3000"
results: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    mark = "OK" if ok else "FAIL"
    print(f"[{mark}] {name}{(' — ' + detail) if detail else ''}", flush=True)


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        page = ctx.new_page()

        # 0) Force at least one row to exist so the log isn't empty during the test.
        ctx.request.post(f"{BASE}/api/scenarios/honest", headers={"Origin": BASE}, timeout=120_000)
        time.sleep(2)

        # 1) Navigate to /demo from a different page first, with the prior page
        #    scrolled to the bottom — that way we'd notice if the new page
        #    inherits scroll position or auto-scrolls down.
        page.goto(f"{BASE}/dashboard")
        page.wait_for_load_state("networkidle")
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        time.sleep(0.5)

        page.goto(f"{BASE}/demo")
        page.wait_for_load_state("networkidle")
        time.sleep(2)  # let realtime fetch land
        scroll_y_initial = page.evaluate("window.scrollY")
        record(
            "demo page opens at top (window.scrollY < 50 after navigation)",
            scroll_y_initial < 50,
            f"scrollY={scroll_y_initial}",
        )

        # 2) Find the log container. It's the only `.overflow-y-auto.max-h-96` in the page.
        log_locator = page.locator("div.overflow-y-auto.max-h-96").first
        log_locator.wait_for(state="visible", timeout=5_000)
        log_handle = log_locator.element_handle()
        assert log_handle is not None
        # Grab any prior content — the log might already have entries from earlier scenario runs.
        events_before = page.locator("div.overflow-y-auto.max-h-96 [class*='py-0.5']").count()
        record("log container is rendered", events_before >= 0, f"events_before={events_before}")

        # 3) Clear button present and labelled.
        clear_btn = page.get_by_role("button", name=re.compile(r"clear", re.I))
        record("clear button visible", clear_btn.first.is_visible())
        # Click it — the log should now show the empty-state hint.
        clear_btn.first.click()
        time.sleep(0.4)
        empty_msg = page.get_by_text(re.compile(r"No events yet", re.I))
        record("after clear: empty-state hint shown", empty_msg.is_visible())
        # And the disabled attr should now be set on the clear button.
        is_disabled = clear_btn.first.is_disabled()
        record("after clear: clear button disabled", is_disabled)

        # 4) Trigger an honest scenario via the actual button (which is what
        #    inserts the in-page run separator). The window must NOT scroll.
        before_y = page.evaluate("window.scrollY")
        page.get_by_role("button", name=re.compile(r"Honest delivery", re.I)).first.click()
        # Background pipeline takes a few seconds to flush events.
        time.sleep(10)

        after_y = page.evaluate("window.scrollY")
        record(
            "scenario run does not scroll the page",
            abs(after_y - before_y) < 50,
            f"before={before_y} after={after_y}",
        )

        # Run 1 separator visible
        sep1 = page.get_by_role("separator", name=re.compile(r"Run 1 ", re.I))
        record("Run 1 separator rendered", sep1.first.is_visible())

        # Number of event rows should now be > 0
        events_after = page.locator("div.overflow-y-auto.max-h-96 [class*='py-0.5']").count()
        record("events visible after scenario", events_after > 0, f"events_after={events_after}")

        # 5) Trigger a second scenario to verify the run counter increments.
        # Wait briefly so the previous run's button-disabled state clears.
        page.wait_for_function(
            "() => !document.querySelector('button[disabled] .lucide-circle-dot')",
            timeout=20_000,
        )
        page.get_by_role("button", name=re.compile(r"Honest delivery", re.I)).first.click()
        time.sleep(10)
        sep2 = page.get_by_role("separator", name=re.compile(r"Run 2 ", re.I))
        record("Run 2 separator rendered", sep2.first.is_visible())

        # 6) Log container auto-scroll: scrollTop should stay near 0 because new
        #    events land at the TOP of the descending list. Capture container scrollTop.
        log_scroll_top = page.evaluate("(el) => el.scrollTop", log_handle)
        record(
            "log container is at top (scrollTop < 80)",
            log_scroll_top < 80,
            f"scrollTop={log_scroll_top}",
        )

        # 7) Window scroll never moved during the whole flow.
        final_y = page.evaluate("window.scrollY")
        record(
            "window.scrollY remained stable throughout",
            final_y < 50,
            f"final_y={final_y}",
        )

        page.screenshot(path="/tmp/tessera-demo-after.png", full_page=False)
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
