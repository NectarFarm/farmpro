# SaaS back-office API

Backend for platform-admin staff permissions, subscription billing, and
support tickets/chatbot. Built on `feat/backoffice`. UI is out of scope —
this document is the contract other agents build the UI against.

Every route follows the codebase's existing conventions:

- **Envelope**: `{ success: true, data }` or `{ success: false, error, fields? }`.
  A validation failure returns `fields` keyed by request-body field name.
- **Auth**: every route calls `requireSession` / `requireRole` /
  `requireTenantSession` / `requirePlatformCapability` from `lib/api-auth.ts`
  before touching request data. No session → `401`. Session but wrong
  role/capability → `403`. A tenant-scoped route resolves its tenant from
  the session only (never a client-supplied `tenantId`, except the existing
  super_admin `explicitTenantId` opt-in where a route already used it).
- **Money**: every amount is an integer number of minor units (cents),
  matching `lib/money.ts`'s existing convention. `POST` bodies that accept a
  user-typed amount (e.g. `POST /api/billing/payments`) accept major units
  and convert via `lib/money.ts#parseMoneyToCents`.

---

## 1. Platform staff capabilities

### Model

- `users.role` gains no new value — `super_admin` is still the only platform
  role. Capabilities are layered on top via the new `platform_staff` table
  (`db/schemas/platform.ts`).
- **Backward compatibility (load-bearing):** a `super_admin` user with **no**
  `platform_staff` row has **every** capability. A row with `active: false`
  has **none**. This is what keeps the pre-existing founder account (and any
  admin nobody has configured yet) working unchanged.
- Capabilities (`lib/platform-staff.ts#CAPABILITIES`):
  `tenants.manage`, `users.manage`, `billing.manage`, `support.handle`,
  `support.assign`, `staff.manage`, `onboarding.review`, `impersonate`,
  `analytics.view`.
- `requirePlatformCapability(cap)` (`lib/api-auth.ts`) = `requireRole(['super_admin'])`
  + a capability check. Every admin route below uses it instead of a bare
  role check.

### GET /api/admin/me

Any `super_admin` session. Returns the caller's own resolved capabilities —
used by the UI to decide which admin screens to offer.

```
200 { success: true, data: { userId, name, email, capabilities: string[] } }
```

### GET /api/admin/staff

Capability: `staff.manage`. Returns every `super_admin` user, including ones
with **no** `platform_staff` row (`hasRow: false`, `capabilities` shows the
full implicit set) — the staff screen needs to represent those too, not just
explicitly-onboarded staff.

```
200 { success: true, data: [{
  userId, name, email, status, hasRow, title, capabilities: string[],
  active, createdBy, createdAt, updatedAt
}] }
```

### POST /api/admin/staff

Capability: `staff.manage`. Creates a **new** `super_admin` user + a
`platform_staff` row.

```
Body: { name, email, title?, capabilities?: string[] }
201 { success: true, data: {
  userId, name, email, title, capabilities, active: true,
  tempPassword,          // one-time reveal, never persisted in plaintext, never logged
  setPasswordToken,      // lib/set-password.ts token, for a future "invite by email" flow
  setPasswordExpiresAt
} }
400 { fields: { name?, email?, capabilities? } }
409 { fields: { email: "already in use" } }
```

### PATCH /api/admin/staff/[id]

Capability: `staff.manage`. `id` = the staff member's `users.id`. Upserts the
`platform_staff` row (a currently no-row super_admin can be given an explicit
row this way). Omitting `capabilities` on a first-time upsert preserves the
full implicit set (never silently narrows to zero by accident).

```
Body: { title?, capabilities?: string[], active?: boolean }
200 { success: true, data: { userId, title, capabilities, active } }
400 "You cannot remove your own staff.manage capability."
400 "This is the last admin with every capability — promote another admin to full capabilities first."
404 "Staff account not found"
```

### DELETE /api/admin/staff/[id]

Capability: `staff.manage`. **Never** issues a real SQL delete against
`platform_staff` — removing the row would fall back to "no row = all
capabilities" and silently promote the person it was meant to demote.
Instead: writes an `active: false`, zero-capability row, sets the
underlying `users.status = 'SUSPENDED'` (blocks login via the existing
issue #223 gate), and deletes all of that user's live sessions.

```
403/400 same self-protection and last-full-admin rules as PATCH; a caller can never target their own id (400).
200 { success: true, data: { userId, active: false } }
```

### Retrofitted existing `/api/admin/*` routes

Identical behaviour for a no-row super_admin; now capability-gated instead
of a bare `role === 'super_admin'` check:

| Route | Capability |
|---|---|
| `GET /api/admin/tenants` | `tenants.manage` |
| `GET/PATCH /api/admin/users`, `/api/admin/users/[id]` | `users.manage` |
| `POST /api/admin/users/[id]/reset-password` | `users.manage` |
| `GET /api/admin/password-resets` | `users.manage` |
| `POST /api/admin/users/[id]/impersonate` | `impersonate` |
| `GET /api/admin/impersonation-log` | `impersonate` |
| `GET/PATCH /api/admin/enterprise-requests`, `/[id]` | `onboarding.review` |
| `GET /api/onboard-requests` (review queue) | `onboarding.review` |
| `GET /api/admin/stats` | `analytics.view` |

`POST /api/admin/impersonate/stop` is unchanged (no role check — the caller
IS the impersonated browser at that point; see its own code comment).

---

## 2. Billing

### Schema summary (`db/schemas/billing.ts`)

- **`plans`**: `code` (unique), `name`, `tagline`, `description`,
  `features: string[]`, `limits: {maxFarms,maxUsers,maxUnits}` (each a
  number or `null` = unlimited), `prices: {monthly?,quarterly?,annual?}`
  (cents), `currency`, `trialDays`, `isPublic`, `isActive`, `sortOrder`.
- **`subscriptions`**: one **current** row per tenant (`isCurrent: true`,
  enforced by a partial unique index on `tenantId`); prior rows are kept as
  history (`isCurrent: false`), never deleted. `status`:
  `trialing | pending_payment | active | past_due | cancelled | expired`.
- **`discounts`**: `code` (stored upper-cased, unique), `kind: percent|fixed`,
  `value`, `appliesToPlans`/`appliesToPeriods` (`null` = all),
  `tenantId` (`null` = any tenant), validity window, `maxRedemptions`.
- **`payments`**: a tenant-submitted claim (`method`, `reference`, `payerNote`)
  reviewed by an admin (`status: pending|confirmed|rejected`).

`lib/billing/provider.ts` defines a `PaymentProvider` interface; only
`ManualPaymentProvider` exists (records nothing itself — a human reviews
every payment). A real gateway (M-Pesa/MTN MoMo/card) slots in by
implementing that interface and swapping `getPaymentProvider()`'s body.

### Status machine (`lib/billing/access-state.ts`)

Nothing rewrites `subscriptions.status` just because a clock ticked past a
date — every reader recomputes the **effective** status live:

```
trialing  --(trialEndsAt passed)-->        past_due
active    --(currentPeriodEnd passed,
             cancelAtPeriodEnd=false)-->    past_due
active    --(currentPeriodEnd passed,
             cancelAtPeriodEnd=true)-->     cancelled   (no grace — deliberate non-renewal)
past_due  --(7 days past whichever
             boundary caused it)-->        expired
```

`pending_payment`, `cancelled`, `expired` are terminal (only change via a
new subscribe/admin action/payment). `needsPlan = true` iff the effective
status is `expired`, `cancelled`, `pending_payment`, or there is no
subscription row at all. A `past_due` subscription **within** its 7-day
grace is **not** `needsPlan` — that's the whole point of the grace period.

`app/api/cron/update-subscriptions` (daily, same `CRON_SECRET` pattern as
`cleanup-sessions`) persists this transition once a day purely so a plain
`WHERE status = ...` (e.g. an admin filter) stays close to accurate — every
actual read path recomputes it live regardless and does not depend on this
cron having run.

### Tenant API

Billing is treated as an **owner-level concern** throughout (same
"owner-controlled by default" precedent `lib/permissions.ts` already applies
to finance/payroll): every mutation, `POST /api/billing/quote`, and
`GET /api/billing/payments` are owner-only. Only
`GET /api/billing/subscription` is open to every tenant role (read-only
status).

#### GET /api/billing/plans

Any authenticated session. Returns `is_public && is_active` plans only
(hidden plans like `legacy` never appear here).

```
200 { success: true, data: Plan[] }
```

#### GET /api/billing/subscription

Any tenant-scoped role.

```
200 { success: true, data: {
  subscription: { id, planId, period, status, trialEndsAt, currentPeriodStart,
                  currentPeriodEnd, listPriceCents, discountAmountCents,
                  amountDueCents, cancelAtPeriodEnd } | null,
  plan: { id, code, name, tagline, features, limits, currency } | null,
  usage: { farms, users, units },   // real counts, not cached
  access: { status, needsPlan }     // effective status
} }
```

#### POST /api/billing/quote

Owner only. Pure preview — no discount redemption is consumed.

```
Body: { planId, period: 'monthly'|'quarterly'|'annual', discountCode? }
200 { success: true, data: {
  planId, planCode, period, currency, discountCode,
  listPriceCents, discountAmountCents, amountDueCents
} }
400 "This plan does not offer a <period> price." | discount validation error
404 "Plan not found or not available" | "Discount code not found"
```

#### POST /api/billing/subscribe

Owner only. Starts a trial when `plan.trialDays > 0`, else `pending_payment`.
Supersedes (not deletes) any existing current subscription.

```
Body: { planId, period, discountCode? }
201 { success: true, data: { subscriptionId, status, trialEndsAt, amountDueCents } }
```

#### POST /api/billing/payments

Owner only. Submits a payment claim against the current subscription.

```
Body: { amount, method: 'mobile_money'|'bank'|'card'|'cash'|'other', reference, note? }
201 { success: true, data: { id, status: 'pending' } }
404 "No subscription to pay against. Choose a plan first."
```

#### GET /api/billing/payments

Owner only. This tenant's full payment history, newest first.

#### POST /api/billing/cancel

Owner only. Mid-cycle (active with a real `currentPeriodEnd`): soft cancel
— `cancelAtPeriodEnd: true`, access continues to period end. Nothing to run
out (trialing/pending_payment, or an open-ended subscription like the
legacy backfill): cancelled immediately.

```
200 { success: true, data: { status, cancelAtPeriodEnd } }
404 "No active subscription to cancel"
409 "Subscription is already <status>"
```

### Admin API (capability: `billing.manage`)

#### CRUD /api/admin/plans, /api/admin/plans/[id]

`GET` (list/one) returns every plan (public or not). `POST`/`PATCH` share
`lib/billing/plan-validation.ts`. `DELETE` **archives**
(`isActive: false, isPublic: false`) — never a real delete, since
`subscriptions.planId` references a plan with no DB-level FK.

```
POST body:  { code, name, tagline?, description?, features?, limits?, prices?, currency?, trialDays?, isPublic?, isActive?, sortOrder? }
PATCH body: any subset of the same fields
409 { fields: { code: "already in use" } }
```

#### CRUD /api/admin/discounts, /api/admin/discounts/[id]

Same shape/`DELETE`-archives convention as plans, via
`lib/billing/discount-validation.ts`.

```
POST body: { code, kind: 'percent'|'fixed', value, appliesToPlans?, appliesToPeriods?, tenantId?, validFrom?, validUntil?, maxRedemptions?, isActive?, note? }
```

#### GET /api/admin/subscriptions

Every tenant's current subscription, joined to tenant + plan.
`?status=` filters on the **effective** status (never the raw column).

```
200 { success: true, data: [{
  tenantId, tenantName, tenantActive, subscriptionId, planId, planCode,
  planName, period, status, needsPlan, trialEndsAt, currentPeriodStart,
  currentPeriodEnd, listPriceCents, discountAmountCents, amountDueCents,
  cancelAtPeriodEnd
}] }
```

#### PATCH /api/admin/subscriptions/[tenantId]

All fields optional, applied together; every change is audit-logged.

```
Body: {
  planId?, period?,                 // switches plan/period, recomputes pricing
  status?,                          // direct override: trialing|pending_payment|active|past_due|cancelled|expired
  trialEndsAt?, currentPeriodEnd?,  // absolute date (ISO string) or null
  extendTrialDays?, extendPeriodDays?, // ADD n days (negative shortens) — ignored if the absolute field above is also given
  discountCode?,                    // string applies/replaces; null clears
  cancelAtPeriodEnd?
}
200 { success: true, data: <updated subscription row> }
404 "This tenant has no current subscription"
```

#### GET /api/admin/payments?status=pending

Defaults to the actionable `pending` queue; `?status=all` for full history.

#### POST /api/admin/payments/[id]/confirm

`{ reviewNote? }`. Subscription → `active`, period advanced from
`max(now, currentPeriodEnd)` via `lib/billing/subscriptions.ts#advanceSubscriptionOnPayment`.
Guarded against a double-confirm race.

```
200 { success: true, data: { id, status: 'confirmed' } }
409 "This payment was already <status>."
```

#### POST /api/admin/payments/[id]/reject

`{ reviewNote }` (**required**). Subscription is left untouched — the tenant
can resubmit via `POST /api/billing/payments`.

### `session.subscription` contract

`GET /api/auth/session` additively carries, for tenant-scoped sessions only
(`null` for `super_admin`):

```json
{
  "subscription": {
    "status": "trialing",
    "planName": "Smallholder",
    "trialEndsAt": "2026-10-06T00:00:00.000Z",
    "currentPeriodEnd": null,
    "needsPlan": false
  }
}
```

`status` is always the effective status. **The UI is expected to route to
plan selection before the dashboard when `needsPlan` is true** — this is
NOT enforced at the API level in this pass (see Follow-ups).

---

## 3. Support: tickets, complaints, chatbot

### Schema summary (`db/schemas/support.ts`)

- **`support_tickets`**: `number` (`"T-1001"`, off a real Postgres sequence
  `support_ticket_number_seq`, starts at 1001), `category`, `priority`,
  `status`, `assignedTo`, `source: chatbot|form|admin`, `rating`.
- **`ticket_messages`**: `authorKind: customer|staff|bot|system`,
  `isInternal` (staff-only notes — **never** returned to a customer session,
  enforced in every customer-facing route, proven in
  `tests/backoffice-support.test.ts`).
- **`ticket_events`**: an append-only progress timeline
  (`created|status_changed|assigned|priority_changed|replied|rated`),
  separate from the message conversation.
- **`chat_throttle`**: a generic fixed-window rate limit (30 messages/hour
  per user) for the chatbot endpoint.

### Status machine

```
open -> in_progress -> waiting_on_customer -> resolved -> closed
                                            \-> reopened (back to open, via POST .../reopen)
```
Rating is only accepted while `resolved`/`closed`; reopening is only
accepted from `resolved`/`closed`.

### Notifications

Reuses the **existing** `notifications` table/mechanism
(`lib/notification-email.ts#createAndEmailNotification`) — **no schema
extension was needed**. A staff-facing notification uses the same
`PLATFORM_TENANT_SENTINEL` tenant scope `POST /api/auth/forgot-password`'s
admin notification already established (a tenantless session already
resolves its own feed to that scope), targeted at a specific `userId`
(the assigned staff member, or every `support.handle`-capable staff member
individually when unassigned, via `lib/platform-staff.ts#listCapableStaffUserIds`).
A customer is notified (targeted at their own `userId`) on every staff
reply and status change, with a distinct "please rate" message on resolve.

### Customer API (any authenticated tenant user)

A non-owner only ever sees tickets **they raised**; an owner sees every
ticket in their tenant. Cross-tenant access is always a `404`, never `403`
(`lib/support/tickets.ts#canCustomerAccessTicket` is the one gate every
route below shares).

#### GET/POST /api/support/tickets

```
POST body: { subject, body, category?, priority? }
201 { success: true, data: <ticket row> }
```

#### GET /api/support/tickets/[id]

```
200 { success: true, data: { ticket, messages /* isInternal excluded */, events } }
404 "Ticket not found"   // both "doesn't exist" and "not yours" — no distinction leaked
```

#### POST /api/support/tickets/[id]/messages

`{ body }` — always `authorKind: 'customer'`, never internal.

#### POST /api/support/tickets/[id]/rate

`{ rating: 1-5, comment? }`. `409` unless `resolved`/`closed`.

#### POST /api/support/tickets/[id]/reopen

No body. `409` unless `resolved`/`closed`.

### Chatbot

#### POST /api/support/chat

```
Body: { messages: [{ role: 'user'|'assistant', content }] }
200 { success: true, data: { reply, suggestTicket?: { subject, category, priority, summary } } }
429 { error, retryAfterSeconds }   // per-user throttle, 30/hour
```

Reuses `lib/ai-advisor.ts`'s OpenRouter client with a support system prompt
(`lib/support/chatbot.ts#SUPPORT_SYSTEM_PROMPT`). No tool-calling exists in
that client, so the model is asked to end its reply with a parseable
`ESCALATE: {"category":...,"priority":...,"subject":...}` marker line, which
is stripped before the reply reaches the caller. A keyword-based fallback
(`detectEscalationIntent`) runs independently on the user's own last message
— "I need a human", a billing complaint, a bug report, or a general
complaint always suggests a ticket, even if the model forgets the marker.

**With no `OPENROUTER_API_KEY` configured**, this still returns `200` with a
canned reply **and** a `suggestTicket` — the escalation path works with no
AI backend at all.

#### POST /api/support/chat/escalate

```
Body: { messages: [...], subject?, category?, priority? }
201 { success: true, data: { ticketId, ticketNumber } }
```

Creates a ticket with `source: 'chatbot'` and the transcript as its opening
messages (each `user` turn → a customer message, each `assistant` turn → a
bot message).

### Staff API (capability: `support.handle`)

#### GET /api/admin/tickets

Filters: `status`, `priority`, `category`, `tenant` (tenantId), `q` (subject
substring), `assignee` = `me` | `unassigned` | a specific staff user id.

#### POST /api/admin/tickets

Staff opens a ticket **on behalf of** a tenant (e.g. logging a phone call).

```
Body: { tenantId, raisedBy, subject, body, category?, priority? }
201 { success: true, data: <ticket row> }   // source: 'admin', auto-assigned to the creating staff member
```

#### GET /api/admin/tickets/[id]

Includes internal notes plus the tenant + raiser's name/email (the customer
route never returns either).

#### PATCH /api/admin/tickets/[id]

```
Body: { status?, priority?, assignedTo? }  // assignedTo: a staff user id, or null to unassign
403 "Assigning a ticket to someone else requires support.assign"
```

Assigning to **yourself** or clearing the assignment only needs
`support.handle`; assigning to a **different** staff member additionally
requires `support.assign`.

#### POST /api/admin/tickets/[id]/messages

```
Body: { body, internal?: boolean }
```

---

## 4. Tenant and user management (admin)

### GET/PATCH /api/admin/tenants/[id]

Capability: `tenants.manage`.

```
200 { success: true, data: {
  tenant, users /* SAFE_USER_COLUMNS */,
  subscription: { ...same shape as billing subscription... } | null,
  usage, limits, payments /* full history */, openTicketCount,
  notes: [{ id, note, authorId, authorName, createdAt }],   // append-only, never edited/deleted
  lastActivityAt   // most recent session.createdAt among this tenant's users, or null
} }
```

```
PATCH body: { active?: boolean, note?: string }   // either or both
```

`active` reuses the **existing** suspension mechanism
(`tenants.active`, gated at login/session by issue #223's `isTenantActive` —
no second suspension flag was added). `note` appends a `tenant_admin_notes`
row.

### Gaps filled on the existing `/api/admin/users*` routes

`GET /api/admin/users` already supported filter-by-tenant/role/status
(`?tenantId=`, `?role=`, `?status=`), and `PATCH /api/admin/users/[id]`
already supported disable/enable (`status: 'ACTIVE'|'SUSPENDED'`) and role
change — these were **not** gaps. The one genuine gap:

#### POST /api/admin/users/[id]/logout

Capability: `users.manage`. Deletes every live session row for the user —
there was no way to end a user's current sessions without also resetting
their password or suspending the account outright.

```
200 { success: true, data: { sessionsEnded: number } }
```

### Audit log

Every admin mutation in this feature writes to the **existing** audit-log
mechanism (`lib/audit.ts#writeAuditLog`, table `audit_log`,
`GET /api/audit-log`'s source) — actions: `staff.create`, `staff.update`,
`staff.delete`, `subscription.update`, `payment.confirm`, `payment.reject`,
`tenant.suspend`, `tenant.reactivate`, `tenant.note`, `user.force-logout`.
A platform-level action (no real tenant, e.g. `staff.create`) is recorded
under `lib/audit.ts`'s existing `PLATFORM_TENANT_SENTINEL` value, same
convention as every pre-existing platform-level audit entry.

---

## Migration & seed data

`drizzle/0042_backoffice_billing_support_staff.sql`:

1. Creates every new table (`platform_staff`, `tenant_admin_notes`, `plans`,
   `subscriptions`, `discounts`, `payments`, `support_tickets`,
   `ticket_messages`, `ticket_events`, `chat_throttle`).
2. Creates `support_ticket_number_seq` (`START WITH 1001`).
3. Seeds a hidden `legacy` plan (`is_public: false`, no price, no limits)
   and gives **every tenant that already existed** an `active` subscription
   on it with **no end date** — so `needsPlan` reads `false` for every one
   of them, forever, unless a platform admin deliberately moves them onto a
   real plan.
4. Seeds 3 public plans (Smallholder / Growing farm / Enterprise) as plain
   editable rows — nothing about pricing/limits/features is hardcoded in
   application code; `PATCH /api/admin/plans/[id]` edits them like any other
   plan.

Applied locally and verified: all 25 pre-existing tenants in the local DB
received an active, open-ended `legacy` subscription. `pnpm db:migrate`
(local) and `scripts/deploy-migrate.mjs` (Vercel build) and the
`docker-compose.yml` `migrate` service (`pnpm db:migrate` against the
builder image) all drive off the same `drizzle/` folder + journal — no
special-casing was needed for this migration to be picked up by any of the
three.

---

## Follow-ups deliberately left out of this pass

- **No API-level blocking of farm routes on `needsPlan`.** The session
  contract exists so the UI can route to plan selection, but no existing
  farm/data route checks subscription status before serving a request —
  flagged in the task brief as too risky for this pass, left exactly that
  way.
- **PATCH /api/onboard-requests/[id]** (approve/reject a signup) was **not**
  retrofitted to require `onboarding.review` — only the **GET review queue**
  was, per the task's explicit scope. Worth revisiting for consistency: a
  capability-scoped reviewer can currently see the queue but not act on it.
- **No real payment gateway.** `lib/billing/provider.ts`'s `PaymentProvider`
  interface is the seam; only `ManualPaymentProvider` exists.
- **`GET /api/admin/tickets`'s `q` filter** only matches ticket subject, not
  message bodies — a full-text search across message content would need a
  dedicated index and was out of scope here.
- **`lastActivityAt`** on the tenant overview is a proxy (most recent
  session creation), not a true last-request timestamp — no per-request
  activity log exists anywhere in this codebase to read instead.
