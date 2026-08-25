'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNav, TopNav } from './navigation';
import { useToast } from './ui-shared';
import { apiClient } from '@/lib/request';
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
// the worker portal does. scripts/seed-demo-data.mjs seeds an employees row
// for the demo vet account (role: 'vet', linked by userId) so this resolves
// for a real login; a vet account with no linked employees row gets an
// honest inline message instead of a broken submit button.
//
// Follow-up worth flagging (not built here per the task's explicit
// instruction not to invent one): a real vaccinations/treatments table with
// drug, dose, withdrawal-period fields would let this screen show far more
// than "deaths by batch" — right now that's the only real health data source.

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

  const loading = batches === null && !error;

  return (
    <div className="screen-content">
      <TopNav title="Herd Health" subtitle="Batches under your care" />
      <div className="px-screen" style={{ paddingTop: 12, paddingBottom: 40 }}>
        {employeeError && (
          <div className="farm-card" style={{ padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={16} color="var(--status-warning)" />
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{employeeError}</span>
          </div>
        )}
        {error && (
          <div className="farm-card" style={{ padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={16} color="var(--status-critical)" />
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)' }}>{error}</span>
          </div>
        )}
        {loading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 'var(--fs-base)' }}>Loading batches…</div>
        )}

        {!loading && batches && batches.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            <Heart size={32} style={{ marginBottom: 10, opacity: 0.4 }} />
            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>No batches on this farm yet</div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(batches ?? []).map((b) => {
            const history = historyByBatch.get(b.id) ?? [];
            const isOpen = expanded === b.id;
            const deaths = totalDeaths(b.id);
            return (
              <div key={b.id} className="farm-card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)' }}>{b.name}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{b.code} · {b.species || b.enterprise}</div>
                  </div>
                  <span className={`chip ${deaths > 0 ? 'chip-critical' : 'chip-ok'}`} style={{ fontSize: 'var(--fs-2xs)' }}>{deaths} death{deaths === 1 ? '' : 's'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>{b.currentQty}</div>
                    <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', fontWeight: 600 }}>Current count</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>{history.length}</div>
                    <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', fontWeight: 600 }}>Mortality records</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : b.id)}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 0', borderRadius: 8, fontSize: 'var(--fs-xs)', fontWeight: 700, cursor: 'pointer', background: isOpen ? 'rgba(74,222,128,0.1)' : 'var(--card)', border: '1px solid var(--border-subtle)', color: isOpen ? 'var(--primary-green)' : 'var(--text-muted)' }}
                  >
                    {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {isOpen ? 'Hide history' : 'View history'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogFor(b)}
                    disabled={!employee}
                    title={employee ? undefined : 'No linked staff record'}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 0', borderRadius: 8, fontSize: 'var(--fs-xs)', fontWeight: 700, cursor: employee ? 'pointer' : 'not-allowed', opacity: employee ? 1 : 0.5, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: 'var(--status-critical)' }}
                  >
                    <Plus size={12} /> Log mortality
                  </button>
                </div>
                {isOpen && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
                    {history.length === 0 ? (
                      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)', textAlign: 'center', padding: '6px 0' }}>No mortality records for this batch.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {history.map((r) => (
                          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-xs)', padding: '6px 8px', background: 'var(--surface)', borderRadius: 8 }}>
                            <span style={{ color: 'var(--text-muted)' }}>{fmtDate(r.createdAt)}</span>
                            <span style={{ fontWeight: 700, color: 'var(--status-critical)' }}>{Number(r.data?.count) || 0} deaths</span>
                            <span style={{ color: 'var(--text-secondary)' }}>{typeof r.data?.cause === 'string' ? r.data.cause : '—'}</span>
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: 20, width: '100%', border: '1px solid var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>Log Mortality</div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{batch.code} · {batch.name}</div>
          </div>
          <button type="button" className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'center', marginBottom: 16 }}>
          <button type="button" onClick={() => setCount(Math.max(0, count - 1))} style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--card)', border: '1px solid var(--border-subtle)', fontSize: 'var(--fs-3xl)', color: 'var(--text-primary)', cursor: 'pointer' }}>−</button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 'var(--fs-hero)', fontWeight: 700, color: count > 0 ? 'var(--status-critical)' : 'var(--text-primary)', lineHeight: 1 }}>{count}</div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>deaths</div>
          </div>
          <button type="button" onClick={() => setCount(count + 1)} style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--card)', border: '1px solid var(--border-subtle)', fontSize: 'var(--fs-3xl)', color: 'var(--text-primary)', cursor: 'pointer' }}>+</button>
        </div>

        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>Cause of death</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          {CAUSES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCause(c)}
              style={{ padding: '10px 8px', borderRadius: 10, fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'pointer', background: c === cause ? 'rgba(248,113,113,0.12)' : 'var(--card)', border: c === cause ? '1px solid rgba(248,113,113,0.3)' : '1px solid var(--border-subtle)', color: c === cause ? 'var(--status-critical)' : 'var(--text-muted)' }}
            >
              {c}
            </button>
          ))}
        </div>

        {error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}
        <button className="btn-primary" disabled={saving} style={{ width: '100%', justifyContent: 'center', borderRadius: 12, padding: 12, opacity: saving ? 0.7 : 1 }} onClick={handleSave}>
          <Check size={14} /> {saving ? 'Saving…' : 'Save Record'}
        </button>
      </div>
    </div>
  );
}
