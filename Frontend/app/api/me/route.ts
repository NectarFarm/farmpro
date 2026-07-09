import { db } from '@/db';
import { tenants } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, unauthorized } from '@/lib/server/http';
import { ALL_FEATURE_KEYS } from '@/lib/features';
import { z } from 'zod';

// GET /api/me — current user + the tenant's enabled features (for client gating).
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  return ok({
    userId: session.userId, role: session.role, tenantId: session.tenantId, name: session.name,
    plan: tenant?.plan ?? 'pro',
    features: z.array(z.string()).catch(ALL_FEATURE_KEYS).parse(tenant?.features),
    exp: session.exp,
  });
}
