import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { settings } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { ensureSettings, hashPin, requireSession } from '@/lib/auth'
import { handleApiError } from '@/lib/errors'

export async function GET() {
  try {
    await requireSession()
    const row = await ensureSettings()
    // never expose the hash
    const { ownerPinHash: _, ...safe } = row
    return NextResponse.json(safe)
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireSession()
    const body = await req.json()

    const updates: Record<string, unknown> = {}
    if (body.enterpriseType !== undefined) updates.enterpriseType = String(body.enterpriseType)
    if (body.pricePerEgg !== undefined) updates.pricePerEgg = String(body.pricePerEgg)
    if (body.pricePerTray !== undefined) updates.pricePerTray = String(body.pricePerTray)
    if (body.pricePerChick !== undefined) updates.pricePerChick = String(body.pricePerChick)
    if (body.newOwnerPin) updates.ownerPinHash = hashPin(String(body.newOwnerPin))

    await ensureSettings()
    const [row] = await db
      .update(settings)
      .set(updates)
      .where(eq(settings.id, 'default'))
      .returning()

    const { ownerPinHash: _, ...safe } = row
    return NextResponse.json(safe)
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
