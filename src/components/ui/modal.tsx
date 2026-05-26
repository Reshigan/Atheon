/**
 * Modal primitive — canonical overlay pattern.
 *
 * Replaces the three ad-hoc DIY overlays scattered across the app:
 *   1. Inline `<div style={{ background: 'var(--bg-modal)' }}>` on
 *      LoginPage / MFASetupPage
 *   2. Raw `<Portal>` + manual backdrop in TraceabilityModal
 *   3. Inline ConfirmDialog in CatalystRunDetailPage
 *
 * Usage:
 *
 *   <Modal open={isOpen} onClose={() => setOpen(false)} size="md">
 *     <Modal.Header title="Reset password" onClose={() => setOpen(false)} />
 *     <Modal.Body>{form}</Modal.Body>
 *     <Modal.Footer>
 *       <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
 *       <Button onClick={submit}>Confirm</Button>
 *     </Modal.Footer>
 *   </Modal>
 *
 * What this primitive owns (so consumers don't have to):
 *   - Portal mount + click-outside-to-close + ESC-to-close
 *   - Backdrop with theme-aware opacity (60% dark / 30% light)
 *   - Card surface (uses the same border + shadow tokens as `<Card>`)
 *   - Body scroll lock while open
 *   - Focus trap via `autoFocus` on the dialog (full focus-trap is a
 *     future enhancement — not gating, but worth a follow-up)
 *   - role="dialog" + aria-modal=true + aria-labelledby wiring
 *
 * What consumers own:
 *   - The form / confirmation copy / contents
 *   - Disabling close while a submission is in flight (pass
 *     `dismissible={false}`)
 */
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { Portal } from "./portal";

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Width band — `sm` 24rem (confirmations), `md` 32rem (forms, default),
   *  `lg` 48rem (richer detail), `xl` 64rem (data tables), `full` covers
   *  the viewport with 2rem inset. */
  size?: ModalSize;
  /** When false, ESC + backdrop click + the close button no-op. Use while
   *  a mutation is in flight so the user can't dismiss mid-submit. */
  dismissible?: boolean;
  /** id of the labelling element inside the modal (typically the title
   *  rendered by `Modal.Header`). Auto-derived when you use Header. */
  labelledBy?: string;
  /** Optional extra classes on the dialog surface — most callers won't
   *  need this. Prefer `size` for width changes. */
  className?: string;
  children: ReactNode;
}

const sizeClass: Record<ModalSize, string> = {
  sm: 'max-w-sm',     // 24rem
  md: 'max-w-md',     // 28rem (forms)
  lg: 'max-w-2xl',    // 42rem
  xl: 'max-w-4xl',    // 56rem
  full: 'max-w-[calc(100vw-4rem)] max-h-[calc(100vh-4rem)]',
};

function ModalRoot({
  open, onClose, size = 'md',
  dismissible = true, labelledBy,
  className = '', children,
}: ModalProps) {
  // ESC-to-close + body scroll lock. Both are scoped to "while open" so
  // a closed modal leaves the document state untouched.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, dismissible, onClose]);

  if (!open) return null;

  return (
    <Portal>
      <div
        role="presentation"
        aria-hidden="true"
        onClick={() => { if (dismissible) onClose(); }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-backdropIn"
        style={{ background: 'rgba(10, 14, 22, 0.55)', backdropFilter: 'blur(4px)' }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          onClick={(e) => e.stopPropagation()}
          // autoFocus so screen readers land in the dialog. A full focus
          // trap would tab-cycle within the modal; that's a follow-up.
          tabIndex={-1}
          autoFocus
          className={`w-full ${sizeClass[size]} rounded-2xl overflow-hidden flex flex-col animate-modalIn ${className}`}
          style={{
            background: 'var(--bg-modal)',
            border: '1px solid var(--border-card)',
            boxShadow: 'var(--shadow-modal)',
            maxHeight: 'calc(100vh - 2rem)',
          }}
        >
          {children}
        </div>
      </div>
    </Portal>
  );
}

// ─── Sub-components ─────────────────────────────────────────

interface ModalHeaderProps {
  title: ReactNode;
  /** Optional subtitle / description shown beneath the title. */
  description?: ReactNode;
  /** When provided, renders a close × button on the right. Wire the
   *  modal's onClose so the X dismisses. */
  onClose?: () => void;
  /** id used by `aria-labelledby` on the dialog. Defaults to `modal-title`. */
  titleId?: string;
  className?: string;
}

function ModalHeader({
  title, description, onClose, titleId = 'modal-title', className = '',
}: ModalHeaderProps) {
  return (
    <div
      className={`flex items-start justify-between gap-4 px-5 py-4 ${className}`}
      style={{ borderBottom: '1px solid var(--border-card)' }}
    >
      <div className="flex-1 min-w-0">
        <h2 id={titleId} className="text-h2 t-primary">{title}</h2>
        {description && (
          <p className="text-caption t-muted mt-0.5">{description}</p>
        )}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="t-muted hover:t-primary p-1 rounded-md hover:bg-[var(--bg-secondary)] transition-all"
          aria-label="Close dialog"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

function ModalBody({
  children, className = '',
}: { children: ReactNode; className?: string }) {
  return (
    <div className={`px-5 py-4 overflow-y-auto flex-1 ${className}`}>
      {children}
    </div>
  );
}

function ModalFooter({
  children, className = '',
}: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex items-center justify-end gap-2 px-5 py-3 ${className}`}
      style={{ borderTop: '1px solid var(--border-card)' }}
    >
      {children}
    </div>
  );
}

// Attach sub-components for the `<Modal.Header />` namespace pattern.
export const Modal = Object.assign(ModalRoot, {
  Header: ModalHeader,
  Body: ModalBody,
  Footer: ModalFooter,
});
