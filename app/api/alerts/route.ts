import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { alerts } from '@/db/schema'
import { requireSession } from '@/lib/auth'
import { handleApiError } from '@/lib/errors'
import { stripMeta } from '@/lib/utils'

export async function GET() {
  try {
    await requireSession()
    const rows = await db.select().from(alerts)
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
    const [row] = await db.insert(alerts).values(stripMeta(body)).returning()
    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}

/** Clear all alerts */
export async function DELETE() {
  try {
    await requireSession()
    await db.delete(alerts)
    return NextResponse.json({ success: true })
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
