import { getSession } from '@/lib/server/session';
import { getActivePackages, saveActivePackages } from '@/lib/server/packagesConfig';
import { normalizePackages } from '@/lib/packages';
import { FEATURES, ALL_FEATURE_KEYS } from '@/lib/features';
import { audit, actorLabel } from '@/lib/server/audit';
import { ok, badRequest, unauthorized, forbidden } from '@/lib/server/http';
import { readRateLimited, writeRateLimited } from '@/lib/server/rateLimit';

// GET /api/admin/packages — the editable packages + the feature catalogue.
export async function GET(req: Request) {
  const limited = readRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();
  return ok({ packages: await getActivePackages(), features: FEATURES });
}

// POST /api/admin/packages { packages } — replace the package set (super_admin).
export async function POST(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();
  const body = (await req.json().catch(() => ({}))) as { packages?: unknown[] };
  try {
    const packages = normalizePackages((body.packages ?? []) as Parameters<typeof normalizePackages>[0], ALL_FEATURE_KEYS);
    await saveActivePackages(packages);
    await audit({ tenantId: 'platform', actor: actorLabel(session), action: 'packages.update', meta: { count: packages.length } });
    return ok({ packages });
  } catch (e) {
    return badRequest((e as Error).message);
  }
}
