'use client';
// ── Field (ui-kit) — ported from the reference's
// src/components/chrome/field.tsx. `controlClass` is exported so a raw
// <select> or a composed control can match Input's look without importing
// the whole Input component.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('grid gap-1.5 text-sm', className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

export const controlClass =
  'h-10 w-full min-w-0 rounded-md bg-surface px-3 text-sm text-fg shadow-(--shadow-border) outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-ring/30';
