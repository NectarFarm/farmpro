import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { postingPolicies } from '@/db/schemas'
import { isPolicyEffect, isPolicyKind, type PostingPolicy } from '@/lib/posting-policy'

export async function loadPostingPolicies(tenantId: string): Promise<PostingPolicy[]> {
  const rows = await db.select().from(postingPolicies).where(eq(postingPolicies.tenantId, tenantId))
  const out: PostingPolicy[] = []
  for (const row of rows) {
    if (!isPolicyKind(row.kind) || !isPolicyEffect(row.effect)) continue
    out.push({
      kind: row.kind,
      accountCode: row.accountCode,
      farmId: row.farmId,
      thresholdCents: row.thresholdCents,
      effect: row.effect,
    })
  }
  return out
}
