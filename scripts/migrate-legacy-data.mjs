// ── Legacy data ETL: old app's `neondb` → this app's schema (data-migration
// task) ─────────────────────────────────────────────────────────────────────
// Hand-written migration, NOT a drizzle migration — the two databases share
// table names but not shapes (drizzle only manages this app's own schema
// history; it has no idea the source database exists).
//
// Reads from the OLD database (LEGACY_DATABASE_URL, or — if that's unset —
// whatever DATABASE_URL is in .env.neon at the repo root) and writes to the
// database named by DATABASE_URL (this process's own env), so the same
// script dry-runs against a local Postgres before ever touching production:
//
//   node --env-file=.env.neon-app scripts/migrate-legacy-data.mjs           # refuses: looks like production
//   DATABASE_URL='postgres://postgres:ifms@localhost:55433/ifms' \
//     node scripts/migrate-legacy-data.mjs                                  # local dry run
//   node --env-file=.env.neon-app scripts/migrate-legacy-data.mjs --commit-to-production
//                                                                            # the one real run (not from here)
//
// The source connection is opened and used for SELECT only — nothing in
// this file ever writes to it. `neondb` is the old app's live data and nobody
// touches it, ever, no matter what flag is passed.
//
// Idempotent: every row this script writes gets a deterministic id derived
// from the legacy row's own id (prefixed `legacy-`, or `legacy-farm-`/
// `legacy-product-`/`legacy-pu-` for rows synthesized rather than carried
// over 1:1) and every insert is `ON CONFLICT DO NOTHING` — re-running
// after a partial or full success adds nothing new. The prefix also keeps
// every migrated id out of the way of the demo seed's hardcoded ids (t1, t2,
// f1, f2, demo-*) and of real app-generated ids (randomUUID()) — legacy
// tenant "t1" (Platform) would otherwise collide directly with db/seed.mjs's
// demo tenant "t1" (Nakuru Farm Co.) in the SAME database.
//
// Ordered parents-before-children: tenants → farms (synthesized) →
// production_units → batches → users → employees → products/product_units →
// sales → purchases/inventory_items/inventory_lots → tasks. Every insert
// step reports { source, written } and the whole run finishes with a
// referential-integrity sweep (no orphaned tenant_id/farm_id/unit_id/
// batch_id among the rows this script wrote) and a money round-trip check
// (every cents total before === after).
import postgres from 'postgres'
import { readFileSync } from 'node:fs'
import { scryptSync, randomBytes } from 'node:crypto'

/* ── connections ─────────────────────────────────────────────────────────── */

function loadLegacyDatabaseUrl() {
  if (process.env.LEGACY_DATABASE_URL) return process.env.LEGACY_DATABASE_URL
  try {
    const text = readFileSync(new URL('../.env.neon', import.meta.url), 'utf8')
    const match = text.match(/^DATABASE_URL=(.+)$/m)
    if (match) return match[1].trim()
  } catch {
    // fall through to the error below
  }
  throw new Error('Set LEGACY_DATABASE_URL, or make sure .env.neon exists at the repo root with a DATABASE_URL line.')
}

const TARGET_URL = process.env.DATABASE_URL
if (!TARGET_URL) throw new Error('DATABASE_URL is not set — this is the TARGET database the migration writes to.')

const COMMIT_TO_PRODUCTION = process.argv.includes('--commit-to-production')
const looksLikeTheRealProductionDb = /\/ifms(\?|$)/.test(TARGET_URL) && !/localhost|127\.0\.0\.1/.test(TARGET_URL)
if (looksLikeTheRealProductionDb && !COMMIT_TO_PRODUCTION) {
  throw new Error(
    'DATABASE_URL looks like the production `ifms` database. This script refuses to run against it without ' +
    '--commit-to-production — dry-run against a local Postgres first (see this file\'s header) and have a human ' +
    'review the printed counts before that flag is ever used.'
  )
}

const src = postgres(loadLegacyDatabaseUrl(), { prepare: false }) // READ-ONLY: never write here.
const dst = postgres(TARGET_URL, { prepare: false })

/* ── shared helpers ──────────────────────────────────────────────────────── */

const lg = (oldId) => `legacy-${oldId}`

// Matches lib/auth.ts's hashSecret exactly, but with a random, immediately-
// discarded secret: neither the old password_hash/pin_hash NOR the old
// pin_hash's missing salt can be migrated (scrypt needs the ORIGINAL salt,
// which the old schema never stored), so every migrated user gets a fresh,
// unguessable placeholder instead of a real or invented password. The point
// is that this can never be typed by anyone — the account is locked out
// until an admin runs a real password reset, exactly as instructed.
function lockedCredentials() {
  const salt = randomBytes(16).toString('hex')
  const unusablePassword = randomBytes(32).toString('hex')
  return { passwordHash: scryptSync(unusablePassword, salt, 64).toString('hex'), passwordSalt: salt }
}

// Same normalization pipeline as lib/validation.ts's normalizePhone/
// toStoredPhone (phone-forms task) — duplicated rather than imported because
// every other script in this repo (db/seed.mjs, scripts/seed-demo-data.mjs)
// re-implements its own crypto/validation rather than importing a
// 'server-only'-adjacent app module from a plain Node script.
const KENYA_LOCAL_RE = /^0[17]\d{8}$/
const KENYA_BARE_254_RE = /^254[17]\d{8}$/
const E164_RE = /^\+\d{7,15}$/
function normalizePhone(raw) {
  return typeof raw === 'string' ? raw.replace(/[\s\-().]/g, '') : ''
}
function isValidPhone(phone) {
  return E164_RE.test(phone) || KENYA_LOCAL_RE.test(phone) || KENYA_BARE_254_RE.test(phone)
}
function toStoredPhone(phone) {
  if (KENYA_LOCAL_RE.test(phone)) return `+254${phone.slice(1)}`
  if (KENYA_BARE_254_RE.test(phone)) return `+${phone}`
  return phone
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item'
}

// Enterprise subtype inference (batches task) — the OLD `batches.enterprise`
// column is null on every existing row (checked: 15/15), but the NEW schema's
// `batches.enterprise` is NOT NULL with no default. There is no reliable
// source column to read this from, so it's inferred from the batch's own
// name/species plus its production unit's name/species — a best-effort
// keyword heuristic, not a fabricated fact: it only changes which icon/
// metric set the UI shows for a batch, never any quantity or money figure.
// Farm owners should sanity-check these after migration; documented loudly
// in this script's final report for that reason.
const ENTERPRISE_RULES = [
  [/tilapia|\bfish\b/i, 'fish'],
  [/\bpork\b|\bpig\b/i, 'pig'],
  [/dairy|cattle|\bcow\b/i, 'dairy_cow'],
  [/\bgoat\b/i, 'goat'],
  [/\bmaize\b/i, 'maize'],
  [/broiler|\bmeat\b/i, 'broiler'],
  [/layer|\begg/i, 'layer'],
]
function inferEnterprise(batch, unit) {
  const text = [batch.name, batch.species, unit?.name, unit?.species].filter(Boolean).join(' ')
  for (const [re, subtype] of ENTERPRISE_RULES) if (re.test(text)) return subtype
  return 'layer' // most common shape in this dataset; a documented default, not a guess dressed up as fact
}

const BATCH_PREFIXES = {
  broiler: 'BRO', layer: 'LYR', pig: 'PIG', dairy_cow: 'COW', goat: 'GOT', fish: 'FSH', maize: 'MZE',
}
function batchPrefixFor(enterprise) { return BATCH_PREFIXES[enterprise] ?? 'BAT' }

// Per-tenant code uniqueness (production_units and batches both carry a
// UNIQUE (tenant_id, code) index in the new schema; the old database has no
// such constraint — several old production_units codes are literal
// duplicates within the same tenant, e.g. two different units both truncated
// to "Layer hous"). `taken` is a Map<tenantId, Set<code>> pre-loaded with
// whatever the target DB already has for that tenant, so a rerun that adds a
// genuinely new legacy row still gets a non-colliding code.
async function loadTakenCodes(table, tenantIdCol = 'tenant_id') {
  const rows = await dst`SELECT ${dst(tenantIdCol)} AS tenant_id, code FROM ${dst(table)}`
  const taken = new Map()
  for (const r of rows) {
    if (!taken.has(r.tenant_id)) taken.set(r.tenant_id, new Set())
    taken.get(r.tenant_id).add(r.code)
  }
  return taken
}
function uniqueCode(taken, tenantId, desired, disambiguator) {
  if (!taken.has(tenantId)) taken.set(tenantId, new Set())
  const set = taken.get(tenantId)
  let code = desired
  if (set.has(code)) code = `${desired}-${disambiguator}`
  let n = 2
  while (set.has(code)) { code = `${desired}-${disambiguator}-${n}`; n += 1 }
  set.add(code)
  return code
}

const report = { tables: {}, notMigrated: [], moneyChecks: [], orphanChecks: [], warnings: [] }
function record(table, source, written) { report.tables[table] = { source, written } }

/* ── 1. tenants ──────────────────────────────────────────────────────────── */

async function migrateTenants() {
  const rows = await src`SELECT id, name, active FROM tenants ORDER BY id`
  let written = 0
  for (const t of rows) {
    const res = await dst`
      INSERT INTO tenants (id, name, active)
      VALUES (${lg(t.id)}, ${t.name}, ${t.active})
      ON CONFLICT DO NOTHING
    `
    if (res.count > 0) written += 1
  }
  record('tenants', rows.length, written)
  return rows
}

/* ── 2. farms (synthesized, one per tenant — the old DB has no farms table,
       yet production_units.farm_id references a single 'f1' sentinel that
       resolves to nothing real) ────────────────────────────────────────── */

function farmCodeFromName(name, tenantOldId) {
  const s = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16) || 'FARM'
  return `FRM-LEGACY-${s}-${tenantOldId.slice(0, 6).toUpperCase()}`
}

// Real-world location for a specific known tenant (owner-supplied, not a
// guess): "Marlon Farm" (old tenant t_b0cf2615) is the app owner's own farm,
// a single real site in Khwisero constituency, Kakamega — worth a real
// location and a clean human-facing code instead of the generic
// FRM-LEGACY-<slug>-<id> fallback every other migrated tenant gets.
const KNOWN_FARM_LOCATIONS = {
  t_b0cf2615: { location: 'Khwisero, Kakamega', code: 'FRM-KHWISERO-001' },
}

async function migrateFarms(tenants) {
  let written = 0
  const farmIdByOldTenant = new Map()
  for (const t of tenants) {
    const farmId = `legacy-farm-${t.id}`
    farmIdByOldTenant.set(t.id, farmId)
    const known = KNOWN_FARM_LOCATIONS[t.id]
    const location = known?.location ?? ''
    const code = known?.code ?? farmCodeFromName(t.name, t.id)
    const res = await dst`
      INSERT INTO farms (id, tenant_id, name, location, code, status)
      VALUES (${farmId}, ${lg(t.id)}, ${t.name}, ${location}, ${code}, 'ACTIVE')
      ON CONFLICT DO NOTHING
    `
    if (res.count > 0) written += 1
  }
  record('farms (synthesized)', tenants.length, written)
  return farmIdByOldTenant
}

/* ── 3. production_units ─────────────────────────────────────────────────── */

async function migrateProductionUnits(farmIdByOldTenant) {
  const rows = await src`SELECT id, tenant_id, farm_id, type, name, code, species FROM production_units ORDER BY id`
  const taken = await loadTakenCodes('production_units')
  let written = 0
  const unitById = new Map()
  for (const u of rows) {
    unitById.set(u.id, u)
    const farmId = farmIdByOldTenant.get(u.tenant_id)
    if (!farmId) { report.warnings.push(`production_unit ${u.id}: unknown tenant ${u.tenant_id}, skipped`); continue }
    const code = uniqueCode(taken, lg(u.tenant_id), u.code || u.id.slice(0, 8), u.id.slice(0, 4))
    const res = await dst`
      INSERT INTO production_units (id, tenant_id, farm_id, type, name, code, status)
      VALUES (${lg(u.id)}, ${lg(u.tenant_id)}, ${farmId}, ${u.type}, ${u.name}, ${code}, 'ACTIVE')
      ON CONFLICT DO NOTHING
    `
    if (res.count > 0) written += 1
  }
  record('production_units', rows.length, written)
  return unitById
}

/* ── 4. batches ──────────────────────────────────────────────────────────── */

async function migrateBatches(unitById) {
  const rows = await src`
    SELECT id, tenant_id, unit_id, name, species, stage, status, initial_qty, current_qty,
           acquisition_cost_cents, acquired_date, enterprise
    FROM batches ORDER BY id
  `
  const taken = await loadTakenCodes('batches')
  let written = 0
  const sourceCentsByTenant = new Map()
  for (const b of rows) {
    const unit = unitById.get(b.unit_id)
    const enterprise = inferEnterprise(b, unit)
    const prefix = batchPrefixFor(enterprise)
    const code = uniqueCode(taken, lg(b.tenant_id), `${prefix}-LEGACY-${b.id.slice(0, 6).toUpperCase()}`, b.id.slice(0, 4))
    const acqCents = Number(b.acquisition_cost_cents)
    sourceCentsByTenant.set(b.tenant_id, (sourceCentsByTenant.get(b.tenant_id) ?? 0) + acqCents)
    const startDate = b.acquired_date ? new Date(b.acquired_date) : null
    const res = await dst`
      INSERT INTO batches (id, tenant_id, unit_id, code, name, species, enterprise, stage, status,
                            initial_qty, current_qty, acquisition_cost_cents, start_date)
      VALUES (${lg(b.id)}, ${lg(b.tenant_id)}, ${lg(b.unit_id)}, ${code}, ${b.name}, ${b.species ?? ''},
              ${enterprise}, ${b.stage ?? ''}, ${b.status ?? 'ACTIVE'}, ${b.initial_qty}, ${b.current_qty},
              ${acqCents}, ${startDate})
      ON CONFLICT DO NOTHING
    `
    if (res.count > 0) written += 1
  }
  record('batches', rows.length, written)
  report.notMigrated.push('batches: dropped columns with no new-schema equivalent — breed, source, age_at_acquire, ' +
    'avg_weight_kg, stage_entered_at, delivery_group_id, parent_batch_ids. `enterprise` was inferred from name/' +
    'species keywords (old column is null on every row) — best-effort, review recommended.')
  return { batchIds: new Set(rows.map((b) => lg(b.id))), sourceCentsByTenant, batchesByOldId: new Map(rows.map((b) => [b.id, b])) }
}

/* ── 5. users (no credentials — see lockedCredentials above) ────────────── */

async function migrateUsers() {
  const rows = await src`SELECT id, tenant_id, name, phone, email, role FROM users ORDER BY id`

  // Rows this exact script already migrated (id LIKE 'legacy-%') are
  // skipped outright on a rerun — not just via ON CONFLICT DO NOTHING at
  // insert time, but before any phone-collision check runs, so a user's own
  // previously-migrated row is never mistaken for "someone else already has
  // this phone" (it's the same row). Rows NOT created by this script
  // (real seeded/app rows, e.g. the real super_admin from
  // scripts/seed-real-admin.mjs, which shares an email with the legacy
  // Platform admin on purpose) still participate in the collision check
  // below via `existingPhoneOwner`, which is where a genuine cross-row
  // collision (a phone already claimed by something this script did NOT
  // create) is correctly still caught and dropped to NULL.
  const alreadyMigrated = new Map(
    (await dst`SELECT id, tenant_id, phone FROM users WHERE id LIKE 'legacy-%'`).map((r) => [r.id, r])
  )
  const existingPhoneOwner = new Map(
    (await dst`SELECT id, phone FROM users WHERE phone IS NOT NULL`).map((r) => [r.phone, r.id])
  )

  let written = 0
  let phoneCollisions = 0
  const migratedByTenantAndPhone = new Map() // for employee<->user linking later
  for (const u of rows) {
    const id = lg(u.id)
    const isPlatformRole = u.role === 'super_admin'

    const already = alreadyMigrated.get(id)
    if (already) {
      // Already inserted by a previous run of this script — reuse its
      // stored phone for the employee-linking map below and move on; do not
      // re-derive or re-check anything, and do not count it as newly written.
      if (already.phone && !isPlatformRole) migratedByTenantAndPhone.set(`${u.tenant_id}|${already.phone}`, id)
      continue
    }

    const tenantId = isPlatformRole ? null : lg(u.tenant_id)
    const email = u.email && u.email.trim() ? u.email.trim() : `legacy-${u.id}@ifms.invalid`
    let phone = null
    const normalized = normalizePhone(u.phone)
    if (normalized && isValidPhone(normalized)) {
      const stored = toStoredPhone(normalized)
      if (!existingPhoneOwner.has(stored)) {
        phone = stored
        existingPhoneOwner.set(stored, id)
        if (!isPlatformRole) migratedByTenantAndPhone.set(`${u.tenant_id}|${stored}`, id)
      } else {
        phoneCollisions += 1
        report.warnings.push(`user ${u.id}: phone ${stored} already used by another row (${existingPhoneOwner.get(stored)}) — stored as NULL instead`)
      }
    }
    const { passwordHash, passwordSalt } = lockedCredentials()
    const res = await dst`
      INSERT INTO users (id, tenant_id, name, email, role, password_hash, password_salt, pin_hash, pin_prefilter, phone, status)
      VALUES (${id}, ${tenantId}, ${u.name}, ${email}, ${u.role}, ${passwordHash}, ${passwordSalt}, NULL, NULL, ${phone}, 'ACTIVE')
      ON CONFLICT DO NOTHING
    `
    if (res.count > 0) written += 1
  }
  record('users', rows.length, written)
  if (phoneCollisions > 0) report.warnings.push(`${phoneCollisions} user phone(s) dropped to NULL to avoid violating the unique phone index`)
  report.notMigrated.push('users: password_hash/pin_hash NOT migrated for ANY user (old schema has no per-user ' +
    'password salt column, and PIN hashes are equally unusable without one) — every migrated user is created with ' +
    'a random, unusable placeholder credential and must have their password reset by an admin before they can sign ' +
    'in. Rows with no usable email got a synthetic legacy-<id>@ifms.invalid placeholder.')
  return { migratedByTenantAndPhone }
}

/* ── 6. employees ────────────────────────────────────────────────────────── */

async function migrateEmployees(farmIdByOldTenant, batchIds, migratedByTenantAndPhone) {
  const rows = await src`
    SELECT id, tenant_id, name, phone, role, active, salary_cents, assigned_batch_ids
    FROM employees ORDER BY id
  `
  let written = 0
  const sourceCentsByTenant = new Map()
  for (const e of rows) {
    const farmId = farmIdByOldTenant.get(e.tenant_id) ?? null
    const salaryCents = Number(e.salary_cents)
    sourceCentsByTenant.set(e.tenant_id, (sourceCentsByTenant.get(e.tenant_id) ?? 0) + salaryCents)
    const assignedBatchIds = Array.isArray(e.assigned_batch_ids)
      ? e.assigned_batch_ids.map(lg).filter((id) => batchIds.has(id))
      : []
    // Deterministic join, not a guess: an employee and a `users` worker row
    // in the SAME tenant with the SAME normalized phone are the same person
    // (verified against this dataset — every one of the 6 old employee rows
    // matches exactly one worker user this way), so employees.userId can be
    // set correctly even though the old schema carries no explicit FK for it.
    const normalized = normalizePhone(e.phone)
    const stored = normalized && isValidPhone(normalized) ? toStoredPhone(normalized) : null
    const userId = stored ? migratedByTenantAndPhone.get(`${e.tenant_id}|${stored}`) ?? null : null
    const res = await dst`
      INSERT INTO employees (id, tenant_id, user_id, name, phone, role, monthly_salary_cents,
                              assigned_batch_ids, mortality_photo_threshold, status, farm_id)
      VALUES (${lg(e.id)}, ${lg(e.tenant_id)}, ${userId}, ${e.name}, ${stored ?? e.phone ?? ''}, ${e.role},
              ${salaryCents}, ${assignedBatchIds}, 3, ${e.active ? 'ACTIVE' : 'INACTIVE'}, ${farmId})
      ON CONFLICT DO NOTHING
    `
    if (res.count > 0) written += 1
  }
  record('employees', rows.length, written)
  report.notMigrated.push('employees: dropped pay_day and worker_profile_id/pin_set (no new-schema column for ' +
    'either); mortality_photo_threshold has no old source and was left at the schema default (3).')
  return sourceCentsByTenant
}

/* ── 7. products (tenant catalogue) + product_units (unit inheritance) ──── */

async function migrateProductsAndUnits(batchesByOldId) {
  const rows = await src`
    SELECT id, tenant_id, batch_id, name, sale_units, is_animal_product, active FROM products ORDER BY id
  `
  const catalogue = new Map() // key: tenantOldId|name -> { id, tenantOldId, name, priceMajor, type, status }
  const productUnitPairs = new Map() // key: productId|unitId -> { id, tenantOldId, productId, unitId }
  let productsWritten = 0
  let productUnitsWritten = 0
  let priceConflicts = 0

  for (const p of rows) {
    const batch = batchesByOldId.get(p.batch_id)
    if (!batch) { report.warnings.push(`product ${p.id}: references unknown batch ${p.batch_id}, skipped`); continue }
    const key = `${p.tenant_id}|${p.name}`
    const tiers = Array.isArray(p.sale_units) ? p.sale_units : []
    const perBaseOne = tiers.find((t) => Number(t.perBase) === 1)
    const priceMajor = Number((perBaseOne ?? tiers[0])?.price ?? 0)
    const type = p.is_animal_product ? 'livestock' : 'crop'
    const status = p.active === false ? 'ARCHIVED' : 'ACTIVE'

    let prod = catalogue.get(key)
    if (!prod) {
      prod = { id: `legacy-product-${p.tenant_id}-${slug(p.name)}`, tenantOldId: p.tenant_id, name: p.name, priceMajor, type, status }
      catalogue.set(key, prod)
    } else if (prod.priceMajor !== priceMajor) {
      priceConflicts += 1 // first-seen price wins; logged, not silently averaged/overwritten
    }

    const unitId = lg(batch.unit_id)
    const puKey = `${prod.id}|${unitId}`
    if (!productUnitPairs.has(puKey)) {
      productUnitPairs.set(puKey, { id: `legacy-pu-${prod.id}__${unitId}`, tenantOldId: p.tenant_id, productId: prod.id, unitId })
    }
  }

  for (const prod of catalogue.values()) {
    const res = await dst`
      INSERT INTO products (id, tenant_id, type, name, sale_units, status)
      VALUES (${prod.id}, ${lg(prod.tenantOldId)}, ${prod.type}, ${prod.name}, ${prod.priceMajor}, ${prod.status})
      ON CONFLICT DO NOTHING
    `
    if (res.count > 0) productsWritten += 1
  }

  for (const pu of productUnitPairs.values()) {
    const res = await dst`
      INSERT INTO product_units (id, tenant_id, product_id, unit_id)
      VALUES (${pu.id}, ${lg(pu.tenantOldId)}, ${pu.productId}, ${pu.unitId})
      ON CONFLICT DO NOTHING
    `
    if (res.count > 0) productUnitsWritten += 1
  }

  record('products (deduped catalogue)', rows.length, productsWritten)
  record('product_units', productUnitPairs.size, productUnitsWritten)
  report.notMigrated.push('products: old rows were per-batch with a multi-tier sale_units price list, base_unit, ' +
    'collect_frequency and flow — the new schema is a flat tenant catalogue with ONE price. Rows sharing the same ' +
    '(tenant, name) were deduped into one catalogue product; the price kept is the tier with perBase=1 (falling ' +
    'back to the first tier) — every other tier, plus base_unit/collect_frequency/flow, is dropped.' +
    (priceConflicts > 0 ? ` ${priceConflicts} name collisions had a different price across batches — first-seen price kept.` : '') +
    ' `type` is a direct copy of the old is_animal_product flag (livestock/crop) — the old app itself did not ' +
    'mark eggs or manure as an "animal product", so those land as \'crop\' here too; review after migration if ' +
    'that grouping looks wrong for a given tenant.')
  report.notMigrated.push('batch_products: not populated — every old per-batch product assignment was collapsed ' +
    'to unit-level inheritance (product_units) instead of a batch-level ADD/EXCLUDE override.')
}

/* ── 8. sales ────────────────────────────────────────────────────────────── */

async function migrateSales(batchIds) {
  const rows = await src`
    SELECT id, tenant_id, batch_id, product_type, total_amount_cents, payment_method, status, created_at
    FROM sales ORDER BY id
  `
  let written = 0
  const sourceCentsByTenant = new Map()
  for (const s of rows) {
    const amountCents = Number(s.total_amount_cents)
    sourceCentsByTenant.set(s.tenant_id, (sourceCentsByTenant.get(s.tenant_id) ?? 0) + amountCents)
    const batchId = lg(s.batch_id)
    if (!batchIds.has(batchId)) { report.warnings.push(`sale ${s.id}: references unknown batch ${s.batch_id}, batch_id set NULL`) }
    const status = String(s.status ?? '').toLowerCase() === 'pending' ? 'pending' : 'paid'
    const at = s.created_at ? new Date(s.created_at) : new Date()
    const res = await dst`
      INSERT INTO sales (id, tenant_id, batch_id, item, amount_cents, method, status, sold_at, created_at)
      VALUES (${lg(s.id)}, ${lg(s.tenant_id)}, ${batchIds.has(batchId) ? batchId : null}, ${s.product_type},
              ${amountCents}, ${s.payment_method ?? ''}, ${status}, ${at}, ${at})
      ON CONFLICT DO NOTHING
    `
    if (res.count > 0) written += 1
  }
  record('sales', rows.length, written)
  return sourceCentsByTenant
}

/* ── 9. inventory_items, inventory_lots, purchases ──────────────────────── */

async function migrateInventory(farmIdByOldTenant) {
  const items = await src`SELECT id, tenant_id, name, category, unit, low_stock_threshold FROM inventory_items ORDER BY id`
  let itemsWritten = 0
  for (const i of items) {
    const res = await dst`
      INSERT INTO inventory_items (id, tenant_id, name, category, unit, low_stock_threshold)
      VALUES (${lg(i.id)}, ${lg(i.tenant_id)}, ${i.name}, ${i.category ?? ''}, ${i.unit}, ${Math.round(Number(i.low_stock_threshold) || 0)})
      ON CONFLICT DO NOTHING
    `
    if (res.count > 0) itemsWritten += 1
  }
  record('inventory_items', items.length, itemsWritten)

  const lots = await src`
    SELECT id, tenant_id, item_id, lot_no, qty_on_hand, unit_cost_cents, expiry_date, received_date
    FROM inventory_lots ORDER BY id
  `
  let lotsWritten = 0
  for (const l of lots) {
    const farmId = farmIdByOldTenant.get(l.tenant_id) ?? null
    const res = await dst`
      INSERT INTO inventory_lots (id, tenant_id, item_id, lot_no, qty_on_hand, unit_cost_cents, expiry_date, received_date, farm_id)
      VALUES (${lg(l.id)}, ${lg(l.tenant_id)}, ${lg(l.item_id)}, ${l.lot_no}, ${Math.round(Number(l.qty_on_hand) || 0)},
              ${Number(l.unit_cost_cents)}, ${l.expiry_date ? new Date(l.expiry_date) : null},
              ${l.received_date ? new Date(l.received_date) : new Date()}, ${farmId})
      ON CONFLICT DO NOTHING
    `
    if (res.count > 0) lotsWritten += 1
  }
  record('inventory_lots', lots.length, lotsWritten)

  const purchases = await src`
    SELECT id, tenant_id, item_id, supplier, quantity, unit_cost_cents, total_cost_cents, payment_method,
           amount_paid_cents, created_at
    FROM purchases ORDER BY id
  `
  let purchasesWritten = 0
  const sourceCentsByTenant = new Map()
  for (const p of purchases) {
    const totalCents = Number(p.total_cost_cents)
    sourceCentsByTenant.set(p.tenant_id, (sourceCentsByTenant.get(p.tenant_id) ?? 0) + totalCents)
    const farmId = farmIdByOldTenant.get(p.tenant_id) ?? null
    const at = p.created_at ? new Date(p.created_at) : new Date()
    const res = await dst`
      INSERT INTO purchases (id, tenant_id, supplier, item_id, quantity, unit_cost_cents, total_cost_cents,
                              payment_method, amount_paid_cents, farm_id, created_at)
      VALUES (${lg(p.id)}, ${lg(p.tenant_id)}, ${p.supplier}, ${lg(p.item_id)}, ${Math.round(Number(p.quantity) || 0)},
              ${Number(p.unit_cost_cents)}, ${totalCents}, ${p.payment_method ?? ''}, ${Number(p.amount_paid_cents)},
              ${farmId}, ${at})
      ON CONFLICT DO NOTHING
    `
    if (res.count > 0) purchasesWritten += 1
  }
  record('purchases', purchases.length, purchasesWritten)
  report.notMigrated.push('inventory_lots: dropped `unit` (redundant with inventory_items.unit) and ' +
    '`withdrawal_days`/`supplier_id` (no new-schema column). purchases: dropped `lot_id` (the corresponding ' +
    'inventory_lots row is migrated separately, but the new schema does not link a purchase to a specific lot) ' +
    'and `received_at`/`paid_at` (only one `created_at` timestamp exists on the new table).')
  return sourceCentsByTenant
}

/* ── 10. tasks ───────────────────────────────────────────────────────────── */

async function migrateTasks(farmIdByOldTenant) {
  const rows = await src`SELECT id, tenant_id, title, description, status, due_at FROM tasks ORDER BY id`
  let written = 0
  for (const t of rows) {
    const farmId = farmIdByOldTenant.get(t.tenant_id) ?? null
    const status = String(t.status ?? '').toUpperCase() === 'DONE' ? 'DONE' : 'PENDING'
    const dueAt = t.due_at ? new Date(t.due_at) : null
    const res = await dst`
      INSERT INTO tasks (id, tenant_id, title, due_at, status, priority, requires_approval, notes, farm_id)
      VALUES (${lg(t.id)}, ${lg(t.tenant_id)}, ${t.title}, ${dueAt}, ${status}, 'medium', false, ${t.description ?? null}, ${farmId})
      ON CONFLICT DO NOTHING
    `
    if (res.count > 0) written += 1
  }
  record('tasks', rows.length, written)
  report.notMigrated.push('tasks: dropped type, assigned_to, unit_id, batch_id, scheduled_for, overdue — the new ' +
    'tasks table has no column for any of them (assignment/linking is out of this table\'s current shape).')
}

/* ── tables with no attempt at a mapping at all ─────────────────────────── */

function recordUnmappedTables() {
  const noEquivalent = [
    'feeding_records', 'health_records', 'lifecycle_stages', 'worker_profiles', 'alerts', 'alert_rules',
    'labor_logs', 'mortality_records', 'observations', 'physical_counts', 'weight_samples', 'processing_events',
    'overheads', 'feed_formulas', 'employee_ledger', 'batch_stage_events', 'photos', 'conflict_log', 'error_logs',
    'login_attempts', 'auditor_links', 'closing_stock_counts', 'test_photos', 'test_runs', 'platform_settings',
    'revoked_sessions', 'production_backfill_report', 'production_recovery_report', 'payslips',
  ]
  report.notMigrated.push(`No target table (or no safe mapping) exists for: ${noEquivalent.join(', ')}.`)
  report.notMigrated.push('records: old `records` has no batch_id and no reliable employee_id source (created_by ' +
    'is a raw user id, and most employees have no linked user) — mapping it into the new employeeId-NOT-NULL ' +
    '`records` table would mean guessing attribution, so it was left out.')
  report.notMigrated.push('audit_log: exists in both schemas but the new table\'s entity_id is NOT NULL while the ' +
    'old table has no entity_id column at all — no source value to migrate, so this history was left behind.')
}

/* ── money round-trip assertions ─────────────────────────────────────────── */

async function assertMoney(label, sourceTotal, newQuery) {
  const [{ total }] = await newQuery
  const newTotal = Number(total ?? 0)
  const ok = newTotal === sourceTotal
  report.moneyChecks.push({ label, sourceCents: sourceTotal, writtenCents: newTotal, ok })
  if (!ok) report.warnings.push(`MONEY MISMATCH — ${label}: source ${sourceTotal} cents, written ${newTotal} cents`)
}

/* ── referential integrity sweep (scoped to rows this script wrote) ─────── */

async function assertNoOrphans(label, query) {
  const rows = await query
  const count = rows.length
  report.orphanChecks.push({ label, orphanCount: count })
  if (count > 0) report.warnings.push(`ORPHAN — ${label}: ${count} row(s)`)
}

/* ── main ────────────────────────────────────────────────────────────────── */

async function main() {
  const tenants = await migrateTenants()
  const farmIdByOldTenant = await migrateFarms(tenants)
  const unitById = await migrateProductionUnits(farmIdByOldTenant)
  const { batchIds, sourceCentsByTenant: batchCents, batchesByOldId } = await migrateBatches(unitById)
  const { migratedByTenantAndPhone } = await migrateUsers()
  const employeeCents = await migrateEmployees(farmIdByOldTenant, batchIds, migratedByTenantAndPhone)
  await migrateProductsAndUnits(batchesByOldId)
  const salesCents = await migrateSales(batchIds)
  const purchaseCents = await migrateInventory(farmIdByOldTenant)
  await migrateTasks(farmIdByOldTenant)
  recordUnmappedTables()

  const sumOf = (m) => [...m.values()].reduce((a, b) => a + b, 0)
  await assertMoney('batches.acquisition_cost_cents', sumOf(batchCents),
    dst`SELECT COALESCE(SUM(acquisition_cost_cents), 0)::bigint AS total FROM batches WHERE id LIKE 'legacy-%'`)
  await assertMoney('employees.monthly_salary_cents', sumOf(employeeCents),
    dst`SELECT COALESCE(SUM(monthly_salary_cents), 0)::bigint AS total FROM employees WHERE id LIKE 'legacy-%'`)
  await assertMoney('sales.amount_cents', sumOf(salesCents),
    dst`SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total FROM sales WHERE id LIKE 'legacy-%'`)
  await assertMoney('purchases.total_cost_cents', sumOf(purchaseCents),
    dst`SELECT COALESCE(SUM(total_cost_cents), 0)::bigint AS total FROM purchases WHERE id LIKE 'legacy-%'`)

  await assertNoOrphans('production_units.farm_id -> farms',
    dst`SELECT pu.id FROM production_units pu LEFT JOIN farms f ON f.id = pu.farm_id WHERE pu.id LIKE 'legacy-%' AND f.id IS NULL`)
  await assertNoOrphans('production_units.tenant_id -> tenants',
    dst`SELECT pu.id FROM production_units pu LEFT JOIN tenants t ON t.id = pu.tenant_id WHERE pu.id LIKE 'legacy-%' AND t.id IS NULL`)
  await assertNoOrphans('batches.unit_id -> production_units',
    dst`SELECT b.id FROM batches b LEFT JOIN production_units pu ON pu.id = b.unit_id WHERE b.id LIKE 'legacy-%' AND pu.id IS NULL`)
  await assertNoOrphans('employees.farm_id -> farms (where set)',
    dst`SELECT e.id FROM employees e LEFT JOIN farms f ON f.id = e.farm_id WHERE e.id LIKE 'legacy-%' AND e.farm_id IS NOT NULL AND f.id IS NULL`)
  await assertNoOrphans('sales.batch_id -> batches (where set)',
    dst`SELECT s.id FROM sales s LEFT JOIN batches b ON b.id = s.batch_id WHERE s.id LIKE 'legacy-%' AND s.batch_id IS NOT NULL AND b.id IS NULL`)
  await assertNoOrphans('inventory_lots.item_id -> inventory_items',
    dst`SELECT l.id FROM inventory_lots l LEFT JOIN inventory_items i ON i.id = l.item_id WHERE l.id LIKE 'legacy-%' AND i.id IS NULL`)
  await assertNoOrphans('purchases.item_id -> inventory_items',
    dst`SELECT p.id FROM purchases p LEFT JOIN inventory_items i ON i.id = p.item_id WHERE p.id LIKE 'legacy-%' AND i.id IS NULL`)
  await assertNoOrphans('users.tenant_id -> tenants (where set)',
    dst`SELECT u.id FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.id LIKE 'legacy-%' AND u.tenant_id IS NOT NULL AND t.id IS NULL`)
  await assertNoOrphans('product_units.unit_id -> production_units',
    dst`SELECT pu2.id FROM product_units pu2 LEFT JOIN production_units pu ON pu.id = pu2.unit_id WHERE pu2.id LIKE 'legacy-pu-%' AND pu.id IS NULL`)

  console.log('\n=== migrate-legacy-data.mjs report ===')
  console.log(`source: ${looksLikeTheRealProductionDb ? '(production target — should not happen without --commit-to-production)' : loadLegacyDatabaseUrl().replace(/:[^:@]*@/, ':***@')}`)
  console.log(`target: ${TARGET_URL.replace(/:[^:@]*@/, ':***@')}`)
  console.log('\n-- per-table counts (source vs written this run) --')
  for (const [table, { source, written }] of Object.entries(report.tables)) {
    console.log(`  ${table.padEnd(32)} source=${source}  written=${written}`)
  }
  console.log('\n-- money round-trip checks --')
  for (const c of report.moneyChecks) console.log(`  ${c.ok ? 'OK  ' : 'FAIL'} ${c.label}: ${c.sourceCents} -> ${c.writtenCents} cents`)
  console.log('\n-- referential integrity (orphans among migrated rows) --')
  for (const c of report.orphanChecks) console.log(`  ${c.orphanCount === 0 ? 'OK  ' : 'FAIL'} ${c.label}: ${c.orphanCount} orphan(s)`)
  console.log('\n-- not migrated / dropped (by design) --')
  for (const n of report.notMigrated) console.log(`  - ${n}`)
  if (report.warnings.length) {
    console.log('\n-- warnings --')
    for (const w of report.warnings) console.log(`  ! ${w}`)
  }
  const anyMoneyFail = report.moneyChecks.some((c) => !c.ok)
  const anyOrphan = report.orphanChecks.some((c) => c.orphanCount > 0)
  if (anyMoneyFail || anyOrphan) {
    console.error('\nMIGRATION COMPLETED WITH FAILURES — see FAIL lines above. Do not point this run\'s target at production.')
    process.exitCode = 1
  } else {
    console.log('\nAll money and referential-integrity checks passed.')
  }
}

try {
  await main()
} catch (err) {
  console.error('migrate-legacy-data failed:', err)
  process.exitCode = 1
} finally {
  await src.end()
  await dst.end()
}
