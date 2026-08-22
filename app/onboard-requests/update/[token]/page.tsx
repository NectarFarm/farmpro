import { OnboardUpdateView } from './onboard-update-view'

// ── /onboard-requests/update/[token] (feat/email-notifications) ────────────
// The real, public page an applicant marked 'info-needed' by a super_admin
// (PATCH /api/onboard-requests/[id]) actually lands on to correct and
// resubmit their own request — same server-component-wraps-client-view
// shape as app/auditor/[token]/page.tsx and app/set-password/[token]/page.tsx.
// All fetching/submitting is client-side (onboard-update-view.tsx), hitting
// the token-gated GET/POST /api/onboard-requests/update/[token] route.
export default async function OnboardUpdatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <OnboardUpdateView token={token} />
}
