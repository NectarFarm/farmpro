import { AuditorReportsView } from './auditor-view'

// ── /auditor/[token] (issue #313) ────────────────────────────────────────────
// The real, shareable "auditor link" URL components/farm/reports.tsx's
// 'Generate Auditor Link' button now actually generates (see
// POST /api/auditor-link). A server component only so `token` can come out
// of the async `params` the framework gives dynamic routes — all the actual
// fetching/rendering is client-side (auditor-view.tsx), hitting the
// token-gated GET /api/auditor/[token]/reports/[type] route, never a session.
export default async function AuditorLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <AuditorReportsView token={token} />
}
