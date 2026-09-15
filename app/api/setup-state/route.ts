import { NextResponse } from 'next/server'
import { db } from '@/db'
import {
  farms, productionUnits, batches, products, productUnits,
  inventoryItems, purchases, employees, routines, rolePermissions,
} from '@/db/schemas'
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm'
import { requireTenantSession } from '@/lib/api-auth'
import { summariseSetup, type SetupCounts } from '@/lib/setup-state'

// ── GET /api/setup-state ────────────────────────────────────────────────────
// One endpoint that answers "how far through setting up this farm is this
// tenant", so no screen has to guess.
//
// Before this route, the getting-started sequence existed (lib/onboarding-guide.ts)
// but nothing anywhere knew whether a step was DONE — so the Getting Started
// screen rendered nine identical numbered paragraphs, the dashboard showed five
// equal tabs, and a new owner had no way to tell what they had already finished.
// Each screen deriving that for itself would have meant nine different fetches
// with nine chances to disagree with each other; hence one endpoint.
//
// Why a dedicated route rather than more fields on GET /api/dashboard/kpis:
// that route is the OPERATIONAL numbers for a farm that is already running
// (revenue, mortality, open tasks) and is re-fetched on every period/farm
// toggle. These counts change a handful of times in a tenant's whole life and
// are read by three different screens including one that does not show KPIs at
// all. Keeping them apart also keeps the kpis route's farm-scoping story
// intact — see the scoping note below, which is the opposite of that route's.
//
// ── Tenant-wide, NOT farm-scoped, deliberately ──
// Every other list route here takes `farmId`. This one does not, and that is a
// decision rather than an omission: the question being answered is "has this
// ACCOUNT been set up", and several of the things counted have no farm column
// to scope by in the first place (products, product_units, inventory_items and
// role_permissions are all tenant-wide — the same set GET /api/dashboard/kpis's
// header lists as unscopable). Scoping the half that can be scoped would
// produce a progress figure that changed when you flipped the farm switcher
// while the other half stayed still, which is worse than not offering it.
//
// The derivation itself lives in lib/setup-state.ts as a pure function over
// the counts below, so it is testable without a database (tests/setup-state.test.ts).
// This file's only job is to count honestly.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })

export async function GET(req: Request) {
  // A super_admin session carries no tenantId of its own and must be able to
  // name one to inspect a tenant's setup — the same explicitTenantId opt-in
  // every other tenant-scoped GET here uses (lib/api-auth.ts). Read at the
  // call site, never by the helper.
  const auth = await requireTenantSession({
    explicitTenantId: new URL(req.url).searchParams.get('tenantId') ?? undefined,
  })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  // Ten counts in one round trip. Issued together rather than sequentially:
  // this is read on first paint of the dashboard, and ten serial round trips
  // to Neon is a visible delay on a phone.
  const [
    farmRows, unitRows, batchRows, productRows, attachmentRows,
    stockItemRows, purchaseRows, employeeRows, employeeLoginRows, routineRows, ruleRows,
  ] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(farms).where(eq(farms.tenantId, tenantId)),
    db.select({ n: sql<number>`count(*)` }).from(productionUnits).where(eq(productionUnits.tenantId, tenantId)),
    db.select({ n: sql<number>`count(*)` }).from(batches).where(eq(batches.tenantId, tenantId)),
    db.select({ n: sql<number>`count(*)` }).from(products).where(eq(products.tenantId, tenantId)),
    db.select({ n: sql<number>`count(*)` }).from(productUnits).where(eq(productUnits.tenantId, tenantId)),
    db.select({ n: sql<number>`count(*)` }).from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId)),
    db.select({ n: sql<number>`count(*)` }).from(purchases).where(eq(purchases.tenantId, tenantId)),
    db.select({ n: sql<number>`count(*)` }).from(employees).where(eq(employees.tenantId, tenantId)),
    // "Has a login" is `employees.userId` being set to a real users row — the
    // link GET /api/employees/me resolves the caller by. An empty string is
    // excluded as well as NULL: the column is nullable but nothing stops a
    // caller writing '', and '' is not a user id.
    db.select({ n: sql<number>`count(*)` }).from(employees)
      .where(and(eq(employees.tenantId, tenantId), isNotNull(employees.userId), ne(employees.userId, ''))),
    // Any routine, active or not: an owner who wrote a morning round and then
    // paused it for the season has still done this step.
    db.select({ n: sql<number>`count(*)` }).from(routines).where(eq(routines.tenantId, tenantId)),
    // role_permissions is empty until Governance's matrix is saved for the
    // first time (PUT /api/role-permissions replaces the tenant's whole matrix
    // in one transaction), so "any row exists" is a truthful record of the
    // owner having made that decision — not a proxy for it.
    db.select({ n: sql<number>`count(*)` }).from(rolePermissions).where(eq(rolePermissions.tenantId, tenantId)),
  ])

  // Postgres returns count() as bigint, which node-postgres hands back as a
  // STRING however the Drizzle generic is annotated. Number() here rather than
  // trusting that annotation is what stops "0" — a truthy string — from being
  // compared with `> 0` downstream and ticking every step for an empty tenant.
  const n = (rows: { n: number }[]) => Number(rows[0]?.n ?? 0)

  const counts: SetupCounts = {
    farms: n(farmRows),
    units: n(unitRows),
    batches: n(batchRows),
    products: n(productRows),
    productsAttachedToUnits: n(attachmentRows),
    stockItems: n(stockItemRows),
    purchases: n(purchaseRows),
    employees: n(employeeRows),
    employeeLogins: n(employeeLoginRows),
    routines: n(routineRows),
    approvalRules: n(ruleRows),
  }

  // The counts go out alongside the derived steps on purpose. A caller that
  // disagrees with a `done` flag can see the exact numbers it was derived
  // from, which is the difference between a progress indicator you can check
  // and one you have to trust.
  return ok(summariseSetup(counts))
}
