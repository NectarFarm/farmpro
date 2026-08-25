// ── Configurable stages, and the free-text field they replace ───────────────
// What was wrong: `batches.stage` is `text('stage').notNull().default('')`, and
// the only thing that ever wrote it was a free-text input on the batch detail
// screen ("Advance Stage", placeholdered "e.g. Grower, Finisher, Peak Lay…").
// PATCH /api/batches/[id] accepted any string at all. So "Finisher",
// "finisher" and "Finishr" became three distinct stages on the same farm, and
// anything that ever buckets by stage fragments silently.
//
// Nothing anywhere knew how long a stage was meant to last either — that is
// the "stage life" the new table adds.
//
// The pure blocks run everywhere. The integration block needs real Postgres
// and skips without DATABASE_URL, like the rest of the suite.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import {
  normalizeEnterprise, stageKey, nextStageAfter,
  MAX_STAGE_NAME_CHARS, MAX_STAGES_PER_ENTERPRISE, MAX_TYPICAL_DAYS,
  type StageRow,
} from '@/lib/stages'
import { GET as stagesGET, PUT as stagesPUT } from '@/app/api/stages/route'
import { PATCH as batchPATCH } from '@/app/api/batches/[id]/route'
import { db } from '@/db'
import {
  tenants, users, sessions, farms, productionUnits, batches, batchStages,
  auditLog, tenantEnterprises,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

const stage = (name: string, sortOrder: number, typicalDays: number | null = null): StageRow =>
  ({ id: name, enterprise: 'broiler', name, sortOrder, typicalDays })

// ───────────────────────────────────────────────────────────────────────────
describe('lib/stages.ts — normalisation', () => {
  it('lower-cases and trims an enterprise key, matching lib/enterprises.ts', () => {
    // The key crosses a boundary (a query param, a batch row, a typed grant),
    // and 'Broiler' must not become a second enterprise beside 'broiler'.
    expect(normalizeEnterprise(' Broiler ')).toBe('broiler')
    expect(normalizeEnterprise('DAIRY_COW')).toBe('dairy_cow')
    expect(normalizeEnterprise(null)).toBe('')
    expect(normalizeEnterprise(42)).toBe('')
  })

  it('compares stage names case- and whitespace-insensitively', () => {
    // This is the whole bug in one assertion: these three were distinct.
    expect(stageKey(' Grower ')).toBe(stageKey('grower'))
    expect(stageKey('GROWER')).toBe(stageKey('Grower'))
    expect(stageKey('Finishr')).not.toBe(stageKey('Finisher'))
  })

  it('keeps the limits it advertises', () => {
    expect(MAX_STAGE_NAME_CHARS).toBeGreaterThan(0)
    expect(MAX_STAGES_PER_ENTERPRISE).toBeGreaterThan(1)
    // A stage measured in years is a mistyped figure, not a growth phase.
    expect(MAX_TYPICAL_DAYS).toBeLessThanOrEqual(3650)
  })
})

describe('lib/stages.ts — what "advance" means', () => {
  const stages = [stage('Starter', 0, 14), stage('Grower', 10, 21), stage('Finisher', 20, 14)]

  it('offers the stage after the current one, in configured order', () => {
    // Not alphabetical — Starter/Grower/Finisher is not alphabetical, and
    // guessing wrong makes the default point backwards.
    expect(nextStageAfter(stages, 'Starter')?.name).toBe('Grower')
    expect(nextStageAfter(stages, 'Grower')?.name).toBe('Finisher')
  })

  it('matches the current stage regardless of casing or spacing', () => {
    expect(nextStageAfter(stages, ' grower ')?.name).toBe('Finisher')
  })

  it('offers nothing once the batch is at the last stage', () => {
    expect(nextStageAfter(stages, 'Finisher')).toBeNull()
  })

  it('offers the FIRST stage when the batch has none, or one that is not in the list', () => {
    // Every batch created before this existed has stage ''. Falling back to
    // the first stage is what makes those advanceable at all.
    expect(nextStageAfter(stages, '')?.name).toBe('Starter')
    expect(nextStageAfter(stages, 'Something removed')?.name).toBe('Starter')
  })

  it('offers nothing at all when the farm has configured nothing', () => {
    expect(nextStageAfter([], 'Grower')).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('the migration seeds existing farms rather than locking them out', () => {
  const sql = read('drizzle/0036_batch_stages.sql')

  it('creates the table and its uniqueness guard', () => {
    expect(sql).toMatch(/CREATE TABLE "batch_stages"/)
    expect(sql).toMatch(/CREATE UNIQUE INDEX "idx_batch_stages_unique"/)
  })

  it('backfills stage names from the batches each tenant already has', () => {
    // Without this, PATCH /api/batches/[id] would refuse the very stage a
    // farm's live batches are sitting at — the "existing rows left broken"
    // case.
    expect(sql).toMatch(/INSERT INTO "batch_stages"/)
    expect(sql).toMatch(/FROM "batches" b/)
    expect(sql).toMatch(/ON CONFLICT \("tenant_id", "enterprise", "name"\) DO NOTHING/)
  })

  it('collapses names that differ only by case, so the unique index holds', () => {
    expect(sql).toMatch(/GROUP BY b\."tenant_id", lower\(trim\(b\."enterprise"\)\), lower\(trim\(b\."stage"\)\)/)
  })

  it('leaves the backfilled stage life NULL instead of inventing a duration', () => {
    // Putting a fabricated number in the field a farmer would most trust is
    // worse than rendering "not set".
    expect(sql).toMatch(/"typical_days"/)
    expect(sql).toMatch(/\tNULL,/)
  })

  it('is registered in the journal at 0036', () => {
    const journal = JSON.parse(read('drizzle/meta/_journal.json')) as { entries: { idx: number; tag: string }[] }
    const entry = journal.entries.find((e) => e.tag === '0036_batch_stages')
    expect(entry).toBeTruthy()
    expect(entry?.idx).toBe(36)
    // 0035 is enterprise scoping, already on main — this must not collide.
    expect(journal.entries.filter((e) => e.idx === 36).length).toBe(1)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('components/farm/crops.tsx — the free-text stage input is gone', () => {
  const source = read('components/farm/crops.tsx')

  it('no longer offers a free-text box for the stage', () => {
    expect(source).not.toMatch(/placeholder="e\.g\. Grower, Finisher, Peak Lay…"/)
  })

  it('renders the farm\u2019s configured stages as a select', () => {
    expect(source).toMatch(/stageOptions\.map\(\(s\) => \(/)
    expect(source).toMatch(/\/api\/stages/)
  })

  it('defaults to the next stage in order', () => {
    expect(source).toMatch(/const suggestedStage =/)
  })

  it('shows the stage life, and says so when it is not set', () => {
    expect(source).toMatch(/stage life not set/)
  })

  it('surfaces the route\u2019s refusal instead of failing silently', () => {
    expect(source).toMatch(/setAdvanceError\(res\.error/)
  })

  it('says where to go when the enterprise has no stages yet', () => {
    expect(source).toMatch(/Settings › Farm Configuration/)
  })
})

describe('components/farm/farm-config.tsx — the screen that was missing', () => {
  const source = read('components/farm/farm-config.tsx')

  it('is owner-gated in the UI, matching what PUT /api/stages enforces', () => {
    expect(source).toMatch(/const isOwner = role === 'owner' \|\| role === 'super_admin'/)
    expect(source).toMatch(/>\s*Owner access only\s*</)
  })

  it('edits stages per enterprise, with a stage life', () => {
    expect(source).toMatch(/apiClient\.put\('\/api\/stages'/)
    expect(source).toMatch(/typicalDays: d\.days\.trim\(\) === '' \? null : Number\(d\.days\)/)
  })

  it('sends order as array position rather than a client-supplied index', () => {
    // PUT /api/stages derives sortOrder from the index, so two stages cannot
    // claim the same position.
    expect(source).toMatch(/stages: draft\.map\(\(d\) => \(\{ name: d\.name\.trim\(\)/)
  })

  it('warns before removing a stage that live batches are sitting at', () => {
    expect(source).toMatch(/const removedInUse =/)
    expect(source).toMatch(/no longer\s+contains/)
  })

  it('offers the product -> batches direction the per-batch route cannot', () => {
    expect(source).toMatch(/\/api\/products\/\$\{productId\}\/batches/)
  })

  it('names how each product link was reached, so an override is not shown as a choice', () => {
    expect(source).toMatch(/from the unit/)
    expect(source).toMatch(/added just for this batch/)
    expect(source).toMatch(/excluded from this batch/)
  })

  it('links out to units and routines instead of duplicating their editors', () => {
    expect(source).toMatch(/Production units/)
    expect(source).toMatch(/Daily routines/)
  })

  it('is registered as a screen and reachable from Settings', () => {
    expect(read('components/farm/navigation.tsx')).toMatch(/'farm-config'/)
    expect(read('app/page.tsx')).toMatch(/case 'farm-config':\s+return <FarmConfigScreen \/>/)
    expect(read('components/farm/settings.tsx')).toMatch(/navigate\('farm-config'\)/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
run('stages end to end', () => {
  const tenantId = `t-stage-${randomUUID()}`
  const farmId = `f-${randomUUID()}`
  const unitId = `u-${randomUUID()}`
  const batchId = `b-${randomUUID()}`
  const ownerId = `usr-owner-${randomUUID()}`
  const managerId = `usr-mgr-${randomUUID()}`

  let ownerSession: string
  let managerSession: string

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Stage Co.', active: true })
    await db.insert(farms).values({ id: farmId, tenantId, name: 'Farm', location: 'Thika', code: 'FRM-S' })
    await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'house', name: 'House', code: 'HSE-S' })
    const salt = randomUUID()
    await db.insert(users).values([
      { id: ownerId, tenantId, name: 'Owner', email: `owner-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: managerId, tenantId, name: 'Manager', email: `mgr-${randomUUID()}@test.ifms`, role: 'manager', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    await db.insert(tenantEnterprises).values({
      id: randomUUID(), tenantId, enterprise: 'broiler', source: 'onboarding',
    })
    ownerSession = await createSession(ownerId)
    managerSession = await createSession(managerId)
  })

  beforeEach(async () => {
    await db.delete(batchStages).where(eq(batchStages.tenantId, tenantId))
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
    await db.delete(batches).where(eq(batches.id, batchId))
    await db.insert(batches).values({
      id: batchId, tenantId, unitId, code: 'BRO-S', name: 'Broilers',
      enterprise: 'broiler', stage: '', initialQty: 100, currentQty: 100,
    })
  })

  afterAll(async () => {
    mockCookie = undefined
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
    await db.delete(batchStages).where(eq(batchStages.tenantId, tenantId))
    await db.delete(batches).where(eq(batches.id, batchId))
    await db.delete(tenantEnterprises).where(eq(tenantEnterprises.tenantId, tenantId))
    await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, managerId]))
    await db.delete(users).where(inArray(users.id, [ownerId, managerId]))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  async function putStages(body: unknown, cookie = ownerSession) {
    mockCookie = cookie
    const res = await readJson(await stagesPUT(jsonRequest('http://localhost/api/stages', 'PUT', body)))
    mockCookie = undefined
    return res
  }

  async function patchBatch(body: unknown, cookie = ownerSession) {
    mockCookie = cookie
    const res = await readJson(await batchPATCH(
      jsonRequest(`http://localhost/api/batches/${batchId}`, 'PATCH', body),
      { params: Promise.resolve({ id: batchId }) }
    ))
    mockCookie = undefined
    return res
  }

  const threeStages = {
    enterprise: 'broiler',
    stages: [
      { name: 'Starter', typicalDays: 14 },
      { name: 'Grower', typicalDays: 21 },
      { name: 'Finisher', typicalDays: null },
    ],
  }

  it('saves a stage list, in order, and reads it back', async () => {
    expect((await putStages(threeStages)).status).toBe(200)

    mockCookie = ownerSession
    const got = await readJson(await stagesGET())
    mockCookie = undefined
    expect(got.status).toBe(200)
    const names = got.payload.data.stages.map((s: { name: string }) => s.name)
    expect(names).toEqual(['Starter', 'Grower', 'Finisher'])
    // Order comes from array position, not a client-supplied number.
    const orders = got.payload.data.stages.map((s: { sortOrder: number }) => s.sortOrder)
    expect(orders).toEqual([0, 10, 20])
    // A stage life left blank stays blank rather than becoming 0.
    expect(got.payload.data.stages[2].typicalDays).toBeNull()
  })

  it('refuses a manager — this is a data-shape change, not daily operations', async () => {
    const res = await putStages(threeStages, managerSession)
    expect(res.status).toBe(403)
    const rows = await db.select().from(batchStages).where(eq(batchStages.tenantId, tenantId))
    expect(rows.length).toBe(0)
  })

  it('refuses two stages whose names differ only by case', async () => {
    // The unique index is case-SENSITIVE, so letting both through would
    // recreate the exact problem this table exists to stop.
    const res = await putStages({ enterprise: 'broiler', stages: [{ name: 'Grower' }, { name: 'grower' }] })
    expect(res.status).toBe(400)
    expect(res.payload.error).toMatch(/listed twice/i)
  })

  it('refuses a nonsense stage life instead of storing it', async () => {
    for (const bad of [0, -5, 2.5, MAX_TYPICAL_DAYS + 1]) {
      const res = await putStages({ enterprise: 'broiler', stages: [{ name: 'Grower', typicalDays: bad }] })
      expect(res.status).toBe(400)
    }
  })

  it('replaces only the named enterprise, leaving others alone', async () => {
    await putStages(threeStages)
    await putStages({ enterprise: 'layer', stages: [{ name: 'Point of lay', typicalDays: 140 }] })
    await putStages({ enterprise: 'broiler', stages: [{ name: 'Starter', typicalDays: 14 }] })

    const rows = await db.select().from(batchStages).where(eq(batchStages.tenantId, tenantId))
    expect(rows.filter((r) => r.enterprise === 'broiler').length).toBe(1)
    // Editing broilers must not wipe the layers.
    expect(rows.filter((r) => r.enterprise === 'layer').length).toBe(1)
  })

  it('audits a stage change once, naming what was removed', async () => {
    await putStages(threeStages)
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
    await putStages({ enterprise: 'broiler', stages: [{ name: 'Starter', typicalDays: 14 }] })

    const rows = await db.select().from(auditLog).where(eq(auditLog.tenantId, tenantId))
    const stageAudits = rows.filter((r) => r.action === 'stages.updated')
    expect(stageAudits.length).toBe(1)
    expect((stageAudits[0].meta as { removed: string[] }).removed).toEqual(
      expect.arrayContaining(['Grower', 'Finisher'])
    )
  })

  it('writes no audit row for a save that changed nothing', async () => {
    await putStages(threeStages)
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
    await putStages(threeStages)
    const rows = await db.select().from(auditLog).where(eq(auditLog.tenantId, tenantId))
    expect(rows.filter((r) => r.action === 'stages.updated').length).toBe(0)
  })

  describe('PATCH /api/batches/[id] is the authority on `stage`', () => {
    it('accepts a configured stage', async () => {
      await putStages(threeStages)
      const res = await patchBatch({ stage: 'Grower' })
      expect(res.status).toBe(200)
      expect(res.payload.data.stage).toBe('Grower')
    })

    it('stores the farm’s own spelling, not the caller’s', async () => {
      // A stale client sending 'grower' must not add a second spelling of a
      // stage that already exists — that is the entire point of the table.
      await putStages(threeStages)
      const res = await patchBatch({ stage: '  gRoWeR ' })
      expect(res.status).toBe(200)
      expect(res.payload.data.stage).toBe('Grower')
    })

    it('refuses an unconfigured stage, naming the ones that exist', async () => {
      await putStages(threeStages)
      const res = await patchBatch({ stage: 'Finishr' })
      expect(res.status).toBe(400)
      expect(res.payload.error).toMatch(/not one of this farm's stages/i)
      expect(res.payload.error).toMatch(/Starter, Grower, Finisher/)

      const [row] = await db.select().from(batches).where(eq(batches.id, batchId))
      expect(row.stage).toBe('')
    })

    it('lets any stage through when the farm has configured none', async () => {
      // A brand-new tenant, or one starting a new enterprise, has no rows yet.
      // Refusing here would make the first batch of every new enterprise
      // un-advanceable with no way out from inside the app.
      const res = await patchBatch({ stage: 'Whatever we call it' })
      expect(res.status).toBe(200)
      expect(res.payload.data.stage).toBe('Whatever we call it')
    })

    it('still allows clearing the stage', async () => {
      await putStages(threeStages)
      await patchBatch({ stage: 'Grower' })
      const res = await patchBatch({ stage: '' })
      expect(res.status).toBe(200)
      expect(res.payload.data.stage).toBe('')
    })
  })
})
