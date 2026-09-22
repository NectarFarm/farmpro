import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { and, eq, sql, desc } from 'drizzle-orm'
import { db } from '@/db'
import { suppliers, purchases } from '@/db/schemas'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'

// ── GET/POST /api/suppliers (item 20) ────────────────────────────────────────
// The supplier master a purchase/expense's type-to-search picker resolves or
// creates against — `purchases.supplier` (free text) is untouched; this is
// an optional structured layer on top, never a replacement (see migration
// 0047's header).
//
// GET returns every supplier with its own BALANCE (item 20: "a balance view
// per supplier ... computed from unpaid rows — no new ledger concepts, just
// a sum") — the unpaid portion (totalCostCents - amountPaidCents, never
// negative) of every purchase linked to it, summed in Postgres rather than
// pulled row-by-row into Node (same "aggregate in the database" call
// lib/reports.ts's computeBatchPlReport already makes for the same reason).

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const activeOnly = url.searchParams.get('active') === 'true'
  const conditions = [eq(suppliers.tenantId, tenantId)]
  if (activeOnly) conditions.push(eq(suppliers.active, true))

  const rows = await db
    .select({
      id: suppliers.id,
      tenantId: suppliers.tenantId,
      name: suppliers.name,
      phone: suppliers.phone,
      contact: suppliers.contact,
      tin: suppliers.tin,
      creditTerms: suppliers.creditTerms,
      active: suppliers.active,
      createdAt: suppliers.createdAt,
      balanceCents: sql<string>`coalesce(sum(greatest(${purchases.totalCostCents} - ${purchases.amountPaidCents}, 0)), 0)`,
    })
    .from(suppliers)
    .leftJoin(purchases, and(eq(purchases.supplierId, suppliers.id), eq(purchases.tenantId, tenantId)))
    .where(and(...conditions))
    .groupBy(suppliers.id)
    .orderBy(desc(suppliers.createdAt))

  // Postgres numeric aggregates come back as strings over the driver — cast
  // once here so every caller gets a real number, same convention
  // lib/reports.ts's `sum()` reads already follow.
  return ok(rows.map((r) => ({ ...r, balanceCents: Number(r.balanceCents) })))
}

// POST /api/suppliers — create the master. Body: { tenantId?, name, phone?,
// contact?, tin?, creditTerms? }
export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const auth = await requireTenantSession({ explicitTenantId: typeof b.tenantId === 'string' ? b.tenantId : undefined })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  if (!(await canEdit(tenantId, session.role, MODULES.finance))) {
    return forbidden('Your role does not have edit access to finance')
  }

  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) return badRequest('name is required')

  // Same case-insensitive dedupe every other free-text-turned-catalogue
  // entry point in this app applies (findOrCreateItem, POST /api/inventory/
  // items) — two suppliers that only differ by case are one supplier that
  // got typed twice.
  const existing = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, tenantId), sql`lower(${suppliers.name}) = lower(${name})`))
  if (existing.length > 0) return badRequest(`${name} is already in your suppliers`)

  const [supplier] = await db
    .insert(suppliers)
    .values({
      id: randomUUID(),
      tenantId,
      name,
      phone: typeof b.phone === 'string' ? b.phone.trim() : '',
      contact: typeof b.contact === 'string' ? b.contact.trim() : '',
      tin: typeof b.tin === 'string' && b.tin.trim() ? b.tin.trim() : null,
      creditTerms: typeof b.creditTerms === 'string' && b.creditTerms.trim() ? b.creditTerms.trim() : null,
    })
    .returning()

  return created({ ...supplier, balanceCents: 0 })
}
