import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { birdStageSales, flocks } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { requireSession } from '@/lib/auth'
import { handleApiError } from '@/lib/errors'
import { stripMeta } from '@/lib/utils'

export async function GET() {
  try {
    await requireSession()
    const rows = await db.select().from(birdStageSales)
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
    const [row] = await db.insert(birdStageSales).values(stripMeta(body)).returning()

    // Decrement flock currentCount
    await db
      .update(flocks)
      .set({ currentCount: sql`GREATEST(0, ${flocks.currentCount} - ${body.quantity})` })
      .where(eq(flocks.id, body.flockId))

    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
