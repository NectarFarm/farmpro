import 'server-only';
import { db } from '@/db';
import { farms } from '@/db/schemas';
import { eq, asc } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, created, unauthorized, forbidden, tooMany } from '@/lib/server/http';
import { checkReadRateLimit, checkWriteRateLimit } from '@/lib/server/rateLimit';
import { parseBody, farmCreateSchema } from '@/lib/server/validate';
import { farmCodeFromName } from '@/lib/server/farms';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// GET /api/farms — a tenant's farms, oldest first. Owner/manager scoped: workers
// and below have no farm-management surface (issue #219).
export async function GET(req: Request) {
  const readLimit = checkReadRateLimit(req);
  if (!readLimit.allowed) return tooMany('Too many requests.', readLimit.retryAfter);
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const rows = await db.select().from(farms).where(eq(farms.tenantId, session.tenantId)).orderBy(asc(farms.createdAt));
  return ok(rows);
}

// POST /api/farms — create a farm under the caller's tenant (owner/manager).
export async function POST(req: Request) {
  const writeLimit = checkWriteRateLimit(req);
  if (!writeLimit.allowed) return tooMany('Too many requests.', writeLimit.retryAfter);
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();

  const parsed = await parseBody(req, farmCreateSchema);
  if ('error' in parsed) return parsed.error;
  const b = parsed.data;

  const id = crypto.randomUUID();
  let code = b.code ?? farmCodeFromName(b.name);
  // Farm codes are a tenant's human-facing labels — keep them unique per tenant
  // by suffixing the derived default when the name collides with an existing farm.
  const taken = new Set(
    (await db.select({ code: farms.code }).from(farms).where(eq(farms.tenantId, session.tenantId))).map(r => r.code)
  );
  if (taken.has(code)) code = `${code}-${id.slice(0, 4).toUpperCase()}`;

  await db.insert(farms).values({
    id, tenantId: session.tenantId, name: b.name, location: b.location, code,
  });
  return created({ id, code });
}
