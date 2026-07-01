import { db } from '@/db';
import { batches, lifecycleStages } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { enterpriseFromSpecies } from '@/lib/server/productTemplates';
import { ageDays, dueToAdvance } from '@/lib/lifecycle';
import { ok, unauthorized, forbidden } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager', 'vet', 'auditor'];

// GET /api/lifecycle-due — a compact per-active-batch stage summary for the Farm list
// badges: age + whether it's due to move to the next phase.
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();

  const [bs, stageRows] = await Promise.all([
    db.select().from(batches).where(eq(batches.tenantId, session.tenantId)),
    db.select().from(lifecycleStages).where(eq(lifecycleStages.tenantId, session.tenantId)),
  ]);
  const out = bs.filter((b) => b.status === 'ACTIVE').map((b) => {
    const ent = enterpriseFromSpecies(b.species);
    const set = ent ? stageRows.filter((s) => s.enterprise === ent).sort((a, c) => a.ord - c.ord).map((s) => ({ name: s.name, startDay: s.startDay })) : [];
    const age = ageDays(b.acquiredDate, b.ageAtAcquire ?? 0);
    const due = dueToAdvance(set, b.stage, age);
    return { batchId: b.id, age, due };
  });
  return ok(out);
}
