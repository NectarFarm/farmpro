import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { employees } from '@/db/schema'
import { requireSession, hashPin } from '@/lib/auth'
import { handleApiError, ValidationError } from '@/lib/errors'

export async function GET() {
  try {
    await requireSession()
    const rows = await db.select().from(employees)
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
    if (!body.id || !body.name || !body.pin) throw new ValidationError('id, name, pin required')

    const [row] = await db
      .insert(employees)
      .values({ id: body.id, name: body.name, pinHash: hashPin(String(body.pin)), role: 'employee' })
      .returning()

    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
