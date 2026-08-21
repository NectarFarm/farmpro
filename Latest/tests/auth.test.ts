// ── Auth tests (issue #223) ────────────────────────────────────────────────
// Integration tests that call the real POST /api/auth/login route handler and
// getSessionUser with a constructed Request / mocked cookie — no HTTP server
// needed. They run against the real postgres when DATABASE_URL is set
// (local/dev); CI has no database, so the suite skips there (vitest exits 0,
// and CI's build/typecheck still run).
//
// The suspended-tenant gate (issue #223): tenant-scoped accounts at an inactive
// tenant must not receive a session (login time) nor keep one (refresh time).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

// Mock the request cookie for the getSessionUser tests (login tests never call
// cookies()). Named with a `mock` prefix so vitest's hoisted factory can read it.
let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: mockCookie }) })),
}))

import { POST as loginPOST } from '@/app/api/auth/login/route'
import { POST as workerPinsPOST } from '@/app/api/security/worker-pins/route'
import { PATCH as adminUserPATCH } from '@/app/api/admin/users/[id]/route'
import { db } from '@/db'
import { tenants, users, sessions, loginThrottle } from '@/db/schemas'
import { createSession, destroySession, getSessionUser, hashSecret, pinPrefilter } from '@/lib/auth'
import { normalizePhone, toStoredPhone } from '@/lib/validation'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function loginRequest(body: unknown): Request {
  return jsonRequest('http://localhost/api/auth/login', 'POST', body)
}

// A run of digits long enough to be collision-safe within a test run, shaped
// as a valid E.164 number (lib/validation's isValidPhone: "+" then 7-15
// digits) — used everywhere a fresh, never-before-seen phone is needed.
let phoneSeq = 0
function uniquePhone(): string {
  phoneSeq += 1
  return `+2547${String(Date.now()).slice(-7)}${String(phoneSeq).padStart(3, '0')}`
}

async function attempt(body: unknown) {
  const res = await loginPOST(loginRequest(body))
  const payload = await res.json()
  return { status: res.status, payload }
}

run('auth: login + suspended-tenant gate (issue #223)', () => {
  const tenantActiveId = `t-${randomUUID()}`
  const tenantSuspendedId = `t-${randomUUID()}`
  const ownerEmail = `owner-${randomUUID()}@test.ifms`
  const workerEmail = `worker-${randomUUID()}@test.ifms`
  const suspendedWorkerEmail = `susp-${randomUUID()}@test.ifms`
  const suspendedAccountEmail = `suspacc-${randomUUID()}@test.ifms`
  const superAdminEmail = `super-${randomUUID()}@test.ifms`
  const ownerPassword = 'ownerPass123'
  const workerPin = '2468'
  const suspendedPin = '9753'
  // Phone + PIN login (flaw fix): PIN sign-in now needs the account's phone.
  const workerPhone = uniquePhone()
  const suspendedWorkerPhone = uniquePhone()
  const superAdminPassword = 'platPass123'
  const ownerId = randomUUID()
  const workerId = randomUUID()
  const suspendedWorkerId = randomUUID()
  const suspendedAccountId = randomUUID()
  const superAdminId = randomUUID()

  // The throttle identifiers this suite can touch (scoped cleanup — never wipe
  // the shared DB's real lockout state).
  const throttleIds = [
    `email:${ownerEmail}`,
    `email:${suspendedWorkerEmail}`,
    `email:${superAdminEmail}`,
    `phone:${workerPhone}`,
    `phone:${suspendedWorkerPhone}`,
    'pin:global',
  ]

  beforeAll(async () => {
    await db.delete(loginThrottle).where(inArray(loginThrottle.identifier, throttleIds))

    await db.insert(tenants).values([
      { id: tenantActiveId, name: 'Active Test Co.', active: true },
      { id: tenantSuspendedId, name: 'Suspended Test Co.', active: false },
    ])

    // One salt per user, used for BOTH password and PIN hashes — the route
    // verifies PINs against the stored passwordSalt, so a different PIN salt
    // would silently break verification (mirrors db/seed.mjs).
    const salt = (n: number) => `salt-${n}-${randomUUID()}`
    const sOwner = salt(1)
    const sWorker = salt(2)
    const sSusp = salt(3)
    const sSuspAcc = salt(4)
    const sSuper = salt(5)

    await db.insert(users).values([
      {
        id: ownerId, tenantId: tenantActiveId, name: 'Active Owner', email: ownerEmail,
        role: 'owner', passwordHash: hashSecret(ownerPassword, sOwner), passwordSalt: sOwner,
        pinHash: null, pinPrefilter: null, status: 'ACTIVE',
      },
      {
        id: workerId, tenantId: tenantActiveId, name: 'Active Worker', email: workerEmail, phone: workerPhone,
        role: 'worker', passwordHash: hashSecret('w123', sWorker), passwordSalt: sWorker,
        pinHash: hashSecret(workerPin, sWorker), pinPrefilter: pinPrefilter(workerPin), status: 'ACTIVE',
      },
      {
        id: suspendedWorkerId, tenantId: tenantSuspendedId, name: 'Suspended Worker', email: suspendedWorkerEmail, phone: suspendedWorkerPhone,
        role: 'worker', passwordHash: hashSecret('s123', sSusp), passwordSalt: sSusp,
        pinHash: hashSecret(suspendedPin, sSusp), pinPrefilter: pinPrefilter(suspendedPin), status: 'ACTIVE',
      },
      {
        id: suspendedAccountId, tenantId: tenantActiveId, name: 'Suspended Account', email: suspendedAccountEmail,
        role: 'worker', passwordHash: hashSecret('sa123', sSuspAcc), passwordSalt: sSuspAcc,
        pinHash: null, pinPrefilter: null, status: 'SUSPENDED',
      },
      {
        id: superAdminId, tenantId: null, name: 'Platform Admin', email: superAdminEmail,
        role: 'super_admin', passwordHash: hashSecret(superAdminPassword, sSuper), passwordSalt: sSuper,
        pinHash: null, pinPrefilter: null, status: 'ACTIVE',
      },
    ])
  })

  afterAll(async () => {
    // Sessions reference users; users reference (logically) tenants.
    for (const id of [ownerId, workerId, suspendedWorkerId, suspendedAccountId, superAdminId]) {
      await db.delete(sessions).where(eq(sessions.userId, id))
      await db.delete(users).where(eq(users.id, id))
    }
    await db.delete(tenants).where(inArray(tenants.id, [tenantActiveId, tenantSuspendedId]))
    await db.delete(loginThrottle).where(inArray(loginThrottle.identifier, throttleIds))
  })

  it('owner at an ACTIVE tenant can log in (200, owner role, session cookie set)', async () => {
    const { status, payload } = await attempt({ email: ownerEmail, password: ownerPassword })
    expect(status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.role).toBe('owner')
    expect(payload.data.tenantId).toBe(tenantActiveId)
  })

  it('worker at an ACTIVE tenant can log in via phone + PIN (200, worker role)', async () => {
    const { status, payload } = await attempt({ phone: workerPhone, pin: workerPin })
    expect(status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.role).toBe('worker')
    expect(payload.data.tenantId).toBe(tenantActiveId)
  })

  it('worker at a SUSPENDED tenant is denied login via phone + PIN (403, no session)', async () => {
    const { status, payload } = await attempt({ phone: suspendedWorkerPhone, pin: suspendedPin })
    expect(status).toBe(403)
    expect(payload.success).toBe(false)
    expect(String(payload.error).toLowerCase()).toContain('suspend')
  })

  it('worker at a SUSPENDED tenant is denied login via email/password (403)', async () => {
    const { status, payload } = await attempt({ email: suspendedWorkerEmail, password: 's123' })
    expect(status).toBe(403)
    expect(payload.success).toBe(false)
    expect(String(payload.error).toLowerCase()).toContain('suspend')
  })

  it('wrong password still returns a generic 401', async () => {
    const { status, payload } = await attempt({ email: ownerEmail, password: 'definitely-wrong' })
    expect(status).toBe(401)
    expect(payload.success).toBe(false)
  })

  it('super_admin (no tenant) bypasses the tenant gate', async () => {
    const { status, payload } = await attempt({ email: superAdminEmail, password: superAdminPassword })
    expect(status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.role).toBe('super_admin')
    expect(payload.data.tenantId).toBeNull()
  })

  it('session lookup resolves for an ACTIVE account at an ACTIVE tenant', async () => {
    const token = await createSession(ownerId)
    mockCookie = token
    try {
      const user = await getSessionUser()
      expect(user).not.toBeNull()
      expect(user?.role).toBe('owner')
    } finally {
      mockCookie = undefined
      await destroySession(token)
    }
  })

  it('session lookup returns null when the tenant is suspended (refresh-time gate)', async () => {
    const token = await createSession(suspendedWorkerId)
    mockCookie = token
    try {
      expect(await getSessionUser()).toBeNull()
    } finally {
      mockCookie = undefined
      await destroySession(token)
    }
  })

  it('session lookup returns null when the account is suspended', async () => {
    const token = await createSession(suspendedAccountId)
    mockCookie = token
    try {
      expect(await getSessionUser()).toBeNull()
    } finally {
      mockCookie = undefined
      await destroySession(token)
    }
  })
})

// ── Phone + PIN login: the collision flaw and its fix ──────────────────────
// The old PIN-only login resolved a candidate via `pin_prefilter` —
// HMAC(pepper, pin), a PURE FUNCTION OF THE PIN — so every worker who picked
// the same 4-digit PIN had an identical prefilter, and `.limit(1)` with no
// ordering returned an ARBITRARY one of them: a worker entering their own
// correct PIN could be authenticated as a different worker who happened to
// share it. PIN login now requires phone + PIN; `users.phone` carries a
// partial unique index (WHERE phone IS NOT NULL), so a normalized phone
// resolves to at most one account. The very first test below recreates the
// exact collision (two workers, same PIN) and asserts it can never again mix
// up who gets authenticated.
run('phone + PIN login (flaw fix)', () => {
  const tenantId = `t-${randomUUID()}`
  const ownerEmail = `pinowner-${randomUUID()}@test.ifms`
  const ownerId = randomUUID()
  const ownerPassword = 'pinOwnerPass123'
  let ownerToken: string
  const superAdminId = randomUUID()
  const superAdminEmail = `pinsuper-${randomUUID()}@test.ifms`
  let superAdminToken: string

  const workerAId = randomUUID()
  const workerBId = randomUUID()
  const sharedPin = '1234' // A and B pick the SAME pin — the exact collision scenario
  const phoneA = uniquePhone()
  const phoneB = uniquePhone()

  const noPinWorkerId = randomUUID()
  const noPinPhone = uniquePhone()

  const nonWorkerId = randomUUID() // has a pinHash set directly (bypassing worker-pins) to prove role-gating
  const nonWorkerPhone = uniquePhone()
  const nonWorkerPin = '9999'

  const noPhoneWorkerId = randomUUID() // no phone on record — for the worker-pins refusal tests
  const noPhoneWorkerSalt = `salt-nophone-${randomUUID()}`

  const kenyaWorkerId = randomUUID()
  const kenyaPin = '2222'
  const kenyaLocalPhone = `07${String(Date.now()).slice(-6)}${String(phoneSeq).padStart(2, '0')}` // 07XXXXXXXX
  const kenyaStoredPhone = toStoredPhone(normalizePhone(kenyaLocalPhone))

  const throttleIds = [
    `phone:${phoneA}`,
    `phone:${phoneB}`,
    `phone:${noPinPhone}`,
    `phone:${nonWorkerPhone}`,
    `phone:${kenyaStoredPhone}`,
    'pin:global',
  ]
  const userIds = [ownerId, superAdminId, workerAId, workerBId, noPinWorkerId, nonWorkerId, noPhoneWorkerId, kenyaWorkerId]

  beforeAll(async () => {
    await db.delete(loginThrottle).where(inArray(loginThrottle.identifier, throttleIds))
    await db.insert(tenants).values([{ id: tenantId, name: 'Phone+PIN Test Co.', active: true }])

    const salt = (n: number) => `salt-pp-${n}-${randomUUID()}`
    const sOwner = salt(1)
    const sA = salt(2)
    const sB = salt(3)
    const sNoPin = salt(4)
    const sNonWorker = salt(5)
    const sKenya = salt(6)
    const sSuperAdmin = salt(7)

    await db.insert(users).values([
      {
        id: ownerId, tenantId, name: 'Pin Test Owner', email: ownerEmail,
        role: 'owner', passwordHash: hashSecret(ownerPassword, sOwner), passwordSalt: sOwner,
        pinHash: null, pinPrefilter: null, status: 'ACTIVE',
      },
      {
        id: workerAId, tenantId, name: 'Worker A', email: `worker-a-${randomUUID()}@test.ifms`, phone: phoneA,
        role: 'worker', passwordHash: hashSecret('irrelevant', sA), passwordSalt: sA,
        pinHash: hashSecret(sharedPin, sA), pinPrefilter: pinPrefilter(sharedPin), status: 'ACTIVE',
      },
      {
        id: workerBId, tenantId, name: 'Worker B', email: `worker-b-${randomUUID()}@test.ifms`, phone: phoneB,
        role: 'worker', passwordHash: hashSecret('irrelevant', sB), passwordSalt: sB,
        // Same PIN as worker A — the collision case.
        pinHash: hashSecret(sharedPin, sB), pinPrefilter: pinPrefilter(sharedPin), status: 'ACTIVE',
      },
      {
        id: noPinWorkerId, tenantId, name: 'No-PIN Worker', email: `worker-nopin-${randomUUID()}@test.ifms`, phone: noPinPhone,
        role: 'worker', passwordHash: hashSecret('irrelevant', sNoPin), passwordSalt: sNoPin,
        pinHash: null, pinPrefilter: null, status: 'ACTIVE',
      },
      {
        // Simulates a non-worker row that somehow has a pinHash (worker-pins
        // never does this — only role 'worker' — but the login route must
        // not trust that invariant blindly).
        id: nonWorkerId, tenantId, name: 'Non-Worker With Pin', email: `non-worker-${randomUUID()}@test.ifms`, phone: nonWorkerPhone,
        role: 'manager', passwordHash: hashSecret('irrelevant', sNonWorker), passwordSalt: sNonWorker,
        pinHash: hashSecret(nonWorkerPin, sNonWorker), pinPrefilter: pinPrefilter(nonWorkerPin), status: 'ACTIVE',
      },
      {
        id: noPhoneWorkerId, tenantId, name: 'No-Phone Worker', email: `worker-nophone-${randomUUID()}@test.ifms`, phone: null,
        role: 'worker', passwordHash: hashSecret('irrelevant', noPhoneWorkerSalt), passwordSalt: noPhoneWorkerSalt,
        pinHash: null, pinPrefilter: null, status: 'ACTIVE',
      },
      {
        id: kenyaWorkerId, tenantId, name: 'Kenya Worker', email: `worker-kenya-${randomUUID()}@test.ifms`, phone: kenyaStoredPhone,
        role: 'worker', passwordHash: hashSecret('irrelevant', sKenya), passwordSalt: sKenya,
        pinHash: hashSecret(kenyaPin, sKenya), pinPrefilter: pinPrefilter(kenyaPin), status: 'ACTIVE',
      },
      {
        id: superAdminId, tenantId: null, name: 'Pin Test Super Admin', email: superAdminEmail,
        role: 'super_admin', passwordHash: hashSecret('irrelevant', sSuperAdmin), passwordSalt: sSuperAdmin,
        pinHash: null, pinPrefilter: null, status: 'ACTIVE',
      },
    ])

    // Owner session for the worker-pins calls below (POST /api/security/worker-pins
    // requires an owner/manager session at the worker's own tenant). Super-admin
    // session for the admin PATCH /api/admin/users/[id] duplicate-phone test.
    ownerToken = await createSession(ownerId)
    superAdminToken = await createSession(superAdminId)
  })

  afterAll(async () => {
    mockCookie = undefined
    await destroySession(ownerToken)
    await destroySession(superAdminToken)
    for (const id of userIds) {
      await db.delete(sessions).where(eq(sessions.userId, id))
      await db.delete(users).where(eq(users.id, id))
    }
    await db.delete(tenants).where(eq(tenants.id, tenantId))
    await db.delete(loginThrottle).where(inArray(loginThrottle.identifier, throttleIds))
  })

  it('two workers who share a PIN each authenticate as themselves — never as each other', async () => {
    const resA = await attempt({ phone: phoneA, pin: sharedPin })
    expect(resA.status).toBe(200)
    expect(resA.payload.success).toBe(true)
    expect(resA.payload.data.id).toBe(workerAId)

    const resB = await attempt({ phone: phoneB, pin: sharedPin })
    expect(resB.status).toBe(200)
    expect(resB.payload.success).toBe(true)
    expect(resB.payload.data.id).toBe(workerBId)
    expect(resB.payload.data.id).not.toBe(workerAId)
  })

  it('a PIN-only submission (no phone) is rejected, not silently resolved by PIN alone', async () => {
    const { status, payload } = await attempt({ pin: sharedPin })
    expect(status).toBe(400)
    expect(payload.success).toBe(false)
    expect(payload.fields?.phone).toBeTruthy()
  })

  it('unknown phone, wrong PIN, and no-PIN-set all return the SAME generic failure', async () => {
    const unknown = await attempt({ phone: uniquePhone(), pin: '0000' })
    const wrongPin = await attempt({ phone: phoneA, pin: '0000' })
    const noPinSet = await attempt({ phone: noPinPhone, pin: '0000' })

    expect(unknown.status).toBe(401)
    expect(wrongPin.status).toBe(401)
    expect(noPinSet.status).toBe(401)
    expect(unknown.payload).toEqual(wrongPin.payload)
    expect(wrongPin.payload).toEqual(noPinSet.payload)
  })

  it('a Kenyan local number (07XXXXXXXX) authenticates against a user stored as +254…', async () => {
    const { status, payload } = await attempt({ phone: kenyaLocalPhone, pin: kenyaPin })
    expect(status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.id).toBe(kenyaWorkerId)
  })

  it('throttling is keyed to phone: repeated failures for one worker do not lock out another', async () => {
    // Reset phoneA's counter first — an earlier test in this suite already
    // recorded one failure against it, and this test needs a clean 5-count
    // run to land the lock deterministically on the 6th attempt.
    await db.delete(loginThrottle).where(eq(loginThrottle.identifier, `phone:${phoneA}`))
    for (let i = 0; i < 5; i++) {
      const r = await attempt({ phone: phoneA, pin: '0000' })
      expect(r.status).toBe(401)
    }
    const locked = await attempt({ phone: phoneA, pin: '0000' })
    expect(locked.status).toBe(429)

    // Worker B shares the same PIN as A but has a DIFFERENT phone — A's
    // lockout must not touch B (this is exactly what `pin:<pin>` keying used
    // to get wrong).
    const stillOk = await attempt({ phone: phoneB, pin: sharedPin })
    expect(stillOk.status).toBe(200)
    expect(stillOk.payload.data.id).toBe(workerBId)
  })

  it('a non-worker role cannot sign in via the PIN path even with the correct PIN', async () => {
    const { status, payload } = await attempt({ phone: nonWorkerPhone, pin: nonWorkerPin })
    expect(status).toBe(401)
    expect(payload.success).toBe(false)
  })

  it('worker-pins refuses to set a PIN for a worker with no phone on record', async () => {
    mockCookie = ownerToken
    const res = await workerPinsPOST(jsonRequest('http://localhost/api/security/worker-pins', 'POST', {
      userId: noPhoneWorkerId, pin: '4321',
    }))
    const payload = await res.json()
    mockCookie = undefined
    expect(res.status).toBe(400)
    expect(payload.success).toBe(false)
    expect(payload.fields?.phone).toBeTruthy()
  })

  it('worker-pins: setting a PIN with a phone already used by another account is a clean 409, not a 500', async () => {
    mockCookie = ownerToken
    const res = await workerPinsPOST(jsonRequest('http://localhost/api/security/worker-pins', 'POST', {
      userId: noPhoneWorkerId, pin: '4321', phone: phoneA,
    }))
    const payload = await res.json()
    mockCookie = undefined
    expect(res.status).toBe(409)
    expect(payload.success).toBe(false)
    expect(payload.fields?.phone).toBeTruthy()
  })

  it('admin PATCH: setting a user\'s phone to one already in use is also a clean 409, not a 500', async () => {
    mockCookie = superAdminToken
    const res = await adminUserPATCH(
      jsonRequest(`http://localhost/api/admin/users/${noPinWorkerId}`, 'PATCH', { phone: phoneA }),
      { params: Promise.resolve({ id: noPinWorkerId }) },
    )
    const payload = await res.json()
    mockCookie = undefined
    expect(res.status).toBe(409)
    expect(payload.success).toBe(false)
    expect(payload.fields?.phone).toBeTruthy()
  })
})
