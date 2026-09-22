'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNav, TopNav, requestLogout } from './navigation';
import { useToast } from './ui-shared';
import { apiClient } from '@/lib/request';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui-kit/button';
import { Badge } from '@/components/ui-kit/badge';
import { Input } from '@/components/ui-kit/input';
import { EmptyState } from '@/components/ui-kit/empty-state';
import { controlClass } from '@/components/ui-kit/field';
import { Dialog, DialogTitle, DialogDescription } from '@/components/ui-kit/dialog';
import {
  Plus, Camera, X,
  ChevronRight, Wifi, Check, Lock, ClipboardList, DollarSign, Calendar,
  Wheat, AlertTriangle, Hash, Sunrise, Egg, Syringe, Scale, Package, Layers,
  ArrowRight, CheckCircle2,
  type LucideIcon,
} from './icons';
import { formatMoney } from '@/lib/money';
import {
  splitNotes, displayStatus,
  type ApiTask,
} from './tasks';
import {
  OTHER_OPTION, MORTALITY_CAUSES, HEALTH_TREATMENTS, DOSE_UNITS, formatDose,
} from '@/lib/record-vocabulary';
import {
  BYPASS_ROLES, DEFAULT_MATRIX, DEFAULT_APPROVAL, RECORD_TYPE_MODULES, type AccessLevel,
} from '@/lib/permission-matrix';
import { MAX_RECORD_PHOTOS, firstInvalidPhoto } from '@/lib/record-photos';
import { compressImageFile } from '@/lib/image-compress';

// ── Real API shapes (issue #248) ────────────────────────────────────────────
// Wired to GET /api/employees/me and GET/POST /api/records (issue #247).
// Replaces the old hardcoded task-list mock and the hardcoded `count >= 3`
// mortality gate — the photo threshold now comes from the worker's real
// employees row.
interface ApiEmployeeMe {
  id: string;
  tenantId: string;
  userId: string | null;
  name: string;
  phone: string;
  role: string;
  assignedBatchIds: string[];
  mortalityPhotoThreshold: number;
  status: string;
}

interface ApiBatch {
  id: string;
  code: string;
  name: string;
  currentQty: number;
}

interface ApiRecord {
  id: string;
  tenantId: string;
  batchId: string;
  employeeId: string;
  type: string;
  data: Record<string, unknown>;
  photoUrl: string | null;
  photoUrls: string[];
  createdAt: string | null;
}

// GET /api/payroll/me's row shape (payroll-and-gps task) — one payslip,
// joined against its run's period. `amountCents` is a snapshot taken at run
// time (db/schemas/payroll.ts), not a live figure, so it stays correct even
// if the employee's rate changes later.
interface ApiPayslip {
  id: string;
  runId: string;
  amountCents: number;
  periodStart: string;
  periodEnd: string;
  createdAt: string | null;
}

const RECORD_TYPE_LABEL: Record<string, { label: string; icon: LucideIcon }> = {
  feeding: { label: 'Feeding', icon: Wheat },
  mortality: { label: 'Mortality', icon: AlertTriangle },
  physical_count: { label: 'Physical Count', icon: Hash },
};

// The backend accepts every one of these record types (worker-routines task).
// "Morning Round" is not in this list because it is not one fixed thing:
// rounds are defined by the owner (Settings › Daily routines) and each one
// gets its own tile on the Record screen.
const EXTRA_RECORD_TYPES = [
  { type: 'production', label: 'Collect', icon: Egg },
  { type: 'health', label: 'Health', icon: Syringe },
  { type: 'weight', label: 'Weight', icon: Scale },
  { type: 'stock_count', label: 'Closing Stock', icon: Package },
];

// One flat list for Home's "Quick record" row — the grouped browsing view
// (Daily work / Checks) lives on the dedicated Record tab; Home only needs
// fast single-tap shortcuts into a type the worker already knows they want.
const ALL_RECORD_TYPES = [
  ...Object.entries(RECORD_TYPE_LABEL).map(([type, meta]) => ({ type, ...meta })),
  ...EXTRA_RECORD_TYPES,
];

/* Shared fetch of the logged-in worker's own employee row + their assigned
 * batches. Each screen below calls this independently (same per-screen-fetch
 * convention as components/farm/crops.tsx — there is no shared worker-portal
 * provider on this branch). */
function useWorkerContext() {
  const { tenantId } = useNav();
  const [employee, setEmployee] = useState<ApiEmployeeMe | null>(null);
  const [employeeError, setEmployeeError] = useState('');
  const [batches, setBatches] = useState<ApiBatch[] | null>(null);

  const reload = useCallback(() => {
    apiClient.get<ApiEmployeeMe>(`/api/employees/me?tenantId=${tenantId}`).then((res) => {
      if (res.success) { setEmployee(res.data); setEmployeeError(''); }
      else setEmployeeError(res.error || 'Could not load your worker profile.');
    });
  }, [tenantId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!employee) return;
    apiClient.get<ApiBatch[]>(`/api/batches?tenantId=${tenantId}`).then((res) => {
      if (!res.success) { setBatches([]); return; }
      // No "ALL" sentinel on the real backend (db/schemas/people.ts) — an
      // employee with an empty assignedBatchIds genuinely has no batches
      // assigned yet, not implicit access to every batch.
      const assigned = employee.assignedBatchIds.length > 0
        ? res.data.filter((b) => employee.assignedBatchIds.includes(b.id))
        : [];
      setBatches(assigned);
    });
  }, [employee, tenantId]);

  return { tenantId, employee, employeeError, batches, reload };
}

// ── e2e finding: gate the record-type picker, not just the Save button ─────
// Health/Weight let a worker fill in the whole form, then POST /api/records
// refused it at Save with "Your role does not have edit access to health" —
// canEdit(tenantId, role, module) (lib/permissions.ts) was already the real
// authority; nothing client-side ever consulted it before opening the form.
//
// This reads the exact same two-tier source the server does: a saved
// `role_permissions` row for (role, module) wins when one exists (GET
// /api/role-permissions — readable by any session on the tenant, not just an
// owner), otherwise the same code default (lib/permission-matrix.ts's
// DEFAULT_MATRIX) the server falls back to. It never invents its own notion
// of who can do what — if this drifted from the server's answer, the buggy
// direction (silently letting through something the server will still
// refuse) is caught by POST /api/records's own error, which every form below
// still surfaces.
interface RoleMatrixEntry {
  role: string;
  permissions: Partial<Record<string, AccessLevel>>;
  approvalRequired: string[];
}

function useEffectiveRolePermissions(tenantId: string, role: string) {
  // undefined = still loading; null = loaded, no saved row for this role at
  // all (every module falls to the code default).
  const [entry, setEntry] = useState<RoleMatrixEntry | null | undefined>(undefined);

  useEffect(() => {
    if (BYPASS_ROLES.has(role)) return;
    let cancelled = false;
    apiClient.get<RoleMatrixEntry[]>(`/api/role-permissions?tenantId=${tenantId}`).then((res) => {
      if (cancelled) return;
      setEntry(res.success ? (res.data.find((r) => r.role === role) ?? null) : null);
    });
    return () => { cancelled = true; };
  }, [tenantId, role]);

  const ready = BYPASS_ROLES.has(role) || entry !== undefined;

  // Never blocks on a slow network: while still loading, every module reads
  // as 'edit' so a worker never sees a false "you can't do this" for a
  // permission they actually have — the moment the real matrix lands, tiles
  // that turn out to be denied grey out. POST /api/records enforces the real
  // rule regardless of what this shows.
  const access = useCallback((module: string): AccessLevel => {
    if (BYPASS_ROLES.has(role)) return 'edit';
    if (!ready) return 'edit';
    const override = entry?.permissions[module];
    if (override) return override;
    return DEFAULT_MATRIX[role]?.[module] ?? 'hidden';
  }, [entry, ready, role]);

  // Mirrors lib/permissions.ts's needsApproval at module granularity: a
  // saved row for this exact (role, module) wins in EITHER direction —
  // including a tenant that explicitly turned approval OFF for a module the
  // code default would otherwise require — else the code default applies.
  const approvalRequired = useCallback((module: string): boolean => {
    if (BYPASS_ROLES.has(role)) return false;
    if (!ready) return true;
    if (entry) {
      if (entry.approvalRequired.includes(module)) return true;
      if (module in entry.permissions) return false;
    }
    return DEFAULT_APPROVAL[role]?.[module] ?? false;
  }, [entry, ready, role]);

  return { ready, access, approvalRequired };
}

function timeOf(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ── Has this submission actually taken effect? ──────────────────────────────
// A record that moves the batch's headcount can be filed and NOT applied: when
// the tenant's matrix marks the module approval-required for the submitter's
// role, POST /api/records writes the row with `data.pendingApproval` and
// raises an approval instead of moving the count (app/api/records/route.ts).
// Deciding it clears that flag and stamps `data.approvalDecision`
// (lib/governance.ts). The three states are distinct and the worker needs to
// be able to tell them apart, so they are rendered apart.
function recordApprovalState(data: Record<string, unknown>): 'pending' | 'rejected' | 'applied' {
  if (data.pendingApproval === true) return 'pending';
  if (data.approvalDecision === 'rejected') return 'rejected';
  return 'applied';
}

const RECORD_STATE_BADGE: Record<'pending' | 'rejected' | 'applied', { label: string; variant: 'warning' | 'danger' | 'success' }> = {
  pending: { label: 'Waiting', variant: 'warning' },
  rejected: { label: 'Rejected', variant: 'danger' },
  applied: { label: 'Saved', variant: 'success' },
};

// ── Several photos per record: reading them back ────────────────────────────
// `photoUrls` is the full list; `photoUrl` (kept for every reader that never
// learned about the array) is just its first element. A record written
// before this shipped has `photoUrls: []` and a real `photoUrl` — falling
// back to `[photoUrl]` is what keeps an OLD mortality record's photo
// visible here too, not just new ones.
function photosOf(r: { photoUrl: string | null; photoUrls: string[] }): string[] {
  return r.photoUrls.length > 0 ? r.photoUrls : (r.photoUrl ? [r.photoUrl] : []);
}

// Read-only thumbnail row for a worker's own record — "the worker must be
// able to see the photos they attached" (rejection-loop task). Tapping one
// opens PhotoLightbox full-screen; nothing here can edit or remove a photo,
// this is history, not the capture form.
function PhotoStrip({ photos, onOpen }: { photos: string[]; onOpen: (url: string) => void }) {
  if (photos.length === 0) return null;
  return (
    <div className="mt-2 flex gap-1.5">
      {photos.map((url, i) => (
        <button
          key={i} type="button" onClick={() => onOpen(url)}
          className="size-11 shrink-0 overflow-hidden rounded-lg border border-border"
        >
          {/* eslint-config's @next/next/no-img-element is off repo-wide (see eslint.config.mjs) */}
          <img src={url} alt={`Photo ${i + 1} attached to this record`} className="size-full object-cover" />
        </button>
      ))}
    </div>
  );
}

/** Full-screen, tap-anywhere-to-close viewer shared by every screen that
 * shows a worker's own photos read-only (Home, Profile). */
function PhotoLightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  if (!url) return null;
  return (
    <div
      role="button" tabIndex={0} aria-label="Close photo"
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/85 p-4"
      onClick={onClose}
    >
      <img src={url} alt="Photo attached to this record, enlarged" className="max-h-full max-w-full rounded-lg object-contain" />
    </div>
  );
}

/* ── Pick from a list, or say something the list lacks ──────────────────────
 * These fields were free-text inputs writing straight into the jsonb `data`
 * blob, so "Newcastle vaccine", "newcastle" and "Newcastl" all became distinct
 * values and any report grouping by them fragmented into near-duplicates.
 *
 * The escape hatch is not optional. A farm will always have a cause or a drug
 * the curated list lacks, and a worker who cannot record what actually
 * happened either records something false or records nothing — both worse than
 * a typo. Choosing "Other" reveals the text input and the typed value is what
 * gets stored, so the dropdown removes the typo for the common case without
 * removing the ability to say something new.
 *
 * `value` is the stored value, not the select's own state: a record loaded with
 * a cause that is not in the list has to render as "Other" with the text
 * showing, or editing it would silently rewrite it.
 */
function PickOrType({ options, value, onChange, placeholder, otherPlaceholder, className }: {
  options: readonly string[];
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  otherPlaceholder: string;
  className?: string;
}) {
  // "Is this value one of the options" is the only state worth deriving; an
  // explicit `isOther` flag alongside `value` would let the two disagree.
  const listed = value !== '' && options.includes(value);
  const [showOther, setShowOther] = useState(value !== '' && !listed);

  return (
    <div className={className}>
      <select
        className={cn(controlClass, 'h-14 text-base', showOther && 'mb-2')}
        value={showOther ? OTHER_OPTION : value}
        onChange={(e) => {
          if (e.target.value === OTHER_OPTION) { setShowOther(true); onChange(''); return; }
          setShowOther(false);
          onChange(e.target.value);
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value={OTHER_OPTION}>{OTHER_OPTION}…</option>
      </select>
      {showOther && (
        <Input
          className="h-14 text-base"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={otherPlaceholder}
          autoFocus
        />
      )}
    </div>
  );
}
// POST /api/records echoes `pendingApproval` on the created row when it raised
// an approval instead of applying the movement. The confirmation the worker
// gets has to match what actually happened: "saved" for a record that moved
// the count, and something that does not promise it moved for one that is
// sitting in the owner's queue. Telling them "saved" either way is how a
// worker ends up reporting the same deaths twice.
interface RecordPostResult { pendingApproval?: boolean }

function submissionToast(res: RecordPostResult | undefined, savedMessage: string): [string, 'success' | 'info'] {
  return res?.pendingApproval
    ? ['Sent for approval — the count changes once it is approved.', 'info']
    : [savedMessage, 'success'];
}
function isToday(iso: string | null) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// A task's title is free text (db/schemas/dashboard.ts has no `type` column —
// see components/farm/tasks.tsx's header note), so there is no reliable link
// from a task to a record form. This is a best-effort routing shortcut only —
// it decides which record type "Record it" opens to, never what gets stored —
// and falls back to the plain chooser when nothing matches, rather than
// guessing wrong silently.
const RECORD_TYPE_HINTS: [RegExp, string][] = [
  [/mortal|death|die/i, 'mortality'],
  [/feed/i, 'feeding'],
  [/egg|milk|collect|harvest|produc/i, 'production'],
  [/health|vaccin|treat|medic|dose/i, 'health'],
  [/weigh/i, 'weight'],
  [/count|census/i, 'physical_count'],
  [/stock|closing/i, 'stock_count'],
];
function guessRecordType(title: string): string | null {
  for (const [re, type] of RECORD_TYPE_HINTS) if (re.test(title)) return type;
  return null;
}

// ── "My Tasks Today" (issue #303) ───────────────────────────────────────────
// Restores the original Happy Seeds design's Worker Home checklist ("what do
// I still need to do today"), dropped when this screen was wired to real data
// (issue #248) and replaced with "Recent Activity" ("what did I just do") —
// a good addition, but not a substitute. Sourced from the same GET /api/tasks
// (issue #227, extended #243/#244) the Tasks/Governance screens already use;
// the server-side `due=today` filter is the exact one built for this
// purpose (see app/api/tasks/route.ts's header comment).
//
// e2e finding (P1): `tasks.assigneeId` (migration 0029, db/schemas/
// dashboard.ts) is a real employees.id column — the "no assigneeId column"
// comment that used to sit here was stale (the column predates it) and this
// filter matched ONLY the notes-encoded "Assigned: <name>" text, which the
// owner's Assign-work sheet doesn't even write to anymore. A task assigned
// through the real column never matched, so it never reached the worker who
// was actually assigned it. `assigneeId` now wins whenever a row has one;
// the notes-name match is kept ONLY as a fallback for rows written before
// that column existed (never set on any row created since).
export function selectMyTasksToday(tasks: ApiTask[], employeeId: string, workerName: string): ApiTask[] {
  const name = workerName.trim().toLowerCase();
  return tasks.filter((t) => {
    if (t.assigneeId) return t.assigneeId === employeeId;
    return !!name && splitNotes(t.notes).assignee.trim().toLowerCase() === name;
  });
}

// ── Reply with a note (rejection-loop task) ─────────────────────────────────
// One short reply per rejected record, attached where the owner already
// looks (the same record, in Approvals) — no chat thread, no second screen.
// PATCH /api/records/[id] enforces that this record is both the caller's own
// and actually rejected; this dialog only ever opens on a row that already
// satisfies both, so a failure here would mean the two disagreed, not a
// normal outcome.
function NoteReplyDialog({ record, onClose, onSaved, tenantId }: {
  record: ApiRecord | null;
  onClose: () => void;
  onSaved: () => void;
  tenantId: string;
}) {
  const { showToast } = useToast();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setNote(''); }, [record?.id]);

  async function submit() {
    if (!record || !note.trim()) return;
    setSaving(true);
    const res = await apiClient.patch(`/api/records/${record.id}?tenantId=${tenantId}`, { note: note.trim() });
    setSaving(false);
    if (!res.success) { showToast(res.error ?? 'Could not send that note', 'error'); return; }
    showToast('Sent to the owner', 'success');
    onSaved();
    onClose();
  }

  return (
    <Dialog open={!!record} onOpenChange={(o) => { if (!o) onClose(); }}>
      {record && (
        <>
          <DialogTitle>Reply with a note</DialogTitle>
          <DialogDescription>This goes to the owner, attached to this record — they&apos;ll see it next to their decision.</DialogDescription>
          <textarea
            className={cn(controlClass, 'mt-3 h-24 resize-none py-2 text-base')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. The photo was blurry because the light was bad — I can retake it tomorrow morning"
            autoFocus
            maxLength={500}
          />
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" className="h-11 flex-1" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button className="h-11 flex-1" disabled={saving || !note.trim()} onClick={submit}>{saving ? 'Sending…' : 'Send'}</Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

// ── Worker Home — hero is "your next job" ───────────────────────────────────
// The design brief for this screen: a worker on a cheap Android phone, in
// sunlight, sometimes gloved, wants one thing before anything else — what do
// I do right now. Today's tasks (already fetched for "My Tasks Today") are
// ordered open-first, and the first open one becomes the hero card with one
// big "Record it" action that jumps straight past the Record tab's chooser
// when the title hints at a record type (see `guessRecordType`), or opens the
// chooser itself when it can't tell. Everything else — the rest of today's
// queue, recent activity, ad-hoc quick-record shortcuts — is secondary and
// sits below, smaller.
export function WorkerHomeScreen() {
  const { navigate, role } = useNav();
  const { tenantId, employee, employeeError, batches } = useWorkerContext();
  const { showToast } = useToast();
  // e2e finding: a tile this role can't file (Health is the one testers hit
  // most) used to sit here disabled with a reason a worker only saw after
  // tapping it. If a role has no edit access to a record type, the tile
  // itself shouldn't exist here — `access` reads 'edit' while the matrix is
  // still loading, so nothing flickers away on a slow phone once it lands.
  const { access } = useEffectiveRolePermissions(tenantId, role);
  const quickRecordTiles = ALL_RECORD_TYPES.filter((tile) => access(RECORD_TYPE_MODULES[tile.type]) === 'edit');
  // Fetched once, in full — "Recent activity" shows the newest 5, "Needs
  // another look" (rejection-loop task) filters the same list for rejected
  // records that haven't already been fixed, so one request backs both
  // instead of a second fetch for the second section.
  const [allRecords, setAllRecords] = useState<ApiRecord[] | null>(null);
  const [batchLabel, setBatchLabel] = useState<Record<string, string>>({});
  const [tasksToday, setTasksToday] = useState<ApiTask[] | null>(null);
  const [taskActionId, setTaskActionId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [noteTarget, setNoteTarget] = useState<ApiRecord | null>(null);

  const loadRecords = useCallback(() => {
    if (!employee) return;
    apiClient.get<ApiRecord[]>(`/api/records?tenantId=${tenantId}&employeeId=${employee.id}`).then((res) => {
      if (res.success) setAllRecords(res.data);
    });
  }, [employee, tenantId]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  const recent = allRecords?.slice(0, 5) ?? null;

  // A rejected record whose fix has already been resubmitted (a newer record
  // carries its id in `data.resubmitsRecordId`) has nothing left for the
  // worker to do — it drops off this list the moment that happens, rather
  // than sitting here stale next to the attempt that superseded it.
  const needsAnotherLook = useMemo(() => {
    if (!allRecords) return [];
    const resubmitted = new Set(
      allRecords.map((r) => (typeof r.data.resubmitsRecordId === 'string' ? r.data.resubmitsRecordId : null)).filter((v): v is string => !!v),
    );
    return allRecords.filter((r) => recordApprovalState(r.data) === 'rejected' && !resubmitted.has(r.id));
  }, [allRecords]);

  const loadTasksToday = useCallback(() => {
    if (!employee) return;
    apiClient.get<ApiTask[]>(`/api/tasks?tenantId=${tenantId}&due=today`).then((res) => {
      if (res.success) setTasksToday(selectMyTasksToday(res.data, employee.id, employee.name));
    });
  }, [employee, tenantId]);

  useEffect(() => { loadTasksToday(); }, [loadTasksToday]);

  useEffect(() => {
    if (!batches) return;
    setBatchLabel(Object.fromEntries(batches.map((b) => [b.id, b.code])));
  }, [batches]);

  // Mark-done goes through the identical PATCH /api/tasks/[id] as
  // components/farm/tasks.tsx's `markDone` — including the
  // requiresApproval -> PENDING_APPROVAL transition — so a task completed
  // from Worker Home behaves exactly like completing it from Tasks/Governance.
  async function markTaskDone(task: ApiTask) {
    setTaskActionId(task.id);
    const res = await apiClient.patch<ApiTask & { approvalRequestId?: string }>(`/api/tasks/${task.id}?tenantId=${tenantId}`, { status: 'DONE' });
    setTaskActionId(null);
    if (!res.success) { showToast(res.error ?? 'Could not update task', 'error'); return; }
    showToast(res.data.approvalRequestId ? 'Submitted for owner approval' : 'Task marked as done', res.data.approvalRequestId ? 'info' : 'success');
    loadTasksToday();
  }

  function openRecordFor(task: ApiTask) {
    const type = guessRecordType(task.title);
    navigate('worker-record', type ? { type } : undefined);
  }

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const doneTodayTypes = new Set((recent ?? []).filter((r) => isToday(r.createdAt)).map((r) => r.type));

  const openTasks = (tasksToday ?? []).filter((t) => t.status !== 'DONE' && displayStatus(t) !== 'PENDING_APPROVAL');
  const settledTasks = (tasksToday ?? []).filter((t) => t.status === 'DONE' || displayStatus(t) === 'PENDING_APPROVAL');
  const nextJob = openTasks[0] ?? null;
  const queuedJobs = openTasks.slice(1);

  return (
    <div className="screen-content px-screen pt-4 pb-8">
      {/* Greeting */}
      <div className="mb-5">
        <p className="text-xs font-medium tracking-widest text-muted uppercase">{greeting}</p>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="font-display truncate text-3xl leading-none font-medium text-fg">{employee?.name ?? '…'}</h1>
          <Wheat size={20} className="shrink-0 text-primary" aria-hidden="true" />
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary">
            <Wifi size={11} aria-hidden="true" /> Online
          </span>
          <span className="text-xs text-muted">{now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        </div>
      </div>

      {employeeError && <div className="mb-4 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{employeeError}</div>}

      {/* Hero: your next job */}
      <p className="section-eyebrow mb-2">Your next job</p>
      {tasksToday === null && (
        <div className="mb-5 rounded-xl bg-surface p-5 text-sm text-muted shadow-(--shadow-border)">Loading today&apos;s work…</div>
      )}

      {tasksToday !== null && !nextJob && (
        <div className="mb-5 flex items-center gap-3 rounded-xl bg-success-soft px-4 py-5 shadow-(--shadow-border)">
          <CheckCircle2 size={22} className="shrink-0 text-success" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-fg">All caught up</p>
            <p className="text-xs text-muted">Nothing assigned to you is due today. Use Quick record below for anything off-schedule.</p>
          </div>
        </div>
      )}

      {nextJob && (
        <div className="mb-3 rounded-xl bg-surface p-4 shadow-(--shadow-border)">
          <div className="flex items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <ClipboardList size={20} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base leading-snug font-semibold text-fg">{nextJob.title}</p>
              <p className={cn('mt-0.5 text-xs font-medium', displayStatus(nextJob) === 'OVERDUE' ? 'text-danger' : 'text-muted')}>
                {displayStatus(nextJob) === 'OVERDUE' ? 'Overdue since ' : 'Due '}{timeOf(nextJob.dueAt)}
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              variant="secondary" size="lg" className="h-14 flex-1"
              onClick={() => markTaskDone(nextJob)} disabled={taskActionId === nextJob.id}
            >
              <Check size={16} /> Done
            </Button>
            <Button size="lg" className="h-14 flex-[2] text-base" onClick={() => openRecordFor(nextJob)}>
              Record it <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {queuedJobs.length > 0 && (
        <div className="mb-5 overflow-hidden rounded-xl bg-surface shadow-(--shadow-border)">
          {queuedJobs.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => openRecordFor(t)}
              className={cn(
                'flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2',
                i < queuedJobs.length - 1 && 'border-b border-border',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{t.title}</span>
                <span className={cn('text-xs', displayStatus(t) === 'OVERDUE' ? 'text-danger font-medium' : 'text-muted')}>
                  {displayStatus(t) === 'OVERDUE' ? 'Overdue · ' : 'Due '}{timeOf(t.dueAt)}
                </span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-subtle" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {settledTasks.length > 0 && (
        <p className="mb-5 text-xs text-muted">
          {settledTasks.filter((t) => t.status === 'DONE').length > 0 && `${settledTasks.filter((t) => t.status === 'DONE').length} done today`}
          {settledTasks.some((t) => displayStatus(t) === 'PENDING_APPROVAL') && (settledTasks.filter((t) => t.status === 'DONE').length > 0 ? ' · ' : '') + 'some waiting on approval'}
        </p>
      )}

      {/* ── Needs another look (rejection-loop task) ──────────────────────────
         A worker who gets rejected used to learn nothing and could do
         nothing — this is the loop closing. Sits above Recent activity: it's
         work waiting on the worker, not history. Hidden entirely once
         nothing is waiting, same "no empty section" rule the rest of this
         screen already follows. */}
      {needsAnotherLook.length > 0 && (
        <>
          <p className="section-eyebrow mb-2 text-danger">Needs another look</p>
          <div className="mb-6 overflow-hidden rounded-xl bg-surface shadow-(--shadow-border)">
            {needsAnotherLook.map((r, i) => {
              const reason = typeof r.data.decisionNote === 'string' ? r.data.decisionNote : null;
              const alreadyReplied = typeof r.data.workerNote === 'string' && r.data.workerNote.length > 0;
              const apiType = r.type; // already the exact string RECORD_TYPE_TO_FORM expects
              return (
                <div key={r.id} className={cn('px-4 py-3.5', i < needsAnotherLook.length - 1 && 'border-b border-border')}>
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger">
                      <AlertTriangle size={16} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg">{RECORD_TYPE_LABEL[r.type]?.label ?? r.type}</p>
                      <p className="text-xs text-muted">{batchLabel[r.batchId] ?? r.batchId.slice(0, 8)} · {timeOf(r.createdAt)}</p>
                      {reason && <p className="mt-1 text-xs leading-relaxed text-danger">&quot;{reason}&quot;</p>}
                      {alreadyReplied && <p className="mt-1 text-xs text-muted">You replied — waiting on the owner.</p>}
                    </div>
                  </div>
                  <PhotoStrip photos={photosOf(r)} onOpen={setLightbox} />
                  <div className="mt-2.5 flex gap-2">
                    <Button size="lg" className="h-11 flex-1 text-[13px]" onClick={() => navigate('worker-record', { type: apiType, resubmit: r.id })}>
                      Fix and resubmit
                    </Button>
                    <Button variant="secondary" size="lg" className="h-11 flex-1 text-[13px]" onClick={() => setNoteTarget(r)}>
                      Reply with a note
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Recent activity (real GET /api/records, not a task mock) */}
      <p className="section-eyebrow mb-2">Recent activity</p>
      <div className="mb-6 overflow-hidden rounded-xl bg-surface shadow-(--shadow-border)">
        {recent === null && <div className="p-4 text-sm text-muted">Loading…</div>}
        {recent !== null && recent.length === 0 && (
          <div className="p-4 text-sm text-muted">No records submitted yet — use Quick record below.</div>
        )}
        {recent !== null && recent.map((r, i) => {
          const RecordIcon = RECORD_TYPE_LABEL[r.type]?.icon ?? ClipboardList;
          const badge = RECORD_STATE_BADGE[recordApprovalState(r.data)];
          return (
            <div key={r.id} className={cn('px-4 py-3', i < recent.length - 1 && 'border-b border-border')}>
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <RecordIcon size={16} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{RECORD_TYPE_LABEL[r.type]?.label ?? r.type}</p>
                  <p className="text-xs text-muted">{batchLabel[r.batchId] ?? r.batchId.slice(0, 8)} · {timeOf(r.createdAt)}</p>
                </div>
                {badge.variant !== 'success' && <Badge variant={badge.variant}>{badge.label}</Badge>}
              </div>
              <PhotoStrip photos={photosOf(r)} onOpen={setLightbox} />
            </div>
          );
        })}
      </div>
      <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} />
      <NoteReplyDialog record={noteTarget} onClose={() => setNoteTarget(null)} onSaved={loadRecords} tenantId={tenantId} />

      {/* Quick record — ad-hoc shortcuts straight into a type; the full
         grouped browser lives on the Record tab. Hidden entirely (not just
         emptied) when this role can't file anything here — a shortcut row
         with nothing a worker can tap is worse than no row at all. */}
      {quickRecordTiles.length > 0 && (
      <>
      <p className="section-eyebrow mb-2">Quick record</p>
      <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
        {quickRecordTiles.map((tile) => {
          const done = doneTodayTypes.has(tile.type);
          return (
            <button
              key={tile.type}
              type="button"
              onClick={() => navigate('worker-record', { type: tile.type })}
              className="flex w-16 shrink-0 flex-col items-center gap-1.5"
            >
              <span className={cn(
                'relative flex size-14 items-center justify-center rounded-full shadow-(--shadow-border)',
                done ? 'bg-primary text-primary-fg' : 'bg-surface text-muted',
              )}>
                <tile.icon size={22} aria-hidden="true" />
                {done && <Check size={11} className="absolute top-0.5 right-0.5 rounded-full bg-surface text-primary" aria-hidden="true" />}
              </span>
              <span className="text-center text-[11px] leading-tight font-medium text-muted">{tile.label}</span>
            </button>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}

// worker.tsx's Home "Quick Record" shortcuts and this screen's own chooser
// below used to render the exact same three tiles with no connection between
// them: tapping one on Home landed here only to show the identical tiles
// again before the real form opened. Home now passes `type` (the record's
// real API type string, e.g. 'physical_count'); this screen normalises that
// to its own internal form key ('count') and opens the form directly,
// skipping the chooser. Reaching this screen with no `type` (its own bottom
// tab) still shows the chooser — that's its one legitimate, unambiguous entry
// point.
const RECORD_TYPE_TO_FORM: Record<string, string> = {
  feeding: 'feeding', mortality: 'mortality', physical_count: 'count', count: 'count',
  production: 'collect', collect: 'collect', health: 'health', weight: 'weight',
  stock_count: 'stock', stock: 'stock',
};

// The inverse of the non-identity half of RECORD_TYPE_TO_FORM above — the
// picker/Home use short form keys ('collect', 'count', 'stock') as their tile
// `type`, but RECORD_TYPE_MODULES (lib/permission-matrix.ts) is keyed by the
// real `records.type` API string. This is only ever used to look a module up,
// never sent to the server.
const FORM_KEY_TO_API_TYPE: Record<string, string> = {
  feeding: 'feeding', mortality: 'mortality', count: 'physical_count',
  collect: 'production', health: 'health', weight: 'weight', stock: 'stock_count',
};

// Short plain-language noun for the "your role can't record X" message.
const FORM_KEY_NOUN: Record<string, string> = {
  feeding: 'feeding', mortality: 'mortality', count: 'physical counts',
  collect: 'products', health: 'health', weight: 'weight samples', stock: 'closing stock',
};

// ── Record — a fast picker, then a short form ───────────────────────────────
// Big, one-line tiles grouped by how often a worker reaches for them (Daily
// work vs. Checks), each a minimum 56px tall tap target. A farm's own
// configured rounds (routines) get their own tile group beneath — nothing
// invented, `GET /api/routines` filtered to `active`.
export function WorkerRecordScreen() {
  const { params, tenantId, role } = useNav();
  const { showToast } = useToast();
  const ctx = useWorkerContext();
  const { ready, access } = useEffectiveRolePermissions(tenantId, role);
  const [activeForm, setActiveForm] = useState<null | string>(() => RECORD_TYPE_TO_FORM[params.type] ?? null);
  // The owner's rounds. Fetched here rather than baked in, because what a
  // round consists of is a property of the farm — see db/schemas/people.ts.
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [activeRoutine, setActiveRoutine] = useState<Routine | null>(null);

  // ── Fix and resubmit (rejection-loop task) ─────────────────────────────────
  // Worker Home's "Needs another look" section deep-links here with
  // `resubmit=<rejected record id>` alongside the usual `type`. Loading the
  // full rejected record (its count/cause/photos) is what lets the form open
  // pre-filled instead of blank — `undefined` means still loading (the form
  // is held back below so it never flashes empty first), `null` means there
  // is nothing to resubmit (the common case) or the fetch failed, in which
  // case the form still opens, just blank, rather than getting stuck.
  const resubmitId = params.resubmit;
  const [resubmitSeed, setResubmitSeed] = useState<ApiRecord | null | undefined>(resubmitId ? undefined : null);

  useEffect(() => {
    apiClient.get<Routine[]>(`/api/routines?tenantId=${tenantId}`).then((res) => {
      setRoutines(res.success ? res.data.filter((r) => r.active) : []);
    });
  }, [tenantId]);

  useEffect(() => {
    if (!resubmitId) { setResubmitSeed(null); return; }
    let cancelled = false;
    apiClient.get<ApiRecord[]>(`/api/records?tenantId=${tenantId}&id=${resubmitId}`).then((res) => {
      if (cancelled) return;
      setResubmitSeed(res.success && res.data.length > 0 ? res.data[0] : null);
    });
    return () => { cancelled = true; };
  }, [resubmitId, tenantId]);

  // Safety net for the deep-link entry point (Home's Quick record row, or an
  // overdue task's "Record it" button, both navigate here with `type` set
  // and skip the chooser below entirely — see RECORD_TYPE_TO_FORM's own
  // comment). `access` reads 'edit' until the real matrix has loaded, so this
  // never bounces a worker out of a form they can actually use; once it
  // resolves to anything else, it sends them back rather than leaving an
  // unfillable form open.
  useEffect(() => {
    if (!activeForm) return;
    const apiType = FORM_KEY_TO_API_TYPE[activeForm];
    const formModule = apiType ? RECORD_TYPE_MODULES[apiType] : undefined;
    if (formModule && access(formModule) !== 'edit') {
      showToast(`Your role can't record ${FORM_KEY_NOUN[activeForm] ?? activeForm} — ask the owner`, 'error');
      setActiveForm(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeForm, access]);

  if (!ctx.employee) {
    return (
      <div className="screen-content px-screen pt-4">
        {ctx.employeeError ? (
          <div className="text-sm text-danger">{ctx.employeeError}</div>
        ) : (
          <div className="text-sm text-muted">Loading…</div>
        )}
      </div>
    );
  }

  if (activeRoutine) return <RoutineRunner ctx={ctx} routine={activeRoutine} onBack={() => setActiveRoutine(null)} />;
  // Held back while the rejected record it resubmits is still loading, so
  // the form never flashes blank and then jumps to pre-filled a moment later.
  if ((activeForm === 'mortality' || activeForm === 'count') && resubmitId && resubmitSeed === undefined) {
    return <div className="screen-content px-screen pt-4"><div className="text-sm text-muted">Loading…</div></div>;
  }
  if (activeForm === 'feeding') return <FeedingForm ctx={ctx} onBack={() => setActiveForm(null)} />;
  if (activeForm === 'mortality') return <MortalityForm ctx={ctx} onBack={() => setActiveForm(null)} resubmitOf={resubmitSeed ?? undefined} />;
  if (activeForm === 'count') return <PhysicalCountForm ctx={ctx} onBack={() => setActiveForm(null)} resubmitOf={resubmitSeed ?? undefined} />;
  if (activeForm === 'collect') return <CollectProductsForm ctx={ctx} onBack={() => setActiveForm(null)} />;
  if (activeForm === 'health') return <HealthForm ctx={ctx} onBack={() => setActiveForm(null)} />;
  if (activeForm === 'weight') return <WeightForm ctx={ctx} onBack={() => setActiveForm(null)} />;
  if (activeForm === 'stock') return <StockCountForm ctx={ctx} onBack={() => setActiveForm(null)} />;

  const RAW_GROUPS = [
    {
      label: 'Daily work',
      tiles: [
        { type: 'feeding', label: 'Feeding', icon: Wheat, desc: 'Feed from the store' },
        { type: 'collect', label: 'Collect Products', icon: Egg, desc: 'Eggs, milk, whatever it yields' },
        { type: 'mortality', label: 'Mortality', icon: AlertTriangle, desc: 'Record deaths' },
      ],
    },
    {
      label: 'Checks',
      tiles: [
        { type: 'health', label: 'Health & Vaccine', icon: Syringe, desc: 'Treatments given' },
        { type: 'weight', label: 'Weight Sample', icon: Scale, desc: 'Sample weights, averaged' },
        { type: 'count', label: 'Physical Count', icon: Hash, desc: 'Count against the system' },
        { type: 'stock', label: 'Closing Stock', icon: Package, desc: 'What is left in the store' },
      ],
    },
  ];

  // e2e finding: a card this role can't file used to sit here disabled with
  // a reason (still true for the deep-link safety net above) — the picker
  // itself now simply doesn't offer it. A tile whose module resolves to
  // anything but 'edit' is dropped, and a group left with no tiles at all is
  // dropped with it (an empty "Checks" heading over nothing reads as broken).
  const tileModule = (type: string) => {
    const apiType = FORM_KEY_TO_API_TYPE[type];
    return apiType ? RECORD_TYPE_MODULES[apiType] : undefined;
  };
  const GROUPS = RAW_GROUPS
    .map((g) => ({ ...g, tiles: g.tiles.filter((tile) => { const m = tileModule(tile.type); return !m || access(m) === 'edit'; }) }))
    .filter((g) => g.tiles.length > 0);

  // Same rule for a farm-defined round: a step whose module this role can't
  // edit is invisible inside RoutineRunner too (see there), so a round with
  // NO usable step at all shouldn't be offered here either.
  const usableRoutines = (routines ?? []).filter((r) => r.steps.some((s) => access(RECORD_TYPE_MODULES[s.kind] ?? '') === 'edit'));

  if (ready && routines !== null && GROUPS.length === 0 && usableRoutines.length === 0) {
    return (
      <div className="screen-content px-screen pt-4 pb-8">
        <div className="mb-5">
          <h1 className="font-display text-2xl font-medium text-fg">Record</h1>
        </div>
        <EmptyState icon={<ClipboardList size={20} aria-hidden="true" />} title="Nothing to record yet" body="Your role can't record anything yet — ask the owner." />
      </div>
    );
  }

  return (
    <div className="screen-content px-screen pt-4 pb-8">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-medium text-fg">Record</h1>
        <p className="mt-0.5 text-sm text-muted">Choose what to log</p>
      </div>

      {GROUPS.map((g) => (
        <div key={g.label} className="mb-5">
          <p className="section-eyebrow mb-2">{g.label}</p>
          <div className="flex flex-col gap-2">
            {g.tiles.map((tile) => (
              <button
                key={tile.type}
                type="button"
                onClick={() => setActiveForm(tile.type)}
                className="flex min-h-14 items-center gap-3 rounded-xl bg-surface p-3.5 text-left shadow-(--shadow-border) active:bg-surface-2"
              >
                <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <tile.icon size={21} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-fg">{tile.label}</p>
                  <p className="text-xs text-muted">{tile.desc}</p>
                </div>
                <ChevronRight size={16} className="shrink-0 text-subtle" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* The owner's rounds, each as its own tile. Nothing is shown when none
         are set up, or none has a step this role can actually file — an
         empty "Rounds" heading over nothing would read as something failing
         to load. The step count only counts steps this role can file, same
         reasoning as dropping an all-hidden GROUPS bucket above: a round
         that shows "4 steps" but opens with one is a worse surprise than a
         lower number that turns out to be true. */}
      {usableRoutines.length > 0 && (
        <div className="mb-5">
          <p className="section-eyebrow mb-2">Rounds</p>
          <div className="flex flex-col gap-2">
            {usableRoutines.map((routine) => {
              const visibleStepCount = routine.steps.filter((s) => access(RECORD_TYPE_MODULES[s.kind] ?? '') === 'edit').length;
              return (
              <button
                key={routine.id}
                type="button"
                onClick={() => setActiveRoutine(routine)}
                className="flex min-h-14 items-center gap-3 rounded-xl bg-surface p-3.5 text-left shadow-(--shadow-border) active:bg-surface-2"
              >
                <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <Sunrise size={21} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-fg">{routine.name}</p>
                  <p className="text-xs text-muted">
                    {visibleStepCount} step{visibleStepCount === 1 ? '' : 's'}
                    {routine.timeOfDay !== 'any' ? ` · ${routine.timeOfDay}` : ''}
                  </p>
                </div>
                <ChevronRight size={16} className="shrink-0 text-subtle" aria-hidden="true" />
              </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

type WorkerCtx = ReturnType<typeof useWorkerContext>;

function BatchPicker({ batches, onPick }: { batches: ApiBatch[] | null; onPick: (id: string) => void }) {
  if (batches === null) return <div className="text-sm text-muted">Loading your batches…</div>;
  if (batches.length === 0) {
    return (
      <div className="rounded-xl bg-warning-soft px-4 py-3.5 text-sm text-muted">
        No batches are assigned to you yet. Ask your manager to assign one before submitting records.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {batches.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onPick(b.id)}
          className="flex min-h-14 items-center gap-2 rounded-xl bg-surface px-4 py-3.5 text-left text-base font-semibold text-fg shadow-(--shadow-border) active:bg-surface-2"
        >
          <Layers size={16} className="text-muted" aria-hidden="true" /> {b.code} – {b.name}
        </button>
      ))}
    </div>
  );
}

/* ── Feeding ────────────────────────────────────────────────────────────────
 * Rewritten for the feed-from-stock task. What changed and why:
 *
 * The feed used to be a free-text box — the worker typed "Broiler Starter
 * Mash", or "broiler starter", or "BSM", and the app stored whatever they
 * typed. Nothing matched it to the item in the store, so stock never moved
 * and per-batch feed cost had no source. Now they pick from what is actually
 * on the farm, with the remaining quantity next to each name, and submitting
 * deducts it.
 *
 * The batch step takes several batches, not one: a bag of the same feed
 * routinely covers more than one house, and forcing one submission per batch
 * both wasted the worker's time and made the stock figure jump in a way that
 * looked wrong. Quantity is entered per batch, so 80kg can go 50 to one and
 * 30 to another rather than 80 to each.
 *
 * The remaining figure is fetched per selected batch because stock is held
 * per FARM (db/schemas/inventory.ts) — a worker must not be shown feed that
 * is physically at another farm. GET /api/inventory/available resolves that
 * from the batch, since a worker knows their batch, not their farm id.
 */
interface AvailableItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  qtyOnHand: number;
  lowStockThreshold: number;
  nextExpiry: string | null;
}

interface FeedLine {
  itemId: string;
  /** Quantity per batch id — the same issue split across the batches it fed. */
  perBatch: Record<string, string>;
}

function totalOf(line: FeedLine): number {
  return Object.values(line.perBatch).reduce((sum, v) => sum + (Number(v) || 0), 0);
}

function StepTrack({ steps, step }: { steps: string[]; step: number }) {
  return (
    <div className="mb-5 flex items-center gap-0">
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          <div className="flex flex-col items-center gap-1">
            <div className={cn(
              'flex size-6 items-center justify-center rounded-full text-[11px] font-bold',
              i + 1 < step ? 'bg-primary text-primary-fg' : i + 1 === step ? 'bg-primary text-primary-fg ring-4 ring-primary-soft' : 'bg-surface text-muted shadow-(--shadow-border)',
            )}>
              {i + 1 < step ? <Check size={12} aria-hidden="true" /> : i + 1}
            </div>
            <span className={cn('text-[10px] font-bold', step === i + 1 ? 'text-primary' : 'text-subtle')}>{s}</span>
          </div>
          {i < steps.length - 1 && <div className={cn('mt-3 h-0.5 flex-1', i + 1 < step ? 'bg-primary' : 'bg-border')} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function FeedingForm({ ctx, onBack }: { ctx: WorkerCtx; onBack: () => void }) {
  const { showToast } = useToast();
  const [step, setStep] = useState(1);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [lines, setLines] = useState<FeedLine[]>([{ itemId: '', perBatch: {} }]);
  const [stock, setStock] = useState<AvailableItem[] | null>(null);
  const [stockError, setStockError] = useState('');
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const chosenBatches = (ctx.batches ?? []).filter((b) => batchIds.includes(b.id));

  // Keyed on the first selected batch: every batch a worker is assigned to is
  // normally on one farm, and asking per batch would mean intersecting
  // several farms' stock into a number that is true for none of them.
  const stockBatchId = batchIds[0];
  useEffect(() => {
    if (!stockBatchId) return;
    setStock(null);
    apiClient.get<AvailableItem[]>(`/api/inventory/available?tenantId=${ctx.tenantId}&batchId=${stockBatchId}`).then((res) => {
      if (res.success) { setStock(res.data); setStockError(''); }
      else { setStock([]); setStockError(res.error || 'Could not load what is in stock.'); }
    });
  }, [stockBatchId, ctx.tenantId]);

  function toggleBatch(id: string) {
    setBatchIds((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));
    // Drop quantities for a batch that is no longer selected, so an
    // unselected house can't be fed by a leftover number nobody can see.
    setLines((prev) => prev.map((l) => {
      const next = { ...l.perBatch };
      if (batchIds.includes(id)) delete next[id];
      return { ...l, perBatch: next };
    }));
  }

  function setLineItem(i: number, itemId: string) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, itemId } : l)));
  }

  function setLineQty(i: number, batchId: string, value: string) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, perBatch: { ...l.perBatch, [batchId]: value } } : l)));
  }

  const filledLines = lines.filter((l) => l.itemId && totalOf(l) > 0);

  // What each item has left AFTER everything on this form — the worker sees
  // the shortfall before submitting rather than as a rejection afterwards.
  function remainingAfterForm(item: AvailableItem): number {
    const used = filledLines.filter((l) => l.itemId === item.id).reduce((sum, l) => sum + totalOf(l), 0);
    return item.qtyOnHand - used;
  }

  const overIssued = (stock ?? []).filter((item) => remainingAfterForm(item) < 0);

  async function handleSubmit() {
    if (!ctx.employee || batchIds.length === 0) return;
    setSubmitting(true); setError('');
    const res = await apiClient.post('/api/records', {
      tenantId: ctx.tenantId,
      batchIds,
      employeeId: ctx.employee.id,
      type: 'feeding',
      data: {
        feedItems: filledLines.map((l) => ({
          itemId: l.itemId,
          qty: totalOf(l),
          perBatch: Object.fromEntries(Object.entries(l.perBatch).map(([k, v]) => [k, Number(v) || 0])),
        })),
      },
    });
    setSubmitting(false);
    if (!res.success) { setError(res.error || 'Failed to save record.'); return; }
    showToast(`Feeding saved for ${batchIds.length} batch${batchIds.length === 1 ? '' : 'es'} — stock updated.`, 'success');
    onBack();
  }

  const visibleStock = (stock ?? []).filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="screen-content">
      <div className="px-screen"><TopNav title="Feeding Record" showBack /></div>
      <div className="px-screen pt-4 pb-8">
        <StepTrack steps={['Batches', 'Feed', 'Confirm']} step={step} />

        {step === 1 && (
          <div>
            <p className="mb-1 text-base font-semibold text-fg">Which batches are you feeding?</p>
            <p className="mb-3 text-sm leading-relaxed text-muted">
              Pick every batch getting feed from the same bag — you enter how much each one gets on the next step.
            </p>
            <MultiBatchPicker batches={ctx.batches} selected={batchIds} onToggle={toggleBatch} />
            <Button size="lg" className="mt-3 h-14 w-full" disabled={batchIds.length === 0} onClick={() => setStep(2)}>
              Continue{batchIds.length > 0 ? ` with ${batchIds.length}` : ''}
            </Button>
          </div>
        )}

        {step === 2 && (
          <div>
            <p className="mb-2.5 text-sm text-muted">{chosenBatches.map((b) => b.code).join(' · ')}</p>

            {stockError && (
              <div className="mb-2.5 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{stockError}</div>
            )}
            {stock === null && <div className="mb-2.5 text-sm text-muted">Loading what is in stock…</div>}
            {stock !== null && stock.length === 0 && !stockError && (
              <div className="mb-2.5 rounded-xl bg-warning-soft px-4 py-3.5 text-sm leading-relaxed text-muted">
                There is no stock recorded for this farm yet. Ask your manager to add the feed to the store before recording a feeding.
              </div>
            )}

            {stock !== null && stock.length > 6 && (
              <Input className="mb-2.5 h-12 text-base" placeholder="Search feed…" value={search} onChange={(e) => setSearch(e.target.value)} />
            )}

            {lines.map((line, i) => {
              const item = (stock ?? []).find((s) => s.id === line.itemId) ?? null;
              const left = item ? remainingAfterForm(item) : null;
              return (
                <div key={i} className="mb-2 rounded-xl bg-surface p-3.5 shadow-(--shadow-border)">
                  <label className="mb-1.5 block text-xs font-semibold text-muted">Feed from store</label>
                  <select className={cn(controlClass, 'mb-2 h-14 text-base')} value={line.itemId} onChange={(e) => setLineItem(i, e.target.value)}>
                    <option value="">Choose an item…</option>
                    {visibleStock.map((s) => (
                      <option key={s.id} value={s.id} disabled={s.qtyOnHand <= 0}>
                        {s.name} — {s.qtyOnHand} {s.unit} left{s.qtyOnHand <= 0 ? ' (out of stock)' : ''}
                      </option>
                    ))}
                  </select>

                  {item && (
                    <p className={cn('mb-2 text-xs leading-relaxed', left !== null && left < 0 ? 'text-danger' : left !== null && left <= item.lowStockThreshold ? 'text-warning' : 'text-muted')}>
                      {left !== null && left < 0
                        ? `That is ${Math.abs(left)} ${item.unit} more than the farm has.`
                        : `${left} ${item.unit} will be left after this.`}
                      {item.nextExpiry && ` · Oldest stock expires ${new Date(item.nextExpiry).toLocaleDateString()}`}
                    </p>
                  )}

                  {chosenBatches.map((b) => (
                    <div key={b.id} className="mb-1.5 flex items-center gap-2">
                      <span className="flex-1 text-sm text-fg">{b.code}</span>
                      <Input
                        type="number" inputMode="decimal" min="0"
                        placeholder={item ? item.unit : 'qty'}
                        value={line.perBatch[b.id] ?? ''}
                        onChange={(e) => setLineQty(i, b.id, e.target.value)}
                        className="h-12 w-28 text-base"
                      />
                    </div>
                  ))}

                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                      className="mt-1 rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs font-bold text-danger"
                    >Remove</button>
                  )}
                </div>
              );
            })}

            <Button variant="secondary" className="mb-4 w-full" onClick={() => setLines((prev) => [...prev, { itemId: '', perBatch: {} }])}>
              <Plus size={13} /> Add another feed
            </Button>

            <div className="flex gap-2">
              <Button variant="secondary" size="lg" className="h-14 flex-1" onClick={() => setStep(1)}>Back</Button>
              <Button size="lg" className="h-14 flex-[2]" disabled={filledLines.length === 0 || overIssued.length > 0} onClick={() => setStep(3)}>Review</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="mb-4 rounded-xl bg-primary-soft p-4">
              <p className="mb-2.5 text-base font-bold text-fg">Summary</p>
              {filledLines.map((line, i) => {
                const item = (stock ?? []).find((s) => s.id === line.itemId);
                return (
                  <div key={i} className="mb-2.5">
                    <div className="mb-0.5 flex justify-between text-sm">
                      <span className="text-muted">{item?.name ?? 'Item'}</span>
                      <span className="font-bold text-fg">{totalOf(line)} {item?.unit}</span>
                    </div>
                    {chosenBatches.map((b) => {
                      const qty = Number(line.perBatch[b.id]) || 0;
                      if (qty <= 0) return null;
                      return (
                        <div key={b.id} className="flex justify-between text-xs text-subtle">
                          <span>{b.code}</span><span>{qty} {item?.unit}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <p className="mt-1.5 border-t border-border pt-2 text-xs leading-relaxed text-muted">
                Saving this takes the feed out of the store — the oldest stock is used first.
              </p>
            </div>
            {error && <div className="mb-2.5 text-sm text-danger">{error}</div>}
            <div className="mb-2 flex gap-2">
              <Button variant="secondary" size="lg" className="h-14 flex-1" onClick={() => setStep(2)}>Back</Button>
              <Button size="lg" className="h-14 flex-[2]" disabled={submitting} onClick={handleSubmit}>
                <Check size={14} /> {submitting ? 'Saving…' : 'Save Record'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MultiBatchPicker({ batches, selected, onToggle }: {
  batches: ApiBatch[] | null;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (batches === null) return <div className="text-sm text-muted">Loading your batches…</div>;
  if (batches.length === 0) {
    return (
      <div className="rounded-xl bg-warning-soft px-4 py-3.5 text-sm text-muted">
        No batches are assigned to you yet. Ask your manager to assign one before submitting records.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {batches.map((b) => {
        const on = selected.includes(b.id);
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onToggle(b.id)}
            className={cn(
              'flex min-h-14 items-center gap-2 rounded-xl px-4 py-3.5 text-left text-base font-semibold shadow-(--shadow-border)',
              on ? 'bg-primary-soft text-primary ring-1 ring-primary' : 'bg-surface text-fg',
            )}
          >
            {on ? <Check size={16} aria-hidden="true" /> : <Layers size={16} className="text-muted" aria-hidden="true" />}
            {b.code} – {b.name}
          </button>
        );
      })}
    </div>
  );
}

/* ── Doing a round (worker-routines task) ───────────────────────────────────
 * "Morning Round" was a greyed-out tile because nothing said what a morning
 * round is. It differs per farm — one farm's is feed, water check, egg
 * collection and a mortality sweep; another's is milking and a temperature
 * reading — so the owner defines it (Settings › Daily routines) and this
 * walks the worker through whatever they defined.
 *
 * Each step files the SAME record its standalone form would file, so a
 * feeding done inside the round is a feeding record like any other and shows
 * up everywhere feedings show up. The round itself is recorded separately
 * (routine_runs), because a round where nothing died and nothing was
 * collected produces no records at all — and "no records" must not be
 * indistinguishable from "nobody came".
 *
 * Steps are submitted at the END rather than one at a time. A worker walking
 * a house with intermittent signal should not lose step three because the
 * request for step two timed out; and a round half-filed reads as a round
 * half-done to everyone who looks at it later.
 */
export interface RoutineStep {
  id: string;
  kind: string;
  label: string;
  required: boolean;
}

export interface Routine {
  id: string;
  name: string;
  timeOfDay: string;
  active: boolean;
  steps: RoutineStep[];
}

// What each step kind asks for, and what it files. `check` files a record
// too: "the worker confirmed the water lines were clear" is exactly the sort
// of thing an owner wants to be able to look up after a bad week.
const STEP_RECORD_TYPE: Record<string, string> = {
  feeding: 'feeding',
  mortality: 'mortality',
  physical_count: 'physical_count',
  production: 'production',
  health: 'health',
  weight: 'weight',
  check: 'check',
};

function RoutineRunner({ ctx, routine, onBack }: { ctx: WorkerCtx; routine: Routine; onBack: () => void }) {
  const { showToast } = useToast();
  const { role } = useNav();
  const { access } = useEffectiveRolePermissions(ctx.tenantId, role);
  // Same rule as the picker's GROUPS/Rounds list (WorkerRecordScreen): a step
  // whose module this role can't edit is dropped, not shown disabled — the
  // list above only offers a round that has at least one, so this is mostly
  // defensive (the matrix can change between opening the list and opening a
  // round already in hand), but it must never let a step through the server
  // will refuse anyway.
  const visibleSteps = routine.steps.filter((s) => access(RECORD_TYPE_MODULES[s.kind] ?? '') === 'edit');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [stock, setStock] = useState<AvailableItem[] | null>(null);
  const [productList, setProductList] = useState<{ id: string; name: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Both lookups are per-batch: stock is held per farm, and the product list
  // is the batch's own resolved list rather than the whole catalogue.
  useEffect(() => {
    if (!batchId) return;
    apiClient.get<AvailableItem[]>(`/api/inventory/available?tenantId=${ctx.tenantId}&batchId=${batchId}`).then((res) => {
      setStock(res.success ? res.data : []);
    });
    apiClient.get<{ id: string; name: string }[]>(`/api/batches/${batchId}/products?tenantId=${ctx.tenantId}`).then((res) => {
      if (res.success) setProductList(res.data.map((p) => ({ id: p.id, name: p.name })));
    });
  }, [batchId, ctx.tenantId]);

  function setField(stepId: string, field: string, value: string) {
    setValues((v) => ({ ...v, [stepId]: { ...(v[stepId] ?? {}), [field]: value } }));
  }
  const field = (stepId: string, name: string) => values[stepId]?.[name] ?? '';

  // A step counts as answered when it has the one number or note that makes
  // it worth filing. An empty optional step is simply not submitted.
  function isAnswered(step: RoutineStep): boolean {
    const v = values[step.id] ?? {};
    switch (step.kind) {
      case 'feeding': return !!v.itemId && Number(v.qty) > 0;
      case 'mortality': return Number(v.count) > 0;
      case 'physical_count': return v.counted !== undefined && v.counted !== '' && Number.isFinite(Number(v.counted));
      case 'production': return Object.entries(v).some(([k, n]) => k.startsWith('p:') && Number(n) > 0);
      case 'health': return !!v.treatment?.trim();
      case 'weight': return Number(v.weight) > 0;
      case 'check': return v.done === 'yes' || v.done === 'no';
      default: return false;
    }
  }

  function payloadFor(step: RoutineStep): Record<string, unknown> | null {
    const v = values[step.id] ?? {};
    switch (step.kind) {
      case 'feeding': return { feedItems: [{ itemId: v.itemId, qty: Math.trunc(Number(v.qty)) }] };
      case 'mortality': return { count: Math.trunc(Number(v.count)), cause: v.cause?.trim() || 'Recorded on round' };
      case 'physical_count': return { physicalCount: Math.trunc(Number(v.counted)), varianceReason: v.reason?.trim() || `Counted on ${routine.name}` };
      case 'production': return {
        items: Object.entries(v)
          .filter(([k, n]) => k.startsWith('p:') && Number(n) > 0)
          .map(([k, n]) => ({ productId: k.slice(2), qty: Math.trunc(Number(n)) })),
      };
      case 'health': return { treatment: v.treatment?.trim(), notes: v.notes?.trim() ?? '' };
      case 'weight': return { samples: [Number(v.weight)], averageKg: Number(v.weight), sampleSize: 1 };
      case 'check': return { step: step.label, ok: v.done === 'yes', note: v.note?.trim() ?? '' };
      default: return null;
    }
  }

  const missingRequired = visibleSteps.filter((s) => s.required && !skipped[s.id] && !isAnswered(s));

  async function submit() {
    if (!ctx.employee || !batchId) return;
    setSubmitting(true); setError('');

    const completed: Record<string, unknown> = {};
    const failures: string[] = [];

    for (const step of visibleSteps) {
      if (skipped[step.id] || !isAnswered(step)) continue;
      const data = payloadFor(step);
      if (!data) continue;
      const res = await apiClient.post('/api/records', {
        tenantId: ctx.tenantId, batchId, employeeId: ctx.employee.id,
        type: STEP_RECORD_TYPE[step.kind], data,
      });
      if (res.success) completed[step.id] = { kind: step.kind, label: step.label };
      // A step that a rule refuses — a feeding with not enough stock, a
      // mortality needing approval it cannot get — is named rather than
      // swallowed, and the rest of the round is still filed.
      else failures.push(`${step.label}: ${res.error ?? 'failed'}`);
    }

    const runRes = await apiClient.post('/api/routine-runs', {
      tenantId: ctx.tenantId, routineId: routine.id, batchId, employeeId: ctx.employee.id,
      completedSteps: completed,
      skippedCount: visibleSteps.filter((s) => skipped[s.id] || !isAnswered(s)).length,
    });
    setSubmitting(false);

    if (failures.length > 0) {
      setError(`Saved what went through. These did not: ${failures.join('; ')}`);
      return;
    }
    if (!runRes.success) { setError(runRes.error || 'Steps were saved, but the round was not marked done.'); return; }
    showToast(`${routine.name} done.`, 'success');
    onBack();
  }

  return (
    <div className="screen-content">
      <div className="px-screen"><TopNav title={routine.name} showBack /></div>
      <div className="px-screen pt-4 pb-8">
        {!batchId ? (
          <>
            <p className="mb-3 text-base font-semibold text-fg">Which batch is this round for?</p>
            <BatchPicker batches={ctx.batches} onPick={setBatchId} />
          </>
        ) : (
          <>
            <p className="mb-3.5 text-sm text-muted">
              {ctx.batches?.find((b) => b.id === batchId)?.code}
              <button type="button" onClick={() => setBatchId(null)} className="ml-2 text-xs font-bold text-primary">change</button>
            </p>

            {visibleSteps.length === 0 && (
              <div className="rounded-xl bg-warning-soft px-4 py-3.5 text-sm leading-relaxed text-muted">
                {routine.steps.length === 0
                  ? 'Nobody has said what this round involves yet. Ask your manager to add the steps.'
                  : "Your role can't record any of this round's steps — ask the owner."}
              </div>
            )}

            {visibleSteps.map((step, i) => {
              const done = isAnswered(step);
              const isSkipped = !!skipped[step.id];
              return (
                <div
                  key={step.id}
                  className={cn('mb-2.5 rounded-xl bg-surface p-3.5 shadow-(--shadow-border)', isSkipped && 'opacity-55')}
                  style={{ borderLeft: `3px solid ${done ? 'var(--color-primary)' : step.required ? 'var(--color-warning)' : 'var(--color-border)'}` }}
                >
                  <div className={cn('flex items-center gap-2', !isSkipped && 'mb-2.5')}>
                    <span className="text-[11px] font-extrabold text-subtle">{i + 1}</span>
                    <span className="flex-1 text-base font-semibold text-fg">{step.label}</span>
                    {done && <Check size={14} className="text-primary" aria-hidden="true" />}
                    {!step.required && (
                      <button type="button" onClick={() => setSkipped((sk) => ({ ...sk, [step.id]: !sk[step.id] }))} className="text-[11px] font-bold text-subtle">
                        {isSkipped ? 'undo' : 'skip'}
                      </button>
                    )}
                  </div>

                  {!isSkipped && step.kind === 'feeding' && (
                    <>
                      <select className={cn(controlClass, 'mb-2 h-14 text-base')} value={field(step.id, 'itemId')} onChange={(e) => setField(step.id, 'itemId', e.target.value)}>
                        <option value="">Choose feed from the store…</option>
                        {(stock ?? []).map((s) => (
                          <option key={s.id} value={s.id} disabled={s.qtyOnHand <= 0}>
                            {s.name} — {s.qtyOnHand} {s.unit} left
                          </option>
                        ))}
                      </select>
                      <Input className="h-14 text-base" type="number" inputMode="decimal" min="0" placeholder="How much" value={field(step.id, 'qty')} onChange={(e) => setField(step.id, 'qty', e.target.value)} />
                    </>
                  )}

                  {!isSkipped && step.kind === 'mortality' && (
                    <>
                      <Input className="mb-2 h-14 text-base" type="number" inputMode="numeric" min="0" placeholder="How many died (0 if none)" value={field(step.id, 'count')} onChange={(e) => setField(step.id, 'count', e.target.value)} />
                      <PickOrType
                        options={MORTALITY_CAUSES}
                        value={field(step.id, 'cause')}
                        onChange={(v) => setField(step.id, 'cause', v)}
                        placeholder="Cause, if known"
                        otherPlaceholder="Describe the cause"
                      />
                    </>
                  )}

                  {!isSkipped && step.kind === 'physical_count' && (
                    <Input className="h-14 text-base" type="number" inputMode="numeric" min="0" placeholder="How many did you count" value={field(step.id, 'counted')} onChange={(e) => setField(step.id, 'counted', e.target.value)} />
                  )}

                  {!isSkipped && step.kind === 'production' && (
                    productList.length === 0
                      ? <p className="text-xs text-muted">This batch has no products set up yet.</p>
                      : productList.map((p) => (
                        <div key={p.id} className="mb-1.5 flex items-center gap-2.5">
                          <span className="flex-1 text-sm text-fg">{p.name}</span>
                          <Input className="h-12 w-24 text-base" type="number" inputMode="numeric" min="0" placeholder="0"
                            value={field(step.id, `p:${p.id}`)} onChange={(e) => setField(step.id, `p:${p.id}`, e.target.value)} />
                        </div>
                      ))
                  )}

                  {!isSkipped && step.kind === 'health' && (
                    <>
                      <PickOrType
                        options={HEALTH_TREATMENTS}
                        value={field(step.id, 'treatment')}
                        onChange={(v) => setField(step.id, 'treatment', v)}
                        placeholder="What was given"
                        otherPlaceholder="Name the treatment"
                        className="mb-2"
                      />
                      <Input className="h-14 text-base" placeholder="Notes" value={field(step.id, 'notes')} onChange={(e) => setField(step.id, 'notes', e.target.value)} />
                    </>
                  )}

                  {!isSkipped && step.kind === 'weight' && (
                    <Input className="h-14 text-base" type="number" inputMode="decimal" step="0.01" min="0" placeholder="Weight in kg" value={field(step.id, 'weight')} onChange={(e) => setField(step.id, 'weight', e.target.value)} />
                  )}

                  {!isSkipped && step.kind === 'check' && (
                    <>
                      <div className="mb-2 flex gap-2">
                        {[['yes', 'All good'], ['no', 'Problem']].map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setField(step.id, 'done', value)}
                            className={cn(
                              'h-12 flex-1 rounded-lg text-sm font-bold',
                              field(step.id, 'done') === value
                                ? value === 'yes' ? 'bg-primary-soft text-primary ring-1 ring-primary' : 'bg-danger-soft text-danger ring-1 ring-danger'
                                : 'bg-surface text-muted shadow-(--shadow-border)',
                            )}
                          >{label}</button>
                        ))}
                      </div>
                      {field(step.id, 'done') === 'no' && (
                        <Input className="h-14 text-base" placeholder="What is wrong?" value={field(step.id, 'note')} onChange={(e) => setField(step.id, 'note', e.target.value)} />
                      )}
                    </>
                  )}
                </div>
              );
            })}

            {missingRequired.length > 0 && (
              <p className="mb-2.5 text-xs leading-relaxed text-warning">Still to do: {missingRequired.map((s) => s.label).join(', ')}</p>
            )}
            {error && <p className="mb-2.5 text-sm leading-relaxed text-danger">{error}</p>}

            <div className="flex gap-2">
              <Button variant="secondary" size="lg" className="h-14 flex-1" onClick={onBack}>Cancel</Button>
              <Button size="lg" className="h-14 flex-[2]" disabled={submitting || missingRequired.length > 0 || visibleSteps.length === 0} onClick={submit}>
                <Check size={14} /> {submitting ? 'Saving…' : `Finish ${routine.name}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── The rest of the worker's record types (worker-routines task) ───────────
 * These share a deliberately plain shape: pick a batch, fill in the numbers,
 * save. No wizard steps unless the form genuinely has stages (feeding does,
 * because stock has to be fetched for the chosen batch first). A worker
 * standing in a poultry house with one hand free is the design constraint.
 */
function SimpleFormShell({ title, batches, batchId, setBatchId, children, onBack, onSubmit, submitting, error, canSubmit }: {
  title: string;
  batches: ApiBatch[] | null;
  batchId: string | null;
  setBatchId: (id: string) => void;
  children: React.ReactNode;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string;
  canSubmit: boolean;
}) {
  return (
    <div className="screen-content">
      <div className="px-screen"><TopNav title={title} showBack /></div>
      <div className="px-screen pt-4 pb-8">
        {!batchId ? (
          <>
            <p className="mb-3 text-base font-semibold text-fg">Which batch?</p>
            <BatchPicker batches={batches} onPick={setBatchId} />
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">
              {batches?.find((b) => b.id === batchId)?.code}
              <button type="button" onClick={() => setBatchId('')} className="ml-2 text-xs font-bold text-primary">change</button>
            </p>
            {children}
            {error && <p className="my-2.5 text-sm text-danger">{error}</p>}
            <div className="mt-3.5 flex gap-2">
              <Button variant="secondary" size="lg" className="h-14 flex-1" onClick={onBack}>Cancel</Button>
              <Button size="lg" className="h-14 flex-[2]" disabled={submitting || !canSubmit} onClick={onSubmit}>
                <Check size={14} /> {submitting ? 'Saving…' : 'Save Record'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* Collect Products — eggs, milk, honey. The product list is the batch's own
 * resolved list (GET /api/batches/[id]/products), which is what the batch
 * inherits from its unit plus its own overrides, so a layer batch offers
 * trays and a dairy batch offers litres without the worker choosing from the
 * whole farm's catalogue. */
function CollectProductsForm({ ctx, onBack }: { ctx: WorkerCtx; onBack: () => void }) {
  const { showToast } = useToast();
  const [batchId, setBatchId] = useState<string | null>(null);
  const [productList, setProductList] = useState<{ id: string; name: string }[] | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!batchId) return;
    setProductList(null);
    apiClient.get<{ id: string; name: string }[]>(`/api/batches/${batchId}/products?tenantId=${ctx.tenantId}`).then((res) => {
      if (res.success) setProductList(res.data.map((p) => ({ id: p.id, name: p.name })));
      else setProductList([]);
    });
  }, [batchId, ctx.tenantId]);

  const entered = Object.entries(qty).filter(([, v]) => Number(v) > 0);

  async function submit() {
    if (!ctx.employee || !batchId) return;
    setSubmitting(true); setError('');
    const res = await apiClient.post('/api/records', {
      tenantId: ctx.tenantId, batchId, employeeId: ctx.employee.id, type: 'production',
      data: { items: entered.map(([productId, v]) => ({ productId, qty: Math.trunc(Number(v)) })) },
    });
    setSubmitting(false);
    if (!res.success) { setError(res.error || 'Could not save the collection.'); return; }
    showToast('Collection recorded.', 'success');
    onBack();
  }

  return (
    <SimpleFormShell
      title="Collect Products" batches={ctx.batches} batchId={batchId} setBatchId={(id) => setBatchId(id || null)}
      onBack={onBack} onSubmit={submit} submitting={submitting} error={error} canSubmit={entered.length > 0}
    >
      {productList === null && <div className="text-sm text-muted">Loading this batch&apos;s products…</div>}
      {productList !== null && productList.length === 0 && (
        <div className="rounded-xl bg-warning-soft px-4 py-3.5 text-sm leading-relaxed text-muted">
          This batch has no products set up. Ask your manager to add what it produces — eggs, milk, whatever it is — on the batch.
        </div>
      )}
      {(productList ?? []).map((p) => (
        <div key={p.id} className="mb-2 flex items-center gap-2.5">
          <span className="flex-1 text-base text-fg">{p.name}</span>
          <Input
            type="number" inputMode="numeric" min="0" placeholder="0"
            value={qty[p.id] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [p.id]: e.target.value }))}
            className="h-14 w-28 text-base"
          />
        </div>
      ))}
    </SimpleFormShell>
  );
}

/* Health & Vaccine. Free text on purpose: a treatment is "what did you give,
 * to how many, and why", and a fixed drug list would be wrong for every farm
 * that keeps something not on it. */
function HealthForm({ ctx, onBack }: { ctx: WorkerCtx; onBack: () => void }) {
  const { showToast } = useToast();
  const [batchId, setBatchId] = useState<string | null>(null);
  const [treatment, setTreatment] = useState('');
  const [affected, setAffected] = useState('');
  // Dose was one free-text box captioned "e.g. 1ml each", which produced
  // "1ml", "1 ml", "1ml each" and "one ml" for the same dose. Split into an
  // amount and a unit so the figure is a number; `formatDose` joins them back
  // into the single `data.dose` string the payload has always carried, so
  // records written before this read identically.
  const [doseAmount, setDoseAmount] = useState('');
  const [doseUnit, setDoseUnit] = useState<string>(DOSE_UNITS[0]);
  const [dosePer, setDosePer] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!ctx.employee || !batchId) return;
    setSubmitting(true); setError('');
    const res = await apiClient.post('/api/records', {
      tenantId: ctx.tenantId, batchId, employeeId: ctx.employee.id, type: 'health',
      data: {
        treatment: treatment.trim(),
        affected: affected ? Math.trunc(Number(affected)) : null,
        dose: formatDose(doseAmount, doseUnit, dosePer),
        // The parts are stored alongside the joined string so a later report
        // can sum doses without re-parsing prose.
        doseAmount: doseAmount.trim() ? Number(doseAmount) : null,
        doseUnit: doseAmount.trim() ? doseUnit : null,
        notes: notes.trim(),
      },
    });
    setSubmitting(false);
    if (!res.success) { setError(res.error || 'Could not save the record.'); return; }
    showToast('Health record saved.', 'success');
    onBack();
  }

  return (
    <SimpleFormShell
      title="Health & Vaccine" batches={ctx.batches} batchId={batchId} setBatchId={(id) => setBatchId(id || null)}
      onBack={onBack} onSubmit={submit} submitting={submitting} error={error} canSubmit={treatment.trim().length > 0}
    >
      <label className="mb-1.5 block text-xs font-semibold text-muted">What was given *</label>
      <PickOrType
        options={HEALTH_TREATMENTS}
        value={treatment}
        onChange={setTreatment}
        placeholder="Choose a vaccine or treatment…"
        otherPlaceholder="Name the treatment"
        className="mb-2.5"
      />

      <div className="mb-2.5 grid grid-cols-2 gap-2.5">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted">How many treated</label>
          <Input className="h-14 text-base" type="number" inputMode="numeric" min="0" value={affected} onChange={(e) => setAffected(e.target.value)} placeholder="e.g. 200" />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted">Dose</label>
          <div className="flex gap-1.5">
            <Input
              type="number" inputMode="decimal" min="0" step="0.01"
              value={doseAmount} onChange={(e) => setDoseAmount(e.target.value)}
              placeholder="1" className="h-14 min-w-0 flex-1 text-base"
            />
            <select className={cn(controlClass, 'h-14 min-w-0 flex-1 text-base')} value={doseUnit} onChange={(e) => setDoseUnit(e.target.value)}>
              {DOSE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
      </div>

      <label className="mb-1.5 block text-xs font-semibold text-muted">Per (optional)</label>
      <Input className="mb-2.5 h-14 text-base" value={dosePer} onChange={(e) => setDosePer(e.target.value)} placeholder="e.g. each bird, litre of water" />

      <label className="mb-1.5 block text-xs font-semibold text-muted">Notes</label>
      <textarea className={cn(controlClass, 'h-auto min-h-24 resize-none py-3 text-base')} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Symptoms, who advised it, withdrawal period…" />
    </SimpleFormShell>
  );
}

/* Weight sampling. Several weights rather than one, because a sample of one
 * bird is not a sample — the average is computed here and stored alongside
 * the raw figures so nobody has to trust the arithmetic later. */
function WeightForm({ ctx, onBack }: { ctx: WorkerCtx; onBack: () => void }) {
  const { showToast } = useToast();
  const [batchId, setBatchId] = useState<string | null>(null);
  const [weights, setWeights] = useState<string[]>(['', '', '']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const numbers = weights.map((w) => Number(w)).filter((n) => Number.isFinite(n) && n > 0);
  const average = numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;

  async function submit() {
    if (!ctx.employee || !batchId) return;
    setSubmitting(true); setError('');
    const res = await apiClient.post('/api/records', {
      tenantId: ctx.tenantId, batchId, employeeId: ctx.employee.id, type: 'weight',
      data: { samples: numbers, averageKg: Number(average.toFixed(3)), sampleSize: numbers.length },
    });
    setSubmitting(false);
    if (!res.success) { setError(res.error || 'Could not save the record.'); return; }
    showToast(`Weight sample saved — average ${average.toFixed(2)} kg.`, 'success');
    onBack();
  }

  return (
    <SimpleFormShell
      title="Weight Sample" batches={ctx.batches} batchId={batchId} setBatchId={(id) => setBatchId(id || null)}
      onBack={onBack} onSubmit={submit} submitting={submitting} error={error} canSubmit={numbers.length > 0}
    >
      <p className="mb-2.5 text-sm leading-relaxed text-muted">Weigh a few and enter each one. The average is worked out for you.</p>
      {weights.map((w, i) => (
        <div key={i} className="mb-2 flex items-center gap-2.5">
          <span className="w-16 text-sm text-muted">Sample {i + 1}</span>
          <Input
            className="h-14 text-base" type="number" inputMode="decimal" step="0.01" min="0" placeholder="kg"
            value={w} onChange={(e) => setWeights((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
          />
        </div>
      ))}
      <Button variant="secondary" className="mt-1 w-full" onClick={() => setWeights((prev) => [...prev, ''])}>
        <Plus size={13} /> Another sample
      </Button>
      {numbers.length > 0 && (
        <div className="mt-3 rounded-xl bg-primary-soft p-3 text-base font-bold text-fg">
          Average: {average.toFixed(2)} kg <span className="text-xs font-medium text-muted">from {numbers.length} sample{numbers.length === 1 ? '' : 's'}</span>
        </div>
      )}
    </SimpleFormShell>
  );
}

/* Closing stock. Counts what is physically left of each store item and
 * records the variance against what the system believes.
 *
 * It deliberately does NOT adjust the lots. Correcting stock is an audited,
 * reason-required action an owner takes through PATCH
 * /api/inventory/lots/[id]; letting a closing count silently rewrite
 * quantities would move that correction to the one place nobody reviews. */
function StockCountForm({ ctx, onBack }: { ctx: WorkerCtx; onBack: () => void }) {
  const { showToast } = useToast();
  const [batchId, setBatchId] = useState<string | null>(null);
  const [stock, setStock] = useState<AvailableItem[] | null>(null);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!batchId) return;
    setStock(null);
    apiClient.get<AvailableItem[]>(`/api/inventory/available?tenantId=${ctx.tenantId}&batchId=${batchId}`).then((res) => {
      setStock(res.success ? res.data : []);
    });
  }, [batchId, ctx.tenantId]);

  const lines = Object.entries(counted)
    .filter(([, v]) => v !== '' && Number.isFinite(Number(v)))
    .map(([itemId, v]) => {
      const item = (stock ?? []).find((s) => s.id === itemId);
      const count = Math.trunc(Number(v));
      return { itemId, name: item?.name ?? itemId, unit: item?.unit ?? '', counted: count, systemQty: item?.qtyOnHand ?? 0, variance: count - (item?.qtyOnHand ?? 0) };
    });
  const discrepancies = lines.filter((l) => l.variance !== 0);

  async function submit() {
    if (!ctx.employee || !batchId) return;
    setSubmitting(true); setError('');
    const res = await apiClient.post('/api/records', {
      tenantId: ctx.tenantId, batchId, employeeId: ctx.employee.id, type: 'stock_count',
      data: { items: lines },
    });
    setSubmitting(false);
    if (!res.success) { setError(res.error || 'Could not save the count.'); return; }
    showToast(discrepancies.length > 0
      ? `Count saved — ${discrepancies.length} item${discrepancies.length === 1 ? '' : 's'} do not match the system.`
      : 'Count saved — everything matches.', discrepancies.length > 0 ? 'info' : 'success');
    onBack();
  }

  return (
    <SimpleFormShell
      title="Closing Stock" batches={ctx.batches} batchId={batchId} setBatchId={(id) => setBatchId(id || null)}
      onBack={onBack} onSubmit={submit} submitting={submitting} error={error} canSubmit={lines.length > 0}
    >
      <p className="mb-2.5 text-sm leading-relaxed text-muted">Count what is actually left in the store. Leave anything you did not count blank.</p>
      {stock === null && <div className="text-sm text-muted">Loading the store…</div>}
      {(stock ?? []).map((item) => {
        const value = counted[item.id] ?? '';
        const variance = value === '' ? null : Math.trunc(Number(value)) - item.qtyOnHand;
        return (
          <div key={item.id} className="mb-2.5">
            <div className="flex items-center gap-2.5">
              <span className="flex-1 text-base text-fg">{item.name}</span>
              <Input
                className="h-14 w-32 text-base" type="number" inputMode="numeric" min="0" placeholder={`${item.qtyOnHand} ${item.unit}`}
                value={value} onChange={(e) => setCounted((c) => ({ ...c, [item.id]: e.target.value }))}
              />
            </div>
            {variance !== null && variance !== 0 && (
              <p className="mt-0.5 text-xs text-warning">
                {variance > 0 ? `${variance} ${item.unit} more` : `${Math.abs(variance)} ${item.unit} less`} than the system says ({item.qtyOnHand} {item.unit})
              </p>
            )}
          </div>
        );
      })}
    </SimpleFormShell>
  );
}

function MortalityForm({ ctx, onBack, resubmitOf }: { ctx: WorkerCtx; onBack: () => void; resubmitOf?: ApiRecord }) {
  const { showToast } = useToast();
  // Resubmitting starts straight at the count/cause step — the batch is
  // already known from the rejected record, and re-picking it is one more
  // tap for information that hasn't changed. Back still reaches step 1 in
  // case it genuinely was the wrong batch.
  const [step, setStep] = useState(resubmitOf ? 2 : 1);
  const [batchId, setBatchId] = useState<string | null>(resubmitOf?.batchId ?? null);
  const [count, setCount] = useState(() => Math.max(0, Math.trunc(Number(resubmitOf?.data.count ?? resubmitOf?.data.deaths ?? 0))));
  const [cause, setCause] = useState<string>(() => (typeof resubmitOf?.data.cause === 'string' && resubmitOf.data.cause ? resubmitOf.data.cause : 'Unknown'));
  const [causeIsOther, setCauseIsOther] = useState(() => !!resubmitOf && !(MORTALITY_CAUSES as readonly string[]).includes(cause));
  const [photos, setPhotos] = useState<string[]>(() => (resubmitOf ? photosOf(resubmitOf) : []));
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const threshold = ctx.employee?.mortalityPhotoThreshold ?? 3;
  // Still just "at least one photo" once the threshold is met — several
  // photos task generalises the old "exactly one" rule, doesn't tighten it.
  const needsPhoto = count >= threshold;
  const batch = ctx.batches?.find((b) => b.id === batchId) ?? null;

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the same file be picked again (e.g. retake)
    if (!file || photos.length >= MAX_RECORD_PHOTOS) return;
    setPhotoBusy(true); setPhotoError('');
    try {
      const compressed = await compressImageFile(file);
      setPhotos((prev) => (prev.length >= MAX_RECORD_PHOTOS ? prev : [...prev, compressed]));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Couldn't add that photo");
    } finally {
      setPhotoBusy(false);
    }
  }
  function removePhoto(i: number) {
    setPhotos((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit() {
    if (!ctx.employee || !batchId) return;
    if (needsPhoto && photos.length === 0) { setError('A photo is required for this many deaths.'); return; }
    const photoProblem = firstInvalidPhoto(photos);
    if (photoProblem) { setError(photoProblem.message); return; }
    setSubmitting(true); setError('');
    const res = await apiClient.post<RecordPostResult>('/api/records', {
      tenantId: ctx.tenantId,
      batchId,
      employeeId: ctx.employee.id,
      type: 'mortality',
      data: { count, cause },
      photoUrls: photos,
      ...(resubmitOf ? { resubmitsRecordId: resubmitOf.id } : {}),
    });
    setSubmitting(false);
    if (!res.success) { setError(res.error || 'Failed to save record.'); return; }
    if (resubmitOf) showToast(...submissionToast(res.data, 'Resubmitted — sent back for approval.'));
    else showToast(...submissionToast(res.data, 'Mortality record saved.'));
    onBack();
  }

  return (
    <div className="screen-content">
      <div className="px-screen"><TopNav title={resubmitOf ? 'Fix and Resubmit' : 'Mortality Record'} showBack /></div>
      <div className="px-screen pt-4 pb-8">
        <StepTrack steps={['Batch', 'Count & Cause', 'Photo', 'Confirm']} step={step} />

        {step === 1 && (
          <div>
            <p className="mb-3 text-base font-semibold text-fg">Select batch:</p>
            <BatchPicker batches={ctx.batches} onPick={(id) => { setBatchId(id); setStep(2); }} />
          </div>
        )}

        {step === 2 && batch && (
          <div>
            <div className="mb-4">
              <p className="mb-2 text-sm text-muted">{batch.code} · System count: {batch.currentQty}</p>
              <div className="mb-4 flex items-center justify-center gap-4">
                <button type="button" onClick={() => setCount(Math.max(0, count - 1))} className="flex size-14 items-center justify-center rounded-2xl bg-surface text-3xl text-fg shadow-(--shadow-border)">−</button>
                <div className="text-center">
                  <div className={cn('font-display text-5xl leading-none font-medium', count > 0 ? 'text-danger' : 'text-fg')}>{count}</div>
                  <div className="text-sm text-muted">deaths</div>
                </div>
                <button type="button" onClick={() => setCount(count + 1)} className="flex size-14 items-center justify-center rounded-2xl bg-surface text-3xl text-fg shadow-(--shadow-border)">+</button>
              </div>
              {needsPhoto && (
                <div className="mb-2.5 flex items-center gap-1.5 rounded-lg bg-danger-soft px-3 py-2 text-xs font-semibold text-danger">
                  <AlertTriangle size={12} aria-hidden="true" /> Photo required for {threshold}+ deaths (your farm&apos;s threshold)
                </div>
              )}
            </div>
            <p className="mb-2 text-sm font-bold text-muted">Cause of death:</p>
            {/* Sourced from the shared list rather than a fourth inline copy —
                components/farm/vet.tsx had its own, this screen had its own,
                and a vet and a worker reporting the same death produced
                different strings, so the mortality report counted them
                separately. The tap-grid stays: it is faster than a select on a
                phone and this is the screen workers use most. "Other" is the
                escape hatch, and it reveals a text field. */}
            <div className={cn('mb-3.5 grid grid-cols-2 gap-2', causeIsOther && 'mb-2')}>
              {MORTALITY_CAUSES.map((c) => {
                const active = c === cause && !causeIsOther;
                return (
                  <button
                    key={c} type="button" onClick={() => { setCauseIsOther(false); setCause(c); }}
                    className={cn(
                      'min-h-12 rounded-lg px-2 text-sm font-semibold',
                      active ? 'bg-danger-soft text-danger ring-1 ring-danger' : 'bg-surface text-muted shadow-(--shadow-border)',
                    )}
                  >{c}</button>
                );
              })}
              <button
                type="button" onClick={() => { setCauseIsOther(true); setCause(''); }}
                className={cn(
                  'min-h-12 rounded-lg px-2 text-sm font-semibold',
                  causeIsOther ? 'bg-danger-soft text-danger ring-1 ring-danger' : 'bg-surface text-muted shadow-(--shadow-border)',
                )}
              >{OTHER_OPTION}…</button>
            </div>
            {causeIsOther && (
              <Input className="mb-3.5 h-14 text-base" value={cause} onChange={(e) => setCause(e.target.value)} placeholder="Describe the cause" autoFocus />
            )}
            <div className="flex gap-2">
              <Button variant="secondary" size="lg" className="h-14 flex-1" onClick={() => setStep(1)}>Back</Button>
              <Button size="lg" className="h-14 flex-[2]" onClick={() => setStep(needsPhoto ? 3 : 4)}>Next</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="mb-4 rounded-xl bg-danger-soft p-4 text-center">
              <Camera size={40} className="mb-2 text-danger" aria-hidden="true" />
              <p className="mb-1 text-base font-bold text-fg">Photo Evidence Required</p>
              <p className="text-sm leading-relaxed text-muted">Your farm requires a photo for {threshold}+ deaths. This helps with disease investigation. Up to {MAX_RECORD_PHOTOS} photos — different angles help.</p>
            </div>
            {photos.length > 0 && (
              <div className="mb-2.5 flex flex-wrap gap-2">
                {photos.map((url, i) => (
                  <div key={i} className="relative">
                    <button type="button" onClick={() => setLightbox(url)} className="block size-20 overflow-hidden rounded-xl border border-border">
                      <img src={url} alt={`Mortality evidence ${i + 1}`} className="size-full object-cover" />
                    </button>
                    <button
                      type="button" onClick={() => removePhoto(i)} aria-label={`Remove photo ${i + 1}`}
                      className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full bg-danger text-primary-fg shadow-(--shadow-border)"
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {photos.length < MAX_RECORD_PHOTOS && (
              <label className={cn(
                'mb-1 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary-soft text-base font-bold text-primary',
                photoBusy ? 'opacity-60' : 'cursor-pointer',
              )}>
                <Camera size={18} /> {photoBusy ? 'Adding…' : photos.length === 0 ? 'Take Photo' : 'Add another photo'}
                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" disabled={photoBusy} />
              </label>
            )}
            <p className="mb-2.5 text-center text-xs text-muted">{photos.length} of {MAX_RECORD_PHOTOS} photos</p>
            {photoError && <p className="mb-2.5 text-center text-xs text-danger">{photoError}</p>}
            <Button variant="secondary" className="mb-2.5 w-full" onClick={() => setStep(2)}>Back</Button>
            <Button size="lg" className="h-14 w-full" disabled={photos.length === 0} onClick={() => setStep(4)}>Continue with Photo{photos.length > 1 ? 's' : ''}</Button>
            <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} />
          </div>
        )}

        {step === 4 && batch && (
          <div>
            <div className="mb-4 rounded-xl bg-primary-soft p-4">
              <p className="mb-2 font-bold text-fg">{resubmitOf ? 'Confirm & Resubmit' : 'Confirm & Save'}</p>
              {[['Batch', batch.code], ['Deaths', `${count}`], ['Cause', cause], ['Photos', photos.length > 0 ? `${photos.length} attached` : needsPhoto ? 'Missing' : 'Not required']].map(([k, v]) => (
                <div key={k} className="mb-1 flex justify-between text-sm">
                  <span className="text-muted">{k}</span>
                  <span className="font-semibold text-fg">{v}</span>
                </div>
              ))}
            </div>
            {error && <p className="mb-2.5 text-sm text-danger">{error}</p>}
            <Button size="lg" className="mb-2 h-14 w-full" disabled={submitting} onClick={handleSubmit}>
              <Check size={14} /> {submitting ? 'Saving…' : resubmitOf ? 'Resubmit' : 'Save Record'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function PhysicalCountForm({ ctx, onBack, resubmitOf }: { ctx: WorkerCtx; onBack: () => void; resubmitOf?: ApiRecord }) {
  const { showToast } = useToast();
  const [batchId, setBatchId] = useState<string | null>(resubmitOf?.batchId ?? ctx.batches?.[0]?.id ?? null);
  const [physicalCount, setPhysicalCount] = useState(() => {
    const seeded = resubmitOf?.data.physicalCount ?? resubmitOf?.data.counted ?? resubmitOf?.data.count;
    return seeded === undefined || seeded === null ? '' : String(seeded);
  });
  const [reason, setReason] = useState(() => (typeof resubmitOf?.data.varianceReason === 'string' ? resubmitOf.data.varianceReason : ''));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!batchId && ctx.batches && ctx.batches.length > 0) setBatchId(ctx.batches[0].id);
  }, [ctx.batches, batchId]);

  const batch = ctx.batches?.find((b) => b.id === batchId) ?? null;
  const count = physicalCount === '' ? null : Number(physicalCount);
  const variance = count !== null && batch ? count - batch.currentQty : null;

  async function handleSubmit() {
    if (!ctx.employee || !batchId || count === null || !batch) return;
    setSubmitting(true); setError('');
    const res = await apiClient.post<RecordPostResult>('/api/records', {
      tenantId: ctx.tenantId,
      batchId,
      employeeId: ctx.employee.id,
      type: 'physical_count',
      data: { systemCount: batch.currentQty, physicalCount: count, variance, varianceReason: reason },
      ...(resubmitOf ? { resubmitsRecordId: resubmitOf.id } : {}),
    });
    setSubmitting(false);
    if (!res.success) { setError(res.error || 'Failed to save record.'); return; }
    if (resubmitOf) showToast(...submissionToast(res.data, 'Resubmitted — sent back for approval.'));
    else showToast(...submissionToast(res.data, 'Physical count saved.'));
    onBack();
  }

  return (
    <div className="screen-content">
      <div className="px-screen"><TopNav title={resubmitOf ? 'Fix and Resubmit' : 'Physical Count'} showBack /></div>
      <div className="px-screen pt-4 pb-8">
        {ctx.batches !== null && ctx.batches.length === 0 ? (
          <div className="rounded-xl bg-warning-soft px-4 py-3.5 text-sm text-muted">No batches are assigned to you yet.</div>
        ) : (
          <>
            <div className="mb-3.5">
              <label className="mb-1.5 block text-xs font-semibold text-muted">Select Batch</label>
              <select className={cn(controlClass, 'h-14 text-base')} value={batchId ?? ''} onChange={(e) => setBatchId(e.target.value)}>
                {(ctx.batches ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} – {b.name} ({b.currentQty} in system)</option>)}
              </select>
            </div>
            {batch && (
              <div className="mb-3.5 rounded-xl bg-surface p-3.5 shadow-(--shadow-border)">
                <div className="mb-2.5 flex justify-between">
                  <div className="text-center">
                    <div className="font-display text-4xl font-medium text-fg">{batch.currentQty}</div>
                    <div className="text-[11px] text-muted">System count</div>
                  </div>
                  <div className="text-center">
                    <div className="font-display text-4xl font-medium text-warning">{count ?? '—'}</div>
                    <div className="text-[11px] text-muted">Your count</div>
                  </div>
                  <div className="text-center">
                    <div className="font-display text-4xl font-medium text-danger">{variance !== null ? (variance > 0 ? `+${variance}` : variance) : '—'}</div>
                    <div className="text-[11px] text-muted">Variance</div>
                  </div>
                </div>
              </div>
            )}
            <div className="mb-3">
              <label className="mb-1.5 block text-xs font-semibold text-muted">Your Physical Count</label>
              <Input className="h-16 text-center text-3xl font-bold" type="number" placeholder="Enter count" value={physicalCount} onChange={(e) => setPhysicalCount(e.target.value)} />
            </div>
            <div className="mb-3.5">
              <label className="mb-1.5 block text-xs font-semibold text-muted">Reason for variance</label>
              <div className="grid grid-cols-2 gap-2">
                {['Suspected theft', 'Found extra', 'Uncounted deaths', 'Counting error'].map((r) => (
                  <button
                    key={r} type="button" onClick={() => setReason(r)}
                    className={cn(
                      'min-h-11 rounded-lg px-2 text-xs font-semibold',
                      r === reason ? 'bg-warning-soft text-warning ring-1 ring-warning' : 'bg-surface text-muted shadow-(--shadow-border)',
                    )}
                  >{r}</button>
                ))}
              </div>
            </div>
            <div className="mb-3.5 rounded-lg bg-warning-soft px-3 py-2.5 text-xs text-muted">
              This count <strong className="text-fg">does not change the system count</strong>. Your owner will review and approve any adjustments.
            </div>
            {error && <p className="mb-2.5 text-sm text-danger">{error}</p>}
            <Button size="lg" className="mb-2 h-14 w-full" disabled={submitting || count === null} onClick={handleSubmit}>
              <Check size={14} /> {submitting ? 'Saving…' : resubmitOf ? 'Resubmit' : 'Submit Count'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ── My Pay (payroll-and-gps task) ───────────────────────────────────────────
// Wired to GET /api/payroll/me — the worker's own payslips only. That route
// resolves the caller's employees row from the session itself (never a
// param this screen could tamper with), so "only my own pay" is a server
// guarantee, not a client-side filter. A 404 here means no employees row is
// linked to this login yet (same contract as GET /api/employees/me) — shown
// as its own message, not folded into the generic error, since the fix is
// "ask your admin to link your account," not "try again."
//
// Presented as a plain statement: one total, then one line per period —
// nothing to tap, nothing to configure, the way a payslip actually reads.
function periodLabel(startIso: string, endIso: string): string {
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

export function WorkerPayScreen() {
  const [payslips, setPayslips] = useState<ApiPayslip[] | null>(null);
  const [error, setError] = useState('');
  const [notLinked, setNotLinked] = useState(false);

  useEffect(() => {
    apiClient.get<ApiPayslip[]>('/api/payroll/me').then((res) => {
      if (res.success) { setPayslips(res.data); setError(''); setNotLinked(false); return; }
      if (res.error?.toLowerCase().includes('no employee record')) { setNotLinked(true); return; }
      setError(res.error || 'Could not load your payslips.');
    });
  }, []);

  const total = payslips?.reduce((sum, p) => sum + p.amountCents, 0) ?? 0;

  return (
    <div className="screen-content px-screen pt-4 pb-8">
      <h1 className="font-display mb-5 text-2xl font-medium text-fg">My Pay</h1>

      {notLinked && (
        <EmptyState
          icon={<Lock size={22} aria-hidden="true" />}
          title="No employee record linked"
          body="Your login isn't linked to an employee record yet, so there is no pay history to show. Ask your farm owner or manager to link your account."
        />
      )}

      {!notLinked && error && <p className="mb-3 text-sm text-danger">{error}</p>}

      {!notLinked && !error && payslips === null && (
        <div className="py-8 text-center text-sm text-muted">Loading…</div>
      )}

      {!notLinked && !error && payslips !== null && payslips.length === 0 && (
        <EmptyState
          icon={<DollarSign size={22} aria-hidden="true" />}
          title="No payslips yet"
          body="You haven't been paid in a payroll run yet. Payslips appear here as soon as your owner runs payroll for a period that includes you."
        />
      )}

      {!notLinked && !error && payslips !== null && payslips.length > 0 && (
        <>
          <div className="mb-4 rounded-xl bg-surface p-5 text-center shadow-(--shadow-border)">
            <p className="mb-1 text-xs font-medium tracking-widest text-muted uppercase">Total paid to date</p>
            <p className="font-display text-4xl font-medium text-primary">{formatMoney(total)}</p>
          </div>
          <p className="section-eyebrow mb-2">Payslip history</p>
          <div className="mb-6 overflow-hidden rounded-xl bg-surface shadow-(--shadow-border)">
            {payslips.map((p, i, arr) => (
              <div key={p.id} className={cn('flex items-center justify-between gap-3 px-4 py-3.5', i < arr.length - 1 && 'border-b border-border')}>
                <div className="flex items-center gap-3">
                  <Calendar size={16} className="shrink-0 text-subtle" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-fg">{periodLabel(p.periodStart, p.periodEnd)}</p>
                    <p className="text-[11px] text-muted">Gross pay — no deductions applied</p>
                  </div>
                </div>
                <span className="font-display text-lg font-medium text-primary">{formatMoney(p.amountCents)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function WorkerProfileScreen() {
  const { tenantId, employee, employeeError } = useWorkerContext();
  const [records, setRecords] = useState<ApiRecord[] | null>(null);
  const [batchLabel, setBatchLabelMap] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    if (!employee) return;
    apiClient.get<ApiRecord[]>(`/api/records?tenantId=${tenantId}&employeeId=${employee.id}`).then((res) => {
      if (res.success) setRecords(res.data.filter((r) => isToday(r.createdAt)));
    });
  }, [employee, tenantId]);

  useEffect(() => {
    apiClient.get<{ id: string; code: string }[]>(`/api/batches?tenantId=${tenantId}`).then((res) => {
      if (res.success) setBatchLabelMap(Object.fromEntries(res.data.map((b) => [b.id, b.code])));
    });
  }, [tenantId]);

  return (
    <div className="screen-content px-screen pt-4 pb-8">
      {/* Avatar */}
      <div className="mb-5 flex flex-col items-center">
        <div className="font-display mb-2.5 flex size-20 items-center justify-center rounded-full bg-primary-soft text-3xl font-medium text-primary ring-2 ring-primary/30">
          {employee ? employee.name.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2) : '…'}
        </div>
        <p className="font-display text-xl font-medium text-fg">{employee?.name ?? 'Loading…'}</p>
        <Badge variant="success" className="mt-1 capitalize">{employee?.role ?? 'worker'}</Badge>
      </div>

      {employeeError && <p className="mb-3.5 text-sm text-danger">{employeeError}</p>}

      {/* Today's records (real GET /api/records, not a mock sync-status list) */}
      <p className="section-eyebrow mb-2">Today&apos;s records</p>
      <div className="mb-5 overflow-hidden rounded-xl bg-surface shadow-(--shadow-border)">
        {records === null && <div className="p-3 text-sm text-muted">Loading…</div>}
        {records !== null && records.length === 0 && <div className="p-3 text-sm text-muted">No records submitted today.</div>}
        {records !== null && records.map((r, i, arr) => {
          const badge = RECORD_STATE_BADGE[recordApprovalState(r.data)];
          return (
            <div key={r.id} className={cn('px-4 py-3', i < arr.length - 1 && 'border-b border-border')}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-fg">{RECORD_TYPE_LABEL[r.type]?.label ?? r.type}</p>
                  <p className="text-[11px] text-muted">{batchLabel[r.batchId] ?? r.batchId.slice(0, 8)} · {timeOf(r.createdAt)}</p>
                </div>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </div>
              <PhotoStrip photos={photosOf(r)} onOpen={setLightbox} />
            </div>
          );
        })}
      </div>
      <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} />

      {/* (#376 Gap 5: the hardcoded "Settings" block that lived here —
          Language / High Contrast / Sync-on-WiFi rows styled as active
          settings — was deleted outright. Nothing backed them; showing a
          worker "Sync on WiFi only: On" implied a sync engine that does not
          exist. Real per-user preferences get this slot back when they land.) */}

      {/* Issue #322: this button had no onClick — dead control on the screen
          workers see most. Routes through the same app-wide logout the
          TopNav button uses. */}
      <Button variant="danger" size="lg" className="h-14 w-full" onClick={() => requestLogout()}>
        Sign Out
      </Button>
    </div>
  );
}
