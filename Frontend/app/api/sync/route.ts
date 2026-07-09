import { db } from '@/db';
import type { DbClient } from '@/db';
import {
  records, feedingRecords, mortalityRecords, productionRecords, healthRecords, conflictLog, closingStockCounts, photos, batches, inventoryLots,
  physicalCounts, weightSamples, observations,
} from '@/db/schemas';
import { and, eq, like, desc } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, unauthorized, badRequest } from '@/lib/server/http';
import { consumeFeedFIFO } from '@/lib/server/inventory';
import { raiseAlert } from '@/lib/server/alertEngine';

// Short, human label for a batch in alert messages. Takes the record's own tx (not
// the top-level db) — it's called from inside routeTyped's transaction, and on the
// Workers deployment target (1-connection pool, see db/index.ts) a second query
// against plain `db` while that transaction holds the only connection would hang.
async function batchName(tenantId: string, batchId: string, tx: DbClient): Promise<string> {
  const [b] = await tx.select({ name: batches.name }).from(batches)
    .where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId))).limit(1);
  return b?.name ?? batchId;
}

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
async function handleProduction(r: IncomingRecord, tenantId: string, userId: string, tx: DbClient): Promise<RouteResult> {
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

  const sameDay = await tx.select().from(productionRecords).where(
    and(eq(productionRecords.tenantId, tenantId), eq(productionRecords.batchId, batchId),
        eq(productionRecords.type, type), like(productionRecords.capturedAt, `${day}%`))
  );

  if (sameDay.some((e) => e.clientUuid === r.clientUuid)) return { routed: true }; // idempotent resend
  const other = sameDay.find((e) => e.clientUuid !== r.clientUuid);

  if (!other) {
    await tx.insert(productionRecords).values(row).onConflictDoNothing({ target: productionRecords.clientUuid });
    return { routed: true };
  }
  if (other.qty === qty) return { routed: true }; // same value, different uuid → no real conflict

  // True conflict: last-write-wins by capturedAt.
  const incomingWins = r.capturedAt > other.capturedAt;
  await tx.insert(conflictLog).values({
    id: crypto.randomUUID(), tenantId, recordType: 'production',
    recordId: `${batchId}:${type}:${day}`,
    myVersion: row, serverVersion: other,
    capturedAtMine: r.capturedAt, capturedAtServer: other.capturedAt,
    resolution: incomingWins ? 'kept_mine' : 'kept_server',
  });
  if (incomingWins) {
    await tx.delete(productionRecords).where(eq(productionRecords.clientUuid, other.clientUuid));
    await tx.insert(productionRecords).values(row).onConflictDoNothing({ target: productionRecords.clientUuid });
  }
  return { routed: true, conflict: { clientUuid: r.clientUuid, recordType: 'production', resolution: incomingWins ? 'kept_mine' : 'kept_server' } };
}

async function routeTyped(r: IncomingRecord, tenantId: string, userId: string, tx: DbClient): Promise<RouteResult> {
  const p = r.payload ?? {};
  const base = { clientUuid: r.clientUuid, tenantId, recordedBy: userId, capturedAt: r.capturedAt };

  if (r.type === 'feeding') {
    const feedItemId = str(p.feedItemId);
    const qtyKg = num(p.quantityKg);
    const inserted = await tx.insert(feedingRecords).values({
      ...base, batchId: String(p.batchId ?? ''), lotId: str(p.lotId), feedItemId,
      quantityKg: qtyKg,
    }).onConflictDoNothing({ target: feedingRecords.clientUuid }).returning({ id: feedingRecords.clientUuid });
    // New record → draw the feed down from stock (FIFO) so on-hand stays real.
    if (inserted.length && feedItemId && qtyKg > 0) await consumeFeedFIFO(tenantId, feedItemId, qtyKg, tx);
    return { routed: true };
  }
  if (r.type === 'mortality') {
    // Store the captured photo (if any) and link it to the record.
    let photoId: string | undefined;
    if (typeof p.photo === 'string' && p.photo.startsWith('data:image')) {
      photoId = crypto.randomUUID();
      await tx.insert(photos).values({
        id: photoId, tenantId, data: p.photo,
        gpsLat: typeof p.gpsLat === 'number' ? p.gpsLat : null,
        gpsLng: typeof p.gpsLng === 'number' ? p.gpsLng : null,
        capturedBy: userId, capturedAt: r.capturedAt,
      }).onConflictDoNothing();
    }
    const batchId = String(p.batchId ?? '');
    const count = num(p.count);
    const inserted = await tx.insert(mortalityRecords).values({
      ...base, batchId, unitId: str(p.unitId), count, cause: str(p.cause), photoId: photoId ?? str(p.photoId),
    }).onConflictDoNothing({ target: mortalityRecords.clientUuid }).returning({ id: mortalityRecords.clientUuid });
    // New record → reduce the live batch population (never below zero). Locked
    // FOR UPDATE so two concurrent syncs decrementing the same batch can't both
    // read the same currentQty and lose one decrement (same race as consumeFeedFIFO).
    if (inserted.length && batchId && count > 0) {
      const [b] = await tx.select({ q: batches.currentQty }).from(batches)
        .where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId))).for('update').limit(1);
      if (b) await tx.update(batches).set({ currentQty: Math.max(0, b.q - count) })
        .where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId)));
    }
    return { routed: true };
  }
  if (r.type === 'health' || r.type === 'vaccination') {
    const lotId = str(p.productLotId ?? p.lotId);
    const qty = num(p.quantity ?? p.dose ?? 1);
    // Lock (and read) the lot BEFORE inserting, so the lot's withdrawal period at
    // this exact moment can be snapshotted onto the health record itself — see
    // lib/server/inventory.ts's checkWithdrawal() for why the record needs its own
    // immutable copy rather than re-reading the lot's (mutable) current value later.
    let lot: { q: number; withdrawalDays: number | null } | undefined;
    if (lotId) {
      [lot] = await tx.select({ q: inventoryLots.qtyOnHand, withdrawalDays: inventoryLots.withdrawalDays })
        .from(inventoryLots)
        .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.id, lotId))).for('update').limit(1);
    }
    const inserted = await tx.insert(healthRecords).values({
      ...base, batchId: String(p.batchId ?? ''), type: str(p.type) ?? 'VACCINE',
      productLotId: lotId, quantity: qty, withdrawalDays: lot?.withdrawalDays ?? null,
    }).onConflictDoNothing({ target: healthRecords.clientUuid }).returning({ id: healthRecords.clientUuid });
    // New record → draw the medicine/vaccine down from the specific lot used (never
    // below zero, even if more was logged offline than is on hand).
    if (inserted.length && lot && qty > 0) {
      await tx.update(inventoryLots).set({ qtyOnHand: Math.max(0, Math.round((lot.q - qty) * 1000) / 1000) })
        .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.id, lotId!)));
    }
    return { routed: true };
  }
  if (r.type === 'closing_stock') {
    await tx.insert(closingStockCounts).values({
      clientUuid: r.clientUuid, tenantId, itemId: String(p.itemId ?? ''), closingQty: num(p.closingQty),
      recordedBy: userId, capturedAt: r.capturedAt,
    }).onConflictDoNothing({ target: closingStockCounts.clientUuid });
    return { routed: true };
  }
  if (r.type === 'production' || r.type === 'eggs') {
    return handleProduction(r, tenantId, userId, tx);
  }
  if (r.type === 'weight_sample') {
    // A fresh weight sample refines the batch's avg live weight (caps kg-sold animals)
    // AND is kept as history so the owner sees growth — and is warned on weight loss.
    const batchId = str(p.batchId);
    const avg = Number(p.avgWeightKg) || 0;
    if (batchId && avg > 0) {
      const [prev] = await tx.select({ avg: weightSamples.avgWeightKg, at: weightSamples.capturedAt })
        .from(weightSamples).where(and(eq(weightSamples.tenantId, tenantId), eq(weightSamples.batchId, batchId)))
        .orderBy(desc(weightSamples.capturedAt)).limit(1);
      const ins = await tx.insert(weightSamples).values({
        clientUuid: r.clientUuid, tenantId, batchId,
        sampleSize: typeof p.sampleSize === 'number' ? p.sampleSize : null,
        avgWeightKg: avg, recordedBy: userId, capturedAt: r.capturedAt,
      }).onConflictDoNothing({ target: weightSamples.clientUuid }).returning({ id: weightSamples.clientUuid });
      await tx.update(batches).set({ avgWeightKg: avg })
        .where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId)));
      // Warn the owner if the herd/flock LOST weight vs the previous sample (> 3% to
      // ignore measurement noise) — a growth/health red flag.
      if (ins.length && prev && avg < prev.avg * 0.97) {
        await raiseAlert(tenantId, {
          id: `auto:weightloss:${r.clientUuid}`, severity: 'warning', type: 'weight_loss',
          title: 'Weight loss', message: `${await batchName(tenantId, batchId, tx)}: avg weight fell ${prev.avg}→${avg} kg`,
        }, tx);
      }
    }
    return { routed: true };
  }
  if (r.type === 'physical_count') {
    // Head count: record the count + variance and WARN the owner. The system count is
    // NOT changed here — the owner applies it (POST /api/physical-counts) so a worker
    // can never silently rewrite the live head count.
    const batchId = str(p.batchId);
    if (!batchId) return { routed: true };
    const systemCount = Math.round(Number(p.systemCount) || 0);
    const physical = Math.round(Number(p.physicalCount) || 0);
    const variance = Number.isFinite(Number(p.variance)) ? Math.round(Number(p.variance)) : physical - systemCount;
    const reason = str(p.reason);
    const ins = await tx.insert(physicalCounts).values({
      clientUuid: r.clientUuid, tenantId, batchId, unitId: str(p.unitId),
      systemCount, physicalCount: physical, variance, reason, notes: str(p.notes),
      reconciled: false, recordedBy: userId, capturedAt: r.capturedAt,
    }).onConflictDoNothing({ target: physicalCounts.clientUuid }).returning({ id: physicalCounts.clientUuid });
    if (ins.length && variance !== 0) {
      await raiseAlert(tenantId, {
        id: `auto:variance:${r.clientUuid}`, severity: variance < 0 ? 'critical' : 'warning', type: 'stock_variance',
        title: 'Stock variance',
        message: `${await batchName(tenantId, batchId, tx)}: counted ${physical} vs system ${systemCount} (${variance > 0 ? '+' : ''}${variance})${reason ? ` — ${reason}` : ''}`,
      }, tx);
    }
    return { routed: true };
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
        await tx.insert(productionRecords).values({
          clientUuid: `${r.clientUuid}:${batchId}:eggs`, tenantId, batchId,
          type: 'eggs', qty: eggs, weightKg: null, recordedBy: userId, capturedAt: r.capturedAt,
        }).onConflictDoNothing({ target: productionRecords.clientUuid });
      }
      // Feed USED today → record it and draw it down from stock (FIFO, clamped at 0),
      // the same as the dedicated Feeding flow. Idempotent per round+batch.
      const feedItemId = str(e.feedItemId);
      const feedUsed = Number(e.feedUsed) || 0;
      if (batchId && feedItemId && feedUsed > 0) {
        const ins = await tx.insert(feedingRecords).values({
          clientUuid: `${r.clientUuid}:${batchId}:feed`, tenantId, batchId,
          feedItemId, quantityKg: feedUsed, recordedBy: userId, capturedAt: r.capturedAt,
        }).onConflictDoNothing({ target: feedingRecords.clientUuid }).returning({ id: feedingRecords.clientUuid });
        if (ins.length) await consumeFeedFIFO(tenantId, feedItemId, feedUsed, tx);
      }
      // Observations (water readings + abnormal flag) → surfaced to the owner; an
      // abnormal report warns the owner so a field problem is never lost. One row
      // per round+batch (idempotent). Empty number inputs become null, not 0.
      if (batchId) {
        const pn = (v: unknown) => { const sv = String(v ?? '').trim(); if (!sv) return null; const nn = Number(sv); return Number.isFinite(nn) ? nn : null; };
        const abnormal = e.abnormal === true;
        const obs = await tx.insert(observations).values({
          clientUuid: `${r.clientUuid}:${batchId}:obs`, tenantId, batchId, unitId: str(e.unitId),
          waterLevel: str(e.waterLevel), waterColour: str(e.waterColour),
          tempC: pn(e.tempC), doMgL: pn(e.doMgL), ph: pn(e.ph), ammonia: pn(e.ammonia),
          abnormal, abnormalNote: str(e.abnormalNote), recordedBy: userId, capturedAt: r.capturedAt,
        }).onConflictDoNothing({ target: observations.clientUuid }).returning({ id: observations.clientUuid });
        if (obs.length && abnormal) {
          await raiseAlert(tenantId, {
            id: `auto:abnormal:${r.clientUuid}:${batchId}`, severity: 'warning', type: 'abnormal',
            title: 'Abnormality reported',
            message: `${await batchName(tenantId, batchId, tx)}: ${str(e.abnormalNote) || 'worker flagged an abnormality'}`,
          }, tx);
        }
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

    // One transaction per record: the generic audit insert + its typed row + typed
    // side-effect (stock draw-down / population decrement / conflict resolution) all
    // commit together or not at all. A crash mid-record can no longer leave a record
    // saved with its stock/population side-effect silently skipped. Records stay
    // independent of each other so one bad record in a batch doesn't roll back the
    // ones already accepted before it.
    const res = await db.transaction(async (tx) => {
      await tx.insert(records).values({
        clientUuid: r.clientUuid, tenantId: session.tenantId, type: r.type,
        payload: r.payload ?? {}, capturedAt: cap, createdBy: session.userId,
      }).onConflictDoNothing({ target: records.clientUuid });

      return routeTyped({ ...r, capturedAt: cap }, session.tenantId, session.userId, tx);
    });

    if (res.conflict) conflicts.push(res.conflict);
    accepted++;
  }

  return ok({ accepted, conflicts });
}
