// Simulated Django REST API — never calls Supabase, never holds secrets
import {
  mockUsers, mockUnits, mockBatches, mockItems, mockLots,
  mockTasks, mockAlerts, mockEmployees, mockWorkerProfiles,
  mockCostSummaries, mockHealthRecords, mockProducts,
} from './data';
import type { WorkerProfile, Sale, Purchase, InventoryLot, InventoryItem, ItemCategory, Product } from '@/lib/types';

// Mutable runtime copies so writes reflect immediately in reads.
const initialCostSummaries = mockCostSummaries.map((c) => ({ ...c }));
const initialItems = mockItems.map((i) => ({ ...i }));
const initialLots = mockLots.map((l) => ({ ...l }));
const initialWorkerProfiles = mockWorkerProfiles.map((p) => ({ ...p }));
const initialProducts = mockProducts.map((p) => ({ ...p }));
const liveSales: Sale[] = [
  { id:'s1', tenantId:'tenant_001', batchId:'b1', unitId:'unit1', productType:'Eggs', quantity:30, unitPrice:550, totalAmount:16500, buyer:'Market Stall - Mama Njeri', paymentMethod:'cash', status:'PAID', withdrawalCheck:'cleared', createdAt:'2026-06-20T10:00:00Z' },
  { id:'s2', tenantId:'tenant_001', batchId:'b5', unitId:'unit6', productType:'Broilers (live)', quantity:50, weightKg:110, unitPrice:400, totalAmount:44000, buyer:'Hotel Sarova', paymentMethod:'mpesa', status:'DELIVERED', withdrawalCheck:'cleared', createdAt:'2026-06-18T08:00:00Z' },
  { id:'s3', tenantId:'tenant_001', batchId:'b1', unitId:'unit1', productType:'Eggs', quantity:15, unitPrice:550, totalAmount:8250, buyer:'Retail Direct', paymentMethod:'mpesa', status:'CREDIT', withdrawalCheck:'cleared', createdAt:'2026-06-22T11:00:00Z' },
];

const livePurchases: Purchase[] = [
  { id:'p1', tenantId:'tenant_001', itemId:'i1', lotId:'l1', supplier:'Chic Feeds Ltd', quantity:50, unitCost:52, totalCost:2600, createdAt:'2026-06-10T08:00:00Z' },
];

function isMockHeadSale(productType: string): boolean {
  return mockProducts.some(
    (p) => p.isAnimalProduct && p.name.toLowerCase() === productType.toLowerCase(),
  );
}

const delay = (ms = 300) => new Promise(r => setTimeout(r, ms));

// ─── Auth ─────────────────────────────────────────────────────────────────────
export async function loginOwner(email: string, _password: string) {
  void _password;
  await delay(600);
  const user = mockUsers.find(u => u.email === email && (u.role === 'owner' || u.role === 'manager' || u.role === 'auditor' || u.role === 'vet'));
  if (!user) throw new Error('Invalid credentials');
  return { access: 'mock_jwt_access_' + user.id, refresh: 'mock_jwt_refresh_' + user.id, user };
}

export async function loginWorker(phone: string, _pin: string) {
  void _pin;
  await delay(400);
  const user = mockUsers.find(u => u.phone === phone && u.role === 'worker');
  if (!user) throw new Error('Invalid phone or PIN');
  return { access: 'mock_jwt_access_' + user.id, refresh: 'mock_jwt_refresh_' + user.id, user };
}

// ─── Worker profile ───────────────────────────────────────────────────────────
export async function getWorkerProfile(profileId: string): Promise<WorkerProfile> {
  await delay(200);
  const p = mockWorkerProfiles.find(p => p.id === profileId);
  if (!p) throw new Error('Profile not found');
  return p;
}

// ─── Farm data ────────────────────────────────────────────────────────────────
export const api = {
  getUnits: async () => { await delay(); return mockUnits; },
  getBatches: async () => { await delay(); return mockBatches; },
  getBatch: async (id: string) => { await delay(150); return mockBatches.find(b => b.id === id) ?? null; },
  getItems: async () => { await delay(); return mockItems; },
  getLots: async () => { await delay(); return mockLots; },
  getLotsByItem: async (itemId: string) => { await delay(150); return mockLots.filter(l => l.itemId === itemId); },

  getTasks: async (userId: string) => { await delay(); return mockTasks.filter(t => t.assignedTo === userId); },
  getAlerts: async () => { await delay(); return mockAlerts; },

  getEmployees: async () => { await delay(); return mockEmployees; },
  getWorkerProfiles: async () => { await delay(); return mockWorkerProfiles; },
  createWorkerProfile: async (data: Record<string, unknown>) => {
    await delay(200);
    const id = 'wp_' + Math.random().toString(36).slice(2, 10);
    mockWorkerProfiles.push({
      id, tenantId: 'tenant_001', name: String(data.name ?? 'New Profile'),
      fields: [
        { fieldKey: 'feed_unit_cost', label: 'Feed unit cost (KES)', permission: 'hidden' },
        { fieldKey: 'feed_quantity', label: 'Feed quantity (kg)', permission: 'editable', required: true },
        { fieldKey: 'egg_sale_price', label: 'Egg sale price', permission: 'hidden' },
        { fieldKey: 'mortality_cause', label: 'Mortality cause', permission: 'editable' },
        { fieldKey: 'batch_profit_loss', label: 'Batch profit/loss', permission: 'hidden' },
        { fieldKey: 'water_level', label: 'Water level', permission: 'editable', required: true },
        { fieldKey: 'eggs_collected', label: 'Eggs collected', permission: 'editable', required: true },
        { fieldKey: 'abnormal', label: 'Abnormal observation', permission: 'editable', required: true },
      ],
      modules: ['morning_round', 'mortality', 'feeding', 'health', 'collect'],
      mortalityPhotoThreshold: 1, alertThresholds: {},
    });
    return { id };
  },
  updateWorkerProfile: async (id: string, data: Record<string, unknown>) => {
    await delay(200);
    const profile = mockWorkerProfiles.find((p) => p.id === id);
    if (profile) {
      if (Array.isArray(data.fields)) profile.fields = data.fields as WorkerProfile['fields'];
      if (typeof data.mortalityPhotoThreshold === 'number') profile.mortalityPhotoThreshold = data.mortalityPhotoThreshold;
      if (typeof data.name === 'string') profile.name = data.name;
    }
    return { id };
  },
  getUsers: async () => { await delay(); return mockUsers; },

  getCostSummary: async (batchId: string) => { await delay(200); return mockCostSummaries.find(c => c.batchId === batchId) ?? null; },
  getSales: async () => { await delay(); return liveSales; },
  recordSale: async (data: Record<string, unknown>) => {
    await delay(300);
    const qty = Number(data.quantity) || 0;
    const price = Number(data.unitPrice) || 0;
    // If productId is provided, resolve to the mock product for name + isAnimalProduct.
    const productId = String(data.productId ?? '');
    const product = productId ? mockProducts.find((p) => p.id === productId) : undefined;
    const productType = product ? product.name : String(data.productType ?? 'produce');
    const isHead = product ? product.isAnimalProduct ?? false : isMockHeadSale(productType);
    const sale: Sale = {
      id: 's_' + Math.random().toString(36).slice(2, 10),
      tenantId: 'tenant_001',
      batchId: String(data.batchId ?? ''),
      unitId: String(data.unitId ?? ''),
      productType,
      quantity: qty,
      unitPrice: price,
      totalAmount: qty * price,
      buyer: String(data.buyer ?? ''),
      paymentMethod: 'cash',
      status: 'PAID',
      withdrawalCheck: 'cleared',
      createdAt: new Date().toISOString(),
    };
    liveSales.push(sale);
    // Keep the static cost summary in sync so break-even cards update immediately.
    const cs = mockCostSummaries.find((c) => c.batchId === sale.batchId);
    if (cs) {
      cs.totalRevenue += sale.totalAmount;
      cs.grossMargin = Math.round((cs.totalRevenue - cs.totalCost) * 100) / 100;
      const prevQty = cs.remainingQty ?? 0;
      if (isHead) {
        cs.remainingQty = Math.max(0, prevQty - sale.quantity);
      }
      const remaining = cs.remainingQty ?? 0;
      const needed = cs.totalCost - cs.totalRevenue;
      cs.breakEvenPricePerRemaining = remaining > 0 && needed > 0
        ? Math.round((needed / remaining) * 100) / 100
        : 0;
    }
    // Decrement on-hand counts for head-count sales (birds physically left the farm).
    if (isHead) {
      const batch = mockBatches.find((b) => b.id === sale.batchId);
      if (batch) {
        batch.currentQty = Math.max(0, batch.currentQty - sale.quantity);
        if (cs) cs.currentQty = batch.currentQty;
      }
      const unit = mockUnits.find((u) => u.id === sale.unitId);
      if (unit && unit.currentQty != null) {
        unit.currentQty = Math.max(0, unit.currentQty - sale.quantity);
      }
    }
    return { id: sale.id, status: 'accepted' };
  },
  getPurchases: async () => { await delay(); return livePurchases; },
  recordPurchase: async (data: Record<string, unknown>) => {
    await delay(300);
    const isNew = String(data.itemId ?? '') === '__new';
    const itemId = isNew ? 'i_' + Math.random().toString(36).slice(2, 10) : String(data.itemId ?? '');
    const itemName = String(data.itemName ?? data.itemId ?? 'Stock');
    const unit = String(data.unit ?? 'kg');
    const category = String(data.category ?? 'FEED_FINISHED') as ItemCategory;
    const supplier = String(data.supplier ?? '');
    const qty = Number(data.quantity) || 0;
    const unitCost = Number(data.unitCost) || 0;
    const createdAt = new Date().toISOString();

    if (isNew) {
      const newItem: InventoryItem = { id: itemId, tenantId: 'tenant_001', name: itemName, category: category as ItemCategory, unit, lowStockThreshold: 10 };
      mockItems.push(newItem);
    }

    const lotId = 'l_' + Math.random().toString(36).slice(2, 10);
    const newLot: InventoryLot = {
      id: lotId, itemId, lotNo: 'PUR-' + new Date().toISOString().slice(0, 10), qtyOnHand: qty,
      unit, unitCost, receivedDate: createdAt,
    };
    mockLots.push(newLot);

    const purchase: Purchase = {
      id: 'p_' + Math.random().toString(36).slice(2, 10), tenantId: 'tenant_001',
      itemId, lotId, supplier, quantity: qty, unitCost, totalCost: qty * unitCost, createdAt,
    };
    livePurchases.push(purchase);
    return { id: purchase.id, status: 'accepted' };
  },
  getHealthRecords: async (batchId: string) => { await delay(150); return mockHealthRecords.filter(h => h.batchId === batchId); },

  // Write ops — simulate Django accepting the record
  submitRecord: async (type: string, payload: unknown) => {
    await delay(500);
    console.log('[Mock API] Submit', type, payload);
    return { id: 'srv_' + Math.random().toString(36).slice(2), status: 'accepted' };
  },
  syncBatch: async (records: unknown[]) => {
    await delay(800);
    console.log('[Mock API] Sync batch', records.length, 'records');
    return { accepted: records.length, conflicts: [] };
  },
  getProducts: async (batchId?: string) => {
    await delay(150);
    return batchId ? mockProducts.filter((p) => p.batchId === batchId) : mockProducts;
  },
  createProduct: async (data: Record<string, unknown>) => {
    await delay(200);
    const id = 'p_' + Math.random().toString(36).slice(2, 10);
    mockProducts.push({
      id, tenantId: 'tenant_001', batchId: String(data.batchId ?? ''),
      name: String(data.name ?? ''), baseUnit: String(data.baseUnit ?? 'unit'),
      collectFrequency: String(data.collectFrequency ?? 'per_cycle'),
      flow: String(data.flow ?? 'sale'),
      saleUnits: (data.saleUnits as Product['saleUnits']) ?? [],
      active: true,
      isAnimalProduct: Boolean(data.isAnimalProduct),
    });
    return { id };
  },
  updateProduct: async (id: string, data: Record<string, unknown>) => {
    await delay(200);
    const p = mockProducts.find((p) => p.id === id);
    if (p) {
      if (typeof data.name === 'string') p.name = data.name;
      if (typeof data.collectFrequency === 'string') p.collectFrequency = data.collectFrequency;
      if (Array.isArray(data.saleUnits)) p.saleUnits = data.saleUnits as Product['saleUnits'];
      if (typeof data.isAnimalProduct === 'boolean') p.isAnimalProduct = data.isAnimalProduct;
      if (typeof data.active === 'boolean') p.active = data.active;
    }
    return { id };
  },
};

// Reset function for test isolation — restores mutable arrays to initial state.
export function resetMockState(): void {
  mockCostSummaries.splice(0, mockCostSummaries.length, ...initialCostSummaries);
  mockItems.splice(0, mockItems.length, ...initialItems);
  mockLots.splice(0, mockLots.length, ...initialLots);
  mockWorkerProfiles.splice(0, mockWorkerProfiles.length, ...initialWorkerProfiles);
  mockProducts.splice(0, mockProducts.length, ...initialProducts);
  liveSales.splice(0, liveSales.length,
    { id:'s1', tenantId:'tenant_001', batchId:'b1', unitId:'unit1', productType:'Eggs', quantity:30, unitPrice:550, totalAmount:16500, buyer:'Market Stall - Mama Njeri', paymentMethod:'cash', status:'PAID', withdrawalCheck:'cleared', createdAt:'2026-06-20T10:00:00Z' },
    { id:'s2', tenantId:'tenant_001', batchId:'b5', unitId:'unit6', productType:'Broilers (live)', quantity:50, weightKg:110, unitPrice:400, totalAmount:44000, buyer:'Hotel Sarova', paymentMethod:'mpesa', status:'DELIVERED', withdrawalCheck:'cleared', createdAt:'2026-06-18T08:00:00Z' },
    { id:'s3', tenantId:'tenant_001', batchId:'b1', unitId:'unit1', productType:'Eggs', quantity:15, unitPrice:550, totalAmount:8250, buyer:'Retail Direct', paymentMethod:'mpesa', status:'CREDIT', withdrawalCheck:'cleared', createdAt:'2026-06-22T11:00:00Z' },
  );
  livePurchases.splice(0, livePurchases.length,
    { id:'p1', tenantId:'tenant_001', itemId:'i1', lotId:'l1', supplier:'Chic Feeds Ltd', quantity:50, unitCost:52, totalCost:2600, createdAt:'2026-06-10T08:00:00Z' },
  );
}

// Cumulative cost/revenue chart data for batch P&L
export function getCumulativeChartData(batchId: string) {
  if (batchId === 'b5') {
    return Array.from({ length: 42 }, (_, i) => ({
      day: i + 1,
      cost: Math.round(60000 + (315000 / 42) * (i + 1)),
      revenue: i < 30 ? 0 : Math.round(44000 + ((330000 - 44000) / 12) * (i - 29)),
    }));
  }
  return Array.from({ length: 30 }, (_, i) => ({
    day: i + 1,
    cost: Math.round(50000 + (420000 / 30) * (i + 1)),
    revenue: Math.round(10000 + (570000 / 30) * (i + 1)),
  }));
}

export function getDashboardKPIs() {
  const activeBatches = mockBatches.filter((b) => b.status === 'ACTIVE');
  const totalBirds = activeBatches.reduce((s, b) => s + b.currentQty, 0);
  const activeSummaries = mockCostSummaries.filter((cs) => activeBatches.some((b) => b.id === cs.batchId));
  const mortalityPct = activeSummaries.length > 0
    ? Math.round(activeSummaries.reduce((s, cs) => s + (cs.mortalityPct ?? 0), 0) / activeSummaries.length * 10) / 10
    : 0;
  const avgFCR = activeSummaries.length > 0
    ? Math.round(activeSummaries.reduce((s, cs) => s + (cs.fcr ?? 0), 0) / activeSummaries.length * 10) / 10
    : 0;
  const grossMargin = mockCostSummaries.reduce((s, cs) => s + cs.grossMargin, 0);
  const pendingAlerts = mockAlerts.filter((a) => !a.acknowledged).length;
  const taskCompletionPct = mockTasks.length > 0
    ? Math.round(mockTasks.filter((t) => t.status === 'DONE').length / mockTasks.length * 100)
    : 100;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const revenueThisMonth = liveSales
    .filter((s) => s.createdAt.startsWith(thisMonth))
    .reduce((s, sale) => s + sale.totalAmount, 0);
  return { activeBatches: activeBatches.length, totalBirds, mortalityPct, avgFCR, grossMargin, pendingAlerts, taskCompletionPct, revenueThisMonth };
}

export function getProductionChartData(): { data: Record<string, string | number>[]; products: string[] } {
  return { products: [], data: [] };
}
