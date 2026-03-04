/**
 * L3: Unified toast notification system for errors and success messages
 */
import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { X, CheckCircle, AlertTriangle, Info, XCircle } from 'lucide-react';
import { Portal } from './portal';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback for components outside provider — no-op
    return {
      addToast: () => {},
      removeToast: () => {},
      success: (_title: string, _message?: string) => {},
      error: (_title: string, _message?: string) => {},
      warning: (_title: string, _message?: string) => {},
      info: (_title: string, _message?: string) => {},
    };
  }
  return {
    ...ctx,
    success: (title: string, message?: string) => ctx.addToast({ type: 'success', title, message }),
    error: (title: string, message?: string) => ctx.addToast({ type: 'error', title, message, duration: 8000 }),
    warning: (title: string, message?: string) => ctx.addToast({ type: 'warning', title, message }),
    info: (title: string, message?: string) => ctx.addToast({ type: 'info', title, message }),
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
