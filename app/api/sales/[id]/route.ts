import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { sales, flocks } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { requireSession } from '@/lib/auth'
import { handleApiError, NotFoundError } from '@/lib/errors'
import { stripMeta } from '@/lib/utils'

/** Used for request-deletion, approve-deletion, reject-deletion workflows */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession()
    const { id } = await params
    const body = await req.json()
    const [row] = await db.update(sales).set(stripMeta(body)).where(eq(sales.id, id)).returning()
    if (!row) throw new NotFoundError('Sale not found')
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

    // Fetch before delete so we can restore flock count for bird sales
    const [sale] = await db.select().from(sales).where(eq(sales.id, id))
    await db.delete(sales).where(eq(sales.id, id))

    if (sale?.product === 'birds' && sale.flockId) {
      await db
        .update(flocks)
        .set({ currentCount: sql`${flocks.currentCount} + ${sale.quantity}` })
        .where(eq(flocks.id, sale.flockId))
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
