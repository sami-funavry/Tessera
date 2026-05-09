'use client';

import { AlertCircle, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { motion } from 'framer-motion';
import Card from '@/components/Card';
import SectionLabel from '@/components/SectionLabel';
import SkeletonLoader from '@/components/SkeletonLoader';
import { useBenchmarkStats } from '@/hooks/useBenchmarks';
import { cn } from '@/lib/utils';
import type { BenchmarkStats } from '@/hooks/useBenchmarks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BoldSectionColor = 'amber' | 'red' | 'emerald';

interface BoldSectionProps {
  number: string;
  title: string;
  color: BoldSectionColor;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  items: string[];
}

// ---------------------------------------------------------------------------
// BoldSection
// ---------------------------------------------------------------------------

function BoldSection({ number, title, color, icon: Icon, items }: BoldSectionProps) {
  const colorMap: Record<BoldSectionColor, { text: string; border: string; bg: string }> = {
    amber: { text: 'text-amber-400', border: 'border-amber-400/30', bg: 'bg-amber-400/5' },
    red: { text: 'text-red-400', border: 'border-red-400/30', bg: 'bg-red-400/5' },
    emerald: { text: 'text-emerald-400', border: 'border-emerald-400/30', bg: 'bg-emerald-400/5' },
  };
  const c = colorMap[color];

  return (
    <div className="grid lg:grid-cols-[auto_1fr] gap-6 lg:gap-12 items-start">
      <div className={cn('flex items-center gap-4', c.text)}>
        <span className="font-display text-6xl leading-none opacity-40">{number}</span>
        <Icon size={28} strokeWidth={1.5} />
      </div>
      <div>
        <h2 className="font-display text-3xl sm:text-4xl text-stone-100 mb-5">{title}</h2>
        <div className="grid sm:grid-cols-2 gap-2.5">
          {items.map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07, duration: 0.35 }}
              className={cn('flex gap-3 p-4 border rounded-sm', c.bg, c.border)}
            >
              <span className={cn('font-mono text-xs shrink-0', c.text)}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="text-sm text-stone-200">{item}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TesseraLatency — formats a latency value from stats or falls back to spec
// ---------------------------------------------------------------------------

function tesseraLatency(stats: BenchmarkStats | null): string {
  // P-10.11: no live data → render spec target rather than an invented range,
  // per the no-fabricated-numerical-claims rule (CLAUDE.md anti-hallucination
  // #3). BRIDGE_PARAMS.estimatedTimeSec = 90 is the only authoritative value.
  if (!stats || stats.avgLatencyMs === null) return '~90s (spec target)';
  const secs = Math.round(stats.avgLatencyMs / 1000);
  return `~${secs}s`;
}

function tesseraDestGas(stats: BenchmarkStats | null): string {
  // P-10.11: no live data → dash. We don't have a measured gas number to cite.
  if (!stats || stats.avgDestGas === null) return '—';
  const k = Math.round(stats.avgDestGas / 1000);
  return `~${k}k`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BenchmarkPage() {
  const { data: stats, loading } = useBenchmarkStats();
  const hasLiveData = !loading && stats !== null && stats.count > 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
      {/* ── Header ── */}
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-2">
          Benchmark
        </div>
        <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-3">
          How Tessera compares.
        </h1>
        <p className="text-stone-400 max-w-3xl">
          Reference values from each project&apos;s documentation as of May 2026. Cross-chain
          performance varies significantly by network conditions, source-chain finality
          requirements, and validator set composition.
        </p>
      </motion.div>

      {/* ── Methodology callout ── */}
      <motion.div
        className="mb-8 p-4 bg-amber-400/5 border border-amber-400/20 rounded-sm flex gap-3"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.35 }}
      >
        <AlertCircle size={16} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="text-sm text-stone-300">
          <span className="text-amber-300 font-medium">Methodology note · </span>
          Tessera&apos;s numbers update automatically from local benchmark runs in this
          deployment. Other platforms&apos; figures are static reference points sourced from
          public documentation. Run your own benchmarks before drawing strong conclusions.
        </div>
      </motion.div>

      {/* ── Comparison table ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
        className="mb-16"
      >
        <Card className="overflow-x-auto">
          {loading ? (
            <div className="p-4 space-y-3">
              <SkeletonLoader variant="table-row" />
              <SkeletonLoader variant="table-row" />
              <SkeletonLoader variant="table-row" />
              <SkeletonLoader variant="table-row" />
            </div>
          ) : (
            <table className="w-full text-sm min-w-[900px]">
              <thead className="border-b border-stone-800 bg-stone-950/40">
                <tr className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                  <th className="text-left px-5 py-3.5">Platform</th>
                  <th className="text-left px-5 py-3.5">Trust assumption</th>
                  <th className="text-left px-5 py-3.5">Latency</th>
                  <th className="text-left px-5 py-3.5">Destination gas</th>
                  <th className="text-left px-5 py-3.5">Off-chain infra</th>
                  <th className="text-left px-5 py-3.5">Slashing</th>
                  <th className="text-left px-5 py-3.5">Cosmos ↔ EVM</th>
                </tr>
              </thead>
              <tbody>
                {/* Tessera row */}
                <tr className="border-b border-stone-800/60 bg-orange-400/[0.03]">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                      <span className="text-stone-100 font-medium">Tessera</span>
                      {hasLiveData ? (
                        <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 bg-emerald-400/10 text-emerald-300 rounded">
                          Live
                        </span>
                      ) : (
                        <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 bg-stone-700/60 text-stone-400 rounded">
                          Reference
                        </span>
                      )}
                      {hasLiveData && stats && (
                        <span className="text-[9px] font-mono text-stone-500">
                          n={stats.count}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-stone-200">≥1 honest challenger online</td>
                  <td className="px-5 py-4 font-mono text-stone-200">
                    {tesseraLatency(stats)}
                  </td>
                  <td className="px-5 py-4 font-mono text-stone-200">
                    {tesseraDestGas(stats)}
                  </td>
                  <td className="px-5 py-4 text-stone-300">Commodity (Go service)</td>
                  <td className="px-5 py-4 text-emerald-300">50% / 25% bonded</td>
                  <td className="px-5 py-4 text-emerald-300">Primary focus</td>
                </tr>

                {/* Wormhole */}
                <tr className="border-b border-stone-800/60 hover:bg-stone-900/40 transition-colors">
                  <td className="px-5 py-4 text-stone-200">Wormhole</td>
                  <td className="px-5 py-4 text-stone-300">13-of-19 Guardians honest</td>
                  <td className="px-5 py-4 font-mono text-stone-300">30s–2min</td>
                  <td className="px-5 py-4 font-mono text-stone-300">Low–mid</td>
                  <td className="px-5 py-4 text-stone-300">Guardian network</td>
                  <td className="px-5 py-4 text-stone-400">No bonded slashing</td>
                  <td className="px-5 py-4 text-stone-300">Yes</td>
                </tr>

                {/* Axelar */}
                <tr className="border-b border-stone-800/60 hover:bg-stone-900/40 transition-colors">
                  <td className="px-5 py-4 text-stone-200">Axelar</td>
                  <td className="px-5 py-4 text-stone-300">2/3 validators by stake</td>
                  <td className="px-5 py-4 font-mono text-stone-300">1–3min</td>
                  <td className="px-5 py-4 font-mono text-stone-300">Mid (extra hop)</td>
                  <td className="px-5 py-4 text-stone-300">Full validator chain</td>
                  <td className="px-5 py-4 text-stone-300">Validator slashing</td>
                  <td className="px-5 py-4 text-stone-300">Yes</td>
                </tr>

                {/* ZK-IBC */}
                <tr className="hover:bg-stone-900/40 transition-colors">
                  <td className="px-5 py-4 text-stone-200">ZK-IBC</td>
                  <td className="px-5 py-4 text-stone-300">Cryptographic</td>
                  <td className="px-5 py-4 font-mono text-stone-300">Minutes (prover)</td>
                  <td className="px-5 py-4 font-mono text-stone-300">Mid–high + prover $</td>
                  <td className="px-5 py-4 text-stone-300">GPU prover infra</td>
                  <td className="px-5 py-4 text-stone-400">N/A (cryptographic)</td>
                  <td className="px-5 py-4 text-stone-300">Yes</td>
                </tr>
              </tbody>
            </table>
          )}
        </Card>
      </motion.div>

      {/* ── Bold sections ── */}
      <SectionLabel className="mb-10">Analysis</SectionLabel>
      <div className="space-y-14">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
        >
          <BoldSection
            number="01"
            title="Current limitations"
            color="amber"
            icon={AlertCircle}
            items={[
              'Two-relayer demo scale, not production diversity',
              '60s challenge window — short for high-value transfers',
              'Trusts source-chain RPCs for consensus information',
              'Single VM family per destination (EVM, CosmWasm)',
            ]}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, duration: 0.4 }}
        >
          <BoldSection
            number="02"
            title="Production risks"
            color="red"
            icon={AlertTriangle}
            items={[
              'Needs genuinely independent relayer operators',
              'Bond capital must scale with assets at risk',
              'RPC trust assumption needs hardening',
              'Active challenger ecosystem required for liveness',
            ]}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.36, duration: 0.4 }}
        >
          <BoldSection
            number="03"
            title="Future work"
            color="emerald"
            icon={ArrowUpRight}
            items={[
              'Validator-style mempool propagation for relayers',
              'Stake-weighted random submitter assignment',
              'Value-aware challenge windows',
              'Native beacon chain light client integration',
              'Solana, Sui, and Move-based VM plugins',
            ]}
          />
        </motion.div>
      </div>
    </div>
  );
}
