'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useNav, TopNav } from './navigation';
import { useToast } from './ui-shared';
import { apiClient } from '@/lib/request';
import { Plus, X, Check, Trash2, ChevronUp, ChevronDown, Sunrise } from './icons';

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

export function RoutinesScreen() {
  const { tenantId, farms, activeFarmId, role } = useNav();
  const { showToast } = useToast();
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [editing, setEditing] = useState<Routine | 'new' | null>(null);
  const [loadError, setLoadError] = useState('');

  const canEdit = role === 'owner' || role === 'manager';

  const load = useCallback(() => {
    apiClient.get<Routine[]>(`/api/routines?tenantId=${tenantId}`).then((res) => {
      if (res.success) { setRoutines(res.data); setLoadError(''); }
      else { setRoutines([]); setLoadError(res.error || 'Could not load routines.'); }
    });
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  async function remove(routine: Routine) {
    const res = await apiClient.delete(`/api/routines/${routine.id}?tenantId=${tenantId}`);
    if (!res.success) { showToast(res.error || 'Could not delete it.', 'error'); return; }
    // The runs it produced and the records each step filed both survive —
    // deleting "Morning round" does not erase the mornings it was used for.
    showToast(`${routine.name} removed. Past rounds are kept.`, 'success');
    load();
  }

  async function toggleActive(routine: Routine) {
    const res = await apiClient.patch(`/api/routines/${routine.id}`, { tenantId, active: !routine.active });
    if (!res.success) { showToast(res.error || 'Could not update it.', 'error'); return; }
    load();
  }

  return (
    <div className="screen-content">
      <TopNav
        title="Daily routines"
        subtitle="What your workers are asked to do"
        showBack
        rightEl={canEdit ? (
          <button className="btn-fab" style={{ width: 36, height: 36, borderRadius: 10 }} onClick={() => setEditing('new')}>
            <Plus size={16} />
          </button>
        ) : undefined}
      />

      <div className="px-screen" style={{ paddingTop: 14, paddingBottom: 90 }}>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 14 }}>
          A routine is a named list of steps — a morning round, an evening lock-up. Each one appears in your workers&apos; app, and each step they complete is recorded exactly as if they had used that form on its own.
        </div>

        {loadError && (
          <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 12, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', fontSize: 'var(--fs-sm)', color: 'var(--status-critical)' }}>{loadError}</div>
        )}

        {routines === null && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Loading…</div>}

        {routines !== null && routines.length === 0 && (
          <div className="farm-card" style={{ padding: 18, textAlign: 'center' }}>
            <Sunrise size={30} style={{ opacity: 0.4, marginBottom: 8 }} aria-hidden="true" />
            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 4 }}>No routines yet</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
              Until you add one, your workers see the individual record forms but no round to follow.
            </div>
            {canEdit && (
              <button className="btn-primary" style={{ justifyContent: 'center' }} onClick={() => setEditing('new')}>
                <Plus size={14} /> Add a routine
              </button>
            )}
          </div>
        )}

        {(routines ?? []).map((routine) => (
          <div key={routine.id} className="farm-card" style={{ padding: 14, marginBottom: 10, opacity: routine.active ? 1 : 0.6 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)' }}>{routine.name}</div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                  {TIMES.find((t) => t.value === routine.timeOfDay)?.label ?? routine.timeOfDay}
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
                style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-2xs)', fontWeight: 700, padding: '5px 10px', borderRadius: 8, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', color: 'var(--status-critical)', cursor: 'pointer' }}
              >
                <Trash2 size={11} /> Delete
              </button>
            )}
          </div>
        ))}
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
        <select className="farm-input" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} style={{ marginBottom: 4 }}>
          {TIMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
          A label, not a schedule — nothing is sent to anyone at that time. It groups the round in the worker&apos;s app.
        </div>

        <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Farm</label>
        <select className="farm-input" value={farmId} onChange={(e) => setFarmId(e.target.value)} style={{ marginBottom: 14 }}>
          <option value="">All farms</option>
          {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>

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
