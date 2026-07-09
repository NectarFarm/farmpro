import { db } from '@/db';
import { tenants, users, batches } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, unauthorized, forbidden } from '@/lib/server/http';

// GET /api/admin/stats — platform-level KPIs for the admin dashboard.
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();

  const [ts, us, bs] = await Promise.all([
    db.select().from(tenants),
    db.select({ id: users.id, tenantId: users.tenantId, role: users.role }).from(users),
    db.select({ id: batches.id, tenantId: batches.tenantId }).from(batches),
  ]);

  const activeFarms = ts.filter((t) => t.active).length;
  const suspendedFarms = ts.filter((t) => !t.active).length;
  const totalUsers = us.length;
  const totalWorkers = us.filter((u) => u.role === 'worker').length;
  const totalBatchesAll = bs.length;
  const staffUsers = us.filter((u) => ['manager', 'vet'].includes(u.role)).length;
  const ownerUsers = us.filter((u) => u.role === 'owner').length;

  return ok({
    totalFarms: ts.length,
    activeFarms,
    suspendedFarms,
    totalUsers,
    totalWorkers,
    staffUsers,
    ownerUsers,
    totalBatchesAll,
  });
}
