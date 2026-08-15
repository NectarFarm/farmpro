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

  it('applies the tenant accentColor to the primary KPI grid\'s lead tile', () => {
    expect(source).toMatch(/color: settings\?\.accentColor \?\? "var\(--primary-green\)"/)
  })
})
