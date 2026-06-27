import { db } from '@/db';
import {
  records, feedingRecords, mortalityRecords, productionRecords, healthRecords, conflictLog, closingStockCounts, photos, batches, inventoryLots,
} from '@/db/schemas';
import { and, eq, like } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, unauthorized, badRequest } from '@/lib/server/http';
import { consumeFeedFIFO } from '@/lib/server/inventory';

interface IncomingRecord {
  clientUuid: string;
  type: string;
  payload: Record<string, unknown>;
  capturedAt: string;
}

interface RouteResult {
  routed: boolean;
  conflict?: { clientUuid: string; recordType: string; resolution: 'kept_mine' | 'kept_server' };
}

const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : d);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

// Production (eggs/meat/fish) has a natural business key: one record per batch, per
// type, per day. Two workers logging the same day's eggs offline produce a TRUE edit
// conflict — detected here, resolved last-write-wins by capture time, loser logged.
async function handleProduction(r: IncomingRecord, tenantId: string, userId: string): Promise<RouteResult> {
  const p = r.payload ?? {};
  const batchId = String(p.batchId ?? '');
  const type = str(p.type) ?? 'eggs';
  const qty = num(p.qty ?? p.eggs ?? p.count);
  const day = r.capturedAt.slice(0, 10);
  const row = {
    clientUuid: r.clientUuid, tenantId, batchId, type, qty,
    weightKg: typeof p.weightKg === 'number' ? p.weightKg : null,
    recordedBy: userId, capturedAt: r.capturedAt,
  };

  const sameDay = await db.select().from(productionRecords).where(
    and(eq(productionRecords.tenantId, tenantId), eq(productionRecords.batchId, batchId),
        eq(productionRecords.type, type), like(productionRecords.capturedAt, `${day}%`))
  );

  if (sameDay.some((e) => e.clientUuid === r.clientUuid)) return { routed: true }; // idempotent resend
  const other = sameDay.find((e) => e.clientUuid !== r.clientUuid);

  if (!other) {
    await db.insert(productionRecords).values(row).onConflictDoNothing({ target: productionRecords.clientUuid });
    return { routed: true };
  }
  if (other.qty === qty) return { routed: true }; // same value, different uuid → no real conflict

  // True conflict: last-write-wins by capturedAt.
  const incomingWins = r.capturedAt > other.capturedAt;
  await db.insert(conflictLog).values({
    id: crypto.randomUUID(), tenantId, recordType: 'production',
    recordId: `${batchId}:${type}:${day}`,
    myVersion: row, serverVersion: other,
    capturedAtMine: r.capturedAt, capturedAtServer: other.capturedAt,
    resolution: incomingWins ? 'kept_mine' : 'kept_server',
  });
  if (incomingWins) {
    await db.delete(productionRecords).where(eq(productionRecords.clientUuid, other.clientUuid));
    await db.insert(productionRecords).values(row).onConflictDoNothing({ target: productionRecords.clientUuid });
  }
  return { routed: true, conflict: { clientUuid: r.clientUuid, recordType: 'production', resolution: incomingWins ? 'kept_mine' : 'kept_server' } };
}

async function routeTyped(r: IncomingRecord, tenantId: string, userId: string): Promise<RouteResult> {
  const p = r.payload ?? {};
  const base = { clientUuid: r.clientUuid, tenantId, recordedBy: userId, capturedAt: r.capturedAt };

  if (r.type === 'feeding') {
    const feedItemId = str(p.feedItemId);
    const qtyKg = num(p.quantityKg);
    const inserted = await db.insert(feedingRecords).values({
      ...base, batchId: String(p.batchId ?? ''), lotId: str(p.lotId), feedItemId,
      quantityKg: qtyKg, leftoverKg: typeof p.leftoverKg === 'number' ? p.leftoverKg : null,
    }).onConflictDoNothing({ target: feedingRecords.clientUuid }).returning({ id: feedingRecords.clientUuid });
    // New record → draw the feed down from stock (FIFO) so on-hand stays real.
    if (inserted.length && feedItemId && qtyKg > 0) await consumeFeedFIFO(tenantId, feedItemId, qtyKg);
    return { routed: true };
  }
  if (r.type === 'mortality') {
    // Store the captured photo (if any) and link it to the record.
    let photoId: string | undefined;
    if (typeof p.photo === 'string' && p.photo.startsWith('data:image')) {
      photoId = crypto.randomUUID();
      await db.insert(photos).values({
        id: photoId, tenantId, data: p.photo,
        gpsLat: typeof p.gpsLat === 'number' ? p.gpsLat : null,
        gpsLng: typeof p.gpsLng === 'number' ? p.gpsLng : null,
        capturedBy: userId, capturedAt: r.capturedAt,
      }).onConflictDoNothing();
    }
    const batchId = String(p.batchId ?? '');
    const count = num(p.count);
    const inserted = await db.insert(mortalityRecords).values({
      ...base, batchId, unitId: str(p.unitId), count, cause: str(p.cause), photoId: photoId ?? str(p.photoId),
    }).onConflictDoNothing({ target: mortalityRecords.clientUuid }).returning({ id: mortalityRecords.clientUuid });
    // New record → reduce the live batch population (never below zero).
    if (inserted.length && batchId && count > 0) {
      const [b] = await db.select({ q: batches.currentQty }).from(batches)
        .where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId))).limit(1);
      if (b) await db.update(batches).set({ currentQty: Math.max(0, b.q - count) })
        .where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId)));
    }
    return { routed: true };
  }
  if (r.type === 'health' || r.type === 'vaccination') {
    const lotId = str(p.productLotId ?? p.lotId);
    const qty = num(p.quantity ?? p.dose ?? 1);
    const inserted = await db.insert(healthRecords).values({
      ...base, batchId: String(p.batchId ?? ''), type: str(p.type) ?? 'VACCINE',
      productLotId: lotId, quantity: qty,
    }).onConflictDoNothing({ target: healthRecords.clientUuid }).returning({ id: healthRecords.clientUuid });
    // New record → draw the medicine/vaccine down from the specific lot used (never
    // below zero, even if more was logged offline than is on hand).
    if (inserted.length && lotId && qty > 0) {
      const [lot] = await db.select({ q: inventoryLots.qtyOnHand }).from(inventoryLots)
        .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.id, lotId))).limit(1);
      if (lot) await db.update(inventoryLots).set({ qtyOnHand: Math.max(0, Math.round((lot.q - qty) * 1000) / 1000) })
        .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.id, lotId)));
    }
    return { routed: true };
  }
  if (r.type === 'closing_stock') {
    await db.insert(closingStockCounts).values({
      clientUuid: r.clientUuid, tenantId, itemId: String(p.itemId ?? ''), closingQty: num(p.closingQty),
      recordedBy: userId, capturedAt: r.capturedAt,
    }).onConflictDoNothing({ target: closingStockCounts.clientUuid });
    return { routed: true };
  }
  if (r.type === 'production' || r.type === 'eggs') {
    return handleProduction(r, tenantId, userId);
  }
  if (r.type === 'morning_round') {
    // Eggs counted on the morning round ARE collected stock, so they must become
    // sellable production (and therefore capped on sale — you can't sell more eggs
    // than were collected). Idempotent per round+batch: a resend is a no-op.
    const entries = Array.isArray((p as { entries?: unknown }).entries)
      ? ((p as { entries: Record<string, unknown>[] }).entries) : [];
    for (const e of entries) {
      const batchId = str(e.batchId);
      const eggs = Number(e.eggsCollected) || 0;
      if (batchId && eggs > 0) {
        await db.insert(productionRecords).values({
          clientUuid: `${r.clientUuid}:${batchId}:eggs`, tenantId, batchId,
          type: 'eggs', qty: eggs, weightKg: null, recordedBy: userId, capturedAt: r.capturedAt,
        }).onConflictDoNothing({ target: productionRecords.clientUuid });
      }
    }
    return { routed: true };
  }
  return { routed: false };
}

// POST /api/sync  { records: IncomingRecord[] }
// Idempotent by clientUuid (FR-M17-5). Production records additionally get true
// edit-conflict detection (FR-M17-3); conflicts are returned for the client to surface.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as { records?: IncomingRecord[] };
  const incoming = body.records;
  if (!Array.isArray(incoming)) return badRequest('records[] required');

  let accepted = 0;
  const conflicts: Array<{ clientUuid: string; recordType: string; resolution: string }> = [];

  for (const r of incoming) {
    if (!r.clientUuid || !r.type) continue;
    const cap = r.capturedAt ?? new Date().toISOString();
    await db.insert(records).values({
      clientUuid: r.clientUuid, tenantId: session.tenantId, type: r.type,
      payload: r.payload ?? {}, capturedAt: cap, createdBy: session.userId,
    }).onConflictDoNothing({ target: records.clientUuid });

    const res = await routeTyped({ ...r, capturedAt: cap }, session.tenantId, session.userId);
    if (res.conflict) conflicts.push(res.conflict);
    accepted++;
  }

  return ok({ accepted, conflicts });
}
