// ── Which task fields are a shape change, and which are a status report ─────
// Split out of app/api/tasks/[id]/route.ts so the rule can be tested without
// a database or a session: what counts as "restructuring a task" is a policy
// decision, and a policy that only exists inside a route handler is one
// nobody can assert on.
//
// The hole this backs: PATCH /api/tasks/[id] gated on
// `canEdit(..., MODULES.tasks)` and nothing else. A worker legitimately holds
// `tasks: 'edit'` — that is how they mark their own work DONE, and both
// tests/worker-tasks-today.test.ts and tests/tasks-governance.test.ts depend
// on it — but the same module-level grant also let them PATCH `assigneeId` on
// ANY task in the tenant: hand their own work to somebody else, silently,
// with no request and no trace. `approverId` was worse, because it decides
// who may approve the completion (lib/governance.ts#approverCanDecide).
//
// Module access answers "may this role touch tasks at all". It cannot answer
// "may this role change who is accountable for one" — those are the same
// permission at different altitudes, which is why the fields split in two.

/**
 * Everything that changes a task's SHAPE: who does it, who signs it off,
 * whether it needs signing off, what it is, when it is due, how much it
 * matters, and whether it repeats. Owner/manager only.
 */
export const TASK_SHAPE_FIELDS = [
  'title',
  'dueAt',
  'priority',
  'requiresApproval',
  'assigneeId',
  'approverId',
  'recurrence',
  'recurrenceUntil',
  // `notes` belongs here, not with `status`, and the reason is not obvious:
  // the assignee's name is carried in an "Assigned: <name>" prefix inside
  // `notes` (lib/tasks.ts's splitNotes, and the legacy assignment path
  // components/farm/tasks.tsx still reads). Letting a worker write `notes`
  // would hand back the exact reassignment power the `assigneeId` rule is
  // taking away, through a different door.
  'notes',
] as const

/**
 * `status` is the only field someone doing the work may send — and only on a
 * task that is theirs. Listed explicitly so the two sets can be asserted
 * disjoint, which is what stops a future field being quietly readable as
 * "not a shape change" just because nobody added it to the list above.
 */
export const TASK_REPORT_FIELDS = ['status'] as const

/**
 * Which shape fields this request body is actually trying to set. Presence,
 * not truthiness: `assigneeId: null` is a real reassignment (to nobody) and
 * must not slip through as "absent".
 */
export function taskShapeFieldsPresent(body: Record<string, unknown>): string[] {
  return TASK_SHAPE_FIELDS.filter((f) => body[f] !== undefined)
}
