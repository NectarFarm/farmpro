// ── Seed the one real super_admin account (real-admin-and-demo-cleanup task) ─
// Separate from db/seed.mjs on purpose: db/seed.mjs is dev/demo tooling (run
// freely, re-run freely, safe to point at a throwaway local database) —
// production provisioning of the actual admin login is a deliberate,
// one-off act that shouldn't live next to it or run implicitly as part of a
// general "seed some demo data" script.
//
// Idempotent (ON CONFLICT (email) DO UPDATE): safe to run before or after
// scripts/migrate-legacy-data.mjs, in either order or on either database.
// The legacy ETL brings across the OLD "Platform" tenant's admin user row
// (same email — marlon.gmx1@gmail.com — was already the old app's platform
// admin) with NO usable credentials (old password hash has no salt in this
// app's scheme — see that script's header). This script is what turns
// whichever row has that email into the one real, working super_admin
// login: it always overwrites the password/role/tenant fields with the
// real, freshly-hashed credentials below, regardless of whether the ETL
// already created a locked-out placeholder row first.
//
//   node --env-file=.env.neon-app scripts/seed-real-admin.mjs
//
// Hashing matches lib/auth.ts's hashSecret (scrypt, 64-byte, per-user salt,
// generated fresh here) — never a plaintext or externally-computed hash.
import postgres from 'postgres'
import { randomBytes, randomUUID, scryptSync } from 'node:crypto'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:ifms@localhost:55433/ifms'
const sql = postgres(DATABASE_URL, { prepare: false })

const ADMIN_EMAIL = 'marlon.gmx1@gmail.com'
const ADMIN_PASSWORD = 'marlonbino254'
const ADMIN_NAME = 'Marlon Amunga'

// Matches lib/auth.ts's hashSecret exactly (scrypt, 64-byte digest, hex).
const hashSecret = (secret, salt) => scryptSync(secret, salt, 64).toString('hex')

async function main() {
  const salt = randomBytes(16).toString('hex')
  const passwordHash = hashSecret(ADMIN_PASSWORD, salt)

  const [row] = await sql`
    INSERT INTO users (id, tenant_id, name, email, role, password_hash, password_salt, pin_hash, pin_prefilter, phone, status)
    VALUES (${randomUUID()}, NULL, ${ADMIN_NAME}, ${ADMIN_EMAIL}, 'super_admin', ${passwordHash}, ${salt}, NULL, NULL, NULL, 'ACTIVE')
    -- super_admin is a platform role (db/schemas/auth.ts) — no tenant, ever.
    -- Overwriting these columns unconditionally is deliberate: whether this
    -- row pre-existed (migrated from the legacy platform admin, or a stale
    -- previous run of this same script) or not, the outcome must always be
    -- "this email logs in with THIS password" — never a silent no-op that
    -- leaves an old/locked-out hash in place.
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      role = 'super_admin',
      tenant_id = NULL,
      password_hash = EXCLUDED.password_hash,
      password_salt = EXCLUDED.password_salt,
      pin_hash = NULL,
      pin_prefilter = NULL,
      status = 'ACTIVE'
    RETURNING id, email, role
  `
  console.log(`real admin ready: ${row.email} (id ${row.id}, role ${row.role})`)
}

try { await main() } catch (err) { console.error('seed-real-admin failed:', err); process.exitCode = 1 } finally { await sql.end() }
