// ── Platform staff capability resolution (pure-function unit tests) ────────
// No database needed — lib/platform-staff.ts's `effectiveCapabilities` /
// `isFullCapabilityAdmin` / `hasAllCapabilities` are pure. The load-bearing
// case is the first one: a super_admin with no platform_staff row must
// resolve to every capability, unchanged from today's behaviour.
import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { CAPABILITIES, effectiveCapabilities, hasAllCapabilities, isFullCapabilityAdmin } from '@/lib/platform-staff'

describe('effectiveCapabilities', () => {
  it('no-row super_admin resolves to ALL capabilities (backward compatibility)', () => {
    const caps = effectiveCapabilities('super_admin', null)
    expect(caps.sort()).toEqual([...CAPABILITIES].sort())
  })

  it('a tenant-scoped role never has platform capabilities, row or not', () => {
    expect(effectiveCapabilities('owner', null)).toEqual([])
    expect(effectiveCapabilities('manager', { hasRow: true, active: true, capabilities: [...CAPABILITIES] })).toEqual([])
  })

  it('an active row with a subset of capabilities resolves to exactly that subset', () => {
    const caps = effectiveCapabilities('super_admin', {
      hasRow: true,
      active: true,
      capabilities: ['support.handle', 'support.assign'],
    })
    expect(caps.sort()).toEqual(['support.assign', 'support.handle'])
  })

  it('an inactive row resolves to NO capabilities, even if it lists some', () => {
    const caps = effectiveCapabilities('super_admin', {
      hasRow: true,
      active: false,
      capabilities: [...CAPABILITIES],
    })
    expect(caps).toEqual([])
  })

  it('unrecognized strings in the capabilities array are dropped, not passed through', () => {
    const caps = effectiveCapabilities('super_admin', {
      hasRow: true,
      active: true,
      capabilities: ['support.handle', 'not-a-real-capability'],
    })
    expect(caps).toEqual(['support.handle'])
  })
})

describe('hasAllCapabilities / isFullCapabilityAdmin', () => {
  it('recognizes the full set regardless of order', () => {
    expect(hasAllCapabilities([...CAPABILITIES].reverse())).toBe(true)
  })

  it('rejects a set missing even one capability', () => {
    expect(hasAllCapabilities(CAPABILITIES.filter((c) => c !== 'staff.manage'))).toBe(false)
  })

  it('a no-row super_admin counts as a full-capability admin', () => {
    expect(isFullCapabilityAdmin('super_admin', null)).toBe(true)
  })

  it('an active row with every capability counts as full-capability', () => {
    expect(isFullCapabilityAdmin('super_admin', { hasRow: true, active: true, capabilities: [...CAPABILITIES] })).toBe(true)
  })

  it('an active row missing a capability does NOT count as full-capability', () => {
    expect(
      isFullCapabilityAdmin('super_admin', {
        hasRow: true,
        active: true,
        capabilities: CAPABILITIES.filter((c) => c !== 'billing.manage'),
      })
    ).toBe(false)
  })

  it('a deactivated row never counts as full-capability, even listing everything', () => {
    expect(isFullCapabilityAdmin('super_admin', { hasRow: true, active: false, capabilities: [...CAPABILITIES] })).toBe(false)
  })
})
