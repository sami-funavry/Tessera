'use client';

import { cn } from '@/lib/utils';

interface SkeletonLoaderProps {
  className?: string;
  /**
   * Number of skeleton lines to render when variant is 'text'.
   * Ignored for other variants. Defaults to 3.
   */
  lines?: number;
  /** 'text' — stacked line skeletons. 'card' — full card placeholder. 'table-row' — row of cells. */
  variant?: 'text' | 'card' | 'table-row';
}

/**
 * Shimmer skeleton placeholder. Uses the `.skeleton` utility class from
 * globals.css (linear-gradient shimmer animation) to communicate loading
 * without layout shift.
 *
 * Variants:
 *   text        → stacked line bars, last line 60% width
 *   card        → full block with header + content lines inside a card surface
 *   table-row   → horizontal row of equal-width cells
 */
export default function SkeletonLoader({
  className,
  lines = 3,
  variant = 'text',
}: SkeletonLoaderProps) {
  if (variant === 'text') {
    return (
      <div
        className={cn('flex flex-col gap-2', className)}
        aria-busy="true"
        aria-label="Loading"
      >
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'skeleton h-3 rounded',
              // Last line is shorter to mimic a natural paragraph end
              i === lines - 1 ? 'w-3/5' : 'w-full',
            )}
          />
        ))}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div
        className={cn(
          'bg-stone-900/60 border border-stone-800 rounded-md p-4 space-y-4',
          className,
        )}
        aria-busy="true"
        aria-label="Loading"
      >
        {/* Header row: icon placeholder + title placeholder */}
        <div className="flex items-center gap-3">
          <div className="skeleton w-8 h-8 rounded-md shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-3 w-1/3 rounded" />
            <div className="skeleton h-2.5 w-1/2 rounded" />
          </div>
        </div>
        {/* Body lines */}
        <div className="space-y-2">
          <div className="skeleton h-3 w-full rounded" />
          <div className="skeleton h-3 w-5/6 rounded" />
          <div className="skeleton h-3 w-4/6 rounded" />
        </div>
      </div>
    );
  }

  // table-row variant: a flex row of cells
  return (
    <div
      className={cn('flex items-center gap-4 px-4 py-3', className)}
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="skeleton h-3 w-24 rounded shrink-0" />
      <div className="skeleton h-3 flex-1 rounded" />
      <div className="skeleton h-3 w-20 rounded shrink-0" />
      <div className="skeleton h-3 w-16 rounded shrink-0" />
      <div className="skeleton h-5 w-16 rounded-full shrink-0" />
    </div>
  );
}
