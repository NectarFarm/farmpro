import { create } from 'zustand';
import { toast } from 'sonner';
import type {
  Flock, MortalityRecord, FeedRecord, VaccinationRecord,
  EggCollection, Customer, Sale, Expense, Budget,
  Cage, FeedInventory, Alert, Employee, UserSession,
  EmployeeSalary, OrderRequest, FlockStageConfig,
  BirdStageSale, CustomerPortalUser, FeedDispenseRecord,
} from './types';

// ─── API helper ───────────────────────────────────────────────────────────────

async function api<T = unknown>(
  url: string,
  opts: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? res.statusText);
  return data as T;
}

// ─── Store shape ──────────────────────────────────────────────────────────────

interface FarmStore {
  initialized: boolean;
  loading: boolean;

  // Auth
  session: UserSession | null;
  employees: Employee[];
  setSession: (s: UserSession | null) => void;
  login: (pin: string, type: 'owner' | 'employee' | 'customer', entityId?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  addEmployee: (name: string, pin: string) => Promise<Employee | null>;
  updateEmployee: (id: string, updates: { name?: string; pin?: string }) => Promise<void>;
  removeEmployee: (id: string) => Promise<void>;

  // Pricing
  pricePerEgg: number;
  pricePerTray: number;
  pricePerChick: number;
  setPricing: (p: Partial<{ pricePerEgg: number; pricePerTray: number; pricePerChick: number }>) => void;

  // Flock Stages
  flockStages: FlockStageConfig[];
  addFlockStage: (s: FlockStageConfig) => void;
  updateFlockStage: (id: string, updates: Partial<FlockStageConfig>) => void;
  deleteFlockStage: (id: string) => void;

  // Bird Stage Sales
  birdStageSales: BirdStageSale[];
  addBirdStageSale: (s: BirdStageSale) => void;
  deleteBirdStageSale: (id: string) => void;

  // Customer Portal Users
  customerPortalUsers: CustomerPortalUser[];
  addCustomerPortalUser: (u: CustomerPortalUser & { pin: string }) => void;
  updateCustomerPortalUser: (id: string, updates: Partial<CustomerPortalUser> & { pin?: string }) => void;
  removeCustomerPortalUser: (id: string) => void;

  // Employee Salaries
  employeeSalaries: EmployeeSalary[];
  addEmployeeSalary: (s: EmployeeSalary) => void;
  updateEmployeeSalary: (id: string, updates: Partial<EmployeeSalary>) => void;
  deleteEmployeeSalary: (id: string) => void;
  triggerSalaryExpenses: () => void;

  // Order Requests
  orderRequests: OrderRequest[];
  addOrderRequest: (r: OrderRequest) => void;
  updateOrderRequest: (id: string, updates: Partial<OrderRequest>) => void;
  deleteOrderRequest: (id: string) => void;

  // Flocks
  flocks: Flock[];
  addFlock: (f: Flock) => void;
  updateFlock: (id: string, updates: Partial<Flock>) => void;
  deleteFlock: (id: string) => void;

  // Mortality
  mortalityRecords: MortalityRecord[];
  addMortalityRecord: (r: MortalityRecord) => void;

  // Feed
  feedRecords: FeedRecord[];
  addFeedRecord: (r: FeedRecord) => void;

  // Feed Dispense
  feedDispenseRecords: FeedDispenseRecord[];
  addFeedDispenseRecord: (r: FeedDispenseRecord) => void;

  // Vaccinations
  vaccinationRecords: VaccinationRecord[];
  addVaccinationRecord: (r: VaccinationRecord) => void;
  updateVaccinationRecord: (id: string, updates: Partial<VaccinationRecord>) => void;

  // Egg Collections
  eggCollections: EggCollection[];
  addEggCollection: (e: EggCollection) => void;

  // Customers
  customers: Customer[];
  addCustomer: (c: Customer) => void;
  updateCustomer: (id: string, updates: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;

  // Sales
  sales: Sale[];
  addSale: (s: Sale) => void;
  deleteSale: (id: string) => void;
  requestSaleDeletion: (id: string, reason: string, requestedBy: string) => void;
  approveSaleDeletion: (id: string) => void;
  rejectSaleDeletion: (id: string) => void;

  // Expenses
  expenses: Expense[];
  addExpense: (e: Expense) => void;
  deleteExpense: (id: string) => void;

  // Budgets
  budgets: Budget[];
  addBudget: (b: Budget) => void;
  updateBudget: (id: string, updates: Partial<Budget>) => void;
  deleteBudget: (id: string) => void;

  // Cages
  cages: Cage[];
  addCage: (c: Cage) => void;
  updateCage: (id: string, updates: Partial<Cage>) => void;
  deleteCage: (id: string) => void;

  // Feed Inventory
  feedInventory: FeedInventory[];
  updateFeedInventory: (feedType: string, delta: number) => void;
  setReorderLevel: (feedType: string, reorderLevelKg: number) => void;

  // Alerts
  alerts: Alert[];
  addAlert: (a: Alert) => void;
  markAlertRead: (id: string) => void;
  clearAllAlerts: () => void;

  // Init & export
  initialize: () => Promise<void>;
  exportData: () => string;
}

// ─── Helper: optimistic update with API sync ──────────────────────────────────

function withApi<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
  onError?: (get: () => FarmStore) => void,
) {
  const opts: RequestInit = { method };
  if (body !== undefined) opts.body = JSON.stringify(body);
  api(url, opts).catch((err: Error) => {
    toast.error(err.message ?? 'Action failed — data may not have saved');
    if (onError) {
      // trigger rollback via the store; caller supplies the rollback function
      onError(useFarmStore.getState as unknown as () => FarmStore);
    }
  });
}

// ─── Default stages (fallback before API loads) ───────────────────────────────

const DEFAULT_STAGES: FlockStageConfig[] = [
  { id: 'brooder',  name: 'Brooder',  displayOrder: 0, role: null,       pricePerBird: 150 },
  { id: 'grower',   name: 'Grower',   displayOrder: 1, role: null,       pricePerBird: 350 },
  { id: 'layer',    name: 'Layer',    displayOrder: 2, role: null,       pricePerBird: 600 },
  { id: 'disposal', name: 'Disposal', displayOrder: 3, role: 'disposed', pricePerBird: 0   },
  { id: 'sold',     name: 'Sold',     displayOrder: 4, role: 'sold',     pricePerBird: 0   },
];

// ─── Store ────────────────────────────────────────────────────────────────────

export const useFarmStore = create<FarmStore>()((set, get) => ({
  initialized: false,
  loading: false,

  // ── Session / Auth ──────────────────────────────────────────────────────────
  session: null,
  employees: [],

  setSession: (s) => set({ session: s }),

  login: async (pin, type, entityId) => {
    try {
      const data = await api<{ session: { userType: string; userId?: string; userName?: string } }>(
        '/api/auth/login',
        { method: 'POST', body: JSON.stringify({ pin, type, entityId }) },
      );
      const s = data.session;
      const session: UserSession = {
        type: s.userType as UserSession['type'],
        employeeId: s.userType === 'employee' ? s.userId : undefined,
        employeeName: s.userType === 'employee' ? s.userName : undefined,
        customerId: s.userType === 'customer' ? s.userId : undefined,
        customerName: s.userType === 'customer' ? s.userName : undefined,
        loginAt: new Date().toISOString(),
      };
      set({ session });
      await get().initialize();
      return true;
    } catch {
      return false;
    }
  },

  logout: async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    set({
      session: null, initialized: false,
      flocks: [], mortalityRecords: [], feedRecords: [], feedDispenseRecords: [],
      vaccinationRecords: [], eggCollections: [], customers: [], sales: [],
      expenses: [], budgets: [], cages: [], alerts: [], employees: [],
      employeeSalaries: [], orderRequests: [], birdStageSales: [],
      customerPortalUsers: [], flockStages: DEFAULT_STAGES,
    });
  },

  addEmployee: async (name, pin) => {
    const id = generateId();
    try {
      const row = await api<Employee>('/api/employees', {
        method: 'POST',
        body: JSON.stringify({ id, name, pin }),
      });
      set((s) => ({ employees: [...s.employees, row] }));
      return row;
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'Failed to add employee');
      return null;
    }
  },

  updateEmployee: async (id, updates) => {
    set((s) => ({ employees: s.employees.map(e => e.id === id ? { ...e, ...updates } : e) }));
    withApi('PUT', `/api/employees/${id}`, updates);
  },

  removeEmployee: async (id) => {
    set((s) => ({ employees: s.employees.filter(e => e.id !== id) }));
    withApi('DELETE', `/api/employees/${id}`);
  },

  // ── Pricing ─────────────────────────────────────────────────────────────────
  pricePerEgg: 18,
  pricePerTray: 450,
  pricePerChick: 120,

  setPricing: (p) => {
    set((s) => ({ ...s, ...p }));
    withApi('PUT', '/api/settings', p);
  },

  // ── Flock Stages ────────────────────────────────────────────────────────────
  flockStages: DEFAULT_STAGES,

  addFlockStage: (s) => {
    set((state) => ({ flockStages: [...state.flockStages, s].sort((a, b) => a.displayOrder - b.displayOrder) }));
    withApi('POST', '/api/flock-stages', s);
  },
  updateFlockStage: (id, updates) => {
    set((state) => ({
      flockStages: state.flockStages
        .map(s => s.id === id ? { ...s, ...updates } : s)
        .sort((a, b) => a.displayOrder - b.displayOrder),
    }));
    withApi('PUT', `/api/flock-stages/${id}`, updates);
  },
  deleteFlockStage: (id) => {
    set((state) => ({ flockStages: state.flockStages.filter(s => s.id !== id) }));
    withApi('DELETE', `/api/flock-stages/${id}`);
  },

  // ── Bird Stage Sales ────────────────────────────────────────────────────────
  birdStageSales: [],
  addBirdStageSale: (s) => {
    set((state) => {
      const flock = state.flocks.find(f => f.id === s.flockId);
      const updatedFlocks = flock
        ? state.flocks.map(f => f.id === s.flockId ? { ...f, currentCount: Math.max(0, f.currentCount - s.quantity) } : f)
        : state.flocks;
      return { birdStageSales: [...state.birdStageSales, s], flocks: updatedFlocks };
    });
    withApi('POST', '/api/bird-stage-sales', s);
  },
  deleteBirdStageSale: (id) => {
    const sale = get().birdStageSales.find(x => x.id === id);
    set((s) => {
      const newFlocks = sale
        ? s.flocks.map(f => f.id === sale.flockId ? { ...f, currentCount: f.currentCount + sale.quantity } : f)
        : s.flocks;
      return { birdStageSales: s.birdStageSales.filter(x => x.id !== id), flocks: newFlocks };
    });
    withApi('DELETE', `/api/bird-stage-sales/${id}`);
  },

  // ── Customer Portal Users ───────────────────────────────────────────────────
  customerPortalUsers: [],
  addCustomerPortalUser: (u) => {
    set((s) => ({ customerPortalUsers: [...s.customerPortalUsers, u] }));
    withApi('POST', '/api/customer-portal-users', u);
  },
  updateCustomerPortalUser: (id, updates) => {
    set((s) => ({ customerPortalUsers: s.customerPortalUsers.map(u => u.id === id ? { ...u, ...updates } : u) }));
    withApi('PUT', `/api/customer-portal-users/${id}`, updates);
  },
  removeCustomerPortalUser: (id) => {
    set((s) => ({ customerPortalUsers: s.customerPortalUsers.filter(u => u.id !== id) }));
    withApi('DELETE', `/api/customer-portal-users/${id}`);
  },

  // ── Employee Salaries ───────────────────────────────────────────────────────
  employeeSalaries: [],
  addEmployeeSalary: (s) => {
    set((state) => ({ employeeSalaries: [...state.employeeSalaries, s] }));
    withApi('POST', '/api/employee-salaries', s);
  },
  updateEmployeeSalary: (id, updates) => {
    set((s) => ({ employeeSalaries: s.employeeSalaries.map(x => x.id === id ? { ...x, ...updates, updatedAt: new Date().toISOString() } : x) }));
    withApi('PUT', `/api/employee-salaries/${id}`, updates);
  },
  deleteEmployeeSalary: (id) => {
    set((s) => ({ employeeSalaries: s.employeeSalaries.filter(x => x.id !== id) }));
    withApi('DELETE', `/api/employee-salaries/${id}`);
  },
  triggerSalaryExpenses: () => {
    const today = new Date().getDate();
    const state = get();
    const month = new Date().toISOString().slice(0, 7);
    state.employeeSalaries.forEach(sal => {
      if (sal.payDayOfMonth === today) {
        const alreadyPaid = state.expenses.some(e =>
          e.category === 'labour' && e.description.includes(sal.employeeName) && e.date.startsWith(month)
        );
        if (!alreadyPaid) {
          const exp: Expense = {
            id: `sal-${sal.id}-${month}`,
            category: 'labour',
            description: `Salary – ${sal.employeeName}`,
            amount: sal.amount,
            date: new Date().toISOString().split('T')[0],
            createdAt: new Date().toISOString(),
          };
          set((st) => ({ expenses: [...st.expenses, exp] }));
          withApi('POST', '/api/expenses', exp);
        }
      }
    });
  },

  // ── Order Requests ──────────────────────────────────────────────────────────
  orderRequests: [],
  addOrderRequest: (r) => {
    set((s) => ({ orderRequests: [...s.orderRequests, r] }));
    withApi('POST', '/api/order-requests', r);
  },
  updateOrderRequest: (id, updates) => {
    set((s) => ({ orderRequests: s.orderRequests.map(r => r.id === id ? { ...r, ...updates, updatedAt: new Date().toISOString() } : r) }));
    withApi('PUT', `/api/order-requests/${id}`, updates);
  },
  deleteOrderRequest: (id) => {
    set((s) => ({ orderRequests: s.orderRequests.filter(r => r.id !== id) }));
    withApi('DELETE', `/api/order-requests/${id}`);
  },

  // ── Flocks ──────────────────────────────────────────────────────────────────
  flocks: [],
  addFlock: (f) => {
    set((s) => ({ flocks: [...s.flocks, f] }));
    withApi('POST', '/api/flocks', f);
  },
  updateFlock: (id, updates) => {
    set((s) => ({ flocks: s.flocks.map(f => f.id === id ? { ...f, ...updates } : f) }));
    withApi('PUT', `/api/flocks/${id}`, updates);
  },
  deleteFlock: (id) => {
    set((s) => ({ flocks: s.flocks.filter(f => f.id !== id) }));
    withApi('DELETE', `/api/flocks/${id}`);
  },

  // ── Mortality ───────────────────────────────────────────────────────────────
  mortalityRecords: [],
  addMortalityRecord: (r) => {
    set((state) => {
      const flock = state.flocks.find(f => f.id === r.flockId);
      const newFlocks = flock
        ? state.flocks.map(f => f.id === r.flockId ? { ...f, currentCount: Math.max(0, f.currentCount - r.count) } : f)
        : state.flocks;
      return { mortalityRecords: [...state.mortalityRecords, r], flocks: newFlocks };
    });
    withApi('POST', '/api/mortality', r);
  },

  // ── Feed Records ────────────────────────────────────────────────────────────
  feedRecords: [],
  addFeedRecord: (r) => {
    set((state) => {
      const inv = state.feedInventory.map(fi =>
        fi.feedType === r.feedType
          ? { ...fi, currentStockKg: Math.max(0, fi.currentStockKg - r.quantityKg), lastUpdated: new Date().toISOString() }
          : fi
      );
      return { feedRecords: [...state.feedRecords, r], feedInventory: inv };
    });
    withApi('POST', '/api/feed-records', r);
  },

  // ── Feed Dispense ───────────────────────────────────────────────────────────
  feedDispenseRecords: [],
  addFeedDispenseRecord: (r) => {
    set((s) => ({
      feedDispenseRecords: [...s.feedDispenseRecords, r],
      feedInventory: s.feedInventory.map(fi =>
        fi.feedType === r.feedType
          ? { ...fi, currentStockKg: Math.max(0, fi.currentStockKg - r.quantityKg), lastUpdated: new Date().toISOString() }
          : fi
      ),
    }));
    withApi('POST', '/api/feed-dispense', r);
  },

  // ── Vaccinations ────────────────────────────────────────────────────────────
  vaccinationRecords: [],
  addVaccinationRecord: (r) => {
    set((s) => ({ vaccinationRecords: [...s.vaccinationRecords, r] }));
    withApi('POST', '/api/vaccinations', r);
  },
  updateVaccinationRecord: (id, updates) => {
    set((s) => ({ vaccinationRecords: s.vaccinationRecords.map(v => v.id === id ? { ...v, ...updates } : v) }));
    withApi('PUT', `/api/vaccinations/${id}`, updates);
  },

  // ── Egg Collections ─────────────────────────────────────────────────────────
  eggCollections: [],
  addEggCollection: (e) => {
    set((s) => ({ eggCollections: [...s.eggCollections, e] }));
    withApi('POST', '/api/egg-collections', e);
  },

  // ── Customers ───────────────────────────────────────────────────────────────
  customers: [],
  addCustomer: (c) => {
    set((s) => ({ customers: [...s.customers, c] }));
    withApi('POST', '/api/customers', c);
  },
  updateCustomer: (id, updates) => {
    set((s) => ({ customers: s.customers.map(c => c.id === id ? { ...c, ...updates } : c) }));
    withApi('PUT', `/api/customers/${id}`, updates);
  },
  deleteCustomer: (id) => {
    set((s) => ({ customers: s.customers.filter(c => c.id !== id) }));
    withApi('DELETE', `/api/customers/${id}`);
  },

  // ── Sales ───────────────────────────────────────────────────────────────────
  sales: [],
  addSale: (s) => {
    set((state) => {
      const newFlocks = s.product === 'birds' && s.flockId
        ? state.flocks.map(f => f.id === s.flockId ? { ...f, currentCount: Math.max(0, f.currentCount - s.quantity) } : f)
        : state.flocks;
      return { sales: [...state.sales, s], flocks: newFlocks };
    });
    withApi('POST', '/api/sales', s);
  },
  deleteSale: (id) => {
    const sale = get().sales.find(x => x.id === id);
    set((s) => {
      const newFlocks = sale?.product === 'birds' && sale.flockId
        ? s.flocks.map(f => f.id === sale.flockId ? { ...f, currentCount: f.currentCount + sale.quantity } : f)
        : s.flocks;
      return { sales: s.sales.filter(x => x.id !== id), flocks: newFlocks };
    });
    withApi('DELETE', `/api/sales/${id}`);
  },
  requestSaleDeletion: (id, reason, requestedBy) => {
    const updates = {
      deletionRequested: true,
      deletionReason: reason,
      deletionRequestedBy: requestedBy,
      deletionRequestedAt: new Date().toISOString(),
    };
    set((s) => ({ sales: s.sales.map(x => x.id === id ? { ...x, ...updates } : x) }));
    withApi('PUT', `/api/sales/${id}`, updates);
  },
  approveSaleDeletion: (id) => {
    const sale = get().sales.find(x => x.id === id);
    set((s) => {
      const newFlocks = sale?.product === 'birds' && sale.flockId
        ? s.flocks.map(f => f.id === sale.flockId ? { ...f, currentCount: f.currentCount + sale.quantity } : f)
        : s.flocks;
      return { sales: s.sales.filter(x => x.id !== id), flocks: newFlocks };
    });
    withApi('DELETE', `/api/sales/${id}`);
  },
  rejectSaleDeletion: (id) => {
    const updates = {
      deletionRequested: false,
      deletionReason: undefined,
      deletionRequestedBy: undefined,
      deletionRequestedAt: undefined,
    };
    set((s) => ({ sales: s.sales.map(x => x.id === id ? { ...x, ...updates } : x) }));
    withApi('PUT', `/api/sales/${id}`, updates);
  },

  // ── Expenses ────────────────────────────────────────────────────────────────
  expenses: [],
  addExpense: (e) => {
    set((s) => ({ expenses: [...s.expenses, e] }));
    withApi('POST', '/api/expenses', e);
  },
  deleteExpense: (id) => {
    set((s) => ({ expenses: s.expenses.filter(e => e.id !== id) }));
    withApi('DELETE', `/api/expenses/${id}`);
  },

  // ── Budgets ─────────────────────────────────────────────────────────────────
  budgets: [],
  addBudget: (b) => {
    set((s) => ({ budgets: [...s.budgets, b] }));
    withApi('POST', '/api/budgets', b);
  },
  updateBudget: (id, updates) => {
    set((s) => ({ budgets: s.budgets.map(b => b.id === id ? { ...b, ...updates } : b) }));
    withApi('PUT', `/api/budgets/${id}`, updates);
  },
  deleteBudget: (id) => {
    set((s) => ({ budgets: s.budgets.filter(b => b.id !== id) }));
    withApi('DELETE', `/api/budgets/${id}`);
  },

  // ── Cages ───────────────────────────────────────────────────────────────────
  cages: [],
  addCage: (c) => {
    set((s) => ({ cages: [...s.cages, c] }));
    withApi('POST', '/api/cages', c);
  },
  updateCage: (id, updates) => {
    set((s) => ({ cages: s.cages.map(c => c.id === id ? { ...c, ...updates } : c) }));
    withApi('PUT', `/api/cages/${id}`, updates);
  },
  deleteCage: (id) => {
    set((s) => ({ cages: s.cages.filter(c => c.id !== id) }));
    withApi('DELETE', `/api/cages/${id}`);
  },

  // ── Feed Inventory ──────────────────────────────────────────────────────────
  feedInventory: [
    { id: 'fi-1', feedType: 'starter', currentStockKg: 200, reorderLevelKg: 50, lastUpdated: new Date().toISOString() },
    { id: 'fi-2', feedType: 'grower', currentStockKg: 300, reorderLevelKg: 75, lastUpdated: new Date().toISOString() },
    { id: 'fi-3', feedType: 'layer', currentStockKg: 400, reorderLevelKg: 100, lastUpdated: new Date().toISOString() },
    { id: 'fi-4', feedType: 'finisher', currentStockKg: 150, reorderLevelKg: 50, lastUpdated: new Date().toISOString() },
  ],
  updateFeedInventory: (feedType, delta) => {
    set((state) => ({
      feedInventory: state.feedInventory.map(fi =>
        fi.feedType === feedType
          ? { ...fi, currentStockKg: Math.max(0, fi.currentStockKg + delta), lastUpdated: new Date().toISOString() }
          : fi
      ),
    }));
    const item = get().feedInventory.find(fi => fi.feedType === feedType);
    if (item) withApi('PUT', '/api/feed-inventory', { feedType, currentStockKg: item.currentStockKg });
  },
  setReorderLevel: (feedType, reorderLevelKg) => {
    set((state) => ({
      feedInventory: state.feedInventory.map(fi =>
        fi.feedType === feedType
          ? { ...fi, reorderLevelKg, lastUpdated: new Date().toISOString() }
          : fi
      ),
    }));
    withApi('PUT', '/api/feed-inventory', { feedType, reorderLevelKg });
  },

  // ── Alerts ──────────────────────────────────────────────────────────────────
  alerts: [],
  addAlert: (a) => {
    set((s) => ({ alerts: [...s.alerts, a] }));
    withApi('POST', '/api/alerts', a);
  },
  markAlertRead: (id) => {
    set((s) => ({ alerts: s.alerts.map(a => a.id === id ? { ...a, read: true } : a) }));
    withApi('PUT', `/api/alerts/${id}`);
  },
  clearAllAlerts: () => {
    set({ alerts: [] });
    withApi('DELETE', '/api/alerts');
  },

  // ── Initialize (load all data from API) ────────────────────────────────────
  initialize: async () => {
    set({ loading: true });
    try {
      const [
        flocksRes, mortalityRes, feedRes, feedDispRes,
        vaccsRes, eggsRes, customersRes, cpuRes,
        salesRes, expensesRes, budgetsRes, cagesRes,
        feedInvRes, alertsRes, empRes, salariesRes,
        orderReqRes, birdSalesRes, settingsRes, stagesRes,
      ] = await Promise.allSettled([
        api<Flock[]>('/api/flocks'),
        api<MortalityRecord[]>('/api/mortality'),
        api<FeedRecord[]>('/api/feed-records'),
        api<FeedDispenseRecord[]>('/api/feed-dispense'),
        api<VaccinationRecord[]>('/api/vaccinations'),
        api<EggCollection[]>('/api/egg-collections'),
        api<Customer[]>('/api/customers'),
        api<CustomerPortalUser[]>('/api/customer-portal-users'),
        api<Sale[]>('/api/sales'),
        api<Expense[]>('/api/expenses'),
        api<Budget[]>('/api/budgets'),
        api<Cage[]>('/api/cages'),
        api<FeedInventory[]>('/api/feed-inventory'),
        api<Alert[]>('/api/alerts'),
        api<Employee[]>('/api/employees'),
        api<EmployeeSalary[]>('/api/employee-salaries'),
        api<OrderRequest[]>('/api/order-requests'),
        api<BirdStageSale[]>('/api/bird-stage-sales'),
        api<Record<string, string>>('/api/settings'),
        api<FlockStageConfig[]>('/api/flock-stages'),
      ]);

      const val = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
        r.status === 'fulfilled' ? r.value : fallback;

      const cfg = val(settingsRes, {} as Record<string, string>);
      const inv = val(feedInvRes, get().feedInventory);

      const n = (v: unknown) => Number(v ?? 0);

      set({
        flocks: val(flocksRes, []).map(f => ({
          ...f,
          initialCount: n(f.initialCount),
          currentCount: n(f.currentCount),
          purchaseCostPerChick: n(f.purchaseCostPerChick),
          initialWeight: n(f.initialWeight),
        })),
        mortalityRecords: val(mortalityRes, []).map(r => ({ ...r, count: n(r.count) })),
        feedRecords: val(feedRes, []).map(r => ({
          ...r,
          quantityKg: n(r.quantityKg),
          costPerKg: n(r.costPerKg),
          totalCost: n(r.totalCost),
        })),
        feedDispenseRecords: val(feedDispRes, []).map(r => ({ ...r, quantityKg: n(r.quantityKg) })),
        vaccinationRecords: val(vaccsRes, []).map(r => ({ ...r, cost: n(r.cost) })),
        eggCollections: val(eggsRes, []).map(r => ({
          ...r,
          count: n(r.count),
          broken: n(r.broken),
          sellable: n(r.sellable),
        })),
        customers: val(customersRes, []),
        customerPortalUsers: val(cpuRes, []),
        sales: val(salesRes, []).map(s => ({
          ...s,
          quantity: n(s.quantity),
          pricePerUnit: n(s.pricePerUnit),
          totalAmount: n(s.totalAmount),
        })),
        expenses: val(expensesRes, []).map(e => ({ ...e, amount: n(e.amount) })),
        budgets: val(budgetsRes, []).map(b => ({ ...b, amount: n(b.amount) })),
        cages: val(cagesRes, []).map(c => ({ ...c, capacity: n(c.capacity) })),
        feedInventory: (inv.length ? inv : get().feedInventory).map(i => ({
          ...i,
          currentStockKg: n(i.currentStockKg),
          reorderLevelKg: n(i.reorderLevelKg),
        })),
        alerts: val(alertsRes, []),
        employees: val(empRes, []),
        employeeSalaries: val(salariesRes, []).map(s => ({
          ...s,
          amount: n(s.amount),
          payDayOfMonth: n(s.payDayOfMonth),
        })),
        orderRequests: val(orderReqRes, []).map(o => ({
          ...o,
          quantity: n(o.quantity),
          pricePerUnit: n(o.pricePerUnit),
          totalAmount: n(o.totalAmount),
        })),
        birdStageSales: val(birdSalesRes, []).map(s => ({
          ...s,
          quantity: n(s.quantity),
          pricePerBird: n(s.pricePerBird),
          breakEvenPrice: n(s.breakEvenPrice),
          totalAmount: n(s.totalAmount),
        })),
        pricePerEgg: cfg.pricePerEgg ? Number(cfg.pricePerEgg) : 18,
        pricePerTray: cfg.pricePerTray ? Number(cfg.pricePerTray) : 450,
        pricePerChick: cfg.pricePerChick ? Number(cfg.pricePerChick) : 120,
        flockStages: val(stagesRes, DEFAULT_STAGES).map(s => ({
          ...s,
          displayOrder: Number(s.displayOrder),
          pricePerBird: Number(s.pricePerBird),
        })),
        initialized: true,
        loading: false,
      });

      // Auto-generate any salary expenses due today (idempotent — dedups per month)
      get().triggerSalaryExpenses();
    } catch {
      set({ initialized: true, loading: false });
    }
  },

  exportData: () => {
    const state = get();
    return JSON.stringify({
      flocks: state.flocks,
      mortalityRecords: state.mortalityRecords,
      feedRecords: state.feedRecords,
      feedDispenseRecords: state.feedDispenseRecords,
      vaccinationRecords: state.vaccinationRecords,
      eggCollections: state.eggCollections,
      customers: state.customers,
      sales: state.sales,
      birdStageSales: state.birdStageSales,
      expenses: state.expenses,
      budgets: state.budgets,
      cages: state.cages,
      feedInventory: state.feedInventory,
      employeeSalaries: state.employeeSalaries,
      orderRequests: state.orderRequests,
    }, null, 2);
  },
}));

// ─── Shared utilities ─────────────────────────────────────────────────────────

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Legacy PIN hash kept for any remaining frontend comparisons (auth now server-side) */
export function hashPin(pin: string): string {
  let hash = 0;
  for (let i = 0; i < pin.length; i++) {
    const char = pin.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
