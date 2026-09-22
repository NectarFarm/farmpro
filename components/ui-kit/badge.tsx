'use client';
// ── Badge (ui-kit) — ported from the reference's src/components/ui/badge.tsx,
// minus class-variance-authority (not installed; a 6-entry lookup map needs
// no dependency for it). Pill-shaped status/label chip.
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant = 'default' | 'primary' | 'warning' | 'danger' | 'success' | 'outline';

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  default: 'bg-surface-2 text-muted',
  primary: 'bg-primary-soft text-primary',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  success: 'bg-success-soft text-success',
  outline: 'shadow-(--shadow-border) text-muted',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tracking-wide',
        VARIANT_CLASS[variant],
        className,
      )}
      {...props}
    />
  );
}
