import { NextResponse } from 'next/server'
import { inArray } from 'drizzle-orm'
import { db } from '@/db'
import { accounts } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'
import { previewDocumentDimensions, isPlainDimensionMap, type MasterType } from '@/lib/dimensions'
import { ACCOUNT_CODES } from '@/lib/finance'

// ── POST /api/dimensions/resolve (dimensions-operable task, owner addition
// 2026-09-20: "we also have purchase and sell pages which will also be
// affected, so we need proper linkage") ────────────────────────────────────
// A sale/purchase/payroll form calls this BEFORE submitting, to show what
// dimensions the posting will carry (most already derivable — a sale
// against a batch already knows its farm) and to find out which of the
// target account's REQUIRED dimensions nothing in that chain supplies, so
// the form can ask for a value up front instead of letting the user hit
// DimensionRequirementError after they've filled in everything else. Uses
// the exact same resolution path the real post runs
// (lib/dimensions.ts's previewDocumentDimensions wraps
// resolveMasterDimensions + applyAccountRules, same as
// lib/finance.ts's captureDimensions) — a preview that used different logic
// could say "all good" and then have the real post refuse anyway.
//
// Body: { tenantId?, docType: 'sale'|'purchase'|'payroll_run',
//         masterType?, masterId?, dimensions?: Record<code,valueCode> }
// `masterType`/`masterId` name the source master the document is against
// (a sale/purchase's batchId, a payroll run's employeeId) — omit both for
// "nothing chosen yet" (e.g. a sale form before a batch is picked), which
// still reports what the ACCOUNT alone requires.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string, fields?: Record<string, string>) =>
  NextResponse.json({ success: false, error: msg, ...(fields ? { fields } : {}) }, { status: 400 })

const DOC_TYPES = new Set(['sale', 'purchase', 'payroll_run'])
const MASTER_TYPES = new Set(['employee', 'unit', 'batch', 'farm', 'product', 'account'])

// Which account(s) each document type posts to — mirrors
// lib/finance.ts's post*Journal functions. Sale/purchase choose their
// debit/credit account by status (paid vs pending); this preview checks
// BOTH, since the user may not have picked a status yet and a stricter of
// the two accounts' rules is safer to surface than none.
const DOC_ACCOUNT_CODES: Record<string, string[]> = {
  sale: [ACCOUNT_CODES.CASH, ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, ACCOUNT_CODES.SALES_REVENUE],
  purchase: [ACCOUNT_CODES.CASH, ACCOUNT_CODES.ACCOUNTS_PAYABLE, ACCOUNT_CODES.PURCHASES_EXPENSE],
  payroll_run: [ACCOUNT_CODES.CASH, ACCOUNT_CODES.PAYROLL_EXPENSE],
}

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const auth = await requireTenantSession({ explicitTenantId: typeof b.tenantId === 'string' ? b.tenantId : undefined })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const docType = typeof b.docType === 'string' ? b.docType : ''
  if (!DOC_TYPES.has(docType)) return badRequest('docType must be one of: sale, purchase, payroll_run', { docType: 'Invalid' })

  const masterType = typeof b.masterType === 'string' ? b.masterType : ''
  const masterId = typeof b.masterId === 'string' ? b.masterId : ''
  if (masterType && !MASTER_TYPES.has(masterType)) return badRequest('Invalid masterType', { masterType: 'Invalid' })
  const sourceMaster = masterType && masterId ? { masterType: masterType as MasterType, masterId } : null

  const explicit = isPlainDimensionMap(b.dimensions) ? b.dimensions : {}

  const codes = DOC_ACCOUNT_CODES[docType]
  const accountRows = await db.select().from(accounts).where(inArray(accounts.code, codes))
  // Accounts not yet seeded for this database (ensureAccountsSeeded not run) —
  // treat as "nothing to check" rather than erroring; the real post will
  // seed them itself.
  const preview = await previewDocumentDimensions(db, tenantId, sourceMaster, explicit, accountRows.map((a) => ({ id: a.id, code: a.code, name: a.name })))
  return ok(preview)
}
