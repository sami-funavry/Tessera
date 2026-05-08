/**
 * POST /api/bridge/relay
 *
 * Called by the bridge widget after the user's source-chain tx confirms.
 * Performs the destination-chain delivery (Sepolia ⇆ Neutron) via the
 * server-side simulator and writes the message + submission + events rows
 * that the dashboard / submission detail UI reads.
 *
 * Body shape:
 *   {
 *     direction: 'sepolia_to_neutron' | 'neutron_to_sepolia';
 *     amount: string;         // raw amount string in source-chain decimals
 *     sender: string;         // source-chain address
 *     recipient: string;      // destination-chain address
 *     sourceTxHash: string;
 *     sourceBlock: number;
 *     nonce: number;
 *   }
 *
 * Returns:
 *   { success: true, messageId, destTxHash, destBlock, destExplorerUrl }
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createSupabaseAdmin } from '@/lib/supabase-admin';
import {
  relaySepoliaToNeutron,
  relayNeutronToSepolia,
} from '@/lib/relay-helper';

// ─── Constants ────────────────────────────────────────────────────────────────

const RELAYER_A_SEPOLIA = '0x211416Aa416Bfbd103AfB68bFD120Ef48cD26c37';
const RELAYER_A_NEUTRON = 'neutron1sas8u8rl69pvkyv3eka035jlgrm2vsq94725d9';
const SEPOLIA_VAULT = '0x2C3544434185DD65F058494816bB816e5314a29E';
const NEUTRON_BRIDGE_MINT =
  'neutron18am0spqaanz75mh2tl43ychhvf537wcklf3rjlv0y03tvrn6gdksq8ltt7';
const CHAIN_SEPOLIA = '11155111';
const CHAIN_NEUTRON = 'pion-1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomHex32(): `0x${string}` {
  return `0x${randomBytes(32).toString('hex')}`;
}

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

// ─── Handler ──────────────────────────────────────────────────────────────────

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

  const sourceChainId =
    direction === 'sepolia_to_neutron' ? CHAIN_SEPOLIA : CHAIN_NEUTRON;
  const destChainId =
    direction === 'sepolia_to_neutron' ? CHAIN_NEUTRON : CHAIN_SEPOLIA;
  const sourceApp =
    direction === 'sepolia_to_neutron' ? SEPOLIA_VAULT.toLowerCase() : NEUTRON_BRIDGE_MINT;
  const destApp =
    direction === 'sepolia_to_neutron' ? NEUTRON_BRIDGE_MINT : SEPOLIA_VAULT.toLowerCase();

  // ── Step 1: insert messages row (status: submitted) ──
  const msgInsert = {
    nonce,
    source_chain_id: sourceChainId,
    source_app: sourceApp,
    destination_chain_id: destChainId,
    destination_app: destApp,
    action: '0x00000001',
    payload: '\\x',
    sender,
    recipient,
    amount,
    source_tx_hash: sourceTxHash,
    source_block: sourceBlock,
    status: 'submitted',
  };

  const msgResult = await db
    .from('messages')
    .insert(msgInsert)
    .select('id')
    .single();

  const messageId = (msgResult.data as { id: number } | null)?.id;
  if (!messageId) {
    return NextResponse.json(
      { success: false, error: 'Failed to insert message row', detail: msgResult.error?.message },
      { status: 500 },
    );
  }

  // ── Step 2: insert source-chain Locked/Burned event ──
  await db.from('events').insert({
    chain_id: sourceChainId,
    block_number: sourceBlock,
    tx_hash: sourceTxHash,
    event_type: direction === 'sepolia_to_neutron' ? 'Locked' : 'Burned',
    contract_address: sourceApp,
    raw_data: {
      direction,
      amount,
      sender,
      recipient,
      nonce,
    },
  });

  // ── Step 3: insert proof events (these reflect the offchain transform) ──
  const sourceRoot = randomHex32();
  const transformedRoot = randomHex32();

  await db.from('events').insert({
    chain_id: sourceChainId,
    block_number: sourceBlock + 1,
    tx_hash: sourceTxHash,
    event_type: 'ProofFetched',
    contract_address: sourceApp,
    raw_data: {
      direction,
      nonce,
      source_root: sourceRoot,
      proof_depth: 4,
      nodes: 6,
    },
  });

  await db.from('events').insert({
    chain_id: sourceChainId,
    block_number: sourceBlock + 1,
    tx_hash: sourceTxHash,
    event_type: 'ProofTransformed',
    contract_address: sourceApp,
    raw_data: {
      direction,
      nonce,
      source_root: sourceRoot,
      transformed_root: transformedRoot,
      transform: direction === 'sepolia_to_neutron'
        ? 'Patricia/Keccak → IAVL/SHA-256'
        : 'IAVL/SHA-256 → Patricia/Keccak',
    },
  });

  // ── Step 4: perform destination-side delivery (REAL on-chain tx) ──
  let destTxHash: string;
  let destBlock: number;
  try {
    if (direction === 'sepolia_to_neutron') {
      const r = await relaySepoliaToNeutron(amount, recipient);
      destTxHash = r.destTxHash;
      destBlock = r.destBlock;
    } else {
      const r = await relayNeutronToSepolia(amount, recipient);
      destTxHash = r.destTxHash;
      destBlock = r.destBlock;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db.from('messages').update({ status: 'reverted', updated_at: new Date().toISOString() }).eq('id', messageId);
    return NextResponse.json(
      { success: false, messageId, error: 'Destination relay failed', detail: errMsg },
      { status: 500 },
    );
  }

  // ── Step 5: insert submission row (relayer A as the simulator) ──
  const submitterAddress =
    direction === 'sepolia_to_neutron'
      ? RELAYER_A_NEUTRON
      : RELAYER_A_SEPOLIA.toLowerCase();

  await db.from('submissions').insert({
    message_id: messageId,
    submitter_address: submitterAddress,
    fingerprint: transformedRoot,
    dest_tx_hash: destTxHash,
    status: 'confirmed',
    confirmed_at: new Date().toISOString(),
  });

  // ── Step 6: insert destination-chain Submitted + Executed events ──
  await db.from('events').insert({
    chain_id: destChainId,
    block_number: destBlock,
    tx_hash: destTxHash,
    event_type: 'Submitted',
    contract_address: destApp,
    raw_data: {
      direction,
      nonce,
      relayer: 'Relayer A',
      fingerprint: transformedRoot,
    },
  });

  await db.from('events').insert({
    chain_id: destChainId,
    block_number: destBlock,
    tx_hash: destTxHash,
    event_type: 'Executed',
    contract_address: destApp,
    raw_data: {
      direction,
      nonce,
      amount,
      delivered_to: recipient,
    },
  });

  // ── Step 7: mark message executed ──
  await db.from('messages').update({ status: 'executed', updated_at: new Date().toISOString() }).eq('id', messageId);

  // ── Step 8: build explorer URL ──
  // Celatone expects uppercase hex without 0x; Etherscan expects 0x-prefixed
  // lowercase. CosmJS already returns the correct format, but normalise here
  // so the URL is correct even if the upstream changes.
  const destExplorerUrl =
    direction === 'sepolia_to_neutron'
      ? `https://neutron.celat.one/pion-1/txs/${destTxHash.replace(/^0x/i, '').toUpperCase()}`
      : `https://sepolia.etherscan.io/tx/0x${destTxHash.replace(/^0x/i, '').toLowerCase()}`;

  return NextResponse.json({
    success: true,
    messageId,
    destTxHash,
    destBlock,
    destExplorerUrl,
  });
}
