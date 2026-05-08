'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
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

const STATIC_EVENTS: EventLogEntry[] = [
  { t: '14:23:01', tag: 'submit', actor: 'Relayer A', msg: 'Submitted checkpoint for Sepolia block 12,345' },
  { t: '14:23:03', tag: 'window', actor: 'System', msg: 'Challenge window opened (60s)' },
  { t: '14:23:09', tag: 'verify', actor: 'Relayer B', msg: 'Verified submission · root matches · standing down' },
  { t: '14:24:03', tag: 'finalize', actor: 'System', msg: 'Window closed — submission finalized' },
  { t: '14:24:05', tag: 'execute', actor: 'Relayer A', msg: 'Executed message · 100 tUSDC minted to neutron1q4f…' },
  { t: '14:24:06', tag: 'reward', actor: 'System', msg: 'Fee 0.001 ETH paid to Relayer A' },
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

const TAG_COLORS: Record<string, string> = {
  submit: 'bg-blue-500/10 text-blue-300',
  verify: 'bg-emerald-500/10 text-emerald-300',
  window: 'bg-stone-500/10 text-stone-300',
  finalize: 'bg-emerald-500/10 text-emerald-300',
  execute: 'bg-orange-500/10 text-orange-300',
  reward: 'bg-emerald-500/10 text-emerald-300',
  slash: 'bg-red-500/10 text-red-300',
  challenge: 'bg-amber-500/10 text-amber-300',
};

const SCENARIO_RING: Record<string, string> = {
  emerald: 'hover:border-emerald-500/50 hover:bg-emerald-500/5',
  red: 'hover:border-red-500/50 hover:bg-red-500/5',
  amber: 'hover:border-amber-500/50 hover:bg-amber-500/5',
  orange: 'hover:border-orange-500/50 hover:bg-orange-500/5',
};

const SCENARIO_ICON_COLOR: Record<string, string> = {
  emerald: 'text-emerald-400',
  red: 'text-red-400',
  amber: 'text-amber-400',
  orange: 'text-orange-400',
};

// ---------- sub-components ----------

function BondCell({
  chain,
  gas,
  bond,
  unit,
}: {
  chain: string;
  gas: number;
  bond: number;
  unit: string;
}) {
  const total = gas + bond;
  /* Flag bond as low relative to the demo operating threshold. */
  const isLow = unit === 'ETH' ? bond < 0.3 : bond < 60;
  const maxForBar = unit === 'ETH' ? 0.5 : 100;

  return (
    <div className="bg-stone-950 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
          {chain}
        </span>
        <span className="font-mono text-xs text-stone-300">
          {total.toFixed(2)} {unit}
        </span>
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
            <CopyableHash
              value={relayer.sepoliaAddress}
              displayLength={10}
              className="text-[11px]"
            />
          </div>
        </div>
        <StatusBadge activityType={relayer.activityType} activity={relayer.activity} />
      </div>

      <div className="grid grid-cols-2 gap-px bg-stone-800/60 mb-5">
        <BondCell
          chain="Sepolia"
          gas={relayer.bond.sepolia.gas}
          bond={relayer.bond.sepolia.bond}
          unit="ETH"
        />
        <BondCell
          chain="Neutron"
          gas={relayer.bond.neutron.gas}
          bond={relayer.bond.neutron.bond}
          unit="NTRN"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
            Earned
          </div>
          <div className="font-mono text-emerald-400 mt-0.5">
            +{relayer.earned.toFixed(4)} ETH
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
            Slashed
          </div>
          <div className="font-mono text-stone-300 mt-0.5">
            {typeof relayer.slashed === 'number'
              ? relayer.slashed.toFixed(4)
              : relayer.slashed}{' '}
            ETH
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
            Submitted
          </div>
          <div className="font-mono text-stone-300 mt-0.5">{relayer.submissions}</div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
            Success
          </div>
          <div className="font-mono text-emerald-400 mt-0.5">{relayer.successRate}%</div>
        </div>
      </div>
    </div>
  );
}

// ---------- event log entry ----------

function EventRow({ entry, index }: { entry: EventLogEntry; index: number }) {
  const colorClass = TAG_COLORS[entry.tag] ?? 'bg-amber-500/10 text-amber-300';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04 }}
      className="flex flex-wrap gap-3"
    >
      <span className="text-stone-600 shrink-0">[{entry.t}]</span>
      <span
        className={`shrink-0 px-1.5 rounded text-[10px] uppercase tracking-wider ${colorClass}`}
      >
        {entry.tag}
      </span>
      <span className="text-stone-400 shrink-0 w-24 truncate">{entry.actor}</span>
      <span className="text-stone-300">{entry.msg}</span>
    </motion.div>
  );
}

// ---------- page ----------

export default function DemoPage() {
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const { toast } = useToast();
  const relayerStats = useRelayerStats();
  const eventsData = useEventsRealtime(50);

  /* Resolve display relayers — real data or static fallback. */
  const relayers: RelayerInfo[] =
    relayerStats.data && relayerStats.data.length > 0
      ? relayerStats.data
      : STATIC_RELAYERS;

  /*
   * Map raw DB event rows to EventLogEntry shape for the log.
   * Fall back to static demo events if no real data is present.
   */
  const events: EventLogEntry[] =
    eventsData.data && eventsData.data.length > 0
      ? eventsData.data.map((e) => ({
          t: new Date(e.indexed_at).toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          tag: e.event_type,
          actor: e.contract_address.slice(0, 10) + '…',
          msg: `${e.event_type} on block ${e.block_number} · ${e.chain_id}`,
        }))
      : STATIC_EVENTS;

  /* Auto-scroll log to bottom when new events arrive. */
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  async function handleScenario(scenarioId: string) {
    setActiveScenario(scenarioId);
    setRunningScenario(scenarioId);

    try {
      const res = await fetch(`/api/scenarios/${scenarioId}`, { method: 'POST' });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
        toast({
          title: 'Scenario failed',
          description: msg,
          variant: 'error',
        });
      } else {
        toast({
          title: 'Scenario started',
          description: `Running "${SCENARIOS.find((s) => s.id === scenarioId)?.name}" on testnet…`,
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
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-orange-400 mb-2">
          Demo Control
        </div>
        <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-3">
          Watch the system defend itself.
        </h1>
        <p className="text-stone-400 max-w-2xl leading-relaxed">
          Trigger any of four hardcoded test scenarios to see how Tessera responds to honest
          delivery, fraud, absence, and frivolous challenges. Each scenario runs as a real
          on-testnet transaction.
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
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-12">
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
              <Icon
                size={18}
                strokeWidth={1.5}
                className={SCENARIO_ICON_COLOR[s.color]}
              />
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

      {/* Live event log */}
      <SectionLabel className="mb-4">Live event log</SectionLabel>
      <Card className="overflow-hidden">
        <div className="bg-stone-950 px-5 py-3 border-b border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Terminal size={13} className="text-stone-400" />
            <span className="font-mono text-xs text-stone-300">
              tessera://events --follow
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
            <CircleDot size={9} className="text-emerald-400 animate-pulse" />
            <span className="text-stone-500">Streaming · real-time</span>
          </div>
        </div>

        <div className="p-5 font-mono text-xs space-y-1.5 max-h-72 overflow-y-auto">
          {events.map((e, i) => (
            <EventRow key={i} entry={e} index={i} />
          ))}
          {/* Scroll anchor */}
          <div ref={logEndRef} />
        </div>
      </Card>
    </div>
  );
}
