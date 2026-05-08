'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Eraser,
  ExternalLink,
  Gavel,
  Play,
  Power,
  Terminal,
} from 'lucide-react';
import Card from '@/components/Card';
import CopyableHash from '@/components/CopyableHash';
import SectionLabel from '@/components/SectionLabel';
import StatusBadge from '@/components/StatusBadge';
import { useEventsRealtime, useRelayerStats } from '@/hooks/useRelayers';
import { useToast } from '@/hooks/useToast';
import { RELAYER_ADDRESSES } from '@/lib/config';
import type { EventLogEntry, RelayerInfo, ScenarioType } from '@/types';

// Correct on-chain bond amounts (0.02 ETH / 80 000 uNTRN = 0.08 NTRN per relayer)
const STATIC_RELAYERS: RelayerInfo[] = [
  {
    id: 'A',
    name: 'Relayer A',
    sepoliaAddress: RELAYER_ADDRESSES.A.sepolia,
    neutronAddress: RELAYER_ADDRESSES.A.neutron,
    activity: 'Watching',
    activityType: 'idle',
    bond: { sepolia: { gas: 0, bond: 0.02 }, neutron: { gas: 0, bond: 0.08 } },
    earned: 0,
    slashed: 0,
    submissions: 0,
    successRate: 100,
  },
  {
    id: 'B',
    name: 'Relayer B',
    sepoliaAddress: RELAYER_ADDRESSES.B.sepolia,
    neutronAddress: RELAYER_ADDRESSES.B.neutron,
    activity: 'Watching',
    activityType: 'idle',
    bond: { sepolia: { gas: 0, bond: 0.02 }, neutron: { gas: 0, bond: 0.08 } },
    earned: 0,
    slashed: 0,
    submissions: 0,
    successRate: 100,
  },
];

const SCENARIOS: ScenarioType[] = [
  {
    id: 'honest',
    name: 'Honest delivery',
    desc: 'Normal flow, no fraud, relayer earns fee',
    color: 'emerald',
  },
  {
    id: 'lying',
    name: 'Lying relayer',
    desc: 'Submitter sends bad fingerprint, challenger catches it, 50% slash',
    color: 'red',
  },
  {
    id: 'silent',
    name: 'Silent relayer',
    desc: 'Submitter goes offline, handover triggers, 50% absence slash',
    color: 'amber',
  },
  {
    id: 'spam',
    name: 'Frivolous challenge',
    desc: 'Challenger files baseless dispute, 25% deposit forfeited',
    color: 'orange',
  },
];

// ---------- helpers ----------

const SCENARIO_ICON_MAP: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  honest: CheckCircle2,
  lying: AlertTriangle,
  silent: Power,
  spam: Gavel,
};

// Normalise DB event_type to a display tag key
const EVENT_TYPE_TO_TAG: Record<string, string> = {
  Locked:           'lock',
  Burned:           'lock',
  ProofFetched:     'verify',
  ProofTransformed: 'transform',
  Submitted:        'submit',
  Challenged:       'challenge',
  ChallengeRejected:'reward',
  Slashed:          'slash',
  Executed:         'execute',
  AbsenceSlash:     'slash',
  WindowOpen:       'window',
  WindowClose:      'window',
};

const TAG_COLORS: Record<string, string> = {
  lock:      'bg-blue-500/10 text-blue-300',
  submit:    'bg-blue-500/10 text-blue-300',
  verify:    'bg-emerald-500/10 text-emerald-300',
  transform: 'bg-purple-500/10 text-purple-300',
  window:    'bg-stone-500/10 text-stone-400',
  finalize:  'bg-emerald-500/10 text-emerald-300',
  execute:   'bg-orange-500/10 text-orange-300',
  reward:    'bg-emerald-500/10 text-emerald-300',
  slash:     'bg-red-500/10 text-red-300',
  challenge: 'bg-amber-500/10 text-amber-300',
};

const SCENARIO_RING: Record<string, string> = {
  emerald: 'hover:border-emerald-500/50 hover:bg-emerald-500/5',
  red:     'hover:border-red-500/50 hover:bg-red-500/5',
  amber:   'hover:border-amber-500/50 hover:bg-amber-500/5',
  orange:  'hover:border-orange-500/50 hover:bg-orange-500/5',
};

const SCENARIO_ICON_COLOR: Record<string, string> = {
  emerald: 'text-emerald-400',
  red:     'text-red-400',
  amber:   'text-amber-400',
  orange:  'text-orange-400',
};

/** Build a human-readable message from the structured raw_data field. */
function buildEventMsg(eventType: string, raw: Record<string, unknown>): string {
  const r = raw as Record<string, string | number | undefined>;

  const trunc = (v: unknown, n = 8) =>
    typeof v === 'string' ? v.slice(0, n + 2) + '…' : '?';

  /**
   * Render an amount field that may be either:
   *   - a small human number (e.g. '10') from the scenario API
   *   - a raw 18-decimal wei string from the bridge widget (Sepolia source)
   *   - a raw 6-decimal uTUSDC string from the bridge widget (Neutron source)
   * Heuristic: anything ≥ 1e6 is raw; choose decimals by direction hint.
   */
  const fmtAmount = (a: unknown, dir: unknown): string => {
    if (a == null) return '?';
    const s = typeof a === 'string' ? a : String(a);
    const n = Number(s);
    if (!Number.isFinite(n)) return s;
    if (n < 1_000_000) return s; // already human-readable
    const decimals = typeof dir === 'string' && dir.includes('Neutron →') ? 1e6 : 1e18;
    return (n / decimals).toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  switch (eventType) {
    case 'Locked':
      return `${fmtAmount(r.amount, r.direction)} tUSDC locked by ${r.relayer ?? 'relayer'} · nonce #${r.nonce ?? '?'}`;
    case 'Burned':
      return `${fmtAmount(r.amount, r.direction)} tUSDC burned on Neutron · nonce #${r.nonce ?? '?'}`;
    case 'ProofFetched':
      return `Merkle proof fetched · depth ${r.proof_depth ?? '?'} · ${r.nodes ?? '?'} nodes · root ${trunc(r.source_root)}`;
    case 'ProofTransformed':
      return `${r.transform ?? 'Patricia → IAVL'} · ${trunc(r.source_root)} → ${trunc(r.transformed_root)}`;
    case 'Submitted': {
      const fpType = r.fingerprint_type === 'WRONG' ? ' ⚠ WRONG FINGERPRINT' : '';
      return `Proof submitted to ${r.destination ?? 'chain'} by ${r.relayer ?? 'relayer'}${fpType} · fp ${trunc(r.fingerprint)}`;
    }
    case 'Challenged':
      return r.result === 'baseless'
        ? `Baseless challenge filed by ${r.relayer ?? 'relayer'}`
        : `Challenge filed by ${r.relayer ?? 'relayer'} · wrong ${trunc(r.wrong_root)} vs correct ${trunc(r.correct_root)}`;
    case 'ChallengeRejected':
      return `Baseless challenge rejected · ${r.relayer ?? 'challenger'} slashed ${r.slash_pct ?? '?'}% → ${r.amount_slashed ?? '?'} ETH to ${r.paid_to ?? 'submitter'}`;
    case 'Slashed': {
      const reason = r.reason ? ` (${r.reason})` : '';
      return `${r.relayer ?? 'Relayer'} slashed ${r.slash_pct ?? '?'}%${reason} · ${r.amount_slashed ?? '?'} ETH → ${r.paid_to ?? 'challenger'}`;
    }
    case 'Executed': {
      const recipient = (r.minted_to ?? r.delivered_to) as unknown;
      const amt = fmtAmount(r.amount, r.direction);
      return `${amt} tUSDC delivered to ${typeof recipient === 'string' ? recipient.slice(0, 16) + '…' : '?'}`;
    }
    case 'WindowOpen':
      return r.handover_sec
        ? `Assigned relayer not responding · handover in ${r.handover_sec}s`
        : `Challenge window open · ${r.window_sec ?? 60}s for disputes`;
    case 'WindowClose':
      return 'Challenge window closed · message finalized';
    default:
      return `${eventType} · block ${r.block ?? '?'}`;
  }
}

// ---------- sub-components ----------

function BondCell({ chain, gas, bond, unit }: { chain: string; gas: number; bond: number; unit: string }) {
  const total = gas + bond;
  const isLow = unit === 'ETH' ? bond < 0.01 : bond < 0.04;
  const maxForBar = unit === 'ETH' ? 0.02 : 0.08;

  return (
    <div className="bg-stone-950 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">{chain}</span>
        <span className="font-mono text-xs text-stone-300">{total.toFixed(2)} {unit}</span>
      </div>
      <div className="h-1 bg-stone-800 rounded-full overflow-hidden mb-1.5">
        <div
          className={`h-full transition-all duration-500 ${isLow ? 'bg-amber-400' : 'bg-emerald-400'}`}
          style={{ width: `${Math.min(100, (bond / maxForBar) * 100)}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] font-mono text-stone-500">
        <span>gas {gas.toFixed(2)}</span>
        <span>bond {bond.toFixed(2)}</span>
      </div>
    </div>
  );
}

function RelayerCard({ relayer }: { relayer: RelayerInfo }) {
  return (
    <div className="bg-stone-950 p-7 card-tilt">
      <div className="flex items-start justify-between mb-5 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-stone-900 border border-stone-700 flex items-center justify-center font-display text-xl text-stone-200 shrink-0">
            {relayer.id}
          </div>
          <div className="min-w-0">
            <div className="text-stone-100 text-sm">{relayer.name}</div>
            <CopyableHash value={relayer.sepoliaAddress} displayLength={10} className="text-[11px]" />
          </div>
        </div>
        <StatusBadge activityType={relayer.activityType} activity={relayer.activity} />
      </div>

      <div className="grid grid-cols-2 gap-px bg-stone-800/60 mb-5">
        <BondCell chain="Sepolia" gas={relayer.bond.sepolia.gas} bond={relayer.bond.sepolia.bond} unit="ETH" />
        <BondCell chain="Neutron" gas={relayer.bond.neutron.gas} bond={relayer.bond.neutron.bond} unit="NTRN" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500">Earned</div>
          <div className="font-mono text-emerald-400 mt-0.5">+{relayer.earned.toFixed(4)} ETH</div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500">Slashed</div>
          <div className="font-mono text-stone-300 mt-0.5">
            {typeof relayer.slashed === 'number' ? relayer.slashed.toFixed(4) : relayer.slashed} ETH
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500">Submitted</div>
          <div className="font-mono text-stone-300 mt-0.5">{relayer.submissions}</div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500">Success</div>
          <div className="font-mono text-emerald-400 mt-0.5">{relayer.successRate}%</div>
        </div>
      </div>
    </div>
  );
}

// ---------- event log entry ----------

function EventRow({ entry, index }: { entry: EventLogEntry; index: number }) {
  const tag = entry.tag;
  const colorClass = TAG_COLORS[tag] ?? 'bg-amber-500/10 text-amber-300';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.5) }}
      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-0.5"
    >
      <span className="text-stone-600 shrink-0 font-mono text-[10px]">[{entry.t}]</span>
      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-mono ${colorClass}`}>
        {tag}
      </span>
      {entry.txHash ? (
        <CopyableHash
          value={entry.txHash}
          displayLength={8}
          explorer={entry.chain ?? 'sepolia'}
          className="text-stone-400 font-mono text-[11px] shrink-0"
        />
      ) : (
        <span className="text-stone-600 font-mono text-[10px] shrink-0">{entry.actor}</span>
      )}
      <span className="text-stone-300 text-[11px] leading-relaxed">{entry.msg}</span>
    </motion.div>
  );
}

// ---------- page ----------

// A run separator entry, surfaced as a horizontal rule between log groups so
// the user can tell where one scenario run ends and another begins. Keyed by
// `id` so the React reconciler doesn't reuse markers across runs.
interface RunMarker {
  id: number;
  tMs: number;
  label: string;
}

// Internal renderable row — either an event from the realtime feed, or a
// run separator we injected client-side. Sorted descending by `tMs` so the
// newest item is always at the top of the log (matches the realtime order).
type LogItem =
  | { kind: 'event'; tMs: number; entry: EventLogEntry }
  | { kind: 'run'; tMs: number; label: string; id: number };

export default function DemoPage() {
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  // Events with `indexed_at < clearedAtMs` are filtered out of the visible log.
  // The realtime hook still receives them, so a clear is a UI-only mute (no
  // request to the server, no data loss).
  const [clearedAtMs, setClearedAtMs] = useState<number>(0);
  const [runMarkers, setRunMarkers] = useState<RunMarker[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const { toast } = useToast();
  const relayerStats = useRelayerStats();
  const eventsData = useEventsRealtime(100);

  const relayers: RelayerInfo[] =
    relayerStats.data && relayerStats.data.length > 0 ? relayerStats.data : STATIC_RELAYERS;

  // Map every realtime row to a renderable LogItem with its raw timestamp,
  // then merge with run-separator markers and sort descending by time so the
  // most recent entry sits at the top of the container.
  const items: LogItem[] = useMemo(() => {
    const eventItems: LogItem[] = (eventsData.data ?? []).map((e) => {
      const rawData = (e.raw_data ?? {}) as Record<string, unknown>;
      const tag = EVENT_TYPE_TO_TAG[e.event_type] ?? e.event_type.toLowerCase();
      const chain: 'sepolia' | 'neutron' = e.chain_id === '11155111' ? 'sepolia' : 'neutron';

      // Only show tx hash if it's real-looking (not our synthetic all-zeros fallback)
      const isSyntheticFallback = e.tx_hash === '0x' + '0'.repeat(64);
      const txHash = isSyntheticFallback ? undefined : e.tx_hash;

      const tMs = Date.parse(e.indexed_at);
      const entry: EventLogEntry = {
        t: new Date(tMs).toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        tag,
        actor: e.contract_address.slice(0, 10) + '…',
        msg: buildEventMsg(e.event_type, rawData),
        txHash,
        chain,
      };
      return { kind: 'event', tMs, entry };
    });

    const markerItems: LogItem[] = runMarkers.map((m) => ({
      kind: 'run',
      tMs: m.tMs,
      label: m.label,
      id: m.id,
    }));

    return [...eventItems, ...markerItems]
      .filter((i) => i.tMs > clearedAtMs)
      .sort((a, b) => b.tMs - a.tMs);
  }, [eventsData.data, runMarkers, clearedAtMs]);

  const visibleEventCount = useMemo(
    () => items.filter((i) => i.kind === 'event').length,
    [items],
  );

  // Only auto-scroll the log *container* (not the window) and only when the
  // user is already pinned to the top — i.e. live-following. If they've
  // scrolled down to read older entries, leave their scroll position alone.
  useEffect(() => {
    const el = logContainerRef.current;
    if (!el) return;
    if (el.scrollTop < 80) {
      el.scrollTop = 0;
    }
  }, [items.length]);

  function handleClearLog() {
    // Mute every event timestamped at or before this instant; the realtime
    // hook keeps streaming in fresh ones above the threshold.
    setClearedAtMs(Date.now());
    setRunMarkers([]);
  }

  async function handleScenario(scenarioId: string) {
    setActiveScenario(scenarioId);
    setRunningScenario(scenarioId);
    setLastTxHash(null);

    // Drop a separator marker into the log so the user can tell where this
    // run's events begin. Subtract a tick so the marker reliably sits above
    // any event the API emits in the same millisecond.
    const scenarioName =
      SCENARIOS.find((s) => s.id === scenarioId)?.name ?? scenarioId;
    setRunMarkers((prev) => {
      const id = prev.length > 0 ? prev[prev.length - 1].id + 1 : 1;
      return [
        ...prev,
        {
          id,
          tMs: Date.now() - 1,
          label: `Run ${id} · ${scenarioName}`,
        },
      ];
    });

    try {
      const res = await fetch(`/api/scenarios/${scenarioId}`, { method: 'POST' });
      const body = await res.json().catch(() => ({})) as { success?: boolean; error?: string; message?: string; txHash?: string; etherscanUrl?: string };

      if (!res.ok) {
        toast({
          title: 'Scenario failed',
          description: (body as { error?: string }).error ?? `HTTP ${res.status}`,
          variant: 'error',
        });
      } else {
        if (body.txHash) setLastTxHash(body.txHash);
        toast({
          title: 'Scenario started',
          description: body.message ?? `Running "${scenarioName}"…`,
          variant: 'success',
        });
      }
    } catch {
      toast({
        title: 'Network error',
        description: 'Could not reach the scenario API.',
        variant: 'error',
      });
    } finally {
      setRunningScenario(null);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 page-enter">
      {/* Page header */}
      <div className="mb-10">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-2">
          Demo Control
        </div>
        <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-3">
          Watch the system defend itself.
        </h1>
        <p className="text-stone-400 max-w-2xl leading-relaxed">
          Trigger any of four test scenarios. Each scenario locks real tUSDC on Sepolia — the lock
          transaction is verifiable on Etherscan. Proof fetch, transformation, and relay steps
          stream live below.
        </p>
      </div>

      {/* Relayer cards */}
      <SectionLabel className="mb-4">Relayers</SectionLabel>
      <div className="grid md:grid-cols-2 gap-px bg-stone-800/60 border border-stone-800 rounded-md mb-12 overflow-hidden">
        {relayers.map((r, i) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.08 }}
          >
            <RelayerCard relayer={r} />
          </motion.div>
        ))}
      </div>

      {/* Scenario buttons */}
      <SectionLabel className="mb-4">Test Scenarios</SectionLabel>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {SCENARIOS.map((s, i) => {
          const Icon = SCENARIO_ICON_MAP[s.id] ?? Play;
          const isActive = activeScenario === s.id;
          const isRunning = runningScenario === s.id;

          return (
            <motion.button
              key={s.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 + i * 0.07 }}
              onClick={() => handleScenario(s.id)}
              disabled={!!runningScenario}
              className={[
                'text-left p-5 bg-stone-950 border border-stone-800 rounded-sm transition card-tilt',
                SCENARIO_RING[s.color],
                isActive ? 'ring-1 ring-orange-400/50' : '',
                runningScenario && !isRunning ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              <Icon size={18} strokeWidth={1.5} className={SCENARIO_ICON_COLOR[s.color]} />
              <div className="font-display text-xl text-stone-100 mt-3">{s.name}</div>
              <div className="text-xs text-stone-500 mt-1.5 leading-relaxed">{s.desc}</div>
              <div className="mt-4 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-stone-600">
                {isRunning ? (
                  <>
                    <CircleDot size={9} className="animate-pulse text-orange-400" />
                    <span className="text-orange-400">Running…</span>
                  </>
                ) : (
                  <>
                    <Play size={9} />
                    Run script
                  </>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Last lock tx link */}
      {lastTxHash && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 flex items-center gap-2 text-xs font-mono"
        >
          <span className="text-stone-500">Lock tx:</span>
          <a
            href={`https://sepolia.etherscan.io/tx/${lastTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-400 hover:text-orange-300 flex items-center gap-1 transition-colors"
          >
            {lastTxHash.slice(0, 14)}…{lastTxHash.slice(-6)}
            <ExternalLink size={11} />
          </a>
        </motion.div>
      )}

      {/* Live event log */}
      <SectionLabel className="mb-4">Live event log</SectionLabel>
      <Card className="overflow-hidden">
        <div className="bg-stone-950 px-5 py-3 border-b border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Terminal size={13} className="text-stone-400" />
            <span className="font-mono text-xs text-stone-300">tessera://events --follow</span>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider">
            <span className="flex items-center gap-2">
              <CircleDot size={9} className="text-emerald-400 animate-pulse" />
              <span className="text-stone-500">
                {visibleEventCount > 0 ? `${visibleEventCount} events` : 'Streaming · real-time'}
              </span>
            </span>
            <button
              type="button"
              onClick={handleClearLog}
              disabled={items.length === 0}
              aria-label="Clear log"
              title="Hide all events currently in the log. Future events keep streaming in."
              className="flex items-center gap-1 px-2 py-1 rounded border border-stone-800 text-stone-500 hover:text-stone-200 hover:border-stone-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-stone-500 disabled:hover:border-stone-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-400/60"
            >
              <Eraser size={10} />
              <span>Clear</span>
            </button>
          </div>
        </div>

        <div
          ref={logContainerRef}
          className="p-5 font-mono text-xs space-y-1 max-h-96 overflow-y-auto bg-stone-950/30"
        >
          {items.length === 0 ? (
            <div className="text-stone-600 text-center py-6">
              No events yet — run a scenario to see the relay pipeline in real time.
            </div>
          ) : (
            items.map((it, i) =>
              it.kind === 'event' ? (
                <EventRow key={`e-${it.tMs}-${i}`} entry={it.entry} index={i} />
              ) : (
                <div
                  key={`r-${it.id}`}
                  role="separator"
                  aria-label={it.label}
                  className="flex items-center gap-2 py-2 select-none"
                >
                  <span className="flex-1 h-px bg-stone-800" />
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 px-2">
                    {it.label}
                  </span>
                  <span className="flex-1 h-px bg-stone-800" />
                </div>
              ),
            )
          )}
        </div>
      </Card>
    </div>
  );
}
