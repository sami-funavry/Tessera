-- Migration 002: additional indexes for frontend query patterns + admin views
-- Adds covering index on bonds for relayer lookup, benchmark_runs index,
-- and a partial index on submissions for active (un-challenged) submissions.

-- ─── bonds ────────────────────────────────────────────────────────────────────
-- Dashboard shows latest bond per relayer across both chains.
CREATE INDEX IF NOT EXISTS idx_bonds_relayer
    ON bonds (relayer_address);

CREATE INDEX IF NOT EXISTS idx_bonds_synced_at
    ON bonds (synced_at DESC);

-- ─── benchmark_runs ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_benchmark_message
    ON benchmark_runs (message_id);

CREATE INDEX IF NOT EXISTS idx_benchmark_direction
    ON benchmark_runs (direction, run_at DESC);

-- ─── messages (additional) ────────────────────────────────────────────────────
-- Submission detail page queries by nonce + chain.
CREATE INDEX IF NOT EXISTS idx_messages_updated_at
    ON messages (updated_at DESC);

-- ─── submissions (partial) ────────────────────────────────────────────────────
-- Challenger scanner only cares about pending submissions.
CREATE INDEX IF NOT EXISTS idx_submissions_pending
    ON submissions (status)
    WHERE status = 'pending';

-- ─── disputes (additional) ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_disputes_outcome
    ON disputes (outcome);
