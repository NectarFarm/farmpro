import { db } from '@/db';
import { errorLogs } from '@/db/schemas';
import { desc } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, unauthorized, forbidden } from '@/lib/server/http';

// GET /api/admin/errors — platform-wide client error feed. super_admin-only;
// route-only this pass, no dedicated UI page yet. Most-recent-first, capped
// at 200 rows — not paginated, just enough for a quick health scan.
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();

  const rows = await db.select().from(errorLogs).orderBy(desc(errorLogs.createdAt)).limit(200);
  return ok({ errors: rows });
}
