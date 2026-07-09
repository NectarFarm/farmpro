import { db } from '@/db';
import { tenants, testRuns, testPhotos } from '@/db/schemas';
import { and, eq, inArray } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, created, badRequest, unauthorized, forbidden } from '@/lib/server/http';
import { parseBody, testingActionSchema } from '@/lib/server/validate';
import { isStorageConfigured, uploadPhoto } from '@/lib/server/storage';
import { decodeDataUrl, validatePhotoDataUrl } from '@/lib/server/media';
import { freshRun, applyStepUpdate, addPhotoToStep, canSubmit, summarize, type TestStep, type StepStatus } from '@/lib/testing';
import { getActiveSteps } from '@/lib/server/testingConfig';
import { readRateLimited, writeRateLimited } from '@/lib/server/rateLimit';

const ALLOWED = ['owner', 'manager'];

async function tenantTesting(tenantId: string) {
  const [t] = await db.select({ e: tenants.testingEnabled, max: tenants.testMaxScreenshots }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return { enabled: !!t?.e, maxScreenshots: t?.max ?? 0 };
}
async function loadRun(tenantId: string) {
  const [r] = await db.select().from(testRuns).where(eq(testRuns.tenantId, tenantId)).limit(1);
  return r ?? null;
}
async function deletePhotos(tenantId: string, ids: string[]) {
  if (ids.length) await db.delete(testPhotos).where(and(eq(testPhotos.tenantId, tenantId), inArray(testPhotos.id, ids)));
}

// GET /api/testing — the farmer's current run (or { enabled:false } when off).
export async function GET(req: Request) {
  const limited = readRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const { enabled, maxScreenshots } = await tenantTesting(session.tenantId);
  const run = enabled ? await loadRun(session.tenantId) : null;
  return ok({ enabled, maxScreenshots, run });
}

// POST /api/testing  { action: 'start' | 'step' | 'photo' | 'submit', ... }
export async function POST(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const { enabled, maxScreenshots } = await tenantTesting(session.tenantId);
  if (!enabled) return forbidden('Testing is not enabled for your farm.');

  const parsed = await parseBody(req, testingActionSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  const now = new Date().toISOString();
  const tenantId = session.tenantId;

  if (body.action === 'start') {
    // Start OR restart — clean checklist; drop any screenshots from the old run.
    const old = await loadRun(tenantId);
    if (old) await deletePhotos(tenantId, (old.steps as TestStep[]).flatMap((s) => s.photoIds ?? []));
    const steps = freshRun(await getActiveSteps());
    await db.insert(testRuns).values({ tenantId, status: 'in_progress', steps, startedAt: now, submittedAt: null })
      .onConflictDoUpdate({ target: testRuns.tenantId, set: { status: 'in_progress', steps, startedAt: now, submittedAt: null } });
    return created({ run: { tenantId, status: 'in_progress', steps, startedAt: now, submittedAt: null } });
  }

  const run = await loadRun(tenantId);
  if (!run) return badRequest('No test in progress. Start one first.');
  const steps0 = run.steps as TestStep[];

  if (body.action === 'step') {
    if (run.status === 'submitted') return badRequest('This test was already submitted. Restart to test again.');
    if (!body.id || !body.status) return badRequest('id and status required');
    let steps: TestStep[];
    try {
      steps = applyStepUpdate(steps0, { id: body.id, status: body.status, note: body.note });
    } catch (e) {
      return badRequest((e as Error).message);
    }
    // A step that left 'fail' loses its screenshots — delete the orphaned images.
    const before = steps0.find((s) => s.id === body.id)?.photoIds ?? [];
    const after = steps.find((s) => s.id === body.id)?.photoIds ?? [];
    await deletePhotos(tenantId, before.filter((p) => !after.includes(p)));
    await db.update(testRuns).set({ steps }).where(eq(testRuns.tenantId, tenantId));
    return ok({ run: { ...run, steps } });
  }

  if (body.action === 'photo') {
    if (run.status === 'submitted') return badRequest('This test was already submitted.');
    if (maxScreenshots <= 0) return forbidden('Screenshots are not enabled for this test.');
    if (!body.stepId) return badRequest('A step and an image are required.');
    const stepId = body.stepId;
    const validation = validatePhotoDataUrl(body.data);
    if (!validation.ok) return badRequest(validation.error);
    const data = body.data as string;
    const photoId = crypto.randomUUID();
    let steps: TestStep[];
    try {
      steps = addPhotoToStep(steps0, stepId, photoId, maxScreenshots);
    } catch (e) {
      return badRequest((e as Error).message);
    }
    // Upload screenshot to R2 if configured; otherwise store as base64 in DB.
    if (isStorageConfigured()) {
      const decoded = decodeDataUrl(data);
      if (decoded) {
        const storageKey = `${tenantId}/test/${photoId}.${decoded.mime.split('/')[1] ?? 'png'}`;
        await uploadPhoto(storageKey, decoded.bytes, decoded.mime);
        await db.insert(testPhotos).values({
          id: photoId, tenantId, stepId, storageKey, mime: decoded.mime, createdAt: now,
        });
      } else {
        // Fallback — store as-is if we can't parse the data URL.
        await db.insert(testPhotos).values({ id: photoId, tenantId, stepId, data, createdAt: now });
      }
    } else {
      await db.insert(testPhotos).values({ id: photoId, tenantId, stepId, data, createdAt: now });
    }
    await db.update(testRuns).set({ steps }).where(eq(testRuns.tenantId, tenantId));
    return created({ run: { ...run, steps }, photoId });
  }

  if (body.action === 'submit') {
    if (!canSubmit(steps0)) return badRequest('Answer every step (Works / Failed) before submitting.');
    await db.update(testRuns).set({ status: 'submitted', submittedAt: now }).where(eq(testRuns.tenantId, tenantId));
    return ok({ run: { ...run, status: 'submitted', submittedAt: now }, report: summarize(steps0) });
  }

  return badRequest('Unknown action.');
}
