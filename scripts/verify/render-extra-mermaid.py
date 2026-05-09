"""
Render the Mermaid diagrams that exist only in the MDX docs (not the in-app
/docs page) by feeding each diagram source into a small mermaid harness HTML
and screenshotting the resulting SVG.

Specifically:
  - docs/05-demo-scenarios.mdx     → S-1, S-2, S-3, S-4 sequence diagrams
  - docs/08-protocol-user-guide.mdx → disputes flow sequence diagram
"""

from playwright.sync_api import sync_playwright
from pathlib import Path
import sys
import time


REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "docs" / "images" / "mermaid"
OUT.mkdir(parents=True, exist_ok=True)
HARNESS = Path("/tmp/mermaid-harness.html")


DIAGRAMS = {
    "02-scenarios-s1.png": """sequenceDiagram
    autonumber
    actor U as User
    participant SV as BridgeVault
    participant A as Relayer A<br>(submitter)
    participant B as Relayer B<br>(challenger)
    participant V as Verifier (dest)
    participant M as BridgeMint

    U->>SV: lock(100 tUSDC, dest, recipient)
    SV-->>A: Locked event (nonce N)
    SV-->>B: Locked event (nonce N)
    Note over A: FetchProof + VerifyConsensus<br>+ TranslateProof
    A->>V: submitMessage(envelope, root, proof)
    Note over B: independently re-runs transform<br>computed root == submitted root
    B-->>B: stands down
    Note over V: 60s challenge window — uncontested
    V->>M: executeMessage → onCrossChainMessage
    M-->>U: mint(recipient, 100 tUSDC)
    Note over A: earns relay fee""",

    "02-scenarios-s2.png": """sequenceDiagram
    autonumber
    actor U as User
    participant SV as BridgeVault
    participant A as Relayer A<br>(lying)
    participant B as Relayer B<br>(challenger)
    participant V as Verifier (dest)
    participant Bd as Bond

    U->>SV: lock(100 tUSDC, ...)
    SV-->>A: Locked event
    SV-->>B: Locked event
    A->>V: submitMessage(envelope, WRONG_FINGERPRINT, fabricated proof)
    Note over B: re-runs transform → real_root<br>real_root != WRONG_FINGERPRINT
    B->>V: challenge(submissionId, real_root, evidence)
    V->>Bd: verify evidence
    Note over Bd: real_root matches source state ✓<br>WRONG_FINGERPRINT does not ✗
    Bd-->>A: slash 50% of A's bond
    Bd-->>B: transfer 100% of slash to B
    V-->>U: submission reverted — lock returned""",

    "02-scenarios-s3.png": """sequenceDiagram
    autonumber
    actor U as User
    participant SV as BridgeVault
    participant A as Relayer A<br>(silent)
    participant B as Relayer B<br>(successor)
    participant V as Verifier (dest)
    participant M as BridgeMint
    participant Bd as Bond

    U->>SV: lock(100 tUSDC, ...)
    SV-->>A: Locked event
    SV-->>B: Locked event
    Note over A: does not submit within 30s
    Note over B: rotation triggers<br>assigned_index = (nonce+1) % 2 = B
    B->>V: submitMessage(envelope, correct root, proof)
    Note over V: challenge window passes uncontested
    V->>M: executeMessage → mint(recipient, 100 tUSDC)
    M-->>U: 100 tUSDC delivered
    B->>V: claimAbsenceSlash(submissionId)
    V->>Bd: slash A 50% (absence)
    Bd-->>B: transfer 100% of slash to B""",

    "02-scenarios-s4.png": """sequenceDiagram
    autonumber
    actor U as User
    participant SV as BridgeVault
    participant A as Relayer A<br>(honest)
    participant B as Relayer B<br>(frivolous)
    participant V as Verifier (dest)
    participant M as BridgeMint
    participant Bd as Bond

    U->>SV: lock(100 tUSDC, ...)
    A->>V: submitMessage(envelope, correct_root, correct_proof)
    B->>V: challenge(submissionId, wrong_claim, bad_evidence)
    V->>Bd: verify challenge
    Note over Bd: A's root correct ✓<br>B's claim wrong ✗<br>frivolous challenge
    Bd-->>B: slash 25% of B's bond
    Bd-->>A: transfer 100% of slash to A
    Note over V: original submission reinstated
    V->>M: executeMessage → mint(recipient, 100 tUSDC)
    M-->>U: 100 tUSDC delivered""",

    "11-disputes.png": """sequenceDiagram
    autonumber
    actor U as User / observer
    participant C as Challenger<br>(relayer)
    participant V as Verifier
    participant Bd as Bond

    U-->>C: notices suspect submission
    Note over C: independently fetches source proof<br>re-runs deterministic transform<br>computes expected_root
    alt expected_root != submitted_root
        C->>V: challenge(submissionId, expected_root, evidence_proof)
        V->>Bd: verify evidence_proof vs source state
        Bd-->>Bd: identify correct party on-chain
        Bd-->>V: slash incorrect party
    else roots match
        C-->>C: stand down
    end""",
}


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": 1700, "height": 1100},
            device_scale_factor=2,
        )
        page = ctx.new_page()
        page.goto(f"file://{HARNESS}", wait_until="domcontentloaded")
        page.wait_for_function("() => window.__ready === true", timeout=10_000)

        for filename, source in DIAGRAMS.items():
            print(f"rendering {filename}...", flush=True)
            page.evaluate("(src) => window.__renderMermaid(src)", source)
            time.sleep(1.0)
            wrap = page.locator("#wrap")
            out = OUT / filename
            wrap.screenshot(path=str(out), animations="disabled")
            print(f"  wrote {out.relative_to(REPO)}", flush=True)

        browser.close()

    print(f"\nWrote {len(DIAGRAMS)} extra diagrams to {OUT.relative_to(REPO)}/", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
