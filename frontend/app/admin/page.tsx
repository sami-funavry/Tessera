'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Coins, ExternalLink, RefreshCw } from 'lucide-react';
import { useWalletClient, usePublicClient } from 'wagmi';
import { ADDRESSES, RELAYER_ADDRESSES } from '@/lib/config';
import { useWalletContext } from '@/hooks/useWalletContext';
import { useToast } from '@/hooks/useToast';
import { neutronFee } from '@/lib/keplr';
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
      const msg = err instanceof Error ? err.message.slice(0, 200) : 'Failed';
      toast({ title: 'Neutron claim failed', description: msg, variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  // ─── Relayer claims (server-side proxy with admin secret) ───────────────────

  async function relayerClaim(relayer: 'a' | 'b', chain: 'sepolia' | 'neutron') {
    const key = `relayer${relayer.toUpperCase()}${chain === 'sepolia' ? 'Sepolia' : 'Neutron'}`;
    setBusy(key);
    try {
      const res = await fetch('/api/admin/claim', {
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
      // Give the chain a few seconds to commit before refreshing.
      setTimeout(() => refreshBalances(), 4000);
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

  // ─── Render ────────────────────────────────────────────────────────────────

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

      <SectionLabel className="mb-3">Notes</SectionLabel>
      <div className="text-sm text-stone-400 space-y-2">
        <p>
          <strong className="text-stone-200">Daily rate limit:</strong> the tUSDC contract enforces 1 claim per address per 24 h. If a claim fails, the wallet probably already claimed today.
        </p>
        <p>
          <strong className="text-stone-200">Native gas:</strong> Sepolia ETH and Neutron NTRN are NOT topped up here — those need a faucet (Sepolia faucets, Neutron pion-1 faucet at https://docs.neutron.org/neutron/faq/#how-do-i-get-test-tokens). If a claim fails with &ldquo;insufficient funds&rdquo;, get gas first.
        </p>
        <p>
          <strong className="text-stone-200">Relayer B:</strong> requires <code className="font-mono text-xs bg-stone-900 px-1">RELAYER_B_ADMIN_URL</code> on the frontend. If unset, the relayer-B claim button returns 503.
        </p>
      </div>

      <div className="mt-10 flex items-center gap-2">
        <Coins size={14} className="text-orange-400" />
        <a
          href="https://docs.neutron.org/neutron/faq/#how-do-i-get-test-tokens"
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
