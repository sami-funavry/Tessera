'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Coins, ExternalLink, RefreshCw } from 'lucide-react';
import { useWalletClient, usePublicClient } from 'wagmi';
import { ADDRESSES, RELAYER_ADDRESSES } from '@/lib/config';
import { useWalletContext } from '@/hooks/useWalletContext';
import { useToast } from '@/hooks/useToast';
import { neutronFee } from '@/lib/keplr';
import {
  adminFetch,
  captureAdminTokenFromUrl,
  getAdminToken,
  setAdminToken,
} from '@/lib/adminToken';
import Card from '@/components/Card';
import SectionLabel from '@/components/SectionLabel';

// Inline ABI for the public tUSDC.claim() — selector 0x4e71d92d.
const TUSDC_CLAIM_ABI = [
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const;

const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

interface BalanceState {
  userSepolia: string | null;
  userNeutron: string | null;
  relayerASepolia: string | null;
  relayerANeutron: string | null;
  relayerBSepolia: string | null;
  relayerBNeutron: string | null;
}

const initialBalances: BalanceState = {
  userSepolia: null,
  userNeutron: null,
  relayerASepolia: null,
  relayerANeutron: null,
  relayerBSepolia: null,
  relayerBNeutron: null,
};

export default function AdminPage() {
  const router = useRouter();
  const { evmAddress, neutronAddress, cosmWasmClient } = useWalletContext();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { toast } = useToast();

  const [balances, setBalances] = useState<BalanceState>(initialBalances);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Admin-token gate (P-10.11). Page renders the gate UI until the visitor
  // either supplies a token via the URL parameter or pastes one. The token is
  // never stored beyond sessionStorage.
  const [tokenReady, setTokenReady] = useState<'pending' | 'ready' | 'missing'>('pending');
  const [tokenInput, setTokenInput] = useState('');

  useEffect(() => {
    const fromUrl = captureAdminTokenFromUrl();
    if (fromUrl) {
      setTokenReady('ready');
      return;
    }
    if (getAdminToken()) {
      setTokenReady('ready');
      return;
    }
    setTokenReady('missing');
  }, []);

  /**
   * Fetch tUSDC balances on both chains for user + both relayers.
   * Uses the connected publicClient for Sepolia and a fresh CosmWasmClient
   * for Neutron (we don't want to mutate the connected signing client).
   */
  async function refreshBalances() {
    setRefreshing(true);
    try {
      const sepBalance = async (addr: `0x${string}`): Promise<string> => {
        if (!publicClient) return '—';
        try {
          const raw = (await publicClient.readContract({
            address: ADDRESSES.sepolia.tusdc as `0x${string}`,
            abi: ERC20_BALANCE_ABI,
            functionName: 'balanceOf',
            args: [addr],
          })) as bigint;
          return (Number(raw) / 1e18).toFixed(2);
        } catch {
          return 'err';
        }
      };

      const neuBalance = async (addr: string): Promise<string> => {
        try {
          const { CosmWasmClient } = await import('@cosmjs/cosmwasm-stargate');
          const rpc =
            process.env.NEXT_PUBLIC_NEUTRON_RPC_URL ??
            'https://neutron-testnet-rpc.polkachu.com';
          const client = await CosmWasmClient.connect(rpc);
          const raw = await client.queryContractSmart(ADDRESSES.neutron.tusdc, {
            balance: { addr },
          });
          return (Number(raw) / 1e6).toFixed(2);
        } catch {
          return 'err';
        }
      };

      const [uS, uN, raS, raN, rbS, rbN] = await Promise.all([
        evmAddress ? sepBalance(evmAddress) : Promise.resolve('—'),
        neutronAddress ? neuBalance(neutronAddress) : Promise.resolve('—'),
        sepBalance(RELAYER_ADDRESSES.A.sepolia as `0x${string}`),
        neuBalance(RELAYER_ADDRESSES.A.neutron),
        sepBalance(RELAYER_ADDRESSES.B.sepolia as `0x${string}`),
        neuBalance(RELAYER_ADDRESSES.B.neutron),
      ]);

      setBalances({
        userSepolia: uS,
        userNeutron: uN,
        relayerASepolia: raS,
        relayerANeutron: raN,
        relayerBSepolia: rbS,
        relayerBNeutron: rbN,
      });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    refreshBalances();
    // Re-fetch when wallets connect/disconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evmAddress, neutronAddress]);

  // ─── User-side claims (signed by connected wallet) ──────────────────────────

  async function userClaimSepolia() {
    if (!walletClient || !publicClient || !evmAddress) {
      toast({ title: 'Connect MetaMask first', variant: 'error' });
      return;
    }
    setBusy('userSepolia');
    try {
      const txHash = await walletClient.writeContract({
        address: ADDRESSES.sepolia.tusdc as `0x${string}`,
        abi: TUSDC_CLAIM_ABI,
        functionName: 'claim',
        args: [],
      });
      toast({
        title: 'Claim submitted on Sepolia',
        description: `Tx: ${txHash.slice(0, 10)}…`,
        variant: 'info',
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
      toast({
        title: 'Claimed 1000 tUSDC on Sepolia',
        description: 'Balance refreshing.',
        variant: 'success',
      });
      await refreshBalances();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message.slice(0, 200) : 'Failed';
      toast({ title: 'Sepolia claim failed', description: msg, variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function userClaimNeutron() {
    if (!cosmWasmClient || !neutronAddress) {
      toast({ title: 'Connect Keplr first', variant: 'error' });
      return;
    }
    setBusy('userNeutron');
    try {
      const result = await cosmWasmClient.execute(
        neutronAddress,
        ADDRESSES.neutron.tusdc,
        { claim: {} },
        neutronFee(250_000),
      );
      toast({
        title: 'Claimed 1000 tUSDC on Neutron',
        description: `Tx: ${result.transactionHash.slice(0, 10)}…`,
        variant: 'success',
      });
      await refreshBalances();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Failed';
      // The contract returns "ClaimRateLimit" (or similar) when called twice
      // in 24 h, and Keplr surfaces "insufficient funds" when the wallet has
      // no NTRN for gas. Translate both into something users can act on.
      const lower = raw.toLowerCase();
      let hint = raw.slice(0, 200);
      if (lower.includes('ratelimit') || lower.includes('rate limit') || lower.includes('cooldown')) {
        hint = 'Already claimed in the last 24 h. The tUSDC contract enforces one claim per address per day — try again tomorrow.';
      } else if (lower.includes('insufficient funds') || lower.includes('account does not exist') || lower.includes('untrn')) {
        hint = 'Keplr wallet has no NTRN for gas. Get pion-1 NTRN from a Neutron testnet faucet first, then retry.';
      }
      toast({ title: 'Neutron claim failed', description: hint, variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  // ─── Relayer claims (server-side proxy with admin secret) ───────────────────

  async function relayerClaim(relayer: 'a' | 'b', chain: 'sepolia' | 'neutron') {
    const key = `relayer${relayer.toUpperCase()}${chain === 'sepolia' ? 'Sepolia' : 'Neutron'}`;
    setBusy(key);
    try {
      const res = await adminFetch('/api/admin/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chain, relayer }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? 'Claim failed');
      }
      toast({
        title: `Relayer ${relayer.toUpperCase()} claimed on ${chain}`,
        description: data.tx_hash ? `Tx: ${String(data.tx_hash).slice(0, 10)}…` : '',
        variant: 'success',
      });
      // P-10.13 (B-7): wait long enough for the tx to mine + the RPC node
      // to index the post-tx balance state. 4s was too short for Sepolia
      // (~12s blocks) and balance reads returned the stale pre-claim value.
      // Sepolia: 25s covers two blocks + indexing. Neutron: 8s covers ~3
      // blocks at ~2.5s each.
      const claimWaitMs = chain === 'sepolia' ? 25_000 : 8_000;
      setTimeout(() => refreshBalances(), claimWaitMs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed';
      toast({
        title: `Relayer ${relayer.toUpperCase()} ${chain} claim failed`,
        description: msg,
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  }

  // ─── Reverse-direction demo (Neutron → Sepolia) ────────────────────────────

  async function triggerBurn(which: 'a' | 'b') {
    const key = `triggerBurn${which.toUpperCase()}`;
    setBusy(key);
    try {
      const res = await adminFetch('/api/admin/trigger-burn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 10, relayer: which }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? 'trigger-burn failed');
      }
      const tx = data.tx_hash as string | undefined;
      toast({
        title: `Relayer ${which.toUpperCase()} burned 10 tUSDC on Neutron`,
        description: tx
          ? `Tx ${tx.slice(0, 10)}… — relayer will now submit to Sepolia Verifier.`
          : 'Burn submitted; watch the dashboard for the Sepolia destination tx.',
        variant: 'success',
      });
      // P-10.13 (B-7): trigger-burn is a full cross-chain bridge — the
      // relayer's Neutron balance drops immediately on burn (~3s), but the
      // recipient's Sepolia balance only changes after the 60s challenge
      // window + ~5s execute. Refresh once early (Neutron side) and once
      // late (Sepolia side) so both deltas land.
      setTimeout(() => refreshBalances(), 8_000);
      setTimeout(() => refreshBalances(), 90_000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed';
      toast({
        title: `Relayer ${which.toUpperCase()} burn failed`,
        description: msg,
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (tokenReady === 'pending') {
    // Brief flash while we decide if a token is present. Returning null avoids
    // rendering the full admin UI before the gate decision is made.
    return null;
  }

  if (tokenReady === 'missing') {
    return (
      <div className="max-w-md mx-auto px-4 sm:px-6 py-16">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-2">
          Admin · Restricted
        </div>
        <h1 className="font-display text-3xl text-stone-100 mb-3">
          Admin link required.
        </h1>
        <p className="text-sm text-stone-400 mb-6 leading-relaxed">
          This page funds the relayers and the connected user wallet — destructive
          actions, gated by a shared token. Open this page via the share link
          (which carries the token) or paste it below.
        </p>
        <input
          type="password"
          autoFocus
          placeholder="Admin token"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tokenInput.trim()) {
              setAdminToken(tokenInput.trim());
              setTokenReady('ready');
            }
          }}
          className="w-full px-3 py-2.5 bg-stone-900 border border-stone-800 rounded text-sm text-stone-100 placeholder:text-stone-600 focus:outline-none focus:border-stone-700 font-mono"
        />
        <button
          onClick={() => {
            if (!tokenInput.trim()) return;
            setAdminToken(tokenInput.trim());
            setTokenReady('ready');
          }}
          className="mt-3 px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-100 text-sm rounded transition-colors disabled:opacity-50"
          disabled={!tokenInput.trim()}
        >
          Unlock
        </button>
        <button
          onClick={() => router.push('/')}
          className="mt-3 ml-3 text-xs text-stone-500 hover:text-stone-300 transition-colors"
        >
          Back to bridge
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <button
        onClick={() => router.push('/')}
        className="text-xs text-stone-500 hover:text-stone-300 mb-3 flex items-center gap-1.5 transition-colors"
      >
        <ArrowRight size={11} className="rotate-180" /> Back
      </button>

      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 mb-2">
        Admin · Funding
      </div>
      <h1 className="font-display text-4xl sm:text-5xl text-stone-100 mb-3">
        Top up tUSDC
      </h1>
      <p className="text-stone-400 mb-10 max-w-2xl">
        Each wallet can claim 1000 tUSDC per 24 h on each chain. User claims are signed by the connected wallet (MetaMask / Keplr); relayer claims are signed server-side by the deployed relayer service.
      </p>

      <div className="flex justify-end mb-4">
        <button
          onClick={refreshBalances}
          disabled={refreshing}
          className="text-xs text-stone-400 hover:text-stone-200 flex items-center gap-1.5 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
          Refresh balances
        </button>
      </div>

      <Card className="overflow-x-auto mb-8">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="border-b border-stone-800 bg-stone-950/40">
            <tr className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              <th className="text-left px-5 py-3">Wallet</th>
              <th className="text-left px-5 py-3">Sepolia tUSDC</th>
              <th className="text-left px-5 py-3">Neutron tUSDC</th>
              <th className="text-left px-5 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            <Row
              label="Your wallet"
              sub={
                evmAddress
                  ? `${evmAddress.slice(0, 8)}… / ${neutronAddress?.slice(0, 12) ?? '—'}…`
                  : 'Connect MetaMask + Keplr'
              }
              sepolia={balances.userSepolia}
              neutron={balances.userNeutron}
              actions={
                <div className="flex flex-wrap gap-2">
                  <ClaimButton
                    label="Claim Sepolia"
                    busy={busy === 'userSepolia'}
                    disabled={!evmAddress || busy !== null}
                    onClick={userClaimSepolia}
                  />
                  <ClaimButton
                    label="Claim Neutron"
                    busy={busy === 'userNeutron'}
                    disabled={!neutronAddress || busy !== null}
                    onClick={userClaimNeutron}
                  />
                </div>
              }
            />
            <Row
              label="Relayer A"
              sub={`${RELAYER_ADDRESSES.A.sepolia.slice(0, 8)}… / ${RELAYER_ADDRESSES.A.neutron.slice(0, 12)}…`}
              sepolia={balances.relayerASepolia}
              neutron={balances.relayerANeutron}
              actions={
                <div className="flex flex-wrap gap-2">
                  <ClaimButton
                    label="Claim Sepolia"
                    busy={busy === 'relayerASepolia'}
                    disabled={busy !== null}
                    onClick={() => relayerClaim('a', 'sepolia')}
                  />
                  <ClaimButton
                    label="Claim Neutron"
                    busy={busy === 'relayerANeutron'}
                    disabled={busy !== null}
                    onClick={() => relayerClaim('a', 'neutron')}
                  />
                </div>
              }
            />
            <Row
              label="Relayer B"
              sub={`${RELAYER_ADDRESSES.B.sepolia.slice(0, 8)}… / ${RELAYER_ADDRESSES.B.neutron.slice(0, 12)}…`}
              sepolia={balances.relayerBSepolia}
              neutron={balances.relayerBNeutron}
              actions={
                <div className="flex flex-wrap gap-2">
                  <ClaimButton
                    label="Claim Sepolia"
                    busy={busy === 'relayerBSepolia'}
                    disabled={busy !== null}
                    onClick={() => relayerClaim('b', 'sepolia')}
                  />
                  <ClaimButton
                    label="Claim Neutron"
                    busy={busy === 'relayerBNeutron'}
                    disabled={busy !== null}
                    onClick={() => relayerClaim('b', 'neutron')}
                  />
                </div>
              }
            />
          </tbody>
        </table>
      </Card>

      <SectionLabel className="mb-3">Demo · Neutron → Sepolia</SectionLabel>
      <Card className="mb-8 p-5">
        <p className="text-sm text-stone-400 mb-4">
          Trigger a real <code className="font-mono text-xs bg-stone-900 px-1">BridgeMint.Burn</code> from the
          relayer&rsquo;s own wallet on Neutron. The relayer&rsquo;s
          <code className="font-mono text-xs bg-stone-900 px-1 mx-1">SubscribeEvents</code>
          loop scans for <code className="font-mono text-xs bg-stone-900 px-1">wasm.action=&apos;burn&apos;</code>,
          fetches an IAVL proof, transforms it to Patricia/Keccak, and submits to the Sepolia Verifier — same
          pipeline as the Sepolia → Neutron direction, just reversed.
        </p>
        <div className="flex flex-wrap gap-2">
          <ClaimButton
            label="Burn 10 tUSDC · Relayer A"
            busy={busy === 'triggerBurnA'}
            disabled={busy !== null}
            onClick={() => triggerBurn('a')}
          />
          <ClaimButton
            label="Burn 10 tUSDC · Relayer B"
            busy={busy === 'triggerBurnB'}
            disabled={busy !== null}
            onClick={() => triggerBurn('b')}
          />
        </div>
      </Card>

      <SectionLabel className="mb-3">Notes</SectionLabel>
      <div className="text-sm text-stone-400 space-y-2">
        <p>
          <strong className="text-stone-200">Daily rate limit:</strong> the tUSDC contract enforces 1 claim per address per 24 h. If a claim fails, the wallet probably already claimed today.
        </p>
        <p>
          <strong className="text-stone-200">Native gas:</strong> Sepolia ETH and Neutron NTRN are NOT topped up here — those need a faucet (Sepolia faucets, Neutron pion-1 faucet at https://docs.neutron.org/). If a claim fails with &ldquo;insufficient funds&rdquo;, get gas first.
        </p>
        <p>
          <strong className="text-stone-200">Relayer B:</strong> requires <code className="font-mono text-xs bg-stone-900 px-1">RELAYER_B_ADMIN_URL</code> on the frontend. If unset, the relayer-B claim button returns 503.
        </p>
      </div>

      <div className="mt-10 flex items-center gap-2">
        <Coins size={14} className="text-orange-400" />
        <a
          href="https://docs.neutron.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1.5"
        >
          Neutron pion-1 NTRN faucet
          <ExternalLink size={11} />
        </a>
        <span className="text-stone-700 mx-2">·</span>
        <a
          href="https://www.alchemy.com/faucets/ethereum-sepolia"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1.5"
        >
          Sepolia ETH faucet
          <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}

function Row({
  label,
  sub,
  sepolia,
  neutron,
  actions,
}: {
  label: string;
  sub: string;
  sepolia: string | null;
  neutron: string | null;
  actions: React.ReactNode;
}) {
  return (
    <tr className="border-b border-stone-800/60 last:border-b-0">
      <td className="px-5 py-4">
        <div className="text-stone-100 font-medium">{label}</div>
        <div className="text-[10px] font-mono text-stone-500 mt-1">{sub}</div>
      </td>
      <td className="px-5 py-4 font-mono text-stone-200">{sepolia ?? '…'}</td>
      <td className="px-5 py-4 font-mono text-stone-200">{neutron ?? '…'}</td>
      <td className="px-5 py-4">{actions}</td>
    </tr>
  );
}

function ClaimButton({
  label,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className="text-xs px-3 py-1.5 bg-orange-400/10 border border-orange-400/30 rounded-sm text-orange-300 hover:bg-orange-400/20 hover:text-orange-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
    >
      {busy && <RefreshCw size={11} className="animate-spin" />}
      {label}
    </button>
  );
}
