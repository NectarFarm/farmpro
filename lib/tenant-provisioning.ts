// ── Shared tenant-provisioning transaction (issue #251) ────────────────────
// Issue #251 says approving an onboarding request "must call the existing
// tenant-provisioning transaction from POST /api/admin/tenants — do not
// duplicate that logic." That route does not exist in this branch: a repo-wide
// grep for `admin/tenants` / `provisionTenant` turns up nothing, and issue
// #250's epic notes describe it as part of the *reference* system this branch
// is rebuilding from scratch, not a file that exists here.
//
// So this file IS that transaction, factored out on purpose: PATCH
// /api/onboard-requests/[id] calls it below, and whichever future issue builds
// POST /api/admin/tenants should call this same function instead of
// duplicating the insert logic — satisfying #251's instruction going forward
// even though the other caller doesn't exist yet.
//
// Provisions: a tenant, its first farm (from the request's farmName/location),
// and an owner user (temp password — the admin queue is responsible for
// getting it to the applicant; this function only returns it once).
import 'server-only'
import { randomBytes, randomUUID } from 'node:crypto'
import { db } from '@/db'
import { tenants, farms, users } from '@/db/schemas'
import { hashSecret } from '@/lib/auth'

export interface ProvisionTenantInput {
  farmerName: string
  email: string
  farmName: string
  location: string
  // The applicant's GPS pin (onboard_requests.latitude/longitude), carried
  // onto the new farm row so weather (GET /api/weather) works out of the box
  // instead of every freshly provisioned farm starting with no coordinates.
  // Optional/all-or-nothing — undefined when the request never captured one.
  latitude?: number | null
  longitude?: number | null
}

export interface ProvisionTenantResult {
  tenantId: string
  farmId: string
  ownerUserId: string
  ownerTempPassword: string
}

function farmCodeFromName(name: string, id: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 12)
    .replace(/-+$/g, '')
  return `FRM-${slug || 'FARM'}-${id.slice(0, 4).toUpperCase()}`
}

export async function provisionTenant(input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
  const tenantId = randomUUID()
  const farmId = randomUUID()
  const ownerUserId = randomUUID()
  const ownerTempPassword = randomBytes(9).toString('base64url')
  const salt = randomBytes(16).toString('hex')

  await db.transaction(async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: input.farmName, active: true })
    await tx.insert(farms).values({
      id: farmId,
      tenantId,
      name: input.farmName,
      location: input.location,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      code: farmCodeFromName(input.farmName, farmId),
    })
    await tx.insert(users).values({
      id: ownerUserId,
      tenantId,
      name: input.farmerName,
      email: input.email,
      role: 'owner',
      passwordHash: hashSecret(ownerTempPassword, salt),
      passwordSalt: salt,
      status: 'ACTIVE',
    })
  })

  return { tenantId, farmId, ownerUserId, ownerTempPassword }
}
