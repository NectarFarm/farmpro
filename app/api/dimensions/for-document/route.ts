import { NextResponse } from 'next/server'
import { db } from '@/db'
import { requireTenantSession } from '@/lib/api-auth'
import { getDocumentDimensions } from '@/lib/dimensions'

// ── GET /api/dimensions/for-document (dimensions-operable task, owner
// addition 2026-09-20: "the journal entry view should show the dimensions
// carried on its lines") ────────────────────────────────────────────────────
// A sale/purchase/payroll-run detail view, or a journal-entry view, calls
// this to read back how a posting was actually analysed —
// `journal_line_dimensions`/`document_dimensions` have been populated since
// the original dimensions-on-gl task with nothing reading them until now.
//
// GET /api/dimensions/for-document?tenantId=&docType=sale&docId=<id>

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

const DOC_TYPES = new Set(['sale', 'purchase', 'payroll_run'])

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession({ explicitTenantId: url.searchParams.get('tenantId') ?? undefined })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const docType = url.searchParams.get('docType') ?? ''
  const docId = url.searchParams.get('docId') ?? ''
  if (!DOC_TYPES.has(docType) || !docId) return badRequest('docType (sale|purchase|payroll_run) and docId are required')

  const result = await getDocumentDimensions(db, tenantId, docType as 'sale' | 'purchase' | 'payroll_run', docId)
  return ok(result)
}
