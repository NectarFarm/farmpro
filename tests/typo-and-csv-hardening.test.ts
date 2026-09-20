// ── Dropdowns, CSV integrity, and the settings that lied ────────────────────
// Three unrelated-looking problems with one cause: a value the app accepted
// without checking whether it could actually mean anything.
//
// UI wiring is asserted against source text because this repo has no component
// render harness — see tests/crops-batch-detail-ui.test.ts's header. Every
// assertion below anchors to rendered JSX or a code expression rather than to
// prose, so the explanatory comments in those files cannot satisfy them by
// accident.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toCsv, csvField } from '@/lib/csv'
import {
  OTHER_OPTION, MORTALITY_CAUSES, HEALTH_TREATMENTS, DOSE_UNITS, formatDose,
} from '@/lib/record-vocabulary'
import { isValidTimezone } from '@/lib/datetime'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('lib/csv.ts — an export that survives a comma', () => {
  it('quotes every field, so a comma in a name cannot shift the columns', () => {
    // The real failure: item and GL-account names are free text. "Maize,
    // cracked" shifted every following column, so the exported quantity and
    // cost columns silently misaligned and a corrupt financial artifact left
    // the building looking fine.
    const csv = toCsv(['name', 'qty'], [['Maize, cracked', 40]])
    expect(csv).toBe('"name","qty"\r\n"Maize, cracked","40"')
  })

  it('doubles an embedded quote rather than breaking the field', () => {
    expect(csvField('6" auger')).toBe('"6"" auger"')
  })

  it('renders null and undefined as empty, not as the words', () => {
    // `String(null)` would have written the literal text "null" into a
    // financial export.
    expect(csvField(null)).toBe('""')
    expect(csvField(undefined)).toBe('""')
  })

  it('keeps a newline inside a quoted field instead of ending the row', () => {
    expect(toCsv(['a'], [['line1\nline2']])).toBe('"a"\r\n"line1\nline2"')
  })
})

describe('lib/record-vocabulary.ts — curated lists with a real escape hatch', () => {
  it('offers an "Other" option, so a farm can always record what happened', () => {
    // Without this the dropdown is a downgrade: a worker who cannot record the
    // real cause records something false, or records nothing.
    expect(OTHER_OPTION).toBe('Other')
    expect(MORTALITY_CAUSES).not.toContain(OTHER_OPTION)
    expect(HEALTH_TREATMENTS).not.toContain(OTHER_OPTION)
  })

  it('has no duplicate or blank entries in any list', () => {
    for (const list of [MORTALITY_CAUSES, HEALTH_TREATMENTS, DOSE_UNITS]) {
      expect(new Set(list).size).toBe(list.length)
      for (const v of list) expect(v.trim()).toBe(v as string)
      expect(list.every((v) => v.length > 0)).toBe(true)
    }
  })

  it('joins a dose back into the single string the payload has always carried', () => {
    expect(formatDose('1', 'ml', 'each bird')).toBe('1ml each bird')
    expect(formatDose('2.5', 'ml/litre', '')).toBe('2.5ml/litre')
  })

  it('leaves an empty dose empty rather than storing a bare unit', () => {
    // "ml" on its own is not a dose, and would read as one in a report.
    expect(formatDose('', 'ml', 'each')).toBe('')
    expect(formatDose('   ', 'ml', '')).toBe('')
  })
})

describe('components/farm/worker.tsx — free text replaced by pick-or-type', () => {
  const source = read('components/farm/worker.tsx')

  it('no longer renders the free-text cause and treatment inputs', () => {
    // Anchored to a bare `<input …>` rather than to the placeholder text
    // alone: the same strings are now legitimately passed to PickOrType as its
    // `placeholder` prop, so matching the text on its own would fail against
    // the fix itself.
    expect(source).not.toMatch(/<input className="farm-input" placeholder="Cause, if known"/)
    expect(source).not.toMatch(/<input className="farm-input" placeholder="What was given"/)
    expect(source).not.toMatch(/placeholder="e\.g\. Newcastle vaccine, antibiotics"/)
    expect(source).not.toMatch(/placeholder="e\.g\. 1ml each"/)
    // And the two fields really do go through the shared control now.
    expect(source).toMatch(/<PickOrType\s+options=\{MORTALITY_CAUSES\}/)
  })

  it('sources both lists from the shared vocabulary, not a fourth inline copy', () => {
    expect(source).toMatch(/options=\{MORTALITY_CAUSES\}/)
    expect(source).toMatch(/options=\{HEALTH_TREATMENTS\}/)
    // The inline array this screen used to carry.
    expect(source).not.toMatch(/\['Sudden death','Disease','Injury'/)
  })

  it('splits the dose into an amount and a unit', () => {
    expect(source).toMatch(/dose: formatDose\(doseAmount, doseUnit, dosePer\)/)
    expect(source).toMatch(/DOSE_UNITS\.map/)
  })

  it('keeps an Other escape on the mortality cause grid', () => {
    expect(source).toMatch(/setCauseIsOther\(true\); setCause\(''\)/)
    expect(source).toMatch(/placeholder="Describe the cause"/)
  })
})

describe('components/farm/vet.tsx — one vocabulary, not two', () => {
  const source = read('components/farm/vet.tsx')

  it('takes its causes from the shared list', () => {
    // A vet and a worker reporting the same death produced different strings,
    // so the mortality report counted them separately.
    expect(source).toMatch(/const CAUSES = MORTALITY_CAUSES/)
    expect(source).not.toMatch(/const CAUSES = \['Sudden death'/)
  })
})

describe('components/farm/finance.tsx — a sale that can actually move stock', () => {
  const source = read('components/farm/finance.tsx')

  it('sends productId and qty, which is what makes the route decrement stock', () => {
    // This sheet is the only writer to POST /api/data/sales, and that route
    // only touches batch headcount or collected produce when it can resolve a
    // product with a stockEffect. Sending just a free-text `item` meant every
    // sale recorded here left stock untouched forever.
    expect(source).toMatch(/productId: productId \|\| undefined/)
    expect(source).toMatch(/qty: qtyNum \?\? undefined/)
  })

  it('no longer offers only a free-text item box', () => {
    expect(source).toMatch(/\/api\/products/)
    expect(source).toMatch(/>What was sold \*</)
  })

  it('requires a count when the product comes out of the batch', () => {
    expect(source).toMatch(/stockEffect === 'batch_quantity'/)
  })

  it('caps the sale date at today', () => {
    expect(source).toMatch(/max=\{todayIso\}/)
  })

  it('offers payment methods as a list rather than free text', () => {
    // A hard <select> was the original ask, but a closed dropdown for
    // payment method has the same failure mode a hard dropdown for supplier
    // would: a farmer's genuinely new payment method (a new bank, a new
    // agent till) becomes unrecordable rather than mistyped. The datalist
    // pattern already used for supplier/category/unit is used here too —
    // known values suggested from this tenant's own real sales/purchases,
    // typing a new one still works. Anchored to the actual mechanism (the
    // <input list=...> + <datalist> pair and the real-data source), not to
    // string literals that would also match this file's own comments.
    expect(source).toMatch(/list="finance-payment-methods"/)
    expect(source).toMatch(/<datalist id="finance-payment-methods">/)
    expect(source).toMatch(/paymentMethodNames/)
    expect(source).not.toMatch(/placeholder="e\.g\. Mpesa"/)
  })

  it('quotes its CSV export', () => {
    expect(source).toMatch(/toCsv\(headers, rows\)/)
    expect(source).not.toMatch(/r\.join\(','\)\)\.join\('\\n'\)/)
  })
})

describe('components/farm/inventory.tsx — an import that reports what it refused', () => {
  const source = read('components/farm/inventory.tsx')

  it('no longer turns an unreadable cost into a cost of zero', () => {
    // parseMoneyToCents returns null rather than a wrong number for "KSh
    // 1200" / "1e5" / "12.34.56". That refusal used to become `0`, so a whole
    // CSV could import at zero valuation with no error shown.
    expect(source).not.toMatch(/costPerUnitCents !== null && costPerUnitCents > 0 \? costPerUnitCents : 0/)
    expect(source).toMatch(/skipped\.push/)
  })

  it('tells the user how many rows landed and which did not', () => {
    expect(source).toMatch(/Imported \$\{imported\} of \$\{rows\.length\}/)
  })

  it('quotes its CSV export', () => {
    expect(source).toMatch(/toCsv\(headers, rows\)/)
  })

  it('refuses a fractional quantity instead of truncating it', () => {
    expect(source).toMatch(/!Number\.isInteger\(qty\)/)
    expect(source).not.toMatch(/quantity: Math\.trunc\(qty\)/)
  })
})

describe('app/api/purchases — the server is the authority', () => {
  const source = read('app/api/purchases/route.ts')

  it('computes the total instead of accepting one from the caller', () => {
    // A curl-reachable totalCostCents was debited verbatim to Purchases
    // Expense, so the GL and the stock ledger could disagree permanently.
    expect(source).toMatch(/const totalCostCents = quantity \* unitCostCents/)
    expect(source).not.toMatch(/b\.totalCostCents/)
  })

  it('refuses an over-payment rather than letting the row and the journal differ', () => {
    expect(source).toMatch(/Amount paid is more than the purchase total/)
  })

  it('validates through the shared helpers rather than Math.max/Math.trunc', () => {
    expect(source).toMatch(/requireCount\(b\.quantity, 'quantity'\)/)
    expect(source).toMatch(/requireEventDate\(b\.receivedDate, 'receivedDate'\)/)
    expect(source).not.toMatch(/Math\.max\(0, Math\.trunc\(Number\(b\./)
  })
})

describe('app/api/inventory/lots/[id] — the stock-wipe guard', () => {
  const source = read('app/api/inventory/lots/[id]/route.ts')

  it('no longer accepts anything Number() can coerce to zero', () => {
    expect(source).not.toMatch(/!Number\.isFinite\(Number\(b\.qtyOnHand\)\)/)
    expect(source).not.toMatch(/Math\.max\(0, Math\.trunc\(Number\(b\.qtyOnHand\)\)\)/)
    expect(source).toMatch(/requireNonNegativeCount\(b\.qtyOnHand, 'qtyOnHand'\)/)
  })
})

describe('lib/datetime.ts — the timezone option that could never be saved', () => {
  it('accepts UTC, which the Settings screen has always offered', () => {
    // Intl.supportedValuesOf('timeZone') deliberately omits UTC and the Etc/*
    // aliases, so the old membership-only check rejected a menu option that
    // was unreachable by construction.
    expect(isValidTimezone('UTC')).toBe(true)
    expect(isValidTimezone('Etc/UTC')).toBe(true)
  })

  it('still accepts ordinary zones', () => {
    expect(isValidTimezone('Africa/Nairobi')).toBe(true)
    expect(isValidTimezone('Europe/London')).toBe(true)
  })

  it('still refuses a zone that is not real', () => {
    expect(isValidTimezone('Not/AZone')).toBe(false)
    expect(isValidTimezone('nonsense')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
  })

  it('accepts every value the Settings picker offers', () => {
    // The guarantee the picker's own comment claims. It was false for UTC.
    const settings = read('components/farm/settings.tsx')
    const block = settings.slice(
      settings.indexOf('const TIMEZONE_OPTIONS'),
      settings.indexOf('const DATE_FORMAT_OPTIONS')
    )
    const values = [...block.matchAll(/value: '([^']+)'/g)].map((m) => m[1])
    expect(values.length).toBeGreaterThan(5)
    for (const tz of values) expect(isValidTimezone(tz)).toBe(true)
  })
})

describe('components/farm/settings.tsx — controls that tell the truth', () => {
  const source = read('components/farm/settings.tsx')

  it('reports a refused theme or font change instead of console.error', () => {
    // PATCH /api/settings is owner-only and a MANAGER has this screen, so the
    // change applied, said nothing, and reverted on the next refresh.
    expect(source).not.toMatch(/console\.error\('Failed to persist theme:'/)
    expect(source).not.toMatch(/console\.error\('Failed to persist font size:'/)
    expect(source).toMatch(/if \(!r\.ok\) showToast\(r\.error, 'error'\)/)
  })

  it('rolls the visual change back when the write is refused', () => {
    expect(source).toMatch(/setThemeState\(previous\)/)
    expect(source).toMatch(/setFontSizeState\(previous\)/)
  })

  it('marks Sound Alerts coming soon, because nothing plays audio', () => {
    // It persisted sound_alerts_enabled and nothing read it — the same
    // situation as Push Notifications, but presented as working.
    const soundRow = source.slice(source.indexOf("label: 'Sound Alerts'"))
      .slice(0, 400)
    expect(soundRow).toMatch(/comingSoon: true/)
  })

  it('stops claiming currency and weight unit apply everywhere', () => {
    // Only report exports read them; in-app amounts use formatMoney's
    // hardcoded default and the worker screens label kg directly.
    expect(source).not.toMatch(/desc: 'Used wherever an amount is displayed'/)
    expect(source).not.toMatch(/desc: 'Used wherever a weight is displayed'/)
  })

  it('renders owner-only settings read-only for everyone else', () => {
    expect(source).toMatch(/const ownerOnlyNote = role === 'owner' \|\| role === 'super_admin'/)
    expect(source).toMatch(/disabled=\{!!item\.readOnly\}/)
  })

  it('the account card opens Security & access, not the whole People roster (owner-roast finding #4)', () => {
    const cardStart = source.indexOf('farm-card farm-card-active" style={{ padding: 14, marginBottom: 16, display: \'flex\', gap: 12')
    expect(cardStart).toBeGreaterThan(-1)
    const card = source.slice(Math.max(0, cardStart - 120), cardStart + 40)
    expect(card).toMatch(/navigate\('security-settings'\)/)
    expect(card).not.toMatch(/navigate\('people'\)/)
  })
})

describe('per-field validation (owner-roast findings #9/#10/#11) shares one mechanism', () => {
  const shared = read('components/farm/ui-shared.tsx')
  const crops = read('components/farm/crops.tsx')
  const finance = read('components/farm/finance.tsx')
  const inventory = read('components/farm/inventory.tsx')

  it('ui-shared.tsx exports the one fieldErrorStyle/FieldError mechanism', () => {
    expect(shared).toMatch(/export function fieldErrorStyle\(hasError: boolean\)/)
    expect(shared).toMatch(/export function FieldError\(/)
  })

  it('finding #9: Add house/field blames only the empty fields, not a filled-in farm', () => {
    expect(crops).not.toMatch(/Farm, type, and name are required/)
    expect(crops).toMatch(/if \(!farmId\) errs\.farmId = 'Select a farm'/)
    expect(crops).toMatch(/if \(!type\.trim\(\)\) errs\.type = 'Unit type is required'/)
    expect(crops).toMatch(/if \(!name\.trim\(\)\) errs\.name = 'Name is required'/)
    expect(crops).toMatch(/fieldErrorStyle\(!!fieldErrors\.farmId\)/)
  })

  it('finding #10: purchase forms (Finance and Inventory) default a single farm and check every field together', () => {
    for (const src of [finance, inventory]) {
      expect(src).toMatch(/farms\.length === 1 \? farms\[0\]\.id : ''/)
      expect(src).toMatch(/if \(!farmId\) errs\.farmId = 'Select which farm this stock is for'/)
      expect(src).toMatch(/if \(!supplier\.trim\(\)\) errs\.supplier = 'Supplier is required'/)
      expect(src).toMatch(/if \(!itemName\.trim\(\)\) errs\.itemName = 'Item is required'/)
      expect(src).toMatch(/if \(!unit\.trim\(\)\) errs\.unit = 'Unit is required'/)
      expect(src).not.toMatch(/Supplier, item, and unit are required/)
    }
  })

  it('finding #11: a sale of 0 is rejected explicitly and marked on the Amount field', () => {
    expect(finance).toMatch(/errs\.amount = 'Amount must be a positive number — 0 is not a sale'/)
    expect(finance).toMatch(/fieldErrorStyle\(!!fieldErrors\.amount\)/)
    expect(finance).toMatch(/type="number" min="0\.01" step="0\.01" placeholder="0" value=\{amount\}/)
  })
})

describe('nav badge vs screen notification counts agree (owner-roast finding #5)', () => {
  const nav = read('components/farm/navigation.tsx')
  const dashboard = read('components/farm/dashboard.tsx')

  it('NavProvider exposes a refreshBadges that re-runs the badge-count effect', () => {
    expect(nav).toMatch(/refreshBadges: \(\) => void/)
    expect(nav).toMatch(/const refreshBadges = useCallback\(\(\) => \{ setBadgesNonce\(\(n\) => n \+ 1\); \}, \[\]\)/)
    expect(nav).toMatch(/\}, \[tenantId, activeFarmId, role, badgesNonce\]\)/)
    expect(nav).toMatch(/refreshBadges,\s*userName \}\}>/)
  })

  it('marking a notification read (one or all) calls refreshBadges so the nav badge cannot go stale', () => {
    const screen = dashboard.slice(dashboard.indexOf('export function NotificationsScreen'))
    const markReadBlock = screen.slice(screen.indexOf('const markRead'), screen.indexOf('function markAllRead'))
    expect(markReadBlock).toMatch(/refreshBadges\(\);/)
    const markAllBlock = screen.slice(screen.indexOf('function markAllRead'), screen.indexOf('function handleNotifTap'))
    expect(markAllBlock).toMatch(/refreshBadges\(\);/)
  })
})

describe('components/farm/finance.tsx — nothing recorded is not the same as losing money (owner-roast finding #3)', () => {
  const source = read('components/farm/finance.tsx')

  it('treats a period with zero sales/purchases/payroll as genuinely empty, not a zeroed Net tile', () => {
    // transactionCount is the real row count behind the period (lib/reports.ts's
    // computePlReport), not a re-derivation of revenue/expense being zero.
    expect(source).toMatch(/const periodTransactionCount = Number\(budgetReport\?\.meta\.transactionCount \?\? 0\)/)
    expect(source).toMatch(/const hasFinanceActivity = budgetReport !== null && periodTransactionCount > 0/)
    expect(source).toMatch(/Nothing recorded for \{periodLabel\} yet/)
  })

  it('explains a real negative net instead of leaving a bare red number', () => {
    expect(source).toMatch(/\{margin < 0 && \(/)
    expect(source).toMatch(/You spent more than you took in for \{periodLabel\}/)
  })
})
