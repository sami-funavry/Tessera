'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { RELAYER_ADDRESSES } from '@/lib/config';
import type { Database, RelayerInfo } from '@/types';

type BondRow = Database['public']['Tables']['bonds']['Row'];
type SubmissionRow = Database['public']['Tables']['submissions']['Row'];
type DisputeRow = Database['public']['Tables']['disputes']['Row'];
type EventRow = Database['public']['Tables']['events']['Row'];

// Per-message reward (testnet demo values; not from chain state).
// SPEC §1.5: relayer earns a small fee per honest submission on Sepolia,
// plus 100% of any successfully-challenged submitter's slash.
const PER_SUBMISSION_FEE_ETH = 0.0005; // base reward per confirmed submission
const SLASH_REWARD_FROM_LIAR_ETH = 0.01; // 50% of 0.02 ETH initial bond
const SLASH_REWARD_FROM_FRIVOLOUS_ETH = 0.005; // 25% of 0.02 ETH

// ---------- generic hook state shape ----------

interface HookState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function initialState<T>(): HookState<T> {
  return { data: null, loading: true, error: null };
}

// ---------- helpers ----------

/**
 * Maps a raw relayer address to 'A' | 'B' by consulting RELAYER_ADDRESSES.
 * Returns null if the address is not a known relayer.
 */
function resolveRelayerId(
  address: string
): 'A' | 'B' | null {
  const normalised = address.toLowerCase();
  for (const [id, addrs] of Object.entries(RELAYER_ADDRESSES) as [
    'A' | 'B',
    { sepolia: string; neutron: string },
  ][]) {
    if (
      addrs.sepolia.toLowerCase() === normalised ||
      addrs.neutron.toLowerCase() === normalised
    ) {
      return id;
    }
  }
  return null;
}

// ---------- useBonds ----------

/**
 * Fetches all bond rows and returns them mapped to an A/B relayer structure.
 * Each relayer entry contains its Sepolia bond and Neutron bond (if present).
 */
export function useBonds(): HookState<BondRow[]> {
  const [state, setState] = useState<HookState<BondRow[]>>(initialState);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setState(initialState);
      const { data, error } = await supabase
        .from('bonds')
        .select('*')
        .order('synced_at', { ascending: false });

      if (cancelled) return;

      if (error) {
        setState({ data: null, loading: false, error: error.message });
      } else {
        setState({ data: data ?? [], loading: false, error: null });
      }
    }

    fetch();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

// ---------- useRelayerStats ----------

/**
 * Builds a RelayerInfo array by joining bond data with submission counts.
 * The result contains one entry per known relayer (A and B).
 */
export function useRelayerStats(): HookState<RelayerInfo[]> {
  const [state, setState] = useState<HookState<RelayerInfo[]>>(initialState);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setState(initialState);

      /*
       * Run all three queries concurrently with Promise.all. We assign the
       * results to typed locals immediately to preserve the row types — the
       * Supabase typed client's tuple inference inside Promise.all loses
       * narrowing if you destructure directly.
       */
      const [bondsResult, submissionsResult, disputesResult] = await Promise.all([
        supabase.from('bonds').select('*'),
        supabase.from('submissions').select('*'),
        supabase.from('disputes').select('*'),
      ]);

      if (cancelled) return;

      if (bondsResult.error) {
        setState({ data: null, loading: false, error: bondsResult.error.message });
        return;
      }
      if (submissionsResult.error) {
        setState({
          data: null,
          loading: false,
          error: submissionsResult.error.message,
        });
        return;
      }
      if (disputesResult.error) {
        setState({
          data: null,
          loading: false,
          error: disputesResult.error.message,
        });
        return;
      }

      const bonds: BondRow[] = bondsResult.data ?? [];
      const submissions: SubmissionRow[] = submissionsResult.data ?? [];
      const disputes: DisputeRow[] = disputesResult.data ?? [];

      /*
       * Build one RelayerInfo per known relayer id.  Bond rows are keyed by
       * (relayer_address, chain_id); there may be one Sepolia row and one
       * Neutron row per relayer.
       */
      const relayers: RelayerInfo[] = (['A', 'B'] as const).map((id) => {
        const addrs = RELAYER_ADDRESSES[id];

        const sepoliaBond = bonds.find(
          (b) =>
            b.relayer_address.toLowerCase() === addrs.sepolia.toLowerCase() &&
            b.chain_id === '11155111'
        );
        const neutronBond = bonds.find(
          (b) =>
            b.relayer_address.toLowerCase() === addrs.neutron.toLowerCase() &&
            b.chain_id === 'pion-1'
        );

        const relayerSubmissions = submissions.filter(
          (s) =>
            s.submitter_address.toLowerCase() === addrs.sepolia.toLowerCase() ||
            s.submitter_address.toLowerCase() === addrs.neutron.toLowerCase()
        );

        const totalSubmissions = relayerSubmissions.length;
        const confirmedSubmissions = relayerSubmissions.filter(
          (s) => s.status === 'confirmed'
        ).length;
        const successRate =
          totalSubmissions > 0
            ? Math.round((confirmedSubmissions / totalSubmissions) * 100)
            : 100;

        // Audit fix UX-02: don't conflate "registered + bonded" with "actively
        // submitting right now". Old logic flipped to `busy` whenever the bond
        // was at the operating threshold, so both relayers permanently showed
        // a pulsing amber "Submitting" badge. Now `busy` only fires when this
        // relayer has a submission row inside the challenge window (pending /
        // unconfirmed in the last `BUSY_WINDOW_MS`). Otherwise it's `idle`.
        const BUSY_WINDOW_MS = 90_000;
        const nowMs = Date.now();
        const hasPendingSubmission = relayerSubmissions.some((s) => {
          // SubmissionStatus enum: pending | confirmed | challenged | slashed.
          // Only `pending` is in-flight from the relayer's POV.
          if (s.status !== 'pending') return false;
          const submittedAt = s.submitted_at ? Date.parse(s.submitted_at) : 0;
          if (!submittedAt) return true; // missing timestamp → assume recent
          return nowMs - submittedAt < BUSY_WINDOW_MS;
        });

        const activityType: RelayerInfo['activityType'] = (() => {
          if (
            sepoliaBond?.threshold_status === 'deregistered' ||
            neutronBond?.threshold_status === 'deregistered'
          )
            return 'deregistered';
          if (
            sepoliaBond?.threshold_status === 'below_operating' ||
            neutronBond?.threshold_status === 'below_operating'
          )
            return 'benched';
          if (hasPendingSubmission) return 'busy';
          return 'idle';
        })();

        const ACTIVITY_LABELS: Record<RelayerInfo['activityType'], string> = {
          busy: 'Submitting',
          benched: 'Bond below operating threshold',
          deregistered: 'Deregistered',
          cooling: 'Cooling off',
          idle: 'Watching',
        };
        const activity = ACTIVITY_LABELS[activityType];

        // ─── Earned (ETH) ─────────────────────────────────────────────
        // Per-submission fee for confirmed submissions, plus 100% of any
        // upheld dispute (this relayer was the challenger), and 25% reward
        // when an upheld dispute means a frivolous challenger paid this
        // submitter.
        const submissionIds = new Set(relayerSubmissions.map((s) => s.id));

        // Disputes filed BY this relayer that succeeded (earned 50% slash)
        const upheldDisputesByThis = disputes.filter(
          (d) =>
            d.outcome === 'upheld' &&
            (d.challenger_address.toLowerCase() === addrs.sepolia.toLowerCase() ||
              d.challenger_address.toLowerCase() === addrs.neutron.toLowerCase())
        ).length;

        // Disputes filed AGAINST a submission of this relayer where outcome
        // was 'rejected' (frivolous challenge — this submitter earned 25%)
        const rejectedDisputesProtectingThis = disputes.filter(
          (d) =>
            d.outcome === 'rejected' &&
            submissionIds.has(d.submission_id)
        ).length;

        const earned =
          confirmedSubmissions * PER_SUBMISSION_FEE_ETH +
          upheldDisputesByThis * SLASH_REWARD_FROM_LIAR_ETH +
          rejectedDisputesProtectingThis * SLASH_REWARD_FROM_FRIVOLOUS_ETH;

        // ─── Slashed (count) ─────────────────────────────────────────
        // Count of submissions where this relayer was slashed plus
        // count of disputes filed by this relayer that were rejected.
        const slashedSubmissions = relayerSubmissions.filter(
          (s) => s.status === 'slashed'
        ).length;
        const rejectedDisputesByThis = disputes.filter(
          (d) =>
            d.outcome === 'rejected' &&
            (d.challenger_address.toLowerCase() === addrs.sepolia.toLowerCase() ||
              d.challenger_address.toLowerCase() === addrs.neutron.toLowerCase())
        ).length;

        return {
          id,
          name: `Relayer ${id}`,
          sepoliaAddress: addrs.sepolia,
          neutronAddress: addrs.neutron,
          activity,
          activityType,
          bond: {
            sepolia: {
              gas: 0,
              // balance is stored in wei (10^18 per ETH)
              bond: sepoliaBond ? Number(sepoliaBond.balance) / 1e18 : 0,
            },
            neutron: {
              gas: 0,
              // balance is stored in uNTRN (10^6 per NTRN)
              bond: neutronBond ? Number(neutronBond.balance) / 1e6 : 0,
            },
          },
          earned,
          slashed: slashedSubmissions + rejectedDisputesByThis,
          submissions: totalSubmissions,
          successRate,
        } satisfies RelayerInfo;
      });

      if (!cancelled) {
        setState({ data: relayers, loading: false, error: null });
      }
    }

    fetch();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

// ---------- useSubmissions ----------

/**
 * Fetches submissions, optionally filtered by a message id.
 *
 * When messageId is undefined, returns recent submissions across all messages,
 * ordered by submitted_at descending.
 */
export function useSubmissions(messageId?: number): HookState<SubmissionRow[]> {
  const [state, setState] = useState<HookState<SubmissionRow[]>>(initialState);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setState(initialState);

      let query = supabase
        .from('submissions')
        .select('*')
        .order('submitted_at', { ascending: false });

      if (messageId !== undefined) {
        query = query.eq('message_id', messageId);
      }

      const { data, error } = await query;

      if (cancelled) return;

      if (error) {
        setState({ data: null, loading: false, error: error.message });
      } else {
        setState({ data: data ?? [], loading: false, error: null });
      }
    }

    fetch();
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  return state;
}

// ---------- useEvents ----------

/**
 * Fetches recent on-chain events indexed by the relayer, newest first.
 *
 * @param limit Maximum rows to return. Defaults to 50.
 */
export function useEvents(limit = 50): HookState<EventRow[]> {
  const [state, setState] = useState<HookState<EventRow[]>>(initialState);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setState(initialState);
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('indexed_at', { ascending: false })
        .limit(limit);

      if (cancelled) return;

      if (error) {
        setState({ data: null, loading: false, error: error.message });
      } else {
        setState({ data: data ?? [], loading: false, error: null });
      }
    }

    fetch();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  return state;
}

// ---------- useEventsRealtime ----------

/**
 * Same as useEvents but keeps the list live via Supabase Realtime.
 * New events are prepended; the list is capped at `limit` entries.
 *
 * @param limit Maximum rows to keep in memory. Defaults to 50.
 */
export function useEventsRealtime(limit = 50): HookState<EventRow[]> {
  const [state, setState] = useState<HookState<EventRow[]>>(initialState);

  useEffect(() => {
    let cancelled = false;

    async function initialFetch() {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('indexed_at', { ascending: false })
        .limit(limit);

      if (cancelled) return;

      if (error) {
        setState({ data: null, loading: false, error: error.message });
      } else {
        setState({ data: data ?? [], loading: false, error: null });
      }
    }

    initialFetch();

    const channel = supabase
      .channel(`events-realtime-${Math.random().toString(36).slice(2)}`)
      .on<EventRow>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events' },
        (payload) => {
          if (cancelled) return;
          setState((prev) => {
            const current = prev.data ?? [];
            const next = [payload.new, ...current].slice(0, limit);
            return { data: next, loading: false, error: null };
          });
        }
      )
      // Audit fix PROD-03: log channel-error / timeout and refetch on recovery.
      .subscribe((status) => {
        if (cancelled) return;
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[useEventsRealtime] channel ${status} — refetching`);
          initialFetch();
        }
      });

    function onVisibility() {
      if (document.visibilityState === 'visible' && !cancelled) {
        initialFetch();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [limit]);

  return state;
}

// Re-export the helper in case pages need to resolve relayer ids from raw data.
export { resolveRelayerId };
