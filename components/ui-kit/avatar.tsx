'use client';
// ── Avatar (ui-kit) — ported verbatim from the reference's
// src/components/ui/avatar.tsx. Deterministic tone-by-name-hash so the same
// person always gets the same colour without a per-user colour column.
import { cn } from '@/lib/utils';

const TONES = [
  'bg-primary-soft text-primary',
  'bg-warning-soft text-warning',
  'bg-surface-2 text-muted',
  'bg-danger-soft text-danger',
] as const;

function toneFor(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash + ch.charCodeAt(0)) % TONES.length;
  return TONES[hash] ?? TONES[0];
}

/** First letter of up to the first two words — "Amina Njoroge" -> "AN". */
export function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dim = size === 'sm' ? 'size-7 text-xs' : size === 'lg' ? 'size-11 text-sm' : 'size-9 text-xs';
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-medium',
        dim,
        toneFor(name || '?'),
        className,
      )}
    >
      {initials(name) || '?'}
    </span>
  );
}
