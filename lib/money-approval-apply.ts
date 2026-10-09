// Applies a money_posting decision inside decideApproval's transaction.
// Approving posts the journal on the document's own posting date and, for a
// purchase, creates the lots that were withheld. Rejecting writes nothing
// to the ledger. Imported by lib/governance.ts only.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import { expenses, inventoryLots, purchases, sales } from '@/db/schemas'
import { applyMovement, BatchLedgerError } from '@/lib/batch-ledger'
import { DimensionRequirementError, DimensionValidationError } from '@/lib/dimensions'
import { postExpenseJournal, postPurchaseJournal, postSaleJournal, UnbalancedTaxError } from '@/lib/finance'
import { parseMoneyDetails } from '@/lib/posting-policy'

type Tx = PgTransaction<any, any, any>

export class MoneyApprovalError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'MoneyApprovalError'
  }
}

function asApprovalError(err: unknown): never {
  if (
    err instanceof UnbalancedTaxError
    || err instanceof DimensionRequirementError
    || err instanceof DimensionValidationError
    || err instanceof BatchLedgerError
  ) {
    throw new MoneyApprovalError(err.message, 400)
  }
  throw err
}

export async function applyMoneyDecision(tx: Tx, input: {
  tenantId: string
  entityId: string
  details: string
  decision: 'approved' | 'rejected'
}) {
  const parsed = parseMoneyDetails(input.details)
  if (!parsed || parsed.documentId !== input.entityId) {
    throw new MoneyApprovalError('The proposal could not be read.', 400)
  }
  const dimensions = parsed.dimensions ?? undefined

  if (parsed.docType === 'sale') {
    const [sale] = await tx.update(sales).set({
      approvalStatus: input.decision === 'approved' ? 'approved' : 'rejected',
    }).where(and(
      eq(sales.id, input.entityId),
      eq(sales.tenantId, input.tenantId),
      eq(sales.approvalStatus, 'pending'),
    )).returning()
    if (!sale) throw new MoneyApprovalError('This sale is not waiting for approval.', 409)
    if (input.decision === 'rejected') return
    try {
      await postSaleJournal(tx, sale, { dimensions })
      if (parsed.stockEffect === 'batch_quantity' && sale.batchId && sale.qty && sale.qty > 0) {
        await applyMovement(tx, {
          tenantId: input.tenantId,
          batchId: sale.batchId,
          type: 'sale',
          qtyDelta: -Math.trunc(sale.qty),
          reason: `Sold: ${sale.item}`,
          sourceType: 'sale',
          sourceId: sale.id,
          actor: '',
        })
      }
    } catch (err) {
      asApprovalError(err)
    }
    return
  }

  if (parsed.docType === 'purchase') {
    const [purchase] = await tx.update(purchases).set({
      approvalStatus: input.decision === 'approved' ? 'approved' : 'rejected',
    }).where(and(
      eq(purchases.id, input.entityId),
      eq(purchases.tenantId, input.tenantId),
      eq(purchases.approvalStatus, 'pending'),
    )).returning()
    if (!purchase) throw new MoneyApprovalError('This purchase is not waiting for approval.', 409)
    if (input.decision === 'rejected') return
    const specs = parsed.lots && parsed.lots.length > 0
      ? parsed.lots
      : [{ quantity: purchase.quantity, expiryDate: null, lotNo: null }]
    const lotQty = specs.reduce((sum, lot) => sum + lot.quantity, 0)
    if (lotQty !== purchase.quantity) {
      throw new MoneyApprovalError('Lot quantities must add up to the line quantity.', 400)
    }
    const receivedDate = purchase.receivedDate ?? purchase.createdAt
    for (const spec of specs) {
      const lotNo = spec.lotNo || `LOT-${receivedDate.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8).toUpperCase()}`
      await tx.insert(inventoryLots).values({
        id: randomUUID(),
        tenantId: purchase.tenantId,
        itemId: purchase.itemId,
        lotNo,
        qtyOnHand: spec.quantity,
        unitCostCents: purchase.unitCostCents,
        expiryDate: spec.expiryDate ? new Date(spec.expiryDate) : null,
        receivedDate,
        farmId: purchase.farmId,
      })
    }
    try {
      await postPurchaseJournal(tx, purchase, { dimensions })
    } catch (err) {
      asApprovalError(err)
    }
    return
  }

  const [expense] = await tx.update(expenses).set({
    approvalStatus: input.decision === 'approved' ? 'approved' : 'rejected',
  }).where(and(
    eq(expenses.id, input.entityId),
    eq(expenses.tenantId, input.tenantId),
    eq(expenses.approvalStatus, 'pending'),
  )).returning()
  if (!expense) throw new MoneyApprovalError('This expense is not waiting for approval.', 409)
  if (input.decision === 'rejected') return
  if (!parsed.accountCode) {
    throw new MoneyApprovalError('The expense account was not stored with this approval.', 400)
  }
  try {
    await postExpenseJournal(tx, {
      id: expense.id,
      tenantId: expense.tenantId,
      amountCents: expense.amountCents,
      amountPaidCents: expense.amountPaidCents,
      accountCode: parsed.accountCode,
      farmId: expense.farmId,
      postingDate: expense.postingDate,
      payee: expense.payee,
      taxCents: expense.taxCents,
      netCents: expense.netCents,
    }, { dimensions })
  } catch (err) {
    asApprovalError(err)
  }
}
