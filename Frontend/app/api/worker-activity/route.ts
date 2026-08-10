import { db } from '@/db';
import { mortalityRecords, healthRecords, feedingRecords, productionRecords, closingStockCounts, photos, users, batches, inventoryItems, physicalCounts, weightSamples, observations } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import type { Session } from '@/lib/server/session';
import { ok, forbidden } from '@/lib/server/http';
import { withFeature } from '@/lib/server/entitlements';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// GET /api/worker-activity[?workerId=&cursor=&limit=] — every field record, by worker,
// for the farm. Paginated with cursor-based pagination for stable scrolling.
// Cursor is the `capturedAt` ISO timestamp of the last item on the previous page.
// #29: gated behind the `activity_log` feature (the farm-wide Worker Activity
// Log page — /owner/activity in app/owner/layout.tsx's nav).
async function getHandler(req: Request, session: Session) {
  if (!ALLOWED.includes(session.role)) return forbidden();
  const tid = session.tenantId;
  const url = new URL(req.url);
  const workerId = url.searchParams.get('workerId');
  const cursor = url.searchParams.get('cursor'); // ISO timestamp for pagination
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));

  const [morts, healths, feeds, prods, closes, counts, weights, obs, us, bs, items, phs] = await Promise.all([
    db.select().from(mortalityRecords).where(eq(mortalityRecords.tenantId, tid)),
    db.select().from(healthRecords).where(eq(healthRecords.tenantId, tid)),
    db.select().from(feedingRecords).where(eq(feedingRecords.tenantId, tid)),
    db.select().from(productionRecords).where(eq(productionRecords.tenantId, tid)),
    db.select().from(closingStockCounts).where(eq(closingStockCounts.tenantId, tid)),
    db.select().from(physicalCounts).where(eq(physicalCounts.tenantId, tid)),
    db.select().from(weightSamples).where(eq(weightSamples.tenantId, tid)),
    db.select().from(observations).where(eq(observations.tenantId, tid)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.tenantId, tid)),
    db.select({ id: batches.id, name: batches.name }).from(batches).where(eq(batches.tenantId, tid)),
    db.select({ id: inventoryItems.id, name: inventoryItems.name }).from(inventoryItems).where(eq(inventoryItems.tenantId, tid)),
    db.select({ id: photos.id, gpsLat: photos.gpsLat, gpsLng: photos.gpsLng }).from(photos).where(eq(photos.tenantId, tid)),
  ]);
  const wname = (id: string | null) => us.find((u) => u.id === id)?.name ?? '—';
  const bname = (id: string | null) => bs.find((b) => b.id === id)?.name ?? '—';
  const iname = (id: string | null) => items.find((i) => i.id === id)?.name ?? '—';
  const gps = (pid: string | null) => phs.find((p) => p.id === pid);

  type Row = { kind: string; at: string; by: string; byId: string | null; batch: string; text: string; photoId: string | null; gpsLat: number | null; gpsLng: number | null };
  let rows: Row[] = [
    ...morts.map((m): Row => { const g = gps(m.photoId); return { kind: 'mortality', at: m.capturedAt, by: wname(m.recordedBy), byId: m.recordedBy, batch: bname(m.batchId), text: `${m.count} death${m.count !== 1 ? 's' : ''}${m.cause ? ` · ${m.cause}` : ''}`, photoId: m.photoId, gpsLat: g?.gpsLat ?? null, gpsLng: g?.gpsLng ?? null }; }),
    ...healths.map((h): Row => ({ kind: 'health', at: h.capturedAt, by: wname(h.recordedBy), byId: h.recordedBy, batch: bname(h.batchId), text: `${h.type} applied`, photoId: null, gpsLat: null, gpsLng: null })),
    ...feeds.map((f): Row => ({ kind: 'feeding', at: f.capturedAt, by: wname(f.recordedBy), byId: f.recordedBy, batch: bname(f.batchId), text: `${f.quantityKg} kg fed`, photoId: null, gpsLat: null, gpsLng: null })),
    ...prods.map((p): Row => ({ kind: 'collection', at: p.capturedAt, by: wname(p.recordedBy), byId: p.recordedBy, batch: bname(p.batchId), text: `${p.qty} ${p.type} collected`, photoId: null, gpsLat: null, gpsLng: null })),
    ...closes.map((c): Row => ({ kind: 'stock count', at: c.capturedAt, by: wname(c.recordedBy), byId: c.recordedBy, batch: iname(c.itemId), text: `counted ${c.closingQty}`, photoId: null, gpsLat: null, gpsLng: null })),
    ...counts.map((c): Row => ({ kind: 'head count', at: c.capturedAt, by: wname(c.recordedBy), byId: c.recordedBy, batch: bname(c.batchId), text: `counted ${c.physicalCount} (system ${c.systemCount}, variance ${c.variance > 0 ? '+' : ''}${c.variance})${c.reason ? ` · ${c.reason}` : ''}${c.reconciled ? '' : ' · pending'}`, photoId: null, gpsLat: null, gpsLng: null })),
    ...weights.map((w): Row => ({ kind: 'weight sample', at: w.capturedAt, by: wname(w.recordedBy), byId: w.recordedBy, batch: bname(w.batchId), text: `avg ${w.avgWeightKg} kg${w.sampleSize ? ` (n=${w.sampleSize})` : ''}`, photoId: null, gpsLat: null, gpsLng: null })),
    ...obs.filter((o) => o.abnormal || o.waterLevel === 'LOW' || o.waterColour === 'MURKY').map((o): Row => ({ kind: 'observation', at: o.capturedAt, by: wname(o.recordedBy), byId: o.recordedBy, batch: bname(o.batchId), text: `${o.abnormal ? `▲ ${o.abnormalNote || 'abnormal'}` : ''}${o.waterLevel === 'LOW' ? ' · water LOW' : ''}${o.waterColour === 'MURKY' ? ' · water murky' : ''}`.replace(/^ · /, '').trim(), photoId: null, gpsLat: null, gpsLng: null })),
  ];
  // Filter by worker and/or cursor
  if (workerId) rows = rows.filter((r) => r.byId === workerId);
  if (cursor) rows = rows.filter((r) => r.at < cursor);
  rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  const page = rows.slice(0, limit);
  const nextCursor = page.length === limit ? page[page.length - 1].at : null;
  return ok({ data: page, nextCursor });
}

export const GET = withFeature('GET /api/worker-activity', getHandler);
