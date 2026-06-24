// Seed script — run with: pnpm db:seed  (needs DATABASE_URL set).
// Idempotent: re-running does not duplicate (onConflictDoNothing).
import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import {
  tenants, users, workerProfiles, productionUnits, batches, inventoryItems, inventoryLots,
  feedingRecords, mortalityRecords, productionRecords, sales, healthRecords, laborLogs, overheads, employees,
  alertRules,
} from './schemas';

async function hashSecret(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256
  );
  const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$100000$${hex(salt.buffer)}$${hex(bits)}`;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const client = postgres(url, { prepare: false });
  const db = drizzle(client);
  const T = 't1';

  await db.insert(tenants).values({ id: T, name: "Kutswa's Farm" }).onConflictDoNothing();

  await db.insert(workerProfiles).values([
    {
      id: 'wp1', tenantId: T, name: 'Standard Worker', description: 'Hides all financial data',
      modules: ['morning_round', 'mortality', 'feeding', 'health', 'weight_sampling', 'physical_count', 'closing_stock'],
      mortalityPhotoThreshold: 1, alertThresholds: { mortalityRate: 2.0, lowStockKg: 50 },
      fields: [
        { fieldKey: 'feed_unit_cost', label: 'Feed unit cost (KES)', permission: 'hidden' },
        { fieldKey: 'feed_quantity', label: 'Feed quantity (kg)', permission: 'editable', required: true },
        { fieldKey: 'egg_sale_price', label: 'Egg sale price', permission: 'hidden' },
        { fieldKey: 'mortality_cause', label: 'Mortality cause', permission: 'editable' },
        { fieldKey: 'batch_profit_loss', label: 'Batch profit/loss', permission: 'hidden' },
      ],
    },
  ]).onConflictDoNothing();

  await db.insert(users).values([
    {
      id: 'u1', tenantId: T, name: 'Kutswa', phone: '+254712345678',
      email: 'kutswa@ifms.farm', role: 'owner', language: 'en',
      passwordHash: await hashSecret('demo1234'),
    },
    {
      id: 'u3', tenantId: T, name: 'John Otieno', phone: '+254700333444',
      role: 'worker', workerProfileId: 'wp1', language: 'en',
      pinHash: await hashSecret('1234'),
    },
    {
      id: 'u4', tenantId: T, name: 'Mary Achieng', phone: '+254700555666',
      role: 'worker', workerProfileId: 'wp1', language: 'sw',
      pinHash: await hashSecret('5678'),
    },
    {
      id: 'u2', tenantId: T, name: 'Amina Wanjiku', phone: '+254700111222',
      email: 'amina@ifms.farm', role: 'manager', language: 'en',
      passwordHash: await hashSecret('demo1234'),
    },
    {
      id: 'u5', tenantId: T, name: 'Dr. Kuria Kamau', phone: '+254700777888',
      email: 'vet@ifms.farm', role: 'vet', language: 'en',
      passwordHash: await hashSecret('demo1234'),
    },
    {
      id: 'u6', tenantId: T, name: 'Investor Link', phone: '+254700999000',
      email: 'investor@fund.ke', role: 'auditor', language: 'en',
      passwordHash: await hashSecret('demo1234'),
    },
    {
      id: 'admin', tenantId: T, name: 'Platform Admin', phone: '+254000000001',
      email: 'admin@ifms.app', role: 'super_admin', language: 'en',
      passwordHash: await hashSecret('demo1234'),
    },
  ]).onConflictDoNothing();

  await db.insert(productionUnits).values({
    id: 'unit1', tenantId: T, farmId: 'f1', type: 'CAGE', name: 'Cage A1', code: 'A1',
    capacity: 100, status: 'ACTIVE', currentQty: 85, species: 'chicken',
  }).onConflictDoNothing();

  await db.insert(batches).values({
    id: 'b1', tenantId: T, unitId: 'unit1', name: 'Layer #003', species: 'chicken', breed: 'ISA Brown',
    source: 'PURCHASED', acquiredDate: '2026-02-01', ageAtAcquire: 1, initialQty: 100, currentQty: 85,
    stage: 'LAYING', acquisitionCost: 15000, status: 'ACTIVE',
  }).onConflictDoNothing();

  await db.insert(inventoryItems).values({
    id: 'item1', tenantId: T, name: 'Layer Mash', category: 'FEED_FINISHED', unit: 'kg', lowStockThreshold: 50,
  }).onConflictDoNothing();

  await db.insert(inventoryLots).values({
    id: 'l1', tenantId: T, itemId: 'item1', lotNo: 'LM-2026-06', qtyOnHand: 42, unit: 'kg',
    unitCost: 70, receivedDate: '2026-06-10',
  }).onConflictDoNothing();

  // Feed ingredients (for the formulation / mix feature).
  await db.insert(inventoryItems).values([
    { id: 'ing-maize', tenantId: T, name: 'Maize', category: 'FEED_INGREDIENT', unit: 'kg', lowStockThreshold: 100 },
    { id: 'ing-soya', tenantId: T, name: 'Soya Cake', category: 'FEED_INGREDIENT', unit: 'kg', lowStockThreshold: 50 },
  ]).onConflictDoNothing();
  await db.insert(inventoryLots).values([
    { id: 'lot-maize', tenantId: T, itemId: 'ing-maize', lotNo: 'MZ-2026-06', qtyOnHand: 500, unit: 'kg', unitCost: 45, receivedDate: '2026-06-08' },
    { id: 'lot-soya', tenantId: T, itemId: 'ing-soya', lotNo: 'SY-2026-06', qtyOnHand: 200, unit: 'kg', unitCost: 80, receivedDate: '2026-06-08' },
  ]).onConflictDoNothing();

  // Default alert rules.
  await db.insert(alertRules).values([
    { id: 'ar1', tenantId: T, metric: 'mortality_rate', label: 'Mortality spike', threshold: 2.0, unit: '%', severity: 'critical', enabled: true },
    { id: 'ar2', tenantId: T, metric: 'feed_qty', label: 'Low feed stock', threshold: 50, unit: 'kg', severity: 'warning', enabled: true },
    { id: 'ar3', tenantId: T, metric: 'task_overdue_hours', label: 'Overdue task', threshold: 24, unit: 'h', severity: 'warning', enabled: true },
    { id: 'ar4', tenantId: T, metric: 'do_mgl', label: 'Water quality (DO)', threshold: 4.0, unit: 'mg/L', severity: 'critical', enabled: true },
  ]).onConflictDoNothing();

  // 14 days of field events for batch b1 so the costing engine has real numbers.
  const day = (n: number) => `2026-06-${String(n).padStart(2, '0')}T07:00:00Z`;
  const feed = Array.from({ length: 14 }, (_, i) => ({
    clientUuid: `seed-feed-${i + 1}`, tenantId: T, batchId: 'b1', lotId: 'l1', feedItemId: 'item1',
    quantityKg: 5, recordedBy: 'u3', capturedAt: day(i + 1),
  }));
  await db.insert(feedingRecords).values(feed).onConflictDoNothing();

  const eggs = Array.from({ length: 14 }, (_, i) => ({
    clientUuid: `seed-prod-${i + 1}`, tenantId: T, batchId: 'b1', type: 'eggs',
    qty: 48, recordedBy: 'u3', capturedAt: day(i + 1),
  }));
  await db.insert(productionRecords).values(eggs).onConflictDoNothing();

  await db.insert(mortalityRecords).values([
    { clientUuid: 'seed-mort-1', tenantId: T, batchId: 'b1', unitId: 'unit1', count: 2, cause: 'Sudden death', recordedBy: 'u3', capturedAt: day(5) },
    { clientUuid: 'seed-mort-2', tenantId: T, batchId: 'b1', unitId: 'unit1', count: 2, cause: 'Unknown', recordedBy: 'u3', capturedAt: day(11) },
  ]).onConflictDoNothing();

  await db.insert(sales).values({
    id: 'sale1', tenantId: T, batchId: 'b1', unitId: 'unit1', productType: 'eggs',
    quantity: 600, unitPrice: 11, totalAmount: 6600, buyer: 'Local Market',
    paymentMethod: 'mpesa', status: 'PAID', withdrawalCheck: 'cleared', createdAt: day(13),
  }).onConflictDoNothing();

  // Health: a vaccine item + lot, consumed by two applications → real health cost.
  await db.insert(inventoryItems).values({
    id: 'item2', tenantId: T, name: 'Newcastle Vaccine', category: 'VACCINE', unit: 'vial', lowStockThreshold: 5,
  }).onConflictDoNothing();
  await db.insert(inventoryLots).values({
    id: 'l2', tenantId: T, itemId: 'item2', lotNo: 'NCD-2026-06', qtyOnHand: 10, unit: 'vial',
    unitCost: 500, receivedDate: '2026-06-05', withdrawalDays: 7,
  }).onConflictDoNothing();
  await db.insert(healthRecords).values([
    { clientUuid: 'seed-health-1', tenantId: T, batchId: 'b1', type: 'VACCINE', productLotId: 'l2', quantity: 1, recordedBy: 'u3', capturedAt: day(7) },
    { clientUuid: 'seed-health-2', tenantId: T, batchId: 'b1', type: 'VACCINE', productLotId: 'l2', quantity: 1, recordedBy: 'u3', capturedAt: day(14) },
  ]).onConflictDoNothing();

  // Labor: 14 days × 1h × KES 150 → real labor cost allocated to the batch.
  const labor = Array.from({ length: 14 }, (_, i) => ({
    clientUuid: `seed-labor-${i + 1}`, tenantId: T, batchId: 'b1', hours: 1, ratePerHour: 150,
    recordedBy: 'u3', capturedAt: day(i + 1),
  }));
  await db.insert(laborLogs).values(labor).onConflictDoNothing();

  // Team roster (People page reads the employees table, distinct from auth users).
  await db.insert(employees).values([
    { id: 'e1', tenantId: T, name: 'John Otieno', phone: '+254700333444', role: 'worker', workerProfileId: 'wp1', pinSet: true, active: true },
    { id: 'e2', tenantId: T, name: 'Mary Achieng', phone: '+254700555666', role: 'worker', workerProfileId: 'wp1', pinSet: false, active: true },
    { id: 'e3', tenantId: T, name: 'Amina Wanjiku', phone: '+254700111222', role: 'manager', pinSet: false, active: true },
    { id: 'e4', tenantId: T, name: 'Dr. Kuria Kamau', phone: '+254700777888', role: 'vet', pinSet: false, active: true },
  ]).onConflictDoNothing();

  // Overhead: monthly utilities, allocated to batches by population share.
  await db.insert(overheads).values({
    id: 'oh1', tenantId: T, label: 'Utilities & rent (June)', amount: 3000, driver: 'population',
  }).onConflictDoNothing();

  // Alerts are not seeded — they are computed live by the alert engine
  // (POST /api/alerts/evaluate) from the rules above against real farm data.

  await client.end();
  console.log('✓ Seed complete. Owner: kutswa@ifms.farm / demo1234 · Worker: +254700333444 / 1234');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
