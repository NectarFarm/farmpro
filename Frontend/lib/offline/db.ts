'use client';
// Dexie IndexedDB schema — offline-first worker store
// Runs in browser only; never on server/edge

import Dexie, { type Table } from 'dexie';

export interface PendingRecord {
  id?: number; // auto-incremented local key
  clientUuid: string;
  type: string;
  payload: string; // JSON stringified
  capturedAt: string;
  // 'rejected' = the server explicitly refused this record (e.g. failed
  // validation) — distinct from 'conflict' (both versions were valid, one won)
  // and from staying 'pending' (not yet sent / will retry). A rejected record
  // will NOT succeed on retry without the worker fixing the underlying data,
  // so it's surfaced to the UI rather than silently retried forever.
  status: 'pending' | 'syncing' | 'synced' | 'conflict' | 'rejected';
  error?: string;
  attempts?: number; // used by sync retry/backoff (Phase 2); not indexed
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
  data: string;        // JSON.stringify'd payload
  cachedAt: string;    // ISO timestamp
}

class IFMSDatabase extends Dexie {
  pending!: Table<PendingRecord>;
  pinCache!: Table<CachedPinHash>;
  refCache!: Table<CachedRef>;

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
  await db.pending.add({
    clientUuid,
    type,
    payload: JSON.stringify(payload),
    capturedAt: new Date().toISOString(),
    status: 'pending',
  });
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
