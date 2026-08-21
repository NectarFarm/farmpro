// ── PIN pepper empty-string fallback (issue #272) ───────────────────────────
// Proves lib/auth.ts's pinPrefilter treats an empty-string AUTH_PIN_PEPPER —
// what Next.js loads from a `.env` copied verbatim from `.env.example`'s
// (now-commented-out) `AUTH_PIN_PEPPER=` line — the same as an unset one,
// and that the resulting hash matches db/seed.mjs's independently-duplicated
// fallback formula. Before the fix (`??` instead of `||`), an empty string
// is neither null nor undefined, so `??` never fell back: the login route
// peppered with `""` while `db/seed.mjs` (a plain `node` script, no `.env`
// auto-loading) peppered with `"ifms-dev-pepper"` — the two hashes never
// matched, so PIN login always 401'd for anyone who copied .env.example to
// .env verbatim. This test fails on the pre-fix `??` logic and passes on the
// `||` fix in both lib/auth.ts and db/seed.mjs.
//
// No DB needed — pinPrefilter is a pure function of (pin, env var).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }))

import { pinPrefilter } from '@/lib/auth'

// Mirrors db/seed.mjs's `pinPrefilter` one-liner exactly (that file is a
// plain node script with real DB side effects on import/run, so it isn't
// imported directly here) — see db/seed.mjs's own "Keep in sync with
// lib/auth.ts pinPrefilter" comment. If that formula ever drifts from this
// literal, this test should be updated to match.
const seedPinPrefilter = (pin: string): string =>
  createHmac('sha256', process.env.AUTH_PIN_PEPPER || 'ifms-dev-pepper').update(pin).digest('hex')

const devFallbackHash = (pin: string): string => createHmac('sha256', 'ifms-dev-pepper').update(pin).digest('hex')

describe('pinPrefilter dev-pepper fallback (issue #272)', () => {
  const ORIGINAL = process.env.AUTH_PIN_PEPPER

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.AUTH_PIN_PEPPER
    else process.env.AUTH_PIN_PEPPER = ORIGINAL
  })

  it('falls back to the dev pepper when AUTH_PIN_PEPPER is unset', () => {
    delete process.env.AUTH_PIN_PEPPER
    expect(pinPrefilter('1234')).toBe(devFallbackHash('1234'))
  })

  it('ALSO falls back to the dev pepper when AUTH_PIN_PEPPER is an empty string (the .env.example repro)', () => {
    process.env.AUTH_PIN_PEPPER = ''
    expect(pinPrefilter('1234')).toBe(devFallbackHash('1234'))
  })

  it("matches db/seed.mjs's independently-duplicated formula in both the unset and empty-string cases", () => {
    delete process.env.AUTH_PIN_PEPPER
    expect(pinPrefilter('5678')).toBe(seedPinPrefilter('5678'))

    process.env.AUTH_PIN_PEPPER = ''
    expect(pinPrefilter('5678')).toBe(seedPinPrefilter('5678'))
  })

  it('still honors a real pepper when one is actually set (fallback does not shadow a real value)', () => {
    process.env.AUTH_PIN_PEPPER = 'a-real-secret'
    const withRealPepper = pinPrefilter('1234')
    expect(withRealPepper).not.toBe(devFallbackHash('1234'))
    expect(withRealPepper).toBe(createHmac('sha256', 'a-real-secret').update('1234').digest('hex'))
  })
})
