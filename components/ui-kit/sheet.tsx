'use client';
// ── Sheet (ui-kit) — ported from the reference's src/components/ui/sheet.tsx,
// minus @radix-ui/react-dialog. Same plain-controlled shape as ./dialog.tsx;
// `side` picks which edge it slides in from ('bottom' is what Governance's
// mobile master-detail and the app-shell's mobile nav sheet use).
import { useEffect, type HTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  side?: 'left' | 'right' | 'bottom';
  className?: string;
}

export function Sheet({ open, onOpenChange, children, side = 'bottom', className }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onOpenChange(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;
  const sideClass =
    side === 'bottom'
      ? 'inset-x-0 bottom-0 max-h-[90vh] rounded-t-xl'
      : side === 'right'
        ? 'inset-y-0 right-0 h-full w-[min(100%,26rem)]'
        : 'inset-y-0 left-0 h-full w-72';

  return (
    <div className="fixed inset-0 z-50 bg-fg/40" onClick={() => onOpenChange(false)}>
      <div
        role="dialog"
        aria-modal="true"
        className={cn('fixed z-50 bg-surface shadow-(--shadow-raised) outline-none flex flex-col', sideClass, className)}
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

export function SheetTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-base font-medium', className)} {...props} />;
}
