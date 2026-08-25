// ── Enterprise scoping: what this tenant is allowed to farm ────────────────
// The rule this module enforces: what a farmer selected when they applied is
// what their account offers, and widening it goes through an admin. See
// db/schemas/enterprises.ts for why that direction, and for the empty-set rule
// restated below.
//
// THE EMPTY-SET RULE. A tenant with no `tenant_enterprises` rows is
// UNRESTRICTED, not locked out. Migration 0035 backfills every existing tenant
// from the enterprises its own batches already use, so in practice only a
// tenant with zero batches and no approved application lands here — and
// refusing to let such an account create its first batch would brick it for a
// reason the farmer cannot see or fix. Every tenant provisioned from an
// approved application gets rows, so new accounts are always scoped.
import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { tenantEnterprises } from '@/db/schemas'

export type EnterpriseSource = 'onboarding' | 'admin-grant' | 'backfill'

// Normalised the same way everywhere a key crosses a boundary: the registry
// keys are lowercase snake ("dairy_cow"), and an applicant's payload or an
// admin's typed grant should not create a near-duplicate row that the unique
// index treats as distinct ("Dairy_Cow" vs "dairy_cow").
export function normalizeEnterprise(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

// Bounds copied from POST /api/onboard-requests's validateBody so a grant and
// an application cannot disagree about what a valid key looks like.
export const MAX_ENTERPRISE_KEY_CHARS = 64
export const MAX_ENTERPRISES_PER_TENANT = 20

export function isValidEnterpriseKey(key: string): boolean {
  return key.length > 0 && key.length <= MAX_ENTERPRISE_KEY_CHARS
}

export async function tenantEnterpriseList(tenantId: string) {
  return db
    .select({
      enterprise: tenantEnterprises.enterprise,
      source: tenantEnterprises.source,
      createdAt: tenantEnterprises.createdAt,
    })
    .from(tenantEnterprises)
    .where(eq(tenantEnterprises.tenantId, tenantId))
    .orderBy(tenantEnterprises.enterprise)
}

export async function tenantEnterpriseSet(tenantId: string): Promise<Set<string>> {
  const rows = await tenantEnterpriseList(tenantId)
  return new Set(rows.map((r) => r.enterprise))
}

// The write-path guard. Returns null when allowed, or a farmer-readable reason
// when not — the caller turns that into its own 403/400 so this module stays
// free of NextResponse and testable without a request.
//
// Deliberately NOT a silent filter: a batch quietly created under a different
// enterprise than the caller asked for would be worse than a refusal, because
// the code prefix, the forms the worker sees and every report bucket derive
// from `batches.enterprise`.
export async function enterpriseRefusalReason(
  tenantId: string,
  rawEnterprise: string,
): Promise<string | null> {
  const enterprise = normalizeEnterprise(rawEnterprise)
  if (!enterprise) return null // the caller's own required-field check owns this

  const allowed = await tenantEnterpriseSet(tenantId)
  // Empty set = unrestricted. See the header.
  if (allowed.size === 0) return null
  if (allowed.has(enterprise)) return null

  return `Your farm isn't set up for "${enterprise}". Request it under Settings and an administrator can add it to your account.`
}

// Used by provisioning (from an approved application) and by an admin grant.
// Idempotent by way of the unique index: re-granting an enterprise a tenant
// already has is a no-op, not an error, so a double-tapped approve is safe.
// Accepts a transaction so provisioning can insert inside its own.
export async function grantEnterprises(
  tenantId: string,
  enterprises: string[],
  opts: { source: EnterpriseSource; grantedByUserId?: string | null; tx?: typeof db } = { source: 'onboarding' },
): Promise<string[]> {
  const seen = new Set<string>()
  const values = []
  for (const raw of enterprises) {
    const enterprise = normalizeEnterprise(raw)
    if (!isValidEnterpriseKey(enterprise) || seen.has(enterprise)) continue
    seen.add(enterprise)
    values.push({
      id: randomUUID(),
      tenantId,
      enterprise,
      source: opts.source,
      grantedByUserId: opts.grantedByUserId ?? null,
    })
    if (values.length >= MAX_ENTERPRISES_PER_TENANT) break
  }
  if (values.length === 0) return []

  const conn = opts.tx ?? db
  await conn.insert(tenantEnterprises).values(values).onConflictDoNothing({
    target: [tenantEnterprises.tenantId, tenantEnterprises.enterprise],
  })
  return [...seen]
}

// Revoking is intentionally narrow: it removes the tenant's PERMISSION to
// start new work in an enterprise and touches no existing batch. Historical
// batches, their records and their reports stay exactly as they are — deleting
// or reassigning them would rewrite the farm's history to match a
// present-tense settings change.
export async function revokeEnterprise(tenantId: string, rawEnterprise: string): Promise<boolean> {
  const enterprise = normalizeEnterprise(rawEnterprise)
  if (!enterprise) return false
  const removed = await db
    .delete(tenantEnterprises)
    .where(and(eq(tenantEnterprises.tenantId, tenantId), inArray(tenantEnterprises.enterprise, [enterprise])))
    .returning({ id: tenantEnterprises.id })
  return removed.length > 0
}
