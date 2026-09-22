'use client';
// ── EmptyState (ui-kit) — ported from the reference's
// src/components/chrome/empty-state.tsx.
import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl bg-surface px-6 py-12 text-center shadow-(--shadow-border)">
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-muted">{icon}</div>
      <p className="mt-4 text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>
      {action ? <div className="mt-5 w-full max-w-md">{action}</div> : null}
    </div>
  );
}
