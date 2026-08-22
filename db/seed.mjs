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

// `phone` is required for a worker's PIN to be usable at all (login now
// resolves the PIN-login candidate by phone, not by PIN alone — issue: PIN
// alone let one worker sign in as another). Only the two workers get one;
// other roles sign in with email/password and phone stays null for them.
//
// The demo LOGIN accounts (james/peter/john/susan/vet/auditor/admin@ifms.co)
// that used to live here are gone (real-admin-and-demo-cleanup task) — this
// is now a public app with one real super_admin (see scripts/
// seed-real-admin.mjs), and shipping well-known email/password pairs to
// production was the whole problem. This file still seeds tenants t1/t2 and
// farms f1/f2 for local dev — scripts/seed-demo-data.mjs's operational rows
// (batches, sales, tasks, etc.) hang off those ids and keep working with no
// USERS rows at all, since every lookup in that script already tolerates a
// missing user (`if (vetUser) {...}`, `payrollOwner ? ... : 'demo-owner'`).
// A local developer who needs a login signs in with the real admin account
// seeded by scripts/seed-real-admin.mjs, or registers/impersonates from there.
const USERS = []

const FARMS = [
  { id: 'f1', tenantId: 't1', name: 'Nakuru Main Farm', location: 'Nakuru', code: 'FRM-NAKURU-MAIN', latitude: -0.3031, longitude: 36.0800 },
  { id: 'f2', tenantId: 't1', name: 'Eldoret Satellite', location: 'Eldoret', code: 'FRM-ELDORET-SATE', latitude: 0.5143, longitude: 35.2698 },
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
      INSERT INTO users (id, tenant_id, name, email, role, password_hash, password_salt, pin_hash, pin_prefilter, phone, status)
      VALUES (${randomUUID()}, ${u.tenantId}, ${u.name}, ${u.email}, ${u.role},
              ${hash(u.password, salt)}, ${salt}, ${u.pin ? hash(u.pin, salt) : null},
              ${u.pin ? pinPrefilter(u.pin) : null}, ${u.phone}, 'ACTIVE')
      ON CONFLICT (email) DO UPDATE SET pin_prefilter = EXCLUDED.pin_prefilter, phone = EXCLUDED.phone
    `
    if (res.count > 0) inserted += 1
  }
  let farmInserted = 0
  for (const f of FARMS) {
    const res = await sql`
      INSERT INTO farms (id, tenant_id, name, location, code, latitude, longitude)
      VALUES (${f.id}, ${f.tenantId}, ${f.name}, ${f.location}, ${f.code}, ${f.latitude ?? null}, ${f.longitude ?? null})
      -- Coordinates are updated on conflict so an existing demo database picks
      -- them up; without them the weather screen has nowhere to ask about.
      ON CONFLICT (tenant_id, code) DO UPDATE
        SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
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
