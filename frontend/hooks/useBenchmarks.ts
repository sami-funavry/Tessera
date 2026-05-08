'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types';

type BenchmarkRun = Database['public']['Tables']['benchmark_runs']['Row'];

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
 * Aggregates benchmark_runs into summary statistics.
 *
 * Averaging is done client-side over at most 100 rows so we do not need a
 * custom Postgres RPC for the demo. Phase 10 can replace this with a
 * server-side aggregate if row counts grow.
 */
export function useBenchmarkStats(): HookState<BenchmarkStats> {
  const [state, setState] = useState<HookState<BenchmarkStats>>(initialState);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setState(initialState);

      // Fetch up to 100 rows for the aggregate — sufficient for the demo.
      // Using select('*') to preserve the full typed BenchmarkRun row shape;
      // a partial column list causes the Supabase client to infer `never`.
      const { data, error } = await supabase
        .from('benchmark_runs')
        .select('*')
        .order('run_at', { ascending: false })
        .limit(100);

      if (cancelled) return;

      if (error) {
        setState({ data: null, loading: false, error: error.message });
        return;
      }

      // The Supabase typed client occasionally infers `never[]` in the stats
      // path — casting through the concrete row type is safe because we own
      // the Database type definition.
      const rows = (data ?? []) as BenchmarkRun[];

      function avg(values: (number | null)[]): number | null {
        const valid = values.filter((v): v is number => v !== null);
        if (valid.length === 0) return null;
        return valid.reduce((a, b) => a + b, 0) / valid.length;
      }

      setState({
        data: {
          count: rows.length,
          avgLatencyMs: avg(rows.map((r) => r.total_latency_ms)),
          avgSourceGas: avg(rows.map((r) => r.source_gas_used)),
          avgDestGas: avg(rows.map((r) => r.dest_gas_used)),
          avgProofTransformMs: avg(rows.map((r) => r.proof_transform_ms)),
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
