'use client';
// Sync engine — drains the Dexie pending queue to the server.
// ARCHITECTURE §9: the queue currently FILLS (enqueuePendingRecord) but never
// drained. This is the drain side: pending -> POST -> mark synced/conflict.
//
// Option B: replace `api.syncBatch` with `POST /api/sync` (Next.js Route Handler)
// once the real server API exists. The client UUID is the server PK, so retries
// are idempotent (FR-M17-5); true edit clashes come back as `conflicts`.

import { useEffect, useRef } from 'react';
import { getDB, getPendingCount, getRejectedCount, type PendingRecord } from './db';
import { useSyncStore } from '@/lib/stores/sync';

async function postSync(
  records: unknown[]
): Promise<{
  accepted: number;
  conflicts: Array<{ clientUuid: string }>;
  rejected?: Array<{ clientUuid: string; error: string }>;
}> {
  const r = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  if (!r.ok) throw new Error('sync failed: ' + r.status);
  return r.json();
}

export async function flushPendingRecords(): Promise<{ synced: number; conflicts: number; rejected: number }> {
  const db = getDB();
  const pending = await db.pending.where('status').equals('pending').toArray();
  if (pending.length === 0) return { synced: 0, conflicts: 0, rejected: 0 };

  // Mark in-flight so a second trigger does not double-send.
  await Promise.all(pending.map((r) => db.pending.update(r.id!, { status: 'syncing' })));

  try {
    const records = pending.map((r: PendingRecord) => ({
      clientUuid: r.clientUuid,
      type: r.type,
      payload: JSON.parse(r.payload),
      capturedAt: r.capturedAt,
    }));

    const res = await postSync(records);
    const conflictUuids = new Set(
      ((res.conflicts as Array<{ clientUuid: string }>) ?? []).map((c) => c.clientUuid)
    );
    // A record the server explicitly rejected (e.g. failed payload validation)
    // was NOT written — it must not be marked 'synced' the way every other
    // non-conflicting record is below, or the worker's data silently vanishes
    // while the app reports success. Surfaced as its own status so the UI can
    // show "this entry failed to save" rather than just retrying forever.
    const rejectedByUuid = new Map(
      ((res.rejected as Array<{ clientUuid: string; error: string }>) ?? []).map((r) => [r.clientUuid, r.error])
    );

    await Promise.all(
      pending.map((r) => {
        const status = rejectedByUuid.has(r.clientUuid)
          ? 'rejected'
          : conflictUuids.has(r.clientUuid) ? 'conflict' : 'synced';
        return db.pending.update(r.id!, { status, ...(rejectedByUuid.has(r.clientUuid) ? { error: rejectedByUuid.get(r.clientUuid) } : {}) });
      })
    );

    return { synced: pending.length - conflictUuids.size - rejectedByUuid.size, conflicts: conflictUuids.size, rejected: rejectedByUuid.size };
  } catch (err) {
    // Revert to pending so the next trigger retries (idempotent on the server).
    await Promise.all(pending.map((r) => db.pending.update(r.id!, { status: 'pending' })));
    throw err;
  }
}

/**
 * Wire into the worker shell. Drains on mount, when the device comes online,
 * and on an interval. Keeps the sync store (badge) in step with the queue.
 */
export function useSync(intervalMs = 30_000) {
  const setStatus = useSyncStore((s) => s.setStatus);
  const setPendingCount = useSyncStore((s) => s.setPendingCount);
  const setRejectedCount = useSyncStore((s) => s.setRejectedCount);
  const setSynced = useSyncStore((s) => s.setSynced);
  const running = useRef(false);

  useEffect(() => {
    const run = async () => {
      if (running.current) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setPendingCount(await getPendingCount());
        return;
      }
      running.current = true;
      try {
        const before = await getPendingCount();
        if (before > 0) {
          setStatus('syncing');
          await flushPendingRecords();
          setSynced();
        }
        setPendingCount(await getPendingCount());
        setRejectedCount(await getRejectedCount());
      } catch {
        setStatus('error');
        setPendingCount(await getPendingCount());
      } finally {
        running.current = false;
      }
    };

    run();
    const onOnline = () => run();
    window.addEventListener('online', onOnline);
    const id = window.setInterval(run, intervalMs);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(id);
    };
  }, [intervalMs, setStatus, setPendingCount, setSynced]);
}
