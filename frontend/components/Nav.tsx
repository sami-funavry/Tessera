'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Menu, X } from 'lucide-react';
import { cn, truncateAddress } from '@/lib/utils';
import { useWalletContext } from '@/hooks/useWalletContext';
import WalletConnectModal from '@/components/WalletConnectModal';

// ─── Nav link definitions ───────────────────────────────────────────────────

const NAV_LINKS = [
  { href: '/', label: 'Bridge' },
  { href: '/demo', label: 'Demo' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/benchmark', label: 'Benchmark' },
  { href: '/docs', label: 'Docs' },
] as const;

// ─── Tessera logo mark ────────────────────────────────────────────────────────

/**
 * 2×2 grid of squares with alternating orange-400 fills — the Tessera logo mark.
 */
function LogoMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="8" height="8" rx="1.5" fill="#fb923c" />
      <rect x="10" y="0" width="8" height="8" rx="1.5" fill="#fb923c" fillOpacity="0.4" />
      <rect x="0" y="10" width="8" height="8" rx="1.5" fill="#fb923c" fillOpacity="0.4" />
      <rect x="10" y="10" width="8" height="8" rx="1.5" fill="#fb923c" />
    </svg>
  );
}

// ─── Wallet button ────────────────────────────────────────────────────────────

interface WalletButtonProps {
  onConnectClick: () => void;
}

/**
 * Renders either a "Connect Wallet" button (when no wallets are connected) or
 * an address pill dropdown (when at least one wallet is connected).
 *
 * The dropdown shows both EVM and Keplr addresses with individual disconnect
 * actions.
 */
function WalletButton({ onConnectClick }: WalletButtonProps) {
  const {
    evmAddress,
    neutronAddress,
    isEvmConnected,
    isKeplrConnected,
    disconnectEvm,
    disconnectKeplr,
  } = useWalletContext();

  const [dropdownOpen, setDropdownOpen] = useState(false);

  const isAnyConnected = isEvmConnected || isKeplrConnected;

  if (!isAnyConnected) {
    return (
      <button
        type="button"
        onClick={onConnectClick}
        className={cn(
          'h-8 px-3 rounded-md text-xs font-mono font-medium',
          'bg-orange-400/10 border border-orange-400/30 text-orange-400',
          'hover:bg-orange-400/20 hover:border-orange-400/50 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60',
        )}
      >
        Connect Wallet
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setDropdownOpen((v) => !v)}
        aria-expanded={dropdownOpen}
        aria-haspopup="true"
        className={cn(
          'h-8 px-3 rounded-md text-xs font-mono flex items-center gap-2',
          'bg-stone-800 border border-stone-700 text-stone-300',
          'hover:bg-stone-700 hover:border-stone-600 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60',
        )}
      >
        {/* Green connected dot */}
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />

        {/* Primary address — prefer EVM, fall back to Keplr */}
        <span className="text-stone-200">
          {evmAddress
            ? truncateAddress(evmAddress, 6, 4)
            : neutronAddress
            ? truncateAddress(neutronAddress, 10, 4)
            : ''}
        </span>

        <ChevronDown
          className={cn(
            'w-3 h-3 text-stone-500 transition-transform duration-150',
            dropdownOpen && 'rotate-180',
          )}
        />
      </button>

      {/* Dropdown */}
      {dropdownOpen && (
        <>
          {/* Click-away backdrop */}
          <div
            className="fixed inset-0 z-10"
            aria-hidden="true"
            onClick={() => setDropdownOpen(false)}
          />

          <div
            className={cn(
              'absolute right-0 top-full mt-2 z-20 w-64',
              'bg-stone-900 border border-stone-700 rounded-lg shadow-xl py-2',
              'animate-fade-up',
            )}
          >
            {/* EVM address row */}
            {isEvmConnected && evmAddress && (
              <div className="px-3 py-2">
                <p className="text-[10px] font-mono uppercase tracking-widest text-stone-600 mb-1">
                  Sepolia (EVM)
                </p>
                <p className="text-xs font-mono text-stone-300 truncate mb-2">
                  {evmAddress}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    disconnectEvm();
                    setDropdownOpen(false);
                  }}
                  className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
                >
                  Disconnect EVM
                </button>
              </div>
            )}

            {isEvmConnected && isKeplrConnected && (
              <div className="my-1 border-t border-stone-800" />
            )}

            {/* Keplr address row */}
            {isKeplrConnected && neutronAddress && (
              <div className="px-3 py-2">
                <p className="text-[10px] font-mono uppercase tracking-widest text-stone-600 mb-1">
                  Neutron (Cosmos)
                </p>
                <p className="text-xs font-mono text-stone-300 truncate mb-2">
                  {neutronAddress}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    disconnectKeplr();
                    setDropdownOpen(false);
                  }}
                  className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
                >
                  Disconnect Keplr
                </button>
              </div>
            )}

            {/* Connect missing wallet */}
            {(!isEvmConnected || !isKeplrConnected) && (
              <>
                <div className="my-1 border-t border-stone-800" />
                <div className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDropdownOpen(false);
                      onConnectClick();
                    }}
                    className="text-[11px] text-orange-400 hover:text-orange-300 transition-colors"
                  >
                    {!isEvmConnected && !isKeplrConnected
                      ? 'Connect wallets'
                      : !isEvmConnected
                      ? 'Connect MetaMask'
                      : 'Connect Keplr'}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Nav ─────────────────────────────────────────────────────────────────────

/**
 * Sticky top navigation bar. Reads current path with usePathname to highlight
 * the active link. Includes the Tessera logo, five primary nav links, chain
 * indicator, and a WalletButton with dropdown. Mobile view collapses links into
 * a hamburger-toggled panel.
 */
export default function Nav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 h-14 border-b border-stone-800 bg-stone-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6">
          {/* ── Left: logo ── */}
          <Link
            href="/"
            className="flex items-center gap-2 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60 rounded"
          >
            <LogoMark />
            <span className="font-display text-lg text-stone-100 leading-none">
              Tessera
            </span>
          </Link>

          {/* ── Center: nav links (desktop) ── */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-0.5"
          >
            {NAV_LINKS.map(({ href, label }) => {
              const isActive =
                href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'px-3.5 py-1.5 rounded text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60',
                    isActive
                      ? 'text-stone-100 bg-stone-800/60'
                      : 'text-stone-500 hover:text-stone-300 hover:bg-stone-800/40',
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          {/* ── Right: chain chips + wallet + hamburger ── */}
          <div className="flex items-center gap-3">
            {/* Chain indicator — desktop only */}
            <span className="hidden lg:inline font-mono text-[10px] tracking-widest text-stone-600 uppercase select-none">
              Sepolia · Neutron
            </span>

            <WalletButton onConnectClick={() => setWalletModalOpen(true)} />

            {/* Hamburger — mobile only */}
            <button
              type="button"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((v) => !v)}
              className="md:hidden text-stone-400 hover:text-stone-200 transition-colors p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* ── Mobile nav dropdown ── */}
        {mobileOpen && (
          <div className="md:hidden border-t border-stone-800 bg-stone-950/95 px-4 py-3 space-y-1 animate-fade-up">
            {NAV_LINKS.map(({ href, label }) => {
              const isActive =
                href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'block px-3 py-2 rounded text-sm transition-colors',
                    isActive
                      ? 'text-stone-100 bg-stone-800/60'
                      : 'text-stone-500 hover:text-stone-300 hover:bg-stone-800/40',
                  )}
                >
                  {label}
                </Link>
              );
            })}
            <div className="pt-2 border-t border-stone-800">
              <span className="font-mono text-[10px] tracking-widest text-stone-600 uppercase">
                Sepolia · Neutron
              </span>
            </div>
          </div>
        )}
      </header>

      {/* Wallet connect modal */}
      <WalletConnectModal
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
      />
    </>
  );
}
