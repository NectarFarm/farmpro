import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { customers } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth'
import { handleApiError, NotFoundError } from '@/lib/errors'
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
    await db.delete(customers).where(eq(customers.id, id))
    return NextResponse.json({ success: true })
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
