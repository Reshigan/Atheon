/**
 * L3: Unified toast notification system for errors and success messages
 *
 * Supports an optional `requestId` on error toasts (backend PR #222 adds
 * X-Request-ID to every response; the API client captures it and surfaces
 * it here so users can quote it back to support).
 */
import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { X, CheckCircle, AlertTriangle, Info, XCircle, Copy, Check } from 'lucide-react';
import { Portal } from './portal';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  /** Optional backend request-id for support traceability (shown on error toasts). */
  requestId?: string | null;
}

interface ToastOpts {
  message?: string;
  requestId?: string | null;
  duration?: number;
}

interface ToastContextType {
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

/**
 * Shape returned by useToast. Each helper accepts either a simple message
 * string (backwards compatible) or an options bag { message, requestId,
 * duration } — the latter is what ApiError-aware call sites should use.
 */
export interface ToastApi {
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  success: (title: string, messageOrOpts?: string | ToastOpts) => void;
  error: (title: string, messageOrOpts?: string | ToastOpts) => void;
  warning: (title: string, messageOrOpts?: string | ToastOpts) => void;
  info: (title: string, messageOrOpts?: string | ToastOpts) => void;
}

function resolveOpts(messageOrOpts?: string | ToastOpts): ToastOpts {
  if (typeof messageOrOpts === 'string') return { message: messageOrOpts };
  return messageOrOpts ?? {};
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback for components outside provider — no-op
    const noop = () => {};
    return {
      addToast: noop,
      removeToast: noop,
      success: noop,
      error: noop,
      warning: noop,
      info: noop,
    };
  }
  return {
    ...ctx,
    success: (title, opts) => ctx.addToast({ type: 'success', title, ...resolveOpts(opts) }),
    error: (title, opts) => {
      const o = resolveOpts(opts);
      ctx.addToast({ type: 'error', title, duration: 8000, ...o });
    },
    warning: (title, opts) => ctx.addToast({ type: 'warning', title, ...resolveOpts(opts) }),
    info: (title, opts) => ctx.addToast({ type: 'info', title, ...resolveOpts(opts) }),
  };
}

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={16} className="text-emerald-500" />,
  error: <XCircle size={16} className="text-red-500" />,
  warning: <AlertTriangle size={16} className="text-amber-500" />,
  info: <Info size={16} className="text-blue-500" />,
};

const BG: Record<ToastType, string> = {
  success: 'border-emerald-500/20',
  error: 'border-red-500/20',
  warning: 'border-amber-500/20',
  info: 'border-blue-500/20',
};

function RequestIdFooter({ requestId }: { requestId: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    const doFallback = () => {
      // Best-effort fallback using a detached textarea for older browsers
      try {
        const ta = document.createElement('textarea');
        ta.value = requestId;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        /* clipboard genuinely unavailable — silently ignore */
      }
    };
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(requestId).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        },
        doFallback,
      );
    } else {
      doFallback();
    }
  }, [requestId]);

  return (
    <div className="mt-1 flex items-center gap-1.5 text-[10px] t-muted font-mono">
      <span className="truncate" title={requestId}>ref: {requestId}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="text-gray-400 hover:text-gray-200 transition-colors flex-shrink-0"
        aria-label={copied ? 'Request ID copied' : 'Copy request ID'}
        title={copied ? 'Copied' : 'Copy request ID'}
      >
        {copied ? <Check size={10} /> : <Copy size={10} />}
      </button>
    </div>
  );
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), toast.duration || 5000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onRemove]);

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border ${BG[toast.type]} shadow-lg animate-slideIn`}
      style={{ background: 'var(--bg-card-solid)', minWidth: 280, maxWidth: 400 }}
      role="alert"
      aria-live="polite"
    >
      <div className="mt-0.5">{ICONS[toast.type]}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium t-primary">{toast.title}</p>
        {toast.message && <p className="text-xs t-muted mt-0.5">{toast.message}</p>}
        {toast.requestId && <RequestIdFooter requestId={toast.requestId} />}
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        className="text-gray-400 hover:text-gray-300 transition-colors"
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev.slice(-4), { ...toast, id }]); // max 5 visible
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      {toasts.length > 0 && (
        <Portal>
          <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2">
            {toasts.map((toast) => (
              <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
            ))}
          </div>
        </Portal>
      )}
    </ToastContext.Provider>
  );
}
