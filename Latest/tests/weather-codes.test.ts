import { describe, it, expect } from 'vitest'
import { describeWeatherCode } from '@/lib/weather-codes'

// ── Pure behaviour, not text-grepping (see repo convention) ─────────────────
describe('describeWeatherCode', () => {
  it('flags rain/drizzle/thunderstorm codes as rainy', () => {
    for (const code of [51, 55, 61, 63, 65, 80, 82, 95, 99]) {
      expect(describeWeatherCode(code).rainy).toBe(true)
    }
  })

  it('does not flag clear, cloudy, fog or snow codes as rainy', () => {
    for (const code of [0, 1, 2, 3, 45, 48, 71, 75, 85]) {
      expect(describeWeatherCode(code).rainy).toBe(false)
    }
  })

  it('falls back to a safe default for an unrecognised code', () => {
    const info = describeWeatherCode(-1)
    expect(info.rainy).toBe(false)
    expect(info.label).toBeTruthy()
    expect(info.icon).toBeTruthy()
  })

  it('gives every code a non-empty label and a valid icon key', () => {
    const validIcons = new Set(['sun', 'cloud-sun', 'cloud', 'fog', 'rain', 'snow', 'storm'])
    for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]) {
      const info = describeWeatherCode(code)
      expect(info.label.length).toBeGreaterThan(0)
      expect(validIcons.has(info.icon)).toBe(true)
    }
  })
})
