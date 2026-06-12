import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { expenses } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth'
import { handleApiError } from '@/lib/errors'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession()
    const { id } = await params
    await db.delete(expenses).where(eq(expenses.id, id))
    return NextResponse.json({ success: true })
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
