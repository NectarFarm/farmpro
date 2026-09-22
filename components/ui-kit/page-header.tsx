'use client';
// ── PageHeader / Kpi (ui-kit) — ported from the reference's
// src/components/chrome/page-header.tsx. PageHeader is the eyebrow + serif
// title + lede + actions block every top-level screen leads with (Governance
// is the first consumer); Kpi is one clickable stat tile in the row beneath it.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  kicker,
  title,
  lede,
  actions,
}: {
  kicker?: string;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {kicker ? (
          <p className="text-xs font-medium tracking-widest text-muted uppercase">{kicker}</p>
        ) : null}
        <h1 className="font-display mt-1 text-3xl leading-none font-medium tracking-tight lg:text-4xl">
          {title}
        </h1>
        {lede ? <div className="mt-2 max-w-xl text-sm leading-relaxed text-muted">{lede}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone = 'plain',
  onClick,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'plain' | 'warn' | 'ok' | 'danger';
  onClick?: () => void;
  icon?: ReactNode;
}) {
  const toneClass =
    tone === 'warn'
      ? 'bg-warning-soft/70'
      : tone === 'ok'
        ? 'bg-success-soft/60'
        : tone === 'danger'
          ? 'bg-danger-soft/70'
          : 'bg-surface';
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex min-h-24 flex-col items-start rounded-xl p-4 text-left shadow-(--shadow-border)',
        toneClass,
        onClick && 'transition-[box-shadow,transform] duration-150 hover:shadow-(--shadow-border-hover) active:scale-[0.99]',
      )}
    >
      <span className="flex w-full items-center justify-between text-xs font-medium tracking-wide text-muted uppercase">
        {label}
        {icon}
      </span>
      <span className="font-display mt-2 text-3xl leading-none font-medium tabular-nums">{value}</span>
      {hint ? <span className="mt-1 text-xs text-subtle normal-case">{hint}</span> : null}
    </Comp>
  );
}
