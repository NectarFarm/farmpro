// Simulated Django REST API — never calls Supabase, never holds secrets
import {
  mockUsers, mockUnits, mockBatches, mockItems, mockLots,
  mockTasks, mockAlerts, mockEmployees, mockWorkerProfiles,
  mockCostSummaries, mockSales, mockPurchases, mockHealthRecords,
} from './data';
import type { User, WorkerProfile } from '@/lib/types';

const delay = (ms = 300) => new Promise(r => setTimeout(r, ms));

// ─── Auth ─────────────────────────────────────────────────────────────────────
export async function loginOwner(email: string, _password: string) {
  await delay(600);
  const user = mockUsers.find(u => u.email === email && (u.role === 'owner' || u.role === 'manager' || u.role === 'auditor' || u.role === 'vet'));
  if (!user) throw new Error('Invalid credentials');
  return { access: 'mock_jwt_access_' + user.id, refresh: 'mock_jwt_refresh_' + user.id, user };
}

export async function loginWorker(phone: string, _pin: string) {
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
  getUsers: async () => { await delay(); return mockUsers; },

  getCostSummary: async (batchId: string) => { await delay(200); return mockCostSummaries.find(c => c.batchId === batchId) ?? null; },
  getSales: async () => { await delay(); return mockSales; },
  getPurchases: async () => { await delay(); return mockPurchases; },
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
};

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
  return {
    activeBatches: 5,
    totalBirds: 1419,
    mortalityPct: 3.2,
    avgFCR: 2.1,
    grossMargin: 110000,
    pendingAlerts: 4,
    taskCompletionPct: 80,
    revenueThisMonth: 68750,
  };
}

export function getProductionChartData(): { data: Record<string, string | number>[]; products: string[] } {
  return {
    products: ['Eggs'],
    data: [
      { date:'Jun 17', Eggs:1820, revenue:10010 },
      { date:'Jun 18', Eggs:1790, revenue:9845 },
      { date:'Jun 19', Eggs:1850, revenue:10175 },
      { date:'Jun 20', Eggs:1810, revenue:9955 },
      { date:'Jun 21', Eggs:1830, revenue:10065 },
      { date:'Jun 22', Eggs:1800, revenue:9900 },
      { date:'Jun 23', Eggs:1795, revenue:9873 },
    ],
  };
}
