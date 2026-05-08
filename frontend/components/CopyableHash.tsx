'use client';

import { useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { cn, truncateHash, explorerTxUrl } from '@/lib/utils';

interface CopyableHashProps {
  value: string;
  /** How many leading characters to show before the ellipsis. Defaults to 10. */
  displayLength?: number;
  /** When provided, renders an external-link icon pointing to the appropriate explorer. */
  explorer?: 'sepolia' | 'neutron';
  className?: string;
}

/**
 * Displays a truncated hash with a copy-to-clipboard button and an optional
 * block-explorer link. Used for every transaction hash, address, fingerprint
 * and root displayed in the UI per UI-copyable-hash spec.
 *
 * Copy and link clicks stop propagation so that parent row-click handlers
 * are not triggered.
 */
export default function CopyableHash({
  value,
  displayLength = 10,
  explorer,
  className,
}: CopyableHashProps) {
  const [copied, setCopied] = useState(false);

  const display = truncateHash(value, displayLength);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function handleLinkClick(e: React.MouseEvent) {
    e.stopPropagation();
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono text-sm',
        className,
      )}
    >
      <span className="text-stone-400">{display}</span>

      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy full hash"
        className="text-stone-600 hover:text-stone-300 transition-colors p-0.5 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-400/60"
      >
        {copied ? (
          <Check className="w-3 h-3 text-emerald-400" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>

      {explorer && (
        <a
          href={explorerTxUrl(value, explorer)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleLinkClick}
          aria-label={`View on ${explorer === 'sepolia' ? 'Etherscan' : 'Celatone'}`}
          className="text-stone-600 hover:text-orange-400 transition-colors p-0.5 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-400/60"
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </span>
  );
}
