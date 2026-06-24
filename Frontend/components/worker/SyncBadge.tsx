'use client';
import React from 'react';
import { useSyncStore } from '@/lib/stores/sync';
import { cn } from '@/lib/utils';

export function SyncBadge({ className }: { className?: string }) {
  const { isOnline, status, pendingCount } = useSyncStore();

  if (!isOnline || status === 'offline') {
    return (
      <span className={cn('inline-flex items-center gap-1 bg-gray-200 text-gray-700 border border-gray-400 rounded-full px-3 py-1 text-sm font-bold', className)}>
        <span>⤬</span> OFFLINE {pendingCount > 0 && `· ${pendingCount} queued`}
      </span>
    );
  }
  if (status === 'syncing') {
    return (
      <span className={cn('inline-flex items-center gap-1 bg-blue-100 text-blue-700 border border-blue-300 rounded-full px-3 py-1 text-sm font-semibold animate-pulse', className)}>
        <span>↻</span> Syncing {pendingCount > 0 && `${pendingCount}…`}
      </span>
    );
  }
  if (pendingCount > 0) {
    return (
      <span className={cn('inline-flex items-center gap-1 bg-amber-100 text-amber-700 border border-amber-300 rounded-full px-3 py-1 text-sm font-semibold', className)}>
        <span>↑</span> {pendingCount} pending
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1 bg-green-100 text-green-700 border border-green-300 rounded-full px-3 py-1 text-sm font-semibold', className)}>
      <span>✓</span> Online
    </span>
  );
}
