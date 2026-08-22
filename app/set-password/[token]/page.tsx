import { SetPasswordView } from './set-password-view'

// ── /set-password/[token] (feat/email-notifications) ────────────────────────
// The real, public page an approved onboarding applicant's email link points
// at (PATCH /api/onboard-requests/[id] mints the token, lib/email.ts sends
// the link) — same server-component-wraps-client-view shape as
// app/auditor/[token]/page.tsx, so `token` can come out of the async
// `params` dynamic routes get. All fetching/submitting is client-side
// (set-password-view.tsx), hitting the token-gated
// GET/POST /api/set-password/[token] route, never a session.
export default async function SetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <SetPasswordView token={token} />
}
