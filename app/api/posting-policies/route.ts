import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { accounts, farms, postingPolicies } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'
import { ensureAccountsSeeded } from '@/lib/finance'
import { isPolicyEffect, isPolicyKind } from '@/lib/posting-policy'

const ok = <T>(data: T, status = 200) => NextResponse.json({ success: true, data }, { status })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

// GET is open to any tenant session so a form can say what will happen
// before the owner saves. An empty list is the truth: nothing is seeded.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession({ explicitTenantId: url.searchParams.get('tenantId') ?? undefined })
  if ('error' in auth) return auth.error
  const rows = await db.select().from(postingPolicies).where(eq(postingPolicies.tenantId, auth.tenantId))
  return ok(rows)
}

async function farmOnTenant(tenantId: string, farmId: string): Promise<boolean> {
  const [farm] = await db
    .select({ id: farms.id })
    .from(farms)
    .where(and(eq(farms.id, farmId), eq(farms.tenantId, tenantId)))
    .limit(1)
  return !!farm
}

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const auth = await requireTenantSession({
    roles: ['owner', 'super_admin'],
    explicitTenantId: typeof b.tenantId === 'string' ? b.tenantId : undefined,
  })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const kind = typeof b.kind === 'string' ? b.kind : ''
  if (!isPolicyKind(kind)) return badRequest('kind must be amount, account, farm or variance.')
  const effect = typeof b.effect === 'string' ? b.effect : ''
  if (!isPolicyEffect(effect)) return badRequest('effect must be pending or block.')
  if (typeof b.thresholdCents !== 'number' || !Number.isInteger(b.thresholdCents) || b.thresholdCents < 0) {
    return badRequest('thresholdCents must be a whole number of cents, zero or more.')
  }

  let accountCode: string | null = null
  let farmId: string | null = null
  if (kind === 'account') {
    accountCode = typeof b.accountCode === 'string' ? b.accountCode.trim() : ''
    if (!accountCode) return badRequest('An account threshold needs an account.')
    await ensureAccountsSeeded()
    const [account] = await db.select({ code: accounts.code }).from(accounts).where(eq(accounts.code, accountCode)).limit(1)
    if (!account) return badRequest('That account is not on the chart.')
    const sentFarm = typeof b.farmId === 'string' ? b.farmId.trim() : ''
    if (sentFarm) {
      if (!(await farmOnTenant(tenantId, sentFarm))) return badRequest('That farm is not on this business.')
      farmId = sentFarm
    }
  }
  if (kind === 'farm') {
    const sentFarm = typeof b.farmId === 'string' ? b.farmId.trim() : ''
    if (!sentFarm) return badRequest('A farm threshold needs a farm.')
    if (!(await farmOnTenant(tenantId, sentFarm))) return badRequest('That farm is not on this business.')
    farmId = sentFarm
  }

  const [row] = await db.insert(postingPolicies).values({
    id: randomUUID(),
    tenantId,
    kind,
    accountCode: kind === 'account' ? accountCode : null,
    farmId: kind === 'account' || kind === 'farm' ? farmId : null,
    thresholdCents: b.thresholdCents,
    effect,
  }).returning()
  return ok(row, 201)
}
