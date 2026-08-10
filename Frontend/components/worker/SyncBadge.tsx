'use client';
import React from 'react';
import { useSyncStore } from '@/lib/stores/sync';
import { cn } from '@/lib/utils';
import { AlertTriangle, WifiOff, Loader2, ArrowUp, Check } from 'lucide-react';

const STALE_OUTBOX_MS = 24 * 60 * 60_000; // 24h — a device lost/destroyed before this syncs loses that data for good

export function SyncBadge({ className }: { className?: string }) {
  const { isOnline, status, pendingCount, rejectedCount, oldestPendingCapturedAt } = useSyncStore();

  // Takes priority over every other state — data that failed to save needs the
  // worker's attention regardless of whether the rest of the queue is clean.
  if (rejectedCount > 0) {
    return (
      <span className={cn('inline-flex items-center gap-1 bg-red-100 text-red-700 border border-red-300 rounded-full px-3 py-1 text-sm font-bold', className)}>
        <AlertTriangle className="w-3.5 h-3.5" /> {rejectedCount} failed to save
      </span>
    );
  }

  const stale = oldestPendingCapturedAt !== null && Date.now() - new Date(oldestPendingCapturedAt).getTime() > STALE_OUTBOX_MS;
  if (stale) {
    return (
      <span className={cn('inline-flex items-center gap-1 bg-orange-100 text-orange-700 border border-orange-300 rounded-full px-3 py-1 text-sm font-bold', className)}>
        <AlertTriangle className="w-3.5 h-3.5" /> {pendingCount} unsynced 24h+ — reconnect soon
      </span>
    );
  }

  if (!isOnline || status === 'offline') {
    return (
      <span className={cn('inline-flex items-center gap-1 bg-gray-200 text-gray-700 border border-gray-400 rounded-full px-3 py-1 text-sm font-bold', className)}>
        <WifiOff className="w-3.5 h-3.5" /> OFFLINE {pendingCount > 0 && `· ${pendingCount} queued`}
      </span>
    );
  }
  if (status === 'syncing') {
    return (
      <span className={cn('inline-flex items-center gap-1 bg-blue-100 text-blue-700 border border-blue-300 rounded-full px-3 py-1 text-sm font-semibold animate-pulse', className)}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Syncing {pendingCount > 0 && `${pendingCount}…`}
      </span>
    );
  }
  if (pendingCount > 0) {
    return (
      <span className={cn('inline-flex items-center gap-1 bg-amber-100 text-amber-700 border border-amber-300 rounded-full px-3 py-1 text-sm font-semibold', className)}>
        <ArrowUp className="w-3.5 h-3.5" /> {pendingCount} pending
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1 bg-green-100 text-green-700 border border-green-300 rounded-full px-3 py-1 text-sm font-semibold', className)}>
      <Check className="w-3.5 h-3.5" /> Online
    </span>
  );
}
