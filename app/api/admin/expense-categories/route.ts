import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { accounts, expenseCategories } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'
import { ensureExpenseCategories } from '@/lib/expenses'
import { isUniqueViolation } from '@/lib/db-errors'

// ── GET/POST /api/admin/expense-categories ──────────────────────────────────
// The platform catalogue. An owner cannot create an account or a category;
// they pick from what this route returns as active. A new category must
// point at an existing EXPENSE account — this route does not invent one.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const created = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 201 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

export async function GET() {
  const auth = await requirePlatformCapability('catalogue.manage')
  if ('error' in auth) return auth.error

  await ensureExpenseCategories()
  const rows = await db.select().from(expenseCategories).orderBy(asc(expenseCategories.name))
  return ok(rows)
}

export async function POST(req: Request) {
  const auth = await requirePlatformCapability('catalogue.manage')
  if ('error' in auth) return auth.error

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const code = typeof b.code === 'string' ? b.code.trim() : ''
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const accountCode = typeof b.accountCode === 'string' ? b.accountCode.trim() : ''
  if (!/^[a-z][a-z0-9_]*$/.test(code)) return badRequest('code must be lowercase letters, numbers and underscores, starting with a letter')
  if (!name) return badRequest('name is required')
  if (!accountCode) return badRequest('accountCode is required')

  await ensureExpenseCategories()
  const accountRows = await db.select().from(accounts).where(eq(accounts.code, accountCode))
  const account = accountRows[0]
  if (!account || account.class !== 'EXPENSE') return badRequest('accountCode must be an existing expense account')

  try {
    const [row] = await db
      .insert(expenseCategories)
      .values({ id: randomUUID(), code, name, accountCode, active: true })
      .returning()
    return created(row)
  } catch (err) {
    if (isUniqueViolation(err)) return badRequest('A category with that code already exists')
    throw err
  }
}
