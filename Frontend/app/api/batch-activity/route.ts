import { db } from '@/db';
import { mortalityRecords, healthRecords, feedingRecords, productionRecords, photos, users, physicalCounts, weightSamples, observations } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, unauthorized, forbidden, badRequest } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager', 'vet', 'auditor'];
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// GET /api/batch-activity?batchId=...&cursor=&limit= — paginated worker records for
// a batch (with photos). Cursor-based: pass the `at` of the last item for the next page.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const url = new URL(req.url);
  const batchId = url.searchParams.get('batchId');
  if (!batchId) return badRequest('batchId required');
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));
  const tid = session.tenantId;

  const [morts, healths, feeds, prods, counts, weights, obs, us, phs] = await Promise.all([
    db.select().from(mortalityRecords).where(and(eq(mortalityRecords.tenantId, tid), eq(mortalityRecords.batchId, batchId))),
    db.select().from(healthRecords).where(and(eq(healthRecords.tenantId, tid), eq(healthRecords.batchId, batchId))),
    db.select().from(feedingRecords).where(and(eq(feedingRecords.tenantId, tid), eq(feedingRecords.batchId, batchId))),
    db.select().from(productionRecords).where(and(eq(productionRecords.tenantId, tid), eq(productionRecords.batchId, batchId))),
    db.select().from(physicalCounts).where(and(eq(physicalCounts.tenantId, tid), eq(physicalCounts.batchId, batchId))),
    db.select().from(weightSamples).where(and(eq(weightSamples.tenantId, tid), eq(weightSamples.batchId, batchId))),
    db.select().from(observations).where(and(eq(observations.tenantId, tid), eq(observations.batchId, batchId))),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.tenantId, tid)),
    db.select({ id: photos.id, gpsLat: photos.gpsLat, gpsLng: photos.gpsLng }).from(photos).where(eq(photos.tenantId, tid)),
  ]);
  const name = (id: string | null) => us.find((u) => u.id === id)?.name ?? '—';
  const gps = (pid: string | null) => phs.find((p) => p.id === pid);

  const activity = [
    ...morts.map((m) => {
      const g = gps(m.photoId);
      return { kind: 'mortality', at: m.capturedAt, by: name(m.recordedBy), text: `${m.count} death${m.count !== 1 ? 's' : ''}${m.cause ? ` · ${m.cause}` : ''}`, photoId: m.photoId, gpsLat: g?.gpsLat ?? null, gpsLng: g?.gpsLng ?? null };
    }),
    ...healths.map((h) => ({ kind: 'health', at: h.capturedAt, by: name(h.recordedBy), text: `${h.type} applied`, photoId: null, gpsLat: null, gpsLng: null })),
    ...feeds.map((f) => ({ kind: 'feeding', at: f.capturedAt, by: name(f.recordedBy), text: `${f.quantityKg} kg fed`, photoId: null, gpsLat: null, gpsLng: null })),
    ...prods.map((p) => ({ kind: 'production', at: p.capturedAt, by: name(p.recordedBy), text: `${p.qty} ${p.type} collected`, photoId: null, gpsLat: null, gpsLng: null })),
    ...counts.map((c) => ({ kind: 'head count', at: c.capturedAt, by: name(c.recordedBy), text: `counted ${c.physicalCount} (system ${c.systemCount}, variance ${c.variance > 0 ? '+' : ''}${c.variance})${c.reconciled ? '' : ' · pending'}`, photoId: null, gpsLat: null, gpsLng: null })),
    ...weights.map((w) => ({ kind: 'weight sample', at: w.capturedAt, by: name(w.recordedBy), text: `avg ${w.avgWeightKg} kg${w.sampleSize ? ` (n=${w.sampleSize})` : ''}`, photoId: null, gpsLat: null, gpsLng: null })),
    ...obs.filter((o) => o.abnormal).map((o) => ({ kind: 'observation', at: o.capturedAt, by: name(o.recordedBy), text: `▲ ${o.abnormalNote || 'abnormal'}`, photoId: null, gpsLat: null, gpsLng: null })),
  ]
    .filter((a) => !cursor || a.at < cursor)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);

  const nextCursor = activity.length === limit ? activity[activity.length - 1].at : null;
  return ok({ data: activity, nextCursor });
}
