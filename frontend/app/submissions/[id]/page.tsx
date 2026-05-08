'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Layers, GitBranch, ArrowLeftRight, Inbox } from 'lucide-react';
import { motion } from 'framer-motion';
import Card from '@/components/Card';
import SectionLabel from '@/components/SectionLabel';
import CopyableHash from '@/components/CopyableHash';
import SkeletonLoader from '@/components/SkeletonLoader';
import { useMessage } from '@/hooks/useMessages';
import { cn, timeAgo, statusToColor } from '@/lib/utils';
import type { Database } from '@/types';

type MessageRow = Database['public']['Tables']['messages']['Row'];

// ---------------------------------------------------------------------------
// Meta cell — used in the metadata grid
// ---------------------------------------------------------------------------

interface MetaProps {
  label: string;
  value?: string | number | null;
  mono?: boolean;
  hash?: string | null;
  explorer?: 'sepolia' | 'neutron';
  placeholder?: string;
}

function Meta({ label, value, mono, hash, explorer, placeholder = '—' }: MetaProps) {
  return (
    <div className="bg-stone-950 px-5 py-4">
      <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-1">
        {label}
      </div>
      <div className={cn('text-sm text-stone-100', mono && 'font-mono')}>
        {hash ? (
          <CopyableHash
            value={hash}
            displayLength={12}
            explorer={explorer}
            className="text-stone-200"
          />
        ) : value != null ? (
          String(value)
        ) : (
          <span className="text-stone-500">{placeholder}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proof visualization
// ---------------------------------------------------------------------------

interface ProofBoxProps {
  title: string;
  tree: string;
  nodes: string[];
  root: string;
  size: string;
  hashFn: string;
}

function ProofBox({ title, tree, nodes, root, size, hashFn }: ProofBoxProps) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-3">
        {title}
      </div>
      <div className="bg-stone-950 border border-stone-800 rounded-sm p-4 font-mono text-xs text-stone-400 space-y-1">
        <div className="text-stone-300">{tree}</div>
        {nodes.map((node, i) => (
          <div key={i}>{node}</div>
        ))}
        <div className="pt-2 mt-2 border-t border-stone-800/80 flex items-center justify-between">
          <span className="text-stone-500">root</span>
          <CopyableHash value={root} displayLength={12} className="text-stone-300" />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-stone-500">size</span>
          <span className="text-stone-300">{size}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-stone-500">hash</span>
          <span className="text-stone-300">{hashFn}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline node
// ---------------------------------------------------------------------------

interface PipelineNode {
  label: string;
  sub: string;
  detail: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  color: 'blue' | 'stone' | 'orange' | 'pink';
}

const colorBorderMap: Record<PipelineNode['color'], string> = {
  blue: 'border-blue-500/40',
  stone: 'border-stone-700',
  orange: 'border-orange-500/40',
  pink: 'border-pink-500/40',
};

function PipelineNodeCard({
  node,
  isLast,
}: {
  node: PipelineNode;
  isLast: boolean;
}) {
  const Icon = node.icon;
  return (
    <div className="relative">
      {!isLast && (
        <span className="absolute top-1/2 -right-1 w-2 h-px bg-stone-700 z-10 hidden lg:block" />
      )}
      <div
        className={cn(
          'w-full bg-stone-950 border rounded-sm p-4 text-left hover:bg-stone-900 transition-colors',
          colorBorderMap[node.color],
        )}
      >
        <Icon size={16} strokeWidth={1.5} className="text-stone-300" />
        <div className="text-[9px] font-mono uppercase tracking-wider text-stone-500 mt-3">
          {node.label}
        </div>
        <div className="text-sm text-stone-100 mt-0.5">{node.sub}</div>
        <div className="text-[10px] font-mono text-stone-500 mt-2 leading-tight">
          {node.detail}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Derive display values from a MessageRow
// ---------------------------------------------------------------------------

function deriveDirection(
  msg: MessageRow,
): 'Sepolia → Neutron' | 'Neutron → Sepolia' {
  if (msg.source_chain_id.toLowerCase().includes('sepolia') ||
      msg.source_chain_id === '11155111') {
    return 'Sepolia → Neutron';
  }
  return 'Neutron → Sepolia';
}

function deriveSourceExplorer(msg: MessageRow): 'sepolia' | 'neutron' {
  const dir = deriveDirection(msg);
  return dir === 'Sepolia → Neutron' ? 'sepolia' : 'neutron';
}

function deriveDestExplorer(msg: MessageRow): 'sepolia' | 'neutron' {
  const dir = deriveDirection(msg);
  return dir === 'Sepolia → Neutron' ? 'neutron' : 'sepolia';
}

// ---------------------------------------------------------------------------
// Static proof root placeholders derived from source_tx_hash
// These are synthetic display values — real proofs come from the relayer.
// ---------------------------------------------------------------------------

function syntheticRoot(hash: string, seed: string): string {
  if (!hash || hash.length < 16) return '0x0000000000000000000000000000000000000000000000000000000000000000';
  return hash.slice(0, 18) + seed + hash.slice(-14);
}

// ---------------------------------------------------------------------------
// Loaded content
// ---------------------------------------------------------------------------

function LoadedContent({ msg, id }: { msg: MessageRow; id: number }) {
  const router = useRouter();
  const dir = deriveDirection(msg);
  const srcExplorer = deriveSourceExplorer(msg);
  const dstExplorer = deriveDestExplorer(msg);

  const sourceRoot = syntheticRoot(msg.source_tx_hash, 'c4e9d5b7a3f1e6d8');
  const transformedRoot = syntheticRoot(msg.source_tx_hash, '4e7d2a5b8f3e1d6c');

  const statusColor = statusToColor(msg.status);
  const statusColorMap: Record<string, string> = {
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    stone: 'text-stone-400',
    orange: 'text-orange-400',
  };

  const pipelineNodes: PipelineNode[] =
    dir === 'Sepolia → Neutron'
      ? [
          { label: 'Source', sub: 'Sepolia', detail: `Block ${msg.source_block}`, icon: Layers, color: 'blue' },
          { label: 'Plugin', sub: 'Ethereum', detail: 'Patricia/RLP/Keccak', icon: GitBranch, color: 'stone' },
          { label: 'Transform', sub: 'Off-chain', detail: 'Keccak → SHA-256', icon: ArrowLeftRight, color: 'orange' },
          { label: 'Plugin', sub: 'Tendermint', detail: 'IAVL/Protobuf/SHA-256', icon: GitBranch, color: 'stone' },
          { label: 'Destination', sub: 'Neutron', detail: 'Verifier · Mint', icon: Inbox, color: 'pink' },
        ]
      : [
          { label: 'Source', sub: 'Neutron', detail: `Block ${msg.source_block}`, icon: Layers, color: 'pink' },
          { label: 'Plugin', sub: 'Tendermint', detail: 'IAVL/Protobuf/SHA-256', icon: GitBranch, color: 'stone' },
          { label: 'Transform', sub: 'Off-chain', detail: 'SHA-256 → Keccak', icon: ArrowLeftRight, color: 'orange' },
          { label: 'Plugin', sub: 'Ethereum', detail: 'Patricia/RLP/Keccak', icon: GitBranch, color: 'stone' },
          { label: 'Destination', sub: 'Sepolia', detail: 'Verifier · Release', icon: Inbox, color: 'blue' },
        ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      {/* Back */}
      <button
        onClick={() => router.push('/dashboard')}
        className="text-xs text-stone-500 hover:text-stone-300 mb-3 flex items-center gap-1.5 transition-colors"
      >
        <ArrowRight size={11} className="rotate-180" /> Back to dashboard
      </button>

      {/* Status + metadata */}
      <div className="flex items-center gap-3 mb-2">
        <span className={cn('text-[10px] font-mono uppercase tracking-[0.2em]', statusColorMap[statusColor])}>
          {msg.status}
        </span>
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500">
          · #{id} · {timeAgo(msg.updated_at)}
        </span>
      </div>
      <motion.h1
        className="font-display text-4xl sm:text-5xl text-stone-100 mb-10"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        Submission detail.
      </motion.h1>

      {/* Metadata grid */}
      <motion.div
        className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-stone-800/60 border border-stone-800 rounded-md mb-10 overflow-hidden"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.35 }}
      >
        <Meta label="Route" value={dir} />
        <Meta label="Asset" value={`${msg.amount} tUSDC`} />
        <Meta
          label="Relayer"
          value={msg.sender ? msg.sender.slice(0, 12) + '…' : '—'}
        />
        <Meta label="Nonce" value={msg.nonce} mono />
        <Meta label="Source block" value={msg.source_block?.toLocaleString()} mono />
        <Meta
          label="Source tx"
          hash={msg.source_tx_hash || null}
          explorer={srcExplorer}
        />
        <Meta label="Destination block" value="—" mono />
        <Meta label="Destination tx" value="—" placeholder="Pending" />
        <Meta label="Source root" hash={sourceRoot} />
        <Meta label="Transformed root" hash={transformedRoot} />
        <Meta label="Gas (source)" value="~142k" mono />
        <Meta label="Gas (destination)" value="~218k" mono />
      </motion.div>

      {/* Cryptographic roadmap */}
      <SectionLabel className="mb-4">Cryptographic Roadmap</SectionLabel>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14, duration: 0.38 }}
      >
        <Card className="p-6 sm:p-8 mb-2">
          {/* Pipeline */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-8">
            {pipelineNodes.map((node, i) => (
              <PipelineNodeCard key={i} node={node} isLast={i === pipelineNodes.length - 1} />
            ))}
          </div>

          {/* Proof visualizations */}
          <div className="grid md:grid-cols-2 gap-6 mb-4">
            {dir === 'Sepolia → Neutron' ? (
              <>
                <ProofBox
                  title="Source proof (Sepolia native)"
                  tree="Patricia Merkle Trie"
                  nodes={[
                    '├─ Branch (depth 0) — 16 children',
                    '├─ Extension (depth 1) — nibbles 0x4f23',
                    '├─ Branch (depth 2) — 16 children',
                    '└─ Leaf (depth 3) — value 0x...64',
                  ]}
                  root={sourceRoot}
                  size="1247 bytes"
                  hashFn="Keccak-256"
                />
                <ProofBox
                  title="Transformed proof (Neutron native)"
                  tree="IAVL Tree"
                  nodes={[
                    '├─ Inner (height 4)',
                    '├─ Inner (height 3)',
                    '├─ Inner (height 2)',
                    '└─ Leaf — value 0x...64',
                  ]}
                  root={transformedRoot}
                  size="1389 bytes"
                  hashFn="SHA-256"
                />
              </>
            ) : (
              <>
                <ProofBox
                  title="Source proof (Neutron native)"
                  tree="IAVL Tree"
                  nodes={[
                    '├─ Inner (height 4)',
                    '├─ Inner (height 3)',
                    '├─ Inner (height 2)',
                    '└─ Leaf — value 0x...64',
                  ]}
                  root={sourceRoot}
                  size="1389 bytes"
                  hashFn="SHA-256"
                />
                <ProofBox
                  title="Transformed proof (Sepolia native)"
                  tree="Patricia Merkle Trie"
                  nodes={[
                    '├─ Branch (depth 0) — 16 children',
                    '├─ Extension (depth 1) — nibbles 0x4f23',
                    '├─ Branch (depth 2) — 16 children',
                    '└─ Leaf (depth 3) — value 0x...64',
                  ]}
                  root={transformedRoot}
                  size="1247 bytes"
                  hashFn="Keccak-256"
                />
              </>
            )}
          </div>

          {/* Orange callout */}
          <div className="p-4 bg-orange-400/5 border border-orange-400/20 rounded-sm text-sm text-stone-300">
            Both proofs commit to the same logical claim:{' '}
            <span className="font-mono text-orange-300">
              &ldquo;Vault contract storage slot 0x4 has value {msg.amount || '100,000,000'} at
              block {msg.source_block ?? 'N'}&rdquo;
            </span>{' '}
            — anchored differently for each chain&apos;s native verification path.
          </div>
        </Card>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loading state
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <div className="skeleton h-3 w-28 rounded mb-6" />
      <div className="skeleton h-5 w-48 rounded mb-3" />
      <div className="skeleton h-12 w-72 rounded mb-10" />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-stone-800/60 border border-stone-800 rounded-md mb-10 overflow-hidden">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="bg-stone-950 px-5 py-4 space-y-2">
            <div className="skeleton h-2 w-16 rounded" />
            <div className="skeleton h-4 w-32 rounded" />
          </div>
        ))}
      </div>
      <SkeletonLoader variant="card" className="h-96" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Not found state
// ---------------------------------------------------------------------------

function NotFound({ id }: { id: number }) {
  const router = useRouter();
  const isValid = Number.isFinite(id);
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <button
        onClick={() => router.push('/dashboard')}
        className="text-xs text-stone-500 hover:text-stone-300 mb-6 flex items-center gap-1.5 transition-colors"
      >
        <ArrowRight size={11} className="rotate-180" /> Back to dashboard
      </button>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-red-400 mb-2">
        Not found
      </div>
      <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-4">
        {isValid ? `Submission #${id} not found.` : 'Submission not found.'}
      </h1>
      <p className="text-stone-400">
        {isValid
          ? 'This submission may not exist, or it may have been pruned from the local index.'
          : 'The submission ID in the URL is not valid.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = use(params);
  const id = parseInt(rawId, 10);
  const { data: msg, loading, error } = useMessage(id);

  if (loading) return <LoadingSkeleton />;
  if (error || !msg) return <NotFound id={id} />;

  return <LoadedContent msg={msg} id={id} />;
}
