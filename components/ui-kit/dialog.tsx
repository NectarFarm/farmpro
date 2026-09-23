'use client';
// ── Dialog (ui-kit) — ported from the reference's src/components/ui/dialog.tsx,
// minus @radix-ui/react-dialog. Plain controlled modal: `open`/`onOpenChange`
// instead of Radix's Root/Trigger/Portal primitives. This mirrors the overlay
// convention components/farm/governance.tsx's RoleBuilderSheet/
// ApprovalReviewSheet already use (position: fixed, no real DOM portal — the
// farm-device-frame has no transform/overflow ancestor that would break
// `fixed` positioning), so a screen moving from its own hand-rolled overlay to
// this component changes nothing about how it behaves.
import { useEffect, type HTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/** Root + overlay + content in one — this app never needs a separate
 * Trigger/Portal (every open state is already owned by the calling screen's
 * own `useState`). */
export function Dialog({ open, onOpenChange, children }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onOpenChange(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-fg/40"
      onClick={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-h-[90dvh] overflow-y-auto max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface p-5 shadow-(--shadow-raised) outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute top-3 right-3 rounded-md p-2 text-muted hover:bg-surface-2"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('font-display text-xl font-medium', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1 text-sm text-muted', className)} {...props} />;
}
