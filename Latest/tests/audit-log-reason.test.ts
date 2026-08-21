// ── Governance Activity Log "reason" rendering (issue #309) ────────────────
// GET /api/audit-log returns a `meta` field (e.g. `{ reason: "Physical
// recount" }` for an inventory adjustment) that components/farm/governance.tsx
// already typed on AuditLogRow but never actually rendered. `auditReason`
// (exported from governance.tsx) is the pure extraction/validation step the
// Activity Log row now uses to decide whether to show a "Reason: …" line —
// unit-tested directly here per this repo's no-RTL convention (see
// tests/crops-batch-detail-ui.test.ts's header) plus a source-level guard
// that the JSX actually renders it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { auditReason } from '@/components/farm/governance'

describe('auditReason (pure)', () => {
  it('returns the reason string when meta.reason is a non-empty string', () => {
    expect(auditReason({ reason: 'Physical recount' })).toBe('Physical recount')
  })

  it('returns null when meta is null', () => {
    expect(auditReason(null)).toBeNull()
  })

  it('returns null when meta has no reason field', () => {
    expect(auditReason({ qty: 12 })).toBeNull()
  })

  it('returns null when reason is an empty/whitespace-only string', () => {
    expect(auditReason({ reason: '' })).toBeNull()
    expect(auditReason({ reason: '   ' })).toBeNull()
  })

  it('returns null when reason is not a string (never renders "undefined")', () => {
    expect(auditReason({ reason: 42 })).toBeNull()
    expect(auditReason({ reason: null })).toBeNull()
  })
})

describe('components/farm/governance.tsx — Activity Log row renders the reason (issue #309)', () => {
  const source = readFileSync(join(process.cwd(), 'components/farm/governance.tsx'), 'utf8')

  it('computes the reason from entry.meta for each row', () => {
    expect(source).toMatch(/const reason = auditReason\(entry\.meta\)/)
  })

  it('renders a "Reason: …" line only when present', () => {
    expect(source).toMatch(/\{reason && \(/)
    expect(source).toMatch(/Reason: \{reason\}/)
  })
})
