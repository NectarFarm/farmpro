// ── SaaS back-office: billing + platform-staff DB integration tests ────────
// Real Postgres (skips with no DATABASE_URL, same gated convention as
// tests/admin.test.ts). Covers: the migration backfill's shape (a legacy,
// no-end-date, active subscription resolves needsPlan=false), subscribe ->
// trial, payment submit -> admin confirm -> active, and that a no-row
// super_admin (the pre-existing founder account) keeps full access after the
// capability retrofit.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as subscriptionGET } from '@/app/api/billing/subscription/route'
import { POST as subscribePOST } from '@/app/api/billing/subscribe/route'
import { POST as paymentsPOST } from '@/app/api/billing/payments/route'
import { POST as confirmPOST } from '@/app/api/admin/payments/[id]/confirm/route'
import { GET as staffGET } from '@/app/api/admin/staff/route'
import { GET as tenantsGET } from '@/app/api/admin/tenants/route'
import { db } from '@/db'
import { plans, subscriptions, payments, tenants, users, sessions } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

function req(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

run('SaaS back-office: billing', () => {
  const tenantId = `t-billing-${randomUUID()}`
  const ownerId = randomUUID()
  const founderSuperAdminId = randomUUID() // NO platform_staff row — the pre-existing founder account
  let ownerToken: string
  let founderToken: string

  // A trial-less plan (trialDays: 0) so we can exercise the pending_payment
  // -> payment -> confirm path deterministically without waiting on a real
  // trial window.
  const noTrialPlanId = randomUUID()

  beforeAll(async () => {
    const salt = randomUUID()
    await db.insert(tenants).values({ id: tenantId, name: 'Billing Test Tenant', active: true })
    await db.insert(users).values([
      { id: ownerId, tenantId, name: 'Billing Owner', email: `billing-owner-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('ownerpw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: founderSuperAdminId, tenantId: null, name: 'Founder', email: `founder-${randomUUID()}@test.ifms`, role: 'super_admin', passwordHash: hashSecret('founderpw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    await db.insert(plans).values({
      id: noTrialPlanId, code: `no-trial-${noTrialPlanId.slice(0, 8)}`, name: 'No Trial Test Plan',
      prices: { monthly: 1000000 }, currency: 'UGX', trialDays: 0, isPublic: true, isActive: true,
    })
    ownerToken = await createSession(ownerId)
    founderToken = await createSession(founderSuperAdminId)
  })

  afterAll(async () => {
    await db.delete(payments).where(eq(payments.tenantId, tenantId))
    await db.delete(subscriptions).where(eq(subscriptions.tenantId, tenantId))
    await db.delete(plans).where(eq(plans.id, noTrialPlanId))
    await db.delete(sessions).where(eq(sessions.userId, ownerId))
    await db.delete(sessions).where(eq(sessions.userId, founderSuperAdminId))
    await db.delete(users).where(eq(users.id, ownerId))
    await db.delete(users).where(eq(users.id, founderSuperAdminId))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  it('migration backfill shape: an active, no-end-date subscription on the legacy plan resolves needsPlan=false', async () => {
    const legacyRows = await db.select().from(plans).where(eq(plans.code, 'legacy')).limit(1)
    expect(legacyRows[0], 'the 0042 migration must have seeded the legacy plan').toBeTruthy()
    const legacyPlan = legacyRows[0]

    const subId = randomUUID()
    await db.insert(subscriptions).values({
      id: subId, tenantId, planId: legacyPlan.id, period: 'monthly', status: 'active',
      currentPeriodEnd: null, isCurrent: true,
    })

    mockCookie = ownerToken
    const { status, payload } = await readJson(await subscriptionGET())
    expect(status).toBe(200)
    expect(payload.data.subscription.status).toBe('active')
    expect(payload.data.access.needsPlan).toBe(false)
    expect(payload.data.plan.code).toBe('legacy')

    await db.delete(subscriptions).where(eq(subscriptions.id, subId))
  })

  it('the 3 public seed plans exist and are offered', async () => {
    for (const code of ['smallholder', 'growing-farm', 'enterprise']) {
      const rows = await db.select().from(plans).where(eq(plans.code, code)).limit(1)
      expect(rows[0], `plan ${code} should exist`).toBeTruthy()
      expect(rows[0].isPublic).toBe(true)
      expect(rows[0].isActive).toBe(true)
    }
  })

  it('POST /api/billing/subscribe on a trialing plan starts a trial', async () => {
    const smallholder = (await db.select().from(plans).where(eq(plans.code, 'smallholder')).limit(1))[0]

    mockCookie = ownerToken
    const { status, payload } = await readJson(
      await subscribePOST(req('http://localhost/api/billing/subscribe', 'POST', { planId: smallholder.id, period: 'monthly' }))
    )
    expect(status).toBe(201)
    expect(payload.data.status).toBe('trialing')
    expect(payload.data.trialEndsAt).toBeTruthy()

    const { payload: subPayload } = await readJson(await subscriptionGET())
    expect(subPayload.data.subscription.status).toBe('trialing')
    expect(subPayload.data.access.needsPlan).toBe(false)
  })

  it('subscribe -> pending_payment -> submit payment -> admin confirm -> active, period advanced', async () => {
    mockCookie = ownerToken
    const subscribeResult = await readJson(
      await subscribePOST(req('http://localhost/api/billing/subscribe', 'POST', { planId: noTrialPlanId, period: 'monthly' }))
    )
    expect(subscribeResult.payload.data.status).toBe('pending_payment')

    const paymentResult = await readJson(
      await paymentsPOST(
        req('http://localhost/api/billing/payments', 'POST', {
          amount: 10000,
          method: 'mobile_money',
          reference: 'MPESA-TEST-123',
          note: 'Paid via mobile money',
        })
      )
    )
    expect(paymentResult.status).toBe(201)
    expect(paymentResult.payload.data.status).toBe('pending')
    const paymentId = paymentResult.payload.data.id

    // The FOUNDER (no platform_staff row) confirms it — proving the
    // no-row-means-all-capabilities rule holds end to end, not just in the
    // pure unit test.
    mockCookie = founderToken
    const confirmResult = await readJson(
      await confirmPOST(req(`http://localhost/api/admin/payments/${paymentId}/confirm`, 'POST', {}), { params: Promise.resolve({ id: paymentId }) })
    )
    expect(confirmResult.status).toBe(200)

    mockCookie = ownerToken
    const { payload: subPayload } = await readJson(await subscriptionGET())
    expect(subPayload.data.subscription.status).toBe('active')
    expect(subPayload.data.subscription.amountDueCents).toBe(0)
    expect(subPayload.data.subscription.currentPeriodEnd).toBeTruthy()
    expect(subPayload.data.access.needsPlan).toBe(false)
  })

  it('a founder super_admin with NO platform_staff row keeps full capability access (backward compatibility, end to end)', async () => {
    mockCookie = founderToken
    const staffResult = await readJson(await staffGET())
    expect(staffResult.status).toBe(200) // staff.manage
    const tenantsResult = await readJson(await tenantsGET())
    expect(tenantsResult.status).toBe(200) // tenants.manage
  })

  it('an owner cannot access admin billing capability-gated routes', async () => {
    mockCookie = ownerToken
    const { status } = await readJson(await staffGET())
    expect(status).toBe(403)
  })
})
