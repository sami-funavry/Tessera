'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types';

type EventRow = Database['public']['Tables']['events']['Row'];

interface HookState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Subscribes to all `events` rows tied to a particular message via the nonce
 * stored in `raw_data.nonce`. Used by the bridge widget proof roadmap to
 * advance through real on-chain stages instead of fake timeouts.
 *
 * Realtime: new INSERTs on `events` are merged into the local list when their
 * `raw_data.nonce` matches the supplied nonce. We filter client-side because
 * Supabase's realtime layer cannot filter on JSONB fields.
 */
export function useMessageEvents(nonce: number | null): HookState<EventRow[]> {
  const [state, setState] = useState<HookState<EventRow[]>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (nonce == null) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    let cancelled = false;

    async function initialFetch() {
      // Use Postgres' `->>'nonce'` operator via Supabase's filter syntax:
      //   raw_data->>nonce = '12345'
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .filter('raw_data->>nonce', 'eq', String(nonce))
        .order('indexed_at', { ascending: true });

      if (cancelled) return;
      if (error) {
        setState({ data: null, loading: false, error: error.message });
      } else {
        setState({ data: data ?? [], loading: false, error: null });
      }
    }

    initialFetch();

    const channel = supabase
      .channel(`msg-events-${nonce}-${Math.random().toString(36).slice(2)}`)
      .on<EventRow>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events' },
        (payload) => {
          if (cancelled) return;
          const row = payload.new;
          // Filter client-side; raw_data is JSONB and we want only events
          // for this nonce.
          const rowNonce = (row.raw_data as { nonce?: number | string } | null)?.nonce;
          if (rowNonce == null) return;
          if (Number(rowNonce) !== nonce) return;

          setState((prev) => {
            const current = prev.data ?? [];
            // Avoid duplicates if the initial fetch raced.
            if (current.some((e) => e.id === row.id)) return prev;
            return {
              data: [...current, row],
              loading: false,
              error: null,
            };
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [nonce]);

  return state;
}
