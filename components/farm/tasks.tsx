'use client';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNav, TopNav } from './navigation';
import {
  Plus, CheckCircle2, Users, Check, Filter, RefreshCw, ShieldCheck,
  Trash2, Download, FileText, ChevronLeft, ChevronRight,
  AlertTriangle,
} from './icons';
import { apiClient } from '@/lib/request';
import { useToast } from './ui-shared';
import { StatusTimeline } from './status-timeline';
import { PageHeader, Kpi } from '@/components/ui-kit/page-header';
import { Segmented, Chips } from '@/components/ui-kit/segmented';
import { Badge } from '@/components/ui-kit/badge';
import { Avatar } from '@/components/ui-kit/avatar';
import { Button } from '@/components/ui-kit/button';
import { Input } from '@/components/ui-kit/input';
import { EmptyState } from '@/components/ui-kit/empty-state';
import { Sheet, SheetTitle } from '@/components/ui-kit/sheet';
import { Dossier, Inspector, Kv } from '@/components/ui-kit/inspector';
import { Field, controlClass } from '@/components/ui-kit/field';
import { cn } from '@/lib/utils';

// ── Tasks screen, wired to /api/tasks (issue #244) ──────────────────────────
// Replaces the previous mock-data-driven prototype (see components/farm/data.ts).
// The real `tasks` table (db/schemas/dashboard.ts, built issue #227, extended
// #243) is deliberately minimal — id/tenantId/title/dueAt/status/priority/
// requiresApproval/notes/createdAt. It has no code/type/batch/unit/GPS/photo/
// external-worker/frequency columns, so this screen drops those mock-only
// decorations rather than fake-persist them; see PATCH /api/tasks/[id]'s own
// header comment for the same v1-scope reasoning.
//
// ── Assignee ──
// There IS an `assignee_id` column now (migration 0029) and it holds an
// employees.id. Assignment used to be encoded as the first line of `notes`
// ("Assigned: <name>") because no column existed; splitNotes/buildNotes are
// kept because rows written before that migration still carry the old
// encoding, and the backfill can only match the ones whose stored name still
// matches an employee. `assigneeNameFor` below reads the column first and
// falls back to the text, so neither generation of row loses its assignee.
//
// ── Redesign (ui/governance-reference-redesign, package D) ──
// Ported the layout from the reference's src/components/tasks/tasks-page.tsx
// (Queue/Crew/Week, D5 of docs/ui-migration-map.md) onto this exact same
// backend: no request URL, payload shape or permission check changed. The
// reference infers a "house" per task from a title regex against its own mock
// unit list — our `tasks` table has no unit/house column at all (see above),
// so that decoration is dropped rather than guessed at. Every reference
// screen depends on `scoped` (farm+person+search filtered); this port keeps
// that plus the two LOCAL filters that predate the redesign (status,
// priority — see FilterSheet) since dropping them would be a feature loss.

// ApiTask/splitNotes/buildNotes/ASSIGNEE_PREFIX and the status/formatting
// helpers below are also imported by components/farm/worker.tsx's "My Tasks
// Today" section (issue #303) so the two screens parse/format the exact same
// assignee-in-notes convention rather than maintaining a second copy that can
// drift.
export interface ApiTask {
  id: string;
  tenantId: string;
  title: string;
  dueAt: string | null;
  status: string;
  priority: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  notes: string | null;
  createdAt: string | null;
  farmId?: string | null; // farm-scoped-data task (migration 0019)
  // tasks-scheduling task (migration 0029): assignment stopped being a line
  // of text inside `notes` and became real columns. `assigneeId` is an
  // employees.id, `approverId` a users.id — see db/schemas/dashboard.ts for
  // why those are different kinds of identity.
  assigneeId?: string | null;
  approverId?: string | null;
  recurrence?: string;
  recurrenceUntil?: string | null;
  recurrenceParentId?: string | null;
}

interface Employee {
  id: string;
  // Nullable logical link to `users` (db/schemas/people.ts) — lets a task's
  // `approverId` (a users.id) resolve to a name even for someone whose role
  // no longer carries governance edit rights, so they don't misreport as
  // having left the farm when they're simply not an approver anymore.
  userId?: string | null;
  name: string;
  role: string;
}

// GET /api/approvals/approvers — the people who may be NAMED as a task's
// approver: they can sign in, and their role has governance edit access
// under this tenant's own matrix.
export interface Approver {
  userId: string;
  name: string;
  role: string;
  employeeId: string | null;
}

// What the create sheet hands back. Kept as one object because every caller
// (the + button, a week day, "schedule again" on a finished task) fills
// in a different subset and the rest defaults.
export interface TaskDraft {
  title: string;
  assigneeId: string;
  approverId: string;
  dueDate: string;
  dueTime: string;
  priority: 'high' | 'medium' | 'low';
  requiresApproval: boolean;
  recurrence: string;
  recurrenceUntil: string;
  notes: string;
  farmId: string;
}

export const ASSIGNEE_PREFIX = 'Assigned: ';

export function splitNotes(notes: string | null | undefined): { assignee: string; rest: string } {
  if (!notes) return { assignee: '', rest: '' };
  const nl = notes.indexOf('\n');
  const firstLine = nl === -1 ? notes : notes.slice(0, nl);
  if (firstLine.startsWith(ASSIGNEE_PREFIX)) {
    return {
      assignee: firstLine.slice(ASSIGNEE_PREFIX.length).trim(),
      rest: nl === -1 ? '' : notes.slice(nl + 1).replace(/^\n+/, ''),
    };
  }
  return { assignee: '', rest: notes };
}

export function buildNotes(assignee: string, rest: string): string | null {
  const trimmedRest = rest.trim();
  const trimmedAssignee = assignee.trim();
  if (!trimmedAssignee && !trimmedRest) return null;
  if (!trimmedAssignee) return trimmedRest;
  return `${ASSIGNEE_PREFIX}${trimmedAssignee}${trimmedRest ? `\n${trimmedRest}` : ''}`;
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', DONE: 'Done', OVERDUE: 'Overdue',
  PENDING_APPROVAL: 'Pending approval', REJECTED: 'Rejected',
};

// The assignee to SHOW: the real column when it's set, otherwise whatever
// the pre-migration "Assigned: <name>" line in notes said.
export function assigneeNameFor(task: ApiTask, employees: { id: string; name: string }[]): string {
  if (task.assigneeId) {
    return employees.find((e) => e.id === task.assigneeId)?.name ?? 'Assigned';
  }
  return splitNotes(task.notes).assignee;
}

export const RECURRENCE_LABEL: Record<string, string> = {
  none: 'Does not repeat', daily: 'Every day', weekly: 'Every week', monthly: 'Every month',
};

export function isOverdue(t: ApiTask): boolean {
  return t.status === 'PENDING' && !!t.dueAt && new Date(t.dueAt).getTime() < Date.now();
}

export function displayStatus(t: ApiTask): string {
  return isOverdue(t) ? 'OVERDUE' : t.status;
}

export function statusChipClass(status: string): string {
  if (status === 'DONE') return 'chip-ok';
  if (status === 'OVERDUE' || status === 'REJECTED') return 'chip-critical';
  return 'chip-warning';
}

export function fmtDueAt(iso: string | null): string {
  if (!iso) return 'No due date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'No due date';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Queue grouping (D5) — overdue -> today -> upcoming -> done. A task with
// no due date reads as "upcoming" (there's nothing to be overdue against).
// This is a pure client regroup of the same GET /api/tasks response the old
// flat list used — no new fetch, matching the map's "EXISTS → regroup"
// entry for Tasks §2.
type Bucket = 'overdue' | 'today' | 'upcoming' | 'done';
const BUCKET_LABEL: Record<Bucket, string> = { overdue: 'Overdue', today: 'Today', upcoming: 'Upcoming', done: 'Done' };
const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'upcoming', 'done'];

function taskBucket(t: ApiTask): Bucket {
  const status = displayStatus(t);
  if (status === 'DONE' || status === 'REJECTED') return 'done';
  if (status === 'OVERDUE') return 'overdue';
  if (!t.dueAt) return 'upcoming';
  const due = ymd(new Date(t.dueAt));
  const today = ymd(new Date());
  if (due === today) return 'today';
  return due < today ? 'overdue' : 'upcoming';
}

function exportTaskCSV(tasks: ApiTask[], filename = 'tasks_export.csv') {
  const cols = ['title', 'assignee', 'status', 'priority', 'dueAt', 'requiresApproval', 'notes'];
  const rows = [cols.join(','), ...tasks.map(t => {
    const { assignee, rest } = splitNotes(t.notes);
    const vals = [t.title, assignee, displayStatus(t), t.priority, t.dueAt ?? '', String(t.requiresApproval), rest];
    return vals.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  })];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;
}

/* ── Task line — one row in Queue / Crew / Week's list ── */
function TaskLine({ task, employees, active, onPick }: { task: ApiTask; employees: Employee[]; active: boolean; onPick: () => void }) {
  const assignee = assigneeNameFor(task, employees);
  const status = displayStatus(task);
  const bucket = taskBucket(task);
  // Amber ("needs you") for anything not yet closed and already due,
  // primary green once done — red is reserved for real destructive actions
  // elsewhere on this screen (delete), not for a task merely running late.
  const dotClass = status === 'DONE' ? 'bg-primary' : (bucket === 'overdue' || bucket === 'today') ? 'bg-warning' : 'bg-border';
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn('flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left', active ? 'bg-primary-soft' : 'hover:bg-surface-2')}
    >
      <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', dotClass)} />
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm font-medium', status === 'DONE' && 'text-muted line-through')}>{task.title}</span>
        <span className="mt-0.5 block text-xs text-subtle">
          {assignee ? assignee.split(' ')[0] : 'Unassigned'} · {fmtDueAt(task.dueAt)}
        </span>
      </span>
      {task.priority === 'high' && <Badge variant="warning">High</Badge>}
    </button>
  );
}

function EmptyFile() {
  return <EmptyState icon={<FileText size={18} />} title="Nothing selected" body="Pick a line on the left to read its file." />;
}

/* ── Task detail — shared body, rendered as a desktop Dossier or a mobile
 * Inspector sheet by every one of Queue/Crew/Week (`as` picks which). ── */
function TaskDetailPanel({
  as, open, onOpenChange, task, employees, approvers, onDone, onDelete, onUpdate, onScheduleAgain,
}: {
  as: 'dossier' | 'inspector';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  task: ApiTask;
  employees: Employee[];
  approvers: Approver[];
  onDone: (task: ApiTask) => void;
  onDelete: (task: ApiTask) => void;
  onUpdate: (task: ApiTask, patch: Record<string, unknown>) => Promise<string | null>;
  onScheduleAgain: (draft: Partial<TaskDraft>) => void;
}) {
  const { rest } = splitNotes(task.notes);
  const assignee = assigneeNameFor(task, employees);
  const status = displayStatus(task);
  const finished = task.status === 'DONE' || task.status === 'REJECTED';
  const bucketLabel = BUCKET_LABEL[taskBucket(task)];

  const [editing, setEditing] = useState(false);
  const [draftAssignee, setDraftAssignee] = useState(task.assigneeId ?? '');
  const [draftApprover, setDraftApprover] = useState(task.approverId ?? '');
  const [draftDue, setDraftDue] = useState(task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 16) : '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // A different row was picked — drop any in-flight edit on the previous one.
  useEffect(() => {
    setEditing(false);
    setDraftAssignee(task.assigneeId ?? '');
    setDraftApprover(task.approverId ?? '');
    setDraftDue(task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 16) : '');
    setSaveError('');
  }, [task.id, task.assigneeId, task.approverId, task.dueAt]);

  // Resolve against the approvers list first (it carries the role), then
  // fall back to the full employees list matched on `userId` — a named
  // approver whose role has since lost governance rights (or who is simply
  // not reloaded into `approvers` for some other reason) still has a real
  // name on this farm; only say otherwise when neither list knows the id.
  const approverName = task.approverId
    ? approvers.find(a => a.userId === task.approverId)?.name
      ?? employees.find(e => e.userId === task.approverId)?.name
      ?? 'Someone no longer on this farm'
    : 'Anyone who can approve';

  async function saveEdits() {
    setSaving(true);
    setSaveError('');
    const failure = await onUpdate(task, {
      assigneeId: draftAssignee || null,
      approverId: draftApprover || null,
      dueAt: draftDue ? new Date(draftDue).toISOString() : '',
    });
    setSaving(false);
    if (failure) { setSaveError(failure); return; }
    setEditing(false);
  }

  const body = (
    <>
      <dl>
        <Kv label="Status" value={STATUS_LABEL[status] ?? status} />
        <Kv label="Priority" value={<span className="capitalize">{task.priority}</span>} />
        <Kv label="Assignee" value={assignee || 'Unassigned'} />
        <Kv label="Due" value={fmtDueAt(task.dueAt)} />
        <Kv label="Repeats" value={RECURRENCE_LABEL[task.recurrence ?? 'none'] ?? 'Does not repeat'} />
        <Kv label="Approval" value={task.requiresApproval ? (task.approverId ? approverName : 'Anyone who can approve') : 'None'} />
      </dl>
      {task.requiresApproval && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs font-medium text-warning">
          <ShieldCheck size={13} aria-hidden="true" />
          {task.approverId ? `${approverName} approves this before it counts as done` : 'Needs approval before it counts as done'}
        </div>
      )}
      {task.recurrenceParentId && (
        <p className="mt-2 text-xs text-subtle">Created automatically when the previous one was completed.</p>
      )}
      {rest && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
          <FileText size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> {rest}
        </div>
      )}

      {editing && (
        <div className="mt-4 rounded-lg bg-surface-2 p-3">
          <p className="mb-2 text-xs font-medium tracking-wide text-subtle uppercase">Change who and when</p>
          <Field label="Assigned to" className="mb-2">
            <select className={controlClass} value={draftAssignee} onChange={e => setDraftAssignee(e.target.value)}>
              <option value="">Unassigned</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.role})</option>)}
            </select>
          </Field>
          {task.requiresApproval && (
            <Field label="Approved by" className="mb-2">
              <select className={controlClass} value={draftApprover} onChange={e => setDraftApprover(e.target.value)}>
                <option value="">Anyone who can approve</option>
                {approvers.map(a => <option key={a.userId} value={a.userId}>{a.name} ({a.role})</option>)}
              </select>
            </Field>
          )}
          <Field label="Due">
            <Input type="datetime-local" value={draftDue} onChange={e => setDraftDue(e.target.value)} />
          </Field>
          {saveError && <p className="mt-2 text-xs text-danger">{saveError}</p>}
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" className="flex-1 justify-center" onClick={() => { setEditing(false); setSaveError(''); }}>Cancel</Button>
            <Button className="flex-1 justify-center" onClick={saveEdits} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      )}

      <StatusTimeline tenantId={task.tenantId} entity="task" entityId={task.id} />
    </>
  );

  const footer = !editing ? (
    <div className="flex flex-wrap gap-2">
      {finished && (
        <Button
          variant="secondary"
          className="flex-1 justify-center"
          onClick={() => onScheduleAgain({
            title: task.title, assigneeId: task.assigneeId ?? '', approverId: task.approverId ?? '',
            priority: task.priority, requiresApproval: task.requiresApproval, notes: rest, farmId: task.farmId ?? '',
          })}
        >
          <RefreshCw size={13} /> Schedule again
        </Button>
      )}
      <Button variant="secondary" onClick={() => setEditing(true)}>{finished ? 'Reassign' : 'Reassign / reschedule'}</Button>
      {task.status !== 'DONE' && task.status !== 'PENDING_APPROVAL' && (
        <Button className="flex-1 justify-center" onClick={() => onDone(task)}><Check size={13} /> Mark done</Button>
      )}
      {task.status !== 'DONE' && (
        <Button variant="danger" size="icon-sm" aria-label="Delete task" onClick={() => onDelete(task)}><Trash2 size={13} /></Button>
      )}
    </div>
  ) : null;

  if (as === 'dossier') {
    return (
      <Dossier kicker={bucketLabel} title={task.title} lede={assignee ? `${assignee} · ${fmtDueAt(task.dueAt)}` : fmtDueAt(task.dueAt)} footer={footer}>
        {body}
      </Dossier>
    );
  }
  return (
    <Inspector
      open={!!open}
      onOpenChange={onOpenChange ?? (() => {})}
      kicker={bucketLabel}
      title={task.title}
      lede={assignee || undefined}
      footer={footer}
    >
      {body}
    </Inspector>
  );
}

/* ── Queue — grouped by due bucket, with the search + person chips that scope
 * every one of Queue/Crew/Week (reference's shared `scoped`). ── */
function Queue({
  groups, employees, approvers, search, onSearch, peopleOptions, person, onPerson, picked, onPick, onDone, onDelete, onUpdate, onScheduleAgain,
}: {
  groups: { id: Bucket; items: ApiTask[] }[];
  employees: Employee[];
  approvers: Approver[];
  search: string;
  onSearch: (v: string) => void;
  peopleOptions: { id: string; label: string }[];
  person: string;
  onPerson: (v: string) => void;
  picked: ApiTask | null;
  onPick: (t: ApiTask) => void;
  onDone: (t: ApiTask) => void;
  onDelete: (t: ApiTask) => void;
  onUpdate: (task: ApiTask, patch: Record<string, unknown>) => Promise<string | null>;
  onScheduleAgain: (draft: Partial<TaskDraft>) => void;
}) {
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.9fr)]">
      <div className="min-w-0 rounded-xl bg-surface p-3 shadow-(--shadow-border) lg:p-4">
        <Input value={search} onChange={e => onSearch(e.target.value)} placeholder="Search work or a name…" aria-label="Search tasks" />
        <div className="mt-3">
          <Chips value={person} onChange={onPerson} items={peopleOptions} />
        </div>
        {groups.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted">No work matches that filter.</p>
        ) : (
          groups.map(g => (
            <section key={g.id} className="mt-4">
              <h3 className="sticky top-0 z-10 bg-surface/90 px-2 py-1.5 text-xs font-medium tracking-[0.12em] text-subtle uppercase backdrop-blur-sm">
                {BUCKET_LABEL[g.id]} · {g.items.length}
              </h3>
              <ul>
                {g.items.map(t => (
                  <li key={t.id}><TaskLine task={t} employees={employees} active={picked?.id === t.id} onPick={() => onPick(t)} /></li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <div className="hidden min-w-0 lg:block">
        {picked ? (
          <TaskDetailPanel as="dossier" task={picked} employees={employees} approvers={approvers} onDone={onDone} onDelete={onDelete} onUpdate={onUpdate} onScheduleAgain={onScheduleAgain} />
        ) : <EmptyFile />}
      </div>
    </div>
  );
}

/* ── Crew — grouped by assignee, load bar (D5, new view — no new fetch, built
 * from the same GET /api/tasks + GET /api/employees Queue already loads). ── */
interface CrewRow { id: string; name: string; role: string; open: number; late: number; items: ApiTask[] }

function Crew({ crew, employees, maxOpen, picked, onPick }: {
  crew: CrewRow[];
  employees: Employee[];
  maxOpen: number;
  picked: ApiTask | null;
  onPick: (t: ApiTask) => void;
}) {
  const selectedPerson = picked?.assigneeId ?? crew[0]?.id;
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.9fr)]">
      <div className="min-w-0 rounded-xl bg-surface p-3 shadow-(--shadow-border) lg:p-4">
        <p className="px-1 text-xs text-muted">Open work per person. A full bar is a crew member carrying the load.</p>
        {crew.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted">Nobody has open, assigned work right now.</p>
        ) : (
          <ul className="mt-3">
            {crew.map(c => {
              const active = c.id === selectedPerson;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => { const first = c.items.find(t => t.status !== 'DONE') ?? c.items[0]; if (first) onPick(first); }}
                    className={cn('flex w-full flex-col gap-2 rounded-lg px-3 py-3 text-left', active ? 'bg-primary-soft' : 'hover:bg-surface-2')}
                  >
                    <span className="flex items-center gap-2">
                      <Avatar name={c.name} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{c.name}</span>
                        <span className="block text-xs text-subtle">{c.role}</span>
                      </span>
                      <span className="text-xs tabular-nums text-muted">{c.open} open{c.late ? ` · ${c.late} late` : ''}</span>
                    </span>
                    <span className="block h-1.5 overflow-hidden rounded-full bg-border">
                      <span className={cn('block h-full rounded-full', c.late ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.round((c.open / maxOpen) * 100)}%` }} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="hidden min-w-0 lg:block">
        {crew.find(c => c.id === selectedPerson) ? (
          (() => {
            const row = crew.find(c => c.id === selectedPerson)!;
            return (
              <Dossier kicker={row.role} title={row.name} lede={`${row.open} open · ${row.late} overdue`}>
                <ul>{row.items.map(t => <li key={t.id}><TaskLine task={t} employees={employees} active={picked?.id === t.id} onPick={() => onPick(t)} /></li>)}</ul>
              </Dossier>
            );
          })()
        ) : (
          <EmptyState icon={<Users size={18} />} title="No crew activity" body="Assign work to see it grouped by person here." />
        )}
      </div>
    </div>
  );
}

/* ── Week — 7-day load strip + day drill-in (D5: replaces the month
 * calendar; a prev/next-WEEK control keeps the "browse other periods"
 * ability the month view had, at the week granularity the reference uses).
 * Mobile: the strip itself IS the swipeable day picker (overflow-x-auto,
 * no page-level horizontal scroll) — no separate mobile layout needed. ── */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function startOfWeekMonday(d: Date): Date {
  const copy = new Date(d);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function Week({
  tasks, employees, approvers, weekStart, onWeekChange, day, onDay, picked, onPick, onAddOn, onDone, onDelete, onUpdate, onScheduleAgain,
}: {
  tasks: ApiTask[];
  employees: Employee[];
  approvers: Approver[];
  weekStart: Date;
  onWeekChange: (d: Date) => void;
  day: string | null;
  onDay: (iso: string) => void;
  picked: ApiTask | null;
  onPick: (t: ApiTask) => void;
  onAddOn: (isoDate: string) => void;
  onDone: (t: ApiTask) => void;
  onDelete: (t: ApiTask) => void;
  onUpdate: (task: ApiTask, patch: Record<string, unknown>) => Promise<string | null>;
  onScheduleAgain: (draft: Partial<TaskDraft>) => void;
}) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const counts = useMemo(() => days.map(d => tasks.filter(t => t.dueAt && ymd(new Date(t.dueAt)) === ymd(d))), [days, tasks]);
  const max = Math.max(1, ...counts.map(c => c.length));
  const todayKey = ymd(new Date());
  const selectedKey = day ?? todayKey;
  const ofDay = tasks.filter(t => t.dueAt && ymd(new Date(t.dueAt)) === selectedKey);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const emptyAhead = days.filter((d, i) => d >= startOfToday && counts[i].length === 0).length;

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.9fr)]">
      <div className="min-w-0 rounded-xl bg-surface p-4 shadow-(--shadow-border)">
        <div className="flex items-center justify-between">
          <button type="button" aria-label="Previous week" onClick={() => onWeekChange(addDays(weekStart, -7))} className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2">
            <ChevronLeft size={16} />
          </button>
          <p className="text-xs font-medium tracking-[0.12em] text-subtle uppercase">
            {days[0]!.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – {days[6]!.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </p>
          <button type="button" aria-label="Next week" onClick={() => onWeekChange(addDays(weekStart, 7))} className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2">
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-7 lg:gap-2 lg:overflow-visible">
          {days.map((d, i) => {
            const key = ymd(d);
            const n = counts[i]!;
            const late = n.some(t => taskBucket(t) === 'overdue');
            const on = key === selectedKey;
            const h = 8 + Math.round((n.length / max) * 56);
            return (
              <button
                key={key}
                type="button"
                onClick={() => { onDay(key); if (n[0]) onPick(n[0]); }}
                className={cn('flex w-14 shrink-0 flex-col items-center gap-2 rounded-lg px-1 py-2 lg:w-auto', on ? 'bg-primary-soft' : 'hover:bg-surface-2')}
              >
                <span className="text-[10px] tracking-wide text-muted uppercase">{WEEKDAYS[i]}</span>
                <span className="flex h-16 w-full items-end justify-center">
                  <span className={cn('w-4 rounded-sm', late ? 'bg-warning' : n.length ? 'bg-primary' : 'bg-border')} style={{ height: n.length ? h : 4 }} />
                </span>
                <span className={cn('text-sm tabular-nums', key === todayKey && 'font-medium text-primary')}>{d.getDate()}</span>
                <span className="text-[10px] tabular-nums text-subtle">{n.length || '—'}</span>
              </button>
            );
          })}
        </div>

        {emptyAhead > 0 && (
          <p className="mt-3 text-xs text-warning">{emptyAhead} day{emptyAhead === 1 ? '' : 's'} ahead this week with nothing scheduled.</p>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-sm text-muted">
            {ofDay.length ? `${ofDay.length} on ${new Date(`${selectedKey}T12:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}.` : 'Nothing assigned that day.'}
          </p>
          <Button size="sm" variant="secondary" onClick={() => onAddOn(selectedKey)}><Plus size={12} /> Add</Button>
        </div>
        <ul className="mt-2">
          {ofDay.map(t => <li key={t.id}><TaskLine task={t} employees={employees} active={picked?.id === t.id} onPick={() => onPick(t)} /></li>)}
        </ul>
      </div>
      <div className="hidden min-w-0 lg:block">
        {picked && ofDay.some(t => t.id === picked.id) ? (
          <TaskDetailPanel as="dossier" task={picked} employees={employees} approvers={approvers} onDone={onDone} onDelete={onDelete} onUpdate={onUpdate} onScheduleAgain={onScheduleAgain} />
        ) : (
          <EmptyState icon={<CheckCircle2 size={18} />} title="Nothing selected" body="Tap a day, then a line, or Add to plan work for it." />
        )}
      </div>
    </div>
  );
}

/* ── Add Task Sheet ── */
function AddTaskSheet({ employees, farms, activeFarmId, approvers, initial, onClose, onCreate }: {
  employees: Employee[];
  farms: { id: string; name: string }[];
  activeFarmId: string;
  approvers: Approver[];
  initial?: Partial<TaskDraft>;
  onClose: () => void;
  onCreate: (payload: TaskDraft) => Promise<string | null>;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [assigneeId, setAssigneeId] = useState(initial?.assigneeId ?? '');
  const [approverId, setApproverId] = useState(initial?.approverId ?? '');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(initial?.dueTime ?? '08:00');
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>(initial?.priority ?? 'medium');
  const [requiresApproval, setRequiresApproval] = useState(initial?.requiresApproval ?? false);
  const [recurrence, setRecurrence] = useState(initial?.recurrence ?? 'none');
  const [recurrenceUntil, setRecurrenceUntil] = useState(initial?.recurrenceUntil ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [farmId, setFarmId] = useState(initial?.farmId ?? (activeFarmId !== 'ALL' ? activeFarmId : ''));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!title.trim()) { setError('Task title is required'); return; }
    if (recurrence !== 'none' && !dueDate) { setError('A repeating task needs a due date — each repeat is counted from it'); return; }
    setSaving(true);
    setError('');
    const failure = await onCreate({
      title: title.trim(), assigneeId, approverId, dueDate, dueTime, priority,
      requiresApproval, recurrence, recurrenceUntil, notes, farmId,
    });
    setSaving(false);
    if (failure) { setError(failure); return; }
    onClose();
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} side="bottom" className="rounded-t-2xl max-h-[92vh]">
      <SheetTitle className="sr-only">Assign work</SheetTitle>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mb-4 font-display text-xl font-medium">Assign work</div>

        <div className="flex flex-col gap-3">
          <Field label="Work *">
            <Input value={title} onChange={e => { setTitle(e.target.value); setError(''); }} placeholder="e.g. Afternoon feed — house 1" inputMode="text" />
          </Field>

          <Field label="Farm">
            <select className={controlClass} value={farmId} onChange={e => setFarmId(e.target.value)}>
              <option value="">No specific farm (tenant-wide)</option>
              {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>

          <Field label="Who">
            <select className={controlClass} value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.role})</option>)}
            </select>
          </Field>

          <Field label="Repeats">
            <select className={controlClass} value={recurrence} onChange={e => setRecurrence(e.target.value)}>
              {Object.entries(RECURRENCE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          {recurrence !== 'none' && (
            <Field label="Stop repeating after (optional)">
              <Input type="date" value={recurrenceUntil} onChange={e => setRecurrenceUntil(e.target.value)} />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Due date">
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </Field>
            <Field label="Due time">
              <Input type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} />
            </Field>
          </div>

          <Field label="Priority">
            <Chips
              value={priority}
              onChange={setPriority}
              items={[{ id: 'high', label: 'High' }, { id: 'medium', label: 'Medium' }, { id: 'low', label: 'Low' }]}
            />
          </Field>

          <div className="rounded-lg bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Needs approval</div>
                <div className="mt-0.5 text-xs text-muted">The assignee submits it for review instead of marking it done</div>
              </div>
              <button
                type="button"
                onClick={() => setRequiresApproval(x => !x)}
                aria-pressed={requiresApproval}
                className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', requiresApproval ? 'bg-primary' : 'bg-border')}
              >
                <span className={cn('absolute top-0.5 size-5 rounded-full bg-surface transition-[left]', requiresApproval ? 'left-[22px]' : 'left-0.5')} />
              </button>
            </div>
            {requiresApproval && (
              <div className="mt-3 border-t border-border pt-3">
                <Field label="Who approves it">
                  <select className={controlClass} value={approverId} onChange={e => setApproverId(e.target.value)}>
                    <option value="">Anyone who can approve</option>
                    {approvers.map(a => <option key={a.userId} value={a.userId}>{a.name} ({a.role})</option>)}
                  </select>
                </Field>
                <p className="mt-2 text-xs text-muted">
                  {approverId
                    ? 'Only this person sees it in their approvals queue and can sign it off. The owner can step in if they are unavailable.'
                    : 'It goes to everyone who can approve, and any of them can sign it off.'}
                </p>
                {approvers.length === 0 && (
                  <p className="mt-1.5 text-xs text-warning">Nobody on this farm can approve yet — a person needs a login and a role with governance access.</p>
                )}
              </div>
            )}
          </div>

          <Field label="Notes / instructions">
            <textarea className={cn(controlClass, 'h-20 resize-none py-2')} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Instructions for the assignee…" />
          </Field>

          {error && <div className="flex items-center gap-1.5 text-xs text-danger"><AlertTriangle size={12} aria-hidden="true" /> {error}</div>}

          <Button className="mt-1 justify-center" onClick={submit} disabled={saving}>
            <Check size={14} /> {saving ? 'Assigning…' : 'Assign'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/* ── Filter Sheet — status/priority (a local feature that predates the
 * redesign; the reference has no equivalent, since Queue's bucket grouping
 * covers most of the same job, but priority filtering is still real and
 * useful, so it stays). ── */
function FilterSheet({
  filterStatus, setFilterStatus, filterPriority, setFilterPriority, onClose, onReset,
}: {
  filterStatus: string; setFilterStatus: (v: string) => void;
  filterPriority: string; setFilterPriority: (v: string) => void;
  onClose: () => void; onReset: () => void;
}) {
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} side="bottom" className="rounded-t-2xl max-h-[80vh]">
      <SheetTitle className="sr-only">Filter tasks</SheetTitle>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mb-4 font-display text-xl font-medium">Filter tasks</div>

        <div className="mb-4">
          <p className="mb-2 text-xs font-medium tracking-wide text-subtle uppercase">Status</p>
          <div className="flex flex-wrap gap-1.5">
            {['All', 'PENDING', 'OVERDUE', 'PENDING_APPROVAL', 'DONE', 'REJECTED'].map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setFilterStatus(v)}
                className={cn('rounded-full px-3 py-1.5 text-xs font-medium', filterStatus === v ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-muted')}
              >
                {v === 'All' ? 'All' : (STATUS_LABEL[v] ?? v)}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <p className="mb-2 text-xs font-medium tracking-wide text-subtle uppercase">Priority</p>
          <Chips
            value={filterPriority}
            onChange={setFilterPriority}
            items={[{ id: 'All', label: 'All' }, { id: 'high', label: 'High' }, { id: 'medium', label: 'Medium' }, { id: 'low', label: 'Low' }]}
          />
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1 justify-center" onClick={onReset}>Reset all</Button>
          <Button className="flex-[2] justify-center" onClick={onClose}><Check size={14} /> Apply filters</Button>
        </div>
      </div>
    </Sheet>
  );
}

/* ── Main Screen ── */
export function TasksScreen() {
  const { tenantId, activeFarmId, farms, params } = useNav();
  const { showToast } = useToast();

  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [loadError, setLoadError] = useState('');

  const [view, setView] = useState<'queue' | 'crew' | 'week'>('queue');
  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState<Partial<TaskDraft> | undefined>(undefined);
  const [weekStart, setWeekStart] = useState(() => startOfWeekMonday(new Date()));
  const [weekDay, setWeekDay] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [person, setPerson] = useState('all');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterPriority, setFilterPriority] = useState('All');

  // farm-scoped-data task: re-fetches when the active farm changes.
  const loadTasks = useCallback(async () => {
    const res = await apiClient.get<ApiTask[]>(`/api/tasks?tenantId=${tenantId}&farmId=${activeFarmId}`);
    if (res.success) { setTasks(res.data); setLoadError(''); }
    else setLoadError(res.error ?? 'Could not load tasks');
  }, [tenantId, activeFarmId]);

  useEffect(() => { loadTasks(); }, [loadTasks]);
  useEffect(() => {
    apiClient.get<Employee[]>(`/api/employees?tenantId=${tenantId}`).then(res => {
      if (res.success) setEmployees(res.data);
    });
    apiClient.get<Approver[]>(`/api/approvals/approvers?tenantId=${tenantId}`).then(res => {
      if (res.success) setApprovers(res.data);
    });
  }, [tenantId]);

  // Deep link from a notification (dashboard.tsx's handleNotifTap) or
  // anywhere else that knows a specific task id.
  useEffect(() => {
    if (!params.taskId || !tasks) return;
    const match = tasks.find(t => t.id === params.taskId);
    if (match) { setPickedId(match.id); if (isNarrowViewport()) setMobileDetailOpen(true); }
  }, [params.taskId, tasks]);

  // crops.tsx's "All Batch Tasks" / per-unit shortcuts navigate('tasks', {
  // batch, unit }) — tasks have no batch/unit column, so the best honest
  // connection is seeding the free-text search with the code (see the
  // original header note this screen carried before the redesign).
  useEffect(() => {
    if (!params.batch) return;
    setSearch(params.unit || params.batch);
  }, [params.batch, params.unit]);

  const statusFiltered = useMemo(() => {
    let ts = tasks ?? [];
    if (filterStatus !== 'All') ts = ts.filter(t => displayStatus(t) === filterStatus);
    if (filterPriority !== 'All') ts = ts.filter(t => t.priority === filterPriority);
    return ts;
  }, [tasks, filterStatus, filterPriority]);

  // Shared across Queue/Crew/Week — same "scoped" idea the reference builds
  // once in TasksPage and hands to all three views.
  const scoped = useMemo(() => {
    let ts = statusFiltered;
    if (person !== 'all') ts = ts.filter(t => t.assigneeId === person);
    if (search.trim()) {
      const q = search.toLowerCase();
      ts = ts.filter(t => t.title.toLowerCase().includes(q) || assigneeNameFor(t, employees).toLowerCase().includes(q));
    }
    return [...ts].sort((a, b) => (a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER) - (b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER));
  }, [statusFiltered, person, search, employees]);

  const groups = useMemo(() => {
    const map: Record<Bucket, ApiTask[]> = { overdue: [], today: [], upcoming: [], done: [] };
    for (const t of scoped) map[taskBucket(t)].push(t);
    return BUCKET_ORDER.map(id => ({ id, items: map[id] })).filter(g => g.items.length > 0);
  }, [scoped]);

  const peopleOptions = useMemo(() => {
    const ids = [...new Set(scoped.map(t => t.assigneeId).filter((id): id is string => !!id))];
    return [{ id: 'all', label: 'Everyone' }, ...ids.map(id => ({ id, label: (employees.find(e => e.id === id)?.name ?? 'Unknown').split(' ')[0]! }))];
  }, [scoped, employees]);

  const crew = useMemo<CrewRow[]>(() => {
    const ids = [...new Set(scoped.map(t => t.assigneeId).filter((id): id is string => !!id))];
    return ids
      .map((id) => {
        const items = scoped.filter(t => t.assigneeId === id);
        const openItems = items.filter(t => t.status !== 'DONE' && t.status !== 'REJECTED');
        const emp = employees.find(e => e.id === id);
        return { id, name: emp?.name ?? 'Unknown', role: emp?.role ?? '', open: openItems.length, late: openItems.filter(t => taskBucket(t) === 'overdue').length, items };
      })
      .sort((a, b) => b.open - a.open || b.late - a.late);
  }, [scoped, employees]);
  const maxOpen = Math.max(1, ...crew.map(c => c.open));

  // Stats stay based on the status/priority filter only — search/person are
  // "find one thing" filters, and the KPI row should keep answering "how
  // much work is there" rather than vanish because of a name typed in.
  const overdueCount = statusFiltered.filter(t => taskBucket(t) === 'overdue').length;
  const todayCount = statusFiltered.filter(t => taskBucket(t) === 'today').length;
  const upcomingCount = statusFiltered.filter(t => taskBucket(t) === 'upcoming').length;
  const openCount = statusFiltered.filter(t => t.status !== 'DONE' && t.status !== 'REJECTED').length;
  const openPeopleCount = new Set(statusFiltered.filter(t => t.status !== 'DONE' && t.status !== 'REJECTED' && t.assigneeId).map(t => t.assigneeId)).size;

  const flat = scoped;
  const picked = flat.find(t => t.id === pickedId) ?? null;

  const activeFilters = [filterStatus !== 'All', filterPriority !== 'All'].filter(Boolean).length;

  function pick(task: ApiTask) {
    setPickedId(task.id);
    if (isNarrowViewport()) setMobileDetailOpen(true);
  }

  async function createTask(payload: TaskDraft): Promise<string | null> {
    const dueAt = payload.dueDate ? new Date(`${payload.dueDate}T${payload.dueTime || '00:00'}`).toISOString() : undefined;
    const res = await apiClient.post<ApiTask>('/api/tasks', {
      tenantId,
      title: payload.title,
      dueAt,
      priority: payload.priority,
      requiresApproval: payload.requiresApproval,
      notes: payload.notes.trim() || undefined,
      farmId: payload.farmId || undefined,
      assigneeId: payload.assigneeId || undefined,
      approverId: payload.requiresApproval && payload.approverId ? payload.approverId : undefined,
      recurrence: payload.recurrence,
      recurrenceUntil: payload.recurrenceUntil ? new Date(`${payload.recurrenceUntil}T23:59`).toISOString() : undefined,
    });
    if (!res.success) return res.error ?? 'Could not create task';
    showToast(payload.recurrence === 'none' ? 'Task created' : `Task created — repeats ${RECURRENCE_LABEL[payload.recurrence].toLowerCase()}`, 'success');
    await loadTasks();
    return null;
  }

  async function updateTask(task: ApiTask, patch: Record<string, unknown>): Promise<string | null> {
    const res = await apiClient.patch<ApiTask>(`/api/tasks/${task.id}?tenantId=${tenantId}`, patch);
    if (!res.success) return res.error ?? 'Could not update task';
    await loadTasks();
    return null;
  }

  async function markDone(task: ApiTask) {
    const res = await apiClient.patch<ApiTask & { approvalRequestId?: string; nextOccurrenceDueAt?: string }>(`/api/tasks/${task.id}?tenantId=${tenantId}`, { status: 'DONE' });
    if (!res.success) { showToast(res.error ?? 'Could not update task', 'error'); return; }
    if (res.data.approvalRequestId) {
      const approver = approvers.find(a => a.userId === task.approverId);
      showToast(approver ? `Sent to ${approver.name} for approval` : 'Submitted for approval', 'info');
    } else {
      showToast(res.data.nextOccurrenceDueAt
        ? `Done — next one due ${fmtDueAt(res.data.nextOccurrenceDueAt)}`
        : 'Task marked as done', 'success');
    }
    await loadTasks();
  }

  async function deleteTask(task: ApiTask) {
    const res = await apiClient.delete(`/api/tasks/${task.id}?tenantId=${tenantId}`);
    if (!res.success) { showToast(res.error ?? 'Could not delete task', 'error'); return; }
    showToast('Task deleted', 'success');
    setPickedId(current => (current === task.id ? null : current));
    setMobileDetailOpen(false);
    await loadTasks();
  }

  function resetFilters() { setFilterStatus('All'); setFilterPriority('All'); }

  return (
    <div className="screen-content">
      <TopNav title="" />
      <div className="px-screen pt-3 pb-24">
        {loadError && (
          <div className="mb-3 flex items-center gap-1.5 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            <AlertTriangle size={13} /> {loadError}
          </div>
        )}

        <PageHeader
          kicker="Daily"
          title="Tasks"
          lede="Who is carrying what, and by when. The queue is for the day. Crew is for load. Week is for the days ahead."
          actions={<Button onClick={() => setShowAdd(true)}><Plus size={14} /> Assign work</Button>}
        />

        <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi label="Overdue" value={overdueCount} hint={overdueCount ? 'Still open past due' : 'Queue is clear'} tone={overdueCount ? 'warn' : 'ok'} onClick={() => setView('queue')} />
          <Kpi label="Today" value={todayCount} hint={new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} onClick={() => setView('queue')} />
          <Kpi label="Coming" value={upcomingCount} hint="After today" onClick={() => setView('queue')} />
          <Kpi label="On the crew" value={openCount} hint={`${openPeopleCount} people with open work`} onClick={() => setView('crew')} />
        </div>

        <div className="mt-5">
          <Segmented
            value={view}
            onChange={setView}
            items={[
              { id: 'queue', label: 'Queue', hint: 'By when it is due' },
              { id: 'crew', label: 'Crew', hint: 'Who is carrying it' },
              { id: 'week', label: 'Week', hint: 'Load on the days' },
            ]}
          />
        </div>

        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1">
          <Button variant="secondary" size="icon-sm" aria-label="Refresh" onClick={() => loadTasks()}><RefreshCw size={14} /></Button>
          <Button variant="secondary" size="icon-sm" aria-label="Export tasks to CSV" onClick={() => exportTaskCSV(scoped)}><Download size={14} /></Button>
          <Button variant={activeFilters > 0 ? 'default' : 'secondary'} size="sm" onClick={() => setShowFilter(true)}>
            <Filter size={13} /> Filters {activeFilters > 0 && `(${activeFilters})`}
          </Button>
          {activeFilters > 0 && <Button variant="ghost" size="sm" onClick={resetFilters}>Clear</Button>}
        </div>

        <div className="mt-5">
          {tasks === null ? (
            <p className="py-10 text-center text-sm text-muted">Loading tasks…</p>
          ) : view === 'queue' ? (
            <Queue
              groups={groups} employees={employees} approvers={approvers}
              search={search} onSearch={setSearch} peopleOptions={peopleOptions} person={person} onPerson={setPerson}
              picked={picked} onPick={pick}
              onDone={markDone} onDelete={deleteTask} onUpdate={updateTask}
              onScheduleAgain={(draft) => { setAddDraft(draft); setShowAdd(true); }}
            />
          ) : view === 'crew' ? (
            <Crew crew={crew} employees={employees} maxOpen={maxOpen} picked={picked} onPick={pick} />
          ) : (
            <Week
              tasks={scoped}
              employees={employees}
              approvers={approvers}
              weekStart={weekStart}
              onWeekChange={setWeekStart}
              day={weekDay}
              onDay={setWeekDay}
              picked={picked}
              onPick={pick}
              onAddOn={(isoDate) => { setAddDraft({ dueDate: isoDate }); setShowAdd(true); }}
              onDone={markDone} onDelete={deleteTask} onUpdate={updateTask}
              onScheduleAgain={(draft) => { setAddDraft(draft); setShowAdd(true); }}
            />
          )}
        </div>
      </div>

      {showAdd && (
        <AddTaskSheet
          employees={employees} farms={farms} activeFarmId={activeFarmId}
          approvers={approvers} initial={addDraft}
          onClose={() => { setShowAdd(false); setAddDraft(undefined); }}
          onCreate={createTask}
        />
      )}
      {showFilter && (
        <FilterSheet
          filterStatus={filterStatus} setFilterStatus={setFilterStatus}
          filterPriority={filterPriority} setFilterPriority={setFilterPriority}
          onClose={() => setShowFilter(false)}
          onReset={resetFilters}
        />
      )}
      {picked && (
        <TaskDetailPanel
          as="inspector"
          open={mobileDetailOpen}
          onOpenChange={setMobileDetailOpen}
          task={picked}
          employees={employees}
          approvers={approvers}
          onDone={markDone}
          onDelete={deleteTask}
          onUpdate={updateTask}
          onScheduleAgain={(draft) => { setMobileDetailOpen(false); setAddDraft(draft); setShowAdd(true); }}
        />
      )}
    </div>
  );
}
