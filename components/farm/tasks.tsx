'use client';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNav, TopNav } from './navigation';
import {
  Plus, CheckCircle2, Clock, AlertTriangle, Users,
  X, Check, Filter, RefreshCw, ShieldCheck,
  Trash2, ChevronDown, ChevronUp, Download, FileText,
  ChevronLeft, ChevronRight, Calendar, List,
} from './icons';
import { apiClient } from '@/lib/request';
import { useToast } from './ui-shared';
import { StatusTimeline } from './status-timeline';
import { SearchBar } from './ui-shared';

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
// (the + button, a calendar day, "schedule again" on a finished task) fills
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

export const PRIORITY_COLOR: Record<string, string> = {
  high: 'var(--status-critical)', medium: 'var(--status-warning)', low: 'var(--text-muted)',
};

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

/* ── Task Detail Sheet ── */
function TaskDetailSheet({
  task, employees, approvers, onClose, onDone, onDelete, onUpdate, onScheduleAgain,
}: {
  task: ApiTask;
  employees: Employee[];
  approvers: Approver[];
  onClose: () => void;
  onDone: (task: ApiTask) => void;
  onDelete: (task: ApiTask) => void;
  onUpdate: (task: ApiTask, patch: Record<string, unknown>) => Promise<string | null>;
  onScheduleAgain: (draft: Partial<TaskDraft>) => void;
}) {
  const { rest } = splitNotes(task.notes);
  const assignee = assigneeNameFor(task, employees);
  const status = displayStatus(task);
  const finished = task.status === 'DONE' || task.status === 'REJECTED';

  // Reassignment happens in place rather than through a separate edit
  // screen: "who is doing this" is the field that changes most, and on a
  // finished task it is the whole reason for opening it again.
  const [editing, setEditing] = useState(false);
  const [draftAssignee, setDraftAssignee] = useState(task.assigneeId ?? '');
  const [draftApprover, setDraftApprover] = useState(task.approverId ?? '');
  const [draftDue, setDraftDue] = useState(task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 16) : '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const approverName = task.approverId
    ? approvers.find(a => a.userId === task.approverId)?.name ?? 'Someone no longer on this farm'
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

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '22px 22px 0 0', width: '100%', maxHeight: '92%', overflowY: 'auto', border: '1px solid var(--border-subtle)', padding: 20 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div style={{ flex: 1, marginRight: 8 }}>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, lineHeight: 1.3, color: 'var(--text-primary)', marginBottom: 4 }}>{task.title}</div>
            <span className={`chip ${statusChipClass(status)}`} style={{ fontSize: 'var(--fs-2xs)' }}>{STATUS_LABEL[status] ?? status}</span>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              ['Assigned To', assignee || 'Unassigned', 'var(--text-secondary)'],
              ['Due', fmtDueAt(task.dueAt), status === 'OVERDUE' ? 'var(--status-critical)' : 'var(--text-secondary)'],
              ['Priority', task.priority, PRIORITY_COLOR[task.priority]],
              ['Repeats', RECURRENCE_LABEL[task.recurrence ?? 'none'] ?? 'Does not repeat', 'var(--text-secondary)'],
            ].map(([k, v, c]) => (
              <div key={k}>
                <div style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{k}</div>
                <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: c }}>{v}</div>
              </div>
            ))}
          </div>
          {task.requiresApproval && (
            <div style={{ marginTop: 10, padding: '7px 10px', background: 'rgba(251,191,36,0.08)', borderRadius: 8, border: '1px solid rgba(251,191,36,0.25)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldCheck size={12} color="var(--accent-amber)" />
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent-amber)', fontWeight: 600 }}>
                {task.approverId ? `${approverName} approves this before it counts as done` : 'Needs approval before it counts as done'}
              </span>
            </div>
          )}
          {task.recurrenceParentId && (
            <div style={{ marginTop: 8, fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)' }}>
              Created automatically when the previous one was completed.
            </div>
          )}
          {rest && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 10, padding: '8px 10px', background: 'var(--card)', borderRadius: 8, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              <FileText size={13} style={{ flexShrink: 0, marginTop: 3 }} aria-hidden="true" /> {rest}
            </div>
          )}
        </div>

        {editing && (
          <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="section-eyebrow" style={{ marginBottom: 8 }}>Change who and when</div>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Assigned to</label>
            <select className="farm-input" value={draftAssignee} onChange={e => setDraftAssignee(e.target.value)} style={{ marginBottom: 10 }}>
              <option value="">Unassigned</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.role})</option>)}
            </select>

            {task.requiresApproval && (
              <>
                <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Approved by</label>
                <select className="farm-input" value={draftApprover} onChange={e => setDraftApprover(e.target.value)} style={{ marginBottom: 10 }}>
                  <option value="">Anyone who can approve</option>
                  {approvers.map(a => <option key={a.userId} value={a.userId}>{a.name} ({a.role})</option>)}
                </select>
              </>
            )}

            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Due</label>
            <input className="farm-input" type="datetime-local" value={draftDue} onChange={e => setDraftDue(e.target.value)} style={{ marginBottom: 10 }} />

            {saveError && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 8 }}>{saveError}</div>}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" onClick={() => { setEditing(false); setSaveError(''); }} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
              <button className="btn-primary" onClick={saveEdits} disabled={saving} style={{ flex: 1, justifyContent: 'center' }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* A finished task used to be a dead end: you could look at it and
             nothing else. Doing the same job again is the commonest thing an
             owner wants from one, so it opens the create sheet prefilled from
             this task rather than making them retype it. */}
          {finished && (
            <button
              onClick={() => onScheduleAgain({
                title: task.title,
                assigneeId: task.assigneeId ?? '',
                approverId: task.approverId ?? '',
                priority: task.priority,
                requiresApproval: task.requiresApproval,
                notes: rest,
                farmId: task.farmId ?? '',
              })}
              style={{ flex: 1, minWidth: 150, padding: '11px', borderRadius: 10, fontSize: 'var(--fs-base)', fontWeight: 700, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.35)', color: 'var(--primary-green)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <RefreshCw size={13} /> Schedule again
            </button>
          )}
          {!editing && (
            <button onClick={() => setEditing(true)} style={{ padding: '11px 14px', borderRadius: 10, fontSize: 'var(--fs-sm)', fontWeight: 700, background: 'var(--card)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {finished ? 'Reassign' : 'Reassign / reschedule'}
            </button>
          )}
          {task.status !== 'DONE' && task.status !== 'PENDING_APPROVAL' && (
            <button onClick={() => { onDone(task); onClose(); }} style={{ flex: 1, padding: '11px', borderRadius: 10, fontSize: 'var(--fs-base)', fontWeight: 700, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.35)', color: 'var(--primary-green)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Check size={14} /> Mark Done
            </button>
          )}
          {task.status !== 'DONE' && (
            <button onClick={() => { onDelete(task); onClose(); }} style={{ padding: '11px 14px', borderRadius: 10, fontSize: 'var(--fs-sm)', fontWeight: 700, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: 'var(--status-critical)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Trash2 size={13} />
            </button>
          )}
          <button onClick={onClose} style={{ padding: '11px 16px', borderRadius: 10, fontSize: 'var(--fs-sm)', fontWeight: 700, background: 'var(--card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer' }}>Close</button>
        </div>

        <StatusTimeline tenantId={task.tenantId} entity="task" entityId={task.id} />
      </div>
    </div>
  );
}

/* ── Task Card ── */
function TaskCard({ task, employees, onOpen }: { task: ApiTask; employees: Employee[]; onOpen: (task: ApiTask) => void }) {
  const assignee = assigneeNameFor(task, employees);
  const status = displayStatus(task);

  return (
    <div
      className="farm-card"
      style={{ padding: 14, borderLeft: `3px solid ${status === 'OVERDUE' ? 'var(--status-critical)' : status === 'DONE' ? 'var(--status-ok)' : PRIORITY_COLOR[task.priority]}`, cursor: 'pointer' }}
      onClick={() => onOpen(task)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, lineHeight: 1.3, color: task.status === 'DONE' ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: task.status === 'DONE' ? 'line-through' : 'none', flex: 1, marginRight: 8 }}>
          {task.title}
        </div>
        <span className={`chip ${statusChipClass(status)}`} style={{ fontSize: 'var(--fs-2xs)', flexShrink: 0 }}>{STATUS_LABEL[status] ?? status}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Users size={11} color="var(--text-muted)" />
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{assignee || 'Unassigned'}</span>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Clock size={11} color={status === 'OVERDUE' ? 'var(--status-critical)' : 'var(--text-muted)'} />
          <span style={{ fontSize: 'var(--fs-xs)', color: status === 'OVERDUE' ? 'var(--status-critical)' : 'var(--text-muted)' }}>{fmtDueAt(task.dueAt)}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--fs-2xs)', padding: '2px 7px', borderRadius: 100, background: 'rgba(255,255,255,0.05)', color: PRIORITY_COLOR[task.priority], border: '1px solid var(--border-subtle)', textTransform: 'capitalize' }}>{task.priority}</span>
        {task.requiresApproval && <span style={{ fontSize: 'var(--fs-2xs)', padding: '2px 6px', borderRadius: 100, background: 'rgba(251,191,36,0.1)', color: 'var(--accent-amber)', border: '1px solid rgba(251,191,36,0.3)' }}><ShieldCheck size={9} style={{ verticalAlign: 'middle', marginRight: 2 }} />Approval</span>}
      </div>
    </div>
  );
}

/* ── Add Task Sheet ── */
function AddTaskSheet({ employees, farms, activeFarmId, approvers, initial, onClose, onCreate }: {
  employees: Employee[];
  // farm-scoped-data task: defaults to the shell's active farm; a task can
  // also legitimately have NO farm (a tenant-level task, e.g. "renew
  // business license" — see POST /api/tasks's header) so, unlike the
  // purchase/lot forms, this picker is never forced to a value.
  farms: { id: string; name: string }[];
  activeFarmId: string;
  approvers: Approver[];
  // Prefilled when the sheet is opened from a calendar day or from "schedule
  // again" on a finished task, so the user isn't retyping what they just
  // clicked on.
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
    // The server refuses this too — saying it here saves a round trip and
    // explains WHY, which a bare 400 in a toast doesn't.
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
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '24px 24px 0 0', padding: 20, width: '100%', maxHeight: '90%', overflowY: 'auto', border: '1px solid var(--border-subtle)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>New Task</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Task Title *</label>
          <input className="farm-input" value={title} onChange={e => { setTitle(e.target.value); setError(''); }} placeholder="e.g. Morning feeding — House A1" />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Farm</label>
          <select className="farm-input" value={farmId} onChange={e => setFarmId(e.target.value)}>
            <option value="">No specific farm (tenant-wide)</option>
            {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Assign To</label>
          <select className="farm-input" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.role})</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Repeats</label>
          <select className="farm-input" value={recurrence} onChange={e => setRecurrence(e.target.value)}>
            {Object.entries(RECURRENCE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {recurrence !== 'none' && (
            <div style={{ marginTop: 8 }}>
              <label style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600, display: 'block', marginBottom: 3 }}>Stop repeating after (optional)</label>
              <input className="farm-input" type="date" value={recurrenceUntil} onChange={e => setRecurrenceUntil(e.target.value)} />
              <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                The next one is created when this one is completed — so a chore that nobody does doesn&apos;t quietly pile up unfinished copies.
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Due Date</label>
            <input className="farm-input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Due Time</label>
            <input className="farm-input" type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Priority</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['high', 'medium', 'low'] as const).map(p => (
              <button key={p} onClick={() => setPriority(p)} style={{ flex: 1, padding: '8px', borderRadius: 8, fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'pointer', background: priority === p ? `${PRIORITY_COLOR[p]}20` : 'var(--card)', border: priority === p ? `1px solid ${PRIORITY_COLOR[p]}60` : '1px solid var(--border-subtle)', color: priority === p ? PRIORITY_COLOR[p] : 'var(--text-muted)', textTransform: 'capitalize' }}>{p}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14, padding: '12px 14px', background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)' }}>Needs approval</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>The assignee submits it for review instead of marking it done</div>
            </div>
            <button onClick={() => setRequiresApproval(x => !x)} style={{ width: 44, height: 24, borderRadius: 100, cursor: 'pointer', border: 'none', background: requiresApproval ? 'var(--primary-green)' : 'var(--border-subtle)', position: 'relative', flexShrink: 0 }}>
              <div style={{ position: 'absolute', top: 2, left: requiresApproval ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: 'white', transition: 'left 0.15s' }} />
            </button>
          </div>

          {/* Naming the approver is what turns "anyone with governance
             rights" into one person's queue. Left blank it behaves exactly
             as before, which is what every task created until now did. */}
          {requiresApproval && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Who approves it</label>
              <select className="farm-input" value={approverId} onChange={e => setApproverId(e.target.value)}>
                <option value="">Anyone who can approve</option>
                {approvers.map(a => <option key={a.userId} value={a.userId}>{a.name} ({a.role})</option>)}
              </select>
              <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                {approverId
                  ? 'Only this person sees it in their approvals queue and can sign it off. The owner can step in if they are unavailable.'
                  : 'It goes to everyone who can approve, and any of them can sign it off.'}
              </div>
              {approvers.length === 0 && (
                <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--status-warning)', marginTop: 6, lineHeight: 1.5 }}>
                  Nobody on this farm can approve yet — a person needs a login and a role with governance access.
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Notes / Instructions</label>
          <textarea className="farm-input" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Instructions for the assignee…" style={{ resize: 'none' }} />
        </div>

        {error && <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 10 }}><AlertTriangle size={11} aria-hidden="true" /> {error}</div>}

        <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={submit} disabled={saving}>
          <Check size={14} /> {saving ? 'Creating…' : 'Create Task'}
        </button>
      </div>
    </div>
  );
}

/* ── Filter Sheet ── */
function FilterSheet({
  filterStatus, setFilterStatus, filterPriority, setFilterPriority, onClose, onReset,
}: {
  filterStatus: string; setFilterStatus: (v: string) => void;
  filterPriority: string; setFilterPriority: (v: string) => void;
  onClose: () => void; onReset: () => void;
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '22px 22px 0 0', width: '100%', maxHeight: '80%', overflowY: 'auto', padding: 20, border: '1px solid var(--border-subtle)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>Filter Tasks</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase' }}>Status</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['All', 'PENDING', 'OVERDUE', 'PENDING_APPROVAL', 'DONE', 'REJECTED'].map(v => (
              <button key={v} onClick={() => setFilterStatus(v)} style={{ padding: '6px 12px', borderRadius: 100, fontSize: 'var(--fs-xs)', fontWeight: 700, cursor: 'pointer', background: filterStatus === v ? 'rgba(74,222,128,0.15)' : 'var(--card)', border: filterStatus === v ? '1px solid rgba(74,222,128,0.5)' : '1px solid var(--border-subtle)', color: filterStatus === v ? 'var(--primary-green)' : 'var(--text-muted)' }}>{STATUS_LABEL[v] ?? v}</button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase' }}>Priority</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['All', 'high', 'medium', 'low'].map(v => (
              <button key={v} onClick={() => setFilterPriority(v)} style={{ flex: 1, padding: '7px', borderRadius: 100, fontSize: 'var(--fs-xs)', fontWeight: 700, cursor: 'pointer', background: filterPriority === v ? 'rgba(74,222,128,0.15)' : 'var(--card)', border: filterPriority === v ? '1px solid rgba(74,222,128,0.5)' : '1px solid var(--border-subtle)', color: filterPriority === v ? 'var(--primary-green)' : 'var(--text-muted)', textTransform: 'capitalize' }}>{v}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onReset} style={{ flex: 1, padding: '11px', borderRadius: 12, background: 'var(--card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontWeight: 700, fontSize: 'var(--fs-base)', cursor: 'pointer' }}>Reset All</button>
          <button onClick={onClose} className="btn-primary" style={{ flex: 2, justifyContent: 'center' }}>
            <Check size={14} /> Apply Filters
          </button>
        </div>
      </div>
    </div>
  );
}


/* ── Schedule calendar ─────────────────────────────────────────────────────
 * The question this answers is the one a list cannot: not "what is on this
 * task" but "when is nobody doing anything". A farm's problem is rarely a
 * single forgotten job — it is a week with no feeding scheduled that nobody
 * noticed until the week arrived. So empty upcoming days are drawn as
 * something missing rather than as blank space, and counted in a line above
 * the grid.
 *
 * Built from the tasks already loaded for the current farm filter rather
 * than a second fetch: the list and the calendar must never disagree about
 * what is scheduled, and a month is a small slice of an already-small set. */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function TaskCalendar({ tasks, employees, month, onMonthChange, onOpenTask, onAddOn }: {
  tasks: ApiTask[];
  employees: Employee[];
  month: Date;
  onMonthChange: (next: Date) => void;
  onOpenTask: (task: ApiTask) => void;
  onAddOn: (isoDate: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<string, ApiTask[]>();
    for (const t of tasks) {
      if (!t.dueAt) continue;
      const key = ymd(new Date(t.dueAt));
      const list = map.get(key);
      if (list) list.push(t); else map.set(key, [t]);
    }
    return map;
  }, [tasks]);

  // A Monday-first grid: JS getDay() is Sunday-0, and a farm week that
  // starts on Sunday reads wrong here.
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: (Date | null)[] = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(month.getFullYear(), month.getMonth(), d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [month]);

  const todayKey = ymd(new Date());
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // Only days still ahead count as "nothing scheduled" — an empty day last
  // week is history, not a gap you can still fill.
  const upcomingEmpty = cells.filter((d) => d && d >= startOfToday && !byDay.has(ymd(d))).length;

  const selectedTasks = selected ? (byDay.get(selected) ?? []) : [];

  return (
    <div style={{ paddingBottom: 80 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button className="btn-icon" aria-label="Previous month" onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={16} /></button>
        <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)' }}>
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </div>
        <button className="btn-icon" aria-label="Next month" onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={16} /></button>
      </div>

      <div style={{ fontSize: 'var(--fs-xs)', color: upcomingEmpty > 0 ? 'var(--status-warning)' : 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
        {upcomingEmpty > 0
          ? `${upcomingEmpty} upcoming day${upcomingEmpty === 1 ? '' : 's'} with nothing scheduled — tap one to plan work for it.`
          : 'Every remaining day this month has work scheduled.'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ textAlign: 'center', fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>{w}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`pad-${i}`} />;
          const key = ymd(day);
          const dayTasks = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isPast = day < startOfToday;
          const emptyUpcoming = dayTasks.length === 0 && !isPast;
          const overdueHere = dayTasks.some((t) => displayStatus(t) === 'OVERDUE');
          return (
            <button
              key={key}
              onClick={() => setSelected(selected === key ? null : key)}
              style={{
                minHeight: 58, padding: 4, borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                background: selected === key ? 'rgba(74,222,128,0.12)' : emptyUpcoming ? 'transparent' : 'var(--card)',
                border: selected === key
                  ? '1px solid var(--primary-green)'
                  : emptyUpcoming
                    ? '1px dashed var(--border-subtle)'
                    : '1px solid var(--border-subtle)',
                opacity: isPast && dayTasks.length === 0 ? 0.45 : 1,
                display: 'flex', flexDirection: 'column', gap: 2,
              }}
            >
              <span style={{
                fontSize: 'var(--fs-2xs)', fontWeight: isToday ? 800 : 600,
                color: isToday ? 'var(--primary-green)' : 'var(--text-muted)',
              }}>{day.getDate()}</span>
              {dayTasks.slice(0, 2).map((t) => (
                <span key={t.id} style={{
                  fontSize: 'var(--fs-2xs)', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: displayStatus(t) === 'DONE' ? 'var(--text-dim)' : PRIORITY_COLOR[t.priority],
                }}>{t.title}</span>
              ))}
              {dayTasks.length > 2 && (
                <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)' }}>+{dayTasks.length - 2} more</span>
              )}
              {overdueHere && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--status-critical)' }} />}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="farm-card" style={{ padding: 14, marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700 }}>
              {new Date(`${selected}T12:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            <button className="btn-primary" style={{ padding: '6px 10px', fontSize: 'var(--fs-xs)' }} onClick={() => onAddOn(selected)}>
              <Plus size={12} /> Add
            </button>
          </div>
          {selectedTasks.length === 0 ? (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Nothing scheduled. If work happens on this day, it isn&apos;t written down anywhere.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {selectedTasks.map((t) => <TaskCard key={t.id} task={t} employees={employees} onOpen={onOpenTask} />)}
            </div>
          )}
        </div>
      )}
    </div>
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

  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [showAdd, setShowAdd] = useState(false);
  // Prefill for the create sheet — set when it's opened from a calendar day
  // or from "schedule again" on a finished task.
  const [addDraft, setAddDraft] = useState<Partial<TaskDraft> | undefined>(undefined);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [showFilter, setShowFilter] = useState(false);
  const [openTask, setOpenTask] = useState<ApiTask | null>(null);

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterPriority, setFilterPriority] = useState('All');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // farm-scoped-data task: re-fetches when the active farm changes.
  // tasks.farmId is a direct column (migration 0019) — see GET /api/tasks's
  // header for why a tenant-level task (farmId IS NULL) only shows under
  // 'ALL', not folded into every farm's filtered view.
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
  // anywhere else that knows a specific task id: navigate('tasks', { taskId })
  // used to land on this screen's unfiltered list with no way to tell which
  // task the tap was actually about. Once the list has loaded, open that
  // task's existing detail sheet the same way clicking its row would.
  useEffect(() => {
    if (!params.taskId || !tasks) return;
    const match = tasks.find(t => t.id === params.taskId);
    if (match) setOpenTask(match);
  }, [params.taskId, tasks]);

  // crops.tsx's "All Batch Tasks" / per-unit shortcuts navigate('tasks', {
  // batch, unit }) — tasks have no batch/unit column (see ApiTask's header:
  // "no code/type/batch/unit/GPS/photo"), so there is no real relational
  // filter to apply here, and pretending otherwise would be exactly the kind
  // of fake affordance this codebase avoids elsewhere (see e.g. the removed
  // "Sync Now" in settings.tsx). Best honest connection available: seed the
  // free-text search with the batch/unit code, since a task made for that
  // batch is likely to name it in its title — a real (if partial) text
  // match, not the scoped list the button used to silently fail to produce.
  useEffect(() => {
    if (!params.batch) return;
    // Unit is more specific than batch when both are present (the per-unit
    // shortcut) — a single substring match, so combining them would require
    // both codes verbatim in one title, which is less likely to match than
    // just the more specific one.
    setSearch(params.unit || params.batch);
  }, [params.batch, params.unit]);

  const activeFilters = [filterStatus !== 'All', filterPriority !== 'All'].filter(Boolean).length;

  const filtered = useMemo(() => {
    let ts = tasks ?? [];
    if (search) {
      const q = search.toLowerCase();
      ts = ts.filter(t => t.title.toLowerCase().includes(q) || assigneeNameFor(t, employees).toLowerCase().includes(q));
    }
    if (filterStatus !== 'All') ts = ts.filter(t => displayStatus(t) === filterStatus);
    if (filterPriority !== 'All') ts = ts.filter(t => t.priority === filterPriority);
    ts = [...ts].sort((a, b) => {
      const av = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bv = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return ts;
  }, [tasks, search, filterStatus, filterPriority, sortDir, employees]);

  const all = tasks ?? [];
  const overdue = all.filter(t => displayStatus(t) === 'OVERDUE').length;
  const pending = all.filter(t => t.status === 'PENDING').length;
  const done = all.filter(t => t.status === 'DONE').length;
  const completionPct = all.length > 0 ? Math.round((done / all.length) * 100) : 0;

  // Returns the server's own message on failure so the sheet can show WHY
  // next to the field, instead of a generic "please try again" that hides a
  // perfectly clear 400.
  async function createTask(payload: TaskDraft): Promise<string | null> {
    const dueAt = payload.dueDate ? new Date(`${payload.dueDate}T${payload.dueTime || '00:00'}`).toISOString() : undefined;
    const res = await apiClient.post<ApiTask>('/api/tasks', {
      tenantId,
      title: payload.title,
      dueAt,
      priority: payload.priority,
      requiresApproval: payload.requiresApproval,
      // The assignee is a real column now; notes carry only notes.
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

  // Reassigning, rescheduling or changing the approver from the detail
  // sheet — including on a task that is already finished, which is where
  // "do this one again, and let Peter do it this time" starts.
  async function updateTask(task: ApiTask, patch: Record<string, unknown>): Promise<string | null> {
    const res = await apiClient.patch<ApiTask>(`/api/tasks/${task.id}?tenantId=${tenantId}`, patch);
    if (!res.success) return res.error ?? 'Could not update task';
    await loadTasks();
    setOpenTask((current) => (current && current.id === task.id ? res.data : current));
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
    await loadTasks();
  }

  function resetFilters() { setFilterStatus('All'); setFilterPriority('All'); setSearch(''); }

  return (
    <div className="screen-content">
      <TopNav
        title="Tasks"
        subtitle={`${filtered.length} shown${activeFilters > 0 ? ` · ${activeFilters} filter${activeFilters > 1 ? 's' : ''}` : ''}`}
        rightEl={
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => loadTasks()} style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} title="Refresh">
              <RefreshCw size={13} color="var(--text-muted)" />
            </button>
            <button onClick={() => exportTaskCSV(filtered)} style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} title="Export tasks to CSV">
              <Download size={14} color="var(--text-muted)" />
            </button>
            <button className="btn-fab" style={{ width: 36, height: 36, borderRadius: 10 }} onClick={() => setShowAdd(true)}>
              <Plus size={16} />
            </button>
          </div>
        }
      />

      <div className="px-screen" style={{ paddingTop: 12 }}>
        {loadError && (
          <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 12, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={13} /> {loadError}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[
            { label: 'Overdue', value: overdue, color: 'var(--status-critical)', bg: 'rgba(248,113,113,0.1)' },
            { label: 'Pending', value: pending, color: 'var(--status-warning)', bg: 'rgba(251,191,36,0.1)' },
            { label: 'Done', value: done, color: 'var(--status-ok)', bg: 'rgba(74,222,128,0.1)' },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, background: s.bg, borderRadius: 12, padding: '12px 8px', textAlign: 'center', border: `1px solid ${s.color}30` }}>
              <div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Completion</span>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>{completionPct}%</span>
          </div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${completionPct}%` }} /></div>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {([['list', 'List', List], ['calendar', 'Schedule', Calendar]] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              onClick={() => setView(value)}
              style={{
                flex: 1, padding: '8px', borderRadius: 10, fontSize: 'var(--fs-sm)', fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: view === value ? 'rgba(74,222,128,0.12)' : 'var(--card)',
                border: view === value ? '1px solid rgba(74,222,128,0.4)' : '1px solid var(--border-subtle)',
                color: view === value ? 'var(--primary-green)' : 'var(--text-muted)',
              }}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {view === 'list' && <SearchBar value={search} onChange={setSearch} placeholder="Search tasks, assignees…" />}

        {view === 'calendar' ? (
          <TaskCalendar
            tasks={tasks ?? []}
            employees={employees}
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            onOpenTask={setOpenTask}
            onAddOn={(isoDate) => { setAddDraft({ dueDate: isoDate }); setShowAdd(true); }}
          />
        ) : (
        <>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <button onClick={() => setShowFilter(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, fontSize: 'var(--fs-sm)', fontWeight: 700, cursor: 'pointer', background: activeFilters > 0 ? 'rgba(74,222,128,0.12)' : 'var(--card)', border: activeFilters > 0 ? '1px solid rgba(74,222,128,0.4)' : '1px solid var(--border-subtle)', color: activeFilters > 0 ? 'var(--primary-green)' : 'var(--text-muted)', flexShrink: 0 }}>
            <Filter size={13} /> Filters {activeFilters > 0 && `(${activeFilters})`}
          </button>
          <button onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 12px', borderRadius: 10, fontSize: 'var(--fs-xs)', fontWeight: 700, cursor: 'pointer', background: 'var(--card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
            Due {sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {activeFilters > 0 && (
            <button onClick={resetFilters} style={{ flexShrink: 0, padding: '6px 10px', borderRadius: 8, fontSize: 'var(--fs-2xs)', fontWeight: 700, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', color: 'var(--status-critical)', cursor: 'pointer' }}>Clear</button>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 80 }}>
          {tasks === null ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 'var(--fs-base)' }}>Loading tasks…</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              <CheckCircle2 size={32} style={{ marginBottom: 10, opacity: 0.4 }} />
              <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>No tasks match your filters</div>
              <button onClick={resetFilters} style={{ marginTop: 12, padding: '8px 16px', borderRadius: 10, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', color: 'var(--primary-green)', fontWeight: 700, fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>Clear Filters</button>
            </div>
          ) : (
            filtered.map(t => <TaskCard key={t.id} task={t} employees={employees} onOpen={setOpenTask} />)
          )}
        </div>
        </>
        )}
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
      {openTask && (
        <TaskDetailSheet
          task={openTask}
          employees={employees}
          approvers={approvers}
          onClose={() => setOpenTask(null)}
          onDone={markDone}
          onDelete={deleteTask}
          onUpdate={updateTask}
          onScheduleAgain={(draft) => { setOpenTask(null); setAddDraft(draft); setShowAdd(true); }}
        />
      )}
    </div>
  );
}
