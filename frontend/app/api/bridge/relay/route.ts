/**
 * POST /api/bridge/relay
 *
 * Records the user's source-side bridge intent in Supabase so the dashboard
 * can show a 'pending' row immediately. The deployed Go relayer (Railway
 * services `relayer-a` / `relayer-b`) detects the on-chain Locked / Burned
 * event independently and updates this row's status to 'submitted' →
 * 'executed' as it processes the proof and submits to the destination
 * Verifier.
 *
 * Returns the Supabase message id so the bridge widget can subscribe to
 * realtime updates on that specific row and surface the destination tx hash
 * + balance changes to the user.
 *
 * Production note: this endpoint no longer signs or broadcasts any tx. All
 * relayer-side keys live exclusively on Railway. The simulator
 * (frontend/lib/relay-helper.ts) was deleted as part of P-10 cutover.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabase-admin';
import { ADDRESSES } from '@/lib/config';

// P-10.11: bridge contract addresses live in `lib/config.ts` so both client
// and server code read from a single source of truth. Previously this route
// hardcoded the addresses, which left it vulnerable to drift on the next
// migration (the P-10.10 vault rotation already burned us once with stale
// frontend bundles pointing at the old vault).
const SEPOLIA_VAULT = ADDRESSES.sepolia.bridgeVault;
const NEUTRON_BRIDGE_MINT = ADDRESSES.neutron.bridgeMint;
// P-10.8: must match the Go relayer's `ChainPlugin.ChainID()` exactly so the
// (source_chain_id, nonce) upsert key collides with the relayer's own write.
// Previously we used '11155111' (Ethereum chain ID literal); the relayer uses
// 'sepolia' (canonical plugin chain name from relayer/plugins/ethereum/plugin.go
// line 53). The mismatch silently produced two separate message rows per
// bridge — one pending (frontend's), one executed (relayer's) — leaving the
// widget's realtime UPDATE subscription waiting forever on the orphan row.
const CHAIN_SEPOLIA = 'sepolia';
const CHAIN_NEUTRON = 'pion-1';

interface BridgeRelayBody {
  direction: 'sepolia_to_neutron' | 'neutron_to_sepolia';
  amount: string;
  sender: string;
  recipient: string;
  sourceTxHash: string;
  sourceBlock: number;
  nonce: number;
}

function isBody(b: unknown): b is BridgeRelayBody {
  if (!b || typeof b !== 'object') return false;
  const x = b as Partial<BridgeRelayBody>;
  return (
    (x.direction === 'sepolia_to_neutron' || x.direction === 'neutron_to_sepolia') &&
    typeof x.amount === 'string' &&
    typeof x.sender === 'string' &&
    typeof x.recipient === 'string' &&
    typeof x.sourceTxHash === 'string' &&
    typeof x.sourceBlock === 'number' &&
    typeof x.nonce === 'number'
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }
  if (!isBody(body)) {
    return NextResponse.json(
      { success: false, error: 'Body shape mismatch' },
      { status: 400 },
    );
  }

  const { direction, amount, sender, recipient, sourceTxHash, sourceBlock, nonce } = body;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createSupabaseAdmin() as any;

  const sourceChainId = direction === 'sepolia_to_neutron' ? CHAIN_SEPOLIA : CHAIN_NEUTRON;
  const destChainId = direction === 'sepolia_to_neutron' ? CHAIN_NEUTRON : CHAIN_SEPOLIA;
  const sourceApp =
    direction === 'sepolia_to_neutron' ? SEPOLIA_VAULT.toLowerCase() : NEUTRON_BRIDGE_MINT;
  const destApp =
    direction === 'sepolia_to_neutron' ? NEUTRON_BRIDGE_MINT : SEPOLIA_VAULT.toLowerCase();
  // P-10.11: action representation must match what the relayer writes when it
  // upserts the same row from on-chain events (no `0x` prefix, hex-encoded
  // 4-byte selector). Sepolia→Neutron is the LOCK action 0x00000001;
  // Neutron→Sepolia is the BURN action 0x00000002. See decodeLocked in the
  // ethereum plugin and decodeResultTx in the tendermint plugin.
  const action = direction === 'sepolia_to_neutron' ? '00000001' : '00000002';

  // Idempotency: if the relayer already indexed this source tx, return the
  // existing row instead of inserting a duplicate (PRIMARY KEY violation).
  const existing = await db
    .from('messages')
    .select('id, status')
    .eq('source_tx_hash', sourceTxHash)
    .maybeSingle();

  if (existing?.data?.id) {
    return NextResponse.json({
      success: true,
      messageId: existing.data.id,
      status: existing.data.status,
      awaitingRelayer: existing.data.status !== 'executed',
    });
  }

  // Insert pending message row. The Go relayer will UPSERT on
  // (source_chain_id, nonce) when it detects the event on-chain and
  // promote status to 'submitted' → 'executed'.
  const msgInsert = {
    nonce,
    source_chain_id: sourceChainId,
    source_app: sourceApp,
    destination_chain_id: destChainId,
    destination_app: destApp,
    action,
    payload: '\\x',
    sender,
    recipient,
    amount,
    source_tx_hash: sourceTxHash,
    source_block: sourceBlock,
    status: 'pending',
  };

  const inserted = await db
    .from('messages')
    .insert(msgInsert)
    .select('id')
    .single();

  if (inserted.error) {
    return NextResponse.json(
      { success: false, error: 'Failed to record intent', detail: inserted.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    messageId: inserted.data.id,
    status: 'pending',
    awaitingRelayer: true,
  });
}
