'use client';
// Dexie IndexedDB schema — offline-first worker store
// Runs in browser only; never on server/edge

import Dexie, { type Table } from 'dexie';
// Static import deliberately, NOT `await import('./crypto')`: a dynamic import
// is a separate on-demand chunk that Turbopack/webpack fetches over the
// network the first time it's called — which fails offline even though the
// module was already loaded elsewhere on the page. That would break the
// exact offline-first submission path this encryption code is meant to run
// on. crypto.ts imports `getDB` back from this file, but the cycle is safe:
// both sides only touch the imported binding inside function bodies, never
// at module-init time.
import { encryptString } from './crypto';

export interface PendingRecord {
  id?: number; // auto-incremented local key
  clientUuid: string;
  type: string;
  payload: string; // JSON stringified, OR an EncryptedEnvelope (iv/ct) JSON string when enc:1
  capturedAt: string;
  // 'rejected' = the server explicitly refused this record (e.g. failed
  // validation) — distinct from 'conflict' (both versions were valid, one won)
  // and from staying 'pending' (not yet sent / will retry). A rejected record
  // will NOT succeed on retry without the worker fixing the underlying data,
  // so it's surfaced to the UI rather than silently retried forever.
  status: 'pending' | 'syncing' | 'synced' | 'conflict' | 'rejected';
  error?: string;
  attempts?: number; // used by sync retry/backoff (Phase 2); not indexed
  // Presence (not content-sniffing) marks `payload` as an encrypted envelope —
  // explicit so a legacy plaintext payload that happens to contain keys named
  // iv/ct is never misread. Absent = legacy plaintext JSON (pre-encryption rows).
  enc?: 1;
}

export interface CachedPinHash {
  phone: string;
  pinHash: string; // Argon2id-style simple hash (simulated for demo)
  userId: string;
  workerProfileId?: string;
  cachedAt: string;
}

export interface CachedRef {
  key: string;        // 'batches' | 'units' | 'items' | 'lots' | `tasks:${userId}` | `products:${batchId}`
  data: string;        // JSON.stringify'd payload, OR an EncryptedEnvelope JSON string when enc:1
  cachedAt: string;    // ISO timestamp
  enc?: 1;             // see PendingRecord.enc
}

// One row, id: 'device-key'. See lib/offline/crypto.ts for the key's design —
// a non-extractable CryptoKey, natively structured-clonable into IndexedDB.
export interface DeviceKeyRow {
  id: string;
  key: CryptoKey;
  createdAt: string;
}

class IFMSDatabase extends Dexie {
  pending!: Table<PendingRecord>;
  pinCache!: Table<CachedPinHash>;
  refCache!: Table<CachedRef>;
  keyStore!: Table<DeviceKeyRow>;

  constructor() {
    super('ifms_worker_db');
    this.version(1).stores({
      pending: '++id, clientUuid, type, status, capturedAt',
      pinCache: 'phone, userId',
      profileCache: 'id',
    });
    // v2: add refCache (offline read-cache for reference data); profileCache
    // was dead — never written anywhere — so it's dropped here.
    this.version(2).stores({
      refCache: 'key',
      profileCache: null,
    });
    // v3: add keyStore (device encryption key — lib/offline/crypto.ts). Only a
    // new object store is added; the `enc` field on pending/refCache rows is
    // additive data, not an index, so it needs no version bump of its own.
    this.version(3).stores({
      keyStore: 'id',
    });
  }
}

// Singleton — only instantiate in browser
let _db: IFMSDatabase | null = null;
export function getDB(): IFMSDatabase {
  if (typeof window === 'undefined') throw new Error('Dexie only runs in browser');
  if (!_db) _db = new IFMSDatabase();
  return _db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function enqueuePendingRecord(type: string, payload: unknown, clientUuid: string) {
  const db = getDB();
  const envelope = await encryptString(JSON.stringify(payload));
  await db.pending.add({
    clientUuid,
    type,
    payload: JSON.stringify(envelope),
    enc: 1,
    capturedAt: new Date().toISOString(),
    status: 'pending',
  });
  // Progressive enhancement: ask the browser to flush the outbox even if the
  // app gets closed/backgrounded before the in-app interval runs again.
  // Unsupported on iOS/Firefox — silently no-ops there; the in-app interval
  // (useSync) remains the primary delivery path either way.
  try {
    const reg = await navigator.serviceWorker?.ready;
    await (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register('ifms-flush');
  } catch { /* unsupported or SW not ready */ }
}

export async function getPendingCount(): Promise<number> {
  try {
    const db = getDB();
    return db.pending.where('status').anyOf(['pending','syncing']).count();
  } catch { return 0; }
}

export async function getRejectedCount(): Promise<number> {
  try {
    const db = getDB();
    return db.pending.where('status').equals('rejected').count();
  } catch { return 0; }
}

// Oldest still-outstanding record's capturedAt — drives the SyncBadge's
// stale-outbox warning (a device lost/destroyed before this syncs loses that
// data permanently, so a worker sitting on an old unsynced queue should be
// prompted to reconnect before that happens).
export async function getOldestPendingCapturedAt(): Promise<string | null> {
  try {
    const db = getDB();
    const rows = await db.pending.where('status').anyOf(['pending', 'syncing']).toArray();
    if (rows.length === 0) return null;
    return rows.reduce((oldest, r) => (r.capturedAt < oldest ? r.capturedAt : oldest), rows[0].capturedAt);
  } catch { return null; }
}

// Logout-time cleanup: purge only rows that are safely redundant locally —
// already-synced records (safe, they're durably on the server) and the
// disposable reference-data cache (repopulates on next login's warmRefCache()).
// Deliberately NEVER touches 'pending'/'syncing'/'conflict'/'rejected' rows —
// those represent real unsynced work and must survive a logout. Narrows the
// window in which a shared device could have a previous worker's data sitting
// in local storage after they've logged out.
export async function purgeSyncedAndCacheOnLogout(): Promise<void> {
  try {
    const db = getDB();
    const synced = await db.pending.where('status').equals('synced').primaryKeys();
    await Promise.all([
      db.pending.bulkDelete(synced),
      db.refCache.clear(),
    ]);
  } catch { /* best-effort — never block logout on this */ }
}

export interface TodayRecordSummary {
  id: number;
  clientUuid: string;
  type: string;
  capturedAt: string;
  status: PendingRecord['status'];
}

// Everything captured on THIS device today, any status (pending/synced/rejected/
// conflict) — read-only review for the worker (Phase 6 item 7), not an edit/undo
// surface. Newest first.
export async function getTodayRecords(): Promise<TodayRecordSummary[]> {
  try {
    const db = getDB();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const rows = await db.pending.where('capturedAt').aboveOrEqual(startOfDay.toISOString()).toArray();
    return rows
      .filter((r): r is PendingRecord & { id: number } => r.id !== undefined)
      .map((r) => ({ id: r.id, clientUuid: r.clientUuid, type: r.type, capturedAt: r.capturedAt, status: r.status }))
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  } catch { return []; }
}

// PBKDF2 (100k) over the PIN, salted by phone — so a stolen device's IndexedDB
// can't reveal the PIN. (Real login is server-side PBKDF2; this is offline unlock.)
export async function hashPin(phone: string, pin: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(`ifms:${phone}`), iterations: 100_000, hash: 'SHA-256' }, key, 256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function cachePinHash(phone: string, userId: string, pinHash: string, workerProfileId?: string) {
  const db = getDB();
  await db.pinCache.put({ phone, userId, pinHash, workerProfileId, cachedAt: new Date().toISOString() });
}

export async function verifyPinOffline(phone: string, pin: string): Promise<CachedPinHash | null> {
  try {
    const db = getDB();
    const entry = await db.pinCache.get(phone);
    if (!entry) return null;
    return entry.pinHash === (await hashPin(phone, pin)) ? entry : null;
  } catch { return null; }
}
