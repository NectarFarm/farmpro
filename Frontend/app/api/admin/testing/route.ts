import { db } from '@/db';
import { tenants, testRuns, testPhotos } from '@/db/schemas';
import { and, eq, inArray } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, badRequest, unauthorized, forbidden } from '@/lib/server/http';
import { freshRun, progress, summarize, normalizeSteps, type TestStep } from '@/lib/testing';
import { getActiveSteps, saveActiveSteps } from '@/lib/server/testingConfig';
import { readRateLimited, writeRateLimited } from '@/lib/server/rateLimit';

// GET /api/admin/testing — every farm's testing status + the latest report.
export async function GET(req: Request) {
  const limited = readRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();

  const ts = await db.select().from(tenants);
  const runs = await db.select().from(testRuns);
  const byTenant = new Map(runs.map((r) => [r.tenantId, r]));

  const list = ts.map((t) => {
    const run = byTenant.get(t.id);
    const steps = (run?.steps ?? []) as TestStep[];
    return {
      tenantId: t.id, name: t.name, testingEnabled: t.testingEnabled, maxScreenshots: t.testMaxScreenshots,
      run: run ? {
        status: run.status, startedAt: run.startedAt, submittedAt: run.submittedAt,
        progress: progress(steps), report: summarize(steps),
        results: steps.map((s) => ({ area: s.area, title: s.title, status: s.status, note: s.note ?? '', photos: (s.photoIds ?? []).length })),
      } : null,
    };
  });
  // The editable checklist new runs are built from.
  return ok({ tenants: list, steps: await getActiveSteps() });
}

// POST /api/admin/testing  { action: 'enable'|'disable'|'request' (+tenantId) | 'save-steps' (+steps) }
export async function POST(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();

  const body = (await req.json().catch(() => ({}))) as { tenantId?: string; action?: string; steps?: unknown[]; maxScreenshots?: number };
  // Clamp the per-step screenshot allowance to a sane 0–5.
  const clampMax = (n: unknown) => Math.max(0, Math.min(5, Math.floor(typeof n === 'number' ? n : 0)));

  if (body.action === 'save-steps') {
    try {
      const defs = normalizeSteps((body.steps ?? []) as Parameters<typeof normalizeSteps>[0]);
      await saveActiveSteps(defs);
      return ok({ steps: defs });
    } catch (e) {
      return badRequest((e as Error).message);
    }
  }

  if (!body.tenantId || !body.action) return badRequest('tenantId and action required');

  const [t] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, body.tenantId)).limit(1);
  if (!t) return badRequest('Unknown farm.');

  if (body.action === 'disable') {
    await db.update(tenants).set({ testingEnabled: false }).where(eq(tenants.id, body.tenantId));
    return ok({ tenantId: body.tenantId, testingEnabled: false });
  }
  if (body.action === 'enable') {
    // Admin specifies whether/how many screenshots the tester may attach.
    const max = clampMax(body.maxScreenshots);
    await db.update(tenants).set({ testingEnabled: true, testMaxScreenshots: max }).where(eq(tenants.id, body.tenantId));
    return ok({ tenantId: body.tenantId, testingEnabled: true, maxScreenshots: max });
  }
  if (body.action === 'request') {
    // Enable testing AND reset the checklist — "please test again after changes".
    const now = new Date().toISOString();
    const steps = freshRun(await getActiveSteps());
    const set: Record<string, unknown> = { testingEnabled: true };
    if (typeof body.maxScreenshots === 'number') set.testMaxScreenshots = clampMax(body.maxScreenshots);
    await db.update(tenants).set(set).where(eq(tenants.id, body.tenantId));
    // Drop screenshots from the previous run so they don't pile up.
    const [old] = await db.select({ steps: testRuns.steps }).from(testRuns).where(eq(testRuns.tenantId, body.tenantId)).limit(1);
    const oldPhotos = ((old?.steps ?? []) as TestStep[]).flatMap((s) => s.photoIds ?? []);
    if (oldPhotos.length) await db.delete(testPhotos).where(and(eq(testPhotos.tenantId, body.tenantId), inArray(testPhotos.id, oldPhotos)));
    await db.insert(testRuns).values({ tenantId: body.tenantId, status: 'in_progress', steps, startedAt: now, submittedAt: null })
      .onConflictDoUpdate({ target: testRuns.tenantId, set: { status: 'in_progress', steps, startedAt: now, submittedAt: null } });
    return ok({ tenantId: body.tenantId, testingEnabled: true, requested: true });
  }
  return badRequest('Unknown action.');
}
