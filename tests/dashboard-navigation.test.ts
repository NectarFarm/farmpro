// ── Dashboard: everything reachable, nothing crowded ───────────────────────
// This repo has no component render harness (see
// tests/crops-batch-detail-ui.test.ts's header for why UI wiring is asserted
// against source), so these guard the decisions the dashboard rebuild made
// rather than pixels. The rebuild was verified visually by server-rendering
// the component and screenshotting it at 390px in both themes; what's below is
// what stops the crowding creeping back.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'components/farm/dashboard.tsx'), 'utf8')

describe('components/farm/dashboard.tsx — alerts stay icons', () => {
  it('renders the two alert counts as badge icons, not list rows', () => {
    // The brief: "those alerts can remain as an icon cause if they are many
    // that interface will look bad". Three alerts used to cost three
    // full-width cards and pushed the revenue figure below the fold.
    expect(source).toMatch(/<AlertIcon\b/)
    expect(source).toMatch(/function AlertIcon\(/)
  })

  it('no longer builds an "Attention required" list', () => {
    // Matched as a rendered TEXT NODE, not anywhere in the file — the comments
    // above the rebuild name both old sections on purpose, so a bare
    // /Attention required/ would fail on its own documentation.
    expect(source).not.toMatch(/>Attention required</)
    // The old shape: an array of {title, detail, action} rendered as rows.
    expect(source).not.toMatch(/const attention = \[/)
  })

  it('drops the "Recent activity" feed that restated the bell badge', () => {
    expect(source).not.toMatch(/>Recent activity</)
    expect(source).not.toMatch(/const recent = \(notifs/)
  })

  it('sends the action icon to whichever pile is larger', () => {
    // A fixed destination would land on an empty list half the time.
    expect(source).toMatch(/const actionScreen =/)
  })
})

describe('components/farm/dashboard.tsx — everything reachable from here', () => {
  // The mobile gap this closes: the bottom nav holds five tabs, so for an
  // owner these had no mobile route at all before the destination grid.
  const mustReach = ['inventory', 'weather', 'people', 'routines', 'reports', 'ai-chat', 'settings', 'finance']

  it.each(mustReach)('offers a destination tile for %s', (screen) => {
    expect(source).toMatch(new RegExp(`id: "${screen}"`))
  })

  it('keeps Finance and Reports owner-only, matching the sidebar and the API', () => {
    // A manager must not be offered a screen the server would refuse.
    expect(source).toMatch(/id: "finance",[^\n]*roles: \["owner"\]/)
    expect(source).toMatch(/id: "reports",[^\n]*roles: \["owner"\]/)
  })

  it('has no dead quickActions array left behind', () => {
    // It was computed on every render and passed nowhere, behind a file-header
    // comment claiming it navigated somewhere.
    expect(source).not.toMatch(/const quickActions = \[/)
  })

  it('picks a column count that leaves no orphan tile row', () => {
    expect(source).toMatch(/const tileColumns = destinations\.length % 4 === 0 \? 4 : 3/)
  })

  it('tags tiles with the sidebar tour ids so the mobile tour can find them', () => {
    // tour.tsx resolves a data-tour id to the first VISIBLE match, so on
    // mobile these steps previously had no target and were silently skipped.
    for (const t of ['nav-weather', 'nav-people', 'nav-settings']) {
      expect(source).toMatch(new RegExp(`tour: "${t}"`))
    }
    expect(source).toMatch(/data-tour=\{tour\}/)
  })
})

describe('components/farm/dashboard.tsx — honest empty and failure states', () => {
  it('surfaces a failed KPI load instead of leaving every figure as a dash', () => {
    // kpisFailed was set by the fetch and rendered nowhere, so a failed load
    // read as "your farm has no data".
    expect(source).toMatch(/kpisFailed: boolean/)
    expect(source).toMatch(/\{kpisFailed && \(/)
  })

  it('caps today\'s work and links to the full list', () => {
    expect(source).toMatch(/const todayPreview = \(tasksToday \?\? \[\]\)\.slice\(0, 3\)/)
  })

  it('hides the manager completion bar when nothing is scheduled', () => {
    // An empty bar for an empty day is a worse answer than no bar.
    expect(source).toMatch(/\{scheduled > 0 && \(/)
  })
})
