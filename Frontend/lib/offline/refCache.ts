'use client';
// Offline read-cache: cache-through wrapper around the reference-data GETs
// that worker record forms depend on (batches/units/items/lots/tasks/products).
// Network first -> write cache -> on network failure serve last-known-good
// with a stale flag. The 15s fetchWithTimeout in lib/api/index.ts is what
// makes this work on 2G: a hang becomes a thrown error -> cache fallback.
import { getDB } from './db';
import { api, getProducts } from '@/lib/api';

export interface CachedResult<T> { data: T; stale: boolean; cachedAt: string | null; }

export async function cachedFetch<T>(key: string, fetcher: () => Promise<T>): Promise<CachedResult<T>> {
  try {
    const data = await fetcher();
    try { await getDB().refCache.put({ key, data: JSON.stringify(data), cachedAt: new Date().toISOString() }); } catch {}
    return { data, stale: false, cachedAt: null };
  } catch (err) {
    let entry;
    try { entry = await getDB().refCache.get(key); } catch { entry = undefined; }
    if (!entry) throw err; // first-ever offline use: keep existing error UX
    return { data: JSON.parse(entry.data) as T, stale: true, cachedAt: entry.cachedAt };
  }
}

export const cachedApi = {
  getBatches: () => cachedFetch('batches', api.getBatches),
  getUnits: () => cachedFetch('units', api.getUnits),
  getItems: () => cachedFetch('items', api.getItems),
  getLots: () => cachedFetch('lots', api.getLots),
  getTasks: (userId: string) => cachedFetch(`tasks:${userId}`, () => api.getTasks(userId)),
  getProducts: (batchId: string) => cachedFetch(`products:${batchId}`, () => getProducts(batchId)),
};

export async function warmRefCache() {
  await Promise.allSettled([cachedApi.getBatches(), cachedApi.getUnits(), cachedApi.getItems(), cachedApi.getLots()]);
}
