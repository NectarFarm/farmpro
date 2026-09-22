'use client';
// ── Tooltip (ui-kit) — minimal plain-React replacement for the reference's
// @radix-ui/react-tooltip usage. Hover/focus only (no touch long-press —
// this app is a phone-first PWA and a tooltip that only a mouse can reach is
// already a desktop-only affordance by nature), shown after a short delay,
// positioned above the trigger. No provider needed: each Tooltip owns its
// own show/hide state.
import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Tooltip({ content, children, className }: { content: ReactNode; children: ReactNode; className?: string }) {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      <span aria-describedby={show ? id : undefined}>{children}</span>
      {show && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 rounded-md bg-fg px-2 py-1 text-xs whitespace-nowrap text-bg shadow-(--shadow-raised)',
            className,
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
