'use client';

import { cn } from '@/lib/utils';

interface SectionLabelProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Section header pattern: uppercase monospace label on the left with a
 * full-width horizontal rule filling the remaining space on the right.
 *
 * Exact visual spec per UI-section-label:
 *   text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500
 *   + flex-1 h-px bg-stone-800
 */
export default function SectionLabel({ children, className }: SectionLabelProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-stone-500 whitespace-nowrap">
        {children}
      </span>
      <span className="flex-1 h-px bg-stone-800" aria-hidden="true" />
    </div>
  );
}
