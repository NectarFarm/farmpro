import type {
  Flock, MortalityRecord, FeedRecord, VaccinationRecord,
  EggCollection, Customer, Sale, Expense, Budget, Cage, FeedInventory, Alert
} from './types';

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

export function generateSeedData() {
  const cages: Cage[] = [
    { id: 'cage-1', name: 'Brooder House A', type: 'brooder', capacity: 500, createdAt: new Date().toISOString() },
    { id: 'cage-2', name: 'Grower Pen 1', type: 'grower', capacity: 300, createdAt: new Date().toISOString() },
    { id: 'cage-3', name: 'Layer Block 1', type: 'layer', capacity: 200, createdAt: new Date().toISOString() },
    { id: 'cage-4', name: 'Layer Block 2', type: 'layer', capacity: 200, createdAt: new Date().toISOString() },
  ];

  const flocks: Flock[] = [
    {
      id: 'flock-1',
      name: 'Batch Alpha – Jan 2025',
      dateAcquired: daysAgo(120),
      source: 'Happy Chicks Hatchery',
      initialCount: 500,
      currentCount: 482,
      purchaseCostPerChick: 2.5,
      initialWeight: 0.04,
      breed: 'ISA Brown',
      stage: 'layer',
      cageId: 'cage-3',
      notes: 'Performing well, good egg production',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'flock-2',
      name: 'Batch Beta – Mar 2025',
      dateAcquired: daysAgo(60),
      source: 'Green Valley Hatchery',
      initialCount: 300,
      currentCount: 295,
      purchaseCostPerChick: 2.8,
      initialWeight: 0.04,
      breed: 'Lohmann Brown',
      stage: 'grower',
      cageId: 'cage-2',
      notes: 'Moving to layer soon',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'flock-3',
      name: 'Batch Gamma – May 2025',
      dateAcquired: daysAgo(10),
      source: 'Happy Chicks Hatchery',
      initialCount: 400,
      currentCount: 398,
      purchaseCostPerChick: 2.6,
      initialWeight: 0.04,
      breed: 'ISA Brown',
      stage: 'brooder',
      cageId: 'cage-1',
      notes: 'New batch, monitoring closely',
      createdAt: new Date().toISOString(),
    },
  ];

  const mortalityRecords: MortalityRecord[] = [
    { id: 'mort-1', flockId: 'flock-1', date: daysAgo(100), count: 5, cause: 'Respiratory infection', createdAt: new Date().toISOString() },
    { id: 'mort-2', flockId: 'flock-1', date: daysAgo(80), count: 8, cause: 'Marek\'s disease', createdAt: new Date().toISOString() },
    { id: 'mort-3', flockId: 'flock-1', date: daysAgo(50), count: 3, cause: 'Unknown', createdAt: new Date().toISOString() },
    { id: 'mort-4', flockId: 'flock-1', date: daysAgo(20), count: 2, cause: 'Injuries', createdAt: new Date().toISOString() },
    { id: 'mort-5', flockId: 'flock-2', date: daysAgo(45), count: 3, cause: 'Coccidiosis', createdAt: new Date().toISOString() },
    { id: 'mort-6', flockId: 'flock-2', date: daysAgo(30), count: 2, cause: 'Unknown', createdAt: new Date().toISOString() },
    { id: 'mort-7', flockId: 'flock-3', date: daysAgo(5), count: 2, cause: 'Chilling', createdAt: new Date().toISOString() },
  ];

  const feedRecords: FeedRecord[] = [];
  for (let i = 90; i >= 0; i -= 3) {
    feedRecords.push({
      id: `feed-f1-${i}`,
      flockId: 'flock-1',
      date: daysAgo(i),
      quantityKg: 45 + Math.random() * 10,
      feedType: 'layer',
      feedSource: 'purchased',
      costPerKg: 0.55,
      totalCost: (45 + Math.random() * 10) * 0.55,
      createdAt: new Date().toISOString(),
    });
  }
  for (let i = 60; i >= 0; i -= 3) {
    feedRecords.push({
      id: `feed-f2-${i}`,
      flockId: 'flock-2',
      date: daysAgo(i),
      quantityKg: 30 + Math.random() * 8,
      feedType: 'grower',
      feedSource: 'purchased',
      costPerKg: 0.48,
      totalCost: (30 + Math.random() * 8) * 0.48,
      createdAt: new Date().toISOString(),
    });
  }

  const vaccinationRecords: VaccinationRecord[] = [
    { id: 'vac-1', flockId: 'flock-1', vaccineName: 'Newcastle Disease', scheduledDate: daysAgo(100), completedDate: daysAgo(100), cost: 45, notes: 'Spray method', createdAt: new Date().toISOString() },
    { id: 'vac-2', flockId: 'flock-1', vaccineName: "Marek's Disease", scheduledDate: daysAgo(118), completedDate: daysAgo(118), cost: 60, notes: 'Hatchery done', createdAt: new Date().toISOString() },
    { id: 'vac-3', flockId: 'flock-1', vaccineName: 'Infectious Bronchitis', scheduledDate: daysAgo(90), completedDate: daysAgo(89), cost: 35, createdAt: new Date().toISOString() },
    { id: 'vac-4', flockId: 'flock-1', vaccineName: 'Gumboro Disease', scheduledDate: daysAgo(80), completedDate: daysAgo(80), cost: 40, createdAt: new Date().toISOString() },
    { id: 'vac-5', flockId: 'flock-1', vaccineName: 'Fowl Pox', scheduledDate: daysAgo(5), cost: 50, notes: 'Due soon – schedule with vet', createdAt: new Date().toISOString() },
    { id: 'vac-6', flockId: 'flock-2', vaccineName: 'Newcastle Disease', scheduledDate: daysAgo(55), completedDate: daysAgo(55), cost: 30, createdAt: new Date().toISOString() },
    { id: 'vac-7', flockId: 'flock-2', vaccineName: 'Infectious Bronchitis', scheduledDate: daysAgo(45), completedDate: daysAgo(45), cost: 25, createdAt: new Date().toISOString() },
    { id: 'vac-8', flockId: 'flock-2', vaccineName: 'Gumboro Disease', scheduledDate: daysAgo(10), cost: 35, notes: 'Overdue!', createdAt: new Date().toISOString() },
    { id: 'vac-9', flockId: 'flock-3', vaccineName: "Marek's Disease", scheduledDate: daysAgo(9), completedDate: daysAgo(9), cost: 40, notes: 'Done at hatchery', createdAt: new Date().toISOString() },
    { id: 'vac-10', flockId: 'flock-3', vaccineName: 'Newcastle Disease', scheduledDate: daysAgo(-7), cost: 30, notes: 'Scheduled in 7 days', createdAt: new Date().toISOString() },
  ];

  const eggCollections: EggCollection[] = [];
  for (let i = 90; i >= 0; i--) {
    const base = 410 + Math.floor(Math.random() * 40 - 20);
    eggCollections.push({
      id: `egg-${i}`,
      flockId: 'flock-1',
      date: daysAgo(i),
      count: Math.max(350, base),
      broken: 0,
      sellable: Math.max(350, base),
      createdAt: new Date().toISOString(),
    });
  }

  const customers: Customer[] = [
    { id: 'cust-1', name: 'Morning Star Bakery', phone: '0712345678', email: 'orders@morningstar.com', address: '12 Baker St', type: 'bakery', notes: 'Orders weekly', createdAt: new Date().toISOString() },
    { id: 'cust-2', name: 'Green Garden Restaurant', phone: '0723456789', email: 'chef@greengarden.com', address: '45 Garden Ave', type: 'restaurant', notes: 'Prefers large eggs', createdAt: new Date().toISOString() },
    { id: 'cust-3', name: 'Mwangi Retail Shop', phone: '0734567890', type: 'retail', notes: 'Cash on delivery', createdAt: new Date().toISOString() },
    { id: 'cust-4', name: 'City Supermarket', phone: '0745678901', email: 'procurement@city.com', type: 'wholesale', notes: 'Bi-weekly orders', createdAt: new Date().toISOString() },
    { id: 'cust-5', name: 'Sunshine Hotel', phone: '0756789012', email: 'kitchen@sunshine.com', type: 'restaurant', createdAt: new Date().toISOString() },
  ];

  const sales: Sale[] = [];
  const saleCustomers = ['cust-1', 'cust-2', 'cust-3', 'cust-4', 'cust-5'];
  for (let i = 90; i >= 0; i -= 7) {
    saleCustomers.forEach((custId, idx) => {
      sales.push({
        id: `sale-${i}-${idx}`,
        customerId: custId,
        flockId: 'flock-1',
        product: 'eggs',
        quantity: 30 * (idx + 1) + Math.floor(Math.random() * 30),
        pricePerUnit: 0.18 + (idx * 0.01),
        totalAmount: 0,
        date: daysAgo(i + idx),
        createdAt: new Date().toISOString(),
      });
      sales[sales.length - 1].totalAmount = sales[sales.length - 1].quantity * sales[sales.length - 1].pricePerUnit;
    });
  }

  const expenses: Expense[] = [
    { id: 'exp-1', category: 'chicks', description: 'Batch Alpha chicks purchase', amount: 1250, date: daysAgo(120), flockId: 'flock-1', createdAt: new Date().toISOString() },
    { id: 'exp-2', category: 'chicks', description: 'Batch Beta chicks purchase', amount: 840, date: daysAgo(60), flockId: 'flock-2', createdAt: new Date().toISOString() },
    { id: 'exp-3', category: 'chicks', description: 'Batch Gamma chicks purchase', amount: 1040, date: daysAgo(10), flockId: 'flock-3', createdAt: new Date().toISOString() },
    { id: 'exp-4', category: 'labour', description: 'Farm workers – April', amount: 800, date: daysAgo(35), createdAt: new Date().toISOString() },
    { id: 'exp-5', category: 'labour', description: 'Farm workers – May', amount: 800, date: daysAgo(5), createdAt: new Date().toISOString() },
    { id: 'exp-6', category: 'utilities', description: 'Electricity – April', amount: 120, date: daysAgo(35), createdAt: new Date().toISOString() },
    { id: 'exp-7', category: 'utilities', description: 'Water bill – April', amount: 45, date: daysAgo(35), createdAt: new Date().toISOString() },
    { id: 'exp-8', category: 'medications', description: 'Coccidiosis treatment', amount: 85, date: daysAgo(43), flockId: 'flock-2', createdAt: new Date().toISOString() },
    { id: 'exp-9', category: 'miscellaneous', description: 'Equipment maintenance', amount: 200, date: daysAgo(25), createdAt: new Date().toISOString() },
  ];

  const budgets: Budget[] = [
    { id: 'bud-1', category: 'feed', period: 'monthly', amount: 2000, month: new Date().toISOString().slice(0, 7), createdAt: new Date().toISOString() },
    { id: 'bud-2', category: 'labour', period: 'monthly', amount: 900, month: new Date().toISOString().slice(0, 7), createdAt: new Date().toISOString() },
    { id: 'bud-3', category: 'vaccines', period: 'monthly', amount: 200, month: new Date().toISOString().slice(0, 7), createdAt: new Date().toISOString() },
    { id: 'bud-4', category: 'utilities', period: 'monthly', amount: 200, month: new Date().toISOString().slice(0, 7), createdAt: new Date().toISOString() },
    { id: 'bud-5', category: 'medications', period: 'monthly', amount: 150, month: new Date().toISOString().slice(0, 7), createdAt: new Date().toISOString() },
  ];

  const feedInventory: FeedInventory[] = [
    { id: 'fi-1', feedType: 'starter', currentStockKg: 180, reorderLevelKg: 50, lastUpdated: new Date().toISOString() },
    { id: 'fi-2', feedType: 'grower', currentStockKg: 250, reorderLevelKg: 75, lastUpdated: new Date().toISOString() },
    { id: 'fi-3', feedType: 'layer', currentStockKg: 320, reorderLevelKg: 100, lastUpdated: new Date().toISOString() },
    { id: 'fi-4', feedType: 'finisher', currentStockKg: 120, reorderLevelKg: 50, lastUpdated: new Date().toISOString() },
  ];

  const alerts: Alert[] = [
    { id: 'alert-1', type: 'vaccination_overdue', message: 'Gumboro Disease vaccination overdue for Batch Beta', relatedId: 'flock-2', route: '/flocks', read: false, createdAt: new Date().toISOString() },
    { id: 'alert-2', type: 'vaccination_overdue', message: 'Fowl Pox vaccination due for Batch Alpha', relatedId: 'flock-1', route: '/flocks', read: false, createdAt: new Date().toISOString() },
  ];

  return {
    flocks, mortalityRecords, feedRecords, vaccinationRecords,
    eggCollections, customers, sales, expenses, budgets,
    cages, feedInventory, alerts,
  };
}
