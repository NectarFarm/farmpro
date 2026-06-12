import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { feedInventory } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth'
import { handleApiError, ValidationError } from '@/lib/errors'
import { stripMeta } from '@/lib/utils'

export async function GET() {
  try {
    await requireSession()
    const rows = await db.select().from(feedInventory)
    return NextResponse.json(rows)
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/** Update a single inventory item by feedType */
export async function PUT(req: NextRequest) {
  try {
    await requireSession()
    const body = await req.json()
    if (!body.feedType) throw new ValidationError('feedType is required')

    const [row] = await db
      .update(feedInventory)
      .set({ ...stripMeta(body), lastUpdated: new Date() })
      .where(eq(feedInventory.feedType, body.feedType))
      .returning()

    return NextResponse.json(row)
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
