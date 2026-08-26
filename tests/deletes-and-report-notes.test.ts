// ── Deletion guards, report-notes toggle, migration drift check ─────────────
// This repo asserts route/UI wiring against source (see
// tests/dashboard-settings-branding.test.ts's header for why). The migration
// checker is pure Node with no DB, so that half is exercised for real.
import { describe, it, expect } from 'vitest'
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('scripts/check-migrations.mjs — catches the silent skip', () => {
  // The failure being guarded: drizzle-kit applies what _journal.json lists,
  // not what is in the folder. An orphan .sql file is skipped without a word.
  function runIn(entries: { idx: number; tag: string }[], sqlFiles: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'))
    mkdirSync(join(dir, 'drizzle/meta'), { recursive: true })
    writeFileSync(join(dir, 'drizzle/meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'postgresql', entries: entries.map(e => ({ ...e, version: '7', when: 1, breakpoints: true })) }))
    for (const f of sqlFiles) writeFileSync(join(dir, `drizzle/${f}.sql`), 'SELECT 1;')
    writeFileSync(join(dir, 'check.mjs'), read('scripts/check-migrations.mjs'))
    try {
      const out = execFileSync('node', ['check.mjs'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return { code: 0, out }
    } catch (err) {
      const e = err as { status: number; stderr: string }
      return { code: e.status, out: e.stderr }
    }
  }

  it('passes when the journal and the .sql files agree', () => {
    const r = runIn([{ idx: 0, tag: '0000_a' }, { idx: 1, tag: '0001_b' }], ['0000_a', '0001_b'])
    expect(r.code).toBe(0)
  })

  it('fails on an orphan .sql file that would never run', () => {
    const r = runIn([{ idx: 0, tag: '0000_a' }], ['0000_a', '0001_forgotten'])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/0001_forgotten\.sql has no _journal\.json entry/)
  })

  it('fails on a journal entry whose file is missing', () => {
    const r = runIn([{ idx: 0, tag: '0000_a' }, { idx: 1, tag: '0001_ghost' }], ['0000_a'])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/0001_ghost.*does not exist/)
  })

  it('fails on two branches that both claimed the same migration number', () => {
    // The collision we kept nearly shipping: two open PRs each appending 0035.
    const r = runIn([{ idx: 0, tag: '0000_a' }, { idx: 1, tag: '0001_x' }, { idx: 1, tag: '0001_y' }], ['0000_a', '0001_x', '0001_y'])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/two entries with idx 1/)
  })

  it('is wired into CI before the build', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toMatch(/pnpm run check:migrations/)
    expect(ci.indexOf('check:migrations')).toBeLessThan(ci.indexOf('pnpm run build'))
  })

  it('the real migration set is consistent', () => {
    expect(() => execFileSync('node', ['scripts/check-migrations.mjs'], { stdio: 'pipe' })).not.toThrow()
  })
})

describe('DELETE /api/employees/[id] — owner only, history-safe', () => {
  const src = read('app/api/employees/[id]/route.ts')

  it('is owner-gated, not merely tenant-gated', () => {
    // A manager can edit staff; removing a person and suspending their login
    // is the employer's decision.
    expect(src).toMatch(/roles: \['owner'\]/)
  })

  it('counts records and payslips before deciding', () => {
    // records.employeeId and payslips.employeeId are NOT NULL FKs to this row.
    expect(src).toMatch(/from\(records\)/)
    expect(src).toMatch(/from\(payslips\)/)
  })

  it('archives instead of deleting when history exists, and says which it did', () => {
    expect(src).toMatch(/outcome: 'archived'/)
    expect(src).toMatch(/outcome: 'deleted'/)
    expect(src).toMatch(/status: 'INACTIVE'/)
  })

  it('suspends any linked login on both paths', () => {
    // Leaving an ACTIVE users row for someone off the roster is how a
    // departed worker keeps signing in.
    expect(src.match(/status: 'SUSPENDED'/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('audits the removal', () => {
    expect(src).toMatch(/action: 'employee\.(archived|deleted)'/)
  })
})

describe('DELETE /api/farms/[id] — admin only, refuses to take history with it', () => {
  const src = read('app/api/farms/[id]/route.ts')

  it('is super_admin only', () => {
    expect(src).toMatch(/session\.role !== 'super_admin'/)
  })

  it('refuses a farm that still has production units', () => {
    // production_units.farmId is a NOT NULL FK — deleting would orphan every
    // batch, record and report underneath it.
    expect(src).toMatch(/still has \$\{units\.length\} production unit/)
    expect(src).toMatch(/archive the farm instead/)
  })

  it('resolves the owners to email BEFORE the delete', () => {
    expect(src.indexOf('eq(users.role, \'owner\')')).toBeLessThan(src.indexOf('tx.delete(farms)'))
  })

  it('emails the affected owner and reports who could not be reached', () => {
    expect(src).toMatch(/sendFarmDeletedEmail/)
    expect(src).toMatch(/notifyFailed/)
  })
})

describe('Report notes are the farmer\'s call — except the safety line', () => {
  const reports = read('lib/reports.ts')

  it('routes every report\'s notes through the one gate', () => {
    expect(reports).not.toMatch(/notes: \[/)
    expect(reports.match(/notes: notesFor\(/g)?.length).toBe(7)
  })

  it('defaults to printing notes when a tenant has no settings row', () => {
    expect(reports).toMatch(/notesEnabled: s\?\.reportNotesEnabled \?\? true/)
  })

  it('never gates `basis` — a report must say what it was compiled from', () => {
    expect(reports).not.toMatch(/basis: notesFor/)
  })

  it('keeps the withdrawal-period warning out of the toggle', () => {
    // Food safety, not bookkeeping: a treatment log with no withdrawal column
    // and no explanation could put produce into a food chain early.
    expect(reports).toMatch(/NO withdrawal periods are shown/)
    const vaccinationBasis = reports.slice(reports.indexOf('worker-submitted health records'))
    expect(vaccinationBasis.slice(0, 400)).toMatch(/withdrawal/)
  })

  it('is a real persisted setting, not a client-only preference', () => {
    expect(read('db/schemas/settings.ts')).toMatch(/reportNotesEnabled: boolean\('report_notes_enabled'\)/)
    expect(read('app/api/settings/route.ts')).toMatch(/patch\.reportNotesEnabled = b\.reportNotesEnabled/)
    expect(read('components/farm/settings.tsx')).toMatch(/toggleSetting\('reportNotesEnabled'\)/)
  })
})
