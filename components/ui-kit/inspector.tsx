'use client';
// ── Dossier / Inspector / Kv (ui-kit) — ported from the reference's
// src/components/chrome/inspector.tsx, minus @radix-ui/react-dialog (uses
// this kit's own Sheet instead — see ./sheet.tsx for why no Radix).
//
// Dossier: the in-page "paper" a master-detail layout's right-hand pane is
// built from (desktop). Inspector: the same content as a full mobile sheet,
// for when a screen has not been split into its own list+dossier layout yet.
// Kv: one label/value row inside either.
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet } from './sheet';

export function Dossier({
  kicker,
  title,
  lede,
  children,
  footer,
  className,
}: {
  kicker?: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <article className={cn('flex min-h-0 flex-col rounded-xl bg-surface shadow-(--shadow-border)', className)}>
      <header className="border-b border-border px-5 py-4">
        {kicker ? (
          <p className="text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">{kicker}</p>
        ) : null}
        <h2 className="font-display mt-1 text-2xl leading-tight font-medium">{title}</h2>
        {lede ? <div className="mt-1 text-sm text-muted">{lede}</div> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer ? <footer className="border-t border-border px-5 py-4">{footer}</footer> : null}
    </article>
  );
}

/**
 * Fallback when a screen has not been split into its own list+Dossier layout.
 * Mobile: a full sheet with a back control. Desktop: a centred sheet, not a
 * skinny side drawer.
 */
export function Inspector({
  open,
  onOpenChange,
  kicker,
  title,
  lede,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kicker?: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} side="bottom" className="inset-0 rounded-none lg:inset-auto lg:top-[7%] lg:left-1/2 lg:h-[min(86vh,44rem)] lg:w-[34rem] lg:-translate-x-1/2 lg:rounded-xl">
      <div className="flex items-start gap-1 border-b border-border px-2 py-2 lg:px-3">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-fg hover:bg-surface-2"
          aria-label="Back"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1 py-2 pr-3">
          {kicker ? (
            <p className="text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">{kicker}</p>
          ) : null}
          <h2 className="font-display text-xl leading-tight font-medium">{title}</h2>
          {lede ? <p className="mt-0.5 text-sm text-muted">{lede}</p> : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer ? <div className="border-t border-border px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
    </Sheet>
  );
}

export function Kv({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/70 py-2.5 text-sm last:border-0">
      <dt className="shrink-0 text-subtle">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words">{value ?? '—'}</dd>
    </div>
  );
}
