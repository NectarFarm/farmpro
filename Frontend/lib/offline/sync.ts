'use client';
// Sync engine — drains the Dexie pending queue to the server.
// ARCHITECTURE §9: the queue currently FILLS (enqueuePendingRecord) but never
// drained. This is the drain side: pending -> POST -> mark synced/conflict.
//
// Option B: replace `api.syncBatch` with `POST /api/sync` (Next.js Route Handler)
// once the real server API exists. The client UUID is the server PK, so retries
// are idempotent (FR-M17-5); true edit clashes come back as `conflicts`.

import { useEffect, useRef } from 'react';
import { getDB, getPendingCount, getRejectedCount, getOldestPendingCapturedAt, type PendingRecord } from './db';
import { decryptString } from './crypto';
import { useSyncStore } from '@/lib/stores/sync';

// Exponential backoff (module scope — shared across every useSync() mount).
// A dead/rate-limited server should not be hammered every 30s forever; back
// off up to a 15-minute cap, with jitter so many devices don't retry in lockstep.
let consecutiveFailures = 0;
let nextAttemptAt = 0;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;
function recordFlushFailure() {
  consecutiveFailures++;
  nextAttemptAt = Date.now() + Math.min(BASE_DELAY_MS * 2 ** (consecutiveFailures - 1), MAX_DELAY_MS) + Math.random() * 5_000;
}
function recordFlushSuccess() {
  consecutiveFailures = 0;
  nextAttemptAt = 0;
}
export function resetBackoff() {
  recordFlushSuccess();
}

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
  if (!r.ok) {
    // Status is attached (not just baked into the message) so the caller can
    // classify 401 vs 400/422 vs everything-else without parsing strings.
    const e = new Error('sync failed: ' + r.status) as Error & { status?: number };
    e.status = r.status;
    throw e;
  }
  return r.json();
}

export async function flushPendingRecords(): Promise<{ synced: number; conflicts: number; rejected: number }> {
  const db = getDB();

  // Recover records stuck in 'syncing': that status is only ever set right
  // before the POST below, for the duration of this function. If the app was
  // killed (tab closed, phone locked hard) between that mark and the response,
  // those records are orphaned — no future flush would ever pick them up again
  // because the query below only looks at 'pending'. The server is idempotent
  // by clientUuid, so folding them back into 'pending' here is safe to retry.
  const stuck = await db.pending.where('status').equals('syncing').toArray();
  if (stuck.length > 0) {
    await Promise.all(stuck.map((r) => db.pending.update(r.id!, { status: 'pending' })));
  }

  const pending = await db.pending.where('status').equals('pending').toArray();
  if (pending.length === 0) return { synced: 0, conflicts: 0, rejected: 0 };

  // Mark in-flight so a second trigger does not double-send.
  await Promise.all(pending.map((r) => db.pending.update(r.id!, { status: 'syncing' })));

  try {
    const records = await Promise.all(pending.map(async (r: PendingRecord) => ({
      clientUuid: r.clientUuid,
      type: r.type,
      // r.enc === 1: payload is an EncryptedEnvelope JSON string, decrypt first.
      // Absent (legacy pre-encryption rows): payload is plain JSON, as before.
      payload: JSON.parse(r.enc === 1 ? await decryptString(JSON.parse(r.payload)) : r.payload),
      capturedAt: r.capturedAt,
    })));

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
    // Classify by HTTP status (postSync attaches it) so a session expiry, a
    // malformed payload, and a flaky network don't get treated the same way.
    const status = (err as Error & { status?: number })?.status;
    if (status === 401) {
      // Session expired — not a data problem. Revert without burning an
      // attempt; this will sync on its own once the worker logs in again.
      await Promise.all(pending.map((r) => db.pending.update(r.id!, { status: 'pending' })));
    } else if (status === 400 || status === 422) {
      // Whole-batch schema rejection: the payload itself is likely malformed,
      // so blind retries probably won't succeed — but give it a few tries in
      // case the 4xx was a transient server hiccup before giving up on it.
      await Promise.all(
        pending.map((r) => {
          const attempts = (r.attempts ?? 0) + 1;
          return attempts >= 3
            ? db.pending.update(r.id!, { status: 'rejected', error: 'Server refused this data', attempts })
            : db.pending.update(r.id!, { status: 'pending', attempts });
        })
      );
    } else {
      // Network error/timeout/429/5xx — transient. Revert to pending and keep
      // retrying forever under the backoff cap; offline-first requires
      // eventual delivery, so this class of error never gives up on its own.
      await Promise.all(
        pending.map((r) => db.pending.update(r.id!, { status: 'pending', attempts: (r.attempts ?? 0) + 1 }))
      );
    }
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
  const setOldestPendingCapturedAt = useSyncStore((s) => s.setOldestPendingCapturedAt);
  const running = useRef(false);

  useEffect(() => {
    const run = async (opts?: { force?: boolean }) => {
      if (running.current) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const count = await getPendingCount();
        setPendingCount(count);
        setOldestPendingCapturedAt(count > 0 ? await getOldestPendingCapturedAt() : null);
        return;
      }
      // Backoff gate: skip the flush attempt while still under the cooldown
      // from a recent failure — and skip even the local Dexie pendingCount
      // read too (battery: this branch fires every interval tick, up to
      // every 30s, for the full 15-minute backoff cap). The badge doesn't go
      // stale from this: every record-submission page already calls
      // setPendingCount itself right after enqueueing, and a real flush
      // attempt (cooldown ending, reconnect, or the SW's ifms-synced
      // message) refreshes it the moment one actually happens.
      if (!opts?.force && Date.now() < nextAttemptAt) {
        return;
      }
      running.current = true;
      try {
        const before = await getPendingCount();
        if (before > 0) {
          setStatus('syncing');
          await flushPendingRecords();
          recordFlushSuccess();
          setSynced();
          // Feeding/other syncs decrement server stock — cached ref data (lots,
          // items…) can be stale immediately after a flush. Re-warm so the
          // next offline stretch starts from fresh numbers. Dynamic import
          // avoids a circular-import risk with db.ts.
          void import('./refCache').then(m => m.warmRefCache()).catch(() => {});
        }
        const after = await getPendingCount();
        setPendingCount(after);
        setOldestPendingCapturedAt(after > 0 ? await getOldestPendingCapturedAt() : null);
        setRejectedCount(await getRejectedCount());
      } catch {
        recordFlushFailure();
        setStatus('error');
        const after = await getPendingCount();
        setPendingCount(after);
        setOldestPendingCapturedAt(after > 0 ? await getOldestPendingCapturedAt() : null);
      } finally {
        running.current = false;
      }
    };

    run();
    const onOnline = () => {
      resetBackoff();
      run({ force: true });
    };
    window.addEventListener('online', onOnline);
    const id = window.setInterval(run, intervalMs);

    // Background Sync (2.3): the SW can flush the outbox while this app is
    // backgrounded/closed and posts this message afterwards so the badge
    // reflects the result immediately instead of waiting for the next tick.
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'ifms-synced') run({ force: true });
    };
    const hasSW = typeof navigator !== 'undefined' && !!navigator.serviceWorker;
    if (hasSW) navigator.serviceWorker.addEventListener('message', onMessage);

    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(id);
      if (hasSW) navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, [intervalMs, setStatus, setPendingCount, setRejectedCount, setSynced, setOldestPendingCapturedAt]);
}
