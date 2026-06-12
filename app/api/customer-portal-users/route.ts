import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { customerPortalUsers } from '@/db/schema'
import { requireSession, hashPin } from '@/lib/auth'
import { handleApiError, ValidationError } from '@/lib/errors'
import { stripMeta } from '@/lib/utils'

export async function GET() {
  try {
    await requireSession()
    const rows = await db.select().from(customerPortalUsers)
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
    if (!body.pin) throw new ValidationError('pin is required')
    const [row] = await db
      .insert(customerPortalUsers)
      .values({ ...stripMeta(body), pinHash: hashPin(String(body.pin)), pin: undefined })
      .returning()
    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
