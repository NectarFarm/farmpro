// ── Dashboard greeting/accent-color wiring (issue #310) ─────────────────────
// tenant_settings.dashboardGreeting/accentColor (issue #255/#256) persisted
// correctly but were only ever read back inside ui-customise.tsx itself.
// This repo has no component render harness (see
// tests/crops-batch-detail-ui.test.ts's header for why UI wiring is tested
// against source here rather than through jsdom/RTL); these guards assert
// the Dashboard screen actually fetches GET /api/settings and applies the
// real dashboardGreeting/accentColor, replacing the old hardcoded values.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'components/farm/dashboard.tsx'), 'utf8')

describe('components/farm/dashboard.tsx — tenant branding applied (issue #310)', () => {
  it('fetches GET /api/settings for the tenant', () => {
    expect(source).toMatch(/apiClient\.get<Partial<DashboardSettings>>\(`\/api\/settings\?tenantId=\$\{tenantId\}`\)/)
  })

  it('no longer hardcodes the greeting line as static "Good morning," text', () => {
    // The literal used to sit directly inside the JSX; it must now only
    // appear as the fallback value, not the rendered content itself.
    expect(source).not.toMatch(/>Good morning,<\/div>/)
    expect(source).toMatch(/\{settings\?\.dashboardGreeting \?\? "Good morning,"\}/)
  })

  it('renders the tenant logoEmoji next to the greeting name, falling back to the original 🌾', () => {
    expect(source).toMatch(/\{settings\?\.logoEmoji \?\? "🌾"\}/)
  })

  it('derives the accent from tenant settings with the app green as fallback', () => {
    // Was pinned to the exact inline expression on one KPI tile. The dashboard
    // rebuild resolves it once into an `accent` const reused by the hero
    // metric, the trend chart and the section links — so assert the invariant
    // (settings-derived, green fallback) rather than where it happens to be
    // spelled, which is what made this test fail on a pure refactor.
    expect(source).toMatch(/const accent = settings\?\.accentColor \?\? "var\(--primary-green\)"/)
  })

  it('feeds that accent to the headline figure and the revenue trend chart', () => {
    // The two places a tenant would actually notice their brand colour.
    expect(source).toMatch(/<HeroMetric[\s\S]{0,400}?accent=\{accent\}/)
    expect(source).toMatch(/<RevenueTrendChart[^>]*color=\{accent\}/)
  })
})
