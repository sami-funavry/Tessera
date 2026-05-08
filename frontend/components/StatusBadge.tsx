'use client';

import { cn } from '@/lib/utils';

// Maps activityType to Tailwind color tokens for the badge and dot.
const COLOR_MAP: Record<
  string,
  { dot: string; bg: string; text: string; pulse: boolean }
> = {
  busy: {
    dot: 'bg-amber-400',
    bg: 'bg-amber-400/10 border border-amber-400/20',
    text: 'text-amber-400',
    pulse: true,
  },
  idle: {
    dot: 'bg-emerald-400',
    bg: 'bg-emerald-400/10 border border-emerald-400/20',
    text: 'text-emerald-400',
    pulse: false,
  },
  benched: {
    dot: 'bg-amber-400',
    bg: 'bg-amber-400/10 border border-amber-400/20',
    text: 'text-amber-400',
    pulse: false,
  },
  deregistered: {
    dot: 'bg-red-400',
    bg: 'bg-red-400/10 border border-red-400/20',
    text: 'text-red-400',
    pulse: false,
  },
  cooling: {
    dot: 'bg-stone-400',
    bg: 'bg-stone-800 border border-stone-700',
    text: 'text-stone-400',
    pulse: false,
  },
};

const DEFAULT_COLORS = COLOR_MAP.idle;

interface StatusBadgeProps {
  /** One of 'busy' | 'idle' | 'benched' | 'deregistered' | 'cooling'. */
  activityType: string;
  /** Human-readable label shown next to the dot (e.g. "submitting", "watching"). */
  activity: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Pill badge for relayer activity state. Renders a status dot (pulsing when
 * the relayer is actively submitting) alongside the activity label.
 *
 * Color scheme per UI-status-badge spec:
 *   busy → amber (pulsing)
 *   idle → emerald
 *   benched → amber (static)
 *   deregistered → red
 *   cooling → stone
 */
export default function StatusBadge({
  activityType,
  activity,
  size = 'md',
  className,
}: StatusBadgeProps) {
  const colors = COLOR_MAP[activityType] ?? DEFAULT_COLORS;

  const paddingClass = size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1';
  const textClass = size === 'sm' ? 'text-[10px]' : 'text-xs';
  const dotSize = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-mono',
        paddingClass,
        colors.bg,
        className,
      )}
    >
      {/* Status dot — relative container for the pulse ring */}
      <span className="relative inline-flex items-center justify-center">
        {colors.pulse && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute inline-flex rounded-full opacity-75',
              dotSize,
              colors.dot,
              'animate-pulse-ring',
            )}
          />
        )}
        <span
          className={cn('relative inline-flex rounded-full', dotSize, colors.dot)}
        />
      </span>

      <span className={cn(textClass, colors.text)}>{activity}</span>
    </span>
  );
}
