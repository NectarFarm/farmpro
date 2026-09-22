'use client';
// ── Input (ui-kit) — ported from the reference's src/components/ui/input.tsx.
import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-10 w-full min-w-0 rounded-md bg-surface px-3 text-sm text-fg shadow-(--shadow-border) outline-none placeholder:text-subtle',
        'transition-[box-shadow,background-color] duration-150 ease-out',
        'focus-visible:ring-2 focus-visible:ring-ring/30',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
