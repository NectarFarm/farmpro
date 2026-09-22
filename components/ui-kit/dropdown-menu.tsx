'use client';
// ── DropdownMenu (ui-kit) — plain-React replacement for the reference's
// @radix-ui/react-dropdown-menu usage. A controlled-by-itself popover:
// click the trigger to open, click outside or Escape to close, click an
// item to run its action and close. No focus-trap/roving-tabindex (Radix's
// biggest value-add over a hand-rolled version) — acceptable here because
// every current use (Notices, the farm switcher) is a short, single-level
// list, not a full menu-bar.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function DropdownMenu({ trigger, children, align = 'end' }: {
  trigger: (props: { onClick: () => void; open: boolean }) => ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      {trigger({ onClick: () => setOpen((o) => !o), open })}
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-50 mt-1.5 min-w-48 overflow-hidden rounded-lg bg-surface p-1 text-fg shadow-(--shadow-raised)',
            align === 'end' ? 'right-0' : 'left-0',
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownMenuItem({ className, onSelect, children }: { className?: string; onSelect?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        'relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none select-none hover:bg-surface-2',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function DropdownMenuLabel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-2 py-1.5 text-xs font-medium text-subtle', className)}>{children}</div>;
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn('my-1 h-px bg-border', className)} />;
}

export function DropdownMenuCheckboxItem({ className, checked, onSelect, children }: {
  className?: string; checked?: boolean; onSelect?: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        'relative flex w-full cursor-pointer items-center gap-2 rounded-md py-2 pr-2 pl-8 text-left text-sm outline-none select-none hover:bg-surface-2',
        className,
      )}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        {checked && <Check className="size-3.5" />}
      </span>
      {children}
    </button>
  );
}
