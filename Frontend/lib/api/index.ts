// API facade. Screens import from here (not from lib/mock/api directly).
// Flag NEXT_PUBLIC_USE_REAL_API=true → endpoint-backed reads hit the real Route
// Handlers (Postgres, tenant-scoped, field-permission filtered). Off (default) →
// identical to the mock, so the demo is unchanged and zero-risk.
import * as mock from '@/lib/mock/api';
import type {
  ProductionUnit, Batch, InventoryItem, InventoryLot, Task, Alert, Sale, Purchase,
  Employee, WorkerProfile, User, BatchCostSummary, Product,
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

// Real implementations for the endpoint-backed reads; everything else (cost summary,
// health records, getUsers, submitRecord, syncBatch) falls through to the mock spread
// until those tiers (costing/reporting) exist per ARCHITECTURE.
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
  getSales: () => getJSON<Sale[]>('/api/data/sales'),
  getPurchases: () => getJSON<Purchase[]>('/api/data/purchases'),
  getCostSummary: (batchId: string) =>
    getJSON<BatchCostSummary>(`/api/cost-summary?batchId=${encodeURIComponent(batchId)}`).catch(() => null),
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

// Products a batch yields (eggs/pork/manure…) with priced sale units. Real only.
export const getProducts: (batchId?: string) => Promise<Product[]> = USE_REAL
  ? (batchId?: string) => getJSON<Product[]>(`/api/products${batchId ? `?batchId=${encodeURIComponent(batchId)}` : ''}`).catch(() => [])
  : () => Promise.resolve([]);

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
