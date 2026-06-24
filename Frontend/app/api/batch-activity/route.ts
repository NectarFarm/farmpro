import { db } from '@/db';
import { mortalityRecords, healthRecords, feedingRecords, productionRecords, photos, users } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, unauthorized, forbidden, badRequest } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager', 'vet', 'auditor'];

// GET /api/batch-activity?batchId=... — recent worker records for a batch (with photos).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const batchId = new URL(req.url).searchParams.get('batchId');
  if (!batchId) return badRequest('batchId required');
  const tid = session.tenantId;

  const [morts, healths, feeds, prods, us, phs] = await Promise.all([
    db.select().from(mortalityRecords).where(and(eq(mortalityRecords.tenantId, tid), eq(mortalityRecords.batchId, batchId))),
    db.select().from(healthRecords).where(and(eq(healthRecords.tenantId, tid), eq(healthRecords.batchId, batchId))),
    db.select().from(feedingRecords).where(and(eq(feedingRecords.tenantId, tid), eq(feedingRecords.batchId, batchId))),
    db.select().from(productionRecords).where(and(eq(productionRecords.tenantId, tid), eq(productionRecords.batchId, batchId))),
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
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 50);

  return ok(activity);
}
