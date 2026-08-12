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
const pinPrefilter = (pin) => createHmac('sha256', process.env.AUTH_PIN_PEPPER ?? 'ifms-dev-pepper').update(pin).digest('hex')

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
  console.log(`seed ok: ${tenantInserted} tenants inserted (${TENANTS.length} total), ${inserted} users inserted (${USERS.length} total), ${farmInserted} farms inserted (${FARMS.length} total)`)
} catch (err) {
  console.error('seed failed:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
