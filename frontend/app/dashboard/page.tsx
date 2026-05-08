'use client';

import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import Card from '@/components/Card';
import CopyableHash from '@/components/CopyableHash';
import SectionLabel from '@/components/SectionLabel';
import SkeletonLoader from '@/components/SkeletonLoader';
import StatusBadge from '@/components/StatusBadge';
import { useMessagesRealtime, useSystemStats } from '@/hooks/useMessages';
import { useRelayerStats } from '@/hooks/useRelayers';
import { RELAYER_ADDRESSES } from '@/lib/config';
import type { Database, RelayerInfo } from '@/types';

type MessageRow = Database['public']['Tables']['messages']['Row'];

// ---------- static fallback data ----------

const STATIC_RELAYERS: RelayerInfo[] = [
  {
    id: 'A',
    name: 'Relayer A',
    sepoliaAddress: RELAYER_ADDRESSES.A.sepolia,
    neutronAddress: RELAYER_ADDRESSES.A.neutron,
    activity: 'Submitting',
    activityType: 'busy',
    bond: { sepolia: { gas: 0.052, bond: 0.45 }, neutron: { gas: 12.4, bond: 92.0 } },
    earned: 0.01243,
    slashed: 0,
    submissions: 47,
    successRate: 100,
  },
  {
    id: 'B',
    name: 'Relayer B',
    sepoliaAddress: RELAYER_ADDRESSES.B.sepolia,
    neutronAddress: RELAYER_ADDRESSES.B.neutron,
    activity: 'Watching',
    activityType: 'idle',
    bond: { sepolia: { gas: 0.041, bond: 0.5 }, neutron: { gas: 15.2, bond: 100.0 } },
    earned: 0.00863,
    slashed: 0,
    submissions: 31,
    successRate: 100,
  },
];

// ---------- helpers ----------

/**
 * Derives a display string for route from source_chain_id → destination_chain_id.
 */
function routeLabel(msg: MessageRow): string {
  const src =
    msg.source_chain_id === '11155111' ? 'Sepolia' : 'Neutron';
  const dst =
    msg.destination_chain_id === '11155111' ? 'Sepolia' : 'Neutron';
  return `${src} → ${dst}`;
}

/**
 * Source explorer chain derived from source_chain_id.
 */
function sourceChain(msg: MessageRow): 'sepolia' | 'neutron' {
  return msg.source_chain_id === '11155111' ? 'sepolia' : 'neutron';
}

/**
 * Destination explorer chain — opposite of source.
 */
function destChain(msg: MessageRow): 'sepolia' | 'neutron' {
  return msg.source_chain_id === '11155111' ? 'neutron' : 'sepolia';
}

const STATUS_COLOR: Record<string, string> = {
  executed: 'text-emerald-400',
  challenge_window: 'text-amber-400',
  submitted: 'text-amber-400',
  challenged: 'text-red-400',
  reverted: 'text-red-400',
  pending: 'text-stone-400',
};

const STATUS_LABEL: Record<string, string> = {
  executed: 'finalized',
  challenge_window: 'pending',
  submitted: 'submitted',
  challenged: 'challenged',
  reverted: 'reverted',
  pending: 'pending',
};

// ---------- sub-components ----------

function Metric({
  label,
  value,
  delta,
  sub,
  index = 0,
}: {
  label: string;
  value: string;
  delta?: string;
  sub?: string;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.06 }}
      className="bg-stone-950 px-6 py-5"
    >
      <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-2">
        {label}
      </div>
      <div className="font-display text-2xl sm:text-3xl text-stone-100">{value}</div>
      {delta && (
        <div className="text-xs font-mono text-emerald-400 mt-1">{delta}</div>
      )}
      {sub && <div className="text-xs text-stone-500 mt-1">{sub}</div>}
    </motion.div>
  );
}

// ---------- page ----------

export default function DashboardPage() {
  const router = useRouter();

  const systemStats = useSystemStats();
  const relayerStats = useRelayerStats();
  const messagesData = useMessagesRealtime(10);

  /* Resolve display data — real or static fallback. */
  const relayers: RelayerInfo[] =
    relayerStats.data && relayerStats.data.length > 0
      ? relayerStats.data
      : STATIC_RELAYERS;

  const messages: MessageRow[] = messagesData.data ?? [];

  /*
   * Derive metric values.  When real systemStats are loading, show skeleton
   * text; once loaded (or error) display the value or a fallback.
   */
  const totalVolume =
    systemStats.loading
      ? null
      : messages.length > 0
        ? `${messages.reduce((acc, m) => acc + parseFloat(m.amount || '0'), 0).toLocaleString()} tUSDC`
        : '42,180 tUSDC';

  const activeRelayerCount =
    relayers.filter((r) => r.activityType !== 'deregistered').length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 page-enter">
      {/* Page header */}
      <div className="mb-10">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-2">
          System Dashboard
        </div>
        <h1 className="font-display text-4xl sm:text-5xl text-stone-100">
          Operational state.
        </h1>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-stone-800/60 border border-stone-800 rounded-md mb-12 overflow-hidden">
        <Metric
          label="Total volume bridged"
          value={totalVolume ?? '—'}
          delta="+12.4% (24h)"
          index={0}
        />
        <Metric
          label="Active relayers"
          value={String(activeRelayerCount)}
          sub="Both healthy"
          index={1}
        />
        <Metric
          label="Avg. bridge time"
          value="78s"
          sub="Median 74s"
          index={2}
        />
        <Metric
          label="Successful frauds"
          value={
            systemStats.data
              ? String(systemStats.data.successfulFrauds)
              : '0'
          }
          delta="All time"
          index={3}
        />
      </div>

      {/* Active relayers table */}
      <SectionLabel className="mb-4">Active relayers</SectionLabel>
      <Card className="overflow-x-auto mb-12">
        <table className="w-full text-sm min-w-[800px]">
          <thead className="border-b border-stone-800 bg-stone-950/40">
            <tr className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              <th className="text-left px-5 py-3">Relayer</th>
              <th className="text-left px-5 py-3">Status</th>
              <th className="text-left px-5 py-3">Sepolia bond</th>
              <th className="text-left px-5 py-3">Neutron bond</th>
              <th className="text-left px-5 py-3">Submissions</th>
              <th className="text-left px-5 py-3">Success rate</th>
              <th className="text-left px-5 py-3">Earned (24h)</th>
            </tr>
          </thead>
          <tbody>
            {relayerStats.loading
              ? Array.from({ length: 2 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7}>
                      <SkeletonLoader variant="table-row" />
                    </td>
                  </tr>
                ))
              : relayers.map((r, i) => (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.25, delay: i * 0.06 }}
                    className="border-b border-stone-800/60 last:border-b-0 hover:bg-stone-900/40 transition-colors"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-stone-900 border border-stone-700 flex items-center justify-center font-mono text-xs shrink-0">
                          {r.id}
                        </div>
                        <span className="text-stone-200">{r.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge
                        activityType={r.activityType}
                        activity={r.activity}
                        size="sm"
                      />
                    </td>
                    <td className="px-5 py-3.5 font-mono text-stone-300">
                      {r.bond.sepolia.bond.toFixed(3)} ETH
                    </td>
                    <td className="px-5 py-3.5 font-mono text-stone-300">
                      {r.bond.neutron.bond.toFixed(1)} NTRN
                    </td>
                    <td className="px-5 py-3.5 font-mono text-stone-300">
                      {r.submissions}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="font-mono text-emerald-400">
                        {r.successRate}%
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-emerald-400">
                      +{r.earned.toFixed(4)} ETH
                    </td>
                  </motion.tr>
                ))}
          </tbody>
        </table>
      </Card>

      {/* Recent submissions table */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500">
          Recent submissions
        </span>
        <button
          onClick={() => router.push('/submissions')}
          className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1.5 group transition-colors"
        >
          View all submissions
          <ArrowRight
            size={11}
            className="group-hover:translate-x-0.5 transition-transform"
          />
        </button>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="border-b border-stone-800 bg-stone-950/40">
            <tr className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              <th className="text-left px-5 py-3">#</th>
              <th className="text-left px-5 py-3">Route</th>
              <th className="text-left px-5 py-3">Amount</th>
              <th className="text-left px-5 py-3">Relayer</th>
              <th className="text-left px-5 py-3">State</th>
              <th className="text-left px-5 py-3">Source tx</th>
              <th className="text-left px-5 py-3">Destination tx</th>
              <th className="text-left px-5 py-3">Time</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {messagesData.loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={9}>
                      <SkeletonLoader variant="table-row" />
                    </td>
                  </tr>
                ))
              : messages.slice(0, 5).map((msg, i) => {
                  const statusLabel = STATUS_LABEL[msg.status] ?? msg.status;
                  const statusColorClass =
                    STATUS_COLOR[msg.status] ?? 'text-stone-400';
                  const srcChain = sourceChain(msg);
                  const dstChain = destChain(msg);

                  return (
                    <motion.tr
                      key={msg.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.25, delay: 0.05 + i * 0.05 }}
                      className="border-b border-stone-800/60 last:border-b-0 hover:bg-stone-900/40 cursor-pointer transition-colors"
                      onClick={() => router.push(`/submissions/${msg.id}`)}
                    >
                      <td className="px-5 py-3.5 font-mono text-stone-400">
                        #{msg.id}
                      </td>
                      <td className="px-5 py-3.5 text-stone-300">
                        {routeLabel(msg)}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-stone-200">
                        {parseFloat(msg.amount || '0').toLocaleString()} tUSDC
                      </td>
                      <td className="px-5 py-3.5 text-stone-300">
                        {/* Map submitter address to A/B label if possible. */}
                        {msg.sender.toLowerCase() ===
                          RELAYER_ADDRESSES.A.sepolia.toLowerCase() ||
                        msg.sender.toLowerCase() ===
                          RELAYER_ADDRESSES.A.neutron.toLowerCase()
                          ? 'Relayer A'
                          : msg.sender.toLowerCase() ===
                              RELAYER_ADDRESSES.B.sepolia.toLowerCase() ||
                            msg.sender.toLowerCase() ===
                              RELAYER_ADDRESSES.B.neutron.toLowerCase()
                          ? 'Relayer B'
                          : msg.sender.slice(0, 8) + '…'}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`font-mono text-xs uppercase tracking-wider ${statusColorClass}`}
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <CopyableHash
                          value={msg.source_tx_hash}
                          displayLength={10}
                          explorer={srcChain}
                          className="text-stone-300"
                        />
                      </td>
                      <td className="px-5 py-3.5">
                        {/* Destination tx not yet available on MessageRow; show placeholder. */}
                        <span className="text-stone-500 font-mono text-xs">—</span>
                      </td>
                      <td className="px-5 py-3.5 text-stone-400 text-xs">
                        {new Date(msg.updated_at).toLocaleTimeString('en-US', {
                          hour12: false,
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-5 py-3.5">
                        <ArrowRight size={13} className="text-stone-600" />
                      </td>
                    </motion.tr>
                  );
                })}

            {/* Empty state when no messages and not loading */}
            {!messagesData.loading && messages.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-5 py-8 text-center text-stone-600 font-mono text-xs"
                >
                  No submissions yet — run a demo scenario to see activity here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
