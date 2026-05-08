'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWalletContext } from '@/hooks/useWalletContext';

interface WalletConnectModalProps {
  open: boolean;
  onClose: () => void;
}

interface WalletOption {
  id: 'metamask' | 'keplr';
  name: string;
  description: string;
  /** Inline SVG path data or a small JSX icon element. */
  icon: React.ReactNode;
  installUrl: string;
  installLabel: string;
}

/** MetaMask block-letter M rendered as a small inline SVG. */
function MetaMaskIcon() {
  return (
    <span
      aria-hidden="true"
      className="flex items-center justify-center w-9 h-9 rounded-lg bg-orange-400/15 border border-orange-400/30 text-orange-400 font-display text-lg leading-none select-none"
    >
      M
    </span>
  );
}

/** Keplr "K" badge in Keplr brand pink. */
function KeplrIcon() {
  return (
    <span
      aria-hidden="true"
      className="flex items-center justify-center w-9 h-9 rounded-lg bg-pink-500/15 border border-pink-500/30 text-pink-400 font-display text-lg leading-none select-none"
    >
      K
    </span>
  );
}

const WALLETS: WalletOption[] = [
  {
    id: 'metamask',
    name: 'MetaMask',
    description: 'Connect to Sepolia via MetaMask or any injected EVM wallet.',
    icon: <MetaMaskIcon />,
    installUrl: 'https://metamask.io/download/',
    installLabel: 'Install MetaMask',
  },
  {
    id: 'keplr',
    name: 'Keplr',
    description: 'Connect to Neutron (pion-1) via Keplr browser extension.',
    icon: <KeplrIcon />,
    installUrl: 'https://www.keplr.app/download',
    installLabel: 'Install Keplr',
  },
];

/**
 * Modal that lets the user connect MetaMask (EVM / Sepolia) and Keplr
 * (Cosmos / Neutron). Uses Radix Dialog for accessibility and Framer Motion
 * for the overlay + panel animations.
 *
 * MetaMask connect calls connectEvm() from WalletContext.
 * Keplr connect calls connectKeplrWallet() from WalletContext.
 *
 * Shows an inline error (not a toast) when the wallet extension is not detected
 * so the user can act without closing the modal.
 */
export default function WalletConnectModal({ open, onClose }: WalletConnectModalProps) {
  const { connectEvm, connectKeplrWallet, isEvmConnected, isKeplrConnected } =
    useWalletContext();

  // Per-wallet error state so both can show errors simultaneously
  const [errors, setErrors] = useState<Partial<Record<'metamask' | 'keplr', string>>>({});
  const [loading, setLoading] = useState<Partial<Record<'metamask' | 'keplr', boolean>>>({});

  function clearError(id: 'metamask' | 'keplr') {
    setErrors((prev) => ({ ...prev, [id]: undefined }));
  }

  async function handleConnect(wallet: WalletOption) {
    clearError(wallet.id);
    setLoading((prev) => ({ ...prev, [wallet.id]: true }));

    try {
      if (wallet.id === 'metamask') {
        // Check for injected provider before triggering wagmi connect
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof window !== 'undefined' && !(window as any).ethereum) {
          setErrors((prev) => ({
            ...prev,
            metamask: 'MetaMask is not installed. Install it and reload.',
          }));
          return;
        }
        connectEvm();
        // wagmi connect is fire-and-forget; the context updates reactively.
        // Close the modal optimistically — the nav will show the connected state.
        onClose();
      } else {
        // Check for Keplr before connecting
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof window !== 'undefined' && !(window as any).keplr) {
          setErrors((prev) => ({
            ...prev,
            keplr: 'Keplr extension is not installed. Install it and reload.',
          }));
          return;
        }
        await connectKeplrWallet();
        onClose();
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Connection failed. Please try again.';
      setErrors((prev) => ({ ...prev, [wallet.id]: message }));
    } finally {
      setLoading((prev) => ({ ...prev, [wallet.id]: false }));
    }
  }

  const connectedMap: Record<'metamask' | 'keplr', boolean> = {
    metamask: isEvmConnected,
    keplr: isKeplrConnected,
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <AnimatePresence>
          {open && (
            <>
              {/* Overlay */}
              <Dialog.Overlay asChild>
                <motion.div
                  key="overlay"
                  className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                />
              </Dialog.Overlay>

              {/* Panel */}
              <Dialog.Content asChild>
                <motion.div
                  key="panel"
                  className={cn(
                    'fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2',
                    'bg-stone-900 border border-stone-700 rounded-xl shadow-2xl p-6',
                    'focus:outline-none',
                  )}
                  initial={{ opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-1">
                    <Dialog.Title className="font-display text-xl text-stone-100">
                      Connect Wallet
                    </Dialog.Title>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        aria-label="Close"
                        className="text-stone-500 hover:text-stone-200 transition-colors mt-0.5"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </Dialog.Close>
                  </div>

                  <Dialog.Description className="text-sm text-stone-500 mb-5">
                    Choose a wallet to connect
                  </Dialog.Description>

                  {/* Wallet options */}
                  <div className="space-y-3">
                    {WALLETS.map((wallet) => {
                      const isConnected = connectedMap[wallet.id];
                      const isLoading = loading[wallet.id];
                      const error = errors[wallet.id];

                      return (
                        <div key={wallet.id}>
                          <button
                            type="button"
                            onClick={() => handleConnect(wallet)}
                            disabled={isConnected || isLoading}
                            className={cn(
                              'w-full flex items-center gap-3 rounded-lg px-4 py-3',
                              'border border-stone-700 bg-stone-800/60',
                              'hover:bg-stone-800 hover:border-stone-600 transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60',
                              'disabled:cursor-not-allowed disabled:opacity-60',
                            )}
                          >
                            {/* Wallet icon */}
                            {wallet.icon}

                            {/* Labels */}
                            <div className="flex-1 text-left">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-stone-100">
                                  {wallet.name}
                                </span>
                                {isConnected && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-full px-2 py-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                    connected
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-stone-500 mt-0.5 leading-snug">
                                {wallet.description}
                              </p>
                            </div>

                            {/* Trailing icon */}
                            {isLoading ? (
                              <span
                                aria-hidden="true"
                                className="w-4 h-4 rounded-full border-2 border-stone-600 border-t-orange-400 animate-spin shrink-0"
                              />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-stone-600 shrink-0" />
                            )}
                          </button>

                          {/* Inline error */}
                          {error && (
                            <div className="mt-2 flex items-start gap-2 text-xs text-red-400 px-1">
                              <span className="mt-px shrink-0">⚠</span>
                              <span>{error}</span>
                              <a
                                href={wallet.installUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-auto shrink-0 underline underline-offset-2 hover:text-red-300 transition-colors"
                              >
                                {wallet.installLabel}
                              </a>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer note */}
                  <p className="mt-5 text-[11px] text-stone-600 text-center leading-relaxed">
                    Tessera is a testnet demo. Connect both wallets to bridge tUSDC
                    between Sepolia and Neutron.
                  </p>
                </motion.div>
              </Dialog.Content>
            </>
          )}
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
