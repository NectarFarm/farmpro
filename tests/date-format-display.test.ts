// The farm's Date format setting used to be ignored almost everywhere. These
// pin the shared formatter/parser and (by source text, this repo's convention
// for client-only logic) that the entry control and the screens use them.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { formatIsoDay, parseDateInput, fmtFarmDate, setActiveRegional, formatDate } from '@/lib/datetime'

const src = (p: string) => readFileSync(p, 'utf8')

describe('formatIsoDay', () => {
  it('reorders a stored day in each supported format, without timezone shifting', () => {
    expect(formatIsoDay('2026-08-22', 'DD/MM/YYYY')).toBe('22/08/2026')
    expect(formatIsoDay('2026-08-22', 'MM/DD/YYYY')).toBe('08/22/2026')
    expect(formatIsoDay('2026-08-22', 'YYYY-MM-DD')).toBe('2026-08-22')
    // A UTC-midnight instant is the same calendar day, even for a zone west of UTC.
    expect(formatIsoDay('2026-08-22T00:00:00.000Z', 'DD/MM/YYYY', 'America/Los_Angeles')).toBe('22/08/2026')
  })
  it('zones a real instant and tolerates empty/invalid input', () => {
    expect(formatIsoDay('2026-08-22T22:30:00Z', 'DD/MM/YYYY', 'Africa/Nairobi')).toBe('23/08/2026')
    expect(formatIsoDay(null)).toBe('—')
    expect(formatIsoDay('garbage')).toBe('—')
  })
})

describe('parseDateInput', () => {
  it('round-trips what formatIsoDay shows, in every format', () => {
    for (const f of ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const) {
      expect(parseDateInput(formatIsoDay('2026-03-07', f), f)).toBe('2026-03-07')
    }
  })
  it('accepts short day/month and other separators, rejects impossible days', () => {
    expect(parseDateInput('7/3/2026', 'DD/MM/YYYY')).toBe('2026-03-07')
    expect(parseDateInput('7-3-2026', 'DD/MM/YYYY')).toBe('2026-03-07')
    expect(parseDateInput('31/02/2026', 'DD/MM/YYYY')).toBeNull()
    expect(parseDateInput('13/01/2026', 'MM/DD/YYYY')).toBeNull()
    expect(parseDateInput('soon', 'DD/MM/YYYY')).toBeNull()
  })
})

describe('fmtFarmDate (ambient setting)', () => {
  it('follows the published farm setting', () => {
    setActiveRegional({ timezone: 'Africa/Nairobi', dateFormat: 'YYYY-MM-DD' })
    expect(fmtFarmDate('2026-08-22')).toBe('2026-08-22')
    setActiveRegional({ timezone: 'Africa/Nairobi', dateFormat: 'DD/MM/YYYY' })
    expect(fmtFarmDate('2026-08-22')).toBe('22/08/2026')
    expect(fmtFarmDate(new Date('2026-08-22T09:00:00Z'))).toBe(formatDate(new Date('2026-08-22T09:00:00Z')))
  })
})

describe('wiring (source text)', () => {
  it('no screen renders a native date input any more', () => {
    for (const f of ['finance', 'inventory', 'tasks', 'crops', 'reports', 'auditor']) {
      expect(src(`components/farm/${f}.tsx`)).not.toMatch(/type="date"/)
    }
  })
  it('DateField keeps ISO as its value and the native picker behind a button', () => {
    const s = src('components/ui-kit/date-field.tsx')
    expect(s).toContain('parseDateInput')
    expect(s).toContain('showPicker')
    expect(s).toContain('onChange(iso)')
  })
  it('the regional provider publishes the setting to module-level formatters', () => {
    expect(src('components/farm/settings.tsx')).toContain('setActiveRegional')
  })
  it('the money and stock screens format through the shared formatter', () => {
    for (const f of ['finance', 'inventory', 'crops', 'people', 'vet', 'dashboard', 'worker']) {
      expect(src(`components/farm/${f}.tsx`)).toContain('fmtFarmDate')
    }
  })
})
