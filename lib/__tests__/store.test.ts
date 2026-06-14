import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFarmStore } from '@/lib/store';
import type {
  Flock, Sale, FeedInventory, FeedRecord, FeedDispenseRecord,
  BirdStageSale, MortalityRecord, EmployeeSalary, Customer,
} from '@/lib/types';

// sonner renders toasts; stub it so background error paths stay silent in tests.
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// withApi() fires fetch in the background (fire-and-forget). Stub it so the
// optimistic store updates we are testing don't attempt real network calls.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});

function flock(over: Partial<Flock> = {}): Flock {
  return {
    id: 'flock-1',
    name: 'Batch Alpha',
    dateAcquired: '2026-01-01',
    source: 'Kenchic',
    initialCount: 100,
    currentCount: 100,
    purchaseCostPerChick: 120,
    initialWeight: 0.04,
    breed: 'Isa Brown',
    stage: 'layer',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function inventory(): FeedInventory[] {
  return [
    { id: 'inv-layer', feedType: 'layer', currentStockKg: 500, reorderLevelKg: 100, lastUpdated: '' },
    { id: 'inv-grower', feedType: 'grower', currentStockKg: 50, reorderLevelKg: 100, lastUpdated: '' },
  ];
}

/** Reset to a known clean slate before each test. */
function seed(partial: Partial<ReturnType<typeof useFarmStore.getState>> = {}) {
  useFarmStore.setState({
    flocks: [flock()],
    sales: [],
    birdStageSales: [],
    mortalityRecords: [],
    feedRecords: [],
    feedDispenseRecords: [],
    feedInventory: inventory(),
    expenses: [],
    employeeSalaries: [],
    ...partial,
  });
}

const get = () => useFarmStore.getState();
const flockCount = (id = 'flock-1') => get().flocks.find(f => f.id === id)!.currentCount;
const stock = (type: string) => get().feedInventory.find(i => i.feedType === type)!.currentStockKg;

describe('bird sales ↔ flock count', () => {
  beforeEach(() => seed());

  it('decrements the flock count when birds are sold against a flock', () => {
    const sale: Sale = {
      id: 's1', customerId: 'c1', flockId: 'flock-1', product: 'birds',
      quantity: 30, pricePerUnit: 600, totalAmount: 18000, date: '2026-06-14',
      createdAt: '',
    };
    get().addSale(sale);
    expect(flockCount()).toBe(70);
    expect(get().sales).toHaveLength(1);
  });

  it('does NOT touch flock counts for egg sales', () => {
    get().addSale({
      id: 's2', customerId: 'c1', product: 'eggs',
      quantity: 90, pricePerUnit: 18, totalAmount: 1620, date: '2026-06-14', createdAt: '',
    });
    expect(flockCount()).toBe(100);
  });

  it('restores the flock count when a bird sale is deleted', () => {
    const sale: Sale = {
      id: 's3', customerId: 'c1', flockId: 'flock-1', product: 'birds',
      quantity: 40, pricePerUnit: 600, totalAmount: 24000, date: '2026-06-14', createdAt: '',
    };
    get().addSale(sale);
    expect(flockCount()).toBe(60);
    get().deleteSale('s3');
    expect(flockCount()).toBe(100);
    expect(get().sales).toHaveLength(0);
  });

  it('restores the flock count when a deletion request is approved', () => {
    const sale: Sale = {
      id: 's4', customerId: 'c1', flockId: 'flock-1', product: 'birds',
      quantity: 25, pricePerUnit: 600, totalAmount: 15000, date: '2026-06-14', createdAt: '',
    };
    get().addSale(sale);
    get().requestSaleDeletion('s4', 'wrong entry', 'employee-1');
    expect(flockCount()).toBe(75); // request alone must not change the count
    get().approveSaleDeletion('s4');
    expect(flockCount()).toBe(100);
    expect(get().sales).toHaveLength(0);
  });
});

describe('bird stage sales ↔ flock count', () => {
  beforeEach(() => seed());

  it('decrements on sale and restores on delete', () => {
    const bss: BirdStageSale = {
      id: 'b1', flockId: 'flock-1', stage: 'grower', quantity: 20,
      pricePerBird: 350, breakEvenPrice: 200, totalAmount: 7000, date: '2026-06-14', createdAt: '',
    };
    get().addBirdStageSale(bss);
    expect(flockCount()).toBe(80);
    get().deleteBirdStageSale('b1');
    expect(flockCount()).toBe(100);
  });
});

describe('mortality ↔ flock count', () => {
  beforeEach(() => seed());

  it('decrements the flock count by the mortality count', () => {
    const m: MortalityRecord = { id: 'm1', flockId: 'flock-1', date: '2026-06-14', count: 5, createdAt: '' };
    get().addMortalityRecord(m);
    expect(flockCount()).toBe(95);
  });

  it('never drives the flock count below zero', () => {
    get().addMortalityRecord({ id: 'm2', flockId: 'flock-1', date: '2026-06-14', count: 999, createdAt: '' });
    expect(flockCount()).toBe(0);
  });
});

describe('feed ↔ inventory', () => {
  beforeEach(() => seed());

  it('a feed record (per-flock usage) decrements the matching feed stock', () => {
    const r: FeedRecord = {
      id: 'fr1', flockId: 'flock-1', date: '2026-06-14', quantityKg: 120,
      feedType: 'layer', feedSource: 'purchased', costPerKg: 50, totalCost: 6000, createdAt: '',
    };
    get().addFeedRecord(r);
    expect(stock('layer')).toBe(380);
    expect(stock('grower')).toBe(50); // untouched
  });

  it('a dispense record decrements the matching feed stock', () => {
    const r: FeedDispenseRecord = {
      id: 'fd1', flockId: 'flock-1', date: '2026-06-14', quantityKg: 30,
      feedType: 'grower', feedSource: 'purchased', createdAt: '',
    };
    get().addFeedDispenseRecord(r);
    expect(stock('grower')).toBe(20);
  });

  it('feed stock never goes negative', () => {
    get().addFeedDispenseRecord({
      id: 'fd2', flockId: 'flock-1', date: '2026-06-14', quantityKg: 9999,
      feedType: 'grower', feedSource: 'purchased', createdAt: '',
    });
    expect(stock('grower')).toBe(0);
  });
});

describe('triggerSalaryExpenses', () => {
  it('creates one labour expense for a salary due today and is idempotent', () => {
    const today = new Date().getDate();
    const salary: EmployeeSalary = {
      id: 'sal-1', employeeId: 'e1', employeeName: 'Jane Doe',
      amount: 25000, payDayOfMonth: today, createdAt: '', updatedAt: '',
    };
    seed({ employeeSalaries: [salary], expenses: [] });

    get().triggerSalaryExpenses();
    expect(get().expenses).toHaveLength(1);
    expect(get().expenses[0]).toMatchObject({ category: 'labour', amount: 25000 });

    // Running again the same month must not create a duplicate.
    get().triggerSalaryExpenses();
    expect(get().expenses).toHaveLength(1);
  });

  it('does nothing when no salary falls due today', () => {
    const today = new Date().getDate();
    const notToday = today === 1 ? 2 : 1; // any pay day that isn't today
    seed({
      employeeSalaries: [{
        id: 'sal-2', employeeId: 'e2', employeeName: 'John', amount: 10000,
        payDayOfMonth: notToday, createdAt: '', updatedAt: '',
      }],
      expenses: [],
    });
    get().triggerSalaryExpenses();
    expect(get().expenses).toHaveLength(0);
  });
});

describe('deleteCustomer guard', () => {
  function customer(): Customer {
    return { id: 'c1', name: 'Mama Mboga', phone: '0712345678', type: 'retail', createdAt: '' };
  }

  it('refuses to delete a customer linked to a sale and keeps them in state', () => {
    seed({
      customers: [customer()],
      sales: [{
        id: 's1', customerId: 'c1', product: 'eggs', quantity: 30,
        pricePerUnit: 18, totalAmount: 540, date: '2026-06-14', createdAt: '',
      }],
    });
    get().deleteCustomer('c1');
    expect(get().customers).toHaveLength(1); // not removed
  });

  it('refuses to delete a customer linked to an order request', () => {
    seed({
      customers: [customer()],
      orderRequests: [{
        id: 'o1', customerId: 'c1', customerName: 'Mama Mboga', product: 'eggs',
        quantity: 30, pricePerUnit: 18, totalAmount: 540, status: 'pending',
        deliveryLocation: 'Town', contactPhone: '0712345678', requestedDate: '2026-06-14',
        paidByCustomer: false, deliveryConfirmed: false, createdAt: '', updatedAt: '',
      }],
    });
    get().deleteCustomer('c1');
    expect(get().customers).toHaveLength(1);
  });

  it('deletes a customer with no linked records', () => {
    seed({ customers: [customer()], sales: [], orderRequests: [] });
    get().deleteCustomer('c1');
    expect(get().customers).toHaveLength(0);
  });
});

describe('deleteFlock cascade (client mirror of DB)', () => {
  it('removes cascade children and unlinks set-null records', () => {
    seed({
      flocks: [flock({ id: 'flock-1' })],
      mortalityRecords: [{ id: 'm1', flockId: 'flock-1', date: '2026-06-14', count: 1, createdAt: '' }],
      feedRecords: [{
        id: 'fr1', flockId: 'flock-1', date: '2026-06-14', quantityKg: 10,
        feedType: 'layer', feedSource: 'purchased', costPerKg: 50, totalCost: 500, createdAt: '',
      }],
      birdStageSales: [{
        id: 'b1', flockId: 'flock-1', stage: 'grower', quantity: 5,
        pricePerBird: 350, breakEvenPrice: 200, totalAmount: 1750, date: '2026-06-14', createdAt: '',
      }],
      sales: [{
        id: 's1', customerId: 'c1', flockId: 'flock-1', product: 'birds', quantity: 10,
        pricePerUnit: 600, totalAmount: 6000, date: '2026-06-14', createdAt: '',
      }],
      expenses: [{ id: 'e1', category: 'feed', description: 'x', amount: 100, date: '2026-06-14', flockId: 'flock-1', createdAt: '' }],
    });

    get().deleteFlock('flock-1');

    // CASCADE children are gone
    expect(get().flocks).toHaveLength(0);
    expect(get().mortalityRecords).toHaveLength(0);
    expect(get().feedRecords).toHaveLength(0);
    expect(get().birdStageSales).toHaveLength(0);

    // SET NULL records are kept but unlinked (financial history preserved)
    expect(get().sales).toHaveLength(1);
    expect(get().sales[0].flockId).toBeUndefined();
    expect(get().expenses).toHaveLength(1);
    expect(get().expenses[0].flockId).toBeUndefined();
  });
});
