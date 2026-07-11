import { db } from '@/db';
import {
  tenants, productionUnits, batches, inventoryItems, inventoryLots, employees, users, workerProfiles, alertRules,
  lifecycleStages,
} from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { hashSecret } from '@/lib/server/crypto';
import { created, unauthorized, forbidden, badRequest, serverError } from '@/lib/server/http';
import { parseBody, setupSchema } from '@/lib/server/validate';
import { toCents } from '@/lib/server/money';
import { DEFAULT_WORKER_FIELDS as DEFAULT_FIELDS } from '@/lib/workerFields';
import { defaultStages, STAGE_ENTERPRISES } from '@/lib/lifecycle';
import { enterpriseFromSpecies } from '@/lib/server/productTemplates';

// Thrown for bad/ambiguous input so the outer handler can turn it into a 400
// instead of the request silently dropping data or crashing with a 500.
class SetupValidationError extends Error {}

const norm = (v: string) => v.trim().toLowerCase();

// POST /api/setup — one-shot onboarding: persists the whole setup wizard.
//
// Idempotency: rather than a client-generated token + schema migration, this
// is made idempotent-by-content — every insert first checks (by tenantId +
// name, or tenantId + phone for people) whether an equivalent row already
// exists for this tenant, and skips the insert if so. That means clicking
// "Finish" twice (e.g. after a network hiccup masked a prior success) reuses
// existing rows instead of duplicating them, with no new column/migration
// needed. This is "simplest robust approach" per the task; a dedicated
// setupToken would give stronger guarantees but isn't needed here since the
// whole wizard's data is naturally keyed by human-chosen names/phones.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'owner') return forbidden();
  const tid = session.tenantId;
  const parsed = await parseBody(req, setupSchema);
  if ('error' in parsed) return parsed.error;
  const b = parsed.data;
  const s = (v: unknown, d = '') => (typeof v === 'string' && v.trim() ? v.trim() : d);
  // Malformed numeric input (e.g. a typo'd acquisition cost) used to silently
  // coerce to 0 via `Number(v) || 0`, quietly zeroing out real values. Now:
  // a blank/absent field still defaults to 0, but a *present, unparseable or
  // negative* value throws so the request fails loudly instead of saving
  // wrong data.
  const n = (v: unknown, field: string) => {
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return 0;
    const num = Number(v);
    if (!Number.isFinite(num) || num < 0) {
      throw new SetupValidationError(`"${field}" must be a valid non-negative number (got "${v}").`);
    }
    return num;
  };
  const today = new Date().toISOString().slice(0, 10);
  // A blank date acquired defaults to today (brand-new stock); a *present* but
  // unparseable one throws rather than silently mis-dating the batch — that
  // date feeds ageDays()/lifecycle-due math, so garbage here means wrong stage
  // badges for the life of the batch.
  const dt = (v: unknown, field: string) => {
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return today;
    const t = new Date(String(v)).getTime();
    if (Number.isNaN(t)) throw new SetupValidationError(`"${field}" must be a valid date (got "${v}").`);
    return String(v).trim();
  };
  // Same lenient-null-on-bad-input behaviour as zPayDay (lib/server/validate.ts):
  // an absent/out-of-range pay day just means "not scheduled yet" rather than
  // failing the whole setup submission over one optional field.
  const payDayOf = (v: unknown): number | null => {
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
    const num = Number(v);
    return Number.isInteger(num) && num >= 1 && num <= 31 ? num : null;
  };

  try {
    const summary = await db.transaction(async (tx) => {
      const summary = { units: 0, batches: 0, items: 0, employees: 0, logins: 0, stages: 0 };

      if (s(b.farmName)) await tx.update(tenants).set({ name: s(b.farmName) }).where(eq(tenants.id, tid));

      // Units — idempotent by tenantId+name.
      const existingUnits = await tx.select({ id: productionUnits.id, name: productionUnits.name })
        .from(productionUnits).where(eq(productionUnits.tenantId, tid));
      const unitIdByName = new Map<string, string>(existingUnits.map(u => [norm(u.name), u.id]));
      for (const u of b.units ?? []) {
        if (!s(u.name)) continue;
        const key = norm(s(u.name));
        if (unitIdByName.has(key)) continue; // already exists — skip, don't duplicate
        const id = crypto.randomUUID();
        await tx.insert(productionUnits).values({
          id, tenantId: tid, farmId: 'f1', type: s(u.type, 'HOUSE'), name: s(u.name),
          code: s(u.name).slice(0, 10), capacity: n(u.capacity, `unit "${u.name}" capacity`), status: 'ACTIVE', currentQty: 0,
        });
        unitIdByName.set(key, id);
        summary.units++;
      }
      const firstUnit = [...unitIdByName.values()][0];

      // Lifecycle stages for each "Quick Start Template" enterprise picked on step 0
      // — idempotent by tenantId+enterprise: an enterprise that already has a stage
      // set (e.g. seeded at tenant creation, or edited since) is left untouched
      // rather than overwritten with defaults. Runs BEFORE the batches loop below
      // because a batch's initial `stage` is looked up from these rows — a batch
      // inserted first would get a stage name that matches nothing.
      const existingStageEnterprises = new Set(
        (await tx.select({ enterprise: lifecycleStages.enterprise }).from(lifecycleStages)
          .where(eq(lifecycleStages.tenantId, tid))).map(r => r.enterprise)
      );
      for (const key of b.templates ?? []) {
        if (!STAGE_ENTERPRISES.includes(key) || existingStageEnterprises.has(key)) continue;
        const stages = defaultStages(key);
        if (!stages.length) continue;
        await tx.insert(lifecycleStages).values(
          stages.map((st, i) => ({ id: crypto.randomUUID(), tenantId: tid, enterprise: key, ord: i, name: st.name, startDay: st.startDay }))
        );
        existingStageEnterprises.add(key);
        summary.stages++;
      }

      // First configured stage name per enterprise, for the batches loop below —
      // mirrors app/api/data/batches/route.ts's initial-stage lookup so a batch
      // created here starts on a REAL stage name instead of a placeholder that
      // matches no configured stage (which would permanently hide it from
      // lifecycle-due tracking; dueToAdvance() can never find its current stage
      // in the configured set).
      const allStageRows = await tx.select({ enterprise: lifecycleStages.enterprise, name: lifecycleStages.name })
        .from(lifecycleStages).where(eq(lifecycleStages.tenantId, tid)).orderBy(lifecycleStages.ord);
      const firstStageByEnterprise = new Map<string, string>();
      for (const r of allStageRows) if (!firstStageByEnterprise.has(r.enterprise)) firstStageByEnterprise.set(r.enterprise, r.name);

      // Batches (assigned to a unit) — idempotent by tenantId+name.
      const existingBatches = await tx.select({ name: batches.name })
        .from(batches).where(eq(batches.tenantId, tid));
      const batchNames = new Set(existingBatches.map(x => norm(x.name)));
      // Accumulated per-unit headcount deltas from batches actually created below —
      // applied once per unit after the loop (locked) rather than once per batch,
      // so a unit targeted by several batches in one submission is only locked once.
      const unitQtyDelta = new Map<string, number>();
      for (const ba of b.batches ?? []) {
        if (!s(ba.name)) continue;
        const key = norm(s(ba.name));
        if (batchNames.has(key)) continue; // already exists — skip, don't duplicate
        const unitId = unitIdByName.get(norm(s(ba.unitName))) ?? firstUnit;
        if (!unitId) {
          // No unit exists/resolves for this batch — fail the whole request
          // rather than silently dropping the batch (previous behaviour).
          throw new SetupValidationError(
            `Batch "${ba.name}" could not be assigned to a production unit — add a production unit first.`
          );
        }
        const qty = n(ba.qty, `batch "${ba.name}" quantity`);
        const cost = n(ba.cost, `batch "${ba.name}" acquisition cost`);
        const species = s(ba.species, 'unknown');
        const enterprise = enterpriseFromSpecies(species);
        const stage = (enterprise && firstStageByEnterprise.get(enterprise)) || defaultStages(enterprise)[0]?.name || 'GROWING';
        await tx.insert(batches).values({
          id: crypto.randomUUID(), tenantId: tid, unitId, name: s(ba.name), species,
          source: 'PURCHASED', acquiredDate: dt(ba.acquiredDate, `batch "${ba.name}" date acquired`),
          ageAtAcquire: n(ba.ageAtAcquire, `batch "${ba.name}" age`),
          initialQty: qty, currentQty: qty,
          stage, acquisitionCost: cost, acquisitionCostCents: toCents(cost), status: 'ACTIVE',
        });
        batchNames.add(key);
        summary.batches++;
        if (qty > 0) unitQtyDelta.set(unitId, (unitQtyDelta.get(unitId) ?? 0) + qty);
      }

      // Apply accumulated headcount into each touched unit's cached currentQty —
      // every OTHER path that changes a batch's qty (advance, physical-count,
      // close, sale) correctly adjusts this running total; batch creation was the
      // one path that left it untouched, so a fresh unit stayed stuck at 0 while
      // the Farm page's own live recompute (summing batch quantities) showed the
      // real number — two derivations of "how many animals are in this unit"
      // silently disagreeing. Locked since concurrent requests could also be
      // adjusting the same unit's currentQty right now.
      for (const [unitId, delta] of unitQtyDelta) {
        if (delta <= 0) continue;
        const [u] = await tx.select({ q: productionUnits.currentQty }).from(productionUnits)
          .where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, unitId))).for('update').limit(1);
        if (u) await tx.update(productionUnits).set({ currentQty: Math.max(0, (u.q ?? 0) + delta) })
          .where(and(eq(productionUnits.tenantId, tid), eq(productionUnits.id, unitId)));
      }

      // Inventory items + opening lots — idempotent by tenantId+name (item).
      const existingItems = await tx.select({ name: inventoryItems.name })
        .from(inventoryItems).where(eq(inventoryItems.tenantId, tid));
      const itemNames = new Set(existingItems.map(x => norm(x.name)));
      for (const it of b.inventory ?? []) {
        if (!s(it.name)) continue;
        const key = norm(s(it.name));
        if (itemNames.has(key)) continue; // already exists — skip, don't duplicate
        const itemId = crypto.randomUUID();
        const qty = n(it.qty, `item "${it.name}" quantity`);
        await tx.insert(inventoryItems).values({
          id: itemId, tenantId: tid, name: s(it.name), category: s(it.category, 'CONSUMABLE'),
          unit: s(it.unit, 'kg'), lowStockThreshold: n(b.lowStockKg, 'low stock threshold'),
        });
        if (qty > 0) {
          const unitCost = n(it.unitCost, `item "${it.name}" unit cost`);
          await tx.insert(inventoryLots).values({
            id: crypto.randomUUID(), tenantId: tid, itemId, lotNo: `OPEN-${today}`, qtyOnHand: qty,
            unit: s(it.unit, 'kg'), unitCost, unitCostCents: toCents(unitCost), receivedDate: today,
          });
        }
        itemNames.add(key);
        summary.items++;
      }

      // Default worker profile (so Config + worker visibility work) — already
      // idempotent: reuses the tenant's existing profile if one exists.
      const existingProfile = await tx.select({ id: workerProfiles.id }).from(workerProfiles).where(eq(workerProfiles.tenantId, tid));
      let profileId = existingProfile[0]?.id;
      if (!profileId) {
        profileId = crypto.randomUUID();
        await tx.insert(workerProfiles).values({
          id: profileId, tenantId: tid, name: 'Standard Worker', fields: DEFAULT_FIELDS,
          modules: ['morning_round', 'mortality', 'feeding', 'health', 'weight_sampling'],
          mortalityPhotoThreshold: n(b.mortalityPhotoThreshold, 'mortality photo threshold') || 1, alertThresholds: {},
        });
      }

      // Employees (+ login for workers who set a PIN) — idempotent by tenantId+phone.
      const existingEmployees = await tx.select({ phone: employees.phone })
        .from(employees).where(eq(employees.tenantId, tid));
      const employeePhones = new Set(existingEmployees.map(x => norm(x.phone)));
      for (const e of b.employees ?? []) {
        if (!s(e.name) || !s(e.phone)) continue;
        const phoneKey = norm(s(e.phone));
        if (employeePhones.has(phoneKey)) continue; // already exists — skip, don't duplicate
        const role = s(e.role, 'worker');
        const salary = n(e.salary, `employee "${e.name}" salary`);
        await tx.insert(employees).values({
          id: crypto.randomUUID(), tenantId: tid, name: s(e.name), phone: s(e.phone), role,
          workerProfileId: role === 'worker' ? profileId : null, pinSet: role === 'worker' && !!s(e.pin), active: true,
          salary, salaryCents: toCents(salary), payDay: payDayOf(e.payDay),
        });
        employeePhones.add(phoneKey);
        summary.employees++;
        if (role === 'worker' && s(e.pin)) {
          // `users.phone` is globally unique; onConflictDoNothing makes this
          // safe even if a retry races past the employeePhones check above.
          const ins = await tx.insert(users).values({
            id: crypto.randomUUID(), tenantId: tid, name: s(e.name), phone: s(e.phone), role: 'worker',
            workerProfileId: profileId, language: 'en', pinHash: await hashSecret(s(e.pin)),
          }).onConflictDoNothing({ target: users.phone }).returning({ id: users.id });
          if (ins.length) summary.logins++;
        }
      }

      // Alert rules (replace) — delete-then-insert is already idempotent:
      // repeat calls end up with the same three rules, not duplicates.
      await tx.delete(alertRules).where(eq(alertRules.tenantId, tid));
      await tx.insert(alertRules).values([
        { id: crypto.randomUUID(), tenantId: tid, metric: 'mortality_rate', label: 'Mortality spike', threshold: n(b.mortalityRate, 'mortality rate threshold') || 2, unit: '%', severity: 'critical', enabled: true },
        { id: crypto.randomUUID(), tenantId: tid, metric: 'feed_qty', label: 'Low feed stock', threshold: n(b.lowStockKg, 'low stock threshold') || 50, unit: 'kg', severity: 'warning', enabled: true },
        { id: crypto.randomUUID(), tenantId: tid, metric: 'task_overdue_hours', label: 'Overdue task', threshold: 24, unit: 'h', severity: 'warning', enabled: true },
      ]);

      return summary;
    });

    return created({ ok: true, summary });
  } catch (err) {
    if (err instanceof SetupValidationError) return badRequest(err.message);
    console.error('setup failed', err);
    return serverError('Setup failed — please retry');
  }
}
