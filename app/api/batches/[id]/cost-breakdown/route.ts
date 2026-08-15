import { NextResponse } from 'next/server'
import { db } from '@/db'
import { batches, sales } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { and, eq } from 'drizzle-orm'

// ── GET /api/batches/[id]/cost-breakdown (issue #231 task 4) ───────────────
// Deliberately NOT a fabricated feed/labour/overhead split. The UI's own mock
// (components/farm/crops.tsx's `costs` array in BatchDetailScreen) invents a
// plausible-looking 43/29/10/9/9 percentage split of `batch.cost` — that's a
// demo fixture, not something to reproduce server-side with real numbers.
//
// Today this branch has exactly ONE real per-batch cost figure:
// `batches.acquisitionCostCents` (what the batch cost to acquire — buy day-old
// chicks, stock, seed, etc.). There is no `purchases`/`expenses`/`labor_logs`
// table anywhere on this branch (checked db/schemas/*.ts and grepped the
// repo), so feed/health/labour/overhead have no data source to compute from
// yet. Rather than guess a split, this endpoint returns:
//   - `stock` (closest real-world match to "acquisition cost" — the UI's own
//     "Stock/Seed" category) = the real acquisitionCostCents, `tracked: true`.
//   - `feed` / `health` / `labour` / `overhead` = 0, `tracked: false`, with a
//     `reason` naming the missing table each would need.
// A real multi-category cost engine needs those tables and is Epic: Finance's
// job (flagged as a follow-up in the PR), not this issue's.
//
// Issue #300 update: Revenue/Gross Margin were correctly left off this
// response's shape when this endpoint was first built (no `sales` table
// existed yet). Issue #239 (Finance, merged) has since added one — see the
// `revenue`/`grossMarginPct` fields added below this categories block.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = () => NextResponse.json({ success: false, error: 'Batch not found' }, { status: 404 })

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSessionUser()
  const tenantId = session?.tenantId ?? new URL(req.url).searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  const rows = await db
    .select()
    .from(batches)
    .where(and(eq(batches.id, id), eq(batches.tenantId, tenantId)))
  const batch = rows[0]
  if (!batch) return notFound()

  const stockCents = batch.acquisitionCostCents ?? 0

  const categories = [
    {
      key: 'stock',
      label: 'Stock/Seed',
      amountCents: stockCents,
      tracked: true,
    },
    {
      key: 'feed',
      label: 'Feed/Inputs',
      amountCents: 0,
      tracked: false,
      reason: 'No feed purchase/consumption data source yet (no purchases/feed-log table).',
    },
    {
      key: 'health',
      label: 'Health/Agro',
      amountCents: 0,
      tracked: false,
      reason: 'No health/agro expense data source yet (no expenses table).',
    },
    {
      key: 'labour',
      label: 'Labour',
      amountCents: 0,
      tracked: false,
      reason: 'No labour data source yet (no labor_logs table).',
    },
    {
      key: 'overhead',
      label: 'Overhead',
      amountCents: 0,
      tracked: false,
      reason: 'No overhead allocation data source yet (no expenses table).',
    },
  ]

  const totalTrackedCents = categories.filter((c) => c.tracked).reduce((s, c) => s + c.amountCents, 0)

  // ── Revenue / Gross Margin (issue #300) ───────────────────────────────────
  // Issue #239 (Finance, merged) added a real `sales` table with `sales.batchId`
  // — this batch's real revenue source. Sum this batch's own sales rows only
  // (tenant + batch scoped), same as components/farm/finance.tsx's Batch P&L
  // (`salesByBatch`) does client-side over the tenant's full sales list.
  //
  // Units: `sales.amount` is a whole-KSh integer, NOT cents like
  // `acquisitionCostCents`/`totalTrackedCents` (see db/schemas/finance.ts's
  // comment on the `sales` table). Issue #290 (open as of this writing) flags
  // that exact mismatch corrupting the GL trial balance in lib/finance.ts —
  // this endpoint isn't that code path, but it reads the same column, so it
  // must not reproduce the bug here: convert explicitly (`amount * 100`)
  // before doing arithmetic against cost figures, so `revenueCents` is
  // directly comparable to `totalTrackedCents`.
  const saleRows = await db
    .select({ amount: sales.amount })
    .from(sales)
    .where(and(eq(sales.batchId, id), eq(sales.tenantId, tenantId)))
  const hasSales = saleRows.length > 0
  const revenueCents = saleRows.reduce((s, r) => s + r.amount, 0) * 100

  // Gross margin against tracked cost only (same "tracked cost only" honesty
  // already used for Break-even above — feed/health/labour/overhead aren't
  // tracked yet, so a margin against *full* cost isn't computable). `null`
  // (not 0%) when there's no revenue yet: an honest "not enough data" state,
  // not a fabricated number — 0% would misleadingly imply a real, measured
  // break-even margin instead of "no sales recorded".
  const grossMarginPct = hasSales
    ? Math.round(((revenueCents - totalTrackedCents) / revenueCents) * 1000) / 10
    : null

  return ok({
    batchId: batch.id,
    code: batch.code,
    totalTrackedCents,
    categories,
    revenue: {
      amountCents: revenueCents,
      tracked: hasSales,
      reason: hasSales ? undefined : 'No sales recorded yet for this batch.',
    },
    grossMarginPct,
  })
}
