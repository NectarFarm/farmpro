import { NextResponse } from 'next/server'
import { db } from '@/db'
import { batches } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { listSales, recordSale } from '@/lib/finance'
import { and, eq } from 'drizzle-orm'
import { batchIdsForFarm, farmNotFoundResponse, resolveFarmFilter } from '@/lib/farm-scope'

// ── GET/POST /api/data/sales (issue #239 task 1) ────────────────────────────
// Fresh build: no `sales` table or route existed anywhere on this branch
// before this issue (the issue's own branch-correction note confirms it).
// Field set matches the issue's exact spec and components/farm/finance.tsx's
// `SALES` mock 1:1 (id, batchId, item, amount, method, status, soldAt).
//
// POST also posts the sale's journal entry in the same DB transaction — see
// lib/finance.ts's recordSale / postSaleJournal for the posting rule and the
// posting-engine-vs-computed-on-read decision.
//
// Same tenant-resolution + envelope conventions as GET/POST /api/batches:
// session tenant wins, `tenantId` query param / body field is the
// standalone-mock-mode fallback.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

const VALID_STATUSES = new Set(['paid', 'pending'])

// GET /api/data/sales?tenantId=...&farmId= — list a tenant's sales, newest
// first. `farmId` is a two-hop JOIN filter (farm-scoped-data task):
// sales.batchId -> batches.unitId -> production_units.farmId — sales has no
// farm_id of its own, same reasoning as GET /api/records's farmId.
export async function GET(req: Request) {
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  const farmFilter = await resolveFarmFilter(tenantId, url.searchParams.get('farmId'))
  if (farmFilter === null) return NextResponse.json(farmNotFoundResponse(), { status: 404 })

  if (farmFilter) {
    const batchIds = await batchIdsForFarm(tenantId, farmFilter)
    if (batchIds.length === 0) return ok([])
    const rows = await listSales(tenantId, batchIds)
    return ok(rows)
  }

  const rows = await listSales(tenantId)
  return ok(rows)
}

// POST /api/data/sales — record a sale (and post its journal entry).
// Body: { tenantId?, batchId?, item, amount, method?, status?, soldAt? }
export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const session = await getSessionUser()
  const tenantId = session?.tenantId ?? (typeof b.tenantId === 'string' ? b.tenantId.trim() : '')
  const item = typeof b.item === 'string' ? b.item.trim() : ''
  const amount = Number(b.amount)
  const status = typeof b.status === 'string' && b.status.trim() ? b.status.trim() : 'paid'
  const batchId = typeof b.batchId === 'string' && b.batchId.trim() ? b.batchId.trim() : null

  if (!tenantId) return badRequest('tenantId is required')
  if (!item) return badRequest('item is required')
  if (!Number.isFinite(amount) || amount <= 0) return badRequest('amount must be a positive number')
  if (!VALID_STATUSES.has(status)) return badRequest("status must be 'paid' or 'pending'")

  if (batchId) {
    const rows = await db.select({ id: batches.id }).from(batches).where(and(eq(batches.id, batchId), eq(batches.tenantId, tenantId)))
    if (rows.length === 0) return notFound('Batch not found for this tenant')
  }

  const method = typeof b.method === 'string' ? b.method.trim() : ''
  const soldAt = typeof b.soldAt === 'string' && b.soldAt ? new Date(b.soldAt) : undefined

  const sale = await recordSale({
    tenantId,
    batchId,
    item,
    amount: Math.trunc(amount),
    method,
    status,
    soldAt,
  })

  return created(sale)
}
