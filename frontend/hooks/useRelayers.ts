'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { RELAYER_ADDRESSES } from '@/lib/config';
import type { Database, RelayerInfo } from '@/types';

type BondRow = Database['public']['Tables']['bonds']['Row'];
type SubmissionRow = Database['public']['Tables']['submissions']['Row'];
type EventRow = Database['public']['Tables']['events']['Row'];

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
       * Execute the two queries sequentially rather than via Promise.all so
       * TypeScript can narrow the inferred row types correctly.  The Supabase
       * typed client loses the row type inside Promise.all's tuple inference,
       * resulting in `never[]` arrays.
       */
      const bondsResult = await supabase.from('bonds').select('*');
      const submissionsResult = await supabase.from('submissions').select('*');

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

      const bonds: BondRow[] = bondsResult.data ?? [];
      const submissions: SubmissionRow[] = submissionsResult.data ?? [];

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

        const isOperating =
          (sepoliaBond?.threshold_status === 'operating' ||
            neutronBond?.threshold_status === 'operating') &&
          sepoliaBond?.threshold_status !== 'deregistered' &&
          neutronBond?.threshold_status !== 'deregistered';

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
          if (isOperating) return 'busy';
          return 'idle';
        })();

        const ACTIVITY_LABELS: Record<RelayerInfo['activityType'], string> = {
          busy: 'Submitting',
          benched: 'Bond below operating threshold',
          deregistered: 'Deregistered',
          cooling: 'Cooling off',
          idle: 'Idle',
        };
        const activity = ACTIVITY_LABELS[activityType];

        return {
          id,
          name: `Relayer ${id}`,
          sepoliaAddress: addrs.sepolia,
          neutronAddress: addrs.neutron,
          activity,
          activityType,
          bond: {
            sepolia: {
              /*
               * bond column is stored as a string (numeric) to avoid JS
               * BigInt/float precision loss. Parse to Number for display.
               * Gas cost for bond operations is not stored; default to 0.
               */
              gas: 0,
              bond: sepoliaBond ? Number(sepoliaBond.balance) : 0,
            },
            neutron: {
              gas: 0,
              bond: neutronBond ? Number(neutronBond.balance) : 0,
            },
          },
          earned: 0,   // Placeholder — fee accounting not yet in DB schema.
          slashed: relayerSubmissions.filter((s) => s.status === 'slashed').length,
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
      .channel('events-realtime')
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
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [limit]);

  return state;
}

// Re-export the helper in case pages need to resolve relayer ids from raw data.
export { resolveRelayerId };
