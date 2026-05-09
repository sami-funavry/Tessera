import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncateAddress(address: string, start = 6, end = 4): string {
  if (!address) return '';
  if (address.length <= start + end) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

export function truncateHash(hash: string, chars = 10): string {
  if (!hash || hash === '—') return hash;
  return `${hash.slice(0, chars)}...${hash.slice(-4)}`;
}

/**
 * Build an explorer URL for a transaction hash. Normalises the hash to the
 * format the target explorer expects: Etherscan wants `0x`-prefixed lowercase
 * hex, Celatone wants uppercase hex with no prefix. Synthetic / fallback hashes
 * (e.g. seeded scenario rows) get the same normalisation so the link doesn't
 * silently 404 on the wrong format.
 */
/**
 * P-10.8c: Returns true if the given chain_id string identifies Sepolia.
 * The Go relayer writes the canonical name 'sepolia' (from the Ethereum
 * plugin's ChainID()), while legacy/seeded rows use the EIP-155 literal
 * '11155111'. Both must be accepted across the dashboard, submissions
 * pages, and bridge widget; otherwise rows from one writer get silently
 * mis-classified as Neutron (wrong decimals, wrong explorer link, wrong
 * chain label). Centralizing the check here is the only durable fix.
 */
export function isSepoliaChainId(id: string | null | undefined): boolean {
  return id === '11155111' || id === 'sepolia';
}

export function explorerTxUrl(hash: string, chain: 'sepolia' | 'neutron'): string {
  const stripped = (hash ?? '').replace(/^0x/i, '');
  if (chain === 'sepolia') {
    return `https://sepolia.etherscan.io/tx/0x${stripped.toLowerCase()}`;
  }
  return `https://neutron.celat.one/pion-1/txs/${stripped.toUpperCase()}`;
}

export function explorerAddressUrl(address: string, chain: 'sepolia' | 'neutron'): string {
  if (chain === 'sepolia') return `https://sepolia.etherscan.io/address/${address}`;
  return `https://neutron.celat.one/pion-1/accounts/${address}`;
}

export function formatAmount(amount: number | string, decimals = 6): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals });
}

export function formatEth(wei: bigint, decimals = 4): string {
  const eth = Number(wei) / 1e18;
  return eth.toFixed(decimals);
}

export function formatNtrn(uNtrn: bigint, decimals = 2): string {
  const ntrn = Number(uNtrn) / 1e6;
  return ntrn.toFixed(decimals);
}

export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function bondHealthPercent(balance: bigint | number, initial: bigint | number): number {
  const b = typeof balance === 'bigint' ? Number(balance) : balance;
  const i = typeof initial === 'bigint' ? Number(initial) : initial;
  if (i === 0) return 0;
  return Math.min(100, Math.max(0, (b / i) * 100));
}

export type StatusColor = 'emerald' | 'amber' | 'red' | 'stone' | 'orange';
export function statusToColor(status: string): StatusColor {
  switch (status) {
    case 'finalized':
    case 'executed':
    case 'confirmed': return 'emerald';
    case 'pending':
    case 'challenge_window':
    case 'submitted': return 'amber';
    case 'challenged':
    case 'slashed':
    case 'reverted': return 'red';
    default: return 'stone';
  }
}
