// DS-1/2: Status encoded three ways — color + icon + text
import React from 'react';
import { cn } from '@/lib/utils';
import { Check, AlertTriangle, OctagonAlert, WifiOff, Info, type LucideIcon } from 'lucide-react';

type Status = 'ok' | 'warning' | 'critical' | 'offline' | 'info';

const config: Record<Status, { bg: string; text: string; Icon: LucideIcon; label: string }> = {
  ok:       { bg: 'bg-green-100 border-green-400',  text: 'text-green-800',  Icon: Check,        label: 'OK' },
  warning:  { bg: 'bg-amber-100 border-amber-400',  text: 'text-amber-800',  Icon: AlertTriangle, label: 'WARN' },
  critical: { bg: 'bg-red-100 border-red-500',      text: 'text-red-800',    Icon: OctagonAlert,  label: 'CRITICAL' },
  offline:  { bg: 'bg-gray-100 border-gray-400',    text: 'text-gray-700',   Icon: WifiOff,       label: 'OFFLINE' },
  info:     { bg: 'bg-blue-100 border-blue-400',    text: 'text-blue-800',   Icon: Info,          label: 'INFO' },
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
  const iconSz = size === 'sm' ? 'w-3 h-3' : size === 'lg' ? 'w-4 h-4' : 'w-3.5 h-3.5';
  return (
    <span className={cn('inline-flex items-center gap-1 border rounded-full font-semibold', c.bg, c.text, sz, className)}>
      <c.Icon className={cn(iconSz, 'shrink-0')} aria-hidden />
      <span>{label ?? c.label}</span>
    </span>
  );
}
