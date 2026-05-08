export const dynamic = 'force-dynamic';
// Cache this route for 30 seconds — Sepolia gas prices change slowly enough
// that a 30-second TTL keeps the UI fresh without hammering the RPC.
export const revalidate = 30;

import { NextResponse } from 'next/server';
import { BRIDGE_PARAMS } from '@/lib/config';

interface BridgeStats {
  estimatedTimeSec: number;
  challengeWindowSec: number;
  relayerFeeBps: number;
  gasUsd: string;
}

// Safe fallback values when the RPC is unavailable or gas estimation fails.
const FALLBACK: BridgeStats = {
  estimatedTimeSec: BRIDGE_PARAMS.estimatedTimeSec,
  challengeWindowSec: BRIDGE_PARAMS.challengeWindowSec,
  relayerFeeBps: BRIDGE_PARAMS.relayerFeeBps,
  gasUsd: '~$0.42',
};

/**
 * Fetches the current Sepolia base fee via eth_gasPrice and converts it to a
 * rough USD cost for a 65,000-gas bridge transaction. ETH/USD is hardcoded to
 * a testnet placeholder (~$3,200) because testnet ETH has no market price.
 *
 * This is intentionally approximate — it's a UX hint, not a quote.
 */
async function estimateGasUsd(): Promise<string> {
  const rpcUrl =
    process.env.ALCHEMY_SEPOLIA_URL ??
    process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ??
    'https://rpc.sepolia.org';

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_gasPrice',
      params: [],
    }),
    signal: AbortSignal.timeout(4_000),
  });

  if (!response.ok) {
    throw new Error(`RPC responded with ${response.status}`);
  }

  const { result } = (await response.json()) as { result?: string };
  if (!result) throw new Error('eth_gasPrice returned no result');

  // Convert hex wei to gwei.
  // Parse hex gas price — avoid BigInt literal (n-suffix) to stay ES2019-compatible.
  const gasPriceWei = parseInt(result, 16);
  const gasUnits = 65_000; // approximate bridge transaction gas usage
  const costWei = gasPriceWei * gasUnits;

  // Testnet ETH has no real price; we use a representative mainnet price for
  // UX context only. This is clearly approximate and never shown as exact.
  const ethUsdPlaceholder = 3_200;
  const costEth = costWei / 1e18;
  const costUsd = costEth * ethUsdPlaceholder;

  // Format as "$0.XX" — cap display to two decimal places.
  if (costUsd < 0.01) return '< $0.01';
  if (costUsd > 99) return '> $99';
  return `~$${costUsd.toFixed(2)}`;
}

export async function GET(): Promise<NextResponse> {
  try {
    const gasUsd = await estimateGasUsd();
    const stats: BridgeStats = {
      estimatedTimeSec: BRIDGE_PARAMS.estimatedTimeSec,
      challengeWindowSec: BRIDGE_PARAMS.challengeWindowSec,
      relayerFeeBps: BRIDGE_PARAMS.relayerFeeBps,
      gasUsd,
    };
    return NextResponse.json(stats);
  } catch {
    // RPC unavailable or rate-limited — silently return fallback values so the
    // bridge widget always has something to display.
    return NextResponse.json(FALLBACK);
  }
}
