// ── Phone validation: four spellings, one stored number ─────────────────────
// isValidPhone/toStoredPhone (lib/validation.ts) must accept every shape a
// Kenyan applicant might type — "+254…", bare "254…", "07…", "01…", with or
// without separators — and fold all of them to the exact same "+254…"
// string. users.phone carries a unique index and worker PIN sign-in resolves
// its login candidate by that normalized value (app/api/auth/login/route.ts),
// so any of these four forms disagreeing on the stored result would silently
// split one person's number into two different accounts.
import { describe, it, expect } from 'vitest'
import { isValidPhone, normalizePhone, toStoredPhone } from '@/lib/validation'

const CANONICAL = '+254712345678'

describe('lib/validation phone forms', () => {
  it('accepts all four Kenyan forms and normalizes each to the same stored number', () => {
    const forms = [
      '+254712345678', // E.164
      '254712345678',  // bare 254, no leading "+"
      '0712345678',    // local, 07
    ]
    for (const raw of forms) {
      const normalized = normalizePhone(raw)
      expect(isValidPhone(normalized)).toBe(true)
      expect(toStoredPhone(normalized)).toBe(CANONICAL)
    }
  })

  it('accepts the 01… local form and normalizes it the same way as its 254 equivalent', () => {
    const local01 = normalizePhone('0112345678')
    const bare01 = normalizePhone('254112345678')
    const e16401 = normalizePhone('+254112345678')
    expect(isValidPhone(local01)).toBe(true)
    expect(isValidPhone(bare01)).toBe(true)
    expect(isValidPhone(e16401)).toBe(true)
    const stored = toStoredPhone(local01)
    expect(toStoredPhone(bare01)).toBe(stored)
    expect(toStoredPhone(e16401)).toBe(stored)
    expect(stored).toBe('+254112345678')
  })

  it('strips spaces, hyphens, dots and parentheses before validating', () => {
    const messy = [
      '+254 712 345 678',
      '254-712-345-678',
      '0712 345 678',
      '(0712) 345-678',
      '0712.345.678',
    ]
    for (const raw of messy) {
      const normalized = normalizePhone(raw)
      expect(isValidPhone(normalized)).toBe(true)
      expect(toStoredPhone(normalized)).toBe(CANONICAL)
    }
  })

  it('still rejects garbage and non-Kenyan-shaped local numbers', () => {
    expect(isValidPhone(normalizePhone('12345'))).toBe(false)
    expect(isValidPhone(normalizePhone('0212345678'))).toBe(false) // 02… is not a valid local prefix
    expect(isValidPhone(normalizePhone('254212345678'))).toBe(false) // same, bare-254 form
    expect(isValidPhone(normalizePhone('not-a-phone'))).toBe(false)
    expect(isValidPhone(normalizePhone(''))).toBe(false)
  })

  it('leaves a genuine international E.164 number alone (not Kenyan-folded)', () => {
    const intl = normalizePhone('+15551234567')
    expect(isValidPhone(intl)).toBe(true)
    expect(toStoredPhone(intl)).toBe('+15551234567')
  })
})
