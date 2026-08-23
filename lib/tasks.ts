// ── Task scheduling helpers (tasks-scheduling task) ─────────────────────────
// Recurrence lives here so the two places a task can finish — a direct
// PATCH to DONE, and an approval being granted — spawn the next occurrence
// identically. Putting it in either route would mean the other silently
// broke the chain, which is the failure a recurring chore can least afford:
// nobody notices a task that quietly stopped repeating until the work is
// already overdue.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { tasks } from '@/db/schemas'

export const RECURRENCES = ['none', 'daily', 'weekly', 'monthly'] as const
export type Recurrence = (typeof RECURRENCES)[number]

export function isRecurrence(v: unknown): v is Recurrence {
  return typeof v === 'string' && (RECURRENCES as readonly string[]).includes(v)
}

// Advances a date by one interval. Monthly uses the calendar month rather
// than 30 days, so "1st of the month" stays the 1st; JS's own overflow
// (31 Jan + 1 month = 3 Mar in a non-leap year) is clamped to the last day
// of the target month instead, because a monthly chore due on the 31st
// should land on the 28th in February, not skip into March.
export function nextOccurrence(from: Date, recurrence: Recurrence): Date | null {
  const next = new Date(from.getTime())
  switch (recurrence) {
    case 'daily':
      next.setDate(next.getDate() + 1)
      return next
    case 'weekly':
      next.setDate(next.getDate() + 7)
      return next
    case 'monthly': {
      const day = next.getDate()
      next.setDate(1)
      next.setMonth(next.getMonth() + 1)
      const lastDayOfTarget = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
      next.setDate(Math.min(day, lastDayOfTarget))
      return next
    }
    default:
      return null
  }
}

type TaskRow = typeof tasks.$inferSelect
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Creates the next occurrence of a completed recurring task, if there should
// be one. Returns the new row, or null when the task doesn't recur, has run
// past its end date, or has no due date to count from (a recurring task with
// no due date has nothing to advance — that's a data problem the caller
// prevented at write time, not something to guess at here).
//
// Accepts an optional transaction so an approval can spawn the follow-up in
// the same atomic step that resolved it: a decision that committed while its
// successor didn't would leave the chain silently broken.
export async function spawnNextOccurrence(task: TaskRow, tx?: Tx): Promise<TaskRow | null> {
  const conn = tx ?? db
  if (!isRecurrence(task.recurrence) || task.recurrence === 'none') return null
  if (!task.dueAt) return null

  const nextDue = nextOccurrence(task.dueAt, task.recurrence)
  if (!nextDue) return null
  if (task.recurrenceUntil && nextDue > task.recurrenceUntil) return null

  // Guard against a double-spawn: completing the same task twice (an
  // approval retried, a client double-tap) must not fork the chain.
  const existing = await conn
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.tenantId, task.tenantId), eq(tasks.recurrenceParentId, task.id)))
    .limit(1)
  if (existing.length > 0) return null

  const [created] = await conn
    .insert(tasks)
    .values({
      id: randomUUID(),
      tenantId: task.tenantId,
      title: task.title,
      dueAt: nextDue,
      status: 'PENDING',
      priority: task.priority,
      requiresApproval: task.requiresApproval,
      notes: task.notes,
      farmId: task.farmId,
      assigneeId: task.assigneeId,
      approverId: task.approverId,
      recurrence: task.recurrence,
      recurrenceUntil: task.recurrenceUntil,
      recurrenceParentId: task.id,
    })
    .returning()

  return created ?? null
}
