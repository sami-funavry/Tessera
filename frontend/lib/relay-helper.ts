/**
 * Server-side relayer-impersonator for the hackathon demo.
 *
 * In a production Tessera deployment the Go relayer (`relayer/cmd/relayer`)
 * watches source-chain events, fetches a Patricia/IAVL proof, transforms it
 * deterministically, and submits to the destination Verifier. The Verifier
 * cryptographically verifies the proof and then dispatches `IApp.onCrossChainMessage`
 * to mint or release tokens.
 *
 * The relay code in this file does the *same outcome* — destination tokens
 * delivered, real tx hash on the destination explorer — without going through
 * Verifier. It uses the deployer / relayer wallets directly to transfer tUSDC
 * to the recipient. This is explicitly hackathon scope and is documented as
 * such in the in-app docs.
 *
 * The proof verification path is the engineering achievement of the project;
 * the demo path is what the user actually exercises through the bridge widget.
 */

import 'server-only';

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

import { ERC20_ABI } from '@/lib/bridgeAbis';

// ─── Constants ────────────────────────────────────────────────────────────────

export const SEPOLIA_TUSDC =
  '0x7dcA285EFe722EdC1D9c93C3878fb58b255EC5B0' as const;
export const NEUTRON_TUSDC =
  'neutron1fw6unz7a9j4zf9gnvhup5qe6dlftytdc0y0rwyn3lyxdazz22rtsck0vld' as const;

// 18 decimals on Sepolia, 6 decimals on Neutron — convert by ×/÷ 10^12
const SEPOLIA_DECIMALS = 18;
const NEUTRON_DECIMALS = 6;

// CW20 transfer is ~150k gas on Neutron; pad to 250k. Min gas price on pion-1
// is 0.025 untrn/gas so the fee floor is 6250 untrn.
const NEUTRON_GAS = 250_000;
const NEUTRON_FEE_AMOUNT = '6250';

// Public Neutron pion-1 RPCs to fail over between when the primary RPC is
// unavailable. Order matters: most reliable first. If you add an authenticated
// RPC, prepend it via the `NEUTRON_RPC_URL` env var.
const NEUTRON_RPC_FALLBACKS = [
  'https://neutron-testnet-rpc.polkachu.com',
  'https://rpc-falcron.pion-1.ntrn.tech',
  'https://rpc-palvus.pion-1.ntrn.tech',
] as const;

// ─── Result type ──────────────────────────────────────────────────────────────

export interface RelayResult {
  destTxHash: string;
  destBlock: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildNeutronRpcList(): string[] {
  const primary = process.env.NEUTRON_RPC_URL?.trim();
  return primary
    ? [primary, ...NEUTRON_RPC_FALLBACKS.filter((u) => u !== primary)]
    : [...NEUTRON_RPC_FALLBACKS];
}

function loadRelayerKey(): Uint8Array {
  const privKey = process.env.RELAYER_A_PRIVATE_KEY;
  if (!privKey || privKey.length < 60) {
    throw new Error(
      'RELAYER_A_PRIVATE_KEY is not configured on the server. ' +
        'Set it in `.env.local` to enable the demo relayer.',
    );
  }
  const cleanKey = privKey.replace(/^0x/, '');
  return Uint8Array.from(Buffer.from(cleanKey, 'hex'));
}

// ─── Sepolia → Neutron simulator ──────────────────────────────────────────────

/**
 * After the user's lock confirms on Sepolia, deliver `amount` tUSDC to
 * `recipient` on Neutron via cw20 Transfer from the deployer wallet.
 *
 * Returns the real Neutron tx hash and block height — both verifiable on
 * Celatone.
 *
 * Hardened against transient RPC failures: tries a list of public Neutron
 * RPC endpoints in order, only retrying if the failure is *connection*-level
 * (DNS / 5xx / timeout). Contract-level errors (insufficient balance, invalid
 * recipient) are not retried — they surface immediately with a clear message.
 *
 * @param amountWei amount as 18-decimal wei string from the lock event
 * @param recipient neutron1... address that should receive the tokens
 */
export async function relaySepoliaToNeutron(
  amountWei: string,
  recipient: string,
): Promise<RelayResult> {
  if (!recipient.startsWith('neutron1')) {
    throw new Error(`Invalid Neutron recipient address: ${recipient}`);
  }

  // Convert 18-decimal Sepolia amount → 6-decimal Neutron amount.
  // 10 tUSDC on Sepolia = 10 * 10^18 wei = 10 * 10^6 uTUSDC on Neutron.
  const amountSep = BigInt(amountWei);
  const decimalDiff = BigInt(SEPOLIA_DECIMALS - NEUTRON_DECIMALS);
  const amountNeu = amountSep / (BigInt(10) ** decimalDiff);
  if (amountNeu === BigInt(0)) {
    throw new Error(
      `Bridge amount ${amountWei} wei is below the Neutron 6-decimal floor`,
    );
  }

  const privBytes = loadRelayerKey();
  // Lazy import — keeps these dependencies out of edge bundles.
  const { DirectSecp256k1Wallet } = await import('@cosmjs/proto-signing');
  const { SigningCosmWasmClient } = await import('@cosmjs/cosmwasm-stargate');
  const wallet = await DirectSecp256k1Wallet.fromKey(privBytes, 'neutron');
  const [{ address: senderAddr }] = await wallet.getAccounts();

  // Manual fee — see NEUTRON_GAS / NEUTRON_FEE_AMOUNT for derivation.
  const fee = {
    amount: [{ denom: 'untrn', amount: NEUTRON_FEE_AMOUNT }],
    gas: NEUTRON_GAS.toString(),
  };

  const rpcs = buildNeutronRpcList();
  const errors: string[] = [];

  for (const rpc of rpcs) {
    let client: Awaited<ReturnType<typeof SigningCosmWasmClient.connectWithSigner>> | null = null;
    try {
      // Connect WITHOUT a gasPrice option to avoid the dual-version GasPrice
      // structural mismatch between @cosmjs/stargate 0.38 (transitive) and 0.39
      // (direct dep). We pass an explicit fee on each call instead.
      client = await SigningCosmWasmClient.connectWithSigner(rpc, wallet);

      // Pre-flight checks. Catching obvious failure modes here means the user
      // sees "Relayer A out of NTRN for gas" instead of an opaque CosmJS stack
      // trace. These are read-only queries, cheap to run.
      const untrnBalance = await client.getBalance(senderAddr, 'untrn');
      if (BigInt(untrnBalance.amount) < BigInt(NEUTRON_FEE_AMOUNT)) {
        throw new RelayHardError(
          `Relayer A wallet ${senderAddr} has only ${untrnBalance.amount} untrn ` +
            `(needs ≥ ${NEUTRON_FEE_AMOUNT} for the gas fee). ` +
            `Top it up at the Neutron testnet faucet: https://docs.neutron.org/neutron/faq#how-do-i-get-testnet-tokens.`,
        );
      }

      const cw20Bal = (await client.queryContractSmart(NEUTRON_TUSDC, {
        balance: { addr: senderAddr },
      })) as string | { balance?: string };
      const cw20Amount = BigInt(typeof cw20Bal === 'string' ? cw20Bal : cw20Bal.balance ?? '0');
      if (cw20Amount < amountNeu) {
        throw new RelayHardError(
          `Relayer A wallet ${senderAddr} has ${cw20Amount} uTUSDC on Neutron, ` +
            `needs ${amountNeu}. Re-run scripts/fund-all-neutron-v2.js to refill.`,
        );
      }

      const result = await client.execute(
        senderAddr,
        NEUTRON_TUSDC,
        { transfer: { recipient, amount: amountNeu.toString() } },
        fee,
      );

      return {
        destTxHash: result.transactionHash,
        destBlock: result.height,
      };
    } catch (err) {
      // Hard errors (caught above) are never retried — surface immediately.
      if (err instanceof RelayHardError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${rpc} → ${msg}`);
      // Try next RPC unless this looks like a contract revert (which won't
      // change between RPCs).
      if (looksLikeContractRevert(msg)) {
        throw new Error(
          `Neutron contract execution failed (will not retry on another RPC): ${msg}`,
        );
      }
      // continue loop
    } finally {
      try {
        client?.disconnect();
      } catch {
        /* ignore disconnect errors */
      }
    }
  }

  throw new Error(
    `All Neutron RPC endpoints failed for relaySepoliaToNeutron. ` +
      `Last errors: ${errors.join(' | ')}`,
  );
}

// ─── Neutron → Sepolia simulator ──────────────────────────────────────────────

/**
 * After the user's burn confirms on Neutron, deliver `amount` tUSDC to
 * `recipient` on Sepolia via ERC20 transfer from a pre-funded simulator
 * wallet (Relayer A's Sepolia wallet, which has ~1490 tUSDC).
 *
 * Returns the real Sepolia tx hash and block — verifiable on Etherscan.
 *
 * @param amountUtusdc amount as 6-decimal string from the burn (raw uTUSDC)
 * @param recipient 0x... EVM address that should receive the tokens
 */
export async function relayNeutronToSepolia(
  amountUtusdc: string,
  recipient: string,
): Promise<RelayResult> {
  if (!recipient.startsWith('0x') || recipient.length !== 42) {
    throw new Error(`Invalid EVM recipient address: ${recipient}`);
  }
  const privKey = process.env.RELAYER_A_PRIVATE_KEY;
  if (!privKey || privKey.length < 60) {
    throw new Error('RELAYER_A_PRIVATE_KEY is not configured on the server.');
  }
  const rpcUrl =
    process.env.ALCHEMY_SEPOLIA_URL ??
    process.env.ETHEREUM_SEPOLIA_ENDPOINT ??
    process.env.ETHERUM_SEPOLIA_ENDPOINT ??
    'https://rpc.sepolia.org';

  // Convert 6-decimal Neutron amount → 18-decimal Sepolia amount.
  const amountNeu = BigInt(amountUtusdc);
  const decimalDiff = BigInt(SEPOLIA_DECIMALS - NEUTRON_DECIMALS);
  const amountSep = amountNeu * (BigInt(10) ** decimalDiff);

  const account = privateKeyToAccount(privKey as Hex);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport,
  });

  // Pre-flight: verify the relayer has enough tUSDC + ETH for gas. Cheap
  // reads up front beat opaque on-chain reverts.
  const tusdcBal = await publicClient.readContract({
    address: SEPOLIA_TUSDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  if (tusdcBal < amountSep) {
    throw new Error(
      `Relayer A wallet ${account.address} has ${tusdcBal} tUSDC wei on Sepolia, ` +
        `needs ${amountSep}. Mint more via the in-app "Get test tokens" flow on Sepolia.`,
    );
  }
  const ethBal = await publicClient.getBalance({ address: account.address });
  // 21000 base + ~50000 ERC20 transfer + buffer at ~5 gwei → ~5e14 wei minimum
  if (ethBal < BigInt('500000000000000')) {
    throw new Error(
      `Relayer A wallet ${account.address} has ${ethBal} wei ETH on Sepolia, ` +
        `which is too low for gas. Top up at https://sepolia-faucet.pk910.de.`,
    );
  }

  // Add 'transfer' to ERC20_ABI inline (not in shared ABI to keep bridge widget surface minimal).
  const TRANSFER_ABI = [
    ...ERC20_ABI,
    {
      type: 'function',
      name: 'transfer',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      outputs: [{ name: '', type: 'bool' }],
    },
  ] as const;

  const txHash = await walletClient.writeContract({
    address: SEPOLIA_TUSDC,
    abi: TRANSFER_ABI,
    functionName: 'transfer',
    args: [recipient as Hex, amountSep],
  });

  // Audit fix PROD-06: cap how long we wait. Without a timeout, a Sepolia RPC
  // stall would hang the API request until the platform's hard limit kills it,
  // leaving the user staring at a spinner with no failure signal.
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 90_000,
  });
  if (receipt.status !== 'success') {
    throw new Error(
      `Sepolia transfer reverted on-chain (tx ${txHash}). Check Etherscan for revert reason.`,
    );
  }

  return {
    destTxHash: txHash,
    destBlock: Number(receipt.blockNumber),
  };
}

// ─── Burn helper for the bridge widget Neutron → Sepolia path ────────────────

/**
 * Build a CosmJS execute message that burns / transfers tUSDC from the user's
 * Neutron wallet to a sink, signaling intent to bridge to Sepolia. We use the
 * simple `transfer` action (sending to the BridgeMint contract) so it shows up
 * as a real outgoing CW20 transfer on Celatone, then the simulator handles the
 * Sepolia-side delivery.
 */
export const NEUTRON_BRIDGE_SINK =
  'neutron18am0spqaanz75mh2tl43ychhvf537wcklf3rjlv0y03tvrn6gdksq8ltt7' as const;

// ─── Internal error class & heuristics ────────────────────────────────────────

/**
 * Thrown for failures that won't be cured by switching RPCs (insufficient
 * balance, missing key, contract-level revert). The retry loop re-throws these
 * immediately rather than burning through every fallback endpoint.
 */
class RelayHardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayHardError';
  }
}

function looksLikeContractRevert(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('execute wasm contract failed') ||
    lower.includes('insufficient funds') ||
    lower.includes('account sequence mismatch') ||
    lower.includes('out of gas') ||
    lower.includes('failed to execute message')
  );
}
