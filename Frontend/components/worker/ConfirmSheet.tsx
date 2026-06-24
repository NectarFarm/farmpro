'use client';
// DS-4: Confirmation for irreversible actions
import React from 'react';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  title: string;
  summary: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  children?: React.ReactNode;
}

export function ConfirmSheet({ open, title, summary, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel, danger, children }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-t-2xl p-6 flex flex-col gap-4 shadow-2xl">
        <h2 className={cn('text-xl font-bold', danger ? 'text-red-700' : 'text-gray-900')}>{title}</h2>
        <p className="text-gray-600 text-base">{summary}</p>
        {children}
        <div className="flex flex-col gap-3 mt-2">
          <button
            type="button"
            onClick={onConfirm}
            className={cn('w-full min-h-[56px] rounded-xl text-lg font-bold text-white', danger ? 'bg-red-600 active:bg-red-700' : 'bg-green-600 active:bg-green-700')}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full min-h-[56px] rounded-xl text-lg font-semibold text-gray-700 bg-gray-100 active:bg-gray-200"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
