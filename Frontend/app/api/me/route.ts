import { db } from '@/db';
import { tenants, farms } from '@/db/schemas';
import { eq, asc } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, unauthorized } from '@/lib/server/http';
import { ALL_FEATURE_KEYS } from '@/lib/features';
import { z } from 'zod';

// GET /api/me — current user + the tenant's enabled features (for client gating).
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  // The caller's farms — lets the mobile shell populate a real farm switcher (issue #219).
  const farmRows = await db.select({ id: farms.id, name: farms.name, location: farms.location, code: farms.code })
    .from(farms).where(eq(farms.tenantId, session.tenantId)).orderBy(asc(farms.createdAt));
  return ok({
    userId: session.userId, role: session.role, tenantId: session.tenantId, name: session.name,
    farmName: tenant?.name ?? '',
    farms: farmRows,
    plan: tenant?.plan ?? 'pro',
    features: z.array(z.string()).catch(ALL_FEATURE_KEYS).parse(tenant?.features),
    exp: session.exp,
  });
}
