'use client';

import { useState } from 'react';
import {
  Compass,
  BookOpen,
  Workflow,
  ShieldCheck,
  Cpu,
  Network,
  Play,
  FileCog,
  Plus,
  AlertCircle,
  Map,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  Power,
  Gavel,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Card from '@/components/Card';
import SectionLabel from '@/components/SectionLabel';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Section registry
// ---------------------------------------------------------------------------

type SectionId =
  | 'overview'
  | 'what'
  | 'how'
  | 'trust'
  | 'crypto'
  | 'architecture'
  | 'scenarios'
  | 'wallets'
  | 'relayer'
  | 'addchain'
  | 'risks'
  | 'roadmap';

interface DocSection {
  id: SectionId;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  title: string;
}

const DOC_SECTIONS: DocSection[] = [
  { id: 'overview', icon: Compass, title: 'Overview' },
  { id: 'what', icon: BookOpen, title: 'What is Tessera' },
  { id: 'how', icon: Workflow, title: 'How it works' },
  { id: 'trust', icon: ShieldCheck, title: 'Trust model' },
  { id: 'crypto', icon: Cpu, title: 'Cryptography' },
  { id: 'architecture', icon: Network, title: 'Architecture' },
  { id: 'scenarios', icon: Play, title: 'Demo scenarios' },
  { id: 'wallets', icon: CheckCircle2, title: 'Wallet setup & tUSDC' },
  { id: 'relayer', icon: FileCog, title: 'Run a relayer' },
  { id: 'addchain', icon: Plus, title: 'Add a chain' },
  { id: 'risks', icon: AlertCircle, title: 'Limitations & risks' },
  { id: 'roadmap', icon: Map, title: 'Roadmap' },
];

// ---------------------------------------------------------------------------
// Shared prose helpers
// ---------------------------------------------------------------------------

function ProseSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <SectionLabel className="mb-4">{label}</SectionLabel>
      {children}
    </section>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-stone-950 border border-stone-800 rounded-sm p-4 overflow-x-auto font-mono text-xs text-stone-300 leading-relaxed whitespace-pre mb-4">
      {children}
    </pre>
  );
}

function ComparisonTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | React.ReactNode)[][];
}) {
  return (
    <div className="overflow-x-auto mb-6">
      <table className="w-full text-sm min-w-[600px]">
        <thead>
          <tr className="border-b border-stone-800 text-[10px] font-mono uppercase tracking-wider text-stone-500">
            {headers.map((h) => (
              <th key={h} className="text-left px-4 py-2.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-stone-800/50 hover:bg-stone-900/30 transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-stone-300">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section content components
// ---------------------------------------------------------------------------

function OverviewContent() {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-orange-400 mb-3">
        Documentation
      </div>
      <h1 className="font-display text-5xl sm:text-6xl text-stone-100 leading-[1.05] mb-6">
        Tessera, end to end.
      </h1>
      <p className="text-stone-400 text-lg leading-relaxed mb-8">
        A trust-minimized cross-chain framework for moving assets and messages between EVM and
        Cosmos chains. This documentation covers what the project is, how it works, the trust
        model, the cryptography, the architecture, and the path from research prototype to
        production.
      </p>
      <Card className="p-6 mb-8">
        <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-3">
          In this documentation
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {DOC_SECTIONS.filter((s) => s.id !== 'overview').map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.id}
                className="flex items-center gap-3 p-3 bg-stone-950/60 border border-stone-800 rounded-sm hover:border-stone-700 transition-colors"
              >
                <Icon size={14} className="text-orange-400" strokeWidth={1.5} />
                <span className="text-sm text-stone-200">{s.title}</span>
              </div>
            );
          })}
        </div>
      </Card>
      <ProseSection label="At a glance">
        <p className="text-stone-400 leading-relaxed mb-4">
          Tessera is a trust-minimized cross-chain infrastructure layer. It moves assets and
          arbitrary messages between EVM and Cosmos chains without trusting any relay operator,
          running any ZK prover, or doing on-chain Ed25519 verification.
        </p>
        <p className="text-stone-400 leading-relaxed mb-4">
          The first reference application is a bidirectional{' '}
          <span className="text-stone-200 font-medium">tUSDC bridge</span> between Sepolia
          (Ethereum testnet) and Neutron (Cosmos / CosmWasm testnet).
        </p>
        <CodeBlock>{`Sepolia (EVM)                    Go Relayer × 2               Neutron (CosmWasm)
─────────────────                ──────────────               ──────────────────
BridgeVault.lock()  ──Locked──▶  fetch Patricia proof         Verifier.submitMessage()
                                 transform → IAVL             BridgeMint.mint()
                                 verify Ed25519 ✓
                                 submit to Neutron ──────────▶

BridgeVault.release() ◀──────── transform → Patricia         BridgeMint.burn() ──Burned──▶
                                 submit to Sepolia ◀──────────`}</CodeBlock>
      </ProseSection>
    </div>
  );
}

function WhatContent() {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-3">
        What is Tessera
      </div>
      <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-6">
        Three problems solved.
      </h1>
      <p className="text-stone-400 leading-relaxed mb-8">
        Every existing cross-chain system makes a trust trade-off. Tessera&apos;s approach is
        different: it uses bonded economic enforcement and native proof verification to eliminate
        the trust requirement without requiring ZK hardware or on-chain Ed25519 support.
      </p>
      <ProseSection label="Three problems">
        <ComparisonTable
          headers={['Problem', 'How most bridges handle it', 'How Tessera handles it']}
          rows={[
            [
              'Relayer trust',
              'Trust the operator, or use a multisig',
              <span key="t1" className="text-stone-200">
                Bond the relayer; slash on fraud. No trust required.
              </span>,
            ],
            [
              'Cross-chain proof verification',
              'ZK provers (expensive, slow, GPU-dependent)',
              <span key="t2" className="text-stone-200">
                Native proof verification in each VM&apos;s own format — no ZK.
              </span>,
            ],
            [
              'Ed25519 on EVM',
              'On-chain verify (~500k gas, impractical)',
              <span key="t3" className="text-stone-200">
                Off-chain verify in Go (commodity hardware); EVM never sees Tendermint
                signatures.
              </span>,
            ],
          ]}
        />
      </ProseSection>
      <ProseSection label="Novel contributions">
        {[
          {
            title: 'Deterministic Patricia ↔ IAVL proof transformation',
            body: 'Ethereum uses Patricia Merkle Tries (Keccak-256 / RLP). Cosmos uses IAVL trees (SHA-256 / Protobuf). Tessera\'s relayer transforms proofs deterministically between these formats. Because the transformation is deterministic, any honest party can replicate it — making fraud detectable without a trusted oracle.',
          },
          {
            title: 'Ed25519 bypass',
            body: 'Tendermint validator signatures are Ed25519. Verifying them on EVM costs ~500k gas per signature, making it unusable in practice. Tessera\'s Go relayer verifies the 2/3+ validator set off-chain, then submits the already-verified proof transformed to Patricia format. Sepolia never sees Ed25519.',
          },
          {
            title: 'Bonded economic enforcement',
            body: 'Relayers post bonds. A relayer who submits a fraudulent proof loses 50% of their bond to the challenger who caught them. Punishment strictly exceeds any realistic gain from fraud — the network stays honest by economic design, not by social trust.',
          },
          {
            title: 'VM-agnostic dispatch',
            body: 'Every cross-chain message uses a canonical envelope with a destinationApp field. After proof verification, the Verifier contract dispatches to that address via onCrossChainMessage(...). New applications plug in without touching the Verifier.',
          },
        ].map((item) => (
          <div
            key={item.title}
            className="mb-5 p-4 bg-stone-950/60 border border-stone-800 rounded-sm"
          >
            <div className="text-sm font-medium text-stone-100 mb-1.5">{item.title}</div>
            <p className="text-sm text-stone-400 leading-relaxed">{item.body}</p>
          </div>
        ))}
      </ProseSection>
    </div>
  );
}

function HowContent() {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-3">
        How it works
      </div>
      <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-6">
        Proof pipeline, step by step.
      </h1>
      <p className="text-stone-400 leading-relaxed mb-8">
        Tessera&apos;s proof pipeline runs in two directions. Sepolia to Neutron uses Patricia
        proofs transformed into IAVL format. Neutron to Sepolia verifies Ed25519 off-chain and
        transforms IAVL to Patricia. The same bonded challenge mechanism protects both
        directions.
      </p>
      <ProseSection label="Sepolia → Neutron">
        <CodeBlock>{`1. User calls BridgeVault.lock() on Sepolia
       ↓
2. Relayer observes Locked event
       ↓
3. EthereumPlugin.FetchProof()
   → eth_getProof (storage proof, Patricia / Keccak-256 / RLP)
       ↓
4. VerifyConsensus() — RPC trust (documented limitation)
       ↓
5. TranslateProofTo(targetChainType=Tendermint)
   Patricia (Keccak-256/RLP) → IAVL (SHA-256/Protobuf)
   Deterministic. Byte-identical for same input.
       ↓
6. TendermintPlugin.SubmitMessage()
   → Verifier.submitMessage(envelope, transformedRoot, IAVLproof)
       ↓
7. Challenge window: 60s
   Challenger independently replicates steps 3–5.
   On mismatch → challenge(). On match → stand down.
       ↓
8. executeMessage() — walks IAVL proof with SHA-256
   On valid → IApp(destinationApp).onCrossChainMessage(...)
       ↓
9. BridgeMint.mint() → user receives tUSDC on Neutron`}</CodeBlock>
      </ProseSection>
      <ProseSection label="Neutron → Sepolia (Ed25519 bypass)">
        <CodeBlock>{`1. User calls BridgeMint.burn() on Neutron
       ↓
2. Relayer observes Burned event
       ↓
3. TendermintPlugin.FetchProof()
   → ABCI query (IAVL proof, SHA-256/Protobuf)
       ↓
4. VerifyConsensus()
   → cometbft.NewValidatorSet.VerifyCommit()
   → validates 2/3+ Ed25519 validator signatures off-chain in Go
   ← EVM never sees Ed25519
       ↓
5. TranslateProofTo(targetChainType=EVM)
   IAVL (SHA-256/Protobuf) → Patricia (Keccak-256/RLP)
       ↓
6. EthereumPlugin.SubmitMessage()
   → Verifier.submitMessage(envelope, transformedRoot, patriciaProof)
       ↓
7–9. Same challenge + execute flow (Solidity Verifier walks Patricia proof)
       ↓
9. BridgeVault.release() → user receives tUSDC on Sepolia`}</CodeBlock>
      </ProseSection>
    </div>
  );
}

function TrustContent() {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-3">
        Trust model
      </div>
      <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-6">
        Where the trust lives.
      </h1>
      <p className="text-stone-400 leading-relaxed mb-8">
        Tessera is not trustless everywhere — no system is. But it is explicit about where trust
        is required and why. The table below maps each layer to its trust requirement.
      </p>
      <ProseSection label="Trust layers">
        <ComparisonTable
          headers={['Layer', 'Trust assumption']}
          rows={[
            [
              'Source consensus (Neutron)',
              <span key="n1" className="text-emerald-300">
                Go relayer verifies 2/3+ Ed25519 validator signatures. Cryptographic.
              </span>,
            ],
            [
              'Source consensus (Sepolia)',
              <span key="n2" className="text-amber-300">
                RPC trust — relayer trusts its configured RPC node. Documented limitation; future
                work: sync committee.
              </span>,
            ],
            [
              'Proof transformation',
              <span key="n3" className="text-emerald-300">
                Deterministic. Any party can replicate. Fraud = detectable by challenger.
              </span>,
            ],
            [
              'Destination verification',
              <span key="n4" className="text-emerald-300">
                On-chain Merkle proof walk. No trust.
              </span>,
            ],
            [
              'Economic enforcement',
              <span key="n5" className="text-emerald-300">
                Bond at risk. Punishment &gt; gain. Honest behavior is the rational strategy.
              </span>,
            ],
          ]}
        />
        <div className="p-4 bg-stone-950/60 border border-stone-800 rounded-sm text-sm text-stone-400">
          <span className="text-stone-300 font-medium">Liveness assumption: </span>
          at least one honest, online relayer in the registered set. This is the standard
          assumption for all optimistic systems and weakens as the relayer set grows.
        </div>
      </ProseSection>
      <ProseSection label="Design space">
        <p className="text-stone-400 leading-relaxed mb-4">
          Every bridge sits on two axes: trust (who do you trust to relay?) and verification
          (how does the destination confirm the source event really happened?). Tessera occupies
          the <span className="text-stone-200">economic enforcement + native proof</span>{' '}
          corner — the combination that makes fraud detectable, punishable on-chain, and
          economically irrational without ZK hardware.
        </p>
      </ProseSection>
    </div>
  );
}

function CryptoContent() {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-3">
        Cryptography
      </div>
      <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-6">
        Two proof formats, one claim.
      </h1>
      <p className="text-stone-400 leading-relaxed mb-8">
        The core cryptographic problem Tessera solves: Ethereum and Cosmos use fundamentally
        different data structures for their state proofs. Tessera&apos;s deterministic
        transformation layer bridges them without requiring either chain to understand the
        other&apos;s format.
      </p>
      <ProseSection label="Patricia Merkle Trie (Ethereum)">
        <p className="text-stone-400 leading-relaxed mb-4">
          Ethereum state is stored in a Modified Merkle Patricia Trie. Proofs are structured as
          a sequence of RLP-encoded nodes (Branch, Extension, Leaf) hashed with Keccak-256.
          The root of the trie is committed to every block header.
        </p>
        <CodeBlock>{`Patricia Merkle Trie
├─ Branch (depth 0) — 16 children
├─ Extension (depth 1) — nibbles 0x4f23
├─ Branch (depth 2) — 16 children
└─ Leaf (depth 3) — value 0x...64

Hash function: Keccak-256
Encoding:      RLP
Root:          committed in block header`}</CodeBlock>
      </ProseSection>
      <ProseSection label="IAVL Tree (Cosmos / Tendermint)">
        <p className="text-stone-400 leading-relaxed mb-4">
          Cosmos chains use an IAVL+ tree (a self-balancing Merkle tree) for module store
          proofs. Nodes are encoded with Protobuf and hashed with SHA-256. The root is
          committed in each Tendermint block header.
        </p>
        <CodeBlock>{`IAVL Tree
├─ Inner (height 4)
├─ Inner (height 3)
├─ Inner (height 2)
└─ Leaf — value 0x...64

Hash function: SHA-256
Encoding:      Protobuf
Root:          committed in block header`}</CodeBlock>
      </ProseSection>
      <ProseSection label="Deterministic transformation">
        <p className="text-stone-400 leading-relaxed mb-4">
          The transformation from Patricia to IAVL (or vice versa) is a pure function of the
          input proof. Given the same source proof, every honest relayer will produce the same
          transformed root — a property called{' '}
          <span className="text-stone-200">determinism</span>. This is what makes fraud
          detectable: a challenger who re-runs the transformation and gets a different root knows
          the submitter lied.
        </p>
        <div className="p-4 bg-orange-400/5 border border-orange-400/20 rounded-sm text-sm text-stone-300">
          Both proofs commit to the same logical claim:{' '}
          <span className="font-mono text-orange-300">
            &ldquo;Vault contract storage slot 0x4 has value 100,000,000 at block N&rdquo;
          </span>{' '}
          — anchored differently for each chain&apos;s native verification path.
        </div>
      </ProseSection>
    </div>
  );
}

function ArchitectureContent() {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-3">
        Architecture
      </div>
      <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-6">
        System components.
      </h1>
      <p className="text-stone-400 leading-relaxed mb-8">
        Tessera has six contracts per chain, two running Go relayers, and a Next.js frontend
        reading from Supabase. The six contracts are logically identical across EVM and CosmWasm
        — deployed code differs, logic is the same.
      </p>
      <ProseSection label="Contract layout">
        <ComparisonTable
          headers={['Contract', 'Role', 'Key entry points']}
          rows={[
            ['RelayerRegistry', 'Identity + state tracking', 'register, topUpBond, withdrawBond, rotateKey, recordSlash'],
            ['Bond', 'Fund custody + slash execution', 'deposit, slash (onlyVerifier), withdraw, getBond'],
            ['Verifier', 'Proof verification + dispatch', 'submitMessage, challenge, executeMessage, claimAbsenceSlash'],
            ['BridgeVault', 'Source-side lock / release', 'lock, release (onlyVerifier)'],
            ['BridgeMint', 'Destination-side mint / burn', 'mint (onlyVerifier), burn'],
            ['tUSDC', 'Test token', 'claim (rate-limited), standard transfer'],
          ]}
        />
      </ProseSection>
      <ProseSection label="Message envelope">
        <CodeBlock>{`struct MessageEnvelope {
    bytes32 sourceChainId;
    bytes   sourceApp;          // contract that emitted source event
    bytes32 destinationChainId;
    bytes   destinationApp;     // IApp-implementing contract to dispatch to
    bytes4  action;             // function selector + encoding scheme
    bytes   payload;            // recipient, amount, etc.
    uint64  nonce;              // monotonic, per source chain + source app
}`}</CodeBlock>
        <p className="text-stone-400 text-sm leading-relaxed">
          The <span className="font-mono text-stone-200">destinationApp</span> field is what
          makes the system application-agnostic — any IApp-implementing contract can receive
          messages without Verifier changes. The{' '}
          <span className="font-mono text-stone-200">nonce</span> drives per-message role
          assignment.
        </p>
      </ProseSection>
      <ProseSection label="Plugin interface">
        <CodeBlock>{`type ChainPlugin interface {
    ChainID() string
    ChainType() ChainType           // EVM | Tendermint

    FetchBlockFingerprint(ctx, height) (Fingerprint, error)
    FetchProof(ctx, txHash, eventIdx, proofKind) (RawProof, error)
    VerifyConsensus(ctx, blockHeader, validatorSet) error
    TranslateProofTo(rawProof, fingerprint, targetChainType) (CanonicalProof, Fingerprint, error)

    SubmitMessage(ctx, envelope, proof, fingerprint, bondRef) (TxHash, error)
    SubmitChallenge(ctx, submissionId, correctFingerprint, evidenceProof) (TxHash, error)
    SubscribeEvents(ctx, contractAddrs, fromBlock) (<-chan Event, error)
    GetBondStatus(ctx, relayer) (BondStatus, error)
}`}</CodeBlock>
        <p className="text-stone-400 text-sm leading-relaxed">
          Adding a new source chain means implementing this interface in one Go file. Nothing
          else in the repository changes.
        </p>
      </ProseSection>
    </div>
  );
}

function ScenariosContent() {
  const scenarios = [
    {
      id: 'honest',
      name: 'Honest delivery',
      icon: CheckCircle2,
      desc: 'Normal flow, no fraud, relayer earns fee',
      color: 'emerald' as const,
      proof:
        'The happy path works: a legitimate relayer submits a valid proof, the challenger verifies, the window closes uncontested, the message executes, the relayer earns the fee. Confirms the cryptographic verification path is wired correctly end-to-end.',
    },
    {
      id: 'lying',
      name: 'Lying relayer',
      icon: AlertTriangle,
      desc: 'Submitter sends bad fingerprint, challenger catches it, 50% slash',
      color: 'red' as const,
      proof:
        "The system catches fraudulent submissions. A challenger detects a mismatched fingerprint, files a dispute with proof, the bond contract slashes 50% of the submitter's bond and pays it to the challenger, and the user's transaction reverts cleanly. Confirms the economic enforcement layer works.",
    },
    {
      id: 'silent',
      name: 'Silent relayer',
      icon: Power,
      desc: 'Submitter goes offline, handover triggers, 50% absence slash',
      color: 'amber' as const,
      proof:
        'The system survives relayer absence. When the assigned submitter fails to act within the handover period, the next relayer in rotation takes over, the original is slashed for absence, and the message is delivered. Confirms graceful degradation under failure.',
    },
    {
      id: 'spam',
      name: 'Frivolous challenge',
      icon: Gavel,
      desc: 'Challenger files baseless dispute, 25% deposit forfeited',
      color: 'orange' as const,
      proof:
        "The system protects honest relayers from harassment. When a baseless challenge is filed, the challenger's deposit is forfeited (25%) and the original transaction proceeds normally. Confirms challenge griefing is economically irrational.",
    },
  ];

  const colorMap = {
    emerald: { border: 'border-emerald-400/20', bg: 'bg-emerald-400/10', icon: 'text-emerald-400' },
    red: { border: 'border-red-400/20', bg: 'bg-red-400/10', icon: 'text-red-400' },
    amber: { border: 'border-amber-400/20', bg: 'bg-amber-400/10', icon: 'text-amber-400' },
    orange: { border: 'border-orange-400/20', bg: 'bg-orange-400/10', icon: 'text-orange-400' },
  };

  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-3">
        Demo scenarios
      </div>
      <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-6">
        What each test script proves.
      </h1>
      <p className="text-stone-400 mb-10 leading-relaxed">
        Tessera&apos;s demo control panel runs four hardcoded test scripts. Each script triggers
        a real on-testnet transaction with a specific behavior pattern, then exercises the
        system&apos;s response. These are also the basis of the integration test suite — they
        double as acceptance tests and demo material.
      </p>
      <div className="space-y-6">
        {scenarios.map((s) => {
          const Icon = s.icon;
          const c = colorMap[s.color];
          return (
            <Card key={s.id} className="p-6">
              <div className="flex items-start gap-4">
                <div
                  className={cn(
                    'w-12 h-12 rounded-md flex items-center justify-center shrink-0 border',
                    c.bg,
                    c.border,
                  )}
                >
                  <Icon size={20} className={c.icon} strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <h3 className="font-display text-2xl text-stone-100 mb-2">{s.name}</h3>
                  <p className="text-sm text-stone-400 mb-3">{s.desc}</p>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-2">
                    What this proves
                  </div>
                  <p className="text-sm text-stone-300 leading-relaxed">{s.proof}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Wallet setup & tUSDC claim guide ───────────────────────────────────────

function WalletsContent() {
  const NEW_TUSDC_NEUTRON = 'neutron1fw6unz7a9j4zf9gnvhup5qe6dlftytdc0y0rwyn3lyxdazz22rtsck0vld';
  const TUSDC_SEPOLIA = '0x7dcA285EFe722EdC1D9c93C3878fb58b255EC5B0';

  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-3">
        Wallet setup & tUSDC
      </div>
      <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-6">
        Get tUSDC, bridge it.
      </h1>
      <p className="text-stone-400 leading-relaxed mb-8">
        tUSDC is Tessera's testnet token. It is freely claimable (1 000 tUSDC per wallet every 24 hours)
        on both Sepolia and Neutron. You need both wallets connected to initiate a transfer.
      </p>

      <ProseSection label="1 — MetaMask (Sepolia)">
        <div className="space-y-3 text-stone-400 text-sm leading-relaxed">
          <p>
            <strong className="text-stone-200">Connect:</strong> Click &ldquo;Connect MetaMask&rdquo; on the homepage. Select Sepolia in your wallet.
          </p>
          <p>
            <strong className="text-stone-200">Claim tUSDC:</strong> After connecting, click the tUSDC balance pill or call{' '}
            <code className="bg-stone-950 px-1.5 py-0.5 rounded text-xs text-orange-400">claim()</code> on Etherscan.
            Each claim gives you 1 000 tUSDC (with 18 decimal places). Cooldown: 24 hours.
          </p>
          <p>
            <strong className="text-stone-200">Add tUSDC to MetaMask:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 pl-2 text-stone-500 text-xs font-mono">
            <li>Network: Sepolia</li>
            <li>Contract: <code className="text-stone-300">{TUSDC_SEPOLIA}</code></li>
            <li>Symbol: tUSDC</li>
            <li>Decimals: 18</li>
          </ul>
        </div>
      </ProseSection>

      <ProseSection label="2 — Keplr (Neutron pion-1)">
        <div className="space-y-3 text-stone-400 text-sm leading-relaxed">
          <p>
            <strong className="text-stone-200">Connect:</strong> Click &ldquo;Connect Keplr&rdquo; after MetaMask. Approve the
            Neutron Testnet chain suggestion if prompted.
          </p>
          <p>
            <strong className="text-stone-200">Claim tUSDC:</strong> Run the claim script once per wallet. Each claim gives
            1 000 tUSDC (1 000 000 000 base units at 6 decimals). Cooldown: 24 hours.
          </p>
          <p>
            <strong className="text-stone-200">Add tUSDC to Keplr:</strong> In Keplr, go to{' '}
            <em>Manage Tokens → Add Token</em> and enter:
          </p>
          <ul className="list-disc list-inside space-y-1 pl-2 text-stone-500 text-xs font-mono">
            <li>Chain: Neutron Testnet (pion-1)</li>
            <li>Contract: <code className="text-stone-300 break-all">{NEW_TUSDC_NEUTRON}</code></li>
          </ul>
          <p className="text-stone-500 text-xs">
            Keplr will auto-populate the name (Tessera USDC), symbol (tUSDC), and decimals (6) from
            the contract&apos;s <code className="bg-stone-950 px-1 rounded">token_info</code> query.
          </p>
        </div>
      </ProseSection>

      <ProseSection label="Claim sequence (all wallets)">
        <p className="text-stone-400 text-sm mb-3">
          During a fresh deployment or after a contract upgrade, claim in this order:
        </p>
        <CodeBlock>{`# 1. User wallet (you)
#    MetaMask: tUSDC.claim() via Etherscan or the Tessera UI
#    Keplr: tUSDC.Claim{} via Keplr or the claim script

# 2. Relayer A & B (pre-funded by the deployer)
node scripts/fund-all-neutron-v2.js   # funds all Neutron wallets in one pass

# 3. Sepolia relayer wallets (ERC20 transfer from deployer)
cast send $TUSDC "transfer(address,uint256)" $RELAYER_A 500000000000000000000 \\
  --private-key $DEPLOYER_KEY --rpc-url $SEPOLIA_RPC

# Verify
cast call $TUSDC "balanceOf(address)(uint256)" $USER_WALLET --rpc-url $SEPOLIA_RPC`}</CodeBlock>
      </ProseSection>

      <ProseSection label="Decimals reference">
        <ComparisonTable
          headers={['Chain', 'Token', 'Decimals', 'Example: 1000 tUSDC']}
          rows={[
            ['Sepolia (EVM)', 'tUSDC', '18', '1 000 000 000 000 000 000 000'],
            ['Neutron (CosmWasm)', 'tUSDC', '6', '1 000 000 000'],
          ]}
        />
        <p className="text-stone-500 text-xs mt-2">
          The bridge UI handles conversion automatically. The on-chain amount in the{' '}
          <em>Locked</em> event is always in wei (18 decimals); relayer transforms before submitting.
        </p>
      </ProseSection>
    </div>
  );
}

function RelayerContent() {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-3">
        Run a relayer
      </div>
      <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-6">
        Register, bond, run.
      </h1>
      <p className="text-stone-400 leading-relaxed mb-8">
        Any party can join the Tessera relayer set. Registration requires posting an initial bond
        on each chain. Once registered, the relayer participates in per-message role rotation —
        submitting proofs, watching other submissions, and challenging fraud.
      </p>
      <ProseSection label="Lifecycle">
        <CodeBlock>{`Register (post initial bond: 0.02 ETH / 80,000 uNTRN)
       ↓
Active — can submit and challenge
       ↓
[after one slash]
Benched — bond at operating threshold (50%)
→ cannot submit new messages
→ pending submissions still settle
→ can topUpBond() to return to Active
       ↓
[after second slash]
Deregistered — bond at deregistration threshold (25%)
→ fully removed from registry
→ 1-hour cooldown before re-registration`}</CodeBlock>
      </ProseSection>
      <ProseSection label="Bond thresholds (testnet)">
        <ComparisonTable
          headers={['Threshold', 'Sepolia', 'Neutron (uNTRN)', 'Meaning']}
          rows={[
            ['Initial bond', '0.02 ETH', '80,000 uNTRN', 'Required to join the registry'],
            ['Operating (50%)', '0.01 ETH', '40,000 uNTRN', 'Below this: no new submissions accepted'],
            ['Deregistration (25%)', '0.005 ETH', '20,000 uNTRN', 'Below this: fully removed from registry'],
          ]}
        />
        <p className="text-stone-500 text-xs mt-2">
          Testnet values are intentionally low due to faucet limits (~0.05 ETH/day Sepolia, ~2
          NTRN/day Neutron). Production values would be significantly higher.
        </p>
      </ProseSection>
      <ProseSection label="Role assignment">
        <p className="text-stone-400 leading-relaxed mb-4">
          Per-message role assignment is deterministic and on-chain:
        </p>
        <CodeBlock>{`assigned_index = (nonce + floor(elapsed_since_event / handover_period)) % registered_relayer_count

// handover_period = 30 seconds (testnet)
// With 2 relayers: message #1 → relayer[0] submits, message #2 → relayer[1] submits`}</CodeBlock>
        <p className="text-stone-400 text-sm leading-relaxed">
          If the assigned relayer doesn&apos;t act within 30 seconds, assignment rotates to the
          next. The original is slashed for absence. Every non-assigned relayer independently
          verifies and challenges if wrong.
        </p>
      </ProseSection>
    </div>
  );
}

function AddChainContent() {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-3">
        Add a chain
      </div>
      <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-6">
        One file, one new chain.
      </h1>
      <p className="text-stone-400 leading-relaxed mb-8">
        Tessera&apos;s plugin architecture means adding a new chain requires implementing a
        single Go interface. No existing code changes. No new contracts needed if the chain
        shares a VM with an existing deployment.
      </p>
      <ProseSection label="What to implement">
        <CodeBlock>{`// New file: relayer/plugins/your-chain/plugin.go

type YourChainPlugin struct {
    rpcURL   string
    chainID  string
}

// Implement all ChainPlugin interface methods:
// FetchBlockFingerprint, FetchProof, VerifyConsensus,
// TranslateProofTo, SubmitMessage, SubmitChallenge,
// SubscribeEvents, GetBondStatus`}</CodeBlock>
      </ProseSection>
      <ProseSection label="Checklist for a new chain">
        {[
          'Implement ChainPlugin interface in a new Go file',
          'Add chain to the relayer config schema',
          'Deploy the six contracts (existing Solidity or CosmWasm — no new code needed if same VM)',
          'Register both relayers with initial bonds on the new chain',
          'Add chain ID to the frontend chain config',
          'Write one fixture test for FetchProof + TranslateProofTo',
        ].map((step, i) => (
          <div
            key={i}
            className="flex items-start gap-3 py-2.5 border-b border-stone-800/50 last:border-b-0"
          >
            <span className="font-mono text-xs text-stone-500 shrink-0 mt-0.5">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="text-sm text-stone-300">{step}</span>
          </div>
        ))}
      </ProseSection>
      <ProseSection label="High-value candidates">
        <ComparisonTable
          headers={['Chain', 'Plugin type', 'Note']}
          rows={[
            ['Polygon', 'EthereumPlugin variant', 'Same EVM code; different chain ID'],
            ['Arbitrum', 'EthereumPlugin variant', 'Different L2 proof structure'],
            ['Osmosis', 'TendermintPlugin variant', 'CosmWasm-capable; Cosmos IBC neighbor'],
            ['Cosmos Hub', 'TendermintPlugin variant', 'Highest Cosmos TVL'],
          ]}
        />
      </ProseSection>
    </div>
  );
}

function RisksContent() {
  const risks = [
    {
      id: 'L-1',
      title: 'RPC Trust on Sepolia',
      impact: 'Low',
      impactColor: 'emerald',
      what: 'The relayer trusts the data returned by its configured Sepolia RPC node when verifying source events. If the RPC node lies about a block\'s state root, the relayer will relay a fraudulent message.',
      mitigation: 'Integrate sync committee verification in the EthereumPlugin. The relayer would fetch and verify a sync committee signature on the block header before trusting the state root. This is a pure off-chain Go change; no contract changes required.',
    },
    {
      id: 'L-2',
      title: 'Liveness Assumption',
      impact: 'Low',
      impactColor: 'emerald',
      what: 'The system is secure only if at least one honest, online relayer is in the registered set. If all registered relayers collude or go offline simultaneously, messages can be delayed or fraudulently relayed.',
      mitigation: 'As more independent relayers register, the probability of simultaneous collusion approaches zero. The bond threshold can be tuned upward to raise the cost of Sybil attacks.',
    },
    {
      id: 'L-3',
      title: 'Testnet Parameters',
      impact: 'High (if deployed as-is)',
      impactColor: 'amber',
      what: 'Bond thresholds (0.02 ETH / 80,000 uNTRN) and the challenge window (60s) are set for testnet conditions. Production deployments require significantly tighter parameters.',
      mitigation: 'Config change only. All slashing ratios and economic mechanisms are identical — only the absolute amounts change.',
    },
    {
      id: 'L-4',
      title: 'Neutron submissionId Parsing',
      impact: 'Low (single in-flight message)',
      impactColor: 'emerald',
      what: 'The Go relayer currently returns a zero [32]byte{} submissionId after a Neutron SubmitMessage call because it does not parse the MessageSubmitted event from the CosmWasm TxResponse.Events.',
      mitigation: 'Parse TxResponse.Events in the TendermintPlugin after broadcast, extract the submission_id attribute. Pure Go change; no contract changes.',
    },
  ];

  const impactColorMap: Record<string, string> = {
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
  };

  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-3">
        Limitations & risks
      </div>
      <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-6">
        Honest constraints.
      </h1>
      <p className="text-stone-400 leading-relaxed mb-8">
        Tessera is a hackathon build. These are the real constraints — not limitations to hide,
        but trade-offs made deliberately to ship a working system within the build window. Each
        has a clear mitigation path.
      </p>
      <div className="space-y-5">
        {risks.map((risk) => (
          <Card key={risk.id} className="p-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="font-mono text-xs text-stone-500 px-2 py-1 bg-stone-950 border border-stone-700 rounded">
                {risk.id}
              </span>
              <h3 className="text-stone-100 font-medium">{risk.title}</h3>
              <span
                className={cn('ml-auto font-mono text-xs', impactColorMap[risk.impactColor])}
              >
                {risk.impact}
              </span>
            </div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-1">
              What it means
            </div>
            <p className="text-sm text-stone-400 leading-relaxed mb-4">{risk.what}</p>
            <div className="text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-1">
              Mitigation path
            </div>
            <p className="text-sm text-stone-300 leading-relaxed">{risk.mitigation}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RoadmapContent() {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-3">
        Roadmap
      </div>
      <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-6">
        What comes next.
      </h1>
      <p className="text-stone-400 leading-relaxed mb-8">
        The architecture was designed for extension. Everything on this list is additive — none
        of it requires changing deployed contracts.
      </p>
      <ProseSection label="Near-term — production readiness">
        {[
          {
            title: 'Testnet → production parameters',
            body: 'Bond thresholds and windows to production values. Config change only.',
          },
          {
            title: 'Neutron submissionId parsing',
            body: 'Parse tessera.MessageSubmitted event after broadcast. Go change only.',
          },
          {
            title: 'Sync committee verification for Sepolia',
            body: 'Eliminate RPC trust. BLS aggregation in the EthereumPlugin.',
          },
          {
            title: 'Multi-region relayer deployment',
            body: 'Eliminate single point of liveness failure. On-call alerting for bond threshold breaches.',
          },
        ].map((item, i) => (
          <div key={i} className="flex gap-4 mb-4">
            <span className="font-mono text-xs text-stone-600 shrink-0 mt-0.5">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div>
              <div className="text-sm text-stone-200 font-medium mb-0.5">{item.title}</div>
              <p className="text-sm text-stone-400">{item.body}</p>
            </div>
          </div>
        ))}
      </ProseSection>
      <ProseSection label="Medium-term — expansion">
        <p className="text-stone-400 leading-relaxed mb-4">
          Additional chains (Polygon, Arbitrum, Osmosis, Cosmos Hub) as Go plugin modules. New
          applications (NFT bridges, cross-chain governance, cross-chain lending) by implementing
          IApp — no Verifier or relayer changes required.
        </p>
      </ProseSection>
      <ProseSection label="Long-term — research">
        {[
          {
            title: 'ZK option',
            body: 'The proof transformation step (Patricia ↔ IAVL) could be replaced by a ZK proof of correct transformation. Trade-off: proof generation requires dedicated hardware and adds minutes of latency. Current optimistic approach is faster for the same trust outcome.',
          },
          {
            title: 'Validator reward mechanism',
            body: 'Formalize the incentive model: honest submission earns reward, fraud earns punishment, punishment > maximum possible gain. Creates formally analyzed incentive-compatible mechanism where rational actors are honest by design.',
          },
        ].map((item, i) => (
          <div key={i} className="mb-5 p-4 bg-stone-950/60 border border-stone-800 rounded-sm">
            <div className="text-sm font-medium text-stone-100 mb-1.5">{item.title}</div>
            <p className="text-sm text-stone-400 leading-relaxed">{item.body}</p>
          </div>
        ))}
      </ProseSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content router
// ---------------------------------------------------------------------------

function DocContent({ section }: { section: SectionId }) {
  switch (section) {
    case 'overview': return <OverviewContent />;
    case 'what': return <WhatContent />;
    case 'how': return <HowContent />;
    case 'trust': return <TrustContent />;
    case 'crypto': return <CryptoContent />;
    case 'architecture': return <ArchitectureContent />;
    case 'scenarios': return <ScenariosContent />;
    case 'wallets': return <WalletsContent />;
    case 'relayer': return <RelayerContent />;
    case 'addchain': return <AddChainContent />;
    case 'risks': return <RisksContent />;
    case 'roadmap': return <RoadmapContent />;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DocsPage() {
  const [active, setActive] = useState<SectionId>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activeSection = DOC_SECTIONS.find((s) => s.id === active);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 lg:py-10">
      <div className="grid lg:grid-cols-[240px_1fr] gap-8 lg:gap-12">
        {/* Sidebar */}
        <aside className="lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)] lg:overflow-y-auto">
          {/* Mobile toggle */}
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="lg:hidden w-full flex items-center justify-between px-4 py-3 bg-stone-900 border border-stone-800 rounded-sm mb-4"
          >
            <span className="text-sm text-stone-200">
              {activeSection?.title ?? 'Sections'}
            </span>
            <ChevronDown
              size={14}
              className={cn('transition-transform text-stone-400', sidebarOpen && 'rotate-180')}
            />
          </button>

          {/* Sidebar nav */}
          <div className={cn(sidebarOpen ? 'block' : 'hidden lg:block', 'space-y-0.5')}>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-3 px-2">
              Documentation
            </div>
            {DOC_SECTIONS.map((s) => {
              const Icon = s.icon;
              const isActive = active === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    setActive(s.id);
                    setSidebarOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-2.5 py-2 text-sm rounded-sm transition group',
                    isActive
                      ? 'bg-orange-400/10 text-orange-300'
                      : 'text-stone-400 hover:bg-stone-900/60 hover:text-stone-200',
                  )}
                >
                  <Icon
                    size={14}
                    strokeWidth={1.5}
                    className={cn(
                      isActive
                        ? 'text-orange-400'
                        : 'text-stone-500 group-hover:text-stone-300',
                    )}
                  />
                  <span>{s.title}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Content area */}
        <main className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28 }}
            >
              <DocContent section={active} />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
