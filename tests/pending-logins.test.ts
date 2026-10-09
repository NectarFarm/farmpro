// "Who cannot sign in yet?" — the owner's People screen used to show a person
// with an unused or expired set-password link exactly like an active one.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as waitingGET } from '@/app/api/employees/sign-in-waiting/route'
import { db } from '@/db'
import { tenants, users, sessions, employees, setPasswordTokens } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { issueSetPasswordToken } from '@/lib/set-password'
import { listPendingLogins } from '@/lib/pending-logins'

const run = process.env.DATABASE_URL ? describe : describe.skip

run('pending logins', () => {
  const tenantId = `t-${randomUUID()}`
  const salt = randomUUID()
  const u = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
    id, tenantId, name: id, email: `${id}@test.ifms`, role, passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE', ...extra,
  })
  const ownerId = `usr-o-${randomUUID()}`
  const managerId = `usr-m-${randomUUID()}`
  const vetUserId = `usr-v-${randomUUID()}`
  const auditorUserId = `usr-a-${randomUUID()}`
  const pinWorkerUserId = `usr-pw-${randomUUID()}`
  const noPinWorkerUserId = `usr-npw-${randomUUID()}`
  const userIds = [ownerId, managerId, vetUserId, auditorUserId, pinWorkerUserId, noPinWorkerUserId]
  const e = (k: string) => `emp-${k}-${tenantId}`
  let ownerSession: string
  let managerSession: string

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Pending Co.', active: true })
    await db.insert(users).values([
      u(ownerId, 'owner'), u(managerId, 'manager'), u(vetUserId, 'vet'), u(auditorUserId, 'auditor'),
      u(pinWorkerUserId, 'worker', { pinHash: 'x' }), u(noPinWorkerUserId, 'worker'),
    ] as never)
    await db.insert(employees).values([
      { id: e('waiting'), tenantId, name: 'Waiting Vet', role: 'vet', userId: vetUserId },
      { id: e('expired'), tenantId, name: 'Expired Auditor', role: 'auditor', userId: auditorUserId },
      { id: e('active'), tenantId, name: 'Active Manager', role: 'manager', userId: managerId },
      { id: e('nologin'), tenantId, name: 'No Login Manager', role: 'manager' },
      { id: e('pin-ok'), tenantId, name: 'PIN Worker', role: 'worker', userId: pinWorkerUserId },
      { id: e('pin-missing'), tenantId, name: 'No PIN Worker', role: 'worker', userId: noPinWorkerUserId },
      { id: e('worker-nologin'), tenantId, name: 'No Login Worker', role: 'worker' },
      { id: e('owner'), tenantId, name: 'Owner Person', role: 'owner', userId: ownerId },
      { id: e('inactive'), tenantId, name: 'Left Manager', role: 'manager', status: 'INACTIVE' },
    ] as never)
    await issueSetPasswordToken(vetUserId)
    await issueSetPasswordToken(auditorUserId)
    await db.update(setPasswordTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(setPasswordTokens.userId, auditorUserId))
    // The active manager redeemed their link.
    const { token } = await issueSetPasswordToken(managerId)
    await db.update(setPasswordTokens).set({ usedAt: new Date() }).where(eq(setPasswordTokens.token, token))
    ownerSession = await createSession(ownerId)
    managerSession = await createSession(managerId)
  })

  afterAll(async () => {
    mockCookie = undefined
    await db.delete(setPasswordTokens).where(inArray(setPasswordTokens.userId, userIds))
    await db.delete(sessions).where(inArray(sessions.userId, userIds))
    await db.delete(employees).where(eq(employees.tenantId, tenantId))
    await db.delete(users).where(inArray(users.id, userIds))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  it('lists exactly who cannot sign in, with the right reason per credential type', async () => {
    const rows = await listPendingLogins(tenantId)
    const by = Object.fromEntries(rows.map((r) => [r.name, r]))
    expect(by['Waiting Vet']).toMatchObject({ kind: 'email', reason: 'link-waiting' })
    expect(by['Expired Auditor']).toMatchObject({ kind: 'email', reason: 'link-expired' })
    expect(by['Expired Auditor']!.expiresAt).toBeTruthy()
    expect(by['No Login Manager']).toMatchObject({ kind: 'email', reason: 'no-login' })
    expect(by['No PIN Worker']).toMatchObject({ kind: 'pin', reason: 'no-pin' })
    expect(by['No Login Worker']).toMatchObject({ kind: 'pin', reason: 'no-login' })
    // Signed in, owner, and deactivated people are not "waiting".
    expect(by['Active Manager']).toBeUndefined()
    expect(by['PIN Worker']).toBeUndefined()
    expect(by['Owner Person']).toBeUndefined()
    expect(by['Left Manager']).toBeUndefined()
  })

  it('is owner-only', async () => {
    mockCookie = managerSession
    expect((await waitingGET()).status).toBe(403)
    mockCookie = undefined
    expect((await waitingGET()).status).toBe(401)
    mockCookie = ownerSession
    const res = await waitingGET()
    mockCookie = undefined
    expect(res.status).toBe(200)
    expect(((await res.json()).data as unknown[]).length).toBe(5)
  })
})

describe('People screen wiring (source text)', () => {
  const s = readFileSync('components/farm/people.tsx', 'utf8')
  it('shows the panel to owners only and resends through the #436 PATCH', () => {
    expect(s).toContain("role === 'owner' && <WaitingToSignIn")
    expect(s).toContain('/api/employees/sign-in-waiting')
    expect(s).toMatch(/apiClient\.patch<[^>]*>\(`\/api\/employees\/\$\{r\.employeeId\}\/email-login`/)
    expect(s).toContain('Resend link')
    expect(s).toContain('Set PIN')
  })
})
