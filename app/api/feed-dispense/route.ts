import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { feedDispenseRecords, feedInventory } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { requireSession } from '@/lib/auth'
import { handleApiError } from '@/lib/errors'
import { stripMeta } from '@/lib/utils'

export async function GET() {
  try {
    await requireSession()
    const rows = await db.select().from(feedDispenseRecords)
    return NextResponse.json(rows)
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireSession()
    const body = await req.json()
    const [row] = await db.insert(feedDispenseRecords).values(stripMeta(body)).returning()

    // Deduct dispensed quantity from feed inventory
    await db
      .update(feedInventory)
      .set({
        currentStockKg: sql`GREATEST(0, ${feedInventory.currentStockKg} - ${body.quantityKg})`,
        lastUpdated: new Date(),
      })
      .where(eq(feedInventory.feedType, body.feedType))

    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
