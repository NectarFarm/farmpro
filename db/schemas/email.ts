// ── Email-flow tokens (feat/email-notifications) ────────────────────────────
// Two single-purpose, expiring, tokenised links that let someone with NO
// session act on exactly one thing — same shape as auditorLinks
// (db/schemas/auditor.ts): a random token with a real DB-level unique index
// and an expiresAt, plus a way to mark a row spent so a stale link can't be
// replayed once it's done its job.
import { pgTable, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { users } from './auth'
import { onboardRequests } from './onboarding'

// Minted once per onboarding approval (PATCH /api/onboard-requests/[id])
// instead of emailing the temp password itself — see lib/set-password.ts.
// SINGLE-USE: `usedAt` is set the moment the link is actually used to set a
// password (POST /api/set-password/[token]), and a used or expired token is
// refused. Minting a new one for the same user (lib/set-password.ts's
// issueSetPasswordToken) marks any prior unused token for that user as
// spent too, so at most one link is ever live per user — the same "one live
// credential" discipline POST /api/auditor-link applies per tenant.
export const setPasswordTokens = pgTable('set_password_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  usedAt: timestamp('used_at'),
}, (t) => [
  index('idx_set_password_tokens_user').on(t.userId),
  uniqueIndex('idx_set_password_tokens_token').on(t.token),
])

// Minted when a super_admin marks an onboarding request 'info-needed', so
// the applicant — who has no account at all — can reach a public page that
// lets them correct and resubmit their own request (POST
// /api/onboard-requests/update/[token]). Unlike setPasswordTokens this is
// NOT single-use: an applicant may need several attempts before their
// correction passes validation. `usedAt` here means "closed out" rather
// than "spent once" — set either when a fresh token is minted for the same
// request (superseding this one) or once a resubmission through it succeeds
// (which moves the request back to 'pending' for re-review); a further
// correction after that needs a new info-needed cycle and a fresh link.
export const onboardUpdateTokens = pgTable('onboard_update_tokens', {
  id: text('id').primaryKey(),
  onboardRequestId: text('onboard_request_id').notNull().references(() => onboardRequests.id),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  usedAt: timestamp('used_at'),
}, (t) => [
  index('idx_onboard_update_tokens_request').on(t.onboardRequestId),
  uniqueIndex('idx_onboard_update_tokens_token').on(t.token),
])
