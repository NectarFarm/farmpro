'use client';
// ── ScrollArea (ui-kit) — ported from the reference's
// src/components/ui/scroll-area.tsx, minus @radix-ui/react-scroll-area: a
// plain overflow-y-auto div with a themed scrollbar (thin, --border coloured)
// gets the same visual result without a library — this app already relies on
// native scrollbars everywhere else (.screen-content, .farm-sidebar-nav in
// app/global.css use the same thin/coloured-thumb convention).
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function ScrollArea({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('overflow-y-auto overflow-x-hidden [scrollbar-width:thin] [scrollbar-color:var(--border-subtle)_transparent]', className)}
      {...props}
    >
      {children}
    </div>
  );
}
