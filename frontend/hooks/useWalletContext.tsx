'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useConnect, useConnection, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { connectKeplr } from '@/lib/keplr';
import type { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';

// ---------- types ----------

interface WalletContextValue {
  /** The connected EVM address, or undefined when not connected. */
  evmAddress: `0x${string}` | undefined;
  /** The connected Neutron bech32 address, or null when not connected. */
  neutronAddress: string | null;
  /** Signing client obtained during Keplr connection; null when not connected. */
  cosmWasmClient: SigningCosmWasmClient | null;
  isEvmConnected: boolean;
  isKeplrConnected: boolean;
  /** True only when both wallets are connected. */
  isFullyConnected: boolean;
  /** Trigger MetaMask / injected wallet connection. */
  connectEvm: () => void;
  /** Trigger Keplr connection for Neutron. */
  connectKeplrWallet: () => Promise<void>;
  /** Disconnect the EVM wallet. */
  disconnectEvm: () => void;
  /** Clear Keplr state (does not revoke Keplr permissions — that requires a browser action). */
  disconnectKeplr: () => void;
}

// ---------- context ----------

const WalletContext = createContext<WalletContextValue | null>(null);

// ---------- provider ----------

/**
 * Wraps the application with combined EVM (wagmi) and Cosmos (Keplr) wallet
 * state. Must be rendered inside both WagmiProvider and QueryClientProvider.
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const connection = useConnection();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  const [neutronAddress, setNeutronAddress] = useState<string | null>(null);
  const [cosmWasmClient, setCosmWasmClient] =
    useState<SigningCosmWasmClient | null>(null);

  const evmAddress = connection.isConnected ? connection.address : undefined;
  const isEvmConnected = connection.isConnected;
  const isKeplrConnected = neutronAddress !== null;
  const isFullyConnected = isEvmConnected && isKeplrConnected;

  // Attempt to restore Keplr connection silently on mount (best-effort).
  // We do not call connectKeplr() here because that would prompt the user
  // immediately; instead we use getKeplrAddress which only reads already-
  // enabled chains.
  useEffect(() => {
    let cancelled = false;
    async function tryRestore() {
      if (typeof window === 'undefined') return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const keplr = (window as any).keplr;
      if (!keplr) return;
      try {
        const chainId =
          process.env.NEXT_PUBLIC_NEUTRON_CHAIN_ID ?? 'pion-1';
        await keplr.enable(chainId);
        const key = await keplr.getKey(chainId);
        if (!cancelled && key?.bech32Address) {
          // Re-establish the signing client silently.
          const result = await connectKeplr();
          if (!cancelled && result) {
            setNeutronAddress(result.address);
            setCosmWasmClient(result.client);
          }
        }
      } catch {
        // Keplr not unlocked or chain not added yet — expected on first load.
      }
    }
    tryRestore();
    return () => {
      cancelled = true;
    };
  }, []);

  const connectEvm = useCallback(() => {
    connect({ connector: injected() });
  }, [connect]);

  const connectKeplrWallet = useCallback(async () => {
    const result = await connectKeplr();
    if (result) {
      setNeutronAddress(result.address);
      setCosmWasmClient(result.client);
    }
  }, []);

  const disconnectEvm = useCallback(() => {
    disconnect();
  }, [disconnect]);

  const disconnectKeplr = useCallback(() => {
    setNeutronAddress(null);
    setCosmWasmClient(null);
  }, []);

  const value: WalletContextValue = {
    evmAddress,
    neutronAddress,
    cosmWasmClient,
    isEvmConnected,
    isKeplrConnected,
    isFullyConnected,
    connectEvm,
    connectKeplrWallet,
    disconnectEvm,
    disconnectKeplr,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

// ---------- hook ----------

/**
 * Consume the combined wallet context. Must be called inside WalletProvider.
 */
export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWalletContext must be used inside WalletProvider');
  }
  return ctx;
}
