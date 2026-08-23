import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { batches } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'
import { movementsForBatch } from '@/lib/batch-ledger'

// ── GET /api/batches/[id]/movements (batch-ledger task) ────────────────────
// Why this batch's count is what it is: every death, sale, count correction
// and manual edit, newest first, each carrying the running total it left
// behind. The batch card shows a number; this is the answer to "where did the
// other forty birds go", which the app could not previously give at all.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireTenantSession({ explicitTenantId: new URL(req.url).searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  // Checked rather than assumed: an id from another tenant must 404, not
  // return an empty ledger that reads as "nothing ever happened".
  const [batch] = await db
    .select({ id: batches.id })
    .from(batches)
    .where(and(eq(batches.id, id), eq(batches.tenantId, tenantId)))
    .limit(1)
  if (!batch) return NextResponse.json({ success: false, error: 'Batch not found' }, { status: 404 })

  const rows = await movementsForBatch(tenantId, id)
  return NextResponse.json({ success: true, data: rows }, { status: 200 })
}
