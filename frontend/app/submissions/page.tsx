'use client';

/**
 * Submissions index — paginated list of every cross-chain message.
 *
 * Built to fix audit finding UX-01 (the dashboard's "View all submissions"
 * CTA used to land on Next's generic 404). Each row deep-links to the
 * matching submission detail page.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Card from '@/components/Card';
import CopyableHash from '@/components/CopyableHash';
import SectionLabel from '@/components/SectionLabel';
import SkeletonLoader from '@/components/SkeletonLoader';
import StatusBadge from '@/components/StatusBadge';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types';

type MessageRow = Database['public']['Tables']['messages']['Row'];

const PAGE_SIZE = 25;

function formatAmount(msg: Pick<MessageRow, 'amount' | 'source_chain_id'>): string {
  const decimals = msg.source_chain_id === '11155111' ? 1e18 : 1e6;
  const n = parseFloat(String(msg.amount || '0')) / decimals;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatRoute(msg: Pick<MessageRow, 'source_chain_id' | 'destination_chain_id'>): string {
  const map: Record<string, string> = { '11155111': 'Sepolia', 'pion-1': 'Neutron' };
  return `${map[msg.source_chain_id] ?? msg.source_chain_id} → ${map[msg.destination_chain_id] ?? msg.destination_chain_id}`;
}

/**
 * Map a message-row `status` string to the (activityType, activity) tuple
 * StatusBadge expects. Keeps the badge color scheme consistent with the
 * dashboard relayer cards.
 */
function statusBadgeProps(status: string): { activityType: string; activity: string } {
  switch (status) {
    case 'executed':
    case 'finalized':
    case 'confirmed':
      return { activityType: 'idle', activity: status };
    case 'pending':
    case 'submitted':
    case 'challenge_window':
      return { activityType: 'busy', activity: status };
    case 'reverted':
    case 'slashed':
    case 'challenged':
      return { activityType: 'deregistered', activity: status };
    default:
      return { activityType: 'cooling', activity: status };
  }
}

export default function SubmissionsIndexPage() {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<MessageRow[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchPage() {
      setRows(null);
      setError(null);
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error: dbErr, count } = await supabase
        .from('messages')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);
      if (cancelled) return;
      if (dbErr) {
        setError(dbErr.message);
        setRows([]);
        return;
      }
      setRows(data ?? []);
      if (typeof count === 'number') setTotal(count);
    }
    fetchPage();
    return () => {
      cancelled = true;
    };
  }, [page]);

  const totalPages = total != null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 page-enter">
      <div className="mb-10">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-2">
          Submissions
        </div>
        <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-3">
          Every cross-chain message.
        </h1>
        <p className="text-stone-400 max-w-2xl leading-relaxed">
          Paginated index of every Tessera message — newest first. Click a row to inspect its
          proof roadmap, on-chain hashes, and verification status.
        </p>
      </div>

      <SectionLabel className="mb-4">All submissions</SectionLabel>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead className="border-b border-stone-800 bg-stone-950/40">
            <tr className="text-[10px] font-mono uppercase tracking-wider text-stone-400">
              <th className="text-left px-5 py-3">#</th>
              <th className="text-left px-5 py-3">Route</th>
              <th className="text-left px-5 py-3">Amount</th>
              <th className="text-left px-5 py-3">State</th>
              <th className="text-left px-5 py-3">Source tx</th>
              <th className="text-left px-5 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows == null && (
              <tr>
                <td colSpan={6} className="px-5 py-8">
                  <SkeletonLoader />
                </td>
              </tr>
            )}
            {rows != null && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-stone-500 text-sm">
                  {error
                    ? `Error loading submissions: ${error}`
                    : 'No submissions yet — run a scenario from the Demo page or bridge from the homepage.'}
                </td>
              </tr>
            )}
            {rows != null &&
              rows.map((m, i) => {
                const sourceChain: 'sepolia' | 'neutron' =
                  m.source_chain_id === '11155111' ? 'sepolia' : 'neutron';
                return (
                  <motion.tr
                    key={m.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: Math.min(i * 0.02, 0.4) }}
                    onClick={() => router.push(`/submissions/${m.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        router.push(`/submissions/${m.id}`);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className="border-b border-stone-800/50 hover:bg-stone-950/40 cursor-pointer focus-visible:outline-none focus-visible:bg-stone-950/60"
                  >
                    <td className="px-5 py-3 font-mono text-stone-300">#{m.id}</td>
                    <td className="px-5 py-3 text-stone-300">{formatRoute(m)}</td>
                    <td className="px-5 py-3 font-mono text-stone-300">{formatAmount(m)} tUSDC</td>
                    <td className="px-5 py-3">
                      <StatusBadge {...statusBadgeProps(m.status)} size="sm" />
                    </td>
                    <td className="px-5 py-3">
                      {m.source_tx_hash ? (
                        <CopyableHash
                          value={m.source_tx_hash}
                          displayLength={10}
                          explorer={sourceChain}
                          className="text-stone-300"
                        />
                      ) : (
                        <span className="text-stone-500 font-mono text-xs">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-stone-400 text-xs">
                      {new Date(m.created_at).toLocaleString()}
                    </td>
                  </motion.tr>
                );
              })}
          </tbody>
        </table>
      </Card>

      {/* Pagination */}
      {totalPages != null && totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between text-xs font-mono">
          <span className="text-stone-400">
            Page {page + 1} of {totalPages} · {total} total
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="px-3 py-1.5 rounded border border-stone-800 text-stone-300 hover:border-stone-600 hover:text-stone-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-400/60"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 rounded border border-stone-800 text-stone-300 hover:border-stone-600 hover:text-stone-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-400/60"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
