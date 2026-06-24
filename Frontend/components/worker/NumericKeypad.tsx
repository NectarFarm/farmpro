'use client';
// DS-3: Large touch targets for field numeric entry
import React, { useState } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (v: string) => void;
  allowDecimal?: boolean;
  unit?: string;
  label?: string;
  className?: string;
  large?: boolean;
}

export function NumericKeypad({ value, onChange, allowDecimal = false, unit, label, className, large }: Props) {
  const digits = ['7','8','9','4','5','6','1','2','3'];
  const btnCls = large
    ? 'h-16 text-2xl font-bold rounded-xl bg-gray-100 active:bg-gray-300 flex items-center justify-center select-none cursor-pointer border border-gray-200'
    : 'h-12 text-xl font-bold rounded-lg bg-gray-100 active:bg-gray-300 flex items-center justify-center select-none cursor-pointer border border-gray-200';

  const press = (k: string) => {
    if (k === '⌫') { onChange(value.slice(0, -1) || ''); return; }
    if (k === '.' && (!allowDecimal || value.includes('.'))) return;
    if (value === '0' && k !== '.') { onChange(k); return; }
    if (value.length >= 8) return;
    onChange(value + k);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {label && <span className="text-sm font-medium text-gray-600">{label}</span>}
      <div className="flex items-center gap-2 bg-white border-2 border-gray-300 rounded-xl px-4 py-3">
        <span className={cn('flex-1 font-bold text-gray-900', large ? 'text-4xl' : 'text-3xl')}>
          {value || '0'}
        </span>
        {unit && <span className="text-gray-500 text-lg font-medium">{unit}</span>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {digits.map(d => (
          <button key={d} type="button" className={btnCls} onClick={() => press(d)}>{d}</button>
        ))}
        {allowDecimal
          ? <button type="button" className={btnCls} onClick={() => press('.')}>.</button>
          : <div />
        }
        <button type="button" className={btnCls} onClick={() => press('0')}>0</button>
        <button type="button" className={cn(btnCls, 'bg-red-50 text-red-600')} onClick={() => press('⌫')}>⌫</button>
      </div>
    </div>
  );
}
