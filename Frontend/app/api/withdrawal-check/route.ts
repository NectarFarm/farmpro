import { db } from '@/db';
import { batches } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { checkWithdrawal } from '@/lib/server/inventory';
import { ok, badRequest, unauthorized, forbidden, notFound } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

// GET /api/withdrawal-check?batchId= — read-only view of checkWithdrawal() (see
// lib/server/inventory.ts), which is also what actually enforces the block on
// sale creation. This route is for the UI banner only.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const batchId = new URL(req.url).searchParams.get('batchId');
  if (!batchId) return badRequest('batchId required');

  const [batch] = await db.select({ id: batches.id }).from(batches)
    .where(and(eq(batches.tenantId, session.tenantId), eq(batches.id, batchId))).limit(1);
  if (!batch) return notFound();

  return ok(await checkWithdrawal(session.tenantId, batchId));
}
