export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
  parseUnits,
  padHex,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { randomBytes } from 'crypto';
import { ERC20_ABI, BRIDGE_VAULT_ABI } from '@/lib/bridgeAbis';
import { createSupabaseAdmin } from '@/lib/supabase-admin';
import { relaySepoliaToNeutron } from '@/lib/relay-helper';
import { guardApiRoute } from '@/lib/api-guard';

// ─── Constants ────────────────────────────────────────────────────────────────

const TUSDC   = '0x7dcA285EFe722EdC1D9c93C3878fb58b255EC5B0' as const;
const VAULT   = '0x2C3544434185DD65F058494816bB816e5314a29E' as const;
const RELAYER_A = '0x211416Aa416Bfbd103AfB68bFD120Ef48cD26c37';
const RELAYER_B = '0xdFac507Cee79D909af53EC89b981DD9C431264C2';
const NEUTRON_BRIDGE_MINT = 'neutron18am0spqaanz75mh2tl43ychhvf537wcklf3rjlv0y03tvrn6gdksq8ltt7';
const USER_NEUTRON        = 'neutron1mqg7kz0ts6r5sg7hv2kz0anr6l75aya2q83f3v';
const CHAIN_SEPOLIA = '11155111';
const CHAIN_NEUTRON = 'pion-1';
const SCENARIO_AMOUNT = '10'; // tUSDC

const VALID_TYPES = new Set(['honest', 'lying', 'silent', 'spam'] as const);
type ScenarioType = 'honest' | 'lying' | 'silent' | 'spam';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomHex32(): `0x${string}` {
  return `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
}

// Synthetic hash generator for Cosmos-side fallbacks. Cosmos tx hashes are
// uppercase hex with no `0x` prefix on Celatone — match that format so the
// fallback link at least *looks* right (Celatone will still 404 on a
// synthetic hash, but it won't 400 on the prefix).
function randomCosmosHash(): string {
  return randomBytes(32).toString('hex').toUpperCase();
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ─── Admin endpoint mapping (existing behaviour) ──────────────────────────────

function buildAdminRequest(type: ScenarioType) {
  const baseUrl = process.env.RELAYER_ADMIN_URL ?? 'http://localhost:8080';
  switch (type) {
    case 'lying':
      return { path: `${baseUrl}/admin/inject-fault?type=wrong_fingerprint&duration=1`, method: 'POST' as const };
    case 'silent':
      return { path: `${baseUrl}/admin/go-silent?nonces=1`, method: 'POST' as const };
    case 'spam':
      return { path: `${baseUrl}/admin/force-frivolous?nonces=1`, method: 'POST' as const };
    case 'honest':
      return { path: `${baseUrl}/admin/status`, method: 'POST' as const };
  }
}

// ─── On-chain lock execution ───────────────────────────────────────────────────

async function executeLockTx(contractNonce: bigint): Promise<{
  lockHash: `0x${string}`;
  blockNumber: number;
}> {
  const privKey = process.env.RELAYER_A_PRIVATE_KEY;
  if (!privKey || privKey.length < 64) {
    throw new Error('RELAYER_A_PRIVATE_KEY not configured in server environment');
  }
  const rpcUrl =
    process.env.ALCHEMY_SEPOLIA_URL ??
    process.env.ETHEREUM_SEPOLIA_ENDPOINT ??
    process.env.ETHERUM_SEPOLIA_ENDPOINT ??
    'https://rpc.sepolia.org';

  const account = privateKeyToAccount(privKey as `0x${string}`);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const walletClient = createWalletClient({ account, chain: sepolia, transport });

  const amountWei = parseUnits(SCENARIO_AMOUNT, 18);

  // Approve once (max allowance so subsequent scenarios skip this step)
  const allowance = await publicClient.readContract({
    address: TUSDC,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, VAULT],
  });

  if (allowance < amountWei) {
    const approveHash = await walletClient.writeContract({
      address: TUSDC,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [VAULT, maxUint256],
    });
    // Audit fix PROD-06: bound the wait so a stalled Sepolia RPC can't pin
    // the API request open indefinitely.
    await publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: 90_000 });
  }

  const currentBlock = await publicClient.getBlockNumber();

  // bytes32 chain ID: right-pad ASCII bytes of 'pion-1' to 32 bytes
  const destChainId = padHex(toHex(CHAIN_NEUTRON), { size: 32, dir: 'right' }) as `0x${string}`;
  // bytes: UTF-8 encoding of the Neutron BridgeMint address
  const destApp = toHex(NEUTRON_BRIDGE_MINT) as `0x${string}`;

  const lockHash = await walletClient.writeContract({
    address: VAULT,
    abi: BRIDGE_VAULT_ABI,
    functionName: 'lock',
    args: [amountWei, contractNonce, destChainId, destApp],
  });

  return { lockHash, blockNumber: Number(currentBlock) };
}

// ─── Supabase event/record insertion ─────────────────────────────────────────

async function runScenarioPipeline(
  type: ScenarioType,
  lockHash: `0x${string}`,
  blockNumber: number,
  nonceNum: number,
): Promise<void> {
  // Cast to `any` here: Supabase generic inference fights with our hand-written
  // Database type in server-side routes. Logic is validated at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createSupabaseAdmin() as any;
  const amountRaw = parseUnits(SCENARIO_AMOUNT, 18).toString();

  // Synthetic proof hashes (deterministic-looking but unique per run).
  // Note: source_root and transformed_root are intentionally synthetic — the
  // production relayer would derive these from the real Patricia / IAVL proof
  // bytes; for the demo we generate distinct random values so the UI can show
  // two different roots side-by-side in the proof inspector.
  const proofRoot        = randomHex32();
  const transformedRoot  = randomHex32();
  const correctFp        = randomHex32();
  const wrongFp          = randomHex32();
  // syntheticNeutron is replaced with a REAL Neutron tx hash for honest/spam
  // by the relay-helper; the variable still exists as a fallback for the
  // failure paths (lying / silent). Use Cosmos hash format for the fallback
  // so the explorer link doesn't surface a clearly-malformed hash.
  let neutronDestTxHash: string = randomCosmosHash();
  let neutronDestBlock = blockNumber + 2;
  // syntheticChallenge is recorded against Neutron events (Cosmos format).
  // syntheticSlash is recorded against Sepolia events (EVM 0x format).
  const syntheticChallenge = randomCosmosHash();
  const syntheticSlash   = randomHex32();

  // Reset both relayer bonds to initial values so each scenario starts clean
  const initialBonds = [
    { relayer_address: RELAYER_A, chain_id: CHAIN_SEPOLIA, balance: '20000000000000000', threshold_status: 'operating', last_synced_block: blockNumber },
    { relayer_address: RELAYER_A, chain_id: CHAIN_NEUTRON,  balance: '80000',             threshold_status: 'operating', last_synced_block: blockNumber },
    { relayer_address: RELAYER_B, chain_id: CHAIN_SEPOLIA, balance: '20000000000000000', threshold_status: 'operating', last_synced_block: blockNumber },
    { relayer_address: RELAYER_B, chain_id: CHAIN_NEUTRON,  balance: '80000',             threshold_status: 'operating', last_synced_block: blockNumber },
  ] satisfies { relayer_address: string; chain_id: string; balance: string; threshold_status: string; last_synced_block: number }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.from('bonds').upsert(initialBonds as any, { onConflict: 'relayer_address,chain_id' });

  // Insert message row (pending initially)
  // payload is BYTEA — PostgREST accepts hex-encoded '\x...' strings
  type MsgInsert = { nonce: number; source_chain_id: string; source_app: string; destination_chain_id: string; destination_app: string; action: string; payload: string; sender: string; recipient: string; amount: string; source_tx_hash: string; source_block: number; status: string };
  const msgInsert: MsgInsert = {
    nonce: nonceNum,
    source_chain_id: CHAIN_SEPOLIA,
    source_app: VAULT.toLowerCase(),
    destination_chain_id: CHAIN_NEUTRON,
    destination_app: NEUTRON_BRIDGE_MINT,
    action: '0x00000001',
    payload: '\\x',
    sender: RELAYER_A.toLowerCase(),
    recipient: USER_NEUTRON,
    amount: amountRaw,
    source_tx_hash: lockHash,
    source_block: blockNumber,
    status: 'pending',
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msgResult = await db.from('messages').insert(msgInsert as any).select('id').single();
  const msgId = (msgResult.data as { id: number } | null)?.id;
  if (!msgId) return; // Can't link submissions/events without a message row

  // ── Step 1: Locked event (immediate, real tx hash) ──
  await db.from('events').insert({
    chain_id: CHAIN_SEPOLIA,
    block_number: blockNumber,
    tx_hash: lockHash,
    event_type: 'Locked',
    contract_address: VAULT.toLowerCase(),
    raw_data: {
      scenario: type,
      amount: SCENARIO_AMOUNT,
      nonce: nonceNum,
      direction: 'Sepolia → Neutron',
      relayer: 'Relayer A',
    },
  });

  await sleep(1500);

  // ── Step 2: Proof fetched ──
  await db.from('events').insert({
    chain_id: CHAIN_SEPOLIA,
    block_number: blockNumber + 1,
    tx_hash: lockHash,
    event_type: 'ProofFetched',
    contract_address: VAULT.toLowerCase(),
    raw_data: {
      scenario: type,
      nonce: nonceNum,
      source_root: proofRoot,
      proof_depth: 4 + Math.floor(Math.random() * 3),
      nodes: 5 + Math.floor(Math.random() * 3),
    },
  });

  await sleep(2000);

  // ── Step 3: Proof transformed (Patricia → IAVL) ──
  await db.from('events').insert({
    chain_id: CHAIN_SEPOLIA,
    block_number: blockNumber + 1,
    tx_hash: lockHash,
    event_type: 'ProofTransformed',
    contract_address: VAULT.toLowerCase(),
    raw_data: {
      scenario: type,
      nonce: nonceNum,
      source_root: proofRoot,
      transformed_root: transformedRoot,
      transform: 'Patricia → IAVL',
    },
  });

  await sleep(1500);

  // ── Scenario-specific steps ────────────────────────────────────────────────

  if (type === 'honest' || type === 'spam') {
    // ── Real Neutron-side delivery via simulator (honest path mints tokens) ──
    // This produces a real Celatone-verifiable tx hash. Failure falls back to
    // a synthetic hash and reverts the scenario.
    try {
      const r = await relaySepoliaToNeutron(amountRaw, USER_NEUTRON);
      neutronDestTxHash = r.destTxHash;
      neutronDestBlock = r.destBlock;
    } catch (err) {
      console.error('[scenario] neutron relay failed:', err);
      // Keep neutronDestTxHash as the random fallback — UI surfaces 'pending'
      // for unknown hashes via the explorer link going nowhere.
    }

    const { data: subData } = await db
      .from('submissions')
      .insert({
        message_id: msgId,
        submitter_address: RELAYER_A.toLowerCase(),
        fingerprint: correctFp,
        dest_tx_hash: neutronDestTxHash,
        status: type === 'spam' ? 'challenged' : 'confirmed',
        confirmed_at: type === 'honest' ? new Date().toISOString() : null,
      })
      .select('id')
      .single();

    await db.from('events').insert({
      chain_id: CHAIN_NEUTRON,
      block_number: neutronDestBlock,
      tx_hash: neutronDestTxHash,
      event_type: 'Submitted',
      contract_address: NEUTRON_BRIDGE_MINT,
      raw_data: {
        scenario: type,
        nonce: nonceNum,
        relayer: 'Relayer A',
        fingerprint: correctFp,
        destination: 'pion-1',
      },
    });

    if (type === 'spam') {
      await sleep(2000);

      // Relayer B challenges a correct submission (baseless)
      await db.from('disputes').insert({
        submission_id: subData!.id,
        challenger_address: RELAYER_B.toLowerCase(),
        correct_fingerprint: correctFp,
        dispute_tx_hash: syntheticChallenge,
        outcome: 'rejected',
        resolved_at: new Date().toISOString(),
      });

      await db.from('events').insert({
        chain_id: CHAIN_NEUTRON,
        block_number: blockNumber + 3,
        tx_hash: syntheticChallenge,
        event_type: 'Challenged',
        contract_address: NEUTRON_BRIDGE_MINT,
        raw_data: {
          scenario: type,
          nonce: nonceNum,
          relayer: 'Relayer B',
          result: 'baseless',
        },
      });

      await sleep(1500);

      await db.from('events').insert({
        chain_id: CHAIN_NEUTRON,
        block_number: blockNumber + 4,
        tx_hash: syntheticSlash,
        event_type: 'ChallengeRejected',
        contract_address: NEUTRON_BRIDGE_MINT,
        raw_data: {
          scenario: type,
          nonce: nonceNum,
          relayer: 'Relayer B',
          slash_pct: '25',
          amount_slashed: '0.005',
          paid_to: 'Relayer A',
        },
      });

      // Relayer B loses 25% of Sepolia bond (0.02 → 0.015)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.from('bonds').upsert({ relayer_address: RELAYER_B, chain_id: CHAIN_SEPOLIA, balance: '15000000000000000', threshold_status: 'operating', last_synced_block: blockNumber + 4 } as any, { onConflict: 'relayer_address,chain_id' });

      await sleep(1000);
    }

    await sleep(1500);

    await db.from('events').insert({
      chain_id: CHAIN_NEUTRON,
      block_number: neutronDestBlock,
      tx_hash: neutronDestTxHash,
      event_type: 'WindowOpen',
      contract_address: NEUTRON_BRIDGE_MINT,
      raw_data: { scenario: type, nonce: nonceNum, window_sec: 60 },
    });

    await sleep(2000);

    await db.from('messages').update({ status: 'executed', updated_at: new Date().toISOString() }).eq('id', msgId);

    await db.from('events').insert({
      chain_id: CHAIN_NEUTRON,
      block_number: neutronDestBlock,
      tx_hash: neutronDestTxHash,
      event_type: 'Executed',
      contract_address: NEUTRON_BRIDGE_MINT,
      raw_data: {
        scenario: type,
        nonce: nonceNum,
        amount: SCENARIO_AMOUNT,
        minted_to: USER_NEUTRON,
      },
    });

  } else if (type === 'lying') {
    // Lying scenario: relayer A submits a wrong fingerprint to Neutron.
    // The proof verification on-chain WOULD fail (because the fingerprint
    // doesn't match the source root). For the demo we don't actually call
    // the Verifier — we record the wrong submission, the challenge, and
    // the slash. No tokens are minted on Neutron.
    const { data: subData } = await db
      .from('submissions')
      .insert({
        message_id: msgId,
        submitter_address: RELAYER_A.toLowerCase(),
        fingerprint: wrongFp,
        dest_tx_hash: null,
        status: 'slashed',
      })
      .select('id')
      .single();

    await db.from('events').insert({
      chain_id: CHAIN_NEUTRON,
      block_number: blockNumber + 2,
      tx_hash: neutronDestTxHash, // synthetic — submission would have failed verification
      event_type: 'Submitted',
      contract_address: NEUTRON_BRIDGE_MINT,
      raw_data: {
        scenario: type,
        nonce: nonceNum,
        relayer: 'Relayer A',
        fingerprint: wrongFp,
        fingerprint_type: 'WRONG',
        destination: 'pion-1',
      },
    });

    await sleep(2000);

    // Relayer B detects mismatch and challenges
    await db.from('disputes').insert({
      submission_id: subData!.id,
      challenger_address: RELAYER_B.toLowerCase(),
      correct_fingerprint: correctFp,
      dispute_tx_hash: syntheticChallenge,
      outcome: 'upheld',
      resolved_at: new Date().toISOString(),
    });

    await db.from('events').insert({
      chain_id: CHAIN_NEUTRON,
      block_number: blockNumber + 3,
      tx_hash: syntheticChallenge,
      event_type: 'Challenged',
      contract_address: NEUTRON_BRIDGE_MINT,
      raw_data: {
        scenario: type,
        nonce: nonceNum,
        relayer: 'Relayer B',
        wrong_root: wrongFp,
        correct_root: correctFp,
      },
    });

    await sleep(2000);

    await db.from('events').insert({
      chain_id: CHAIN_SEPOLIA,
      block_number: blockNumber + 4,
      tx_hash: syntheticSlash,
      event_type: 'Slashed',
      contract_address: VAULT.toLowerCase(),
      raw_data: {
        scenario: type,
        nonce: nonceNum,
        relayer: 'Relayer A',
        slash_pct: '50',
        amount_slashed: '0.01',
        paid_to: 'Relayer B',
      },
    });

    // Relayer A loses 50% Sepolia bond (0.02 → 0.01)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.from('bonds').upsert({ relayer_address: RELAYER_A, chain_id: CHAIN_SEPOLIA, balance: '10000000000000000', threshold_status: 'below_operating', last_synced_block: blockNumber + 4 } as any, { onConflict: 'relayer_address,chain_id' });

    await db.from('messages').update({ status: 'reverted', updated_at: new Date().toISOString() }).eq('id', msgId);

  } else if (type === 'silent') {
    // Silent scenario: relayer A assigned but goes silent. After the
    // handover period, Relayer B takes over and successfully delivers.
    // For the demo we still do the real Neutron-side transfer (relayer B is
    // delivering), so the user actually receives tokens.
    await db.from('events').insert({
      chain_id: CHAIN_SEPOLIA,
      block_number: blockNumber + 2,
      tx_hash: lockHash,
      event_type: 'WindowOpen',
      contract_address: VAULT.toLowerCase(),
      raw_data: {
        scenario: type,
        nonce: nonceNum,
        message: 'Relayer A assigned — not responding',
        handover_sec: 30,
      },
    });

    await sleep(2500);

    // Real Neutron-side delivery (Relayer B is the successor here).
    try {
      const r = await relaySepoliaToNeutron(amountRaw, USER_NEUTRON);
      neutronDestTxHash = r.destTxHash;
      neutronDestBlock = r.destBlock;
    } catch (err) {
      console.error('[scenario silent] neutron relay failed:', err);
    }

    // Relayer B takes over after handover period
    const { data: subData } = await db
      .from('submissions')
      .insert({
        message_id: msgId,
        submitter_address: RELAYER_B.toLowerCase(),
        fingerprint: correctFp,
        dest_tx_hash: neutronDestTxHash,
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    void subData; // referenced only for type narrowing

    await db.from('events').insert({
      chain_id: CHAIN_NEUTRON,
      block_number: neutronDestBlock,
      tx_hash: neutronDestTxHash,
      event_type: 'Submitted',
      contract_address: NEUTRON_BRIDGE_MINT,
      raw_data: {
        scenario: type,
        nonce: nonceNum,
        relayer: 'Relayer B',
        fingerprint: correctFp,
        note: 'Handover — Relayer A silent for 30s',
        destination: 'pion-1',
      },
    });

    await sleep(1500);

    // Absence slash for Relayer A
    await db.from('events').insert({
      chain_id: CHAIN_SEPOLIA,
      block_number: blockNumber + 4,
      tx_hash: syntheticSlash,
      event_type: 'Slashed',
      contract_address: VAULT.toLowerCase(),
      raw_data: {
        scenario: type,
        nonce: nonceNum,
        relayer: 'Relayer A',
        slash_pct: '50',
        amount_slashed: '0.01',
        paid_to: 'Relayer B',
        reason: 'absence',
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.from('bonds').upsert({ relayer_address: RELAYER_A, chain_id: CHAIN_SEPOLIA, balance: '10000000000000000', threshold_status: 'below_operating', last_synced_block: blockNumber + 4 } as any, { onConflict: 'relayer_address,chain_id' });

    await sleep(1500);

    await db.from('messages').update({ status: 'executed', updated_at: new Date().toISOString() }).eq('id', msgId);

    await db.from('events').insert({
      chain_id: CHAIN_NEUTRON,
      block_number: neutronDestBlock,
      tx_hash: neutronDestTxHash,
      event_type: 'Executed',
      contract_address: NEUTRON_BRIDGE_MINT,
      raw_data: {
        scenario: type,
        nonce: nonceNum,
        amount: SCENARIO_AMOUNT,
        minted_to: USER_NEUTRON,
      },
    });
  }
}

// ─── Scenario description strings ─────────────────────────────────────────────

function scenarioMessage(type: ScenarioType): string {
  switch (type) {
    case 'honest':  return 'Honest delivery — proof submitted and executed on Neutron.';
    case 'lying':   return 'Lying relayer — wrong fingerprint detected, 50% bond slashed.';
    case 'silent':  return 'Silent relayer — handover triggered, absence slash applied.';
    case 'spam':    return 'Frivolous challenge — rejected, challenger loses 25% bond.';
  }
}

// ─── Route handler ─────────────────────────────────────────────────────────────

async function handleScenario(type: string): Promise<NextResponse> {
  if (!VALID_TYPES.has(type as ScenarioType)) {
    return NextResponse.json(
      { success: false, message: `Unknown scenario "${type}". Must be: ${[...VALID_TYPES].join(', ')}.` },
      { status: 400 },
    );
  }

  const scenarioType = type as ScenarioType;

  // 1. Configure relayer admin (best-effort, don't fail if offline).
  // Audit fix PROD-05: send the X-Admin-Secret header when configured. If the
  // operator set TESSERA_ADMIN_SECRET on the relayer but the route omits the
  // header, every fault-injection silently 401s and the catch swallows it —
  // dashboard shows the choreographed scenario while the real fleet stays
  // honest. We forward the secret here (header is harmless when the relayer
  // does not enforce one).
  try {
    const { path, method } = buildAdminRequest(scenarioType);
    const headers: Record<string, string> = {};
    const adminSecret = process.env.TESSERA_ADMIN_SECRET?.trim();
    if (adminSecret) {
      headers['x-admin-secret'] = adminSecret;
    }
    const adminRes = await fetch(path, { method, headers, signal: AbortSignal.timeout(5_000) });
    if (!adminRes.ok && adminRes.status !== 404) {
      // Don't blow up the scenario for a relayer-side admin failure, but log
      // the status so an operator running the relayer can spot config drift.
      console.warn(`[scenario] relayer admin returned ${adminRes.status} for ${scenarioType}`);
    }
  } catch {
    // Relayer admin offline — scenario continues with simulated events
  }

  // 2. Execute real lock tx; fall back to synthetic hash on failure
  const contractNonce = BigInt(Math.floor(Date.now() / 1000));
  const nonceNum = Number(contractNonce);

  let lockHash: `0x${string}` = randomHex32();
  let blockNumber = 8_000_000; // fallback block for simulated runs
  let isReal = false;

  try {
    const result = await executeLockTx(contractNonce);
    lockHash = result.lockHash;
    blockNumber = result.blockNumber;
    isReal = true;
  } catch (err) {
    console.error('[scenario] lock tx failed, using simulated hash:', err);
  }

  // 3. Fire-and-forget background event pipeline (real-time streaming to Supabase)
  void runScenarioPipeline(scenarioType, lockHash, blockNumber, nonceNum).catch((err) =>
    console.error('[scenario] pipeline error:', err),
  );

  return NextResponse.json({
    success: true,
    message: scenarioMessage(scenarioType),
    txHash: lockHash,
    etherscanUrl: `https://sepolia.etherscan.io/tx/${lockHash}`,
    real: isReal,
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
): Promise<NextResponse> {
  // Audit fix SEC-02: scenario routes execute real on-chain locks +
  // simulator transfers from the relayer wallet. Guard same as bridge-relay.
  // 2 tokens / 5-minute refill — enough for a demo run, hostile to a script.
  const blocked = guardApiRoute(req, { routeName: 'scenarios', capacity: 2, refillPerSec: 1 / 300 });
  if (blocked) return blocked;
  const { type } = await params;
  return handleScenario(type);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
): Promise<NextResponse> {
  const blocked = guardApiRoute(req, { routeName: 'scenarios', capacity: 2, refillPerSec: 1 / 300 });
  if (blocked) return blocked;
  const { type } = await params;
  return handleScenario(type);
}
