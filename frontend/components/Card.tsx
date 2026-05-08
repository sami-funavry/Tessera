'use client';

import { cn } from '@/lib/utils';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  /** When true, adds hover styles and a pointer cursor for interactive cards. */
  hoverable?: boolean;
  onClick?: () => void;
}

/**
 * Base card container matching Tessera's surface design: stone-900/60 bg with
 * stone-800 border. Use `hoverable` for clickable cards (relayer rows, message
 * rows, etc.) to get the border-highlight and bg-lighten transition.
 */
export default function Card({ children, className, hoverable, onClick }: CardProps) {
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      // Cast is safe: onClick is only set when Tag='button', but TS doesn't
      // narrow the union prop here. We keep a single branch for simplicity.
      onClick={onClick as React.MouseEventHandler<HTMLButtonElement & HTMLDivElement>}
      className={cn(
        'bg-stone-900/60 border border-stone-800 rounded-md',
        hoverable && [
          'hover:bg-stone-900/80 hover:border-stone-700 transition-colors cursor-pointer',
        ],
        // Ensure button resets don't break layout when used as button
        onClick && 'w-full text-left',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
