'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useNav, TopNav, requestLogout } from './navigation';
import { useToast } from './ui-shared';
import { apiClient } from '@/lib/request';
import {
  Plus, Camera,
  ChevronRight, Wifi, Check, Lock, ClipboardList, DollarSign, Calendar,
  Wheat, AlertTriangle, Hash, Sunrise, Egg, Syringe, Scale, Package, Layers,
  type LucideIcon,
} from './icons';
import { formatMoney } from '@/lib/money';
import {
  splitNotes, displayStatus, STATUS_LABEL, statusChipClass,
  type ApiTask,
} from './tasks';
import {
  OTHER_OPTION, MORTALITY_CAUSES, HEALTH_TREATMENTS, DOSE_UNITS, formatDose,
} from '@/lib/record-vocabulary';

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

// These five were listed as "Coming Soon" because the backend accepted three
// record types. It accepts all of them now (worker-routines task), so they are
// real tiles — and the greyed-out group is gone rather than kept as an empty
// shell. "Morning Round" is not in this list because it is not one fixed
// thing: rounds are defined by the owner (Settings › Daily routines) and each
// one gets its own tile on the record screen.
const EXTRA_RECORD_TYPES = [
  { type: 'production', label: 'Collect', icon: Egg },
  { type: 'health', label: 'Health', icon: Syringe },
  { type: 'weight', label: 'Weight', icon: Scale },
  { type: 'stock_count', label: 'Closing Stock', icon: Package },
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
// (lib/governance.ts).
//
// Both worker history lists used to show an unconditional "SAVED" chip. For a
// deferred mortality that was simply untrue — the worker walks away believing
// the count came down, and it did not. The three states are distinct and the
// worker needs to be able to tell them apart, so they are rendered apart.
function recordApprovalState(data: Record<string, unknown>): 'pending' | 'rejected' | 'applied' {
  if (data.pendingApproval === true) return 'pending';
  if (data.approvalDecision === 'rejected') return 'rejected';
  return 'applied';
}

const RECORD_STATE_CHIP: Record<'pending' | 'rejected' | 'applied', { label: string; cls: string }> = {
  pending: { label: 'WAITING', cls: 'chip chip-warning' },
  rejected: { label: 'REJECTED', cls: 'chip chip-critical' },
  applied: { label: 'SAVED', cls: 'chip chip-ok' },
};

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
function PickOrType({ options, value, onChange, placeholder, otherPlaceholder, style }: {
  options: readonly string[];
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  otherPlaceholder: string;
  style?: React.CSSProperties;
}) {
  // "Is this value one of the options" is the only state worth deriving; an
  // explicit `isOther` flag alongside `value` would let the two disagree.
  const listed = value !== '' && options.includes(value);
  const [showOther, setShowOther] = useState(value !== '' && !listed);

  return (
    <div style={style}>
      <select
        className="farm-input"
        value={showOther ? OTHER_OPTION : value}
        onChange={(e) => {
          if (e.target.value === OTHER_OPTION) { setShowOther(true); onChange(''); return; }
          setShowOther(false);
          onChange(e.target.value);
        }}
        style={{ marginBottom: showOther ? 8 : 0 }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value={OTHER_OPTION}>{OTHER_OPTION}…</option>
      </select>
      {showOther && (
        <input
          className="farm-input"
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

// ── "My Tasks Today" (issue #303) ───────────────────────────────────────────
// Restores the original Happy Seeds design's Worker Home checklist ("what do
// I still need to do today"), dropped when this screen was wired to real data
// (issue #248) and replaced with "Recent Activity" ("what did I just do") —
// a good addition, but not a substitute. Sourced from the same GET /api/tasks
// (issue #227, extended #243/#244) the Tasks/Governance screens already use;
// the server-side `due=today` filter is the exact one built for this
// purpose (see app/api/tasks/route.ts's header comment). There's no
// `assigneeId` column on `tasks`, so — exactly like components/farm/tasks.tsx
// — the assignee's name is parsed back out of `notes`'s "Assigned: <name>"
// prefix via the shared `splitNotes` helper; a task counts as "mine" when
// that name matches the logged-in worker's own employee name.
export function selectMyTasksToday(tasks: ApiTask[], workerName: string): ApiTask[] {
  const name = workerName.trim().toLowerCase();
  if (!name) return [];
  return tasks.filter((t) => splitNotes(t.notes).assignee.trim().toLowerCase() === name);
}

export function WorkerHomeScreen() {
  const { navigate } = useNav();
  const { tenantId, employee, employeeError, batches } = useWorkerContext();
  const { showToast } = useToast();
  const [recent, setRecent] = useState<ApiRecord[] | null>(null);
  const [batchLabel, setBatchLabel] = useState<Record<string, string>>({});
  const [tasksToday, setTasksToday] = useState<ApiTask[] | null>(null);
  const [taskActionId, setTaskActionId] = useState<string | null>(null);

  useEffect(() => {
    if (!employee) return;
    apiClient.get<ApiRecord[]>(`/api/records?tenantId=${tenantId}&employeeId=${employee.id}`).then((res) => {
      if (res.success) setRecent(res.data.slice(0, 5));
    });
  }, [employee, tenantId]);

  const loadTasksToday = useCallback(() => {
    if (!employee) return;
    apiClient.get<ApiTask[]>(`/api/tasks?tenantId=${tenantId}&due=today`).then((res) => {
      if (res.success) setTasksToday(selectMyTasksToday(res.data, employee.name));
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

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const doneTodayTypes = new Set((recent ?? []).filter((r) => isToday(r.createdAt)).map((r) => r.type));

  return (
    <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
      {/* Greeting */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{greeting}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 'var(--fs-2xl)', fontWeight: 700, color: 'var(--text-primary)' }}>
          {employee?.name ?? '…'} <Wheat size={19} color="var(--primary-green)" aria-hidden="true" />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'rgba(96,165,250,0.1)', borderRadius: 100, border: '1px solid rgba(96,165,250,0.25)' }}>
            <Wifi size={11} color="var(--accent-blue)" />
            <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--accent-blue)' }}>Online</span>
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
        </div>
      </div>

      {employeeError && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 14 }}>{employeeError}</div>}

      {/* My Tasks Today — real GET /api/tasks?due=today, filtered to this
          worker via the "Assigned: <name>" notes convention (issue #303) */}
      <div className="section-eyebrow" style={{ marginBottom: 10 }}>My Tasks Today</div>
      <div className="farm-card" style={{ marginBottom: 14, overflow: 'hidden' }}>
        {tasksToday === null && <div style={{ padding: 14, fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Loading…</div>}
        {tasksToday !== null && tasksToday.length === 0 && (
          <div style={{ padding: 14, fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Nothing due today — all caught up.</div>
        )}
        {tasksToday !== null && tasksToday.map((t, i) => {
          const status = displayStatus(t);
          const done = t.status === 'DONE';
          const pendingApproval = status === 'PENDING_APPROVAL';
          return (
            <div key={t.id} style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: i < tasksToday.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: done ? 'rgba(74,222,128,0.12)' : 'var(--surface)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <ClipboardList size={16} color={done ? 'var(--status-ok)' : 'var(--text-muted)'} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-base)', fontWeight: 600, color: done ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: done ? 'line-through' : 'none' }}>{t.title}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 'var(--fs-xs)', color: status === 'OVERDUE' ? 'var(--status-critical)' : 'var(--text-dim)' }}>Due {timeOf(t.dueAt)}</span>
                  {!done && !pendingApproval && (
                    <span className={`chip ${statusChipClass(status)}`} style={{ fontSize: 'var(--fs-2xs)' }}>{STATUS_LABEL[status] ?? status}</span>
                  )}
                  {pendingApproval && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-warning)' }}>Pending approval</span>}
                  {done && <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 'var(--fs-xs)', color: 'var(--status-ok)' }}><Check size={11} aria-hidden="true" /> Done</span>}
                </div>
              </div>
              {!done && !pendingApproval && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => markTaskDone(t)} disabled={taskActionId === t.id} style={{
                    padding: '7px 10px', borderRadius: 8, fontSize: 'var(--fs-xs)', fontWeight: 700,
                    background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)',
                    color: 'var(--primary-green)', cursor: taskActionId === t.id ? 'default' : 'pointer',
                  }} title="Mark this task done">
                    <Check size={12} />
                  </button>
                  <button onClick={() => navigate('worker-record')} style={{
                    padding: '7px 12px', borderRadius: 8, fontSize: 'var(--fs-xs)', fontWeight: 700,
                    background: 'var(--card)', border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)', cursor: 'pointer',
                  }}>Open</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent activity (real GET /api/records, not a task mock) */}
      <div className="section-eyebrow" style={{ marginBottom: 10 }}>Recent Activity</div>
      <div className="farm-card" style={{ marginBottom: 14, overflow: 'hidden' }}>
        {recent === null && <div style={{ padding: 14, fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Loading…</div>}
        {recent !== null && recent.length === 0 && (
          <div style={{ padding: 14, fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>No records submitted yet — use Quick Record below.</div>
        )}
        {recent !== null && recent.map((r, i) => (
          <div key={r.id} style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: i < recent.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: 'rgba(74,222,128,0.12)', color: 'var(--primary-green)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {(() => { const RecordIcon = RECORD_TYPE_LABEL[r.type]?.icon ?? ClipboardList; return <RecordIcon size={17} aria-hidden="true" />; })()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--text-primary)' }}>{RECORD_TYPE_LABEL[r.type]?.label ?? r.type}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)' }}>{batchLabel[r.batchId] ?? r.batchId.slice(0, 8)}</span>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-ok)' }}>{timeOf(r.createdAt)}</span>
                {recordApprovalState(r.data) === 'pending' && (
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-warning)' }}>Waiting for approval</span>
                )}
                {recordApprovalState(r.data) === 'rejected' && (
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)' }}>Not approved</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Record tiles */}
      <div className="section-eyebrow" style={{ marginBottom: 10 }}>Quick Record</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        {Object.entries(RECORD_TYPE_LABEL).map(([type, meta]) => (
          <button key={type} onClick={() => navigate('worker-record', { type })} style={{
            padding: '12px 4px', borderRadius: 14, background: doneTodayTypes.has(type) ? 'rgba(74,222,128,0.08)' : 'var(--card)',
            border: doneTodayTypes.has(type) ? '1px solid rgba(74,222,128,0.25)' : '1px solid var(--border-subtle)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer', position: 'relative',
          }}>
            {doneTodayTypes.has(type) && <div style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: '50%', background: 'var(--status-ok)' }} />}
            <meta.icon size={26} color={doneTodayTypes.has(type) ? 'var(--primary-green)' : 'var(--text-muted)'} aria-hidden="true" />
            <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: doneTodayTypes.has(type) ? 'var(--primary-green)' : 'var(--text-muted)', textAlign: 'center', lineHeight: 1.3 }}>{meta.label}</span>
          </button>
        ))}
      </div>
      {/* Was a row of greyed-out "Not available yet" squares. They all work
         now, so they are ordinary quick-record buttons like the ones above. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 20 }}>
        {EXTRA_RECORD_TYPES.map((tile) => (
          <button key={tile.type} onClick={() => navigate('worker-record', { type: tile.type })} style={{
            padding: '12px 4px', borderRadius: 14, background: 'var(--card)',
            border: '1px solid var(--border-subtle)', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          }}>
            <tile.icon size={26} color="var(--text-muted)" aria-hidden="true" />
            <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.3 }}>{tile.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// worker.tsx's Home "Quick Record" tiles and this screen's own chooser below
// used to render the exact same three tiles (feeding/mortality/physical
// count) with no connection between them: tapping one on Home landed here
// only to show the identical three tiles again before the real form opened
// — a redundant extra tap, the "opens a page that just shows the same
// navigation again" pattern. Home now passes `type` (the record's real API
// type string, e.g. 'physical_count'); this screen normalises that to its
// own internal form key ('count') and opens the form directly, skipping the
// chooser. Reaching this screen with no `type` (its own bottom tab) still
// shows the chooser — that's its one legitimate, unambiguous entry point.
const RECORD_TYPE_TO_FORM: Record<string, string> = {
  feeding: 'feeding', mortality: 'mortality', physical_count: 'count', count: 'count',
  production: 'collect', collect: 'collect', health: 'health', weight: 'weight',
  stock_count: 'stock', stock: 'stock',
};

export function WorkerRecordScreen() {
  const { params, tenantId } = useNav();
  const ctx = useWorkerContext();
  const [activeForm, setActiveForm] = useState<null | string>(() => RECORD_TYPE_TO_FORM[params.type] ?? null);
  // The owner's rounds. Fetched here rather than baked in, because what a
  // round consists of is a property of the farm — see db/schemas/people.ts.
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [activeRoutine, setActiveRoutine] = useState<Routine | null>(null);

  useEffect(() => {
    apiClient.get<Routine[]>(`/api/routines?tenantId=${tenantId}`).then((res) => {
      setRoutines(res.success ? res.data.filter((r) => r.active) : []);
    });
  }, [tenantId]);

  if (!ctx.employee) {
    return (
      <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
        {ctx.employeeError ? (
          <div style={{ fontSize: 'var(--fs-base)', color: 'var(--status-critical)' }}>{ctx.employeeError}</div>
        ) : (
          <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text-dim)' }}>Loading…</div>
        )}
      </div>
    );
  }

  if (activeRoutine) return <RoutineRunner ctx={ctx} routine={activeRoutine} onBack={() => setActiveRoutine(null)} />;
  if (activeForm === 'feeding') return <FeedingForm ctx={ctx} onBack={() => setActiveForm(null)} />;
  if (activeForm === 'mortality') return <MortalityForm ctx={ctx} onBack={() => setActiveForm(null)} />;
  if (activeForm === 'count') return <PhysicalCountForm ctx={ctx} onBack={() => setActiveForm(null)} />;
  if (activeForm === 'collect') return <CollectProductsForm ctx={ctx} onBack={() => setActiveForm(null)} />;
  if (activeForm === 'health') return <HealthForm ctx={ctx} onBack={() => setActiveForm(null)} />;
  if (activeForm === 'weight') return <WeightForm ctx={ctx} onBack={() => setActiveForm(null)} />;
  if (activeForm === 'stock') return <StockCountForm ctx={ctx} onBack={() => setActiveForm(null)} />;

  const GROUPS = [
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

  return (
    <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text-primary)' }}>Record</div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 2 }}>Choose what to log</div>
      </div>

      {GROUPS.map((g) => (
        <div key={g.label} style={{ marginBottom: 16 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>{g.label}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {g.tiles.map((tile) => (
              <button key={tile.type} onClick={() => setActiveForm(tile.type)}
                className="farm-card" style={{ padding: 14, textAlign: 'left', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, background: 'var(--surface)', color: 'var(--primary-green)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}><tile.icon size={22} aria-hidden="true" /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)' }}>{tile.label}</div>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 2 }}>{tile.desc}</div>
                </div>
                <ChevronRight size={16} color="var(--text-dim)" />
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* The owner's rounds, each as its own tile. Nothing is shown when none
         are set up — an empty "Rounds" heading over nothing would read as
         something failing to load. */}
      {routines !== null && routines.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Rounds</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {routines.map((routine) => (
              <button key={routine.id} onClick={() => setActiveRoutine(routine)}
                className="farm-card" style={{ padding: 14, textAlign: 'left', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface)', color: 'var(--primary-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Sunrise size={22} aria-hidden="true" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)' }}>{routine.name}</div>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 2 }}>
                    {routine.steps.length} step{routine.steps.length === 1 ? '' : 's'}
                    {routine.timeOfDay !== 'any' ? ` · ${routine.timeOfDay}` : ''}
                  </div>
                </div>
                <ChevronRight size={16} color="var(--text-dim)" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type WorkerCtx = ReturnType<typeof useWorkerContext>;

function BatchPicker({ batches, onPick }: { batches: ApiBatch[] | null; onPick: (id: string) => void }) {
  if (batches === null) return <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Loading your batches…</div>;
  if (batches.length === 0) {
    return (
      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
        No batches are assigned to you yet. Ask your manager to assign one before submitting records.
      </div>
    );
  }
  return (
    <div>
      {batches.map((b) => (
        <button key={b.id} onClick={() => onPick(b.id)} style={{
          width: '100%', padding: '14px 16px', marginBottom: 8, borderRadius: 12, textAlign: 'left', cursor: 'pointer',
          background: 'var(--card)', border: '1px solid var(--border-subtle)',
          fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--text-primary)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}><Layers size={15} color="var(--text-muted)" aria-hidden="true" /> {b.code} – {b.name}</button>
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
      <div style={{ padding: '0 20px' }}>
        <TopNav title="Feeding Record" showBack />
      </div>
      <div className="px-screen" style={{ paddingTop: 16 }}>
        <div style={{ display: 'flex', gap: 0, marginBottom: 20 }}>
          {['Batches','Feed','Confirm'].map((s, i) => (
            <React.Fragment key={s}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <div className={`step-node ${i + 1 < step ? 'done' : i + 1 === step ? 'active' : 'pending'}`} style={{ width: 24, height: 24, fontSize: 'var(--fs-2xs)' }}>{i + 1 < step ? <Check size={12} aria-hidden="true" /> : i + 1}</div>
                <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: step === i + 1 ? 'var(--primary-green)' : 'var(--text-dim)' }}>{s}</span>
              </div>
              {i < 2 && <div className={`step-line ${i + 1 < step ? 'done' : ''}`} style={{ marginTop: 12 }} />}
            </React.Fragment>
          ))}
        </div>

        {step === 1 && (
          <div>
            <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Which batches are you feeding?</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
              Pick every batch getting feed from the same bag — you enter how much each one gets on the next step.
            </div>
            <MultiBatchPicker batches={ctx.batches} selected={batchIds} onToggle={toggleBatch} />
            <button
              className="btn-primary"
              disabled={batchIds.length === 0}
              style={{ width: '100%', justifyContent: 'center', borderRadius: 12, marginTop: 12, opacity: batchIds.length === 0 ? 0.5 : 1 }}
              onClick={() => setStep(2)}
            >
              Continue{batchIds.length > 0 ? ` with ${batchIds.length}` : ''}
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 10 }}>
              {chosenBatches.map((b) => b.code).join(' · ')}
            </div>

            {stockError && (
              <div style={{ padding: '10px 12px', marginBottom: 10, borderRadius: 10, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', fontSize: 'var(--fs-sm)', color: 'var(--status-critical)' }}>{stockError}</div>
            )}
            {stock === null && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)', marginBottom: 10 }}>Loading what is in stock…</div>}
            {stock !== null && stock.length === 0 && !stockError && (
              <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
                There is no stock recorded for this farm yet. Ask your manager to add the feed to the store before recording a feeding.
              </div>
            )}

            {stock !== null && stock.length > 6 && (
              <input className="farm-input" placeholder="Search feed…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 10 }} />
            )}

            {lines.map((line, i) => {
              const item = (stock ?? []).find((s) => s.id === line.itemId) ?? null;
              const left = item ? remainingAfterForm(item) : null;
              return (
                <div key={i} className="farm-card" style={{ padding: 14, marginBottom: 8 }}>
                  <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Feed from store</label>
                  <select className="farm-input" value={line.itemId} onChange={(e) => setLineItem(i, e.target.value)} style={{ marginBottom: 8 }}>
                    <option value="">Choose an item…</option>
                    {visibleStock.map((s) => (
                      <option key={s.id} value={s.id} disabled={s.qtyOnHand <= 0}>
                        {s.name} — {s.qtyOnHand} {s.unit} left{s.qtyOnHand <= 0 ? ' (out of stock)' : ''}
                      </option>
                    ))}
                  </select>

                  {item && (
                    <div style={{
                      fontSize: 'var(--fs-2xs)', lineHeight: 1.5, marginBottom: 8,
                      color: left !== null && left < 0 ? 'var(--status-critical)' : left !== null && left <= item.lowStockThreshold ? 'var(--status-warning)' : 'var(--text-muted)',
                    }}>
                      {left !== null && left < 0
                        ? `That is ${Math.abs(left)} ${item.unit} more than the farm has.`
                        : `${left} ${item.unit} will be left after this.`}
                      {item.nextExpiry && ` · Oldest stock expires ${new Date(item.nextExpiry).toLocaleDateString()}`}
                    </div>
                  )}

                  {chosenBatches.map((b) => (
                    <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{b.code}</span>
                      <input
                        className="farm-input" type="number" inputMode="decimal" min="0"
                        placeholder={item ? item.unit : 'qty'}
                        value={line.perBatch[b.id] ?? ''}
                        onChange={(e) => setLineQty(i, b.id, e.target.value)}
                        style={{ width: 110 }}
                      />
                    </div>
                  ))}

                  {lines.length > 1 && (
                    <button
                      onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                      style={{ marginTop: 4, padding: '6px 10px', borderRadius: 8, fontSize: 'var(--fs-2xs)', fontWeight: 700, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', color: 'var(--status-critical)', cursor: 'pointer' }}
                    >Remove</button>
                  )}
                </div>
              );
            })}

            <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center', marginBottom: 14 }} onClick={() => setLines((prev) => [...prev, { itemId: '', perBatch: {} }])}>
              <Plus size={13} /> Add another feed
            </button>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center', borderRadius: 12 }} onClick={() => setStep(1)}>Back</button>
              <button
                className="btn-primary"
                disabled={filledLines.length === 0 || overIssued.length > 0}
                style={{ flex: 2, justifyContent: 'center', borderRadius: 12, opacity: filledLines.length === 0 || overIssued.length > 0 ? 0.5 : 1 }}
                onClick={() => setStep(3)}
              >Review</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ padding: '14px', background: 'rgba(74,222,128,0.06)', borderRadius: 14, border: '1px solid rgba(74,222,128,0.2)', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 'var(--fs-md)', marginBottom: 10 }}>Summary</div>
              {filledLines.map((line, i) => {
                const item = (stock ?? []).find((s) => s.id === line.itemId);
                return (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-base)', marginBottom: 3 }}>
                      <span style={{ color: 'var(--text-muted)' }}>{item?.name ?? 'Item'}</span>
                      <span style={{ fontWeight: 700 }}>{totalOf(line)} {item?.unit}</span>
                    </div>
                    {chosenBatches.map((b) => {
                      const qty = Number(line.perBatch[b.id]) || 0;
                      if (qty <= 0) return null;
                      return (
                        <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-xs)', color: 'var(--text-dim)' }}>
                          <span>{b.code}</span><span>{qty} {item?.unit}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
                Saving this takes the feed out of the store — the oldest stock is used first.
              </div>
            </div>
            {error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center', borderRadius: 12 }} onClick={() => setStep(2)}>Back</button>
              <button className="btn-primary" disabled={submitting} style={{ flex: 2, justifyContent: 'center', borderRadius: 12, opacity: submitting ? 0.7 : 1 }} onClick={handleSubmit}>
                <Check size={14} /> {submitting ? 'Saving…' : 'Save Record'}
              </button>
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
  if (batches === null) return <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Loading your batches…</div>;
  if (batches.length === 0) {
    return (
      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
        No batches are assigned to you yet. Ask your manager to assign one before submitting records.
      </div>
    );
  }
  return (
    <div>
      {batches.map((b) => {
        const on = selected.includes(b.id);
        return (
          <button key={b.id} onClick={() => onToggle(b.id)} style={{
            width: '100%', padding: '14px 16px', marginBottom: 8, borderRadius: 12, textAlign: 'left', cursor: 'pointer',
            background: on ? 'rgba(74,222,128,0.12)' : 'var(--card)',
            border: on ? '1px solid var(--primary-green)' : '1px solid var(--border-subtle)',
            fontSize: 'var(--fs-base)', fontWeight: 600, color: on ? 'var(--primary-green)' : 'var(--text-primary)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {on ? <Check size={15} aria-hidden="true" /> : <Layers size={15} color="var(--text-muted)" aria-hidden="true" />}
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
    apiClient.get<{ productId: string; name: string }[]>(`/api/batches/${batchId}/products?tenantId=${ctx.tenantId}`).then((res) => {
      if (res.success) setProductList(res.data.map((p) => ({ id: p.productId, name: p.name })));
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

  const missingRequired = routine.steps.filter((s) => s.required && !skipped[s.id] && !isAnswered(s));

  async function submit() {
    if (!ctx.employee || !batchId) return;
    setSubmitting(true); setError('');

    const completed: Record<string, unknown> = {};
    const failures: string[] = [];

    for (const step of routine.steps) {
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
      skippedCount: routine.steps.filter((s) => skipped[s.id] || !isAnswered(s)).length,
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
      <div style={{ padding: '0 20px' }}>
        <TopNav title={routine.name} showBack />
      </div>
      <div className="px-screen" style={{ paddingTop: 16, paddingBottom: 90 }}>
        {!batchId ? (
          <>
            <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, marginBottom: 12 }}>Which batch is this round for?</div>
            <BatchPicker batches={ctx.batches} onPick={setBatchId} />
          </>
        ) : (
          <>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 14 }}>
              {ctx.batches?.find((b) => b.id === batchId)?.code}
              <button onClick={() => setBatchId(null)} style={{ marginLeft: 8, fontSize: 'var(--fs-2xs)', background: 'none', border: 'none', color: 'var(--primary-green)', cursor: 'pointer', fontWeight: 700 }}>change</button>
            </div>

            {routine.steps.length === 0 && (
              <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Nobody has said what this round involves yet. Ask your manager to add the steps.
              </div>
            )}

            {routine.steps.map((step, i) => {
              const done = isAnswered(step);
              const isSkipped = !!skipped[step.id];
              return (
                <div key={step.id} className="farm-card" style={{
                  padding: 14, marginBottom: 10, opacity: isSkipped ? 0.55 : 1,
                  borderLeft: `3px solid ${done ? 'var(--primary-green)' : step.required ? 'var(--status-warning)' : 'var(--border-subtle)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isSkipped ? 0 : 10 }}>
                    <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 800, color: 'var(--text-dim)' }}>{i + 1}</span>
                    <span style={{ flex: 1, fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)' }}>{step.label}</span>
                    {done && <Check size={14} color="var(--primary-green)" />}
                    {!step.required && (
                      <button
                        onClick={() => setSkipped((sk) => ({ ...sk, [step.id]: !sk[step.id] }))}
                        style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}
                      >{isSkipped ? 'undo' : 'skip'}</button>
                    )}
                  </div>

                  {!isSkipped && step.kind === 'feeding' && (
                    <>
                      <select className="farm-input" value={field(step.id, 'itemId')} onChange={(e) => setField(step.id, 'itemId', e.target.value)} style={{ marginBottom: 8 }}>
                        <option value="">Choose feed from the store…</option>
                        {(stock ?? []).map((s) => (
                          <option key={s.id} value={s.id} disabled={s.qtyOnHand <= 0}>
                            {s.name} — {s.qtyOnHand} {s.unit} left
                          </option>
                        ))}
                      </select>
                      <input className="farm-input" type="number" inputMode="decimal" min="0" placeholder="How much" value={field(step.id, 'qty')} onChange={(e) => setField(step.id, 'qty', e.target.value)} />
                    </>
                  )}

                  {!isSkipped && step.kind === 'mortality' && (
                    <>
                      <input className="farm-input" type="number" inputMode="numeric" min="0" placeholder="How many died (0 if none)" value={field(step.id, 'count')} onChange={(e) => setField(step.id, 'count', e.target.value)} style={{ marginBottom: 8 }} />
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
                    <input className="farm-input" type="number" inputMode="numeric" min="0" placeholder="How many did you count" value={field(step.id, 'counted')} onChange={(e) => setField(step.id, 'counted', e.target.value)} />
                  )}

                  {!isSkipped && step.kind === 'production' && (
                    productList.length === 0
                      ? <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>This batch has no products set up yet.</div>
                      : productList.map((p) => (
                        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                          <span style={{ flex: 1, fontSize: 'var(--fs-sm)' }}>{p.name}</span>
                          <input className="farm-input" type="number" inputMode="numeric" min="0" placeholder="0" style={{ width: 100 }}
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
                        style={{ marginBottom: 8 }}
                      />
                      <input className="farm-input" placeholder="Notes" value={field(step.id, 'notes')} onChange={(e) => setField(step.id, 'notes', e.target.value)} />
                    </>
                  )}

                  {!isSkipped && step.kind === 'weight' && (
                    <input className="farm-input" type="number" inputMode="decimal" step="0.01" min="0" placeholder="Weight in kg" value={field(step.id, 'weight')} onChange={(e) => setField(step.id, 'weight', e.target.value)} />
                  )}

                  {!isSkipped && step.kind === 'check' && (
                    <>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        {[['yes', 'All good'], ['no', 'Problem']].map(([value, label]) => (
                          <button key={value} onClick={() => setField(step.id, 'done', value)}
                            style={{
                              flex: 1, padding: '10px', borderRadius: 10, fontSize: 'var(--fs-sm)', fontWeight: 700, cursor: 'pointer',
                              background: field(step.id, 'done') === value ? (value === 'yes' ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.12)') : 'var(--card)',
                              border: field(step.id, 'done') === value ? `1px solid ${value === 'yes' ? 'var(--primary-green)' : 'var(--status-critical)'}` : '1px solid var(--border-subtle)',
                              color: field(step.id, 'done') === value ? (value === 'yes' ? 'var(--primary-green)' : 'var(--status-critical)') : 'var(--text-muted)',
                            }}>{label}</button>
                        ))}
                      </div>
                      {field(step.id, 'done') === 'no' && (
                        <input className="farm-input" placeholder="What is wrong?" value={field(step.id, 'note')} onChange={(e) => setField(step.id, 'note', e.target.value)} />
                      )}
                    </>
                  )}
                </div>
              );
            })}

            {missingRequired.length > 0 && (
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-warning)', marginBottom: 10, lineHeight: 1.5 }}>
                Still to do: {missingRequired.map((s) => s.label).join(', ')}
              </div>
            )}
            {error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10, lineHeight: 1.5 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center', borderRadius: 12 }} onClick={onBack}>Cancel</button>
              <button
                className="btn-primary" disabled={submitting || missingRequired.length > 0 || routine.steps.length === 0}
                style={{ flex: 2, justifyContent: 'center', borderRadius: 12, opacity: submitting || missingRequired.length > 0 ? 0.6 : 1 }}
                onClick={submit}
              >
                <Check size={14} /> {submitting ? 'Saving…' : `Finish ${routine.name}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── The rest of the worker's record types (worker-routines task) ───────────
 * These five were "Coming Soon" tiles: honest when written, because the
 * backend accepted three record types — and then the reason the work went
 * unrecorded. POST /api/records takes all of them now, each mapped to the
 * permission module that already governs it.
 *
 * They share a deliberately plain shape: pick a batch, fill in the numbers,
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
      <div style={{ padding: '0 20px' }}>
        <TopNav title={title} showBack />
      </div>
      <div className="px-screen" style={{ paddingTop: 16, paddingBottom: 90 }}>
        {!batchId ? (
          <>
            <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, marginBottom: 12 }}>Which batch?</div>
            <BatchPicker batches={batches} onPick={setBatchId} />
          </>
        ) : (
          <>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 12 }}>
              {batches?.find((b) => b.id === batchId)?.code}
              <button onClick={() => setBatchId('')} style={{ marginLeft: 8, fontSize: 'var(--fs-2xs)', background: 'none', border: 'none', color: 'var(--primary-green)', cursor: 'pointer', fontWeight: 700 }}>change</button>
            </div>
            {children}
            {error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', margin: '10px 0' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center', borderRadius: 12 }} onClick={onBack}>Cancel</button>
              <button className="btn-primary" disabled={submitting || !canSubmit} style={{ flex: 2, justifyContent: 'center', borderRadius: 12, opacity: submitting || !canSubmit ? 0.6 : 1 }} onClick={onSubmit}>
                <Check size={14} /> {submitting ? 'Saving…' : 'Save Record'}
              </button>
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
    apiClient.get<{ productId: string; name: string }[]>(`/api/batches/${batchId}/products?tenantId=${ctx.tenantId}`).then((res) => {
      if (res.success) setProductList(res.data.map((p) => ({ id: p.productId, name: p.name })));
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
      {productList === null && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Loading this batch&apos;s products…</div>}
      {productList !== null && productList.length === 0 && (
        <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          This batch has no products set up. Ask your manager to add what it produces — eggs, milk, whatever it is — on the batch.
        </div>
      )}
      {(productList ?? []).map((p) => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ flex: 1, fontSize: 'var(--fs-base)', color: 'var(--text-primary)' }}>{p.name}</span>
          <input
            className="farm-input" type="number" inputMode="numeric" min="0" placeholder="0"
            value={qty[p.id] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [p.id]: e.target.value }))}
            style={{ width: 110 }}
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
      <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>What was given *</label>
      <PickOrType
        options={HEALTH_TREATMENTS}
        value={treatment}
        onChange={setTreatment}
        placeholder="Choose a vaccine or treatment…"
        otherPlaceholder="Name the treatment"
        style={{ marginBottom: 10 }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>How many treated</label>
          <input className="farm-input" type="number" inputMode="numeric" min="0" value={affected} onChange={(e) => setAffected(e.target.value)} placeholder="e.g. 200" />
        </div>
        <div>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Dose</label>
          {/* Amount and unit, not prose. 360px is the target width, so these
              two sit side by side inside the half-width column. */}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="farm-input" type="number" inputMode="decimal" min="0" step="0.01"
              value={doseAmount} onChange={(e) => setDoseAmount(e.target.value)}
              placeholder="1" style={{ flex: 1, minWidth: 0 }}
            />
            <select
              className="farm-input" value={doseUnit} onChange={(e) => setDoseUnit(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            >
              {DOSE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
      </div>

      <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Per (optional)</label>
      <input className="farm-input" value={dosePer} onChange={(e) => setDosePer(e.target.value)} placeholder="e.g. each bird, litre of water" style={{ marginBottom: 10 }} />

      <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Notes</label>
      <textarea className="farm-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Symptoms, who advised it, withdrawal period…" style={{ resize: 'none' }} />
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
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
        Weigh a few and enter each one. The average is worked out for you.
      </div>
      {weights.map((w, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ width: 70, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Sample {i + 1}</span>
          <input
            className="farm-input" type="number" inputMode="decimal" step="0.01" min="0" placeholder="kg"
            value={w} onChange={(e) => setWeights((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
          />
        </div>
      ))}
      <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }} onClick={() => setWeights((prev) => [...prev, ''])}>
        <Plus size={13} /> Another sample
      </button>
      {numbers.length > 0 && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)', fontSize: 'var(--fs-base)', fontWeight: 700 }}>
          Average: {average.toFixed(2)} kg <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>from {numbers.length} sample{numbers.length === 1 ? '' : 's'}</span>
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
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
        Count what is actually left in the store. Leave anything you did not count blank.
      </div>
      {stock === null && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Loading the store…</div>}
      {(stock ?? []).map((item) => {
        const value = counted[item.id] ?? '';
        const variance = value === '' ? null : Math.trunc(Number(value)) - item.qtyOnHand;
        return (
          <div key={item.id} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: 'var(--fs-base)', color: 'var(--text-primary)' }}>{item.name}</span>
              <input
                className="farm-input" type="number" inputMode="numeric" min="0" placeholder={`${item.qtyOnHand} ${item.unit}`}
                value={value} onChange={(e) => setCounted((c) => ({ ...c, [item.id]: e.target.value }))}
                style={{ width: 120 }}
              />
            </div>
            {variance !== null && variance !== 0 && (
              <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--status-warning)', marginTop: 3 }}>
                {variance > 0 ? `${variance} ${item.unit} more` : `${Math.abs(variance)} ${item.unit} less`} than the system says ({item.qtyOnHand} {item.unit})
              </div>
            )}
          </div>
        );
      })}
    </SimpleFormShell>
  );
}

function MortalityForm({ ctx, onBack }: { ctx: WorkerCtx; onBack: () => void }) {
  const { showToast } = useToast();
  const [step, setStep] = useState(1);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [cause, setCause] = useState<string>('Unknown');
  const [causeIsOther, setCauseIsOther] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const threshold = ctx.employee?.mortalityPhotoThreshold ?? 3;
  const needsPhoto = count >= threshold;
  const batch = ctx.batches?.find((b) => b.id === batchId) ?? null;

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoDataUrl(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    if (!ctx.employee || !batchId) return;
    if (needsPhoto && !photoDataUrl) { setError('A photo is required for this many deaths.'); return; }
    setSubmitting(true); setError('');
    const res = await apiClient.post<RecordPostResult>('/api/records', {
      tenantId: ctx.tenantId,
      batchId,
      employeeId: ctx.employee.id,
      type: 'mortality',
      data: { count, cause },
      photoUrl: photoDataUrl,
    });
    setSubmitting(false);
    if (!res.success) { setError(res.error || 'Failed to save record.'); return; }
    showToast(...submissionToast(res.data, 'Mortality record saved.'));
    onBack();
  }

  return (
    <div className="screen-content">
      <div className="px-screen">
        <TopNav title="Mortality Record" showBack />
      </div>
      <div className="px-screen" style={{ paddingTop: 16 }}>
        <div style={{ display: 'flex', gap: 0, marginBottom: 20 }}>
          {['Batch','Count & Cause','Photo','Confirm'].map((s, i) => (
            <React.Fragment key={s}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <div className={`step-node ${i + 1 < step ? 'done' : i + 1 === step ? 'active' : 'pending'}`} style={{ width: 22, height: 22, fontSize: 'var(--fs-2xs)' }}>{i + 1 < step ? <Check size={11} aria-hidden="true" /> : i + 1}</div>
                <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: step === i + 1 ? 'var(--primary-green)' : 'var(--text-dim)' }}>{s}</span>
              </div>
              {i < 3 && <div className={`step-line ${i + 1 < step ? 'done' : ''}`} style={{ marginTop: 11 }} />}
            </React.Fragment>
          ))}
        </div>

        {step === 1 && (
          <div>
            <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, marginBottom: 12 }}>Select batch:</div>
            <BatchPicker batches={ctx.batches} onPick={(id) => { setBatchId(id); setStep(2); }} />
          </div>
        )}

        {step === 2 && batch && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 8 }}>{batch.code} · System count: {batch.currentQty}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'center', marginBottom: 16 }}>
                <button onClick={() => setCount(Math.max(0, count - 1))} style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border-subtle)', fontSize: 'var(--fs-3xl)', color: 'var(--text-primary)', cursor: 'pointer' }}>−</button>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 'var(--fs-hero)', fontWeight: 700, color: count > 0 ? 'var(--status-critical)' : 'var(--text-primary)', lineHeight: 1 }}>{count}</div>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>deaths</div>
                </div>
                <button onClick={() => setCount(count + 1)} style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--border-subtle)', fontSize: 'var(--fs-3xl)', color: 'var(--text-primary)', cursor: 'pointer' }}>+</button>
              </div>
              {needsPhoto && <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 12px', background: 'rgba(248,113,113,0.08)', borderRadius: 10, border: '1px solid rgba(248,113,113,0.25)', fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', fontWeight: 600, marginBottom: 10 }}><AlertTriangle size={12} aria-hidden="true" /> Photo required for {threshold}+ deaths (your farm&apos;s threshold)</div>}
            </div>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>Cause of death:</div>
            {/* Sourced from the shared list rather than a fourth inline copy —
                components/farm/vet.tsx had its own, this screen had its own,
                and a vet and a worker reporting the same death produced
                different strings, so the mortality report counted them
                separately. The tap-grid stays: it is faster than a select on a
                phone and this is the screen workers use most. "Other" is the
                escape hatch, and it reveals a text field. */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: causeIsOther ? 8 : 14 }}>
              {MORTALITY_CAUSES.map((c) => {
                const active = c === cause && !causeIsOther;
                return (
                  <button key={c} onClick={() => { setCauseIsOther(false); setCause(c); }} style={{ padding: '10px 8px', borderRadius: 10, fontSize: 'var(--fs-sm)', fontWeight: 600, background: active ? 'rgba(248,113,113,0.12)' : 'var(--card)', border: active ? '1px solid rgba(248,113,113,0.3)' : '1px solid var(--border-subtle)', color: active ? 'var(--status-critical)' : 'var(--text-muted)', cursor: 'pointer' }}>{c}</button>
                );
              })}
              <button
                onClick={() => { setCauseIsOther(true); setCause(''); }}
                style={{ padding: '10px 8px', borderRadius: 10, fontSize: 'var(--fs-sm)', fontWeight: 600, background: causeIsOther ? 'rgba(248,113,113,0.12)' : 'var(--card)', border: causeIsOther ? '1px solid rgba(248,113,113,0.3)' : '1px solid var(--border-subtle)', color: causeIsOther ? 'var(--status-critical)' : 'var(--text-muted)', cursor: 'pointer' }}
              >{OTHER_OPTION}…</button>
            </div>
            {causeIsOther && (
              <input
                className="farm-input" value={cause} onChange={(e) => setCause(e.target.value)}
                placeholder="Describe the cause" autoFocus style={{ marginBottom: 14 }}
              />
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center', borderRadius: 12 }} onClick={() => setStep(1)}>Back</button>
              <button className="btn-primary" style={{ flex: 2, justifyContent: 'center', borderRadius: 12 }} onClick={() => setStep(needsPhoto ? 3 : 4)}>Next</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ padding: '14px', background: 'rgba(248,113,113,0.06)', borderRadius: 14, border: '1px solid rgba(248,113,113,0.2)', marginBottom: 16, textAlign: 'center' }}>
              <div style={{ marginBottom: 8, color: 'var(--status-critical)' }}><Camera size={40} aria-hidden="true" /></div>
              <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Photo Evidence Required</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>Your farm requires a photo for {threshold}+ deaths. This helps with disease investigation.</div>
            </div>
            {photoDataUrl ? (
              <img src={photoDataUrl} alt="Mortality evidence" style={{ width: '100%', borderRadius: 14, marginBottom: 10, maxHeight: 200, objectFit: 'cover' }} />
            ) : null}
            <label style={{ width: '100%', padding: '16px', borderRadius: 14, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', color: 'var(--primary-green)', fontWeight: 700, fontSize: 'var(--fs-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
              <Camera size={18} /> {photoDataUrl ? 'Retake Photo' : 'Take Photo'}
              <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} style={{ display: 'none' }} />
            </label>
            <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }} onClick={() => setStep(2)}>Back</button>
            <button className="btn-primary" disabled={!photoDataUrl} style={{ width: '100%', justifyContent: 'center', opacity: photoDataUrl ? 1 : 0.6 }} onClick={() => setStep(4)}>Continue with Photo</button>
          </div>
        )}

        {step === 4 && batch && (
          <div>
            <div style={{ padding: '14px', background: 'rgba(74,222,128,0.06)', borderRadius: 14, border: '1px solid rgba(74,222,128,0.2)', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Confirm & Save</div>
              {[['Batch', batch.code],['Deaths',`${count}`],['Cause', cause],['Photo', photoDataUrl ? 'Attached' : needsPhoto ? 'Missing' : 'Not required']].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 'var(--fs-sm)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{v}</span>
                </div>
              ))}
            </div>
            {error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}
            <button className="btn-primary" disabled={submitting} style={{ width: '100%', justifyContent: 'center', marginBottom: 8, opacity: submitting ? 0.7 : 1 }} onClick={handleSubmit}>
              <Check size={14} /> {submitting ? 'Saving…' : 'Save Record'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PhysicalCountForm({ ctx, onBack }: { ctx: WorkerCtx; onBack: () => void }) {
  const { showToast } = useToast();
  const [batchId, setBatchId] = useState<string | null>(ctx.batches?.[0]?.id ?? null);
  const [physicalCount, setPhysicalCount] = useState('');
  const [reason, setReason] = useState('');
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
    });
    setSubmitting(false);
    if (!res.success) { setError(res.error || 'Failed to save record.'); return; }
    showToast(...submissionToast(res.data, 'Physical count saved.'));
    onBack();
  }

  return (
    <div className="screen-content">
      <div className="px-screen">
        <TopNav title="Physical Count" showBack />
      </div>
      <div className="px-screen" style={{ paddingTop: 16 }}>
        {ctx.batches !== null && ctx.batches.length === 0 ? (
          <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            No batches are assigned to you yet.
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Select Batch</label>
              <select className="farm-input" value={batchId ?? ''} onChange={(e) => setBatchId(e.target.value)}>
                {(ctx.batches ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} – {b.name} ({b.currentQty} in system)</option>)}
              </select>
            </div>
            {batch && (
              <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 'var(--fs-4xl)', fontWeight: 700, color: 'var(--text-primary)' }}>{batch.currentQty}</div>
                    <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>System count</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 'var(--fs-4xl)', fontWeight: 700, color: 'var(--status-warning)' }}>{count ?? '—'}</div>
                    <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>Your count</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 'var(--fs-4xl)', fontWeight: 700, color: 'var(--status-critical)' }}>{variance !== null ? (variance > 0 ? `+${variance}` : variance) : '—'}</div>
                    <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>Variance</div>
                  </div>
                </div>
              </div>
            )}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Your Physical Count</label>
              <input className="farm-input" type="number" placeholder="Enter count" value={physicalCount} onChange={(e) => setPhysicalCount(e.target.value)} style={{ fontSize: 'var(--fs-3xl)', textAlign: 'center', fontWeight: 700 }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Reason for variance</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {['Suspected theft','Found extra','Uncounted deaths','Counting error'].map((r) => (
                  <button key={r} onClick={() => setReason(r)} style={{ padding: '9px 8px', borderRadius: 10, fontSize: 'var(--fs-xs)', fontWeight: 600, background: r === reason ? 'rgba(251,191,36,0.1)' : 'var(--card)', border: r === reason ? '1px solid rgba(251,191,36,0.3)' : '1px solid var(--border-subtle)', color: r === reason ? 'var(--status-warning)' : 'var(--text-muted)', cursor: 'pointer' }}>{r}</button>
                ))}
              </div>
            </div>
            <div style={{ padding: '10px 12px', background: 'rgba(251,191,36,0.06)', borderRadius: 10, border: '1px solid rgba(251,191,36,0.2)', marginBottom: 14, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              This count <strong style={{ color: 'var(--text-secondary)' }}>does not change the system count</strong>. Your owner will review and approve any adjustments.
            </div>
            {error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}
            <button className="btn-primary" disabled={submitting || count === null} style={{ width: '100%', justifyContent: 'center', marginBottom: 8, opacity: submitting || count === null ? 0.7 : 1 }} onClick={handleSubmit}>
              <Check size={14} /> {submitting ? 'Saving…' : 'Submit Count'}
            </button>
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
    <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
      <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>My Pay</div>

      {notLinked && (
        <div className="farm-card" style={{ padding: 28, textAlign: 'center' }}>
          <Lock size={28} color="var(--text-dim)" style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>No employee record linked</div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Your login isn&apos;t linked to an employee record yet, so there is no pay history to show. Ask your farm owner or manager to link your account.
          </div>
        </div>
      )}

      {!notLinked && error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 12 }}>{error}</div>}

      {!notLinked && !error && payslips === null && (
        <div style={{ padding: 20, textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Loading…</div>
      )}

      {!notLinked && !error && payslips !== null && payslips.length === 0 && (
        <div className="farm-card" style={{ padding: 28, textAlign: 'center' }}>
          <DollarSign size={28} color="var(--text-dim)" style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>No payslips yet</div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            You haven&apos;t been paid in a payroll run yet. Payslips appear here as soon as your owner runs payroll for a period that includes you.
          </div>
        </div>
      )}

      {!notLinked && !error && payslips !== null && payslips.length > 0 && (
        <>
          <div className="farm-card" style={{ padding: 16, marginBottom: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total paid to date</div>
            <div style={{ fontSize: 'var(--fs-4xl)', fontWeight: 700, color: 'var(--primary-green)' }}>{formatMoney(total)}</div>
          </div>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Payslip history</div>
          <div className="farm-card" style={{ overflow: 'hidden', marginBottom: 16 }}>
            {payslips.map((p, i, arr) => (
              <div key={p.id} style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Calendar size={16} color="var(--text-dim)" />
                  <div>
                    <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{periodLabel(p.periodStart, p.periodEnd)}</div>
                    <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>Gross pay — no deductions applied</div>
                  </div>
                </div>
                <span style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--primary-green)' }}>{formatMoney(p.amountCents)}</span>
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
    <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
      {/* Avatar */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(74,222,128,0.2)', border: '2px solid rgba(74,222,128,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-4xl)', fontWeight: 700, color: 'var(--primary-green)', marginBottom: 10 }}>
          {employee ? employee.name.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2) : '…'}
        </div>
        <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700 }}>{employee?.name ?? 'Loading…'}</div>
        <span className="chip chip-ok" style={{ marginTop: 4, textTransform: 'capitalize' }}>{employee?.role ?? 'worker'}</span>
      </div>

      {employeeError && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 14 }}>{employeeError}</div>}

      {/* Today's records (real GET /api/records, not a mock sync-status list) */}
      <div className="section-eyebrow" style={{ marginBottom: 8 }}>Today&apos;s Records</div>
      <div className="farm-card" style={{ overflow: 'hidden', marginBottom: 14 }}>
        {records === null && <div style={{ padding: 12, fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Loading…</div>}
        {records !== null && records.length === 0 && <div style={{ padding: 12, fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>No records submitted today.</div>}
        {records !== null && records.map((r, i, arr) => (
          <div key={r.id} style={{ padding: '11px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
            <div>
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{RECORD_TYPE_LABEL[r.type]?.label ?? r.type}</div>
              <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>{batchLabel[r.batchId] ?? r.batchId.slice(0, 8)} · {timeOf(r.createdAt)}</div>
            </div>
            {(() => {
              const chip = RECORD_STATE_CHIP[recordApprovalState(r.data)];
              return <span className={chip.cls} style={{ fontSize: 'var(--fs-2xs)' }}>{chip.label}</span>;
            })()}
          </div>
        ))}
      </div>

      {/* (#376 Gap 5: the hardcoded "Settings" block that lived here —
          Language / High Contrast / Sync-on-WiFi rows styled as active
          settings — was deleted outright. Nothing backed them; showing a
          worker "Sync on WiFi only: On" implied a sync engine that does not
          exist. Real per-user preferences get this slot back when they land.) */}

      {/* Issue #322: this button had no onClick — dead control on the screen
          workers see most. Routes through the same app-wide logout the
          TopNav button uses. */}
      <button onClick={() => requestLogout()} style={{ width: '100%', padding: '14px', borderRadius: 14, fontSize: 'var(--fs-md)', fontWeight: 700, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: 'var(--status-critical)', cursor: 'pointer', marginBottom: 20 }}>
        Sign Out
      </button>
    </div>
  );
}
