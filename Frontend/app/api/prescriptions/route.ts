import { db } from '@/db';
import { healthRecords, batches, inventoryLots } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { vetAssignedBatchIds } from '@/lib/server/resources';
import { ok, created, unauthorized, forbidden, badRequest } from '@/lib/server/http';
import { audit, actorLabel } from '@/lib/server/audit';

// Vet-only: prescribe a treatment for a batch. Writes a real healthRecords row
// (type: 'PRESCRIPTION') so it shows up in the batch's health timeline and feeds
// the withdrawal-period check on the batch detail page — the same fields a
// worker-logged VACCINE/MEDICATION record would use (quantity = dose,
// productLotId when the vet references a specific lot).
//
// GET /api/prescriptions?batchId=<id> — a vet's own prescriptions for a batch
// (owner/manager can also read, for the health timeline / withdrawal check).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!['owner', 'manager', 'vet', 'auditor'].includes(session.role)) return forbidden();

  const batchId = new URL(req.url).searchParams.get('batchId');
  if (batchId) {
    // FR-M5-5, read side: mirrors the POST-side batch-assignment check — a vet
    // must not be able to read prescriptions for a batch they can't see/prescribe for.
    const assigned = await vetAssignedBatchIds(session);
    if (assigned && !assigned.includes(batchId)) return forbidden();
  } else if (session.role === 'vet') {
    // No batchId: a vet fetching "every prescription in the tenant" is exactly
    // the unscoped-read gap this route must not allow — require a batchId for
    // vets specifically (owner/manager/auditor may still list tenant-wide).
    return badRequest('batchId required');
  }

  const rows = await db.select().from(healthRecords)
    .where(and(
      eq(healthRecords.tenantId, session.tenantId),
      eq(healthRecords.type, 'PRESCRIPTION'),
      ...(batchId ? [eq(healthRecords.batchId, batchId)] : []),
    ));
  return ok(rows);
}

// POST /api/prescriptions — create a prescription/advisory note for a batch.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'vet') return forbidden();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
  const batchId = s(body.batchId);
  const product = s(body.product).trim();
  const dose = Number(body.dose) || 0;
  const route = s(body.route).trim();
  const notes = s(body.notes).trim();
  const withdrawalDays = body.withdrawal != null && s(body.withdrawal) !== ''
    ? Math.max(0, Math.round(Number(body.withdrawal)))
    : null;
  // Optional: the vet may reference a specific inventory lot (e.g. dispensing from
  // stock on hand). Most prescriptions are a free-text treatment with no lot.
  const productLotId = body.productLotId ? s(body.productLotId) : null;

  if (!batchId) return badRequest('batchId required');
  if (!product) return badRequest('product/treatment required');

  // Verify the batch belongs to this tenant.
  const [batch] = await db.select({ id: batches.id, tenantId: batches.tenantId }).from(batches)
    .where(and(eq(batches.tenantId, session.tenantId), eq(batches.id, batchId))).limit(1);
  if (!batch) return badRequest('unknown batch');

  // FR-M5-5: a vet may only prescribe for batches they're assigned to (null = all).
  const assigned = await vetAssignedBatchIds(session);
  if (assigned && !assigned.includes(batchId)) return forbidden();

  let lot: { id: string } | undefined;
  if (productLotId) {
    [lot] = await db.select({ id: inventoryLots.id }).from(inventoryLots)
      .where(and(eq(inventoryLots.tenantId, session.tenantId), eq(inventoryLots.id, productLotId))).limit(1);
    if (!lot) return badRequest('unknown product lot');
  }

  const clientUuid = crypto.randomUUID();
  const capturedAt = new Date().toISOString();
  const noteParts = [product, route ? `route: ${route}` : '', notes].filter(Boolean);

  await db.insert(healthRecords).values({
    clientUuid, tenantId: session.tenantId, batchId, type: 'PRESCRIPTION',
    productLotId: lot?.id ?? null, quantity: dose, recordedBy: session.userId, capturedAt,
    // Always snapshotted onto the record itself (see lib/server/inventory.ts's
    // checkWithdrawal()) — even when a lot is referenced, so a later, unrelated
    // dispense from the same lot can never retroactively change THIS treatment's
    // withdrawal window.
    withdrawalDays,
    notes: noteParts.join(' — '),
  });

  // Deliberately does NOT write withdrawalDays onto inventoryLots: that column is
  // the medicine's own labeled withdrawal period, set once at purchase time
  // (app/api/purchases/route.ts) and shown to workers picking a lot on the health
  // form — a per-prescription value has no business overwriting it, and doing so
  // was the exact bug that let one prescription retroactively change another's
  // withdrawal window (see the comment on checkWithdrawal in lib/server/inventory.ts).

  await audit({
    tenantId: session.tenantId, actor: actorLabel(session), action: 'prescription.create',
    entity: batchId, after: { product, dose, route, withdrawalDays, productLotId: lot?.id ?? null },
  });

  return created({ id: clientUuid });
}
