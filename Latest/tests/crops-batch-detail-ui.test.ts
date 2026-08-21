// ── Batch Detail UI regression guards (issues #300, #301) ──────────────────
// This repo has no component-level test harness (vitest only, no jsdom/RTL —
// see package.json) — every other test file in tests/ exercises API route
// handlers directly, not React rendering. The FCR/Area tile fix (#301) is a
// pure rendering literal with no server-side data source to test through a
// route, so this file guards the two regressions directly reported by #301
// (and confirms #300's Economics tiles are wired) by asserting on the actual
// component source — cheap, deterministic, and fails loudly if either bug
// pattern reappears. (#300's real backend logic — revenue/gross-margin
// computation — has real route-level tests in tests/batches.test.ts.)
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'components/farm/crops.tsx'), 'utf8')

describe('components/farm/crops.tsx — BatchDetailScreen stat row (issue #301)', () => {
  it('does NOT silently replace the type-specific 3rd tile with a generic "Species" field', () => {
    expect(source).not.toMatch(/\{\s*label:\s*"Species",\s*value:\s*batch\.species/)
  })

  it('restores the type-specific Area (crop) / FCR (livestock) 3rd tile', () => {
    // Quote-agnostic: the repo lints to single quotes, so pinning the literal
    // double-quoted form made a lint fix look like a behaviour regression.
    expect(source).toMatch(/cfg\?\.type === ['"]crop['"] \? ['"]Area['"] : ['"]FCR['"]/)
  })

  it('keeps Species elsewhere on the screen rather than dropping it entirely', () => {
    expect(source).toMatch(/Species:/)
    expect(source).toMatch(/batch\.species/)
  })
})

describe('components/farm/crops.tsx — BatchDetailScreen Economics tiles (issue #300)', () => {
  it('shows a real Revenue tile sourced from costBreakdown.revenue', () => {
    expect(source).toMatch(/costBreakdown\.revenue\.amountCents/)
  })

  it('shows a real Gross Margin tile sourced from costBreakdown.grossMarginPct', () => {
    expect(source).toMatch(/costBreakdown\.grossMarginPct/)
  })

  it('no longer claims Revenue/Gross Margin are unavailable unconditionally', () => {
    expect(source).not.toMatch(/Revenue and gross margin need a sales\/products data source that doesn.t exist yet — not shown\./)
  })
})
