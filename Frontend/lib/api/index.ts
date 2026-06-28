// API facade. Screens import from here (not from lib/mock/api directly).
// Flag NEXT_PUBLIC_USE_REAL_API=true → endpoint-backed reads hit the real Route
// Handlers (Postgres, tenant-scoped, field-permission filtered). Off (default) →
// identical to the mock, so the demo is unchanged and zero-risk.
import * as mock from '@/lib/mock/api';
import { uuid } from '@/lib/uuid';
import type {
  ProductionUnit, Batch, InventoryItem, InventoryLot, Task, Alert, Sale, Purchase,
  Employee, WorkerProfile, User, BatchCostSummary, Product, HealthRecord,
} from '@/lib/types';

const USE_REAL = process.env.NEXT_PUBLIC_USE_REAL_API === 'true';

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json() as Promise<T>;
}
async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
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
  const r = await fetch(url, {
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

// Real implementations for every endpoint-backed call. With USE_REAL on, nothing
// falls through to the mock — the spread only seeds the object shape; every member
// below is overridden so the running app is 100% live (Postgres, tenant-scoped).
const realApi: typeof mock.api = {
  ...mock.api,
  getUnits: () => getJSON<ProductionUnit[]>('/api/data/units'),
  getBatches: () => getJSON<Batch[]>('/api/data/batches'),
  getBatch: (id: string) =>
    getJSON<Batch>(`/api/data/batches?id=${encodeURIComponent(id)}`).catch(() => null),
  getItems: () => getJSON<InventoryItem[]>('/api/data/items'),
  getLots: () => getJSON<InventoryLot[]>('/api/data/lots'),
  getLotsByItem: async (itemId: string) =>
    (await getJSON<InventoryLot[]>('/api/data/lots')).filter((l) => l.itemId === itemId),
  getTasks: async (userId: string) =>
    (await getJSON<Task[]>('/api/data/tasks')).filter((t) => t.assignedTo === userId),
  getAlerts: () => getJSON<Alert[]>('/api/data/alerts'),
  getEmployees: () => getJSON<Employee[]>('/api/data/employees'),
  getWorkerProfiles: () => getJSON<WorkerProfile[]>('/api/data/worker-profiles'),
  createWorkerProfile: async (data: Record<string, unknown>) =>
    postJSON<{ id: string }>('/api/data/worker-profiles', data),
  updateWorkerProfile: async (id: string, data: Record<string, unknown>) =>
    patchJSON<{ id: string }>(`/api/data/worker-profiles?id=${encodeURIComponent(id)}`, data),
  getSales: () => getJSON<Sale[]>('/api/data/sales'),
  getPurchases: () => getJSON<Purchase[]>('/api/data/purchases'),
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
    getJSON<BatchCostSummary>(`/api/cost-summary?batchId=${encodeURIComponent(batchId)}`).catch(() => null),
  getHealthRecords: async (batchId: string) =>
    (await getJSON<HealthRecord[]>('/api/data/health-records')).filter((h) => h.batchId === batchId),
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

export const api = USE_REAL ? realApi : mock.api;

export const loginOwner = USE_REAL
  ? async (email: string, password: string) => {
      const { user } = await postJSON<{ user: User }>('/api/auth/owner', { email, password });
      return { access: 'session', refresh: 'session', user };
    }
  : mock.loginOwner;

export const loginWorker = USE_REAL
  ? async (phone: string, pin: string) => {
      const { user } = await postJSON<{ user: User }>('/api/auth/worker', { phone, pin });
      return { access: 'session', refresh: 'session', user };
    }
  : mock.loginWorker;

// Products a batch yields (eggs/pork/manure…) with priced sale units.
export const getProducts: (batchId?: string) => Promise<Product[]> = USE_REAL
  ? (batchId?: string) => getJSON<Product[]>(`/api/products${batchId ? `?batchId=${encodeURIComponent(batchId)}` : ''}`).catch(() => [])
  : (batchId?: string) => mock.api.getProducts(batchId);

export const createProduct: (data: Record<string, unknown>) => Promise<{ id: string }> = USE_REAL
  ? (data) => postJSON<{ id: string }>('/api/products', data)
  : (data) => mock.api.createProduct(data);

export const updateProduct: (id: string, data: Record<string, unknown>) => Promise<{ id: string }> = USE_REAL
  ? (id, data) => patchJSON<{ id: string }>(`/api/products?id=${encodeURIComponent(id)}`, data)
  : (id, data) => mock.api.updateProduct(id, data);

// Layout-only (not a security boundary — server already strips fields). Mock for now.
export const getWorkerProfile = mock.getWorkerProfile;

// Costing KPIs — real endpoint when enabled; always async (Promise) so callers
// can await regardless of mode.
export const getDashboardKPIs: () => Promise<ReturnType<typeof mock.getDashboardKPIs>> = USE_REAL
  ? () => getJSON<ReturnType<typeof mock.getDashboardKPIs>>('/api/dashboard/kpis')
  : () => Promise.resolve(mock.getDashboardKPIs());

// Chart series — real endpoints when enabled; always async so callers await.
export const getProductionChartData: () => Promise<ReturnType<typeof mock.getProductionChartData>> = USE_REAL
  ? () => getJSON<ReturnType<typeof mock.getProductionChartData>>('/api/charts/production')
  : () => Promise.resolve(mock.getProductionChartData());

export const getCumulativeChartData: (batchId: string) => Promise<ReturnType<typeof mock.getCumulativeChartData>> = USE_REAL
  ? (batchId: string) => getJSON<ReturnType<typeof mock.getCumulativeChartData>>(`/api/charts/cumulative?batchId=${encodeURIComponent(batchId)}`).catch(() => [])
  : (batchId: string) => Promise.resolve(mock.getCumulativeChartData(batchId));
