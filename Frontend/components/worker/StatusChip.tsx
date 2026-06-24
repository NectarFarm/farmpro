// DS-1/2: Status encoded three ways — color + icon + text
import React from 'react';
import { cn } from '@/lib/utils';

type Status = 'ok' | 'warning' | 'critical' | 'offline' | 'info';

const config: Record<Status, { bg: string; text: string; icon: string; label: string }> = {
  ok:       { bg: 'bg-green-100 border-green-400',  text: 'text-green-800',  icon: '✓', label: 'OK' },
  warning:  { bg: 'bg-amber-100 border-amber-400',  text: 'text-amber-800',  icon: '▲', label: 'WARN' },
  critical: { bg: 'bg-red-100 border-red-500',      text: 'text-red-800',    icon: '⛔', label: 'CRITICAL' },
  offline:  { bg: 'bg-gray-100 border-gray-400',    text: 'text-gray-700',   icon: '⤬', label: 'OFFLINE' },
  info:     { bg: 'bg-blue-100 border-blue-400',    text: 'text-blue-800',   icon: 'ℹ', label: 'INFO' },
};

interface Props {
  status: Status;
  label?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function StatusChip({ status, label, className, size = 'md' }: Props) {
  const c = config[status];
  const sz = size === 'sm' ? 'text-xs px-2 py-0.5' : size === 'lg' ? 'text-base px-4 py-1.5' : 'text-sm px-3 py-1';
  return (
    <span className={cn('inline-flex items-center gap-1 border rounded-full font-semibold', c.bg, c.text, sz, className)}>
      <span aria-hidden>{c.icon}</span>
      <span>{label ?? c.label}</span>
    </span>
  );
}
