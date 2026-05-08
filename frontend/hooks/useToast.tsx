'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Toast, ToastVariant } from '@/types';

// ---------- constants ----------

const MAX_TOASTS = 3;
const AUTO_DISMISS_MS = 5000;

// ---------- types ----------

interface ToastOptions {
  title: string;
  description?: string;
  variant: ToastVariant;
  /** Override the auto-dismiss delay in milliseconds. Defaults to 5000. */
  durationMs?: number;
}

interface ToastContextValue {
  /**
   * Show a toast notification. Returns the generated id so callers can dismiss
   * it early if needed.
   */
  toast: (opts: ToastOptions) => string;
  /** Immediately remove a toast by id. */
  dismiss: (id: string) => void;
}

// ---------- context ----------

const ToastContext = createContext<ToastContextValue | null>(null);

// ---------- variant style map ----------

const VARIANT_STYLES: Record<ToastVariant, { border: string; icon: string; bg: string }> = {
  success: {
    border: 'border-l-emerald-500',
    icon: 'text-emerald-500',
    bg: 'bg-stone-900',
  },
  error: {
    border: 'border-l-red-500',
    icon: 'text-red-500',
    bg: 'bg-stone-900',
  },
  warning: {
    border: 'border-l-amber-500',
    icon: 'text-amber-500',
    bg: 'bg-stone-900',
  },
  info: {
    border: 'border-l-sky-500',
    icon: 'text-sky-500',
    bg: 'bg-stone-900',
  },
};

// ---------- individual toast component ----------

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const styles = VARIANT_STYLES[toast.variant];

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={[
        'flex items-start gap-3 w-80 rounded-md border-l-4 border border-stone-700 p-4 shadow-xl',
        'animate-in slide-in-from-bottom-2 fade-in duration-200',
        styles.border,
        styles.bg,
      ].join(' ')}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-stone-100 leading-snug">
          {toast.title}
        </p>
        {toast.description && (
          <p className="mt-0.5 text-xs text-stone-400 leading-snug">
            {toast.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 text-stone-500 hover:text-stone-200 transition-colors mt-0.5"
      >
        {/* Simple × glyph — no icon library dependency */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

// ---------- container ----------

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

/**
 * Fixed bottom-right container that renders all active toasts. Rendered
 * inside ToastProvider so it has direct access to the toast list.
 */
function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}

// ---------- provider ----------

/**
 * Manages the toast queue. Wrap the application (or a subtree) with this
 * provider to enable toast notifications via useToast().
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  /*
   * Keep a ref to active timer ids so we can clear them when a toast is
   * manually dismissed before the timer fires.
   */
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clear all pending timers on unmount.
  useEffect(() => {
    const currentTimers = timers.current;
    return () => {
      currentTimers.forEach((t) => clearTimeout(t));
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (opts: ToastOptions): string => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newToast: Toast = {
        id,
        title: opts.title,
        description: opts.description,
        variant: opts.variant,
      };

      setToasts((prev) => {
        // Enforce max — drop the oldest entry when at capacity.
        const next = prev.length >= MAX_TOASTS ? prev.slice(1) : prev;
        return [...next, newToast];
      });

      const duration = opts.durationMs ?? AUTO_DISMISS_MS;
      const timer = setTimeout(() => {
        dismiss(id);
      }, duration);
      timers.current.set(id, timer);

      return id;
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ---------- hook ----------

/**
 * Access toast controls. Must be called inside ToastProvider.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return ctx;
}

export type { ToastOptions };
