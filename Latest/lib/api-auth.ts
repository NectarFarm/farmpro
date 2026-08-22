// ── Shared API auth guard (fix/authenticate-all-apis) ───────────────────────
// Before this task, most routes resolved their tenant as
// `session?.tenantId ?? searchParams.get('tenantId')` (or the same fallback
// on a body field for writes). With no session that falls back straight to
// whatever tenantId the caller names — so anyone who guessed/knew a tenant id
// could read (or, on the body-fallback routes, write) that tenant's data with
// zero credentials. Confirmed live: an unauthenticated caller could pull farm
// lists, dashboard KPIs, a full P&L report, and notifications naming a real
// user's name/email.
//
// This module is the one place a route says "I need a session" or "I need a
// tenant-scoped session" — every route that isn't on the public allowlist
// (see tests/api-auth-coverage.test.ts) must call one of these before it
// touches request data, so the pattern stays greppable: a future route that
// forgets this is obviously missing it, and the coverage test fails loudly
// instead of silently.
//
// super_admin sessions carry `tenantId: null` and legitimately act across
// tenants — but only when the ROUTE deliberately opts in by passing
// `explicitTenantId` (pulled from the query string or body AT THE CALL SITE,
// never read from the request by this module itself). That is what keeps
// cross-tenant access an explicit, audited-by-the-route-author decision
// rather than a blanket fallback anyone can trigger. For every tenant-scoped
// role (owner/manager/worker/vet/auditor), the session's own tenantId always
// wins — a query/body tenantId is never even consulted.
import 'server-only'
import { NextResponse } from 'next/server'
import { getSessionUser, type SessionUser } from '@/lib/auth'

export const unauthorized = (): NextResponse =>
  NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

export const forbidden = (msg = 'Forbidden'): NextResponse =>
  NextResponse.json({ success: false, error: msg }, { status: 403 })

export type SessionResult =
  | { session: SessionUser }
  | { error: NextResponse }

// Requires any authenticated session — no role or tenant check. Use this for
// routes that are per-user rather than per-tenant (e.g. "my own sessions"),
// or as the base every other helper here builds on.
export async function requireSession(): Promise<SessionResult> {
  const session = await getSessionUser()
  if (!session) return { error: unauthorized() }
  return { session }
}

// Requires a session AND that its role is one of `roles`. A caller with no
// session at all still gets 401 (not 403) — a 403 would confirm to a
// stranger that the route exists and is role-gated, which is information a
// truly unauthenticated request shouldn't get.
export async function requireRole(roles: readonly string[]): Promise<SessionResult> {
  const result = await requireSession()
  if ('error' in result) return result
  if (!roles.includes(result.session.role)) return { error: forbidden() }
  return result
}

export type TenantSessionResult =
  | { session: SessionUser; tenantId: string }
  | { error: NextResponse }

export interface TenantSessionOptions {
  // Restrict to these roles, checked after authentication (see requireRole).
  roles?: readonly string[]
  // A tenant id the CALLING ROUTE already pulled out of its own query string
  // or body. Only ever consulted when the session itself carries no tenant
  // (i.e. super_admin) — every tenant-scoped role's own session.tenantId
  // always wins, full stop. Passing this is what makes "super_admin may name
  // a tenant explicitly" an opt-in per route rather than something every
  // caller gets for free.
  explicitTenantId?: string | null
}

const tenantRequired = (): NextResponse =>
  NextResponse.json({ success: false, error: 'tenantId is required' }, { status: 400 })

// Resolves "is there a session" and "what tenant does it act on" in one call
// — the shape almost every tenant-scoped route needs. Replaces the
// `session?.tenantId ?? request-supplied tenantId` pattern this task closes.
export async function requireTenantSession(opts: TenantSessionOptions = {}): Promise<TenantSessionResult> {
  const result = opts.roles ? await requireRole(opts.roles) : await requireSession()
  if ('error' in result) return result
  const { session } = result

  if (session.tenantId) return { session, tenantId: session.tenantId }

  // Only a super_admin session reaches here (tenantId === null). Cross-tenant
  // access exists only when this specific call named one explicitly.
  const named = opts.explicitTenantId?.trim()
  if (named) return { session, tenantId: named }

  return { error: tenantRequired() }
}
