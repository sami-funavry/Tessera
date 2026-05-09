"""
Capture every Mermaid diagram on /docs as a high-resolution PNG.

Strategy:
  - Walk each section in the docs sidebar
  - Wait for client-side mermaid render to finish
  - Locate each <figure> wrapping a Mermaid <svg> and screenshot just that element
  - Save to docs/images/mermaid/<section>-<n>.png with descriptive names

Output is suitable for embedding directly into the Notion docs (as images instead
of mermaid code blocks).
"""

from playwright.sync_api import sync_playwright
from pathlib import Path
import sys
import time


REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "docs" / "images" / "mermaid"
OUT.mkdir(parents=True, exist_ok=True)

# (section_id_in_router, side_panel_button_label, file_prefix, expected_diagram_count)
SECTIONS = [
    ("overview", "Overview", "01-overview", 1),
    ("how", "How it works", "03-how", 2),
    ("trust", "Trust model", "04-trust", 1),
    ("crypto", "Cryptography", "05-crypto", 4),
    ("architecture", "Architecture", "06-architecture", 1),
    ("database", "State & database", "07-database", 2),
    ("wallets", "Wallet setup & tUSDC", "08-wallets", 1),
    ("relayer", "Run a relayer", "09-relayer", 2),
    ("addchain", "Add a chain", "10-addchain", 1),
]


def main() -> int:
    captured: list[Path] = []
    failures: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a wide viewport so big diagrams aren't squashed.
        # Device-scale-factor 2 → effectively retina output PNGs.
        ctx = browser.new_context(viewport={"width": 1600, "height": 1100}, device_scale_factor=2)
        page = ctx.new_page()

        page.goto("http://localhost:3000/docs", wait_until="networkidle")
        time.sleep(1.5)

        for section_id, button_label, prefix, expected in SECTIONS:
            print(f"\n=== Section: {section_id} (expected {expected} diagram(s)) ===", flush=True)
            page.get_by_role("button", name=button_label).first.click()
            # mermaid is dynamic-imported + rendered in useEffect; give it time
            time.sleep(3.0)

            figures = page.locator("main figure").all()
            if not figures:
                # Fallback: bare svg blocks
                figures = page.locator("main div.bg-stone-950").all()
            print(f"   found {len(figures)} figure(s)", flush=True)

            kept = 0
            for i, fig in enumerate(figures, start=1):
                try:
                    if not fig.locator("svg").count():
                        continue  # not a diagram — probably a code block
                    fname = OUT / f"{prefix}-{i}.png"
                    fig.scroll_into_view_if_needed()
                    time.sleep(0.4)
                    fig.screenshot(path=str(fname), animations="disabled")
                    captured.append(fname)
                    kept += 1
                    print(f"   wrote {fname.relative_to(REPO)}", flush=True)
                except Exception as e:
                    failures.append(f"{section_id} fig#{i}: {e}")

            if kept < expected:
                failures.append(f"{section_id}: kept {kept} but expected {expected}")

        browser.close()

    print(f"\nCaptured {len(captured)} diagram PNGs to {OUT.relative_to(REPO)}/", flush=True)
    if failures:
        print("\nWARNINGS:", flush=True)
        for f in failures:
            print(f"  - {f}", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
