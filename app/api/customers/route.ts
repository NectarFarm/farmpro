import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { and, eq, sql, desc } from 'drizzle-orm'
import { db } from '@/db'
import { customers, sales } from '@/db/schemas'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'

// ── GET/POST /api/customers (item 20) ────────────────────────────────────────
// The customer master a sale's type-to-search picker resolves or creates
// against — `sales.soldTo` (free text) is untouched; this is an optional
// structured layer on top (see migration 0047's header, and suppliers'
// identical route for the purchase side).
//
// GET returns every customer with its own BALANCE — the amount of every
// 'pending' (on-account) sale linked to it, summed. Sales carry no partial-
// paid concept the way a purchase does (see db/schemas/finance.ts), so this
// is simpler than the supplier side: no clamped subtraction, just a sum over
// unpaid rows.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const activeOnly = url.searchParams.get('active') === 'true'
  const conditions = [eq(customers.tenantId, tenantId)]
  if (activeOnly) conditions.push(eq(customers.active, true))

  const rows = await db
    .select({
      id: customers.id,
      tenantId: customers.tenantId,
      name: customers.name,
      phone: customers.phone,
      contact: customers.contact,
      tin: customers.tin,
      creditTerms: customers.creditTerms,
      active: customers.active,
      createdAt: customers.createdAt,
      balanceCents: sql<string>`coalesce(sum(case when ${sales.status} = 'pending' then ${sales.amountCents} else 0 end), 0)`,
    })
    .from(customers)
    .leftJoin(sales, and(eq(sales.customerId, customers.id), eq(sales.tenantId, tenantId)))
    .where(and(...conditions))
    .groupBy(customers.id)
    .orderBy(desc(customers.createdAt))

  return ok(rows.map((r) => ({ ...r, balanceCents: Number(r.balanceCents) })))
}

// POST /api/customers — create the master. Body: { tenantId?, name, phone?,
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

  const existing = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), sql`lower(${customers.name}) = lower(${name})`))
  if (existing.length > 0) return badRequest(`${name} is already in your customers`)

  const [customer] = await db
    .insert(customers)
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

  return created({ ...customer, balanceCents: 0 })
}
