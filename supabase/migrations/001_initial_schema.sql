-- Tessera initial schema (R-84, R-110)
-- Apply via: supabase db push  OR  paste into Supabase SQL editor

-- ─── messages ──────────────────────────────────────────────────────────────
-- One row per cross-chain message; lifecycle stages follow the Verifier FSM.
CREATE TABLE IF NOT EXISTS messages (
    id                  BIGSERIAL PRIMARY KEY,
    nonce               BIGINT        NOT NULL,
    source_chain_id     TEXT          NOT NULL,
    source_app          TEXT          NOT NULL,
    destination_chain_id TEXT         NOT NULL,
    destination_app     TEXT          NOT NULL,
    action              TEXT          NOT NULL,   -- 4-byte hex selector
    payload             BYTEA         NOT NULL,
    sender              TEXT          NOT NULL,
    recipient           TEXT          NOT NULL,
    amount              NUMERIC(78,0) NOT NULL,
    source_tx_hash      TEXT          NOT NULL,
    source_block        BIGINT        NOT NULL,
    status              TEXT          NOT NULL DEFAULT 'pending',
    -- status: pending | submitted | challenge_window | executed | challenged | reverted
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (source_chain_id, nonce)
);

CREATE INDEX idx_messages_status      ON messages (status);
CREATE INDEX idx_messages_source_tx   ON messages (source_tx_hash);
CREATE INDEX idx_messages_nonce       ON messages (source_chain_id, nonce);

-- ─── submissions ───────────────────────────────────────────────────────────
-- One row per relayer submission attempt for a given message.
CREATE TABLE IF NOT EXISTS submissions (
    id                  BIGSERIAL PRIMARY KEY,
    message_id          BIGINT      NOT NULL REFERENCES messages (id),
    submitter_address   TEXT        NOT NULL,
    fingerprint         TEXT        NOT NULL,   -- hex-encoded transformed root
    dest_tx_hash        TEXT,
    status              TEXT        NOT NULL DEFAULT 'pending',
    -- status: pending | confirmed | challenged | slashed
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at        TIMESTAMPTZ,
    UNIQUE (message_id, submitter_address)
);

CREATE INDEX idx_submissions_message  ON submissions (message_id);
CREATE INDEX idx_submissions_status   ON submissions (status);

-- ─── disputes ──────────────────────────────────────────────────────────────
-- One row per challenge filed against a submission.
CREATE TABLE IF NOT EXISTS disputes (
    id                  BIGSERIAL PRIMARY KEY,
    submission_id       BIGINT      NOT NULL REFERENCES submissions (id),
    challenger_address  TEXT        NOT NULL,
    correct_fingerprint TEXT        NOT NULL,
    dispute_tx_hash     TEXT,
    outcome             TEXT,
    -- outcome: pending | upheld (submitter slashed) | rejected (challenger slashed)
    filed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at         TIMESTAMPTZ
);

CREATE INDEX idx_disputes_submission  ON disputes (submission_id);

-- ─── bonds ─────────────────────────────────────────────────────────────────
-- Periodically synced from chain; one row per relayer per chain.
CREATE TABLE IF NOT EXISTS bonds (
    id                  BIGSERIAL PRIMARY KEY,
    relayer_address     TEXT        NOT NULL,
    chain_id            TEXT        NOT NULL,
    balance             NUMERIC(78,0) NOT NULL DEFAULT 0,
    threshold_status    TEXT        NOT NULL DEFAULT 'operating',
    -- threshold_status: operating | below_operating | deregistered
    last_synced_block   BIGINT      NOT NULL DEFAULT 0,
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (relayer_address, chain_id)
);

-- ─── events ────────────────────────────────────────────────────────────────
-- Raw chain events; source of truth for the dashboard event log.
CREATE TABLE IF NOT EXISTS events (
    id              BIGSERIAL PRIMARY KEY,
    chain_id        TEXT        NOT NULL,
    block_number    BIGINT      NOT NULL,
    tx_hash         TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,   -- Locked | Burned | Submitted | Challenged | Executed | Slashed
    contract_address TEXT       NOT NULL,
    raw_data        JSONB       NOT NULL,
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_chain_block   ON events (chain_id, block_number);
CREATE INDEX idx_events_tx_hash       ON events (tx_hash);
CREATE INDEX idx_events_type          ON events (event_type);

-- ─── benchmark_runs ────────────────────────────────────────────────────────
-- Per-run benchmark data (R-100).
CREATE TABLE IF NOT EXISTS benchmark_runs (
    id                  BIGSERIAL PRIMARY KEY,
    message_id          BIGINT      REFERENCES messages (id),
    direction           TEXT        NOT NULL,   -- sepolia_to_neutron | neutron_to_sepolia
    source_block        BIGINT      NOT NULL,
    submission_block    BIGINT,
    execution_block     BIGINT,
    total_latency_ms    BIGINT,
    source_gas_used     BIGINT,
    dest_gas_used       BIGINT,
    proof_transform_ms  BIGINT,
    run_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── RLS: allow public reads for the frontend ───────────────────────────────
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bonds          ENABLE ROW LEVEL SECURITY;
ALTER TABLE events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE benchmark_runs ENABLE ROW LEVEL SECURITY;

-- Anon key can SELECT all rows (dashboard is public-read)
CREATE POLICY "public read messages"       ON messages       FOR SELECT USING (true);
CREATE POLICY "public read submissions"    ON submissions    FOR SELECT USING (true);
CREATE POLICY "public read disputes"       ON disputes       FOR SELECT USING (true);
CREATE POLICY "public read bonds"          ON bonds          FOR SELECT USING (true);
CREATE POLICY "public read events"         ON events         FOR SELECT USING (true);
CREATE POLICY "public read benchmark_runs" ON benchmark_runs FOR SELECT USING (true);
-- Writes require service-role key (relayer only)

-- ─── Realtime ───────────────────────────────────────────────────────────────
-- Enable realtime publications for frontend live updates (R-84, UI-dashboard)
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE submissions;
ALTER PUBLICATION supabase_realtime ADD TABLE disputes;
ALTER PUBLICATION supabase_realtime ADD TABLE events;
