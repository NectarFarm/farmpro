'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNav, TopNav } from './navigation';
import { useToast } from './ui-shared';
import { apiClient } from '@/lib/request';
import { Plus, X, Check, Trash2, ChevronUp, ChevronDown, Sunrise, AlertTriangle } from './icons';
import { PageHeader } from '@/components/ui-kit/page-header';
import { Segmented } from '@/components/ui-kit/segmented';
import { Kpi } from '@/components/ui-kit/page-header';
import { Dossier, Inspector, Kv } from '@/components/ui-kit/inspector';
import { Button } from '@/components/ui-kit/button';
import { Select } from '@/components/ui-kit/select';
import { EmptyState } from '@/components/ui-kit/empty-state';
import { cn } from '@/lib/utils';

/* ── Daily routines (worker-routines task) ──────────────────────────────────
 * Where the owner says what a "morning round" actually is.
 *
 * The worker portal had the tile and nothing behind it, because a round is a
 * property of the farm, not of the software: one farm's morning round is
 * feed, water check, egg collection and a mortality sweep; another's is
 * milking and a temperature reading. components/farm/data.ts's
 * ENTERPRISE_REGISTRY tried to be that list in code, which is why it stayed
 * unwired — it could only ever be a guess.
 *
 * This screen is also the answer to "what do my workers actually do in their
 * app": every step listed here is a form they get, and every step they
 * complete files the same record its standalone form would.
 *
 * ── Redesign (ui/governance-reference-redesign, package D, D6) ──
 * The reference's routines page is a live daily clock — slot is
 * live/done/next, with a "raise a missed-slot task" button. That is a real,
 * different job from this screen's original one (define what a round IS),
 * so both stay: "Today" (new, default) is the clock; the original editor is
 * demoted to "Configure", unchanged in behaviour.
 *
 * The clock cannot be minute-precise the way the reference's mock is: a
 * routine's `timeOfDay` here is a coarse label (morning/midday/evening/
 * weekly/any) — db/schemas/people.ts is explicit that it is "not a
 * schedule: nothing fires from it". So "Today" never invents a clock time
 * for a routine. What IS real: whether a `routine_runs` row exists for it
 * today (an actual completion, unlike the reference's mock rows, which are
 * only ever "done" because a fixed elapsed-time window passed on static seed
 * data) and the real current wall-clock time in the header line. State is a
 * bucket comparison — morning/midday/evening ordered against the real
 * current hour — not a fabricated per-routine time.
 */
interface RoutineStep {
  id?: string;
  kind: string;
  label: string;
  required: boolean;
}

interface Routine {
  id: string;
  name: string;
  timeOfDay: string;
  farmId: string | null;
  active: boolean;
  steps: RoutineStep[];
}

interface RoutineRun {
  id: string;
  routineId: string;
  batchId: string;
  employeeId: string;
  completedAt: string;
}

// Each kind is a form the worker gets, and the record it files. Labels are
// what an owner would call them, not the API's type strings.
const STEP_KINDS: { kind: string; label: string; hint: string }[] = [
  { kind: 'feeding', label: 'Feed', hint: 'Pick feed from the store; deducts it' },
  { kind: 'production', label: 'Collect produce', hint: 'Eggs, milk — counted into stock' },
  { kind: 'mortality', label: 'Deaths', hint: 'Comes off the head count' },
  { kind: 'physical_count', label: 'Head count', hint: 'Counts against the system figure' },
  { kind: 'health', label: 'Treatment', hint: 'Vaccines and medicines given' },
  { kind: 'weight', label: 'Weigh a sample', hint: 'One weight, for growth tracking' },
  { kind: 'check', label: 'Just a check', hint: 'Water, lights, doors — yes or no plus a note' },
];

const TIMES = [
  { value: 'morning', label: 'Morning' },
  { value: 'midday', label: 'Midday' },
  { value: 'evening', label: 'Evening' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'any', label: 'Any time' },
];

/* ── Today tab: bucket clock ── */
type SlotState = 'done' | 'live' | 'next' | 'missed' | 'open';
const DAILY_ORDER = ['morning', 'midday', 'evening'];

function currentDailyBucket(): string {
  const h = new Date().getHours();
  if (h < 11) return 'morning';
  if (h < 16) return 'midday';
  return 'evening';
}

function slotState(routine: Routine, doneToday: boolean): SlotState {
  if (doneToday) return 'done';
  if (!DAILY_ORDER.includes(routine.timeOfDay)) return 'open'; // weekly / any — no time commitment to be live/next/missed against
  const cur = DAILY_ORDER.indexOf(currentDailyBucket());
  const idx = DAILY_ORDER.indexOf(routine.timeOfDay);
  if (idx === cur) return 'live';
  if (idx > cur) return 'next';
  return 'missed';
}

const STATE_LABEL: Record<SlotState, string> = { done: 'Done', live: 'Live', next: 'Next', missed: 'Missed', open: 'Any time today' };
const STATE_DOT: Record<SlotState, string> = { done: 'bg-primary', live: 'bg-warning', missed: 'bg-warning', next: 'bg-border', open: 'bg-border' };

function timeLabel(v: string): string {
  return TIMES.find((t) => t.value === v)?.label ?? v;
}

export function RoutinesScreen() {
  const { tenantId, farms, activeFarmId, role, navigate } = useNav();
  const { showToast } = useToast();
  const [tab, setTab] = useState<'today' | 'configure'>('today');
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [editing, setEditing] = useState<Routine | 'new' | null>(null);
  const [loadError, setLoadError] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [raised, setRaised] = useState<Set<string>>(new Set());

  const canEdit = role === 'owner' || role === 'manager';

  const load = useCallback(() => {
    apiClient.get<Routine[]>(`/api/routines?tenantId=${tenantId}&farmId=${activeFarmId}`).then((res) => {
      if (res.success) { setRoutines(res.data); setLoadError(''); }
      else { setRoutines([]); setLoadError(res.error || 'Could not load routines.'); }
    });
  }, [tenantId, activeFarmId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    apiClient.get<RoutineRun[]>(`/api/routine-runs?tenantId=${tenantId}&since=${encodeURIComponent(startOfToday.toISOString())}`).then((res) => {
      if (res.success) setRuns(res.data);
    });
  }, [tenantId]);

  async function remove(routine: Routine) {
    const res = await apiClient.delete(`/api/routines/${routine.id}?tenantId=${tenantId}`);
    if (!res.success) { showToast(res.error || 'Could not delete it.', 'error'); return; }
    showToast(`${routine.name} removed. Past rounds are kept.`, 'success');
    load();
  }

  async function toggleActive(routine: Routine) {
    const res = await apiClient.patch(`/api/routines/${routine.id}`, { tenantId, active: !routine.active });
    if (!res.success) { showToast(res.error || 'Could not update it.', 'error'); return; }
    load();
  }

  // Today's rows: active routines only, each with its real completion state.
  const rows = useMemo(() => {
    const active = (routines ?? []).filter((r) => r.active);
    const withState = active.map((r) => ({
      routine: r,
      state: slotState(r, runs.some((run) => run.routineId === r.id)),
    }));
    const rank = (v: string) => (DAILY_ORDER.includes(v) ? DAILY_ORDER.indexOf(v) : DAILY_ORDER.length);
    return withState.sort((a, b) => rank(a.routine.timeOfDay) - rank(b.routine.timeOfDay));
  }, [routines, runs]);

  const live = rows.find((r) => r.state === 'live') ?? rows.find((r) => r.state === 'next') ?? rows[0] ?? null;
  const picked = rows.find((r) => r.routine.id === pickedId) ?? live;

  function pick(routineId: string) {
    setPickedId(routineId);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) setMobileOpen(true);
  }

  async function raise(routine: Routine) {
    const res = await apiClient.post('/api/tasks', {
      tenantId,
      title: `Missed: ${routine.name}`,
      dueAt: new Date().toISOString(),
      priority: 'high',
      requiresApproval: false,
      farmId: routine.farmId || undefined,
      notes: `Standing ${timeLabel(routine.timeOfDay).toLowerCase()} routine was not closed today.`,
    });
    if (!res.success) { showToast(res.error || 'Could not raise it.', 'error'); return; }
    showToast('Raised onto the queue', 'success');
    setRaised((prev) => new Set(prev).add(routine.id));
  }

  const nowLabel = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const todayLede = rows.length === 0
    ? 'Nothing standing is set up yet — add a routine in Configure.'
    : live
      ? `It's ${nowLabel} — ${live.routine.name} is ${live.state === 'live' ? 'the live slot' : live.state === 'missed' ? 'overdue' : 'next'}.`
      : `It's ${nowLabel}.`;

  const doneCount = rows.filter((r) => r.state === 'done').length;
  const liveCount = rows.filter((r) => r.state === 'live').length;
  const missedCount = rows.filter((r) => r.state === 'missed').length;
  const aheadCount = rows.filter((r) => r.state === 'next' || r.state === 'open').length;

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
          title="Routines"
          lede={tab === 'today' ? todayLede : "A routine is a named list of steps — a morning round, an evening lock-up. Each one appears in your workers' app, and each step they complete is recorded exactly as if they had used that form on its own."}
          actions={tab === 'configure' && canEdit ? (
            <Button onClick={() => setEditing('new')}><Plus size={14} /> Add a routine</Button>
          ) : undefined}
        />

        <div className="mt-5">
          <Segmented
            value={tab}
            onChange={setTab}
            items={[
              { id: 'today', label: 'Today', hint: 'The live clock' },
              { id: 'configure', label: 'Configure', hint: 'Define the steps' },
            ]}
          />
        </div>

        {tab === 'today' ? (
          <div className="mt-5">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Kpi label="Done" value={doneCount} hint="Closed today" tone="ok" />
              <Kpi label="Live" value={liveCount} hint="Due right now" tone={liveCount ? 'warn' : 'plain'} />
              <Kpi label="Missed" value={missedCount} hint={missedCount ? 'Needs raising' : 'None missed'} tone={missedCount ? 'warn' : 'plain'} />
              <Kpi label="Ahead" value={aheadCount} hint="Later today" />
            </div>

            {rows.length === 0 ? (
              <div className="mt-5">
                <EmptyState icon={<Sunrise size={20} />} title="Nothing standing yet" body="Add a routine in Configure and its slot will show up here every day." />
              </div>
            ) : (
              <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.9fr)]">
                <ol className="relative min-w-0 rounded-xl bg-surface px-4 py-5 shadow-(--shadow-border)">
                  <span className="absolute top-8 bottom-8 left-[2.35rem] w-px bg-border" aria-hidden />
                  {rows.map(({ routine, state }) => {
                    const active = picked?.routine.id === routine.id;
                    return (
                      <li key={routine.id} className="relative">
                        <button
                          type="button"
                          onClick={() => pick(routine.id)}
                          className={cn('flex w-full items-start gap-4 rounded-lg py-3 pr-3 pl-2 text-left', active && 'bg-primary-soft')}
                        >
                          <span className={cn('relative z-10 mt-1 size-3 shrink-0 rounded-full border-2 border-surface', STATE_DOT[state])} />
                          <span className="w-16 shrink-0 text-xs text-subtle uppercase tracking-wide">{DAILY_ORDER.includes(routine.timeOfDay) ? routine.timeOfDay : timeLabel(routine.timeOfDay)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{routine.name}</span>
                            <span className="block text-xs text-muted">{routine.farmId ? (farms.find((f) => f.id === routine.farmId)?.name ?? 'One farm') : 'All farms'}</span>
                          </span>
                          <span className="text-[10px] tracking-wider text-subtle uppercase">{STATE_LABEL[state]}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
                <div className="hidden min-w-0 lg:block">
                  {picked ? (
                    <Dossier
                      kicker={STATE_LABEL[picked.state]}
                      title={picked.routine.name}
                      lede={picked.routine.farmId ? (farms.find((f) => f.id === picked.routine.farmId)?.name ?? 'One farm') : 'All farms'}
                      footer={
                        picked.state === 'missed' || picked.state === 'live' || picked.state === 'open' ? (
                          raised.has(picked.routine.id) ? (
                            <p className="text-sm text-muted">Raised onto the queue.</p>
                          ) : (
                            <Button className="w-full justify-center" variant={picked.state === 'live' ? 'default' : 'secondary'} onClick={() => raise(picked.routine)}>
                              {picked.state === 'live' ? 'Slot is slipping — raise a task' : 'Raise a missed-slot task'}
                            </Button>
                          )
                        ) : (
                          <p className="text-sm text-muted">{picked.state === 'done' ? 'Closed for today.' : 'Not due yet.'}</p>
                        )
                      }
                    >
                      <dl>
                        <Kv label="Slot" value={DAILY_ORDER.includes(picked.routine.timeOfDay) ? picked.routine.timeOfDay : timeLabel(picked.routine.timeOfDay)} />
                        <Kv label="State" value={STATE_LABEL[picked.state]} />
                        <Kv label="Steps" value={`${picked.routine.steps.length}`} />
                      </dl>
                      <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
                        Routines are the spine. Tasks are exceptions.
                      </p>
                    </Dossier>
                  ) : (
                    <EmptyState icon={<Sunrise size={18} />} title="Nothing selected" body="Pick a slot to see its file." />
                  )}
                </div>
              </div>
            )}

            <nav className="mt-8 border-t border-border pt-5">
              <p className="text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">Then</p>
              <button type="button" onClick={() => navigate('tasks')} className="group mt-3 block text-left">
                <span className="text-sm font-medium text-primary group-hover:underline">See today&apos;s tasks</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">The queue is for what broke the clock, not the clock itself.</span>
              </button>
            </nav>
          </div>
        ) : (
          <div className="mt-5">
            {routines === null && <p className="text-sm text-subtle">Loading…</p>}

            {routines !== null && routines.length === 0 && (
              <EmptyState
                icon={<Sunrise size={20} />}
                title="No routines yet"
                body="Until you add one, your workers see the individual record forms but no round to follow."
                action={canEdit ? <Button className="w-full justify-center" onClick={() => setEditing('new')}><Plus size={14} /> Add a routine</Button> : undefined}
              />
            )}

            {(routines ?? []).map((routine) => (
              <div key={routine.id} className="farm-card" style={{ padding: 14, marginBottom: 10, opacity: routine.active ? 1 : 0.6 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)' }}>{routine.name}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                      {timeLabel(routine.timeOfDay)}
                      {' · '}{routine.steps.length} step{routine.steps.length === 1 ? '' : 's'}
                      {routine.farmId ? ` · ${farms.find((f) => f.id === routine.farmId)?.name ?? 'one farm'}` : ' · all farms'}
                      {routine.active ? '' : ' · paused'}
                    </div>
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => toggleActive(routine)} style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, padding: '5px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        {routine.active ? 'Pause' : 'Resume'}
                      </button>
                      <button onClick={() => setEditing(routine)} style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, padding: '5px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        Edit
                      </button>
                    </div>
                  )}
                </div>

                {routine.steps.length > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {routine.steps.map((step, i) => (
                      <span key={step.id ?? i} style={{
                        fontSize: 'var(--fs-2xs)', padding: '4px 9px', borderRadius: 100,
                        background: 'var(--card-hover, var(--surface))', border: '1px solid var(--border-subtle)',
                        color: 'var(--text-secondary)',
                      }}>
                        {i + 1}. {step.label}{step.required ? '' : ' (optional)'}
                      </span>
                    ))}
                  </div>
                )}

                {routine.steps.length === 0 && (
                  <div style={{ marginTop: 8, fontSize: 'var(--fs-xs)', color: 'var(--status-warning)', lineHeight: 1.5 }}>
                    No steps yet — a worker opening this would be shown an empty round.
                  </div>
                )}

                {canEdit && (
                  <button
                    onClick={() => remove(routine)}
                    style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-2xs)', fontWeight: 700, padding: '5px 10px', borderRadius: 8, background: 'rgba(var(--critical-rgb),0.08)', border: '1px solid rgba(var(--critical-rgb),0.2)', color: 'var(--status-critical)', cursor: 'pointer' }}
                  >
                    <Trash2 size={11} /> Delete
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <RoutineEditor
          routine={editing === 'new' ? null : editing}
          tenantId={tenantId}
          farms={farms}
          defaultFarmId={activeFarmId !== 'ALL' ? activeFarmId : ''}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {picked && (
        <Inspector
          open={mobileOpen}
          onOpenChange={setMobileOpen}
          kicker={STATE_LABEL[picked.state]}
          title={picked.routine.name}
          footer={
            (picked.state === 'missed' || picked.state === 'live' || picked.state === 'open') && !raised.has(picked.routine.id) ? (
              <Button className="w-full justify-center" onClick={() => raise(picked.routine)}>Raise a task</Button>
            ) : undefined
          }
        >
          <dl>
            <Kv label="Slot" value={DAILY_ORDER.includes(picked.routine.timeOfDay) ? picked.routine.timeOfDay : timeLabel(picked.routine.timeOfDay)} />
            <Kv label="Farm" value={picked.routine.farmId ? (farms.find((f) => f.id === picked.routine.farmId)?.name ?? 'One farm') : 'All farms'} />
            <Kv label="State" value={STATE_LABEL[picked.state]} />
          </dl>
        </Inspector>
      )}
    </div>
  );
}

function RoutineEditor({ routine, tenantId, farms, defaultFarmId, onClose, onSaved }: {
  routine: Routine | null;
  tenantId: string;
  farms: { id: string; name: string }[];
  defaultFarmId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(routine?.name ?? '');
  const [timeOfDay, setTimeOfDay] = useState(routine?.timeOfDay ?? 'morning');
  const [farmId, setFarmId] = useState(routine?.farmId ?? defaultFarmId);
  const [steps, setSteps] = useState<RoutineStep[]>(routine?.steps ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function addStep(kind: string) {
    const preset = STEP_KINDS.find((k) => k.kind === kind);
    setSteps((prev) => [...prev, { kind, label: preset?.label ?? kind, required: true }]);
  }

  function move(index: number, direction: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    if (!name.trim()) { setError('Give the routine a name — it is what your workers will see'); return; }
    if (steps.some((s) => !s.label.trim())) { setError('Every step needs a label'); return; }
    setSaving(true); setError('');
    const body = {
      tenantId,
      name: name.trim(),
      timeOfDay,
      farmId: farmId || undefined,
      steps: steps.map((s) => ({ kind: s.kind, label: s.label.trim(), required: s.required })),
    };
    const res = routine
      ? await apiClient.patch(`/api/routines/${routine.id}`, body)
      : await apiClient.post('/api/routines', body);
    setSaving(false);
    if (!res.success) { setError(res.error || 'Could not save the routine'); return; }
    onSaved();
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', zIndex: 120 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '24px 24px 0 0', padding: 20, width: '100%', maxHeight: '92%', overflowY: 'auto', border: '1px solid var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>{routine ? 'Edit routine' : 'New routine'}</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Name *</label>
        <input className="farm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Morning round" style={{ marginBottom: 12 }} />

        <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>When</label>
        <Select className="farm-input" value={timeOfDay} onChange={(v) => setTimeOfDay(v)} style={{ marginBottom: 4 }}>
          {TIMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
          A label, not a schedule — nothing is sent to anyone at that time. It groups the round in the worker&apos;s app.
        </div>

        <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Farm</label>
        <Select className="farm-input" value={farmId} onChange={(v) => setFarmId(v)} style={{ marginBottom: 14 }}>
          <option value="">All farms</option>
          {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>

        <div className="section-eyebrow" style={{ marginBottom: 8 }}>Steps, in order</div>

        {steps.length === 0 && (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
            Nothing yet. Add the things a worker does on this round, in the order they do them.
          </div>
        )}

        {steps.map((step, i) => (
          <div key={i} className="farm-card" style={{ padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 800, color: 'var(--text-dim)' }}>{i + 1}</span>
              <input
                className="farm-input" value={step.label}
                onChange={(e) => setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, label: e.target.value } : s)))}
                style={{ flex: 1 }}
              />
              <button onClick={() => move(i, -1)} disabled={i === 0} className="btn-icon" aria-label="Move up" style={{ opacity: i === 0 ? 0.3 : 1 }}><ChevronUp size={14} /></button>
              <button onClick={() => move(i, 1)} disabled={i === steps.length - 1} className="btn-icon" aria-label="Move down" style={{ opacity: i === steps.length - 1 ? 0.3 : 1 }}><ChevronDown size={14} /></button>
              <button onClick={() => setSteps((prev) => prev.filter((_, idx) => idx !== i))} className="btn-icon" aria-label="Remove step"><Trash2 size={13} color="var(--status-critical)" /></button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>
                {STEP_KINDS.find((k) => k.kind === step.kind)?.hint}
              </span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginLeft: 'auto' }}>
                <input
                  type="checkbox" checked={!step.required}
                  onChange={(e) => setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, required: !e.target.checked } : s)))}
                />
                <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>Can be skipped</span>
              </label>
            </div>
          </div>
        ))}

        <div style={{ marginTop: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>Add a step</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {STEP_KINDS.map((k) => (
              <button key={k.kind} onClick={() => addStep(k.kind)} style={{
                fontSize: 'var(--fs-2xs)', fontWeight: 700, padding: '6px 11px', borderRadius: 100,
                background: 'var(--card)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', cursor: 'pointer',
              }}>
                <Plus size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />{k.label}
              </button>
            ))}
          </div>
        </div>

        {error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: 2, justifyContent: 'center' }} disabled={saving} onClick={save}>
            <Check size={14} /> {saving ? 'Saving…' : 'Save routine'}
          </button>
        </div>
      </div>
    </div>
  );
}
