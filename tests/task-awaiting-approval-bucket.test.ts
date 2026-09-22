import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'components/farm/tasks.tsx'), 'utf8')

// Retest finding (WORKFLOW-2): a worker marked "Morning Round worker
// verification" Done, and the owner's Tasks list still showed it under
// Overdue. Nothing was broken in the PATCH — a task whose requiresApproval is
// true is parked at PENDING_APPROVAL by app/api/tasks/[id] instead of being
// completed, and the owner's bucket logic had no case for that status, so it
// fell through to the due-date comparison and read as overdue the moment its
// due time passed. Finished work must never appear as overdue.
describe('a task waiting on a signature is not overdue', () => {
  it('gives PENDING_APPROVAL its own bucket, ahead of the due-date fallthrough', () => {
    const fn = source.slice(source.indexOf('function taskBucket'), source.indexOf('function exportTaskCSV'))
    expect(fn).toMatch(/if \(status === 'PENDING_APPROVAL'\) return 'awaiting'/)
    // It has to be decided before the `due < today` comparison, which is the
    // line that used to swallow it.
    expect(fn.indexOf("return 'awaiting'")).toBeLessThan(fn.indexOf('due < today'))
  })

  it('names the bucket in a way that says who is holding it', () => {
    expect(source).toMatch(/awaiting: 'Waiting on approval'/)
    expect(source).toMatch(/const BUCKET_ORDER: Bucket\[\] = \['overdue', 'today', 'awaiting', 'upcoming', 'done'\]/)
  })

  it('keeps it out of every overdue count the screen shows', () => {
    // overdueCount, the Crew view's "late" tally and the Week strip all key
    // off taskBucket(t) === 'overdue', so the bucket fix covers them — this
    // pins that they still derive from the bucket rather than re-deriving
    // overdue from the due date themselves.
    expect(source).toMatch(/const overdueCount = statusFiltered\.filter\(t => taskBucket\(t\) === 'overdue'\)\.length/)
    expect(source).toMatch(/late: openItems\.filter\(t => taskBucket\(t\) === 'overdue'\)\.length/)
  })

  it('still treats a genuinely late PENDING task as overdue', () => {
    const isOverdue = source.slice(source.indexOf('export function isOverdue'), source.indexOf('export function displayStatus'))
    expect(isOverdue).toMatch(/t\.status === 'PENDING' && !!t\.dueAt && new Date\(t\.dueAt\)\.getTime\(\) < Date\.now\(\)/)
  })
})
