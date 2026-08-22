import { NextResponse } from 'next/server'
import { db } from '@/db'
import { accounts } from '@/db/schemas'
import { ensureAccountsSeeded } from '@/lib/finance'
import { requireSession } from '@/lib/api-auth'

// ── GET /api/gl/accounts (issue #239 task 4; auth fix: fix/authenticate-all-apis) ─
// The chart of accounts is global (not tenant-scoped — see db/schemas/
// finance.ts's top comment for why), so this route needs no tenant
// resolution — but it still needs a real session: this used to call no auth
// check at all, so any unauthenticated caller could read the full COA.
// `ensureAccountsSeeded` is idempotent (ON CONFLICT DO NOTHING on the unique
// `code` index), so calling it here guarantees the standard COA exists even
// if a seed script hasn't been run against this database yet.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })

export async function GET() {
  const auth = await requireSession()
  if ('error' in auth) return auth.error

  await ensureAccountsSeeded()
  const rows = await db.select().from(accounts).orderBy(accounts.code)
  return ok(rows)
}
