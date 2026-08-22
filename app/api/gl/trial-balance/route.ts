import { NextResponse } from 'next/server'
import { computeTrialBalance } from '@/lib/finance'
import { requireTenantSession } from '@/lib/api-auth'

// ── GET /api/gl/trial-balance (issue #239 task 4; auth fix:
// fix/authenticate-all-apis) ─────────────────────────────────────────────────
// Tenant-scoped: sums this tenant's real journal_lines (posted from real
// sales/purchases writes only — see lib/finance.ts's computeTrialBalance) per
// account. `balanced: totalDebits === totalCredits` is the shape the issue's
// acceptance criteria asks a test to prove; since every posting function
// inserts a debit and a credit of the same amount per entry, this always
// balances by construction as long as every entry was posted through
// lib/finance.ts's postSaleJournal / postPurchaseJournal.
//
// Tenant comes from the caller's own session for every tenant-scoped role —
// this used to fall back to a `tenantId` query param for ANY session-less
// caller, which meant any tenant's trial balance was readable by anyone who
// guessed its id. A super_admin session (no tenant of its own) may still
// name one explicitly via `?tenantId=`, same convention as GET /api/farms.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })

export async function GET() {
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error

  const trialBalance = await computeTrialBalance(auth.tenantId)
  return ok(trialBalance)
}
