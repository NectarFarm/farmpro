'use client';
// DS-3: Large tap-target segmented toggle — one tap, no menu
import React from 'react';
import { cn } from '@/lib/utils';

interface Option<T> { value: T; label: string; icon?: React.ReactNode; }

interface Props<T extends string> {
  options: Option<T>[];
  value: T | null;
  onChange: (v: T) => void;
  label?: string;
  error?: string;
  className?: string;
}

export function SegmentedToggle<T extends string>({ options, value, onChange, label, error, className }: Props<T>) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label && <span className="text-sm font-medium text-gray-700">{label}</span>}
      <div className="flex rounded-xl overflow-hidden border border-gray-300">
        {options.map((opt, i) => (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex-1 min-h-[48px] flex items-center justify-center gap-1 text-base font-semibold transition-colors',
              i > 0 && 'border-l border-gray-300',
              value === opt.value
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-700 active:bg-gray-100'
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        ))}
      </div>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
