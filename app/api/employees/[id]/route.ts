import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { employees } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { requireSession, hashPin } from '@/lib/auth'
import { handleApiError, NotFoundError } from '@/lib/errors'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession()
    const { id } = await params
    const body = await req.json()

    const updates: Record<string, unknown> = {}
    if (body.name) updates.name = body.name
    if (body.pin) updates.pinHash = hashPin(String(body.pin))

    const [row] = await db.update(employees).set(updates).where(eq(employees.id, id)).returning()
    if (!row) throw new NotFoundError('Employee not found')
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
    await db.delete(employees).where(eq(employees.id, id))
    return NextResponse.json({ success: true })
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
