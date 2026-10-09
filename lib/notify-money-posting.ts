// Called after the document transaction commits. A notification for a row
// that then rolls back would say an approval exists when it does not.
import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { approvalRequests } from '@/db/schemas'
import { notifyApprovalRaised } from '@/lib/governance'

export async function notifyMoneyPostings(tenantId: string, entityIds: string[]) {
  if (entityIds.length === 0) return
  const rows = await db.select().from(approvalRequests).where(and(
    eq(approvalRequests.tenantId, tenantId),
    eq(approvalRequests.type, 'money_posting'),
    eq(approvalRequests.status, 'pending'),
    inArray(approvalRequests.entityId, entityIds),
  ))
  for (const row of rows) await notifyApprovalRaised(row)
}
