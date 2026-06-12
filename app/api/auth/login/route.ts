import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { employees, customerPortalUsers } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { createSession, ensureSettings, hashPin } from '@/lib/auth'
import { handleApiError, ValidationError, UnauthorizedError } from '@/lib/errors'

export async function POST(req: NextRequest) {
  try {
    const { pin, type, entityId } = await req.json()

    if (!pin || !type) throw new ValidationError('pin and type are required')
    if (!['owner', 'employee', 'customer'].includes(type)) {
      throw new ValidationError('Invalid login type')
    }

    const pinHash = hashPin(String(pin))

    if (type === 'owner') {
      const cfg = await ensureSettings()
      if (cfg.ownerPinHash !== pinHash) throw new UnauthorizedError('Incorrect PIN')
      const session = await createSession('owner')
      return NextResponse.json({ session })
    }

    if (type === 'employee') {
      const [emp] = await db
        .select()
        .from(employees)
        .where(eq(employees.id, entityId ?? ''))
        .limit(1)
      if (!emp || emp.pinHash !== pinHash) throw new UnauthorizedError('Incorrect PIN')
      const session = await createSession('employee', emp.id, emp.name)
      return NextResponse.json({ session })
    }

    if (type === 'customer') {
      const [cpu] = await db
        .select()
        .from(customerPortalUsers)
        .where(eq(customerPortalUsers.id, entityId ?? ''))
        .limit(1)
      if (!cpu || cpu.pinHash !== pinHash) throw new UnauthorizedError('Incorrect PIN')
      const session = await createSession('customer', cpu.customerId, cpu.name)
      return NextResponse.json({ session })
    }

    throw new ValidationError('Unhandled login type')
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
