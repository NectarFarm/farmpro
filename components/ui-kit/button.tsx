'use client';
// ── Button (ui-kit, ui/governance-reference-redesign) ───────────────────────
// Ported from the reference's src/components/ui/button.tsx, minus Radix:
// the reference used @radix-ui/react-slot for an `asChild` polymorphic
// pattern (`<Button asChild><Link>…</Link></Button>`), which this app has no
// use for — every destination here is a navigate() call, not an <a href>, so
// there is no child element that ever needs to "become" the button. Neither
// Radix nor class-variance-authority is installed in this repo and neither
// is worth adding for a handful of fixed variants; the variant/size maps
// below are the same lookup class-variance-authority would generate, just
// written out directly.
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'sidebar';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-fg shadow-(--shadow-border) hover:bg-primary/90',
  secondary: 'bg-surface text-fg shadow-(--shadow-border) hover:bg-surface-2',
  ghost: 'text-fg hover:bg-surface-2',
  outline: 'bg-transparent text-fg shadow-(--shadow-border) hover:bg-surface',
  danger: 'bg-danger text-primary-fg hover:bg-danger/90',
  sidebar: 'justify-start text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  default: 'h-10 px-3.5',
  sm: 'h-8 px-2.5 text-[0.8125rem]',
  lg: 'h-11 px-4',
  icon: 'size-10',
  'icon-sm': 'size-8',
};

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 transition-[background-color,color,box-shadow,opacity,transform] duration-150 ease-out active:not-disabled:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring/40";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ className, variant = 'default', size = 'default', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      data-slot="button"
      className={cn(BASE, VARIANT_CLASS[variant], SIZE_CLASS[size], className)}
      {...props}
    />
  );
}
