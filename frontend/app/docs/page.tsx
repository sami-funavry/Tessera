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
  Database,
  Wallet,
  Terminal,
  ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Card from '@/components/Card';
import SectionLabel from '@/components/SectionLabel';
import Mermaid from '@/components/Mermaid';
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
  | 'database'
  | 'scenarios'
  | 'wallets'
  | 'relayer'
  | 'addchain'
  | 'scripts'
  | 'risks'
  | 'roadmap';

interface DocSection {
  id: SectionId;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  title: string;
}

const DOC_SECTIONS: DocSection[] = [
  { id: 'overview', icon: Compass, title: 'Overview' },
  { id: 'what', icon: BookOpen, title: 'What it solves' },
  { id: 'how', icon: Workflow, title: 'How it works' },
  { id: 'trust', icon: ShieldCheck, title: 'Trust model' },
  { id: 'crypto', icon: Cpu, title: 'Cryptography' },
  { id: 'architecture', icon: Network, title: 'Architecture' },
  { id: 'database', icon: Database, title: 'State & database' },
  { id: 'scenarios', icon: Play, title: 'Demo scenarios' },
  { id: 'wallets', icon: Wallet, title: 'Wallet setup & tUSDC' },
  { id: 'relayer', icon: FileCog, title: 'Run a relayer' },
  { id: 'addchain', icon: Plus, title: 'Add a chain' },
  { id: 'scripts', icon: Terminal, title: 'Scripts & tests' },
  { id: 'risks', icon: AlertCircle, title: 'Limitations & risks' },
  { id: 'roadmap', icon: Map, title: 'Roadmap' },
];

// ---------------------------------------------------------------------------
// Notion link (Form-2 deliverable)
// ---------------------------------------------------------------------------

const NOTION_DOC_URL = 'https://www.notion.so/Tessera-35a23e3815fc81a08b60c8fd039ba123';

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
        Tessera moves assets and arbitrary messages between EVM and Cosmos chains without trusting
        any relay operator, running any ZK prover, or doing on-chain Ed25519 verification. This
        documentation walks the system from the user&apos;s wallet down to the Patricia↔IAVL byte
        manipulation that makes the whole thing work — and back up to the database powering the
        dashboard you&apos;re reading this in.
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
      <ProseSection label="System at a glance">
        <p className="text-stone-400 leading-relaxed mb-4">
          The reference application is a bidirectional{' '}
          <span className="text-stone-200 font-medium">tUSDC bridge</span> between Sepolia
          (Ethereum testnet) and Neutron (Cosmos / CosmWasm testnet). Two Go relayer instances
          observe both chains, transform proofs between Patricia and IAVL, and bond against fraud.
          The diagram below shows the resting state — every arrow is a real on-chain or off-chain
          call you can trace in the codebase.
        </p>
        <Mermaid
          caption="System topology. Both chains run an identical six-contract suite. The relayer is the only off-chain component; it never holds user funds."
          chart={`flowchart LR
    classDef chain fill:#0c0a09,stroke:#fb923c,stroke-width:1px,color:#e7e5e4
    classDef relayer fill:#1c1917,stroke:#57534e,color:#e7e5e4
    classDef contract fill:#0f0d0c,stroke:#44403c,color:#a8a29e

    subgraph SEP["Sepolia (EVM)"]
        SV["BridgeVault<br/>(lock/release)"]
        SR["Verifier"]
        ST["tUSDC ERC-20"]
        SB["Bond + Registry"]
    end

    subgraph REL["Go Relayer × 2"]
        EP["EthereumPlugin"]
        XF["transform layer<br/>Patricia ↔ IAVL"]
        TP["TendermintPlugin"]
        DB[("Supabase<br/>state/realtime")]
    end

    subgraph NEU["Neutron (CosmWasm)"]
        NV["Verifier"]
        NM["BridgeMint<br/>(mint/burn)"]
        NT["tUSDC CW20"]
        NB["Bond + Registry"]
    end

    SV -- Locked --> EP
    NM -- Burned --> TP
    EP <--> XF
    TP <--> XF
    EP -- submitMessage --> SR
    TP -- submitMessage --> NV
    SR --> SV
    NV --> NM
    EP --> DB
    TP --> DB

    class SEP,NEU chain
    class REL relayer
    class SV,SR,ST,SB,NV,NM,NT,NB contract`}
        />
      </ProseSection>
      <ProseSection label="External documentation">
        <a
          href={NOTION_DOC_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-3 bg-stone-950 border border-stone-800 rounded-sm hover:border-orange-400/40 hover:bg-stone-900/60 transition-colors text-sm text-stone-300"
        >
          <ExternalLink size={14} className="text-orange-400" strokeWidth={1.5} />
          <span>
            Open the full Notion documentation
            <span className="text-stone-500 ml-2 font-mono text-xs">
              tessera-35a23e3815fc81a08b60c8fd039ba123
            </span>
          </span>
        </a>
        <p className="text-xs text-stone-500 mt-3 leading-relaxed">
          The Notion document mirrors this in-app guide with additional PM brief, technical
          decisions, and post-hackathon roadmap. It is the canonical Form-2 hackathon submission
          doc; this in-app version is the operator-friendly subset.
        </p>
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
        proofs transformed into IAVL format. Neutron to Sepolia verifies Ed25519 off-chain in Go
        and then transforms IAVL to Patricia for the EVM verifier. The same bonded challenge
        mechanism protects both directions. Each diagram below is one full message lifecycle —
        the numbered ticks correspond to the calls in <code className="font-mono text-stone-300">relayer/internal/pipeline</code>.
      </p>

      <ProseSection label="Sepolia → Neutron">
        <Mermaid
          caption="Sepolia→Neutron sequence. Steps 3–5 are pure off-chain Go; only steps 6 and 8 hit Neutron."
          chart={`sequenceDiagram
    autonumber
    actor U as User
    participant SV as BridgeVault<br/>(Sepolia)
    participant R as Relayer<br/>(Go)
    participant NV as Verifier<br/>(Neutron)
    participant NM as BridgeMint<br/>(Neutron)

    U->>SV: lock(amount, recipient, dest)
    SV-->>R: Locked event
    Note over R: eth_getProof<br/>Patricia / Keccak-256 / RLP
    Note over R: VerifyConsensus<br/>(RPC trust — limitation L-1)
    Note over R: TranslateProofTo(Tendermint)<br/>deterministic — byte-identical replay
    R->>NV: submitMessage(envelope, root, IAVL proof)
    Note over NV: 60s challenge window<br/>any relayer can dispute
    NV->>NM: executeMessage → onCrossChainMessage
    NM-->>U: tUSDC minted (6 decimals)`}
        />
      </ProseSection>

      <ProseSection label="Neutron → Sepolia (Ed25519 bypass)">
        <Mermaid
          caption="Neutron→Sepolia sequence. Step 3 is the load-bearing piece: 2/3+ Ed25519 sigs are verified in Go before any EVM call. Sepolia never sees an Ed25519 signature."
          chart={`sequenceDiagram
    autonumber
    actor U as User
    participant NM as BridgeMint<br/>(Neutron)
    participant R as Relayer<br/>(Go)
    participant SR as Verifier<br/>(Sepolia)
    participant SV as BridgeVault<br/>(Sepolia)

    U->>NM: burn(amount, recipient)
    NM-->>R: Burned event
    Note over R: ABCI query<br/>IAVL / SHA-256 / Protobuf
    Note over R: VerifyConsensus<br/>cometbft.NewValidatorSet.VerifyCommit()<br/>2/3+ Ed25519 sigs validated in Go
    Note over R: TranslateProofTo(EVM)<br/>IAVL → Patricia (deterministic)
    R->>SR: submitMessage(envelope, root, Patricia proof)
    Note over SR: 60s challenge window<br/>EVM walks Patricia (Keccak-256)
    SR->>SV: executeMessage → onCrossChainMessage
    SV-->>U: tUSDC released (18 decimals)`}
        />
      </ProseSection>

      <ProseSection label="Why two pipelines, not one">
        <p className="text-stone-400 leading-relaxed">
          Each chain has its own native proof format and its own consensus to verify. Forcing one
          chain to understand the other&apos;s format would either require generic ZK circuits
          (expensive, slow) or a brittle stateless light client. Instead, the relayer does the
          work in commodity Go: it reads in the source format, transforms deterministically into
          the destination format, and submits. The destination chain only ever needs to
          understand its <em>own</em> proof format.
        </p>
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
        <Mermaid
          caption="Trust layers per message. Three are cryptographic, one is RPC-trust (documented L-1), one is economic. Liveness assumes ≥1 honest relayer."
          chart={`flowchart TB
    M["one cross-chain message"]
    M --> L1["Source consensus: Neutron"]
    M --> L2["Source consensus: Sepolia"]
    M --> L3["Proof transformation"]
    M --> L4["Destination verification"]
    M --> L5["Economic enforcement"]
    L1 --> L1V["✓ cryptographic<br/>2/3+ Ed25519 verified off-chain"]
    L2 --> L2V["⚠ RPC trust (L-1)<br/>future: sync committee"]
    L3 --> L3V["✓ deterministic<br/>any party can replay → fraud detectable"]
    L4 --> L4V["✓ trustless<br/>native Merkle walk on destination"]
    L5 --> L5V["✓ punishment > gain<br/>50% slash on bad submission"]

    classDef ok fill:#0c0a09,stroke:#10b981,color:#86efac
    classDef warn fill:#0c0a09,stroke:#f59e0b,color:#fcd34d
    class L1V,L3V,L4V,L5V ok
    class L2V warn`}
        />
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
        different data structures for their state proofs, and use different hash functions to
        anchor them. The transformation layer bridges them deterministically — without requiring
        either chain to understand the other&apos;s format and without a trusted oracle. This
        section walks through every cryptographic primitive in the system, what it commits to,
        and how each piece is verified.
      </p>

      <ProseSection label="The four cryptographic primitives in play">
        <ComparisonTable
          headers={['Primitive', 'Used by', 'Where verified', 'Why it matters']}
          rows={[
            [
              <span key="kw" className="font-mono text-stone-200">Keccak-256</span>,
              'Ethereum (Patricia node hashing)',
              <span key="kwv" className="text-stone-300">On-chain in Solidity Verifier (~36 gas/byte)</span>,
              'Anchors Ethereum state root',
            ],
            [
              <span key="sw" className="font-mono text-stone-200">SHA-256</span>,
              'Cosmos (IAVL node hashing, Tendermint hashing)',
              <span key="swv" className="text-stone-300">On-chain in CosmWasm Verifier (precompile)</span>,
              'Anchors Tendermint app state root',
            ],
            [
              <span key="rw" className="font-mono text-stone-200">RLP</span>,
              'Ethereum (proof node encoding)',
              <span key="rwv" className="text-stone-300">Solidity Verifier walks Patricia nodes</span>,
              'Deterministic byte encoding for Patricia',
            ],
            [
              <span key="ew" className="font-mono text-stone-200">Ed25519</span>,
              'Tendermint (block validator signatures)',
              <span key="ewv" className="text-amber-300">Off-chain in Go (verify-then-bypass)</span>,
              'EVM cost for on-chain Ed25519: prohibitive',
            ],
          ]}
        />
      </ProseSection>

      <ProseSection label="Patricia Merkle Trie — Ethereum side">
        <p className="text-stone-400 leading-relaxed mb-4">
          Ethereum state is stored in a Modified Merkle Patricia Trie. Proofs are a sequence of
          RLP-encoded nodes — Branch (16 children + value), Extension (compressed nibble path),
          and Leaf (terminal value). Every node is hashed with Keccak-256. The root is committed
          in each block header.
        </p>
        <Mermaid
          caption="Patricia proof structure. The verifier walks the path from leaf to root, hashing each step with Keccak-256, and asserts the final hash equals the on-chain block.stateRoot."
          chart={`flowchart TD
    R["block.stateRoot<br/>(in Sepolia block header)"]
    R --> A["account proof (Patricia)<br/>RLP nodes, Keccak-256"]
    A --> AccLeaf["Account leaf<br/>balance | nonce | codeHash | storageRoot"]
    AccLeaf --> SR["account.storageRoot"]
    SR --> S["storage proof (Patricia)<br/>RLP nodes, Keccak-256"]
    S --> SLeaf["Storage leaf<br/>(slot, value)"]

    classDef hdr fill:#0c0a09,stroke:#fb923c,color:#e7e5e4
    classDef leaf fill:#1c1917,stroke:#57534e,color:#e7e5e4
    class R,AccLeaf,SLeaf hdr
    class A,SR,S leaf`}
        />
      </ProseSection>

      <ProseSection label="IAVL Tree — Cosmos side">
        <p className="text-stone-400 leading-relaxed mb-4">
          Cosmos chains use an IAVL+ tree (a self-balancing AVL Merkle tree) for module-store
          proofs. Nodes are encoded with Protobuf and hashed with SHA-256. The IAVL root is
          included in the Tendermint commit hash, which is signed by the validator set.
        </p>
        <Mermaid
          caption="IAVL proof structure. The verifier reconstructs the path from leaf to root, hashing with SHA-256, and asserts the final hash matches the AppHash committed in the block."
          chart={`flowchart TD
    H["block.AppHash<br/>(in Tendermint header)"]
    H --> M["multi-store commit hash<br/>SHA-256"]
    M --> S["wasm module store root<br/>SHA-256"]
    S --> I["IAVL inner nodes<br/>(Protobuf)"]
    I --> L["IAVL leaf<br/>(key, value)"]

    classDef hdr fill:#0c0a09,stroke:#fb923c,color:#e7e5e4
    classDef leaf fill:#1c1917,stroke:#57534e,color:#e7e5e4
    class H,L hdr
    class M,S,I leaf`}
        />
      </ProseSection>

      <ProseSection label="Deterministic transformation — the byte-identity claim">
        <p className="text-stone-400 leading-relaxed mb-4">
          The transformation between Patricia and IAVL is a <em>pure function of the input proof
          and the input fingerprint</em>. The same input always produces the same output
          byte-for-byte — a property called <span className="text-stone-200">determinism</span>.
          This is the load-bearing security claim: it&apos;s what makes fraud detectable.
        </p>
        <Mermaid
          caption="Transformation pipeline. The relayer parses the source proof into a chain-neutral canonical AST, then re-encodes it for the target. Any party can replay this — that's the security property."
          chart={`flowchart LR
    SP["source proof<br/>e.g. Patricia / RLP / Keccak-256"]
    PARSE["parse → canonical AST<br/>(no hash function)"]
    BUILD["re-encode → target format<br/>e.g. IAVL / Protobuf / SHA-256"]
    DP["destination proof<br/>+ transformedRoot"]
    SP --> PARSE
    PARSE --> BUILD
    BUILD --> DP

    CHK["challenger replays<br/>same input → same bytes"]
    SP -.->|same input| CHK
    DP -.->|byte-equal| CHK

    classDef ok fill:#0c0a09,stroke:#10b981,color:#86efac
    class CHK ok`}
        />
        <p className="text-stone-400 leading-relaxed mb-4">
          The acceptance test for the transform layer is exactly this: 100 independent runs on
          the same input produce 100 byte-identical outputs. The test fixture lives in{' '}
          <code className="font-mono text-stone-300 text-xs">relayer/internal/transform/transform_test.go</code>{' '}
          (35 fixtures, including cross-implementation parity at 100×).
        </p>
        <div className="p-4 bg-orange-400/5 border border-orange-400/20 rounded-sm text-sm text-stone-300 mb-4">
          Both proofs commit to the same logical claim:{' '}
          <span className="font-mono text-orange-300">
            &ldquo;Vault contract storage slot 0x4 has value 100,000,000 at block N&rdquo;
          </span>{' '}
          — anchored differently for each chain&apos;s native verification path.
        </div>
        <div className="text-stone-400 text-sm leading-relaxed mb-2">
          <span className="text-stone-200 font-medium">Why this enables challenge:</span> the
          submitter posts <code className="font-mono text-stone-300">(envelope, transformedRoot, destinationProof)</code>.
          Any other relayer can fetch the source proof, re-run the transform, and check whether
          the submitter&apos;s <code className="font-mono text-stone-300">transformedRoot</code>{' '}
          matches. If it does, the submission stands. If it doesn&apos;t, anyone can call{' '}
          <code className="font-mono text-stone-300">challenge(...)</code> with the correct
          fingerprint and slash 50% of the submitter&apos;s bond.
        </div>
      </ProseSection>

      <ProseSection label="Ed25519 bypass — the off-chain verification path">
        <p className="text-stone-400 leading-relaxed mb-4">
          Tendermint validators sign block commits with Ed25519. Verifying one Ed25519 signature
          on the EVM costs roughly 500k gas; verifying 2/3+ of a typical Cosmos validator set
          (Neutron pion-1 runs dozens; Cosmos Hub mainnet runs ~150) is not economically viable.
          Tessera sidesteps this by verifying the entire validator set off-chain in Go, using the
          production cometbft library, before submitting anything to Sepolia.
        </p>
        <Mermaid
          caption="Ed25519 bypass. The Go relayer is the only place Ed25519 is touched. Sepolia only ever sees Patricia (Keccak-256) — a primitive its precompile already supports."
          chart={`sequenceDiagram
    autonumber
    participant TM as Tendermint block<br/>(Neutron)
    participant R as Go Relayer<br/>(off-chain)
    participant SR as Verifier<br/>(Sepolia)

    TM->>R: header + commit + ValidatorSet
    Note over R: cometbft.NewValidatorSet(vals)<br/>.VerifyCommit(chainID, blockID, height, commit)
    Note over R: validates ≥ 2/3 voting-power Ed25519 signatures
    alt all sigs valid
        R->>R: TranslateProofTo(EVM) — IAVL → Patricia
        R->>SR: submitMessage(envelope, transformedRoot, Patricia proof)
        Note over SR: walks Patricia with Keccak-256<br/>NEVER touches Ed25519
    else any sig invalid
        R-->>R: drop submission
    end`}
        />
        <p className="text-stone-400 leading-relaxed mb-4">
          The hostile-input test for this lives in{' '}
          <code className="font-mono text-stone-300 text-xs">relayer/plugins/tendermint/plugin_test.go</code>{' '}
          (function <code className="font-mono text-stone-300 text-xs">TestVerifyConsensusUnit</code>):
          a forged signature reordered to the exact slot a legitimate validator occupies is{' '}
          <em>still rejected</em> because cometbft&apos;s{' '}
          <code className="font-mono text-stone-300 text-xs">NewValidatorSet</code> sorts by
          (voting power desc, address asc) before <code className="font-mono text-stone-300 text-xs">VerifyCommit</code>{' '}
          runs. This is the subtle bug class the test prevents.
        </p>
      </ProseSection>

      <ProseSection label="Message ID derivation">
        <p className="text-stone-400 leading-relaxed mb-4">
          Every cross-chain message has a stable ID — the{' '}
          <code className="font-mono text-stone-300">msgId</code> — that&apos;s the same on both
          chains. It&apos;s derived from the canonical envelope so that <em>both</em> chains
          compute the identical 32-byte ID without any cross-chain lookup. The Solidity Verifier
          and the CosmWasm Verifier each compute it independently and check equality on
          execution.
        </p>
        <CodeBlock>{`msgId = keccak256(
    abi.encode(
        envelope.sourceChainId,
        envelope.sourceApp,
        envelope.destinationChainId,
        envelope.destinationApp,
        envelope.action,
        envelope.payload,
        envelope.nonce
    )
)

// Sepolia: Verifier._envelopeHash() — same encoding
// Neutron: cosmwasm verifier::msg_id() — same encoding
// Test:    relayer/internal/transform/transform_test.go
//          (TestVerify_WrongMsgID + cross-impl parity fixtures)`}</CodeBlock>
        <p className="text-stone-400 text-sm leading-relaxed">
          The nonce is monotonic per (sourceChain, sourceApp), preventing replay across messages.
          Replay against a different destinationApp is impossible: the destinationApp field is
          inside the hash. Replay across chains is impossible: chain IDs are inside the hash.
        </p>
      </ProseSection>

      <ProseSection label="Verification claim — what we actually prove">
        <div className="space-y-3 text-sm text-stone-300 leading-relaxed">
          <div className="flex gap-3 items-start">
            <span className="text-orange-400 font-mono shrink-0">1.</span>
            <div>
              <span className="text-stone-200 font-medium">Source-event integrity.</span>{' '}
              The destination chain only executes a message after Merkle-walking a proof against
              its own native commitment. If the source event didn&apos;t happen, the proof
              doesn&apos;t exist and the walk fails.
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-orange-400 font-mono shrink-0">2.</span>
            <div>
              <span className="text-stone-200 font-medium">Validator-set authenticity (Cosmos→EVM).</span>{' '}
              The Go relayer verifies 2/3+ of the validator set signed the block before the
              relayer is willing to vouch for the source root. Forged or reordered signatures are
              rejected by cometbft&apos;s reference VerifyCommit.
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-orange-400 font-mono shrink-0">3.</span>
            <div>
              <span className="text-stone-200 font-medium">Transform integrity.</span>{' '}
              Determinism makes the transform a verifiable computation: any honest relayer can
              re-run it and reach byte-identical output. A wrong{' '}
              <code className="font-mono">transformedRoot</code> is a publicly slashable event.
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-orange-400 font-mono shrink-0">4.</span>
            <div>
              <span className="text-stone-200 font-medium">Replay resistance.</span>{' '}
              The msgId binds chain IDs, app addresses, action selector, payload, and nonce.
              The Verifier rejects an already-executed msgId. Cross-chain and within-chain replay
              both fail.
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-amber-400 font-mono shrink-0">5.</span>
            <div>
              <span className="text-stone-200 font-medium">Source consensus on Sepolia (limitation L-1).</span>{' '}
              For Sepolia→Neutron, the relayer trusts its configured Sepolia RPC. Mitigation:
              integrate sync committee verification (Beacon BLS aggregation). Pure off-chain Go
              change; documented in the roadmap.
            </div>
          </div>
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
        — deployed code differs, logic is the same. Below: the per-process layout of the relayer
        and which goroutines own which responsibility.
      </p>
      <ProseSection label="Relayer process layout">
        <Mermaid
          caption="One relayer process. The plugin layer is the only thing that knows about chain-specific RPC; everything else is chain-neutral."
          chart={`flowchart TB
    subgraph PROC["one relayer process (Go)"]
        D["cmd/tessera daemon"]
        OBS["chain observers<br/>per chain · goroutine"]
        Q["submission queue<br/>(in-memory + DB)"]
        XF["transform engine<br/>Patricia ↔ IAVL"]
        SUB["submitter goroutine"]
        WATCH["watcher goroutine<br/>(challenge logic)"]
        BNDM["bond monitor<br/>(threshold alerts)"]
        SUP["supabase sync<br/>(state + benchmarks)"]
    end

    subgraph PLUGINS["chain plugins (replaceable)"]
        EP["EthereumPlugin<br/>go-ethereum"]
        TP["TendermintPlugin<br/>cometbft"]
    end

    D --> OBS
    OBS --> EP
    OBS --> TP
    OBS --> Q
    Q --> XF
    XF --> SUB
    SUB --> EP
    SUB --> TP
    OBS --> WATCH
    WATCH --> SUB
    SUB --> SUP
    WATCH --> SUP
    BNDM --> SUP
    EP --> BNDM
    TP --> BNDM`}
        />
      </ProseSection>
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
        <CodeBlock>{`// relayer/internal/chain/plugin.go
type Plugin interface {
    ChainID() string
    LatestBlock(ctx context.Context) (uint64, error)
    FetchBlockFingerprint(ctx context.Context, height uint64) (Fingerprint, error)
    FetchProof(ctx context.Context, event Event, height uint64) (Proof, error)
    VerifyConsensus(ctx context.Context, height uint64) error
    SubscribeEvents(ctx context.Context, fromBlock uint64) (<-chan Event, error)
    TranslateProofTo(proof Proof, destChainID string) (Proof, error)

    SubmitMessage(ctx context.Context, env MessageEnvelope, proof Proof) (txHash string, submissionID [32]byte, err error)
    ExecuteMessage(ctx context.Context, submissionID [32]byte, proof Proof) (string, error)
    SubmitChallenge(ctx context.Context, submissionID [32]byte, counterProof Proof) (string, error)
    ClaimAbsenceSlash(ctx context.Context, submissionID [32]byte) (string, error)

    Register(ctx context.Context, pubKeyBytes []byte) (string, error)
    DepositBond(ctx context.Context, amount string) (string, error)
}`}</CodeBlock>
        <p className="text-stone-400 text-sm leading-relaxed">
          Adding a new source chain means implementing this interface in one Go file. Nothing
          else in the repository changes. This is the verbatim signature in{' '}
          <code className="font-mono text-stone-300 text-xs">relayer/internal/chain/plugin.go</code>.
        </p>
      </ProseSection>
    </div>
  );
}

function DatabaseContent() {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-3">
        State &amp; database
      </div>
      <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-6">
        Where state lives.
      </h1>
      <p className="text-stone-400 leading-relaxed mb-8">
        Tessera has two state stores, with a strict separation of concerns. <strong className="text-stone-200">On-chain</strong>{' '}
        contracts hold the authoritative state — bonds, submission status, executed msgIds.{' '}
        <strong className="text-stone-200">Supabase</strong> is the operator-facing mirror used
        by the dashboard, indexed off chain events, and never relied on for security decisions.
        If Supabase disappears, the bridge keeps working. If a chain disappears, that direction
        stalls — exactly as you&apos;d want.
      </p>

      <ProseSection label="Entity-relationship diagram (Supabase)">
        <Mermaid
          caption="Six tables. messages is the parent; submissions and benchmark_runs hang off it. disputes hang off submissions. bonds and events are independent of any specific message."
          chart={`erDiagram
    messages ||--o{ submissions : "has"
    messages ||--o| benchmark_runs : "measured by"
    submissions ||--o{ disputes : "may be challenged by"

    messages {
        bigserial id PK
        bigint nonce
        text source_chain_id
        text source_app
        text destination_chain_id
        text destination_app
        text action
        bytea payload
        text sender
        text recipient
        numeric amount
        text source_tx_hash
        bigint source_block
        text status
    }
    submissions {
        bigserial id PK
        bigint message_id FK
        text submitter_address
        text fingerprint
        text dest_tx_hash
        text status
    }
    disputes {
        bigserial id PK
        bigint submission_id FK
        text challenger_address
        text correct_fingerprint
        text outcome
    }
    bonds {
        bigserial id PK
        text relayer_address
        text chain_id
        numeric balance
        text threshold_status
    }
    events {
        bigserial id PK
        text chain_id
        bigint block_number
        text tx_hash
        text event_type
        jsonb raw_data
    }
    benchmark_runs {
        bigserial id PK
        bigint message_id FK
        text direction
        bigint total_latency_ms
        bigint source_gas_used
        bigint dest_gas_used
        bigint proof_transform_ms
    }`}
        />
      </ProseSection>

      <ProseSection label="Tables">
        <ComparisonTable
          headers={['Table', 'Granularity', 'Purpose']}
          rows={[
            ['messages', 'one row / cross-chain message', 'Lifecycle FSM — pending → submitted → challenge_window → executed | reverted'],
            ['submissions', 'one row / relayer attempt', 'Tracks who submitted, what fingerprint, and dest tx outcome'],
            ['disputes', 'one row / challenge filed', 'Outcome: upheld (submitter slashed) or rejected (challenger slashed)'],
            ['bonds', 'one row / relayer / chain', 'Periodically synced from on-chain Bond contract; powers dashboard'],
            ['events', 'one row / raw chain event', 'Source-of-truth for the live dashboard event log; deduplicated by (chain_id, tx_hash, event_type)'],
            ['benchmark_runs', 'one row / completed message', 'Per-direction latency + gas; powers the benchmark page'],
          ]}
        />
      </ProseSection>

      <ProseSection label="Message status FSM">
        <p className="text-stone-400 leading-relaxed mb-4">
          The <code className="font-mono text-stone-300">messages.status</code> column is a finite
          state machine driven by chain events. The relayer only writes from a small set of
          allowed transitions — these are enforced in code (<code className="font-mono text-stone-300 text-xs">relayer/internal/state/transitions.go</code>),
          not by the database, because the database is a mirror, not the authority.
        </p>
        <Mermaid
          caption="messages.status FSM. Only two terminal states: executed (success) and reverted (challenge upheld). Both clear the challenge window for downstream consumers."
          chart={`stateDiagram-v2
    [*] --> pending: source event observed
    pending --> submitted: relayer submits
    submitted --> challenge_window: included on dest
    challenge_window --> executed: 60s expires<br/>uncontested
    challenge_window --> challenged: challenge filed
    challenged --> reverted: challenge upheld<br/>submitter -50%
    challenged --> executed: challenge rejected<br/>challenger -25%
    executed --> [*]
    reverted --> [*]`}
        />
      </ProseSection>

      <ProseSection label="Why two state stores">
        <ComparisonTable
          headers={['Question', 'Answer']}
          rows={[
            [
              'Where is the authoritative bond balance?',
              <span key="b1" className="text-stone-300">On chain. The <code className="font-mono">bonds</code> Supabase table is a periodically-synced cache.</span>,
            ],
            [
              'Where is the authoritative msgId-executed flag?',
              <span key="b2" className="text-stone-300">On chain. The Verifier rejects a duplicate msgId regardless of what Supabase says.</span>,
            ],
            [
              'What if Supabase is wrong?',
              <span key="b3" className="text-stone-300">The dashboard shows stale data; the bridge still works. Operator backfill replays events.</span>,
            ],
            [
              'What if the chain RPC is wrong?',
              <span key="b4" className="text-stone-300">L-1 limitation. Future work: sync committee for Sepolia.</span>,
            ],
          ]}
        />
      </ProseSection>

      <ProseSection label="Realtime + RLS">
        <p className="text-stone-400 leading-relaxed mb-4">
          The frontend subscribes to <code className="font-mono text-stone-300">messages</code>,{' '}
          <code className="font-mono text-stone-300">submissions</code>,{' '}
          <code className="font-mono text-stone-300">disputes</code>, and{' '}
          <code className="font-mono text-stone-300">events</code> via Supabase realtime
          (Postgres logical replication). All six tables are RLS-enabled with{' '}
          <code className="font-mono text-stone-300">SELECT</code> public; writes require the
          service-role key, which only the relayer holds.
        </p>
        <CodeBlock>{`-- supabase/migrations/001_initial_schema.sql
ALTER TABLE messages    ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read messages" ON messages FOR SELECT USING (true);
-- Writes: service-role key only (relayer)

ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE submissions;
ALTER PUBLICATION supabase_realtime ADD TABLE disputes;
ALTER PUBLICATION supabase_realtime ADD TABLE events;`}</CodeBlock>
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
        tUSDC is Tessera&apos;s testnet token. It is freely claimable (1 000 tUSDC per wallet every 24 hours)
        on both Sepolia and Neutron. You need both wallets connected to initiate a transfer.
      </p>

      <ProseSection label="End-to-end flow">
        <Mermaid
          caption="Wallet → claim → bridge. The two claim steps are independent; you can do them in parallel. The bridge submission requires the source-chain wallet only — the destination is the recipient address, not a signer."
          chart={`sequenceDiagram
    autonumber
    actor U as User
    participant FE as Tessera UI
    participant MM as MetaMask
    participant K as Keplr
    participant SEP as Sepolia
    participant R as Relayer
    participant NEU as Neutron

    U->>FE: open homepage
    U->>MM: connect (Sepolia)
    MM-->>FE: address
    U->>K: connect (pion-1)
    K-->>FE: address

    Note over U,SEP: Claim tUSDC (out-of-widget)<br/>Sepolia: Etherscan Write tab → claim()<br/>Neutron: scripts/claim-neutron-tusdc.js
    SEP-->>MM: 1 000 tUSDC (18 dec)
    NEU-->>K: 1 000 tUSDC (6 dec)

    U->>FE: bridge X tUSDC, Sepolia → Neutron
    FE->>MM: tUSDC.approve(BridgeVault, max) — first time only
    FE->>MM: BridgeVault.lock(amount, recipient)
    MM->>SEP: signed tx
    SEP-->>R: Locked event
    Note over R: fetch + transform proof + submit
    R->>NEU: Verifier.submitMessage(...)
    Note over NEU: 60s window, then BridgeMint.mint()
    NEU-->>K: tUSDC arrives`}
        />
      </ProseSection>

      <ProseSection label="1 — MetaMask (Sepolia)">
        <div className="space-y-3 text-stone-400 text-sm leading-relaxed">
          <p>
            <strong className="text-stone-200">Connect:</strong> Click &ldquo;Connect MetaMask&rdquo; on the homepage. Select Sepolia in your wallet.
          </p>
          <p>
            <strong className="text-stone-200">Claim tUSDC:</strong> The bridge widget does not include a claim button — the on-page tUSDC balance is read-only display. To mint, call{' '}
            <code className="bg-stone-950 px-1.5 py-0.5 rounded text-xs text-orange-400">claim()</code> on the tUSDC contract directly via Etherscan&apos;s <em>Write Contract</em> tab, or via{' '}
            <code className="bg-stone-950 px-1.5 py-0.5 rounded text-xs text-stone-300">cast send</code>. Each claim gives 1 000 tUSDC (18 decimals). Cooldown: 24 hours.
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
        <Mermaid
          caption="Relayer lifecycle. Each state transition is an on-chain event in the RelayerRegistry — no off-chain coordination needed."
          chart={`stateDiagram-v2
    [*] --> Active: register +<br/>initial bond
    Active --> Active: submit /<br/>challenge / cycle
    Active --> Benched: bond < 50%<br/>(after slash)
    Benched --> Active: topUpBond()
    Benched --> Deregistered: bond < 25%<br/>(after 2nd slash)
    Deregistered --> [*]: 1h cooldown<br/>then re-register`}
        />
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
          Per-message role assignment is deterministic and on-chain. Both relayers compute the
          same answer from public inputs, so there&apos;s no coordination protocol — just math.
        </p>
        <Mermaid
          caption="Role-assignment formula. Inputs are all on chain; output is the relayer index that should submit at this moment."
          chart={`flowchart LR
    NONCE["nonce<br/>(envelope field)"] --> SUM
    EL["elapsed since event<br/>(now − sourceBlockTime)"] --> DIV["÷ handover_period<br/>(30s testnet)"]
    DIV --> SUM["+"]
    SUM --> MOD["mod registered_count"]
    MOD --> AI["assigned index"]

    classDef in fill:#0c0a09,stroke:#fb923c,color:#e7e5e4
    classDef out fill:#0c0a09,stroke:#10b981,color:#86efac
    class NONCE,EL in
    class AI out`}
        />
        <p className="text-stone-400 text-sm leading-relaxed">
          If the assigned relayer doesn&apos;t act within 30 seconds, the assignment rotates to
          the next index. The original is slashed for absence (S-3 demo scenario). Every
          non-assigned relayer independently verifies and challenges if wrong (S-2 demo).
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
      <ProseSection label="Plugin pattern">
        <Mermaid
          caption="The chain-plugin boundary. Everything inside the dashed box is chain-neutral and reused across chains. A new chain only requires implementing the plugin interface."
          chart={`flowchart TB
    subgraph CORE["Tessera relayer core (chain-neutral)"]
        DAEMON["daemon · rotation · queue · retry"]
        XF["transform engine<br/>Patricia ↔ IAVL ↔ canonical AST"]
        BOND["bond CLI"]
        STATE["Supabase state sync"]
    end

    EP["EthereumPlugin<br/>(go-ethereum)"]
    TP["TendermintPlugin<br/>(cometbft)"]
    NEW["YourChainPlugin<br/>← plug in here"]

    EP -->|implements ChainPlugin| CORE
    TP -->|implements ChainPlugin| CORE
    NEW -. plug in .-> CORE

    classDef new stroke-dasharray: 4 4,stroke:#fb923c,color:#fb923c
    class NEW new`}
        />
      </ProseSection>
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

function ScriptsContent() {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-3">
        Scripts &amp; tests
      </div>
      <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-6">
        Every script, what it does.
      </h1>
      <p className="text-stone-400 leading-relaxed mb-8">
        Tessera ships with three families of scripts: <strong className="text-stone-200">tests</strong>{' '}
        (CI gates), <strong className="text-stone-200">deploys</strong> (one-shot, idempotent),
        and <strong className="text-stone-200">scenarios</strong> (the four hackathon demos).
        Every file in this section is real and pinned to its path; CI runs the test commands on
        every push.
      </p>

      <ProseSection label="Test commands">
        <ComparisonTable
          headers={['Layer', 'Command', 'What it covers']}
          rows={[
            [
              <code key="t1" className="font-mono text-xs">cd contracts-evm && forge test</code>,
              <span key="t1c" className="font-mono text-xs">88 tests</span>,
              'Solidity contracts: unit + integration + scenarios + proof verification fixtures',
            ],
            [
              <code key="t2" className="font-mono text-xs">cd contracts-evm && forge coverage</code>,
              <span key="t2c" className="font-mono text-xs">~91% line coverage</span>,
              'Coverage report; gating value pre-merge',
            ],
            [
              <code key="t3" className="font-mono text-xs">cd contracts-cosmwasm && cargo test --workspace</code>,
              <span key="t3c" className="font-mono text-xs">full workspace</span>,
              'CosmWasm contracts via cw-multi-test, including the four demo scenarios',
            ],
            [
              <code key="t4" className="font-mono text-xs">cd contracts-cosmwasm && cargo clippy -- -D warnings</code>,
              <span key="t4c" className="font-mono text-xs">zero warnings</span>,
              'Lint gate',
            ],
            [
              <code key="t5" className="font-mono text-xs">cd relayer && go test -race ./...</code>,
              <span key="t5c" className="font-mono text-xs">all packages</span>,
              'Includes 100× determinism tests on transform layer + Ed25519 forgery test',
            ],
          ]}
        />
      </ProseSection>

      <ProseSection label="Test file map">
        <ComparisonTable
          headers={['File', 'What it tests']}
          rows={[
            [
              <code key="f1" className="font-mono text-xs">contracts-evm/test/unit/Verifier.t.sol</code>,
              'submitMessage / challenge / executeMessage state machine; custom errors; access control',
            ],
            [
              <code key="f2" className="font-mono text-xs">contracts-evm/test/unit/Bond.t.sol</code>,
              'deposit / slash / withdraw; threshold ladder (50% / 25%); CEI compliance',
            ],
            [
              <code key="f3" className="font-mono text-xs">contracts-evm/test/integration/VerifierProof.t.sol</code>,
              'Real proof bytes (TesseraProof wire format); flags=0 accept, flags=1 reject',
            ],
            [
              <code key="f4" className="font-mono text-xs">contracts-evm/test/integration/BridgeScenarios.t.sol</code>,
              'S-1 through S-4 end-to-end on a forked Foundry harness',
            ],
            [
              <code key="f5" className="font-mono text-xs">contracts-cosmwasm/contracts/verifier/src/tests/scenarios.rs</code>,
              'CosmWasm side of the four scenarios (mirror of Solidity)',
            ],
            [
              <code key="f6" className="font-mono text-xs">relayer/internal/transform/transform_test.go</code>,
              '35 fixtures · cross-impl parity · 100× byte-identical determinism · msgId derivation',
            ],
            [
              <code key="f7" className="font-mono text-xs">relayer/plugins/tendermint/plugin_test.go</code>,
              'Ed25519 verify-then-bypass; forged signature reordered to legitimate slot — still rejected',
            ],
            [
              <code key="f8" className="font-mono text-xs">relayer/internal/scenario/runner_test.go</code>,
              'In-process scenario runner used by `go run ./cmd/tessera test-scenario [1..4]`',
            ],
          ]}
        />
      </ProseSection>

      <ProseSection label="Deployment scripts">
        <ComparisonTable
          headers={['Script', 'Chain', 'Purpose']}
          rows={[
            [
              <code key="d1" className="font-mono text-xs">contracts-evm/script/Deploy.s.sol</code>,
              'Sepolia',
              'Foundry script — deploys all 6 EVM contracts with circular-dep break (Verifier setVerifier)',
            ],
            [
              <code key="d2" className="font-mono text-xs">scripts/deploy/sepolia.sh</code>,
              'Sepolia',
              'Wrapper that runs Deploy.s.sol with broadcast + verifies on Etherscan',
            ],
            [
              <code key="d3" className="font-mono text-xs">scripts/deploy/neutron.js</code>,
              'Neutron pion-1',
              'CosmJS script — uploads + instantiates all 6 CosmWasm contracts; updates addresses.json',
            ],
            [
              <code key="d4" className="font-mono text-xs">scripts/register-sepolia-relayers.sh</code>,
              'Sepolia',
              'Registers + funds bond for Relayer A and B (post-deploy bootstrap)',
            ],
            [
              <code key="d5" className="font-mono text-xs">scripts/register-neutron-relayers.js</code>,
              'Neutron',
              'Registers + funds bond on Neutron side',
            ],
            [
              <code key="d6" className="font-mono text-xs">scripts/fund-all-neutron-v2.js</code>,
              'Neutron',
              'One-pass funding for all Neutron wallets (relayers + dev wallets) with tUSDC + uNTRN',
            ],
            [
              <code key="d7" className="font-mono text-xs">scripts/claim-neutron-tusdc.js</code>,
              'Neutron',
              'CLI claim helper for tUSDC.Claim{} — used during onboarding/QA',
            ],
            [
              <code key="d8" className="font-mono text-xs">scripts/smoke-test.sh</code>,
              'both',
              'End-to-end smoke: register both relayers, post bond, run honest scenario, verify execution',
            ],
            [
              <code key="d9" className="font-mono text-xs">scripts/addresses.json</code>,
              'both',
              'Machine-readable contract address registry; updated by every deploy script',
            ],
          ]}
        />
      </ProseSection>

      <ProseSection label="Scenario scripts (live testnet)">
        <p className="text-stone-400 leading-relaxed mb-4">
          The four hackathon scenarios run against real testnet contracts. Each script is
          idempotent — it re-uses bonded relayers and produces a unique nonce. They mirror the
          in-process integration tests under <code className="font-mono text-stone-300 text-xs">relayer/internal/scenario</code>.
        </p>
        <ComparisonTable
          headers={['Script', 'Scenario', 'What it proves']}
          rows={[
            [
              <code key="s1" className="font-mono text-xs">scripts/scenarios/01-honest.sh</code>,
              'S-1 Honest delivery',
              'Cryptographic verification path is wired correctly end-to-end',
            ],
            [
              <code key="s2" className="font-mono text-xs">scripts/scenarios/02-lying.sh</code>,
              'S-2 Lying relayer',
              'Challenger detects bad fingerprint → 50% slash to challenger',
            ],
            [
              <code key="s3" className="font-mono text-xs">scripts/scenarios/03-silent.sh</code>,
              'S-3 Silent relayer',
              'Handover triggers next relayer; original slashed for absence',
            ],
            [
              <code key="s4" className="font-mono text-xs">scripts/scenarios/04-frivolous.sh</code>,
              'S-4 Frivolous challenge',
              '25% deposit forfeited; original tx proceeds normally',
            ],
          ]}
        />
        <p className="text-stone-500 text-xs mt-3">
          The in-process equivalent (no testnet funds required) is{' '}
          <code className="font-mono text-stone-300">go run ./cmd/tessera test-scenario [1..4]</code>.
        </p>
      </ProseSection>

      <ProseSection label="Verification suite (Playwright)">
        <p className="text-stone-400 leading-relaxed mb-2">
          Three end-to-end UI suites guard the demo path. They live under{' '}
          <code className="font-mono text-stone-300 text-xs">scripts/verify/</code> and require
          the dev server running on <code className="font-mono">:3000</code>:
        </p>
        <ul className="list-disc list-inside space-y-2 pl-2 text-sm text-stone-300">
          <li>
            <code className="font-mono text-xs">scripts/verify/ui-verify.py</code> — homepage,
            dashboard, demo, submission detail, and explorer-link format checks. Includes
            SEC-02 same-origin guard (deny no-Origin POST → 403).
          </li>
          <li>
            <code className="font-mono text-xs">scripts/verify/demo-verify.py</code> — demo
            page UX: page-load scroll position, log-container scroll behavior, Clear-Log
            button, run separators.
          </li>
          <li>
            <code className="font-mono text-xs">scripts/verify/docs-mermaid-verify.py</code>{' '}
            — every section in <code className="font-mono">/docs</code> renders its expected
            Mermaid diagrams without parse errors.
          </li>
        </ul>
        <p className="text-stone-500 text-xs mt-3">
          UI + demo suites pass 11/11 as of P-10 audit gate close; the docs suite passes 9/9 as
          of the documentation overhaul. They are check-in suites, not replacements for unit
          tests.
        </p>
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
    case 'database': return <DatabaseContent />;
    case 'scenarios': return <ScenariosContent />;
    case 'wallets': return <WalletsContent />;
    case 'relayer': return <RelayerContent />;
    case 'addchain': return <AddChainContent />;
    case 'scripts': return <ScriptsContent />;
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
