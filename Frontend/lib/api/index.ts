// API facade. Every call routes through the real Next.js Route Handlers
// (Postgres, tenant-scoped, field-permission filtered). No mock mode.
import { uuid } from '@/lib/uuid';
import type {
  ProductionUnit, Batch, InventoryItem, InventoryLot, Task, Alert, Sale, Purchase,
  Employee, WorkerProfile, User, BatchCostSummary, Product, HealthRecord,
} from '@/lib/types';

// Rural/mobile connections can hang indefinitely with no error and no retry
// prompt. Every fetch below is bounded so a stalled request surfaces as a
// clear, catchable error instead of blocking forever.
const REQUEST_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out — check your connection and try again.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetchWithTimeout(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json() as Promise<T>;
}
async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const r = await fetchWithTimeout(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `${url} -> ${r.status}`;
    try { msg = ((await r.json()) as { error?: string }).error ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}
async function patchJSON<T>(url: string, body: unknown): Promise<T> {
  const r = await fetchWithTimeout(url, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `${url} -> ${r.status}`;
    try { msg = ((await r.json()) as { error?: string }).error ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

const api = {
  getUnits: () => getJSON<ProductionUnit[]>('/api/data/units'),
  getBatches: () => getJSON<Batch[]>('/api/data/batches'),
  getBatch: (id: string) =>
    getJSON<Batch>(`/api/data/batches?id=${encodeURIComponent(id)}`),
  getItems: () => getJSON<InventoryItem[]>('/api/data/items'),
  getLots: () => getJSON<InventoryLot[]>('/api/data/lots'),
  getLotsByItem: async (itemId: string) =>
    (await getJSON<InventoryLot[]>('/api/data/lots')).filter((l) => l.itemId === itemId),
  getTasks: async (userId: string) =>
    getJSON<Task[]>(`/api/data/tasks?assignedTo=${encodeURIComponent(userId)}`),
  getAlerts: () => getJSON<Alert[]>('/api/data/alerts'),
  getEmployees: () => getJSON<Employee[]>('/api/data/employees'),
  getWorkerProfiles: () => getJSON<WorkerProfile[]>('/api/data/worker-profiles'),
  createWorkerProfile: async (data: Record<string, unknown>) =>
    postJSON<{ id: string }>('/api/data/worker-profiles', data),
  updateWorkerProfile: async (id: string, data: Record<string, unknown>) =>
    patchJSON<{ id: string }>(`/api/data/worker-profiles?id=${encodeURIComponent(id)}`, data),
  // limit=0 opts out of the route's default row cap — finance totals must sum
  // every row, not a truncated page (app/api/data/[resource]/route.ts).
  getSales: () => getJSON<Sale[]>('/api/data/sales?limit=0'),
  getPurchases: () => getJSON<Purchase[]>('/api/data/purchases?limit=0'),
  recordSale: async (data: Record<string, unknown>) =>
    postJSON<{ id: string; status: string }>('/api/data/sales', data),
  // Purchases have their own route (it creates an inventory LOT + the purchase row);
  // the generic /api/data POST doesn't handle them. Going through /api/data here was
  // the bug that made "Record Purchase" silently fail (stock never appeared).
  recordPurchase: async (data: Record<string, unknown>) => {
    const r = await postJSON<{ id: string }>('/api/purchases', data);
    return { id: r.id, status: 'accepted' };
  },
  getCostSummary: (batchId: string) =>
    getJSON<BatchCostSummary>(`/api/cost-summary?batchId=${encodeURIComponent(batchId)}`),
  getHealthRecords: async (batchId: string) =>
    (await getJSON<HealthRecord[]>('/api/data/health-records')).filter((h) => h.batchId === batchId),
  // Vet prescriptions have their own route (writes a healthRecords row + optionally
  // the referenced lot's withdrawalDays — see app/api/prescriptions/route.ts).
  prescribe: (data: Record<string, unknown>) =>
    postJSON<{ id: string }>('/api/prescriptions', data),
  getUsers: () => getJSON<User[]>('/api/workers'),
  // Field events go through the offline-sync contract (clientUuid = server PK → idempotent).
  submitRecord: async (type: string, payload: unknown) => {
    const clientUuid = uuid();
    const res = await postJSON<{ accepted: number }>('/api/sync', {
      records: [{ clientUuid, type, payload, capturedAt: new Date().toISOString() }],
    });
    return { id: clientUuid, status: res.accepted ? 'accepted' : 'rejected' };
  },
  syncBatch: (records: unknown[]) =>
    postJSON<{ accepted: number; conflicts: never[] }>('/api/sync', { records }),
};

export { api };

export const loginOwner = async (email: string, password: string) => {
  const { user } = await postJSON<{ user: User }>('/api/auth/owner', { email, password });
  return { access: 'session', refresh: 'session', user };
};

export const loginWorker = async (phone: string, pin: string) => {
  const { user } = await postJSON<{ user: User }>('/api/auth/worker', { phone, pin });
  return { access: 'session', refresh: 'session', user };
};

// Products a batch yields (eggs/pork/manure…) with priced sale units.
export const getProducts = async (batchId?: string) =>
  getJSON<Product[]>(`/api/products${batchId ? `?batchId=${encodeURIComponent(batchId)}` : ''}`);

export const createProduct = async (data: Record<string, unknown>) =>
  postJSON<{ id: string }>('/api/products', data);

export const updateProduct = async (id: string, data: Record<string, unknown>) =>
  patchJSON<{ id: string }>(`/api/products?id=${encodeURIComponent(id)}`, data);

// Worker profile is layout-only (not a security boundary — server already strips fields).
// Retrieve the tenant's default profile for the current user.
export const getWorkerProfile = async (profileId: string) =>
  getJSON<WorkerProfile>(`/api/data/worker-profiles?id=${encodeURIComponent(profileId)}`);

// Costing KPIs — real endpoint.
export const getDashboardKPIs = () =>
  getJSON<{
    activeBatches: number; totalBirds: number; mortalityPct: number; avgFCR: number;
    grossMargin: number; pendingAlerts: number; taskCompletionPct: number;
    revenueThisMonth: number; revenueThisQuarter: number; revenueThisYear: number; revenueAllTime: number;
  }>('/api/dashboard/kpis');

// Chart series — real endpoints.
export const getProductionChartData = () =>
  getJSON<{ data: Record<string, string | number>[]; products: string[] }>('/api/charts/production');

export const getCumulativeChartData = (batchId: string) =>
  getJSON<{ day: number; cost: number; revenue: number }[]>(`/api/charts/cumulative?batchId=${encodeURIComponent(batchId)}`);
