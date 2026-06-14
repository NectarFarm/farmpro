import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { customers, sales, orderRequests } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth'
import { handleApiError, NotFoundError, ConflictError } from '@/lib/errors'
import { stripMeta } from '@/lib/utils'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession()
    const { id } = await params
    const body = await req.json()
    const [row] = await db.update(customers).set(stripMeta(body)).where(eq(customers.id, id)).returning()
    if (!row) throw new NotFoundError('Customer not found')
    return NextResponse.json(row)
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession()
    const { id } = await params

    // sales.customerId and orderRequests.customerId are RESTRICT (no cascade) so the
    // financial history is preserved. Block the delete with a clear message instead of
    // letting Postgres throw an opaque FK violation (which would surface as a 500).
    const linkedSales = await db.select({ id: sales.id }).from(sales).where(eq(sales.customerId, id))
    const linkedOrders = await db.select({ id: orderRequests.id }).from(orderRequests).where(eq(orderRequests.customerId, id))
    if (linkedSales.length > 0 || linkedOrders.length > 0) {
      throw new ConflictError(
        `Cannot delete customer: ${linkedSales.length} sale(s) and ${linkedOrders.length} order(s) are linked to them. Remove those records first.`
      )
    }

    await db.delete(customers).where(eq(customers.id, id))
    return NextResponse.json({ success: true })
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
