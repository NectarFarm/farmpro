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
  status: 'pending' | 'syncing' | 'synced' | 'conflict';
}

export interface CachedPinHash {
  phone: string;
  pinHash: string; // Argon2id-style simple hash (simulated for demo)
  userId: string;
  workerProfileId?: string;
  cachedAt: string;
}

export interface CachedWorkerProfile {
  id: string;
  data: string; // JSON
  cachedAt: string;
}

class IFMSDatabase extends Dexie {
  pending!: Table<PendingRecord>;
  pinCache!: Table<CachedPinHash>;
  profileCache!: Table<CachedWorkerProfile>;

  constructor() {
    super('ifms_worker_db');
    this.version(1).stores({
      pending: '++id, clientUuid, type, status, capturedAt',
      pinCache: 'phone, userId',
      profileCache: 'id',
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
