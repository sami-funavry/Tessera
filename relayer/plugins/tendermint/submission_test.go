package tendermint

import (
	"testing"

	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/tessera-bridge/tessera/internal/config"
)

// TestExtractSubmissionIDHappyPath verifies extraction picks the correct
// wasm event when multiple are present and prefers the one with
// action="submit_message".
func TestExtractSubmissionIDHappyPath(t *testing.T) {
	want := "sub:msg:sepolia:0xabc:42:neutron1submitter:1700000000000000000"
	events := []abci.Event{
		// Unrelated event — must be skipped.
		{
			Type: "execute",
			Attributes: []abci.EventAttribute{
				{Key: "_contract_address", Value: "neutron1verifier"},
			},
		},
		// Decoy wasm event from a different action — must be skipped.
		{
			Type: "wasm",
			Attributes: []abci.EventAttribute{
				{Key: "action", Value: "register"},
				{Key: "submission_id", Value: "wrong-one"},
			},
		},
		// The real submit_message wasm event.
		{
			Type: "wasm",
			Attributes: []abci.EventAttribute{
				{Key: "_contract_address", Value: "neutron1verifier"},
				{Key: "action", Value: "submit_message"},
				{Key: "submission_id", Value: want},
				{Key: "message_id", Value: "msg:sepolia:0xabc:42"},
				{Key: "submitter", Value: "neutron1submitter"},
			},
		},
	}
	got, ok := extractSubmissionID(events)
	if !ok {
		t.Fatalf("extractSubmissionID: expected ok=true, got false")
	}
	if got != want {
		t.Fatalf("extractSubmissionID: got %q, want %q", got, want)
	}
}

// TestExtractSubmissionIDFallback verifies that when no event has
// action="submit_message" but a wasm event still carries submission_id,
// the helper returns it as a best-effort fallback.
func TestExtractSubmissionIDFallback(t *testing.T) {
	want := "sub:msg:foo:bar:1:neutron1x:1"
	events := []abci.Event{
		{
			Type: "wasm",
			Attributes: []abci.EventAttribute{
				{Key: "submission_id", Value: want},
			},
		},
	}
	got, ok := extractSubmissionID(events)
	if !ok {
		t.Fatalf("extractSubmissionID fallback: expected ok=true")
	}
	if got != want {
		t.Fatalf("extractSubmissionID fallback: got %q, want %q", got, want)
	}
}

// TestExtractSubmissionIDMissing verifies that no submission_id attribute
// produces ok=false rather than an empty string treated as success.
func TestExtractSubmissionIDMissing(t *testing.T) {
	events := []abci.Event{
		{
			Type: "wasm",
			Attributes: []abci.EventAttribute{
				{Key: "action", Value: "transfer"},
				{Key: "amount", Value: "100"},
			},
		},
		{
			Type: "transfer",
			Attributes: []abci.EventAttribute{
				{Key: "sender", Value: "neutron1x"},
			},
		},
	}
	if got, ok := extractSubmissionID(events); ok {
		t.Fatalf("extractSubmissionID missing: expected ok=false, got %q", got)
	}
}

// TestExtractSubmissionIDEmptyEvents verifies graceful handling of an
// empty event slice.
func TestExtractSubmissionIDEmptyEvents(t *testing.T) {
	if got, ok := extractSubmissionID(nil); ok {
		t.Fatalf("extractSubmissionID nil events: expected ok=false, got %q", got)
	}
	if got, ok := extractSubmissionID([]abci.Event{}); ok {
		t.Fatalf("extractSubmissionID empty events: expected ok=false, got %q", got)
	}
}

// TestRememberAndLookupSubID verifies the in-process cache mapping.
func TestRememberAndLookupSubID(t *testing.T) {
	p := New("http://127.0.0.1:26657", "pion-1", "http://127.0.0.1:1317", config.Addresses{}, "")
	var id [32]byte
	for i := range id {
		id[i] = byte(i)
	}
	const raw = "sub:msg:sepolia:0xabc:42:neutron1x:1700000000000000000"
	p.rememberSubID(id, raw)
	got, ok := p.lookupSubID(id)
	if !ok {
		t.Fatalf("lookupSubID: expected ok=true, got false")
	}
	if got != raw {
		t.Fatalf("lookupSubID: got %q, want %q", got, raw)
	}

	var miss [32]byte
	miss[0] = 0xff
	if got, ok := p.lookupSubID(miss); ok {
		t.Fatalf("lookupSubID miss: expected ok=false, got %q", got)
	}
}
