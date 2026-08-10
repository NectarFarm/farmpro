import 'server-only';
// Record-type handlers for the sync endpoint. Each function handles one type of
// field event (feeding, mortality, health, production, etc.) within the sync
// transaction. Payloads are validated against Zod schemas from validate.ts.
import type { DbClient } from '@/db';
import {
  feedingRecords, mortalityRecords, productionRecords, healthRecords, conflictLog, closingStockCounts,
  photos, batches, inventoryLots, physicalCounts, weightSamples, observations, products,
} from '@/db/schemas';
import { and, eq, like, ilike, desc } from 'drizzle-orm';
import { consumeFeedFIFO } from './inventory';
import { raiseAlert } from './alertEngine';
import { validatePhotoDataUrl } from './media';
import { isStorageConfigured, uploadPhoto } from './storage';
import { assertWritable } from './fieldPermissions';
import type { Session } from './session';
import {
  feedingPayloadSchema, mortalityPayloadSchema, healthPayloadSchema,
  closingStockPayloadSchema, productionPayloadSchema, weightSamplePayloadSchema,
  physicalCountPayloadSchema, morningRoundPayloadSchema,
} from './validate';

export interface IncomingRecord {
  clientUuid: string;
  type: string;
  payload: Record<string, unknown>;
  capturedAt: string;
}

export interface RouteResult {
  routed: boolean;
  conflict?: { clientUuid: string; recordType: string; resolution: 'kept_mine' | 'kept_server' };
}

async function batchName(tenantId: string, batchId: string, tx: DbClient): Promise<string> {
  const [b] = await tx.select({ name: batches.name }).from(batches)
    .where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId))).limit(1);
  return b?.name ?? batchId;
}

// ── Production (additive by default, edit-conflict aware on an explicit slot) ─
//
// #24: a second same-day production record used to be treated as a conflict
// and the loser DELETEd — so two tea pluckers, or a morning and an evening
// milking, destroyed each other. The fix makes the identity explicit via
// `slot_key` (see db/schemas/index.ts): no explicit slot from the client →
// the server defaults it to something globally unique to THIS submission
// (day:product:clientUuid), which can never collide, so it is always
// additive. An explicit slot (the collect-page equivalent of "editing the
// same slot") is a genuine edit of that one logical event.

type ProductionRow = typeof productionRecords.$inferInsert;

// Shared by handleProduction and handleMorningRound's egg entry (the one case
// the old dedupe intent was right about — see handleMorningRound below).
// `explicitSlot` null/undefined means "no slot named by the client": the
// default slot below folds in `row.clientUuid`, which is what makes that case
// always additive.
async function upsertProductionSlot(
  tx: DbClient, tenantId: string, batchId: string, type: string, day: string,
  row: Omit<ProductionRow, 'slotKey'>, explicitSlot?: string | null,
): Promise<RouteResult> {
  // Retry idempotency: offline sync replays records, so a record with a
  // client_uuid already on disk is this exact submission landing again (a
  // network retry, or the same sync batch resent) — not a new event and not
  // an edit. No-op, same as every other handler's onConflictDoNothing target.
  const [existingByUuid] = await tx.select({ clientUuid: productionRecords.clientUuid })
    .from(productionRecords).where(eq(productionRecords.clientUuid, row.clientUuid)).limit(1);
  if (existingByUuid) return { routed: true };

  const productKey = row.productId ?? 'none';
  const slotKey = `${day}:${productKey}:${explicitSlot ?? row.clientUuid}`;
  const fullRow: ProductionRow = { ...row, slotKey };

  const [slotRow] = await tx.select().from(productionRecords).where(
    and(eq(productionRecords.tenantId, tenantId), eq(productionRecords.batchId, batchId), eq(productionRecords.slotKey, slotKey))
  ).limit(1);

  if (!slotRow) {
    // First submission on this slot — always additive, never a conflict.
    await tx.insert(productionRecords).values(fullRow).onConflictDoNothing({ target: productionRecords.clientUuid });
    if (!explicitSlot) {
      // Soft duplicate signal (not a mutation): the two-pluckers case is
      // legitimate and must land as two rows, but if a THIRD same-day entry
      // for this batch/type happens to carry the exact same quantity, that's
      // more likely the same event recorded twice than two coincidentally
      // identical harvests — warn the owner, don't block or merge it.
      const sameDay = await tx.select().from(productionRecords).where(
        and(eq(productionRecords.tenantId, tenantId), eq(productionRecords.batchId, batchId),
            eq(productionRecords.type, type), like(productionRecords.capturedAt, `${day}%`))
      );
      const dup = sameDay.find((e) => e.clientUuid !== row.clientUuid && e.qty === row.qty);
      if (dup) {
        await raiseAlert(tenantId, {
          id: `auto:dup_qty:${batchId}:${type}:${day}:${row.qty}`,
          severity: 'info', type: 'possible_duplicate',
          title: 'Possible duplicate collection',
          message: `${await batchName(tenantId, batchId, tx)}: two ${type} entries of ${row.qty} landed on ${day} — worth checking these are genuinely separate collections.`,
        }, tx);
      }
    }
    return { routed: true };
  }

  // Something already occupies this slot under a DIFFERENT client_uuid (the
  // retry check above already returned for a matching one) — a genuine edit.
  if (slotRow.qty === row.qty) return { routed: true }; // identical resubmission: nothing to log or change

  const incomingWins = row.capturedAt > slotRow.capturedAt;
  await tx.insert(conflictLog).values({
    id: crypto.randomUUID(), tenantId, recordType: 'production',
    recordId: `${batchId}:${type}:${day}`,
    myVersion: fullRow, serverVersion: slotRow,
    capturedAtMine: row.capturedAt, capturedAtServer: slotRow.capturedAt,
    resolution: incomingWins ? 'kept_mine' : 'kept_server',
  });
  if (incomingWins) {
    // UPDATE in place — never DELETE. The surviving row keeps its ORIGINAL
    // client_uuid (slotRow's, not the incoming one) so the offline client
    // that owns that client_uuid still resolves its local copy, and so
    // /api/conflicts (which looks records up by the client_uuid stashed on
    // this very conflict_log row) keeps finding a real row either way.
    await tx.update(productionRecords).set({
      qty: row.qty, weightKg: row.weightKg ?? null, productId: row.productId ?? null,
      baseUnit: row.baseUnit ?? null, recordedBy: row.recordedBy, capturedAt: row.capturedAt,
    }).where(eq(productionRecords.clientUuid, slotRow.clientUuid));
  }
  return { routed: true, conflict: { clientUuid: row.clientUuid, recordType: 'production', resolution: incomingWins ? 'kept_mine' : 'kept_server' } };
}

export async function handleProduction(
  r: IncomingRecord, tenantId: string, userId: string, tx: DbClient, session: Session,
): Promise<RouteResult> {
  const parsed = productionPayloadSchema.safeParse(r.payload ?? {});
  // Throw (not `return { routed: true }`) on a genuinely malformed payload —
  // the sync route's per-record db.transaction() catches this and puts the
  // record in the response's `rejected[]` array instead of silently reporting
  // it as accepted with nothing actually written. A record that fails Zod here
  // needs to be visible to the client so it can alert the worker / retry, not
  // disappear into a false "accepted" response.
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join('; ') || 'Invalid record payload.');
  }
  const p = parsed.data;
  const batchId = p.batchId || '';
  const type = p.type || 'eggs';
  const qty = p.qty ?? p.eggs ?? p.count ?? 0;
  const day = r.capturedAt.slice(0, 10);

  // product_id is now a real FK (ON DELETE RESTRICT) — snapshot baseUnit from
  // the product row rather than trusting the client for it, and verify the id
  // actually resolves for this tenant *and this batch* before writing it. A
  // stale id (product deleted in the narrow window between offline capture
  // and sync — deletion itself is blocked once a record references it, but
  // nothing stops it *before* that first record lands) must not turn into an
  // FK violation that rejects the whole record; fall back to null, same as an
  // unresolved backfill row, rather than losing the qty/type the worker
  // actually reported. The batchId predicate matters just as much as the
  // tenantId one: without it, a productId belonging to another batch of the
  // same tenant resolves fine here but then matches no batch's cost driver in
  // costing.ts, so the qty silently vanishes from output with no error and no
  // unresolved-row count. Scoping the lookup to this batch makes a cross-batch
  // id fail to resolve here instead, landing it in the same null fallback.
  let productId: string | null = null;
  let baseUnit: string | null = null;
  if (p.productId) {
    const [prod] = await tx.select({ baseUnit: products.baseUnit, fieldKey: products.fieldKey }).from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.batchId, batchId), eq(products.id, p.productId))).limit(1);
    if (prod) {
      productId = p.productId;
      baseUnit = prod.baseUnit;
      // #203: the product's own `field_key` (e.g. `collect_eggs`) is the
      // permission gate a worker profile carries for collecting THIS product
      // (see addCollectionPermissions in lib/server/products.ts, which is what
      // put it there).
      //
      // KNOWN GAP (#210), stated plainly because it is easy to misread as safe:
      // this gate only runs when the client SENDS a resolvable productId, so
      // enforcement is opt-in by the caller. An omitted or unresolvable
      // productId is NOT gated — the record is still written, with product_id
      // NULL. What is lost is the attribution, not the write. A worker whose
      // collect_* permission is locked can therefore still land a quantity by
      // leaving productId out.
      //
      // The row is inert: #23 excludes NULL product_id from costing rather than
      // counting it as zero, and it matches no product for availability. But it
      // does appear in the activity feed, so it is an unauthorised write, not a
      // no-op. The NULL fallback itself is deliberate (#22) — it keeps an
      // offline record whose product changed between capture and sync from
      // being rejected outright — which is why closing #210 means gating on the
      // claimed `type` instead of removing the fallback.
      if (prod.fieldKey) await assertWritable(session, [prod.fieldKey]);
    }
  }

  const row = {
    clientUuid: r.clientUuid, tenantId, batchId, type, qty,
    weightKg: p.weightKg ?? null,
    productId, baseUnit,
    recordedBy: userId, capturedAt: r.capturedAt,
  };

  return upsertProductionSlot(tx, tenantId, batchId, type, day, row, p.slot ?? null);
}

// ── Feeding ─────────────────────────────────────────────────────────────────

export async function handleFeeding(
  r: IncomingRecord, tenantId: string, userId: string, tx: DbClient, session: Session,
): Promise<RouteResult> {
  const parsed = feedingPayloadSchema.safeParse(r.payload ?? {});
  // Throw (not `return { routed: true }`) on a genuinely malformed payload —
  // the sync route's per-record db.transaction() catches this and puts the
  // record in the response's `rejected[]` array instead of silently reporting
  // it as accepted with nothing actually written. A record that fails Zod here
  // needs to be visible to the client so it can alert the worker / retry, not
  // disappear into a false "accepted" response.
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join('; ') || 'Invalid record payload.');
  }
  // #203: field permissions are a write boundary, not just a read-side one —
  // a worker whose profile marks feed_quantity non-editable must not be able
  // to write a feeding record either. Thrown before any insert, so it lands
  // in the sync response's rejected[] the same way a malformed payload does.
  await assertWritable(session, ['feed_quantity']);
  const p = parsed.data;
  const feedItemId = p.feedItemId ?? undefined;
  const qtyKg = p.quantityKg;
  const base = { clientUuid: r.clientUuid, tenantId, recordedBy: userId, capturedAt: r.capturedAt };
  const inserted = await tx.insert(feedingRecords).values({
    ...base, batchId: p.batchId, lotId: p.lotId ?? null, feedItemId,
    quantityKg: qtyKg,
  }).onConflictDoNothing({ target: feedingRecords.clientUuid }).returning({ id: feedingRecords.clientUuid });
  if (inserted.length && feedItemId && qtyKg > 0) await consumeFeedFIFO(tenantId, feedItemId, qtyKg, tx);
  return { routed: true };
}

// ── Mortality ───────────────────────────────────────────────────────────────

export async function handleMortality(
  r: IncomingRecord, tenantId: string, userId: string, tx: DbClient, session: Session,
): Promise<RouteResult> {
  const parsed = mortalityPayloadSchema.safeParse(r.payload ?? {});
  // Throw (not `return { routed: true }`) on a genuinely malformed payload —
  // the sync route's per-record db.transaction() catches this and puts the
  // record in the response's `rejected[]` array instead of silently reporting
  // it as accepted with nothing actually written. A record that fails Zod here
  // needs to be visible to the client so it can alert the worker / retry, not
  // disappear into a false "accepted" response.
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join('; ') || 'Invalid record payload.');
  }
  const p = parsed.data;
  // #203: only gate on `cause` — it's the one mortality field a worker
  // profile can hide/lock (mortality_cause); the death count itself carries
  // no field-permission key today.
  if (p.cause) await assertWritable(session, ['mortality_cause']);
  const base = { clientUuid: r.clientUuid, tenantId, recordedBy: userId, capturedAt: r.capturedAt };
  let photoId: string | undefined;
  if (p.photo && p.photo.startsWith('data:image')) {
    const photoCheck = validatePhotoDataUrl(p.photo);
    if (!photoCheck.ok) throw new Error(photoCheck.error);
    photoId = crypto.randomUUID();
    const storageKey = `${tenantId}/${photoId}.${photoCheck.mime.split('/')[1] ?? 'jpg'}`;
    if (isStorageConfigured()) {
      await uploadPhoto(storageKey, photoCheck.bytes, photoCheck.mime);
      await tx.insert(photos).values({
        id: photoId, tenantId, storageKey, mime: photoCheck.mime,
        gpsLat: p.gpsLat ?? null, gpsLng: p.gpsLng ?? null,
        capturedBy: userId, capturedAt: r.capturedAt,
      }).onConflictDoNothing();
    } else {
      await tx.insert(photos).values({
        id: photoId, tenantId, data: p.photo,
        gpsLat: p.gpsLat ?? null, gpsLng: p.gpsLng ?? null,
        capturedBy: userId, capturedAt: r.capturedAt,
      }).onConflictDoNothing();
    }
  }
  const batchId = p.batchId;
  const count = p.count;
  const inserted = await tx.insert(mortalityRecords).values({
    ...base, batchId, unitId: p.unitId ?? null, count, cause: p.cause ?? null, photoId: photoId ?? p.photoId ?? null,
  }).onConflictDoNothing({ target: mortalityRecords.clientUuid }).returning({ id: mortalityRecords.clientUuid });
  if (inserted.length && batchId && count > 0) {
    const [b] = await tx.select({ q: batches.currentQty }).from(batches)
      .where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId))).for('update').limit(1);
    if (b) await tx.update(batches).set({ currentQty: Math.max(0, b.q - count) })
      .where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId)));
  }
  return { routed: true };
}

// ── Health ──────────────────────────────────────────────────────────────────

export async function handleHealth(
  r: IncomingRecord, tenantId: string, userId: string, tx: DbClient,
): Promise<RouteResult> {
  const parsed = healthPayloadSchema.safeParse(r.payload ?? {});
  // Throw (not `return { routed: true }`) on a genuinely malformed payload —
  // the sync route's per-record db.transaction() catches this and puts the
  // record in the response's `rejected[]` array instead of silently reporting
  // it as accepted with nothing actually written. A record that fails Zod here
  // needs to be visible to the client so it can alert the worker / retry, not
  // disappear into a false "accepted" response.
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join('; ') || 'Invalid record payload.');
  }
  const p = parsed.data;
  const base = { clientUuid: r.clientUuid, tenantId, recordedBy: userId, capturedAt: r.capturedAt };
  const lotId = p.productLotId ?? p.lotId ?? undefined;
  const qty = p.quantity ?? p.dose ?? 1;
  let lot: { q: number; withdrawalDays: number | null } | undefined;
  if (lotId) {
    [lot] = await tx.select({ q: inventoryLots.qtyOnHand, withdrawalDays: inventoryLots.withdrawalDays })
      .from(inventoryLots)
      .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.id, lotId))).for('update').limit(1);
  }
  const inserted = await tx.insert(healthRecords).values({
    ...base, batchId: p.batchId, type: p.type,
    productLotId: lotId ?? null, quantity: qty, withdrawalDays: lot?.withdrawalDays ?? null,
    route: p.route ?? null, notes: p.notes ?? null,
  }).onConflictDoNothing({ target: healthRecords.clientUuid }).returning({ id: healthRecords.clientUuid });
  if (inserted.length && lot && qty > 0) {
    await tx.update(inventoryLots).set({ qtyOnHand: Math.max(0, Math.round((lot.q - qty) * 1000) / 1000) })
      .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.id, lotId!)));
  }
  return { routed: true };
}

// ── Closing stock ───────────────────────────────────────────────────────────

export async function handleClosingStock(
  r: IncomingRecord, tenantId: string, userId: string, tx: DbClient,
): Promise<RouteResult> {
  const parsed = closingStockPayloadSchema.safeParse(r.payload ?? {});
  // Throw (not `return { routed: true }`) on a genuinely malformed payload —
  // the sync route's per-record db.transaction() catches this and puts the
  // record in the response's `rejected[]` array instead of silently reporting
  // it as accepted with nothing actually written. A record that fails Zod here
  // needs to be visible to the client so it can alert the worker / retry, not
  // disappear into a false "accepted" response.
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join('; ') || 'Invalid record payload.');
  }
  const p = parsed.data;
  await tx.insert(closingStockCounts).values({
    clientUuid: r.clientUuid, tenantId, itemId: p.itemId, closingQty: p.closingQty,
    recordedBy: userId, capturedAt: r.capturedAt,
  }).onConflictDoNothing({ target: closingStockCounts.clientUuid });
  return { routed: true };
}

// ── Weight sample ───────────────────────────────────────────────────────────

export async function handleWeightSample(
  r: IncomingRecord, tenantId: string, userId: string, tx: DbClient,
): Promise<RouteResult> {
  const parsed = weightSamplePayloadSchema.safeParse(r.payload ?? {});
  // Throw (not `return { routed: true }`) on a genuinely malformed payload —
  // the sync route's per-record db.transaction() catches this and puts the
  // record in the response's `rejected[]` array instead of silently reporting
  // it as accepted with nothing actually written. A record that fails Zod here
  // needs to be visible to the client so it can alert the worker / retry, not
  // disappear into a false "accepted" response.
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join('; ') || 'Invalid record payload.');
  }
  const p = parsed.data;
  const batchId = p.batchId;
  const avg = p.avgWeightKg;
  if (batchId && avg > 0) {
    const [prev] = await tx.select({ avg: weightSamples.avgWeightKg, at: weightSamples.capturedAt })
      .from(weightSamples).where(and(eq(weightSamples.tenantId, tenantId), eq(weightSamples.batchId, batchId)))
      .orderBy(desc(weightSamples.capturedAt)).limit(1);
    const ins = await tx.insert(weightSamples).values({
      clientUuid: r.clientUuid, tenantId, batchId,
      sampleSize: p.sampleSize ?? null, avgWeightKg: avg,
      recordedBy: userId, capturedAt: r.capturedAt,
    }).onConflictDoNothing({ target: weightSamples.clientUuid }).returning({ id: weightSamples.clientUuid });
    await tx.update(batches).set({ avgWeightKg: avg })
      .where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId)));
    if (ins.length && prev && avg < prev.avg * 0.97) {
      await raiseAlert(tenantId, {
        // batchId embedded (not just clientUuid) so the owner's alert list can
        // link straight to the batch instead of a generic page — see lib/alerts.ts.
        id: `auto:weightloss:${batchId}:${r.clientUuid}`, severity: 'warning', type: 'weight_loss',
        title: 'Weight loss', message: `${await batchName(tenantId, batchId, tx)}: avg weight fell ${prev.avg}→${avg} kg`,
      }, tx);
    }
  }
  return { routed: true };
}

// ── Physical count ──────────────────────────────────────────────────────────

export async function handlePhysicalCount(
  r: IncomingRecord, tenantId: string, userId: string, tx: DbClient,
): Promise<RouteResult> {
  const parsed = physicalCountPayloadSchema.safeParse(r.payload ?? {});
  // Throw (not `return { routed: true }`) on a genuinely malformed payload —
  // the sync route's per-record db.transaction() catches this and puts the
  // record in the response's `rejected[]` array instead of silently reporting
  // it as accepted with nothing actually written. A record that fails Zod here
  // needs to be visible to the client so it can alert the worker / retry, not
  // disappear into a false "accepted" response.
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join('; ') || 'Invalid record payload.');
  }
  const p = parsed.data;
  const batchId = p.batchId;
  if (!batchId) return { routed: true };
  const systemCount = Math.round(p.systemCount);
  const physical = Math.round(p.physicalCount);
  const variance = Number.isFinite(p.variance) ? Math.round(p.variance ?? 0) : physical - systemCount;
  const reason = p.reason ?? null;
  const ins = await tx.insert(physicalCounts).values({
    clientUuid: r.clientUuid, tenantId, batchId, unitId: p.unitId ?? null,
    systemCount, physicalCount: physical, variance, reason, notes: p.notes ?? null,
    reconciled: false, recordedBy: userId, capturedAt: r.capturedAt,
  }).onConflictDoNothing({ target: physicalCounts.clientUuid }).returning({ id: physicalCounts.clientUuid });
  if (ins.length && variance !== 0) {
    await raiseAlert(tenantId, {
      // batchId embedded so the alert list can link straight to the batch — see lib/alerts.ts.
      id: `auto:variance:${batchId}:${r.clientUuid}`, severity: variance < 0 ? 'critical' : 'warning', type: 'stock_variance',
      title: 'Stock variance',
      message: `${await batchName(tenantId, batchId, tx)}: counted ${physical} vs system ${systemCount} (${variance > 0 ? '+' : ''}${variance})${reason ? ` — ${reason}` : ''}`,
    }, tx);
  }
  return { routed: true };
}

// ── Morning round ───────────────────────────────────────────────────────────

export async function handleMorningRound(
  r: IncomingRecord, tenantId: string, userId: string, tx: DbClient, session: Session,
): Promise<RouteResult> {
  const parsed = morningRoundPayloadSchema.safeParse(r.payload ?? {});
  // Throw (not `return { routed: true }`) on a genuinely malformed payload —
  // the sync route's per-record db.transaction() catches this and puts the
  // record in the response's `rejected[]` array instead of silently reporting
  // it as accepted with nothing actually written. A record that fails Zod here
  // needs to be visible to the client so it can alert the worker / retry, not
  // disappear into a false "accepted" response.
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join('; ') || 'Invalid record payload.');
  }
  const p = parsed.data;
  for (const e of p.entries) {
    const batchId = e.batchId;
    const eggs = e.eggsCollected;
    if (batchId && eggs > 0) {
      // #203: the morning round's egg count is gated by its own dedicated
      // `eggs_collected` field key — distinct from the collect page's
      // per-product `collect_<product>` key, since this form has no product
      // picker at all (see the comment below).
      await assertWritable(session, ['eggs_collected']);
      // The morning-round form has no product picker (unlike the collect page)
      // — it just writes the literal `type: 'eggs'` below. Resolve the batch's
      // egg-collecting product the same way the 0039 backfill does for this
      // exact case: base_unit = 'piece' and a name containing "egg", so this
      // matches 'Eggs' (layers) and 'Eggs (duck)' (ducks) alike. Layers is the
      // one enterprise whose costing already works end-to-end (#23 sums by
      // productId) — leaving this NULL would silently drop every morning-round
      // egg total once that lands. No match (custom/renamed product) falls
      // back to NULL rather than throwing, same defensive posture as
      // handleProduction.
      const [eggProduct] = await tx.select({ id: products.id, baseUnit: products.baseUnit })
        .from(products)
        .where(and(eq(products.tenantId, tenantId), eq(products.batchId, batchId),
          eq(products.baseUnit, 'piece'), ilike(products.name, '%egg%')))
        .limit(1);
      // #24: an explicit 'morning_round' slot — one per batch per day — rather
      // than the old `${r.clientUuid}:${batchId}:eggs` client_uuid, which
      // changes on every resubmission (the morning-round page mints a fresh
      // top-level clientUuid each submit — app/worker/record/morning-round/page.tsx),
      // so a corrected resubmission used to land as a brand-new duplicate row
      // instead of updating the day's total. This is the one case the old
      // dedupe intent was right about: a resubmitted morning round should
      // UPDATE the existing row in place, not create another one.
      await upsertProductionSlot(tx, tenantId, batchId, 'eggs', r.capturedAt.slice(0, 10), {
        clientUuid: `${r.clientUuid}:${batchId}:eggs`, tenantId, batchId,
        type: 'eggs', qty: eggs, weightKg: null,
        productId: eggProduct?.id ?? null, baseUnit: eggProduct?.baseUnit ?? null,
        recordedBy: userId, capturedAt: r.capturedAt,
      }, 'morning_round');
    }
    const feedItemId = e.feedItemId;
    const feedUsed = e.feedUsed;
    if (batchId && feedItemId && feedUsed > 0) {
      // #203: same feed_quantity gate as the standalone feeding form —
      // morning round's feed-used field writes to the same feedingRecords table.
      await assertWritable(session, ['feed_quantity']);
      const ins = await tx.insert(feedingRecords).values({
        clientUuid: `${r.clientUuid}:${batchId}:feed`, tenantId, batchId,
        feedItemId, quantityKg: feedUsed, recordedBy: userId, capturedAt: r.capturedAt,
      }).onConflictDoNothing({ target: feedingRecords.clientUuid }).returning({ id: feedingRecords.clientUuid });
      if (ins.length) await consumeFeedFIFO(tenantId, feedItemId, feedUsed, tx);
    }
    if (batchId) {
      const abnormal = e.abnormal === true;
      // #203: water_level gates the water-quality observation itself
      // (required on every entry); abnormal gates only an actual abnormality
      // report, not the routine "no" answer, since only "yes" writes anything
      // a hidden/read-only profile would need to be blocked from recording.
      const gatedKeys = abnormal ? ['water_level', 'abnormal'] : ['water_level'];
      await assertWritable(session, gatedKeys);
      const obs = await tx.insert(observations).values({
        clientUuid: `${r.clientUuid}:${batchId}:obs`, tenantId, batchId, unitId: e.unitId ?? null,
        waterLevel: e.waterLevel ?? null, waterColour: e.waterColour ?? null,
        tempC: e.tempC ?? null, doMgL: e.doMgL ?? null, ph: e.ph ?? null, ammonia: e.ammonia ?? null,
        abnormal, abnormalNote: e.abnormalNote ?? null, recordedBy: userId, capturedAt: r.capturedAt,
      }).onConflictDoNothing({ target: observations.clientUuid }).returning({ id: observations.clientUuid });
      if (obs.length && abnormal) {
        await raiseAlert(tenantId, {
          id: `auto:abnormal:${r.clientUuid}:${batchId}`, severity: 'warning', type: 'abnormal',
          title: 'Abnormality reported',
          message: `${await batchName(tenantId, batchId, tx)}: ${e.abnormalNote || 'worker flagged an abnormality'}`,
        }, tx);
      }
    }
  }
  return { routed: true };
}

// ── Router ──────────────────────────────────────────────────────────────────

// Handlers that don't touch any permission-gated field (health, closing
// stock, weight sample, physical count) simply ignore the trailing `session`
// argument — a function with fewer declared parameters is assignable here,
// TypeScript still passes `session` through at the call site below.
const TYPE_HANDLERS: Record<string, (r: IncomingRecord, t: string, u: string, tx: DbClient, session: Session) => Promise<RouteResult>> = {
  feeding: handleFeeding,
  mortality: handleMortality,
  health: handleHealth,
  vaccination: handleHealth,
  closing_stock: handleClosingStock,
  production: handleProduction,
  eggs: handleProduction,
  weight_sample: handleWeightSample,
  physical_count: handlePhysicalCount,
  morning_round: handleMorningRound,
};

export async function routeTyped(
  r: IncomingRecord, tenantId: string, userId: string, tx: DbClient, session: Session,
): Promise<RouteResult> {
  const handler = TYPE_HANDLERS[r.type];
  if (handler) return handler(r, tenantId, userId, tx, session);
  return { routed: false };
}
