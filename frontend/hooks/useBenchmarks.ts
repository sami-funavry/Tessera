'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types';

type BenchmarkRun = Database['public']['Tables']['benchmark_runs']['Row'];
type MessageRow = Database['public']['Tables']['messages']['Row'];

// ---------- generic hook state shape ----------

interface HookState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function initialState<T>(): HookState<T> {
  return { data: null, loading: true, error: null };
}

// ---------- aggregate stats type ----------

export interface BenchmarkStats {
  /** Number of benchmark runs recorded. */
  count: number;
  /** Mean end-to-end latency across all runs that have a total_latency_ms value. */
  avgLatencyMs: number | null;
  /** Mean source-chain gas used across runs that have source_gas_used. */
  avgSourceGas: number | null;
  /** Mean destination-chain gas used across runs that have dest_gas_used. */
  avgDestGas: number | null;
  /** Mean proof transform time across runs that have proof_transform_ms. */
  avgProofTransformMs: number | null;
}

// ---------- useBenchmarkRuns ----------

/**
 * Fetches the most recent benchmark runs, newest first.
 *
 * @param limit Maximum rows to return. Defaults to 20.
 */
export function useBenchmarkRuns(limit = 20): HookState<BenchmarkRun[]> {
  const [state, setState] = useState<HookState<BenchmarkRun[]>>(initialState);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setState(initialState);
      const { data, error } = await supabase
        .from('benchmark_runs')
        .select('*')
        .order('run_at', { ascending: false })
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

// ---------- useBenchmarkStats ----------

/**
 * Aggregates bridge latency and gas usage from the actual messages table.
 *
 * Latency = updated_at − created_at, computed only for rows that reached
 * status 'executed' (i.e. fully delivered cross-chain). This single source
 * of truth means the dashboard auto-fills as messages flow through —
 * no separate benchmark_runs writes required.
 *
 * The `benchmark_runs` table remains for future dedicated benchmarking
 * (P-10/P-11 scope) and is exposed via useBenchmarkRuns above.
 */
export function useBenchmarkStats(): HookState<BenchmarkStats> {
  const [state, setState] = useState<HookState<BenchmarkStats>>(initialState);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setState(initialState);

      const { data, error } = await supabase
        .from('messages')
        .select('id, created_at, updated_at, status')
        .eq('status', 'executed')
        .order('updated_at', { ascending: false })
        .limit(100);

      if (cancelled) return;

      if (error) {
        setState({ data: null, loading: false, error: error.message });
        return;
      }

      const rows = (data ?? []) as Pick<
        MessageRow,
        'id' | 'created_at' | 'updated_at' | 'status'
      >[];

      const latencies: number[] = rows
        .map((r) => {
          const start = new Date(r.created_at).getTime();
          const end = new Date(r.updated_at).getTime();
          const diff = end - start;
          return Number.isFinite(diff) && diff >= 0 ? diff : NaN;
        })
        .filter((n) => Number.isFinite(n));

      const avgLatencyMs =
        latencies.length > 0
          ? latencies.reduce((a, b) => a + b, 0) / latencies.length
          : null;

      setState({
        data: {
          count: rows.length,
          avgLatencyMs,
          // Gas data is not derivable from the messages table; fall back to
          // null. A future benchmark_runs population pass can fill these.
          avgSourceGas: null,
          avgDestGas: null,
          avgProofTransformMs: null,
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

// ---------- useLatestBenchmark ----------

/**
 * Returns the single most recent benchmark run, or null if no runs exist.
 */
export function useLatestBenchmark(): HookState<BenchmarkRun> {
  const [state, setState] = useState<HookState<BenchmarkRun>>(initialState);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setState(initialState);
      const { data, error } = await supabase
        .from('benchmark_runs')
        .select('*')
        .order('run_at', { ascending: false })
        .limit(1)
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
  }, []);

  return state;
}
