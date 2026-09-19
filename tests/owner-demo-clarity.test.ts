// Owner walkthrough: names match the nav, empty screens say the next step,
// dead doors stay shut, and poultry-only copy does not leak onto mixed farms.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ONBOARDING_GUIDE_STEPS } from '@/lib/onboarding-guide'
import { NAV } from '@/components/farm/navigation'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const crops = read('components/farm/crops.tsx')
const people = read('components/farm/people.tsx')
const inventory = read('components/farm/inventory.tsx')
const reports = read('components/farm/reports.tsx')
const navigation = read('components/farm/navigation.tsx')
const email = read('lib/email.ts')
const guide = read('lib/onboarding-guide.ts')

describe('one vocabulary on the walkthrough', () => {
  it('the setup guide names Houses & fields, not production units', () => {
    const units = ONBOARDING_GUIDE_STEPS.find((s) => s.id === 'units')
    expect(units?.title).toBe('Add your houses and fields')
    expect(units?.screen).toBe('Farm → Houses & fields')
    expect(NAV.houses).toBe('Houses & fields')
    expect(guide).not.toMatch(/Add your production units/)
  })

  it('Farm tab is a place, not a leaf', () => {
    expect(navigation).toMatch(/id: 'crops' as ScreenId, label: NAV.farm, icon: Building2/)
    expect(navigation).toMatch(/desc: 'Animals you track together/)
  })
})

describe('empty states name the next action', () => {
  it('livestock empty is a batch, not a flock', () => {
    expect(crops).toMatch(/No livestock yet/)
    expect(crops).toMatch(/Start a livestock batch/)
    expect(crops).not.toMatch(/No flocks yet/)
    expect(crops).not.toMatch(/Add a flock/)
  })

  it('houses empty sends you to add a house or field', () => {
    expect(crops).toMatch(/No houses or fields yet/)
    expect(crops).toMatch(/Add a house or field/)
  })

  it('adding a person with no batches still lets you add them', () => {
    expect(people).toMatch(/No batches yet. You can still add this person/)
    expect(people).toMatch(/give a worker a phone and PIN on their page/)
    expect(people).toMatch(/navigate\('crops', \{ tab: 'livestock' \}\)/)
  })

  it('stock empty records a purchase instead of an empty table', () => {
    expect(inventory).toMatch(/Nothing in stock yet/)
    expect(inventory).toMatch(/Record a purchase/)
  })
})

describe('dead doors stay shut', () => {
  it('TopNav has no search button that does nothing', () => {
    expect(navigation).not.toMatch(/showSearch/)
    expect(inventory).not.toMatch(/showSearch/)
  })

  it('Feed Mix is not a tab — there is no backend', () => {
    expect(inventory).not.toMatch(/\['feedmix', 'Feed Mix'\]/)
    expect(inventory).not.toMatch(/tab === 'feedmix'/)
  })

  it('labour report is marked Not yet on the card', () => {
    expect(reports).toMatch(/Not yet/)
    expect(reports).toMatch(/Hours per batch — not recorded yet/)
  })

  it('product archive uses the in-app confirm, not window.confirm', () => {
    expect(crops).toMatch(/await confirm\(\{/)
    expect(crops).not.toMatch(/if \(confirm\(`Archive/)
  })
})

describe('mail is a letter, not a receipt', () => {
  it('uses a table letter and a farm-record footer', () => {
    expect(email).toMatch(/role="presentation"/)
    expect(email).toMatch(/is the farm record/)
    expect(email).toMatch(/tone: 'ok'/)
    expect(email).toMatch(/tone: 'need'/)
    expect(email).toMatch(/tone: 'no'/)
  })
})
