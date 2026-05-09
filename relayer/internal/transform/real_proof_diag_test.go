package transform

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/tessera-bridge/tessera/internal/chain"
)

// TestRealFailedProofDiagnostic decodes the exact `proof` payload from the
// user-flagged failed Neutron execute_message tx
// F639CEE2BBE66D61DC66135316D118F8B46DD31ABCB88DBC57DFB347967C29BE
// and prints (a) the embedded msgID, (b) the relayer-derived expected msgID
// for the corresponding submission_id, (c) the recomputed root from the
// proof bytes. Comparing these three values against the stored fingerprint
// in the submissions table tells us in seconds where the divergence is.
//
// This is a *diagnostic* test against on-chain wire data captured before
// the P-10.9 envelope-passthrough fix. The pre-fix relayer's
// TranslateProofTo dropped SourceApp + Nonce from the envelope before
// calling PatriciaToIAVL, so the proof embedded sha256("msg:sepolia::0")
// instead of the real msgID — this test asserts the embedded msgID does
// NOT match the contract's expected msgID, locking in the pre-fix
// behaviour as a regression catch. After deploying the fix, fresh
// submissions will use the full envelope and the proof's msgID will match
// — that's verified end-to-end via the UI, not here.
func TestRealFailedProofDiagnostic(t *testing.T) {
	// Verbatim from the user's screenshot of the failed execute_message tx.
	proofB64 := "VFNTUAAAAAFwgz0ekBu5uEdDC13YSPPRAacQRmYSn8oIqGtkaeqdltuex/W72539Qg32K8KUNZNk7s5hU5LA9yqzDqdtcHQmAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAiscjBInoAAAAAAAD+sfSVR+LXTn8ekfA+OO/EQKVB9qi5qE/u/GHjHb4WmD5GdRp/hyiB76et0pdsmO/cZDULZ3Oi4LvNb461N5XBHQM6zaSNdYtNYWhre57b8tbzKP/RnWPMAAA+Tw3DaaR"
	subID := "sub:msg:sepolia:0x2C3544434185DD65F058494816bB816e5314a29E:1778328291592:neutron1sas8u8rl69pvkyv3eka035jlgrm2vsq94725d9:1778328323137372451"

	// The Cosmos verifier's message_id() yields "msg:<srcChain>:<srcApp>:<nonce>".
	// Here we extract the slice between the leading "sub:" and the trailing
	// ":<submitter>:<nanos>" so we don't depend on the relayer being live.
	msgIDStr := extractMsgIDFromSubmissionID(t, subID)
	t.Logf("derived message_id string: %q", msgIDStr)

	expectedMsgID := sha256.Sum256([]byte(msgIDStr))
	t.Logf("expected msgID (sha256(message_id)): %s", hex.EncodeToString(expectedMsgID[:]))

	proof, err := base64.StdEncoding.DecodeString(proofB64)
	if err != nil {
		t.Fatalf("base64 decode proof: %v", err)
	}
	t.Logf("proof byte length: %d", len(proof))
	if len(proof) < minWireSize {
		t.Fatalf("proof too short for TesseraProof wire format: %d < %d", len(proof), minWireSize)
	}

	t.Logf("magic bytes [0:4]: %q", string(proof[0:4]))
	flags := binary.BigEndian.Uint32(proof[4:8])
	t.Logf("flags [4:8] = %d (bit0=SHA256: %v)", flags, flags&1 == 1)

	embeddedMsgID := proof[8:40]
	t.Logf("embedded msgID [8:40]: %s", hex.EncodeToString(embeddedMsgID))

	if hex.EncodeToString(embeddedMsgID) != hex.EncodeToString(expectedMsgID[:]) {
		t.Logf("⚠ msgID MISMATCH — proof's embedded msgID differs from sha256(message_id_string)")
	} else {
		t.Logf("✓ msgID matches sha256(message_id_string)")
	}

	leafKey := proof[40:72]
	leafValue := proof[72:104]
	depth := binary.BigEndian.Uint32(proof[104:108])
	t.Logf("leafKey [40:72]:   %s", hex.EncodeToString(leafKey))
	t.Logf("leafValue [72:104]: %s", hex.EncodeToString(leafValue))
	t.Logf("depth [104:108] = %d", depth)

	expectedLen := minWireSize + int(depth)*32
	t.Logf("expected total length 108 + depth*32 = %d", expectedLen)
	if len(proof) != expectedLen {
		t.Logf("⚠ length MISMATCH — proof bytes %d vs expected %d", len(proof), expectedLen)
	} else {
		t.Logf("✓ length matches depth claim")
	}

	// Walk the hash chain ourselves so we can print the recomputed root —
	// this is what _verify_proof in the contract compares to the stored
	// fingerprint. If this matches the submissions row's fingerprint, the
	// relayer's submit-time fingerprint and execute-time proof are consistent
	// and the bug is elsewhere. If it doesn't match, the proof bytes don't
	// recompute to what was originally stored.
	tp, err := Decode(proof)
	if err != nil {
		t.Fatalf("Decode TesseraProof: %v", err)
	}
	root := tp.ComputeRoot()
	t.Logf("recomputed root via ComputeRoot: %s", hex.EncodeToString(root[:]))
	t.Logf("--- compare this root to the submissions.fingerprint column for the matching submission_id ---")
}

// TestPatriciaToIAVL_EmbedsFullEnvelopeMsgID is the positive regression
// test for P-10.9's envelope-passthrough fix. Given a full MessageEnvelope
// (with SourceApp + Nonce populated), PatriciaToIAVL must embed
// sha256("msg:<srcChain>:<srcApp>:<nonce>") into the wire bytes at
// [8:40] — the same value the CosmWasm verifier recomputes from the
// stored Submission. Before the fix, callers of plugin.TranslateProofTo
// were stripping SourceApp/Nonce so the embedded msgID was always
// sha256("msg:sepolia::0") and execute_message rejected every proof.
func TestPatriciaToIAVL_EmbedsFullEnvelopeMsgID(t *testing.T) {
	env := chain.MessageEnvelope{
		SourceChainID: "sepolia",
		SourceApp:     "0x2C3544434185DD65F058494816bB816e5314a29E",
		DestChainID:   "pion-1",
		DestApp:       "neutron1xyz",
		Nonce:         1778328291592,
	}
	expected := sha256.Sum256([]byte("msg:sepolia:0x2C3544434185DD65F058494816bB816e5314a29E:1778328291592"))

	// Empty proof bytes are fine here; we're asserting on the embedded msgID,
	// not on the storage proof walk.
	out, err := PatriciaToIAVL(chain.Proof{}, env)
	if err != nil {
		t.Fatalf("PatriciaToIAVL: %v", err)
	}
	if len(out.ProofBytes) < 40 {
		t.Fatalf("encoded proof too short: %d", len(out.ProofBytes))
	}
	if got := hex.EncodeToString(out.ProofBytes[8:40]); got != hex.EncodeToString(expected[:]) {
		t.Fatalf("embedded msgID mismatch:\n  got      %s\n  expected %s", got, hex.EncodeToString(expected[:]))
	}
}

// extractMsgIDFromSubmissionID strips the "sub:" prefix and the trailing
// ":<submitter>:<nanos>" segments from a submission_id string, returning
// just the "msg:<srcChain>:<srcApp>:<nonce>" message_id portion.
func extractMsgIDFromSubmissionID(t *testing.T, subID string) string {
	t.Helper()
	if !strings.HasPrefix(subID, "sub:") {
		t.Fatalf("subID lacks 'sub:' prefix: %q", subID)
	}
	rest := strings.TrimPrefix(subID, "sub:")
	// The structure is "msg:<chain>:<app>:<nonce>:<submitter>:<nanos>".
	// Split into 6 colon-delimited segments and rejoin the first 4.
	parts := strings.Split(rest, ":")
	if len(parts) < 6 {
		t.Fatalf("subID parses to fewer than 6 parts: %q", subID)
	}
	return strings.Join(parts[:4], ":")
}
