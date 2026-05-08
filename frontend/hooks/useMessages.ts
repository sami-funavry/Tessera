'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Database, SystemStats } from '@/types';

type MessageRow = Database['public']['Tables']['messages']['Row'];
type DisputeRow = Database['public']['Tables']['disputes']['Row'];

// ---------- generic hook state shape ----------

interface HookState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function initialState<T>(): HookState<T> {
  return { data: null, loading: true, error: null };
}

// ---------- useRecentMessages ----------

/**
 * Fetches the most recently updated messages, newest first.
 *
 * @param limit Maximum rows to return. Defaults to 10.
 */
export function useRecentMessages(limit = 10): HookState<MessageRow[]> {
  const [state, setState] = useState<HookState<MessageRow[]>>(initialState);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setState(initialState);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .order('updated_at', { ascending: false })
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

// ---------- useMessage ----------

/**
 * Fetches a single message by its numeric primary key.
 */
export function useMessage(id: number): HookState<MessageRow> {
  const [state, setState] = useState<HookState<MessageRow>>(initialState);

  useEffect(() => {
    // Guard: don't send a Supabase query for non-numeric IDs (would produce a 400).
    if (!Number.isFinite(id)) {
      setState({ data: null, loading: false, error: 'invalid id' });
      return;
    }

    let cancelled = false;

    async function fetch() {
      setState(initialState);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        setState({ data: null, loading: false, error: error.message });
      } else {
        setState({ data: data ?? null, loading: false, error: null });
      }
    }

    fetch();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return state;
}

// ---------- useMessageByNonce ----------

/**
 * Looks up a message by its (source_chain_id, nonce) composite key.
 * Returns the first matching row — the combination should be unique in practice.
 */
export function useMessageByNonce(
  sourceChainId: string,
  nonce: number
): HookState<MessageRow> {
  const [state, setState] = useState<HookState<MessageRow>>(initialState);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setState(initialState);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('source_chain_id', sourceChainId)
        .eq('nonce', nonce)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        setState({ data: null, loading: false, error: error.message });
      } else {
        setState({ data: data ?? null, loading: false, error: null });
      }
    }

    fetch();
    return () => {
      cancelled = true;
    };
  }, [sourceChainId, nonce]);

  return state;
}

// ---------- useSystemStats ----------

/**
 * Derives aggregate statistics from the messages and disputes tables.
 *
 * Counts are performed server-side via Supabase's `head: true` option so only
 * the count scalar is transferred — not the full row data.
 */
export function useSystemStats(): HookState<SystemStats> {
  const [state, setState] = useState<HookState<SystemStats>>(initialState);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setState(initialState);

      const sevenDaysAgo = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      ).toISOString();

      const [transfersResult, challengesResult, fraudsResult] =
        await Promise.all([
          // Total message count
          supabase
            .from('messages')
            .select('*', { count: 'exact', head: true }),

          // Disputes filed in the last 7 days
          supabase
            .from('disputes')
            .select('*', { count: 'exact', head: true })
            .gte('filed_at', sevenDaysAgo),

          // Disputes resolved in favour of the challenger (fraud confirmed)
          supabase
            .from('disputes')
            .select('*', { count: 'exact', head: true })
            .eq('outcome', 'upheld' satisfies DisputeRow['outcome']),
        ]);

      if (cancelled) return;

      const errors = [
        transfersResult.error,
        challengesResult.error,
        fraudsResult.error,
      ].filter(Boolean);

      if (errors.length > 0) {
        setState({
          data: null,
          loading: false,
          error: errors.map((e) => e!.message).join('; '),
        });
        return;
      }

      setState({
        data: {
          transfers: transfersResult.count ?? 0,
          /*
           * activeRelayers is derived from the bonds table, not here.
           * We return 0 as a sentinel; callers that need this field should
           * combine useSystemStats() with useRelayerStats().
           */
          activeRelayers: 0,
          challengesThisWeek: challengesResult.count ?? 0,
          successfulFrauds: fraudsResult.count ?? 0,
          lastSync: new Date().toISOString(),
        },
        loading: false,
        error: null,
      });
    }

    fetch();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

// ---------- useMessagesRealtime ----------

/**
 * Same as useRecentMessages but keeps the list live via Supabase Realtime.
 * The subscription is torn down when the component unmounts.
 *
 * @param limit Maximum rows shown at any time. Defaults to 10.
 */
export function useMessagesRealtime(limit = 10): HookState<MessageRow[]> {
  const [state, setState] = useState<HookState<MessageRow[]>>(initialState);

  useEffect(() => {
    let cancelled = false;

    /*
     * Initial fetch — populate the list before the realtime connection
     * establishes so the UI never shows an empty state for longer than
     * necessary.
     */
    async function initialFetch() {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(limit);

      if (cancelled) return;

      if (error) {
        setState({ data: null, loading: false, error: error.message });
      } else {
        setState({ data: data ?? [], loading: false, error: null });
      }
    }

    initialFetch();

    /*
     * Realtime subscription — merge incoming changes into the local list
     * rather than re-fetching everything on every event.
     */
    const channel = supabase
      .channel(`messages-realtime-${Math.random().toString(36).slice(2)}`)
      .on<MessageRow>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        (payload) => {
          if (cancelled) return;

          setState((prev) => {
            const current = prev.data ?? [];

            if (payload.eventType === 'INSERT') {
              const next = [payload.new, ...current].slice(0, limit);
              return { data: next, loading: false, error: null };
            }

            if (
              payload.eventType === 'UPDATE' &&
              payload.new !== null
            ) {
              const next = current.map((m) =>
                m.id === (payload.new as MessageRow).id
                  ? (payload.new as MessageRow)
                  : m
              );
              return { data: next, loading: false, error: null };
            }

            if (payload.eventType === 'DELETE' && payload.old !== null) {
              const next = current.filter(
                (m) => m.id !== (payload.old as Pick<MessageRow, 'id'>).id
              );
              return { data: next, loading: false, error: null };
            }

            return prev;
          });
        }
      )
      // Audit fix PROD-03: surface channel state changes so a silent
      // disconnect can at least log + refetch instead of leaving the page
      // visibly fresh while the data goes stale. CHANNEL_ERROR / TIMED_OUT
      // trigger a one-shot fetch so the dashboard self-heals when the
      // websocket comes back. CLOSED is expected during cleanup; ignore.
      .subscribe((status) => {
        if (cancelled) return;
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[useMessagesRealtime] channel ${status} — refetching`);
          initialFetch();
        }
      });

    // Tab-visibility refetch: when the user comes back to the tab, refresh
    // the list in case any realtime events were dropped while hidden.
    function onVisibility() {
      if (document.visibilityState === 'visible' && !cancelled) {
        initialFetch();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      supabase.removeChannel(channel);
    };
  }, [limit]);

  return state;
}
