// Inserts a money-posting approval inside the document's own transaction.
// This file does not import lib/governance.ts: finance and inventory call it,
// and governance calls the applier, which calls the posters. That loop would
// be a cycle.
import 'server-only'
import { randomUUID } from 'node:crypto'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import { approvalRequests } from '@/db/schemas'
import type { MoneyDetails } from '@/lib/posting-policy'

type Tx = PgTransaction<any, any, any>

export async function insertMoneyApproval(tx: Tx, input: {
  tenantId: string
  requestedBy: string
  title: string
  details: MoneyDetails
}) {
  const [row] = await tx.insert(approvalRequests).values({
    id: randomUUID(),
    tenantId: input.tenantId,
    type: 'money_posting',
    title: input.title,
    requestedBy: input.requestedBy,
    entityId: input.details.documentId,
    details: JSON.stringify(input.details),
    status: 'pending',
    assignedApproverId: null,
  }).returning()
  return row
}
