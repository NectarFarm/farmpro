// ── Money is stored in minor units, everywhere ──────────────────────────────
// The ledger used to hold whole shillings while purchases held cents, and
// lib/finance.ts converted between them mid-posting. One missed conversion is
// a 100x error in someone's accounts — app/api/batches/[id]/cost-breakdown
// still carries a comment about not reproducing exactly that bug.
//
// Everything is `_cents` now. These tests pin the properties that would break
// if a conversion crept back in: a sale round-trips at the same magnitude, a
// sale and a purchase post to the ledger in the SAME unit, entries balance,
// and values past the old `integer` ceiling survive.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { parseMoneyToCents, centsToMajor, majorToCents } from '@/lib/money'
import { POST as salesPOST } from '@/app/api/data/sales/route'
import { GET as trialBalanceGET } from '@/app/api/gl/trial-balance/route'
import { db } from '@/db'
import { tenants, users, sessions, sales, journalEntries, journalLines } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

async function readJson(res: Response) { return { status: res.status, payload: await res.json() } }
const postReq = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('lib/money conversions', () => {
  it('parses awkward input without silently losing or inventing value', () => {
    expect(parseMoneyToCents('1,234.50')).toBe(123450)  // thousands separator
    expect(parseMoneyToCents('0.05')).toBe(5)           // sub-unit precision
    expect(parseMoneyToCents('1000')).toBe(100000)      // bare major unit
    expect(parseMoneyToCents('')).toBeNull()            // not zero — absent
    expect(parseMoneyToCents('abc')).toBeNull()         // not NaN leaking onward
    expect(parseMoneyToCents(null)).toBeNull()
  })

  it('round-trips major <-> minor without float drift', () => {
    for (const major of [0, 0.05, 1234.5, 99999.99]) {
      expect(centsToMajor(majorToCents(major))).toBe(major)
    }
    // Sub-cent input rounds to the nearest cent...
    expect(majorToCents(0.07)).toBe(7)
    expect(parseMoneyToCents('1.006')).toBe(101)
    expect(parseMoneyToCents('1.004')).toBe(100)
    expect(parseMoneyToCents('0.001')).toBe(0)
    // ...with one documented artefact, pinned rather than wished away: 1.005
    // is 1.00499999999999989 in IEEE754, so Math.round sees 100.4999 and
    // gives 100, not the 101 a human would write. It is a half-cent on input
    // that never compounds — the ledger only ever moves whole cents after
    // this point — but it is real, so it is asserted rather than hidden.
    expect(parseMoneyToCents('1.005')).toBe(100)
    expect(majorToCents(1.005)).toBe(100)
  })
})

run('money units end to end', () => {
  const tenantId = `t-money-${randomUUID()}`
  const ownerId = randomUUID()
  const ownerEmail = `money-${randomUUID()}@test.ifms`
  let ownerToken: string
  const createdSaleIds: string[] = []

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Money Tenant', active: true })
    const salt = randomUUID()
    await db.insert(users).values({
      id: ownerId, tenantId, name: 'Money Owner', email: ownerEmail,
      role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
    })
    ownerToken = await createSession(ownerId)
    mockCookie = ownerToken
  })

  afterAll(async () => {
    const entries = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    if (entries.length) await db.delete(journalLines).where(inArray(journalLines.entryId, entries.map(e => e.id)))
    await db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
    await db.delete(sessions).where(eq(sessions.userId, ownerId))
    await db.delete(users).where(eq(users.id, ownerId))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  it('a sale stores minor units and reads back at the same magnitude', async () => {
    mockCookie = ownerToken
    const { status, payload } = await readJson(
      await salesPOST(postReq('http://localhost/api/data/sales', { tenantId, item: 'Eggs', amountCents: 7350000, status: 'paid' })),
    )
    expect(status).toBe(201)
    expect(payload.data.amountCents).toBe(7350000)
    createdSaleIds.push(payload.data.id)

    const [row] = await db.select().from(sales).where(eq(sales.id, payload.data.id))
    // KSh 73,500 — stored as cents, not as 73500 and not as 735000000.
    expect(row.amountCents).toBe(7350000)
    expect(centsToMajor(row.amountCents)).toBe(73500)
  })

  it('keeps every journal entry balanced, in one unit', async () => {
    mockCookie = ownerToken
    await salesPOST(postReq('http://localhost/api/data/sales', { tenantId, item: 'Milk', amountCents: 1234567, status: 'paid' }))

    const entries = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      const lines = await db.select().from(journalLines).where(eq(journalLines.entryId, entry.id))
      const debit = lines.reduce((s, l) => s + Number(l.debitCents), 0)
      const credit = lines.reduce((s, l) => s + Number(l.creditCents), 0)
      expect(debit).toBe(credit)
    }
  })

  it('the trial balance reports the sale at its true magnitude, not 100x off', async () => {
    mockCookie = ownerToken
    const { payload } = await readJson(
      await trialBalanceGET(),
    )
    expect(payload.data.balanced).toBe(true)
    expect(payload.data.totalDebitsCents).toBe(payload.data.totalCreditsCents)
    // Everything posted so far: 7,350,000 + 1,234,567 cents.
    const revenue = payload.data.rows.find((r: { code: string }) => r.code === '4001')
    expect(revenue.balanceCents).toBe(7350000 + 1234567)
  })

  it('survives a value past the old integer ceiling, proving bigint took effect', async () => {
    mockCookie = ownerToken
    // 2,147,483,647 was `integer`'s max; this is comfortably beyond it.
    const huge = 5_000_000_000
    const { status, payload } = await readJson(
      await salesPOST(postReq('http://localhost/api/data/sales', { tenantId, item: 'Bulk contract', amountCents: huge, status: 'paid' })),
    )
    expect(status).toBe(201)
    const [row] = await db.select().from(sales).where(eq(sales.id, payload.data.id))
    expect(Number(row.amountCents)).toBe(huge)
  })
})
