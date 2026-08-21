// ── Shared audit_log writer (admin user-management feature) ────────────────
// `audit_log.tenantId` is NOT NULL (db/schemas/governance.ts), but this
// feature's actions are platform-level: a super_admin (tenantId: null) can be
// the ACTOR of every route here, and the TARGET of an admin action (another
// user being edited/reset/impersonated) can also be a tenantless super_admin.
// Rather than loosen the column (which would weaken every tenant-scoped audit
// query already written against it elsewhere in the codebase), every write
// here records the TARGET user's tenantId when it has one, falling back to
// this documented sentinel string when it doesn't. Real tenant ids are
// randomUUID()s, so this string can never collide with one, and every reader
// of audit_log can special-case it (e.g. "platform-level action") instead of
// silently mis-attributing the row to some real tenant.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { auditLog } from '@/db/schemas'

export const PLATFORM_TENANT_SENTINEL = 'platform'

export interface AuditEntryInput {
  tenantId: string | null
  actor: string
  action: string
  entity: string
  entityId: string
  meta?: Record<string, unknown>
}

// Never pass credentials (passwords, hashes, temp passwords, PINs) in `meta`
// — every call site in this feature is deliberately written to log only
// field names / old->new values / durations, never secrets.
export async function writeAuditLog(entry: AuditEntryInput): Promise<void> {
  await db.insert(auditLog).values({
    id: randomUUID(),
    tenantId: entry.tenantId ?? PLATFORM_TENANT_SENTINEL,
    actor: entry.actor,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    meta: entry.meta ?? {},
  })
}
