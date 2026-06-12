import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { birdStageSales, flocks } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { requireSession } from '@/lib/auth'
import { handleApiError } from '@/lib/errors'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession()
    const { id } = await params

    // Fetch before delete so we can restore flock count
    const [sale] = await db.select().from(birdStageSales).where(eq(birdStageSales.id, id))
    await db.delete(birdStageSales).where(eq(birdStageSales.id, id))

    if (sale?.flockId) {
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
