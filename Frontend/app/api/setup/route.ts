import { db } from '@/db';
import {
  tenants, productionUnits, batches, inventoryItems, inventoryLots, employees, users, workerProfiles, alertRules,
} from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { hashSecret } from '@/lib/server/crypto';
import { created, unauthorized, forbidden } from '@/lib/server/http';
import { DEFAULT_WORKER_FIELDS as DEFAULT_FIELDS } from '@/lib/workerFields';

interface Body {
  farmName?: string; farmLocation?: string;
  units?: { name: string; type: string; capacity: string }[];
  batches?: { name: string; species: string; qty: string; ageAtAcquire: string; cost: string; unitName?: string }[];
  inventory?: { name: string; category: string; unit: string; qty: string; unitCost: string }[];
  employees?: { name: string; phone: string; role: string; pin: string }[];
  mortalityRate?: string; lowStockKg?: string; mortalityPhotoThreshold?: string;
}

// POST /api/setup — one-shot onboarding: persists the whole setup wizard.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'owner') return forbidden();
  const tid = session.tenantId;
  const b = (await req.json().catch(() => ({}))) as Body;
  const s = (v: unknown, d = '') => (typeof v === 'string' && v.trim() ? v.trim() : d);
  const n = (v: unknown) => Number(v) || 0;
  const today = new Date().toISOString().slice(0, 10);
  const summary = { units: 0, batches: 0, items: 0, employees: 0, logins: 0 };

  if (s(b.farmName)) await db.update(tenants).set({ name: s(b.farmName) }).where(eq(tenants.id, tid));

  // Units
  const unitIdByName = new Map<string, string>();
  for (const u of b.units ?? []) {
    if (!s(u.name)) continue;
    const id = crypto.randomUUID();
    await db.insert(productionUnits).values({
      id, tenantId: tid, farmId: 'f1', type: s(u.type, 'HOUSE'), name: s(u.name),
      code: s(u.name).slice(0, 10), capacity: n(u.capacity), status: 'ACTIVE', currentQty: 0,
    });
    unitIdByName.set(s(u.name), id);
    summary.units++;
  }
  const firstUnit = [...unitIdByName.values()][0];

  // Batches (assigned to a unit)
  for (const ba of b.batches ?? []) {
    if (!s(ba.name)) continue;
    const unitId = unitIdByName.get(s(ba.unitName)) ?? firstUnit;
    if (!unitId) continue;
    const qty = n(ba.qty);
    await db.insert(batches).values({
      id: crypto.randomUUID(), tenantId: tid, unitId, name: s(ba.name), species: s(ba.species, 'unknown'),
      source: 'PURCHASED', acquiredDate: today, ageAtAcquire: n(ba.ageAtAcquire), initialQty: qty, currentQty: qty,
      stage: 'GROWING', acquisitionCost: n(ba.cost), status: 'ACTIVE',
    });
    summary.batches++;
  }

  // Inventory items + opening lots
  for (const it of b.inventory ?? []) {
    if (!s(it.name)) continue;
    const itemId = crypto.randomUUID();
    await db.insert(inventoryItems).values({
      id: itemId, tenantId: tid, name: s(it.name), category: s(it.category, 'CONSUMABLE'),
      unit: s(it.unit, 'kg'), lowStockThreshold: n(b.lowStockKg),
    });
    if (n(it.qty) > 0) {
      await db.insert(inventoryLots).values({
        id: crypto.randomUUID(), tenantId: tid, itemId, lotNo: `OPEN-${today}`, qtyOnHand: n(it.qty),
        unit: s(it.unit, 'kg'), unitCost: n(it.unitCost), receivedDate: today,
      });
    }
    summary.items++;
  }

  // Default worker profile (so Config + worker visibility work)
  const existing = await db.select({ id: workerProfiles.id }).from(workerProfiles).where(eq(workerProfiles.tenantId, tid));
  let profileId = existing[0]?.id;
  if (!profileId) {
    profileId = crypto.randomUUID();
    await db.insert(workerProfiles).values({
      id: profileId, tenantId: tid, name: 'Standard Worker', fields: DEFAULT_FIELDS,
      modules: ['morning_round', 'mortality', 'feeding', 'health', 'weight_sampling'],
      mortalityPhotoThreshold: n(b.mortalityPhotoThreshold) || 1, alertThresholds: {},
    });
  }

  // Employees (+ login for workers who set a PIN)
  for (const e of b.employees ?? []) {
    if (!s(e.name) || !s(e.phone)) continue;
    const role = s(e.role, 'worker');
    await db.insert(employees).values({
      id: crypto.randomUUID(), tenantId: tid, name: s(e.name), phone: s(e.phone), role,
      workerProfileId: role === 'worker' ? profileId : null, pinSet: role === 'worker' && !!s(e.pin), active: true,
    });
    summary.employees++;
    if (role === 'worker' && s(e.pin)) {
      await db.insert(users).values({
        id: crypto.randomUUID(), tenantId: tid, name: s(e.name), phone: s(e.phone), role: 'worker',
        workerProfileId: profileId, language: 'en', pinHash: await hashSecret(s(e.pin)),
      });
      summary.logins++;
    }
  }

  // Alert rules (replace)
  await db.delete(alertRules).where(eq(alertRules.tenantId, tid));
  await db.insert(alertRules).values([
    { id: crypto.randomUUID(), tenantId: tid, metric: 'mortality_rate', label: 'Mortality spike', threshold: n(b.mortalityRate) || 2, unit: '%', severity: 'critical', enabled: true },
    { id: crypto.randomUUID(), tenantId: tid, metric: 'feed_qty', label: 'Low feed stock', threshold: n(b.lowStockKg) || 50, unit: 'kg', severity: 'warning', enabled: true },
    { id: crypto.randomUUID(), tenantId: tid, metric: 'task_overdue_hours', label: 'Overdue task', threshold: 24, unit: 'h', severity: 'warning', enabled: true },
  ]);

  return created({ ok: true, summary });
}
