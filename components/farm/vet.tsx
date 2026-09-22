'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNav, TopNav } from './navigation';
import { useToast } from './ui-shared';
import { apiClient } from '@/lib/request';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui-kit/button';
import { Badge } from '@/components/ui-kit/badge';
import { EmptyState } from '@/components/ui-kit/empty-state';
import { Heart, ChevronDown, ChevronUp, Plus, X, AlertTriangle, Check } from './icons';
import { MORTALITY_CAUSES } from '@/lib/record-vocabulary';

// ── Vet herd-health screen (vet/auditor screens task) ───────────────────────
// The vet role was previously funneled straight to RoleNoticeScreen — this
// is their real home. Built entirely from APIs that already exist:
//   - GET /api/batches (farm-scoped) — the animals under care
//   - GET /api/records?type=mortality (farm-scoped) — the only real health
//     signal today; there is no vaccinations/treatments table anywhere on
//     this branch (see the header note below), so mortality history is what
//     this screen reviews.
//   - POST /api/records — logging a new mortality observation, same shape
//     ({ data: { count, cause } }) components/farm/worker.tsx's
//     MortalityForm already writes and lib/reports.ts's
//     computeMortalityReport already reads.
//
// `employeeId` is required by POST /api/records' schema (records.employeeId
// references employees.id) — resolved via GET /api/employees/me exactly like
// the worker portal does. A vet account with no linked employees row gets an
// honest inline message and a disabled "Log mortality" action, never a
// broken submit.
//
// Design (package I): a clinical list — batches with recent deaths sort to
// the top so the vet's eye lands on what needs attention first, exactly like
// a triage list. No reference page exists for this role (D11 override); the
// ui-kit's card/badge language is reused rather than inventing new chrome.
//
// Follow-up worth flagging (not built here — no real backend to show it
// from): a real vaccinations/treatments table with drug, dose, withdrawal-
// period fields would let this screen show far more than "deaths by batch".

interface ApiEmployeeMe {
  id: string;
  name: string;
  mortalityPhotoThreshold: number;
}

interface ApiBatch {
  id: string;
  code: string;
  name: string;
  species: string;
  enterprise: string;
  stage: string;
  status: string;
  currentQty: number;
}

interface ApiRecord {
  id: string;
  batchId: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string | null;
}

// Was an inline list here, and a second inline list in
// components/farm/worker.tsx's MortalityForm. A vet and a worker reporting the
// same death therefore produced different strings for it, and the mortality
// report grouped them separately. One shared list — see
// lib/record-vocabulary.ts for why it is a constant and not a table.
const CAUSES = MORTALITY_CAUSES;

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
}

export function VetHerdScreen() {
  const { tenantId, activeFarmId } = useNav();
  const { showToast } = useToast();

  const [employee, setEmployee] = useState<ApiEmployeeMe | null>(null);
  const [employeeError, setEmployeeError] = useState('');
  const [batches, setBatches] = useState<ApiBatch[] | null>(null);
  const [records, setRecords] = useState<ApiRecord[] | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [logFor, setLogFor] = useState<ApiBatch | null>(null);

  const loadEmployee = useCallback(() => {
    apiClient.get<ApiEmployeeMe>(`/api/employees/me?tenantId=${tenantId}`).then((res) => {
      if (res.success) { setEmployee(res.data); setEmployeeError(''); }
      else setEmployeeError(res.error || 'Your account isn\'t linked to a staff record yet — mortality logging is unavailable until an admin links one.');
    });
  }, [tenantId]);

  const loadData = useCallback(() => {
    apiClient.get<ApiBatch[]>(`/api/batches?tenantId=${tenantId}&farmId=${activeFarmId}`).then((res) => {
      if (res.success) { setBatches(res.data); setError(''); }
      else { setBatches([]); setError(res.error || 'Failed to load batches.'); }
    });
    apiClient.get<ApiRecord[]>(`/api/records?tenantId=${tenantId}&farmId=${activeFarmId}&type=mortality`).then((res) => {
      if (res.success) setRecords(res.data);
    });
  }, [tenantId, activeFarmId]);

  useEffect(() => { loadEmployee(); }, [loadEmployee]);
  useEffect(() => { loadData(); }, [loadData]);

  const historyByBatch = useMemo(() => {
    const map = new Map<string, ApiRecord[]>();
    for (const r of records ?? []) {
      const list = map.get(r.batchId) ?? [];
      list.push(r);
      map.set(r.batchId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    }
    return map;
  }, [records]);

  function totalDeaths(batchId: string): number {
    return (historyByBatch.get(batchId) ?? []).reduce((sum, r) => sum + (Number(r.data?.count) || 0), 0);
  }

  function mostRecentDeath(batchId: string): number {
    const list = historyByBatch.get(batchId) ?? [];
    return list.length > 0 ? new Date(list[0].createdAt ?? 0).getTime() : -Infinity;
  }

  // Clinical triage ordering: batches with the most recent deaths first, so
  // the vet's eye lands on what needs attention before anything else. A
  // batch with no mortality history at all sorts to the bottom.
  const sortedBatches = useMemo(() => {
    return [...(batches ?? [])].sort((a, b) => mostRecentDeath(b.id) - mostRecentDeath(a.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, historyByBatch]);

  const loading = batches === null && !error;

  return (
    <div className="screen-content">
      <TopNav title="Herd Health" subtitle="Batches under your care" />
      <div className="px-screen pt-3 pb-10">
        {employeeError && (
          <div className="mb-3.5 flex items-center gap-2.5 rounded-xl bg-warning-soft px-3.5 py-2.5 text-xs text-muted">
            <AlertTriangle size={16} className="shrink-0 text-warning" aria-hidden="true" />
            <span>{employeeError}</span>
          </div>
        )}
        {error && (
          <div className="mb-3.5 flex items-center gap-2.5 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {loading && <div className="py-10 text-center text-base text-muted">Loading batches…</div>}

        {!loading && batches && batches.length === 0 && !error && (
          <EmptyState icon={<Heart size={22} aria-hidden="true" />} title="No batches on this farm yet" body="Batches assigned to this farm will show up here for review." />
        )}

        <div className="flex flex-col gap-2.5">
          {sortedBatches.map((b) => {
            const history = historyByBatch.get(b.id) ?? [];
            const isOpen = expanded === b.id;
            const deaths = totalDeaths(b.id);
            const flagged = deaths > 0;
            return (
              <div key={b.id} className={cn('rounded-xl bg-surface p-3.5 shadow-(--shadow-border)', flagged && 'ring-1 ring-danger/30')}>
                <div className="mb-2.5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-fg">{b.name}</p>
                    <p className="font-mono text-xs text-muted">{b.code} · {b.species || b.enterprise}</p>
                  </div>
                  <Badge variant={flagged ? 'danger' : 'success'} className="shrink-0">{deaths} death{deaths === 1 ? '' : 's'}</Badge>
                </div>
                <div className="mb-2.5 grid grid-cols-2 gap-1.5">
                  <div className="text-center">
                    <div className="text-lg font-bold text-fg">{b.currentQty}</div>
                    <div className="text-[11px] font-semibold text-muted">Current count</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-fg">{history.length}</div>
                    <div className="text-[11px] font-semibold text-muted">Mortality records</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button" variant="secondary" className="h-11 flex-1"
                    onClick={() => setExpanded(isOpen ? null : b.id)}
                  >
                    {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {isOpen ? 'Hide history' : 'View history'}
                  </Button>
                  <Button
                    type="button" variant="danger" className="h-11 flex-1"
                    onClick={() => setLogFor(b)}
                    disabled={!employee}
                    title={employee ? undefined : 'No linked staff record'}
                  >
                    <Plus size={12} /> Log mortality
                  </Button>
                </div>
                {isOpen && (
                  <div className="mt-2.5 border-t border-border pt-2.5">
                    {history.length === 0 ? (
                      <p className="py-1.5 text-center text-xs text-subtle">No mortality records for this batch.</p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {history.map((r) => (
                          <div key={r.id} className="flex justify-between rounded-lg bg-surface-2 px-2 py-1.5 text-xs">
                            <span className="text-muted">{fmtDate(r.createdAt)}</span>
                            <span className="font-bold text-danger">{Number(r.data?.count) || 0} deaths</span>
                            <span className="text-fg">{typeof r.data?.cause === 'string' ? r.data.cause : '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {logFor && employee && (
        <LogMortalitySheet
          batch={logFor}
          tenantId={tenantId}
          employeeId={employee.id}
          onClose={() => setLogFor(null)}
          onSaved={() => { setLogFor(null); showToast('Mortality record saved.', 'success'); loadData(); }}
        />
      )}
    </div>
  );
}

function LogMortalitySheet({ batch, tenantId, employeeId, onClose, onSaved }: {
  batch: ApiBatch;
  tenantId: string;
  employeeId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [count, setCount] = useState(0);
  const [cause, setCause] = useState('Unknown');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    const res = await apiClient.post('/api/records', {
      tenantId,
      batchId: batch.id,
      employeeId,
      type: 'mortality',
      data: { count, cause },
    });
    setSaving(false);
    if (!res.success) { setError(res.error || 'Failed to save record.'); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-end bg-black/65" onClick={onClose}>
      <div className="w-full rounded-t-2xl bg-surface p-5 shadow-(--shadow-raised)" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3.5 flex items-center justify-between">
          <div>
            <p className="text-lg font-bold text-fg">Log Mortality</p>
            <p className="font-mono text-xs text-muted">{batch.code} · {batch.name}</p>
          </div>
          <button type="button" onClick={onClose} className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-muted"><X size={16} /></button>
        </div>

        <div className="mb-4 flex items-center justify-center gap-4">
          <button type="button" onClick={() => setCount(Math.max(0, count - 1))} className="flex size-14 items-center justify-center rounded-2xl bg-surface-2 text-3xl text-fg">−</button>
          <div className="text-center">
            <div className={cn('font-display text-5xl leading-none font-medium', count > 0 ? 'text-danger' : 'text-fg')}>{count}</div>
            <div className="text-xs text-muted">deaths</div>
          </div>
          <button type="button" onClick={() => setCount(count + 1)} className="flex size-14 items-center justify-center rounded-2xl bg-surface-2 text-3xl text-fg">+</button>
        </div>

        <p className="mb-2 text-sm font-bold text-muted">Cause of death</p>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {CAUSES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCause(c)}
              className={cn(
                'min-h-12 rounded-lg px-2 text-sm font-semibold',
                c === cause ? 'bg-danger-soft text-danger ring-1 ring-danger' : 'bg-surface-2 text-muted',
              )}
            >
              {c}
            </button>
          ))}
        </div>

        {error && <p className="mb-2.5 text-sm text-danger">{error}</p>}
        <Button size="lg" className="h-14 w-full" disabled={saving} onClick={handleSave}>
          <Check size={14} /> {saving ? 'Saving…' : 'Save Record'}
        </Button>
      </div>
    </div>
  );
}
