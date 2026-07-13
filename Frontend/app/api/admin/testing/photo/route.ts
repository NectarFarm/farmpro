import { db } from '@/db';
import { testPhotos, testRuns } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, badRequest, unauthorized, forbidden, notFound } from '@/lib/server/http';
import { readRateLimited, writeRateLimited } from '@/lib/server/rateLimit';
import { isStorageConfigured, getPhotoUrl } from '@/lib/server/storage';
import type { TestStep } from '@/lib/testing';

// GET /api/admin/testing/photo?id=… — the screenshot's data URL (super-admin only).
// When R2 is configured, resolves a signed URL for storage-backed photos; otherwise
// falls back to the base64 data URL stored in Postgres.
export async function GET(req: Request) {
  const limited = readRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  const [p] = await db.select({ data: testPhotos.data, storageKey: testPhotos.storageKey }).from(testPhotos).where(eq(testPhotos.id, id)).limit(1);
  if (!p) return notFound();
  if (isStorageConfigured() && p.storageKey) {
    const url = await getPhotoUrl(p.storageKey, 3600);
    if (url) return ok({ data: url });
  }
  return ok({ data: p.data });
}

// DELETE /api/admin/testing/photo?id=… — remove a screenshot after viewing, and
// unlink it from the run's step so the report no longer references it.
export async function DELETE(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');

  const [p] = await db.select().from(testPhotos).where(eq(testPhotos.id, id)).limit(1);
  if (!p) return ok({ id, deleted: true }); // already gone — idempotent

  // Unlink from the owning tenant's run.
  const [run] = await db.select().from(testRuns).where(eq(testRuns.tenantId, p.tenantId)).limit(1);
  if (run) {
    const steps = ((Array.isArray(run.steps) ? run.steps : []) as TestStep[]).map((s) =>
      (s.photoIds ?? []).includes(id) ? { ...s, photoIds: (s.photoIds ?? []).filter((x) => x !== id) } : s);
    await db.update(testRuns).set({ steps }).where(eq(testRuns.tenantId, p.tenantId));
  }
  await db.delete(testPhotos).where(eq(testPhotos.id, id));
  return ok({ id, deleted: true });
}
