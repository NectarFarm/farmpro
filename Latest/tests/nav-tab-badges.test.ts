// ── tabBadge() real-count wiring (issue #298) ───────────────────────────────
// Before this fix, tabBadge() hardcoded `2` for the "tasks" and
// "admin-onboarding" tabs regardless of the tenant's/session's real data — a
// tenant with 0 open tasks or 0 pending onboarding requests still showed a
// fake "2" badge. Both are now driven by real counts the caller passes in
// (openTasksCount from GET /api/dashboard/kpis's activeTasksCount, and
// pendingOnboardingRequests from GET /api/onboard-requests filtered to
// status:'pending', super_admin only) exactly like the governance/dashboard
// badges issue #293 already fixed the same way.
//
// tabBadge() is a pure function (no JSX, no hooks) exported from
// components/farm/navigation.tsx, so — unlike this repo's usual "no
// component-level test harness" React screens (see
// tests/crops-batch-detail-ui.test.ts's header) — it can be imported and
// exercised directly with plain argument-driven assertions.
import { describe, it, expect } from 'vitest'
import { tabBadge } from '@/components/farm/navigation'

describe('tabBadge() (issue #298)', () => {
  it('shows no badge for "tasks" when openTasksCount is 0 (not the old hardcoded 2)', () => {
    expect(tabBadge('tasks', 0, 0, 0, 0)).toBeNull()
  })

  it('shows the real openTasksCount for "tasks" when > 0', () => {
    expect(tabBadge('tasks', 0, 0, 5, 0)).toBe(5)
  })

  it('shows no badge for "admin-onboarding" when pendingOnboardingRequests is 0 (not the old hardcoded 2)', () => {
    expect(tabBadge('admin-onboarding', 0, 0, 0, 0)).toBeNull()
  })

  it('shows the real pendingOnboardingRequests for "admin-onboarding" when > 0', () => {
    expect(tabBadge('admin-onboarding', 0, 0, 0, 3)).toBe(3)
  })

  // Regression guards for issue #293's fixes — unaffected by this change.
  it('still shows pendingApprovals for "governance" when > 0, and nothing at 0', () => {
    expect(tabBadge('governance', 0, 0, 0, 0)).toBeNull()
    expect(tabBadge('governance', 4, 0, 0, 0)).toBe(4)
  })

  it('still shows unreadNotifs for "dashboard" when > 0, and nothing at 0', () => {
    expect(tabBadge('dashboard', 0, 0, 0, 0)).toBeNull()
    expect(tabBadge('dashboard', 0, 7, 0, 0)).toBe(7)
  })

  it('returns null for a tab with no badge concept', () => {
    expect(tabBadge('crops', 9, 9, 9, 9)).toBeNull()
  })
})
