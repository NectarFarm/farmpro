import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { alerts } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth'
import { handleApiError } from '@/lib/errors'

/** Mark alert as read */
export async function PUT(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession()
    const { id } = await params
    const [row] = await db.update(alerts).set({ read: true }).where(eq(alerts.id, id)).returning()
    return NextResponse.json(row)
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
