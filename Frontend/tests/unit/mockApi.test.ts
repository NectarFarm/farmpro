import { describe, it, expect, vi, beforeEach } from 'vitest';

const { hoistedItems, hoistedLots, resetMockData } = vi.hoisted(() => {
  const mockItems: { id: string; name: string; category: string; unit: string; lowStockThreshold: number; tenantId: string }[] = [
    { id: 'i1', tenantId: 'tenant_001', name: 'Layer Mash', category: 'FEED_FINISHED', unit: 'kg', lowStockThreshold: 50 },
  ];
  const mockLots: { id: string; itemId: string; lotNo: string; qtyOnHand: number; unit: string; unitCost: number; receivedDate: string; tenantId: string }[] = [
    { id: 'l1', itemId: 'i1', lotNo: 'LM-001', qtyOnHand: 100, unit: 'kg', unitCost: 50, receivedDate: '2026-01-01', tenantId: 'tenant_001' },
  ];
  return {
    hoistedItems: mockItems,
    hoistedLots: mockLots,
    resetMockData: () => {
      mockItems.splice(0, mockItems.length,
        { id: 'i1', tenantId: 'tenant_001', name: 'Layer Mash', category: 'FEED_FINISHED', unit: 'kg', lowStockThreshold: 50 },
      );
      mockLots.splice(0, mockLots.length,
        { id: 'l1', itemId: 'i1', lotNo: 'LM-001', qtyOnHand: 100, unit: 'kg', unitCost: 50, receivedDate: '2026-01-01', tenantId: 'tenant_001' },
      );
    },
  };
});

vi.mock('@/lib/mock/data', () => ({
  TENANT_ID: 'tenant_001',
  mockUsers: [],
  mockUnits: [],
  mockBatches: [
    { id: 'b1', tenantId: 'tenant_001', name: 'Batch 1', currentQty: 95, initialQty: 100, species: 'layer', acquisitionCost: 50000, status: 'ACTIVE' },
  ],
  mockItems: hoistedItems,
  mockLots: hoistedLots,
  mockTasks: [],
  mockAlerts: [],
  mockEmployees: [],
  mockWorkerProfiles: [],
  mockCostSummaries: [],
  mockPurchases: [],
  mockHealthRecords: [],
  mockProducts: [],
}));

import { api, resetMockState } from '@/lib/mock/api';

beforeEach(() => {
  resetMockState();
  resetMockData();
});

describe('mock API', () => {
  describe('getSales', () => {
    it('returns initial sales', async () => {
      const sales = await api.getSales();
      expect(sales.length).toBe(3);
      expect(sales[0]).toHaveProperty('id');
      expect(sales[0]).toHaveProperty('totalAmount');
    });
  });

  describe('recordSale', () => {
    it('appends a new sale to the list', async () => {
      const result = await api.recordSale({
        batchId: 'b1', productType: 'Eggs', quantity: 10, unitPrice: 500, buyer: 'Test',
      });
      expect(result).toHaveProperty('id');
      expect(result.status).toBe('accepted');

      const sales = await api.getSales();
      const added = sales[sales.length - 1];
      expect(added.batchId).toBe('b1');
      expect(added.productType).toBe('Eggs');
      expect(added.quantity).toBe(10);
      expect(added.unitPrice).toBe(500);
      expect(added.totalAmount).toBe(5000);
      expect(added.buyer).toBe('Test');
      expect(added.createdAt).toBeTruthy();
    });

    it('handles zero quantity gracefully', async () => {
      await api.recordSale({
        batchId: 'b1', productType: 'Eggs', quantity: 0, unitPrice: 500,
      });
      const sales = await api.getSales();
      const added = sales[sales.length - 1];
      expect(added.totalAmount).toBe(0);
    });

    it('handles missing fields gracefully', async () => {
      await api.recordSale({});
      const sales = await api.getSales();
      const added = sales[sales.length - 1];
      expect(added.productType).toBe('produce');
      expect(added.totalAmount).toBe(0);
    });
  });

  describe('getPurchases', () => {
    it('returns purchases', async () => {
      const purchases = await api.getPurchases();
      expect(Array.isArray(purchases)).toBe(true);
    });
  });

  describe('recordPurchase', () => {
    it('records a purchase and creates a new lot', async () => {
      const result = await api.recordPurchase({
        itemId: '__new', itemName: 'Maize', unit: 'kg', category: 'FEED_INGREDIENT',
        supplier: 'Supplier A', quantity: 200, unitCost: 30,
      });

      expect(result.status).toBe('accepted');

      const items = await api.getItems();
      expect(items.length).toBeGreaterThanOrEqual(2);

      const purchases = await api.getPurchases();
      const added = purchases[purchases.length - 1];
      expect(added.supplier).toBe('Supplier A');
      expect(added.quantity).toBe(200);
      expect(added.totalCost).toBe(6000);
    });

    it('handles existing item purchases', async () => {
      await api.recordPurchase({
        itemId: 'i1', supplier: 'Supplier B', quantity: 50, unitCost: 55,
      });

      const afterLots = await api.getLots();
      const newLots = afterLots.filter(l => l.itemId === 'i1');
      expect(newLots.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getUnits', () => {
    it('returns mock units', async () => {
      const units = await api.getUnits();
      expect(Array.isArray(units)).toBe(true);
    });
  });

  describe('getBatches', () => {
    it('returns mock batches', async () => {
      const batches = await api.getBatches();
      expect(Array.isArray(batches)).toBe(true);
    });
  });

  describe('getBatch', () => {
    it('returns a specific batch', async () => {
      const batch = await api.getBatch('b1');
      expect(batch).not.toBeNull();
      expect(batch!.id).toBe('b1');
    });

    it('returns null for missing batch', async () => {
      const batch = await api.getBatch('nonexistent');
      expect(batch).toBeNull();
    });
  });

  describe('getCostSummary', () => {
    it('returns null for missing cost summary', async () => {
      const cost = await api.getCostSummary('nonexistent');
      expect(cost).toBeNull();
    });
  });

  describe('submitRecord', () => {
    it('returns accepted status', async () => {
      const result = await api.submitRecord('mortality', { count: 1 });
      expect(result.status).toBe('accepted');
      expect(result).toHaveProperty('id');
    });
  });

  describe('syncBatch', () => {
    it('returns accepted count', async () => {
      const result = await api.syncBatch([{ id: 'r1' }, { id: 'r2' }]);
      expect(result.accepted).toBe(2);
      expect(result.conflicts).toEqual([]);
    });
  });
});
