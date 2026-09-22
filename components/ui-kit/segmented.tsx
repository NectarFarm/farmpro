'use client';
// ── Segmented / Chips (ui-kit) — ported from the reference's
// src/components/chrome/segmented.tsx. Segmented is the wide 3-up tab bar
// with a title+description per segment (Governance's Approvals/Roles &
// rules/Audit trail); Chips is the small pill-row filter (status/role/entity
// filters).
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Segmented<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (value: T) => void;
  items: { id: T; label: string; hint?: string; icon?: ReactNode; badge?: ReactNode }[];
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 shadow-(--shadow-border)">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            'flex min-h-12 flex-1 flex-col items-start gap-0 rounded-lg px-3 py-2 text-left transition-[background-color,color,box-shadow] duration-150',
            value === item.id ? 'bg-surface text-fg shadow-(--shadow-border)' : 'text-muted hover:text-fg',
          )}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {item.icon}
            {item.label}
            {item.badge}
          </span>
          {item.hint ? <span className="hidden text-xs text-subtle sm:block">{item.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (value: T) => void;
  items: { id: T; label: string }[];
}) {
  return (
    <div className="flex max-w-full gap-1 overflow-x-auto">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            'h-8 shrink-0 rounded-full px-3 text-xs font-medium tracking-wide uppercase transition-[background-color,color] duration-150',
            value === item.id ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-muted hover:text-fg',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
