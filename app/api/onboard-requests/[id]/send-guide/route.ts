import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { onboardRequests } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { sendOnboardingGuideEmail } from '@/lib/email'

// ── POST /api/onboard-requests/[id]/send-guide (onboarding-guide follow-up) ─
// super_admin only. Re-sends the getting-started guide to an already-approved
// applicant — the approval email sent it once already, but a farmer who
// deleted that mail, or an admin fielding a "what do I do now" call, needs a
// way to get it again without re-approving anything or minting a new
// set-password link (that link is single-use — see lib/email.ts's
// sendOnboardingGuideEmail for why it's deliberately left out here).
//
// Restricted to 'approved' requests with a real tenantId because the guide
// itself assumes a signed-in account with a farm already provisioned — a
// still-pending applicant has neither, and sending it early would describe
// screens that don't do anything for them yet.
const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (session.role !== 'super_admin') return bad('Forbidden', 403)

  const { id } = await params
  const rows = await db.select().from(onboardRequests).where(eq(onboardRequests.id, id)).limit(1)
  const existing = rows[0]
  if (!existing) return bad('Onboarding request not found', 404)

  if (existing.status !== 'approved' || !existing.tenantId) {
    return bad('Only an approved request can be sent the getting-started guide')
  }

  const result = await sendOnboardingGuideEmail({
    to: existing.email,
    farmerName: existing.farmerName,
    farmName: existing.farmName,
  })
  // Unlike the approval/rejection emails (best-effort side effects of an
  // operation that already succeeded), sending mail IS the entire point of
  // this endpoint — a failure here has to be reported, not swallowed.
  if (!result.ok) {
    console.error('[onboard-send-guide] email failed', { requestId: id, result })
    return bad(result.error || 'Failed to send the getting-started guide', 500)
  }

  return NextResponse.json({ success: true, data: { sent: true } }, { status: 200 })
}
