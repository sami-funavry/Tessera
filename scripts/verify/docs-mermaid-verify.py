"""
Verify the Tessera /docs page renders Mermaid diagrams correctly across all
sections. Pass condition: every section that should have a diagram does, and
mermaid produces a real <svg> (not an error placeholder).
"""

from playwright.sync_api import sync_playwright
import sys
import time


SECTIONS_WITH_DIAGRAMS = {
    "overview": 1,        # system architecture
    "how": 2,             # two pipelines
    "trust": 1,           # trust layers
    "crypto": 4,          # patricia, iavl, transform, ed25519
    "architecture": 1,    # relayer process
    "database": 2,        # ER + status FSM
    "wallets": 1,         # wallet flow
    "relayer": 2,         # lifecycle FSM + role assignment
    "addchain": 1,        # plugin pattern
}


def main() -> int:
    failures: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
        page = ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)

        page.goto("http://localhost:3000/docs", wait_until="networkidle")
        time.sleep(1)

        # Click into each section and count rendered SVGs.
        for section_id, expected_min in SECTIONS_WITH_DIAGRAMS.items():
            # Sidebar buttons are buttons with the section title text. We click by text.
            # Easier: navigate by clicking each sidebar button (the pages use client-state).
            # We have button labels — find by selector matching section IDs is tricky;
            # use index lookup: find the button whose text matches a known title.
            title_map = {
                "overview": "Overview",
                "how": "How it works",
                "trust": "Trust model",
                "crypto": "Cryptography",
                "architecture": "Architecture",
                "database": "State & database",
                "wallets": "Wallet setup & tUSDC",
                "relayer": "Run a relayer",
                "addchain": "Add a chain",
            }
            title = title_map[section_id]
            page.get_by_role("button", name=title).first.click()
            # Wait for mermaid to render (client-side dynamic import + render).
            time.sleep(2.5)

            # Count <svg> elements (these come from mermaid output).
            svg_count = page.locator("main svg").count()
            ok = svg_count >= expected_min
            mark = "OK" if ok else "FAIL"
            print(f"[{mark}] /docs#{section_id}: svg_count={svg_count} (expected >= {expected_min})", flush=True)
            if not ok:
                failures.append(f"{section_id}: got {svg_count} svgs, expected >= {expected_min}")

            # Look for "Diagram error:" text — would indicate a mermaid parse failure.
            err = page.locator("text=Diagram error").count()
            if err > 0:
                err_text = page.locator("text=Diagram error").first.text_content()
                print(f"[FAIL] /docs#{section_id}: mermaid error: {err_text!r}", flush=True)
                failures.append(f"{section_id}: mermaid error: {err_text!r}")

        # Page errors (non-mermaid).
        non_trivial = [e for e in errors if "favicon" not in e.lower() and "preload" not in e.lower()]
        if non_trivial:
            print("\n[WARN] console/page errors:", flush=True)
            for e in non_trivial[:8]:
                print(f"  {e}", flush=True)

        page.screenshot(path="/tmp/tessera-docs-overview.png", full_page=False)
        # Take a couple section screenshots for review.
        page.get_by_role("button", name="Cryptography").first.click()
        time.sleep(2.5)
        page.screenshot(path="/tmp/tessera-docs-crypto.png", full_page=True)
        page.get_by_role("button", name="State & database").first.click()
        time.sleep(2.5)
        page.screenshot(path="/tmp/tessera-docs-database.png", full_page=True)

        browser.close()

    print("\n" + "=" * 60, flush=True)
    print(f"PASSED: {len(SECTIONS_WITH_DIAGRAMS) - len(failures)} / {len(SECTIONS_WITH_DIAGRAMS)} sections", flush=True)
    if failures:
        print("FAILURES:", flush=True)
        for f in failures:
            print(f"  - {f}", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
