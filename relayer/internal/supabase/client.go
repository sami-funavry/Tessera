// Package supabase wraps the Supabase REST client for Tessera state persistence (R-84, R-110).
package supabase

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// Client is a thin wrapper around the Supabase REST API.
type Client struct {
	projectURL string
	serviceKey string
	http       *http.Client
}

// New returns a Client configured from the given project URL and service-role key.
func New(projectURL, serviceKey string) *Client {
	return &Client{
		projectURL: projectURL,
		serviceKey: serviceKey,
		http:       &http.Client{Timeout: 30 * time.Second},
	}
}

// ─── Row types ────────────────────────────────────────────────────────────────

// MessageRow mirrors the messages table.
type MessageRow struct {
	ID                 int64  `json:"id,omitempty"`
	Nonce              uint64 `json:"nonce"`
	SourceChainID      string `json:"source_chain_id"`
	SourceApp          string `json:"source_app"`
	DestinationChainID string `json:"destination_chain_id"`
	DestinationApp     string `json:"destination_app"`
	Action             string `json:"action"`
	// Payload is the cross-chain message payload. Stored as `bytea` in
	// PostgreSQL; PostgREST returns it as the hex literal `\\x...`. Using
	// `string` (not `[]byte`) here avoids two opposite encoding conventions
	// fighting each other: Go's json.Marshal expects []byte to round-trip
	// as base64 (which the bytea column is not), and Go's []byte unmarshal
	// rejects PostgREST's `\\x` prefix as illegal-base64. Treating it as an
	// opaque string and sending `\\x` (empty bytea) is what every existing
	// row already uses.
	Payload string `json:"payload"`
	Sender             string `json:"sender"`
	Recipient          string `json:"recipient"`
	Amount             string `json:"amount"`
	SourceTxHash       string `json:"source_tx_hash"`
	SourceBlock        uint64 `json:"source_block"`
	Status             string `json:"status"`
}

// SubmissionRow mirrors the submissions table.
type SubmissionRow struct {
	ID               int64  `json:"id,omitempty"`
	MessageID        int64  `json:"message_id"`
	SubmitterAddress string `json:"submitter_address"`
	Fingerprint      string `json:"fingerprint"`
	DestTxHash       string `json:"dest_tx_hash"`
	Status           string `json:"status"`
}

// DisputeRow mirrors the disputes table.
type DisputeRow struct {
	ID                 int64  `json:"id,omitempty"`
	SubmissionID       int64  `json:"submission_id"`
	ChallengerAddress  string `json:"challenger_address"`
	CorrectFingerprint string `json:"correct_fingerprint"`
	DisputeTxHash      string `json:"dispute_tx_hash,omitempty"`
	Outcome            string `json:"outcome,omitempty"`
}

// BondRow mirrors the bonds table.
type BondRow struct {
	RelayerAddress  string `json:"relayer_address"`
	ChainID         string `json:"chain_id"`
	Balance         string `json:"balance"`
	ThresholdStatus string `json:"threshold_status"`
	LastSyncedBlock uint64 `json:"last_synced_block"`
}

// EventRow mirrors the events table.
type EventRow struct {
	ChainID         string `json:"chain_id"`
	BlockNumber     uint64 `json:"block_number"`
	TxHash          string `json:"tx_hash"`
	EventType       string `json:"event_type"`
	ContractAddress string `json:"contract_address"`
	RawData         any    `json:"raw_data"`
}

// BenchmarkRow mirrors the benchmark_runs table.
type BenchmarkRow struct {
	MessageID        *int64  `json:"message_id,omitempty"`
	Direction        string  `json:"direction"`
	SourceBlock      uint64  `json:"source_block"`
	SubmissionBlock  *uint64 `json:"submission_block,omitempty"`
	ExecutionBlock   *uint64 `json:"execution_block,omitempty"`
	TotalLatencyMs   *int64  `json:"total_latency_ms,omitempty"`
	SourceGasUsed    *int64  `json:"source_gas_used,omitempty"`
	DestGasUsed      *int64  `json:"dest_gas_used,omitempty"`
	ProofTransformMs *int64  `json:"proof_transform_ms,omitempty"`
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

// Ping verifies the Supabase project is reachable by calling the health endpoint.
func (c *Client) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.projectURL+"/rest/v1/", nil)
	if err != nil {
		return fmt.Errorf("supabase ping: build request: %w", err)
	}
	c.setHeaders(req, false)
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("supabase ping: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("supabase ping: unexpected status %d", resp.StatusCode)
	}
	slog.Info("supabase reachable", "project", c.projectURL)
	return nil
}

// ─── Messages ─────────────────────────────────────────────────────────────────

// UpsertMessage inserts or updates a message row (upsert on source_chain_id + nonce).
// Returns the assigned database ID.
func (c *Client) UpsertMessage(ctx context.Context, msg MessageRow) (int64, error) {
	var rows []MessageRow
	if err := c.upsert(ctx, "messages", "source_chain_id,nonce", msg, &rows); err != nil {
		return 0, fmt.Errorf("supabase UpsertMessage nonce=%d: %w", msg.Nonce, err)
	}
	if len(rows) == 0 {
		return 0, fmt.Errorf("supabase UpsertMessage: no row returned")
	}
	return rows[0].ID, nil
}

// UpdateMessageStatus sets the status field for a message by ID.
func (c *Client) UpdateMessageStatus(ctx context.Context, id int64, status string) error {
	patch := map[string]string{"status": status}
	return c.patch(ctx, "messages", fmt.Sprintf("id=eq.%d", id), patch)
}

// FindMessageID looks up the database ID for a message by chain + nonce.
// Returns 0, nil if the message is not found yet.
func (c *Client) FindMessageID(ctx context.Context, sourceChainID string, nonce uint64) (int64, error) {
	var rows []MessageRow
	filter := fmt.Sprintf("source_chain_id=eq.%s&nonce=eq.%d&select=id", sourceChainID, nonce)
	if err := c.get(ctx, "messages", filter, &rows); err != nil {
		return 0, fmt.Errorf("supabase FindMessageID: %w", err)
	}
	if len(rows) == 0 {
		return 0, nil
	}
	return rows[0].ID, nil
}

// ─── Submissions ──────────────────────────────────────────────────────────────

// InsertSubmission inserts a submission row. Returns the assigned database ID.
func (c *Client) InsertSubmission(ctx context.Context, sub SubmissionRow) (int64, error) {
	var rows []SubmissionRow
	if err := c.insert(ctx, "submissions", sub, &rows); err != nil {
		return 0, fmt.Errorf("supabase InsertSubmission message_id=%d: %w", sub.MessageID, err)
	}
	if len(rows) == 0 {
		return 0, fmt.Errorf("supabase InsertSubmission: no row returned")
	}
	return rows[0].ID, nil
}

// UpdateSubmissionStatus updates the status (and optionally destTxHash) for a submission.
func (c *Client) UpdateSubmissionStatus(ctx context.Context, id int64, status, destTxHash string) error {
	patch := map[string]string{"status": status}
	if destTxHash != "" {
		patch["dest_tx_hash"] = destTxHash
	}
	return c.patch(ctx, "submissions", fmt.Sprintf("id=eq.%d", id), patch)
}

// ─── Disputes ─────────────────────────────────────────────────────────────────

// InsertDispute inserts a dispute row. Returns the assigned database ID.
func (c *Client) InsertDispute(ctx context.Context, d DisputeRow) (int64, error) {
	var rows []DisputeRow
	if err := c.insert(ctx, "disputes", d, &rows); err != nil {
		return 0, fmt.Errorf("supabase InsertDispute submission_id=%d: %w", d.SubmissionID, err)
	}
	if len(rows) == 0 {
		return 0, fmt.Errorf("supabase InsertDispute: no row returned")
	}
	return rows[0].ID, nil
}

// UpdateDisputeOutcome sets outcome and dispute_tx_hash for a dispute by ID.
func (c *Client) UpdateDisputeOutcome(ctx context.Context, id int64, outcome, txHash string) error {
	patch := map[string]string{"outcome": outcome}
	if txHash != "" {
		patch["dispute_tx_hash"] = txHash
	}
	return c.patch(ctx, "disputes", fmt.Sprintf("id=eq.%d", id), patch)
}

// ─── Bonds ───────────────────────────────────────────────────────────────────

// UpsertBond inserts or updates a bond row (upsert on relayer_address + chain_id).
func (c *Client) UpsertBond(ctx context.Context, bond BondRow) error {
	var rows []BondRow
	return c.upsert(ctx, "bonds", "relayer_address,chain_id", bond, &rows)
}

// ─── Events ───────────────────────────────────────────────────────────────────

// AppendEvent inserts a raw chain event row.
func (c *Client) AppendEvent(ctx context.Context, ev EventRow) error {
	var rows []EventRow
	return c.insert(ctx, "events", ev, &rows)
}

// ─── Benchmarks ───────────────────────────────────────────────────────────────

// InsertBenchmarkRun inserts a benchmark data row.
func (c *Client) InsertBenchmarkRun(ctx context.Context, run BenchmarkRow) error {
	var rows []BenchmarkRow
	return c.insert(ctx, "benchmark_runs", run, &rows)
}

// ─── Low-level REST helpers ───────────────────────────────────────────────────

// setHeaders applies authentication and optional UPSERT preference headers.
func (c *Client) setHeaders(req *http.Request, returnRep bool) {
	req.Header.Set("apikey", c.serviceKey)
	req.Header.Set("Authorization", "Bearer "+c.serviceKey)
	req.Header.Set("Content-Type", "application/json")
	if returnRep {
		req.Header.Set("Prefer", "return=representation")
	}
}

// insert POSTs a row and decodes the response into out (must be a pointer to slice).
func (c *Client) insert(ctx context.Context, table string, row any, out any) error {
	body, err := json.Marshal(row)
	if err != nil {
		return fmt.Errorf("insert %s: marshal: %w", table, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.projectURL+"/rest/v1/"+table, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("insert %s: build request: %w", table, err)
	}
	c.setHeaders(req, true)
	return c.doAndDecode(req, out, http.StatusCreated)
}

// upsert POSTs a row with on-conflict merge. onConflict is a comma-separated column list.
//
// Supabase PostgREST expects on_conflict as a URL query parameter, NOT an HTTP
// header. With the previous header-only form, PostgREST didn't recognize the
// merge target and treated the request as a plain INSERT, which then failed
// with 409 (unique-constraint violation) whenever the bridge-widget recorder
// had already inserted a row for the same (source_chain_id, nonce). That kept
// every relayer-detected lock today from progressing past dbUpsertMessage.
func (c *Client) upsert(ctx context.Context, table, onConflict string, row any, out any) error {
	body, err := json.Marshal(row)
	if err != nil {
		return fmt.Errorf("upsert %s: marshal: %w", table, err)
	}
	url := c.projectURL + "/rest/v1/" + table + "?on_conflict=" + onConflict
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("upsert %s: build request: %w", table, err)
	}
	c.setHeaders(req, true)
	req.Header.Set("Prefer", "resolution=merge-duplicates,return=representation")
	return c.doAndDecode(req, out, http.StatusCreated, http.StatusOK)
}

// patch sends a PATCH request with a URL-encoded filter and JSON body.
func (c *Client) patch(ctx context.Context, table, filter string, updates any) error {
	body, err := json.Marshal(updates)
	if err != nil {
		return fmt.Errorf("patch %s: marshal: %w", table, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch,
		c.projectURL+"/rest/v1/"+table+"?"+filter, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("patch %s: build request: %w", table, err)
	}
	c.setHeaders(req, false)
	return c.doAndDecode(req, nil, http.StatusNoContent, http.StatusOK)
}

// get sends a GET request and decodes JSON into out.
func (c *Client) get(ctx context.Context, table, filter string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.projectURL+"/rest/v1/"+table+"?"+filter, nil)
	if err != nil {
		return fmt.Errorf("get %s: build request: %w", table, err)
	}
	c.setHeaders(req, false)
	req.Header.Set("Accept", "application/json")
	return c.doAndDecode(req, out, http.StatusOK)
}

// doAndDecode executes a request and, if out is non-nil, decodes the JSON response.
// acceptCodes are the HTTP status codes that indicate success.
func (c *Client) doAndDecode(req *http.Request, out any, acceptCodes ...int) error {
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("supabase %s %s: %w", req.Method, req.URL.Path, err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("supabase %s read body: %w", req.URL.Path, err)
	}
	ok := false
	for _, code := range acceptCodes {
		if resp.StatusCode == code {
			ok = true
			break
		}
	}
	if !ok {
		return fmt.Errorf("supabase %s %s: status %d: %s",
			req.Method, req.URL.Path, resp.StatusCode, string(respBody))
	}
	if out != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("supabase decode %s: %w", req.URL.Path, err)
		}
	}
	return nil
}
