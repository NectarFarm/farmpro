// ── IFMS demo seed (issue #221) ────────────────────────────────────────────
// Real accounts + farms for the shell verification. Idempotent: workers get
// pin_prefilter upserted, everything else ON CONFLICT DO NOTHING, so
// `pnpm db:seed` is safe to re-run. Run after `pnpm db:migrate`.
//
//   pnpm db:seed
//
// The password/PIN hashing matches lib/auth.ts (scrypt, 64-byte, per-user salt)
// and pinPrefilter matches lib/auth.ts pinPrefilter (same HMAC pepper + dev
// fallback), so the same schemes verify logins at runtime.
import postgres from 'postgres'
import { createHmac, randomBytes, randomUUID, scryptSync } from 'node:crypto'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:ifms@localhost:55433/ifms'
const sql = postgres(DATABASE_URL, { prepare: false })

const hash = (secret, salt) => scryptSync(secret, salt, 64).toString('hex')
const saltFor = () => randomBytes(16).toString('hex')
// Keep in sync with lib/auth.ts pinPrefilter (same env var, same dev fallback).
// Uses `||` (not `??`) so an empty-string AUTH_PIN_PEPPER — e.g. if this script
// is ever run with `.env` auto-loaded — falls back the same way lib/auth.ts
// does, instead of peppering with "" (issue #272).
const pinPrefilter = (pin) => createHmac('sha256', process.env.AUTH_PIN_PEPPER || 'ifms-dev-pepper').update(pin).digest('hex')

const TENANTS = [
  { id: 't1', name: 'Nakuru Farm Co.', active: true },
  { id: 't2', name: 'Suspended Farm Co.', active: false },
]

const USERS = [
  { email: 'james@nakurufarm.com', password: 'farm2026', pin: null, role: 'owner', name: 'James Kamau', tenantId: 't1' },
  { email: 'peter@nakurufarm.com', password: 'mgr123', pin: null, role: 'manager', name: 'Peter Njoroge', tenantId: 't1' },
  { email: 'john@nakurufarm.com', password: 'worker123', pin: '1234', role: 'worker', name: 'John Kamau', tenantId: 't1' },
  { email: 'vet@nakurufarm.com', password: 'vet123', pin: null, role: 'vet', name: 'Dr. Grace Wanjiru', tenantId: 't1' },
  { email: 'auditor@ifms.co', password: 'aud123', pin: null, role: 'auditor', name: 'Alice Auditor', tenantId: 't1' },
  { email: 'susan@nakurufarm.com', password: 'susp123', pin: '5678', role: 'worker', name: 'Susan Mwangi', tenantId: 't2' },
  { email: 'admin@ifms.co', password: 'admin2026', pin: null, role: 'super_admin', name: 'IFMS Admin', tenantId: null },
]

const FARMS = [
  { id: 'f1', tenantId: 't1', name: 'Nakuru Main Farm', location: 'Nakuru', code: 'FRM-NAKURU-MAIN' },
  { id: 'f2', tenantId: 't1', name: 'Eldoret Satellite', location: 'Eldoret', code: 'FRM-ELDORET-SATE' },
]

// ── Demo data: units / batches / employees per farm ─────────────────────────
// So a fresh `pnpm db:seed` has something real to show on both farms (the farm
// switcher filters Crops by unit farm, and People by the employee's assigned
// batches' farms — see components/farm/people.tsx). Fixed IDs + ON CONFLICT
// DO NOTHING keep this idempotent and identical to a previously-seeded DB.
const DEMO_UNITS = [
  // Nakuru (mirrors the rows the running dev DB already had, if present)
  { id: 'b420423b-1860-468c-8c73-29b68d7a3e8f', tenantId: 't1', farmId: 'f1', type: 'house', name: 'House 001', code: 'HSE-NAKURU-001' },
  // Eldoret
  { id: 'e1d0ret-0000-0000-0000-000000000001', tenantId: 't1', farmId: 'f2', type: 'house', name: 'House E01', code: 'HSE-ELDORET-001' },
]

const DEMO_BATCHES = [
  // Nakuru
  { id: '2990a223-6106-408d-a19f-3e2fe74e16b0', tenantId: 't1', unitId: 'b420423b-1860-468c-8c73-29b68d7a3e8f', code: 'BRO-NAKURU-001', name: 'Broilers Batch – Aug 2026', species: 'Spring hen', enterprise: 'broiler', initialQty: 1200, currentQty: 1200, costCents: 1200000 },
  // Eldoret
  { id: 'e1d0ret-0000-0000-0000-000000000002', tenantId: 't1', unitId: 'e1d0ret-0000-0000-0000-000000000001', code: 'BRO-ELDORET-001', name: 'Eldoret Broiler Run', species: 'Cobb 500', enterprise: 'broiler', initialQty: 500, currentQty: 480, costCents: 600000 },
]

const DEMO_EMPLOYEES = [
  // Nakuru
  { id: '472e6747-7b6c-4074-8efa-6b2ee2513329', tenantId: 't1', name: 'Akai Elim', phone: '+254799979067', role: 'worker', batchIds: ['2990a223-6106-408d-a19f-3e2fe74e16b0'] },
  // Eldoret
  { id: 'e1d0ret-0000-0000-0000-000000000003', tenantId: 't1', name: 'Lydia Chebet', phone: '+254711222333', role: 'worker', batchIds: ['e1d0ret-0000-0000-0000-000000000002'] },
]

try {
  let tenantInserted = 0
  for (const t of TENANTS) {
    const res = await sql`
      INSERT INTO tenants (id, name, active)
      VALUES (${t.id}, ${t.name}, ${t.active})
      ON CONFLICT (id) DO NOTHING
    `
    if (res.count > 0) tenantInserted += 1
  }
  let inserted = 0
  for (const u of USERS) {
    const salt = saltFor()
    const res = await sql`
      INSERT INTO users (id, tenant_id, name, email, role, password_hash, password_salt, pin_hash, pin_prefilter, status)
      VALUES (${randomUUID()}, ${u.tenantId}, ${u.name}, ${u.email}, ${u.role},
              ${hash(u.password, salt)}, ${salt}, ${u.pin ? hash(u.pin, salt) : null},
              ${u.pin ? pinPrefilter(u.pin) : null}, 'ACTIVE')
      ON CONFLICT (email) DO UPDATE SET pin_prefilter = EXCLUDED.pin_prefilter
    `
    if (res.count > 0) inserted += 1
  }
  let farmInserted = 0
  for (const f of FARMS) {
    const res = await sql`
      INSERT INTO farms (id, tenant_id, name, location, code)
      VALUES (${f.id}, ${f.tenantId}, ${f.name}, ${f.location}, ${f.code})
      ON CONFLICT (tenant_id, code) DO NOTHING
    `
    if (res.count > 0) farmInserted += 1
  }
  let unitInserted = 0
  for (const u of DEMO_UNITS) {
    const res = await sql`
      INSERT INTO production_units (id, tenant_id, farm_id, type, name, code, status)
      VALUES (${u.id}, ${u.tenantId}, ${u.farmId}, ${u.type}, ${u.name}, ${u.code}, 'ACTIVE')
      ON CONFLICT (tenant_id, code) DO NOTHING
    `
    if (res.count > 0) unitInserted += 1
  }
  let batchInserted = 0
  for (const b of DEMO_BATCHES) {
    const res = await sql`
      INSERT INTO batches (id, tenant_id, unit_id, code, name, species, enterprise, stage, status, initial_qty, current_qty, acquisition_cost_cents)
      VALUES (${b.id}, ${b.tenantId}, ${b.unitId}, ${b.code}, ${b.name}, ${b.species}, ${b.enterprise}, '', 'ACTIVE', ${b.initialQty}, ${b.currentQty}, ${b.costCents})
      ON CONFLICT (tenant_id, code) DO NOTHING
    `
    if (res.count > 0) batchInserted += 1
  }
  let employeeInserted = 0
  for (const e of DEMO_EMPLOYEES) {
    const res = await sql`
      INSERT INTO employees (id, tenant_id, name, phone, role, assigned_batch_ids, mortality_photo_threshold, status)
      VALUES (${e.id}, ${e.tenantId}, ${e.name}, ${e.phone}, ${e.role}, ${e.batchIds}, 3, 'ACTIVE')
      ON CONFLICT (id) DO NOTHING
    `
    if (res.count > 0) employeeInserted += 1
  }
  console.log(`seed ok: ${tenantInserted} tenants inserted (${TENANTS.length} total), ${inserted} users inserted (${USERS.length} total), ${farmInserted} farms inserted (${FARMS.length} total), ${unitInserted} units, ${batchInserted} batches, ${employeeInserted} employees`)
} catch (err) {
  console.error('seed failed:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
