// ── A capability added later must not silently demote the full admins ───────
// Adding `catalogue.manage` made "full capability admin" mean "holds all ten".
// A row saved when there were nine, listing all nine, stopped resolving as
// full, so countFullCapabilityAdmins() could read 0 and the "last admin with
// every capability" guard stopped protecting anything. drizzle/0052 grants the
// new capability to exactly those rows.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, inArray, sql } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

import { db } from '@/db'
import { users, platformStaff } from '@/db/schemas'
import { hashSecret } from '@/lib/auth'
import { isFullCapabilityAdmin, countFullCapabilityAdmins, CAPABILITIES } from '@/lib/platform-staff'

const run = process.env.DATABASE_URL ? describe : describe.skip

const NINE_BEFORE = CAPABILITIES.filter((c) => c !== 'catalogue.manage')
const migration = readFileSync(join(process.cwd(), 'drizzle/0052_staff_catalogue_manage.sql'), 'utf8')

run('drizzle/0052 keeps a pre-existing full admin full', () => {
  const fullId = `usr-${randomUUID()}`
  const partialId = `usr-${randomUUID()}`
  const ids = [fullId, partialId]

  beforeAll(async () => {
    const salt = randomUUID()
    for (const id of ids) {
      await db.insert(users).values({
        id, tenantId: null, name: 'Staff', email: `staff-${randomUUID()}@test.ifms`, role: 'super_admin',
        passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE',
      })
    }
    await db.insert(platformStaff).values([
      { userId: fullId, title: 'Founder', capabilities: [...NINE_BEFORE], active: true, createdBy: 'test' },
      { userId: partialId, title: 'Support', capabilities: ['support.handle', 'support.assign'], active: true, createdBy: 'test' },
    ])
  })
  afterAll(async () => {
    await db.delete(platformStaff).where(inArray(platformStaff.userId, ids))
    await db.delete(users).where(inArray(users.id, ids))
  })

  async function shapeOf(id: string) {
    const [row] = await db.select().from(platformStaff).where(eq(platformStaff.userId, id))
    return { hasRow: true, active: row.active, capabilities: row.capabilities }
  }

  it('before the migration the nine-capability row no longer resolves as full', async () => {
    expect(isFullCapabilityAdmin('super_admin', await shapeOf(fullId))).toBe(false)
  })

  it('after it, that row is full again and counts as a full admin; a partial row is untouched', async () => {
    const before = await countFullCapabilityAdmins()
    await db.execute(sql.raw(migration))
    expect(isFullCapabilityAdmin('super_admin', await shapeOf(fullId))).toBe(true)
    expect(await countFullCapabilityAdmins()).toBeGreaterThanOrEqual(before + 1)
    expect((await shapeOf(partialId)).capabilities).toEqual(['support.handle', 'support.assign'])
  })

  it('is idempotent', async () => {
    await db.execute(sql.raw(migration))
    const caps = (await shapeOf(fullId)).capabilities
    expect(caps.filter((c) => c === 'catalogue.manage')).toHaveLength(1)
  })
})
