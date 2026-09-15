// ── Navigation: the sequence is visible, and it goes away when it is done ───
// This repo has no component render harness (see
// tests/crops-batch-detail-ui.test.ts's header), so UI wiring is asserted
// against source text the same way tests/dashboard-navigation.test.ts does.
// The layout itself was verified by server-rendering the components at 390px
// in both themes and looking at the screenshots; what is below is what stops
// the specific decisions from being undone by accident.
//
// Trap this file is written around: a `not.toMatch(/phrase/)` assertion will
// happily match the explanatory comments in the file it is checking, so every
// negative assertion here anchors to rendered JSX (`/>Text</`) or to code,
// never to prose.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ONBOARDING_GUIDE_STEPS } from '@/lib/onboarding-guide'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const navigation = read('components/farm/navigation.tsx')
const dashboard = read('components/farm/dashboard.tsx')
const setupProgress = read('components/farm/setup-progress.tsx')
const gettingStarted = read('components/farm/getting-started.tsx')
const crops = read('components/farm/crops.tsx')

describe('the setup sequence has one source, and one fetch', () => {
  it('reads its steps from lib/onboarding-guide.ts rather than a second list', () => {
    // The whole point of lib/onboarding-guide.ts's header. If a screen ever
    // hardcodes step titles, the email and the app drift apart.
    expect(setupProgress).toMatch(/from '@\/lib\/setup-state'/)
    expect(gettingStarted).toMatch(/ONBOARDING_GUIDE_STEPS/)
    for (const step of ONBOARDING_GUIDE_STEPS) {
      // No step's title is written out as literal JSX text anywhere in the UI.
      expect(setupProgress).not.toContain(`>${step.title}<`)
      expect(dashboard).not.toContain(`>${step.title}<`)
    }
  })

  it('fetches progress once, in NavProvider, and shares it', () => {
    expect(navigation).toMatch(/\/api\/setup-state\?tenantId=/)
    // Exactly one CALLER of the endpoint in the whole client. Anchored to an
    // apiClient call, not to the path — the path appears in explanatory
    // comments in several of these files, and a bare /setup-state/ would fail
    // on this feature's own documentation.
    for (const src of [dashboard, setupProgress, gettingStarted, crops]) {
      expect(src).not.toMatch(/apiClient\.\w+[^\n]*setup-state/)
    }
    expect(navigation).toMatch(/setupState,\s*refreshSetupState/)
  })

  it('only asks for it in the roles that can act on it', () => {
    // A worker cannot complete any of the nine steps and a super_admin has no
    // single tenant the answer would describe.
    expect(navigation).toMatch(/if \(role !== 'owner' && role !== 'manager'\) \{ setSetupState\(null\); return; \}/)
  })

  it('leaves progress null on failure instead of claiming nothing is set up', () => {
    // There is no setSetupState(0)-equivalent: the state is only ever written
    // from a successful response with a real steps array.
    expect(navigation).toMatch(/if \(res\.success && res\.data && Array\.isArray\(res\.data\.steps\)\) setSetupState\(res\.data\)/)
  })
})

describe('the setup card gets out of the way', () => {
  it('renders nothing at all once every step is done', () => {
    // Not a collapsed row, not a "100%" badge — absent. A permanent checklist
    // on a working farm is the clutter the brief rules out.
    expect(setupProgress).toMatch(/if \(!state \|\| state\.complete\) return null;/)
  })

  it('disappears from the sidebar the same way', () => {
    expect(navigation).toMatch(/setupOnly: true/)
    expect(navigation).toMatch(/const setupIncomplete = !!setupState && !setupState\.complete/)
  })

  it('shows a position, not an alert badge, on the sidebar row', () => {
    // `${completed} of ${total}` — a red count would read as things wrong.
    expect(navigation).toMatch(/\$\{setupState\.completed\} of \$\{setupState\.total\}/)
  })

  it('sits on the dashboard above the figures, and only there', () => {
    expect(dashboard).toMatch(/<SetupStrip state=\{setupState\} onNavigate=\{navigate\}/)
  })
})

describe('the tabs say what is behind them', () => {
  it('no longer labels the settings hub "More"', () => {
    // Anchored to the tab definition, not to prose: the comment above it
    // quotes the old label deliberately.
    expect(navigation).not.toMatch(/label: 'More'/)
    expect(navigation).toMatch(/id: 'settings' as ScreenId, label: 'Manage'/)
  })

  it('keeps the tab IDs, so every data-tour anchor and deep link still works', () => {
    // tour.tsx targets `nav-settings`; renaming the id (rather than the label)
    // would break the tour and every saved '#settings' hash.
    expect(navigation).toMatch(/data-tour=\{`nav-\$\{tab\.id\}`\}/)
    const tourSource = read('components/farm/tour.tsx')
    expect(tourSource).toMatch(/target: 'nav-settings'/)
  })

  it('opens a menu for a tab with several destinations and navigates for one with a single one', () => {
    expect(navigation).toMatch(/hasMenu \? setOpenMenu\(tab\.id\) : navigate\(tab\.id\)/)
    // A menu is only offered when there is more than one thing in it.
    expect(navigation).toMatch(/return items\.length > 1 \?/)
  })

  it('puts the AI advisor somewhere it can be found by name', () => {
    // The owner's report: "for the ai advisor alone I struggle finding it when
    // new". It now has both a sidebar row and a row in the Manage menu.
    expect(navigation).toMatch(/id: 'ai-chat' as ScreenId, label: 'AI advisor'/)
    expect(navigation).toMatch(/screen: 'ai-chat', label: 'AI farm advisor'/)
  })
})

describe('a deep link lands on the exact screen', () => {
  it('every guide step that names a screen carries a real destination', () => {
    for (const step of ONBOARDING_GUIDE_STEPS) {
      if (!step.goTo) continue
      expect(typeof step.goTo.screen).toBe('string')
      expect(step.goTo.screen.length).toBeGreaterThan(0)
    }
    // The three steps that live in tabs of one screen name the tab too —
    // otherwise "Add your production units" drops you on Livestock.
    const byId = new Map(ONBOARDING_GUIDE_STEPS.map((s) => [s.id, s]))
    expect(byId.get('units')?.goTo).toEqual({ screen: 'crops', params: { tab: 'units' } })
    expect(byId.get('batch')?.goTo).toEqual({ screen: 'crops', params: { tab: 'livestock' } })
    expect(byId.get('products')?.goTo).toEqual({ screen: 'crops', params: { tab: 'products' } })
  })

  it('CropsScreen actually honours the tab param, on arrival and on re-navigation', () => {
    expect(crops).toMatch(/initialCropsTab\(params\.tab\)/)
    // Re-navigating to a screen you are already on does not remount it, so the
    // initial state alone would silently ignore the second deep link.
    expect(crops).toMatch(/if \(params\.tab\) setTab\(initialCropsTab\(params\.tab\)\);/)
  })
})

describe('nothing fabricated survives on these screens', () => {
  it('the batch wizard no longer previews a code from the demo farm', () => {
    // Was `genCode(cfg.batchPrefix, <hardcoded segment>, 24)` — a fixed farm
    // segment and a fixed sequence, shown as the code this batch would get.
    // Asserted positively: the replacement's own comment quotes the old call,
    // so a negative match on it would fail on the explanation rather than on
    // the code.
    expect(crops).toMatch(/const codeSegment = selectedFarmCode/)
    expect(crops).toMatch(/const autoCode = codeSegment \? `\$\{cfg\.batchPrefix\}-\$\{codeSegment\}-###`/)
    expect(crops).toMatch(/const unitCodePreview = codeSegment \?/)
    // And the helper that could only ever produce a fabricated code is gone.
    expect(crops).not.toMatch(/^function genCode\(/m)
  })

  it('the CSV importer no longer auto-fills a demo farm segment into real records', () => {
    const csv = read('components/farm/csv-import.tsx')
    expect(csv).not.toMatch(/suggestion: `TSK-KMU-/)
    expect(csv).not.toMatch(/suggestion: `EMP-KMU-/)
  })

  it('Finance shows no budget bar, because there is no budget in the schema', () => {
    const finance = read('components/farm/finance.tsx')
    expect(finance).not.toMatch(/const budgetTotal = /)
    expect(finance).not.toMatch(/>Budget Overview/)
  })

  it('Reports opens on the current month rather than a fixed one', () => {
    const reports = read('components/farm/reports.tsx')
    expect(reports).not.toMatch(/useState\('2026-08-01'\)/)
    expect(reports).toMatch(/periodDateRange\('month'\)/)
  })

  it('Notification settings no longer pre-sets preferences nothing stores', () => {
    // The screen held five per-type toggles, five SMS toggles and a quiet-hours
    // window in local state with invented defaults, and saved none of it.
    expect(dashboard).not.toMatch(/const \[quietStart, setQuietStart\]/)
    expect(dashboard).not.toMatch(/const \[sms, setSms\]/)
  })

  it('the dead mock fixtures are gone from data.ts', () => {
    const data = read('components/farm/data.ts')
    for (const name of ['FARMS_DATA', 'EMPLOYEES_DATA', 'BATCHES_DATA', 'TASKS_DATA']) {
      expect(data).not.toMatch(new RegExp(`export const ${name}`))
    }
    // ENTERPRISE_REGISTRY stays: it is UI config (icons, labels, unit nouns,
    // code prefixes), not anybody's farm data.
    expect(data).toMatch(/export const ENTERPRISE_REGISTRY/)
  })
})
