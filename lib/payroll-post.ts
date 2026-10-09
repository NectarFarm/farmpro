// Posts the journal for a run from the lines already stored on its payslips.
// The pay date is not the journal date: entryDate stays the run's period end.
import 'server-only'
import { eq, inArray } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import { payslipLines, payslips } from '@/db/schemas'
import { postPayrollJournal } from '@/lib/finance'
import { journalSplits } from '@/lib/payroll-calc'

type Tx = PgTransaction<any, any, any>

export async function postStoredPayroll(
  tx: Tx,
  run: {
    id: string
    tenantId: string
    totalAmountCents: number
    periodStart: Date
    periodEnd: Date
    sharedFarmId: string | null
  },
  dimensions?: Record<string, string>,
) {
  const slips = await tx.select({ id: payslips.id }).from(payslips).where(eq(payslips.runId, run.id))
  const slipIds = slips.map((slip) => slip.id)
  const own = slipIds.length === 0
    ? []
    : await tx.select().from(payslipLines).where(inArray(payslipLines.payslipId, slipIds))
  const splits = own.length > 0
    ? journalSplits(own)
    : {
      expenseCents: run.totalAmountCents,
      netCents: run.totalAmountCents,
      payeCents: 0,
      nssfCents: 0,
      shifCents: 0,
      advanceCents: 0,
    }
  // The P&L sums payroll_runs.total_amount_cents. The journal has to debit
  // that same figure, or the two reports would disagree.
  if (own.length > 0 && splits.expenseCents !== run.totalAmountCents) {
    throw new Error('Payroll journal does not balance')
  }
  await postPayrollJournal(tx, {
    id: run.id,
    tenantId: run.tenantId,
    totalAmountCents: run.totalAmountCents,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    farmId: run.sharedFarmId,
    netCents: own.length > 0 ? splits.netCents : run.totalAmountCents,
    payeCents: splits.payeCents,
    nssfCents: splits.nssfCents,
    shifCents: splits.shifCents,
    advanceCents: splits.advanceCents,
  }, { dimensions })
}
