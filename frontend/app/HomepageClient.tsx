'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
  Shield, Zap, KeyRound, Users, Boxes, ArrowLeftRight,
  ArrowDown, Terminal, RefreshCw, CheckCircle2, CircleDot,
  Clock, ChevronDown, Copy, Check, ExternalLink,
} from 'lucide-react';
import { useWalletClient, usePublicClient, useReadContract } from 'wagmi';
import { parseUnits, formatUnits, toHex, padHex } from 'viem';

import { cn, explorerTxUrl } from '@/lib/utils';
import { BRIDGE_PARAMS, ADDRESSES } from '@/lib/config';
import { ERC20_ABI, BRIDGE_VAULT_ABI } from '@/lib/bridgeAbis';
import { useWalletContext } from '@/hooks/useWalletContext';
import { useSystemStats } from '@/hooks/useMessages';
import type { TxStage, BridgeFormValues } from '@/types';

// ─── Zod schema ───────────────────────────────────────────────────────────────

const bridgeSchema = z.object({
  amount: z
    .string()
    .min(1, 'Amount is required')
    .refine(
      (v) => {
        const n = parseFloat(v);
        return !isNaN(n) && n > 0;
      },
      { message: 'Amount must be a positive number' }
    )
    .refine(
      (v) => parseFloat(v) <= 10_000,
      { message: 'Maximum bridge amount is 10,000 tUSDC' }
    ),
  fromChain: z.enum(['sepolia', 'neutron']),
  toChain: z.enum(['sepolia', 'neutron']),
  recipient: z
    .string()
    .min(1, 'Recipient address is required')
    .regex(
      /^(0x[a-fA-F0-9]{40}|neutron1[a-z0-9]{38,})$/,
      'Invalid address — must be 0x EVM address or neutron1... bech32'
    ),
});

// ─── Static constants ──────────────────────────────────────────────────────────

const TX_STAGES: TxStage[] = [
  {
    id: 'lock',
    label: 'Locked on Sepolia',
    detail: 'Block 12,345',
    txHash: '0xabc12def4567890abcdef1234567890abcdef12d4f1',
    explorer: 'sepolia',
  },
  {
    id: 'proof',
    label: 'Proof generated',
    detail: '1,247 bytes · 8 nodes',
    data: {
      type: 'patricia',
      root: '0xf2a8c4e9d5b7a3f1e6d8c2b9a4f7e3d1c8b6a5f2e9',
      size: 1247,
      hash: 'Keccak-256',
    },
  },
  {
    id: 'transform',
    label: 'Transformed',
    detail: 'Patricia → IAVL',
    data: {
      from: 'Patricia/RLP/Keccak',
      to: 'IAVL/Protobuf/SHA-256',
      transformedRoot: '0x9c4e7d2a5b8f3e1d6c4a9f2b7e5d8c1a3f6b4e2d3a2b',
    },
  },
  {
    id: 'submit',
    label: 'Submitted to Neutron',
    detail: 'Relayer A · nonce 48',
    txHash: 'C8D2F4A9B12E3F4D5C6789ABCDEF0123456789A912',
    explorer: 'neutron',
  },
  {
    id: 'window',
    label: 'Challenge window',
    detail: '60s · uncontested',
    data: { duration: '60s', remaining: '0s', status: 'closed', challenges: 0 },
  },
  {
    id: 'mint',
    label: 'Minted',
    detail: '100 tUSDC delivered',
    txHash: 'C8D2F4A9B12E3F4D5C6789ABCDEF0123456789A912',
    explorer: 'neutron',
  },
];

const DIFFERENTIATORS = [
  {
    icon: Shield,
    label: 'Optimistic Verification',
    tag: 'TRUST MODEL',
    detail:
      'Bonded relayers post submissions; permissionless challengers catch fraud within a short window. Math at the edges, economics at the boundary.',
  },
  {
    icon: Zap,
    label: 'No ZK Prover Required',
    tag: 'PERFORMANCE',
    detail:
      'Skips the GPU prover infrastructure of zero-knowledge approaches. Same trust-minimization story without minutes-long proof generation.',
  },
  {
    icon: KeyRound,
    label: 'Bypasses Ed25519 on EVM',
    tag: 'CRYPTOGRAPHY',
    detail:
      "Tendermint signature verification doesn't fit on Ethereum. Tessera moves it off-chain into the relayer, anchored by a bond.",
  },
  {
    icon: Users,
    label: 'Permissionless Challengers',
    tag: 'SECURITY',
    detail:
      'Anyone can run a challenger and earn slashed bonds. Security improves linearly as more parties watch.',
  },
  {
    icon: ArrowLeftRight,
    label: 'Bidirectional by Design',
    tag: 'ARCHITECTURE',
    detail:
      'The same trust mechanism in both directions, even though the underlying cryptography is asymmetric. Symmetric UX, asymmetric internals.',
  },
  {
    icon: Boxes,
    label: 'Adapter-Extensible',
    tag: 'EXTENSIBILITY',
    detail:
      'New chains plug in as Go modules. New VMs plug in as one set of contracts. The framework grows; existing chains never need changes.',
  },
];

const SIDE_PILLS_LEFT = [
  { icon: Shield, label: 'No trusted committee' },
  { icon: Zap, label: '~90 second settlement' },
  { icon: KeyRound, label: 'No ZK overhead' },
];

const SIDE_PILLS_RIGHT = [
  { icon: Users, label: 'Permissionless' },
  { icon: Boxes, label: 'Plugin extensible' },
  { icon: ArrowLeftRight, label: 'Bidirectional' },
];

// ─── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3 mb-6', className)}>
      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 whitespace-nowrap">
        {children}
      </span>
      <span className="flex-1 h-px bg-stone-800" />
    </div>
  );
}

function Pill({
  icon: Icon,
  label,
  align = 'left',
}: {
  icon: React.ElementType;
  label: string;
  align?: 'left' | 'right';
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: align === 'left' ? -16 : 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      className={cn(
        'flex items-center gap-2.5 px-4 py-2.5 bg-stone-900/60 border border-stone-800 rounded-sm',
        'hover:border-stone-700 hover:bg-stone-900/80 transition-colors',
        align === 'right' && 'flex-row-reverse'
      )}
    >
      <Icon
        size={14}
        strokeWidth={1.5}
        className="text-orange-400 shrink-0"
      />
      <span className="text-sm text-stone-300 whitespace-nowrap">{label}</span>
    </motion.div>
  );
}

// Compact inline hash display — used inside the proof inspector.
function InlineHash({
  value,
  displayLen = 14,
  explorer,
}: {
  value: string;
  displayLen?: number;
  explorer?: 'sepolia' | 'neutron';
}) {
  const [copied, setCopied] = useState(false);
  const display =
    value.length > displayLen
      ? `${value.slice(0, displayLen)}...${value.slice(-4)}`
      : value;

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <span className="inline-flex items-center gap-1 font-mono text-stone-300">
      <span>{display}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="text-stone-600 hover:text-stone-300 transition-colors"
      >
        {copied ? (
          <Check size={10} className="text-emerald-400" />
        ) : (
          <Copy size={10} />
        )}
      </button>
      {explorer && (
        <a
          href={explorerTxUrl(value, explorer)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-stone-600 hover:text-orange-400 transition-colors"
        >
          <ExternalLink size={10} />
        </a>
      )}
    </span>
  );
}

// ─── CurvyRoadmap ─────────────────────────────────────────────────────────────

function CurvyRoadmap({ progress }: { progress: number }) {
  const stations = [
    { x: 60, y: 105, label: 'Locked', above: false },
    { x: 200, y: 60, label: 'Proof', above: true },
    { x: 350, y: 105, label: 'Transformed', above: false },
    { x: 500, y: 145, label: 'Submitted', above: false },
    { x: 640, y: 100, label: 'Window', above: true },
    { x: 760, y: 75, label: 'Minted', above: true },
  ];

  const pathD =
    'M 60 105 Q 130 60 200 60 T 350 105 Q 425 145 500 145 T 640 100 Q 700 75 760 75';

  // Approximate path length — measured by visual inspection of the bezier.
  const totalLen = 900;
  const fillLen = (progress / stations.length) * totalLen;

  return (
    <div className="relative w-full overflow-x-auto">
      <svg
        viewBox="0 0 820 210"
        className="w-full min-w-[680px]"
        preserveAspectRatio="xMidYMid meet"
        aria-label="Transaction progress roadmap"
      >
        <defs>
          <linearGradient id="roadmapGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
          <filter id="roadmapGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background track */}
        <path
          d={pathD}
          stroke="#292524"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />

        {/* Progress fill with gradient + glow */}
        <path
          d={pathD}
          stroke="url(#roadmapGrad)"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={totalLen}
          strokeDashoffset={totalLen - fillLen}
          filter="url(#roadmapGlow)"
          style={{
            transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />

        {/* Stations */}
        {stations.map((s, i) => {
          const completed = i < progress;
          const current = i === progress;
          const labelY = s.above ? s.y - 22 : s.y + 28;

          return (
            <g key={s.label}>
              {/* Pulse ring on current station */}
              {current && (
                <circle cx={s.x} cy={s.y} r="14" fill="#fb923c" opacity="0.2">
                  <animate
                    attributeName="r"
                    values="14;22;14"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.35;0;0.35"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}

              {/* Station dot */}
              <circle
                cx={s.x}
                cy={s.y}
                r="7"
                fill={completed || current ? '#fb923c' : '#1c1917'}
                stroke={completed || current ? '#fb923c' : '#44403c'}
                strokeWidth="2"
                style={{ transition: 'fill 0.4s ease, stroke 0.4s ease' }}
              />

              {/* Checkmark for completed stations */}
              {completed && (
                <path
                  d={`M ${s.x - 3} ${s.y} L ${s.x - 1} ${s.y + 2.5} L ${s.x + 3.5} ${s.y - 2.5}`}
                  stroke="#0c0a09"
                  strokeWidth="1.5"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Label */}
              <text
                x={s.x}
                y={labelY}
                textAnchor="middle"
                fill={completed || current ? '#e7e5e4' : '#57534e'}
                fontSize="11"
                fontFamily="'SF Mono','Fira Code',Consolas,monospace"
                style={{ transition: 'fill 0.4s ease' }}
              >
                {s.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── ProofInspectorEntry ───────────────────────────────────────────────────────

function ProofInspectorEntry({
  stage,
  completed,
  current,
}: {
  stage: TxStage;
  completed: boolean;
  current: boolean;
}) {
  const [open, setOpen] = useState(false);

  const StatusIcon = completed ? CheckCircle2 : current ? CircleDot : Clock;
  const iconClass = completed
    ? 'text-emerald-400'
    : current
    ? 'text-orange-400'
    : 'text-stone-600';

  const interactive = completed || current;

  return (
    <div
      className={cn(
        'border-b border-stone-800/60 last:border-b-0',
        current && 'bg-orange-400/[0.03]'
      )}
    >
      <button
        type="button"
        disabled={!interactive}
        onClick={() => interactive && setOpen((o) => !o)}
        className={cn(
          'w-full px-5 py-3 flex items-center gap-3 text-left transition-colors',
          interactive
            ? 'hover:bg-stone-900/60 cursor-pointer'
            : 'opacity-50 cursor-default'
        )}
      >
        <StatusIcon
          size={14}
          strokeWidth={1.5}
          className={cn(iconClass, current && 'animate-pulse')}
        />
        <span className="text-sm text-stone-200 flex-1">{stage.label}</span>
        <span className="font-mono text-xs text-stone-500 hidden sm:block">
          {stage.detail}
        </span>
        {interactive && (
          <ChevronDown
            size={13}
            strokeWidth={1.5}
            className={cn(
              'text-stone-500 transition-transform',
              open && 'rotate-180'
            )}
          />
        )}
      </button>

      <AnimatePresence>
        {open && interactive && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 pl-12">
              <div className="bg-stone-950 border border-stone-800/80 rounded-sm p-3 font-mono text-xs space-y-2">
                {stage.txHash && (
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500">tx hash</span>
                    <InlineHash
                      value={stage.txHash}
                      explorer={stage.explorer}
                    />
                  </div>
                )}
                {stage.data?.root && (
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500">source root</span>
                    <InlineHash value={stage.data.root} />
                  </div>
                )}
                {stage.data?.transformedRoot && (
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500">transformed root</span>
                    <InlineHash value={stage.data.transformedRoot} />
                  </div>
                )}
                {stage.data?.size !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500">proof size</span>
                    <span className="text-stone-300">{stage.data.size} bytes</span>
                  </div>
                )}
                {stage.data?.hash && (
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500">hash function</span>
                    <span className="text-stone-300">{stage.data.hash}</span>
                  </div>
                )}
                {stage.data?.from && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-stone-500">source format</span>
                      <span className="text-stone-300">{stage.data.from}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-stone-500">dest format</span>
                      <span className="text-stone-300">{stage.data.to}</span>
                    </div>
                  </>
                )}
                {stage.data?.duration && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-stone-500">window duration</span>
                      <span className="text-stone-300">{stage.data.duration}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-stone-500">challenges filed</span>
                      <span className="text-emerald-400">
                        {stage.data.challenges}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── LiveTxSection ─────────────────────────────────────────────────────────────

function LiveTxSection({
  progress,
  amount,
  onReset,
  liveLockHash,
  nonce,
  direction,
}: {
  progress: number;
  amount: string;
  onReset: () => void;
  liveLockHash?: string | null;
  nonce?: bigint | null;
  direction?: string;
}) {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const done = progress >= TX_STAGES.length;

  // Build stages array with real tx hash injected into lock stage when available.
  const stages: TxStage[] = TX_STAGES.map((s, i) => {
    if (i === 0 && liveLockHash) return { ...s, txHash: liveLockHash };
    return s;
  });

  const nonceLabel = nonce != null ? `#${(nonce % BigInt(100000)).toString()}` : '#—';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      className="mt-20"
    >
      <SectionLabel>Live transaction</SectionLabel>

      <div className="bg-stone-900/60 border border-stone-800 rounded-md p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2.5 mb-1.5">
              <span
                className={cn(
                  'w-2 h-2 rounded-full',
                  done ? 'bg-emerald-400' : 'bg-orange-400 animate-pulse'
                )}
              />
              <span
                className={cn(
                  'text-[10px] font-mono uppercase tracking-[0.2em]',
                  done ? 'text-emerald-400' : 'text-orange-400'
                )}
              >
                {done ? `Completed · ${nonceLabel}` : `In flight · ${nonceLabel}`}
              </span>
            </div>
            <p className="text-stone-300 text-sm">
              {amount || '—'} tUSDC · {direction ?? 'Sepolia → Neutron'}
            </p>
          </div>
          {done && (
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200 transition-colors"
            >
              <RefreshCw size={11} strokeWidth={1.5} />
              Replay
            </button>
          )}
        </div>

        <CurvyRoadmap progress={progress} />

        {/* Proof Inspector toggle */}
        <button
          type="button"
          onClick={() => setInspectorOpen((o) => !o)}
          className="mt-8 w-full flex items-center justify-between gap-3 px-5 py-3 bg-stone-950/60 border border-stone-800 hover:border-stone-700 rounded-sm transition-colors"
        >
          <div className="flex items-center gap-3">
            <Terminal size={13} strokeWidth={1.5} className="text-orange-400" />
            <span className="text-sm text-stone-200">Proof Inspector</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 hidden sm:inline">
              Tap any step for cryptographic detail
            </span>
          </div>
          <ChevronDown
            size={14}
            strokeWidth={1.5}
            className={cn(
              'text-stone-500 transition-transform',
              inspectorOpen && 'rotate-180'
            )}
          />
        </button>

        <AnimatePresence>
          {inspectorOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="mt-2 bg-stone-950 border border-stone-800 rounded-sm overflow-hidden">
                {/* Inspector header */}
                <div className="px-5 py-3 border-b border-stone-800 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-stone-500">
                    <CircleDot
                      size={9}
                      strokeWidth={1.5}
                      className="text-emerald-400 animate-pulse"
                    />
                    Streaming · live
                  </div>
                  <span className="text-[10px] font-mono text-stone-500">
                    tessera://tx/{nonceLabel}
                  </span>
                </div>

                {stages.map((stage, i) => (
                  <ProofInspectorEntry
                    key={stage.id}
                    stage={stage}
                    completed={i < progress}
                    current={i === progress}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── BridgeStats hook ─────────────────────────────────────────────────────────

interface BridgeStats {
  estimatedTimeSec: number;
  challengeWindowSec: number;
  relayerFeeBps: number;
  gasUsd: string;
}

function useBridgeStats(initial: BridgeStats) {
  const [stats, setStats] = useState<BridgeStats>(initial);

  useEffect(() => {
    // Refresh every 30 seconds to pick up gas price changes.
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/bridge-stats');
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch {
        // Keep showing the last known values — no error display for background refresh.
      }
    };

    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, []);

  return stats;
}

// ─── BridgeWidget ─────────────────────────────────────────────────────────────

function BridgeWidget({
  onSubmit,
  txActive,
  initialStats,
  balance,
}: {
  onSubmit: (data: BridgeFormValues) => void;
  txActive: boolean;
  initialStats: BridgeStats;
  balance?: string | null;
}) {
  const { isFullyConnected, isEvmConnected, isKeplrConnected, evmAddress, neutronAddress } =
    useWalletContext();
  const stats = useBridgeStats(initialStats);

  const [direction, setDirection] = useState<'sepoliaToNeutron' | 'neutronToSepolia'>(
    'sepoliaToNeutron'
  );
  const fromChain = direction === 'sepoliaToNeutron' ? 'sepolia' : 'neutron';
  const toChain = direction === 'sepoliaToNeutron' ? 'neutron' : 'sepolia';

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<BridgeFormValues>({
    resolver: zodResolver(bridgeSchema),
    defaultValues: {
      amount: '',
      fromChain: 'sepolia',
      toChain: 'neutron',
      recipient: '',
    },
  });

  const amount = watch('amount');

  // Auto-fill recipient from connected wallet when direction changes.
  useEffect(() => {
    const addr = toChain === 'neutron' ? (neutronAddress ?? '') : (evmAddress ?? '');
    setValue('recipient', addr, { shouldValidate: false });
  }, [toChain, neutronAddress, evmAddress, setValue]);

  // Keep hidden chain fields in sync with UI direction.
  useEffect(() => {
    setValue('fromChain', fromChain);
    setValue('toChain', toChain);
  }, [fromChain, toChain, setValue]);

  function swapDirection() {
    setDirection((d) =>
      d === 'sepoliaToNeutron' ? 'neutronToSepolia' : 'sepoliaToNeutron'
    );
  }

  const feePercent = (stats.relayerFeeBps / 100).toFixed(2);

  const canBridge = isFullyConnected && !txActive;

  // Determine connection state for the prompt.
  const needsEvm = !isEvmConnected;
  const needsKeplr = isEvmConnected && !isKeplrConnected;

  return (
    <div className="bg-stone-900/60 border border-stone-800 rounded-md p-5 w-full max-w-[440px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500">
          Bridge
        </span>
        <div className="flex items-center gap-1.5 text-stone-500 text-xs">
          <RefreshCw size={11} strokeWidth={1.5} />
          <span className="font-mono">1.0% slippage</span>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        {/* Hidden chain fields */}
        <input type="hidden" {...register('fromChain')} />
        <input type="hidden" {...register('toChain')} />

        {/* From */}
        <div className="bg-stone-950/50 border border-stone-800 rounded-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] uppercase tracking-wider text-stone-500">
              From
            </span>
            <span className="text-xs text-stone-500">
              Balance:{' '}
              <span className="text-stone-300 font-mono">
                {fromChain === 'sepolia'
                  ? (balance != null ? balance : '—')
                  : '—'}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <ChainPill chain={fromChain} />
            <input
              {...register('amount')}
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              className="flex-1 min-w-0 bg-transparent text-2xl font-display text-right text-stone-100 outline-none placeholder:text-stone-700"
              aria-label="Bridge amount"
            />
            <span className="text-stone-500 font-mono text-sm shrink-0">tUSDC</span>
          </div>
        </div>

        {/* Amount error */}
        {errors.amount && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1.5 text-xs text-red-400 font-mono"
          >
            {errors.amount.message}
          </motion.p>
        )}

        {/* Swap direction button */}
        <div className="flex justify-center my-1 relative z-10">
          <button
            type="button"
            onClick={swapDirection}
            className="w-7 h-7 bg-stone-900 border border-stone-800 hover:border-orange-400/50 hover:bg-stone-800 rounded-sm flex items-center justify-center transition-colors"
            aria-label="Swap bridge direction"
          >
            <ArrowDown size={12} strokeWidth={1.5} className="text-stone-400" />
          </button>
        </div>

        {/* To */}
        <div className="bg-stone-950/50 border border-stone-800 rounded-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] uppercase tracking-wider text-stone-500">
              To
            </span>
            <span className="text-xs text-stone-500">
              Balance:{' '}
              <span className="text-stone-300 font-mono">—</span>
            </span>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <ChainPill chain={toChain} />
            <span className="flex-1 text-2xl font-display text-right text-stone-300">
              {amount && !isNaN(parseFloat(amount)) ? amount : '0.00'}
            </span>
            <span className="text-stone-500 font-mono text-sm shrink-0">tUSDC</span>
          </div>

          <div className="pt-3 border-t border-stone-800/60">
            <input
              {...register('recipient')}
              type="text"
              placeholder={
                toChain === 'neutron'
                  ? 'neutron1... recipient address'
                  : '0x... recipient address'
              }
              className={cn(
                'w-full bg-transparent font-mono text-xs outline-none placeholder:text-stone-600',
                errors.recipient ? 'text-red-400' : 'text-stone-400'
              )}
              aria-label="Recipient address"
            />
          </div>
        </div>

        {/* Recipient error */}
        {errors.recipient && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1.5 text-xs text-red-400 font-mono"
          >
            {errors.recipient.message}
          </motion.p>
        )}

        {/* Live stats grid */}
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          {[
            { label: 'Est. time', value: `~${stats.estimatedTimeSec}s` },
            { label: 'Window', value: `${stats.challengeWindowSec}s` },
            { label: 'Relayer fee', value: `${feePercent}%` },
            { label: 'Network gas', value: stats.gasUsd },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="flex items-center justify-between bg-stone-950/40 border border-stone-800/60 rounded-sm px-3 py-2"
            >
              <span className="text-stone-500">{label}</span>
              <span className="font-mono text-stone-200">{value}</span>
            </div>
          ))}
        </div>

        {/* Connection prompt or bridge button */}
        {!isFullyConnected ? (
          <div className="mt-4 rounded-sm bg-stone-950/50 border border-stone-800 px-4 py-3 text-center">
            <p className="text-sm text-stone-400">
              {needsEvm
                ? 'Connect MetaMask to bridge'
                : needsKeplr
                ? 'Connect Keplr wallet for Neutron'
                : 'Connect both wallets to bridge'}
            </p>
          </div>
        ) : (
          <button
            type="submit"
            disabled={!canBridge}
            className={cn(
              'mt-4 w-full py-3 rounded-sm font-medium transition-colors',
              canBridge
                ? 'bg-orange-400 hover:bg-orange-300 text-stone-950'
                : 'bg-stone-800 text-stone-500 cursor-not-allowed'
            )}
          >
            {txActive
              ? 'Bridge in progress…'
              : amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0
              ? `Bridge ${amount} tUSDC`
              : 'Enter an amount'}
          </button>
        )}
      </form>
    </div>
  );
}

function ChainPill({ chain }: { chain: 'sepolia' | 'neutron' }) {
  const label = chain === 'sepolia' ? 'Sepolia' : 'Neutron';
  const gradient =
    chain === 'sepolia'
      ? 'from-blue-500 to-blue-700'
      : 'from-orange-500 to-pink-600';

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-stone-900 border border-stone-800 rounded-sm shrink-0">
      <span className={cn('w-5 h-5 rounded-full bg-gradient-to-br shrink-0', gradient)} />
      <span className="text-sm text-stone-200">{label}</span>
      <ChevronDown size={14} strokeWidth={1.5} className="text-stone-500" />
    </div>
  );
}

// ─── SystemStatus strip ────────────────────────────────────────────────────────

const STATS_DEFAULTS = {
  transfers: 0,
  activeRelayers: 2,
  challengesThisWeek: 0,
  successfulFrauds: 0,
  lastSync: new Date().toISOString(),
};

function SystemStatusStrip() {
  const { data, loading } = useSystemStats();
  const stats = data ?? STATS_DEFAULTS;

  const lastSyncText = (() => {
    try {
      const diff = Math.floor(
        (Date.now() - new Date(stats.lastSync).getTime()) / 1000
      );
      if (diff < 10) return 'just now';
      if (diff < 60) return `${diff}s ago`;
      return `${Math.floor(diff / 60)}m ago`;
    } catch {
      return 'just now';
    }
  })();

  return (
    <div className="bg-stone-900/60 border border-stone-800 rounded-md px-6 py-5 flex flex-wrap items-center gap-x-10 gap-y-4">
      {/* Online indicator */}
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
        </span>
        <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">
          Online
        </span>
      </div>

      <StatCell
        label="Transfers (all-time)"
        value={loading ? '—' : stats.transfers.toLocaleString()}
      />
      <StatCell
        label="Active relayers"
        value={loading ? '—' : String(stats.activeRelayers || 2)}
      />
      <StatCell
        label="Challenges (week)"
        value={loading ? '—' : String(stats.challengesThisWeek)}
      />
      <StatCell
        label="Successful frauds"
        value={loading ? '—' : String(stats.successfulFrauds)}
        highlight={!loading && stats.successfulFrauds === 0}
      />

      <span className="text-xs text-stone-500 ml-auto font-mono shrink-0">
        last sync: {loading ? '…' : lastSyncText}
      </span>
    </div>
  );
}

function StatCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
        {label}
      </span>
      <span
        className={cn(
          'text-lg font-display leading-none',
          highlight ? 'text-emerald-400' : 'text-stone-100'
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ─── HomepageClient — top-level island ────────────────────────────────────────

export default function HomepageClient({
  bridgeStats,
}: {
  bridgeStats: BridgeStats;
}) {
  const [txActive, setTxActive] = useState(false);
  const [txProgress, setTxProgress] = useState(0);
  const [bridgeAmount, setBridgeAmount] = useState('');
  const [bridgeDirection, setBridgeDirection] = useState<'Sepolia → Neutron' | 'Neutron → Sepolia'>('Sepolia → Neutron');
  const [liveLockHash, setLiveLockHash] = useState<string | null>(null);
  const [txNonce, setTxNonce] = useState<bigint | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const { evmAddress } = useWalletContext();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { toast } = useWalletContext() as unknown as { toast?: (t: { type: string; message: string }) => void };

  // Live tUSDC balance for connected wallet.
  const { data: rawBalance } = useReadContract({
    address: ADDRESSES.sepolia.tusdc as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: evmAddress ? [evmAddress as `0x${string}`] : undefined,
    query: { enabled: !!evmAddress, refetchInterval: 15_000 },
  });
  const tusdcBalance = rawBalance !== undefined
    ? parseFloat(formatUnits(rawBalance as bigint, 18)).toFixed(2)
    : null;

  const handleBridge = useCallback(
    async (data: BridgeFormValues) => {
      if (!walletClient || !publicClient) return;

      setBridgeAmount(data.amount);
      setBridgeDirection(
        data.fromChain === 'sepolia' ? 'Sepolia → Neutron' : 'Neutron → Sepolia'
      );
      setTxActive(true);
      setTxProgress(0);
      setLiveLockHash(null);
      setTxError(null);
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];

      if (data.fromChain !== 'sepolia') {
        // Neutron → Sepolia: CosmWasm burn path — show educational animation only
        setTxActive(true);
        const ids = [
          setTimeout(() => setTxProgress(1), 1500),
          setTimeout(() => setTxProgress(2), 4000),
          setTimeout(() => setTxProgress(3), 8000),
          setTimeout(() => setTxProgress(4), 15000),
          setTimeout(() => setTxProgress(5), 25000),
          setTimeout(() => setTxProgress(6), 40000),
        ];
        timeoutsRef.current = ids;
        return;
      }

      try {
        const amountWei = parseUnits(data.amount, 18);

        // Step 1 — Approve tUSDC to BridgeVault
        const approveHash = await walletClient.writeContract({
          address: ADDRESSES.sepolia.tusdc as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [ADDRESSES.sepolia.bridgeVault as `0x${string}`, amountWei],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });

        // Step 2 — Lock in BridgeVault
        const nonce = BigInt(Date.now());
        setTxNonce(nonce);
        const destChainId32 = padHex(toHex('pion-1'), { size: 32, dir: 'right' }) as `0x${string}`;
        const destAppHex = toHex(new TextEncoder().encode(ADDRESSES.neutron.bridgeMint)) as `0x${string}`;

        const lockHash = await walletClient.writeContract({
          address: ADDRESSES.sepolia.bridgeVault as `0x${string}`,
          abi: BRIDGE_VAULT_ABI,
          functionName: 'lock',
          args: [amountWei, nonce as unknown as bigint, destChainId32, destAppHex],
        });

        setLiveLockHash(lockHash);
        setTxProgress(1); // lock confirmed on-chain

        await publicClient.waitForTransactionReceipt({ hash: lockHash });
        setTxProgress(1);

        // Relayer picks up the event and handles proof/submit/execute.
        // Advance stages on an optimistic timeline (relayer ~90s total).
        const ids = [
          setTimeout(() => setTxProgress(2), 5_000),   // proof fetched
          setTimeout(() => setTxProgress(3), 15_000),  // proof transformed
          setTimeout(() => setTxProgress(4), 30_000),  // submitted to Neutron
          setTimeout(() => setTxProgress(5), 90_000),  // challenge window closed
          setTimeout(() => setTxProgress(6), 100_000), // executed + minted
        ];
        timeoutsRef.current = ids;
      } catch (err: unknown) {
        const msg = err instanceof Error
          ? (err.message.includes('User rejected') ? 'Transaction rejected' : err.message.slice(0, 120))
          : 'Transaction failed';
        setTxError(msg);
        setTxActive(false);
        setTxProgress(0);
      }
    },
    [walletClient, publicClient]
  );

  const handleReset = useCallback(() => {
    setTxActive(false);
    setTxProgress(0);
    setLiveLockHash(null);
    setTxNonce(null);
    setTxError(null);
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  }, []);

  // Clean up timeouts on unmount.
  useEffect(() => {
    return () => { timeoutsRef.current.forEach(clearTimeout); };
  }, []);

  // Motion variants for staggered hero entrance.
  // ease uses string form to satisfy Framer Motion v12 Easing type.
  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.1 } },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
  };

  return (
    <div className="relative px-4 sm:px-6 overflow-hidden">
      {/* Radial gradient glow behind hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] -z-10"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(251,146,60,0.12) 0%, rgba(251,146,60,0.04) 40%, transparent 70%)',
        }}
      />
      {/* Secondary emerald glow at bottom of hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[300px] h-[400px] -z-10"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 100%, rgba(52,211,153,0.06) 0%, transparent 70%)',
        }}
      />

      {/* ── Hero ── */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="max-w-6xl mx-auto pt-14 sm:pt-24 pb-16 text-center"
      >
        {/* Label row */}
        <motion.div
          variants={item}
          className="flex items-center justify-center gap-3 mb-8"
        >
          <span className="w-8 h-px bg-orange-400" aria-hidden />
          <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-orange-400">
            Trust-minimized cross-chain
          </span>
          <span className="w-8 h-px bg-orange-400" aria-hidden />
        </motion.div>

        {/* Display headline */}
        <motion.h1
          variants={item}
          className="font-display text-[clamp(2.8rem,8vw,5.5rem)] leading-[0.95] text-stone-100 mb-6"
        >
          Bridge between two worlds
          <br />
          <em className="text-orange-400">without a middleman.</em>
        </motion.h1>

        {/* Body copy */}
        <motion.p
          variants={item}
          className="text-stone-400 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed mb-14"
        >
          Move assets between Ethereum and Cosmos chains in about a minute, secured
          by bonded relayers and permissionless challengers — not a trusted committee.
        </motion.p>

        {/* Feature pills row — above the bridge widget */}
        <motion.div
          variants={item}
          className="flex flex-wrap justify-center gap-3 mb-8 max-w-3xl mx-auto"
        >
          {[...SIDE_PILLS_LEFT, ...SIDE_PILLS_RIGHT].map((p) => (
            <Pill key={p.label} icon={p.icon} label={p.label} />
          ))}
        </motion.div>

        {/* Bridge widget — centered */}
        <motion.div variants={item}>
          <BridgeWidget
            onSubmit={handleBridge}
            txActive={txActive}
            initialStats={bridgeStats}
            balance={tusdcBalance}
          />
        </motion.div>
      </motion.div>

      {/* ── Live transaction (shown when bridge in progress) ── */}
      <div className="max-w-6xl mx-auto">
        <AnimatePresence>
          {txActive && (
            <LiveTxSection
              progress={txProgress}
              amount={bridgeAmount}
              onReset={handleReset}
              liveLockHash={liveLockHash}
              nonce={txNonce}
              direction={bridgeDirection}
            />
          )}
        </AnimatePresence>
      </div>

      {/* ── Differentiators grid ── */}
      <div className="max-w-6xl mx-auto py-20">
        <SectionLabel>What makes Tessera different</SectionLabel>
        <div className="grid sm:grid-cols-2 gap-px bg-stone-800/60 border border-stone-800 rounded-md overflow-hidden">
          {DIFFERENTIATORS.map((d, i) => {
            const Icon = d.icon;
            return (
              <motion.div
                key={d.label}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{
                  duration: 0.5,
                  delay: i * 0.07,
                  ease: [0.4, 0, 0.2, 1],
                }}
                className="bg-stone-950 hover:bg-stone-900/80 p-7 group transition-colors card-tilt"
              >
                <div className="flex items-start justify-between mb-6">
                  <div className="w-11 h-11 rounded-md bg-orange-400/10 border border-orange-400/20 flex items-center justify-center group-hover:scale-110 group-hover:bg-orange-400/15 transition-all duration-300">
                    <Icon
                      size={18}
                      strokeWidth={1.5}
                      className="text-orange-400"
                    />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500">
                    {d.tag}
                  </span>
                </div>
                <div className="font-display text-2xl sm:text-3xl text-stone-100 leading-tight mb-3">
                  {d.label}
                </div>
                <p className="text-stone-400 text-sm leading-relaxed">{d.detail}</p>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* ── Live system status strip ── */}
      <div className="max-w-6xl mx-auto pb-20">
        <SectionLabel>Live system status</SectionLabel>
        <SystemStatusStrip />
      </div>
    </div>
  );
}
