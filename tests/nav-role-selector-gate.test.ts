// ── RoleSelector gated out of production (issue #311) ───────────────────────
// The dev-only RoleSelector overlay (components/farm/navigation.tsx) used to
// render unconditionally in every environment, including production, and let
// any authenticated user instantly flip their client-side `role` state with
// no re-auth. It's now gated behind NODE_ENV !== 'production'. Source-level
// guard per this repo's no-RTL convention (see
// tests/crops-batch-detail-ui.test.ts's header).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'components/farm/navigation.tsx'), 'utf8')

describe('components/farm/navigation.tsx — RoleSelector dev-only gate (issue #311)', () => {
  it('only renders RoleSelector when NODE_ENV is not production', () => {
    // Quote-agnostic: the repo lints to single quotes, so pinning the literal
    // double-quoted form turned a lint fix into a false regression.
    expect(source).toMatch(/process\.env\.NODE_ENV !== ['"]production['"] && \(\s*<RoleSelector/)
  })
})
