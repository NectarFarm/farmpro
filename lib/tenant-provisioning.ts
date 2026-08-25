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
// an owner user (temp password — the admin queue is responsible for getting it
// to the applicant; this function only returns it once), and the tenant's
// enterprise scope.
//
// That last one used to be missing, and it was the whole point of step 3 of the
// sign-up wizard. The applicant picks their enterprises, the picks are
// validated, they are stored on `onboard_requests.enterprises` — and this
// function never received the field, so a broiler farmer's new account offered
// dairy, goats, fish and every crop in the registry. See
// db/schemas/enterprises.ts and lib/enterprises.ts.
import 'server-only'
import { randomBytes, randomUUID } from 'node:crypto'
import { db } from '@/db'
import { tenants, farms, users } from '@/db/schemas'
import { hashSecret } from '@/lib/auth'
import { grantEnterprises } from '@/lib/enterprises'

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
  // What the applicant said they farm (onboard_requests.enterprises). Written
  // into `tenant_enterprises` in the SAME transaction as the tenant itself, so
  // an account can never exist in a state where it has been provisioned but
  // its scope hasn't. Empty/omitted leaves the tenant unrestricted — see
  // lib/enterprises.ts's empty-set rule — which is the correct outcome for a
  // caller that genuinely has no selection to apply.
  enterprises?: string[]
}

export interface ProvisionTenantResult {
  tenantId: string
  farmId: string
  ownerUserId: string
  ownerTempPassword: string
  // Normalised and de-duplicated — what the tenant is actually scoped to, not
  // the raw input, so a caller logging this reports what was really applied.
  enterprises: string[]
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
  let grantedEnterprises: string[] = []

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
    // Same transaction as the tenant: a provisioned account without its scope
    // would silently be an unrestricted one (the empty-set rule), which is
    // exactly the bug this closes.
    grantedEnterprises = await grantEnterprises(tenantId, input.enterprises ?? [], {
      source: 'onboarding',
      tx: tx as unknown as typeof db,
    })
  })

  return { tenantId, farmId, ownerUserId, ownerTempPassword, enterprises: grantedEnterprises }
}
