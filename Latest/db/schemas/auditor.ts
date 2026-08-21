// Auditor / Investor read-only access links (issue #313). The Reports
// screen's 'Generate Auditor Link' button (components/farm/reports.tsx's
// `showAuditor` state) was pure local UI with no backend at all — this
// table, plus POST/DELETE /api/auditor-link and the token-gated
// GET /api/auditor/[token]/reports/[type] route, make it real: an owner
// mints one live token per tenant, ~8h TTL (matching the UI's own "~8h
// link" / "Expires in ~8 hours" copy), that grants read-only access to the
// tenant's real reports (lib/reports.ts, issue #295) — no session, no
// write access.
//
// One row per generated link (not one row per tenant) so a token is never
// silently reused or rotated in place — issuing a new link revokes any
// still-live one for that tenant (see POST /api/auditor-link) rather than
// mutating it, and `revokedAt` lets 'Revoke Link' invalidate a specific
// token immediately without deleting the record of it having existed.
import { pgTable, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const auditorLinks = pgTable('auditor_links', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  revokedAt: timestamp('revoked_at'),
}, (t) => [
  index('idx_auditor_links_tenant').on(t.tenantId),
  // The token is the only credential a reader presents (issue #313's whole
  // point: no session) — a DB-level unique index means a random collision in
  // the token space can never silently let one tenant's link resolve to
  // another tenant's data.
  uniqueIndex('idx_auditor_links_token').on(t.token),
])
