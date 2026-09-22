'use client';
// ============================================================
// dimensions.tsx — Analytical dimensions (Business Central model)
//
// The config surface for the dimension layer on the GL. The original pass
// (dimensions-on-gl task) shipped the backend — projection, posting-time
// capture, required-dimension enforcement, level roll-up reporting — with
// only a read-only "look at the tree" screen on top. This pass
// (dimensions-operable task) is what makes the feature OPERABLE:
//   - Default Dimensions have a UI (the biggest gap): an Account panel where
//     an owner can say "this account requires a Farm dimension", and a
//     generic panel for the other masters (unit/batch/employee/product).
//   - The Analysis Dimensions REGISTER the owner's own ERP showed a
//     screenshot of: DIMENSION ID / NAME / SHORT NAME / SEGMENTS /
//     SEPARATOR / BUDGET CHECK / BUDGET CONTROL / ACTIONS, with Export and a
//     row count.
//   - Editing and archiving for user-defined dimensions and their values.
//   - The "Inactive" bug: every dimension showed a chip driven by negating a
//     boolean the schema has never had — the API row never carried one, so
//     that negation was always true. Not a seeding bug; a screen reading a
//     field the schema never had. Fixed by deleting the fictitious field and
//     reading the REAL `archived` column (added in migration 0041) instead.
//
// Codes are the point. Accountants memorise them, so every list here leads
// with the code in monospace and treats the name as the subtitle, not the
// other way round.
// ============================================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNav, TopNav } from './navigation';
import { useToast } from './ui-shared';
import { apiClient } from '@/lib/request';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui-kit/page-header';
import { Segmented } from '@/components/ui-kit/segmented';
import { Button } from '@/components/ui-kit/button';
import { Badge } from '@/components/ui-kit/badge';
import { Sheet } from '@/components/ui-kit/sheet';
import {
  Plus, X, ChevronRight, Lock, FileText, Download, Edit2, Archive, RotateCcw,
  Info, Check,
} from './icons';

type DimensionLevel = { id: string; ordinal: number; name: string };
type Dimension = {
  id: string; code: string; name: string; sortOrder: number;
  isSystem: boolean; archived: boolean; levelCount: number; levels: DimensionLevel[];
  shortName: string; separator: string; budgetCheck: boolean; budgetControl: boolean;
};
type DimensionValue = {
  id: string; code: string; name: string; levelOrdinal: number;
  parentValueId: string | null; sourceType: string | null; archived: boolean;
};
type Account = { id: string; code: string; name: string; class: string; normalBalance: string };
type DefaultDimensionRow = { id: string; dimensionId: string; dimensionValueId: string | null; requirement: 'required' | 'optional' | 'blocked' };

type Tab = 'register' | 'accounts' | 'defaults';

export function DimensionsScreen() {
  const { tenantId, navigate } = useNav();
  const { showToast } = useToast();
  const [dimensions, setDimensions] = useState<Dimension[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Dimension | null>(null);
  const [editing, setEditing] = useState<Dimension | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState<Tab>('register');

  const load = useCallback(() => {
    apiClient.get<Dimension[]>(`/api/dimensions?tenantId=${tenantId}`).then((res) => {
      if (res.success) { setDimensions(res.data); setError(''); }
      else setError(res.error || 'Could not load dimensions.');
    });
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  // Only non-archived dimensions belong in a PICKER (account rules, master
  // defaults) — an archived one can't be posted against any more (see
  // lib/dimensions.ts's resolveMasterDimensions guard), so offering it as a
  // choice there would be a lie. The register itself still shows every row,
  // archived or not (item 4: "editing and archiving, not just creation" —
  // an archived row must stay visible to be restored).
  const activeDimensions = useMemo(() => (dimensions ?? []).filter((d) => !d.archived), [dimensions]);

  return (
    <div className="screen-content">
      <TopNav title="" />
      <div className="px-screen" style={{ paddingTop: 14 }}>

        <PageHeader
          kicker="Money"
          title="GL Dimensions"
          lede="Every sale, purchase and payroll run is tagged with these, and every journal line carries them — what lets a P&L be produced per unit, per farm or per batch instead of one figure for the whole business."
        />

        <div className="mt-5 mb-4">
          <Segmented
            value={tab}
            onChange={setTab}
            items={[
              { id: 'register', label: 'Dimensions', hint: 'The analysis codes register' },
              { id: 'accounts', label: 'Account rules', hint: 'Which dimensions an account requires' },
              { id: 'defaults', label: 'Other defaults', hint: 'Units, batches, employees, products' },
            ]}
          />
        </div>

        {error && (
          <div className="farm-card" style={{ padding: 13, marginBottom: 14, border: '1px solid rgba(var(--critical-rgb),0.3)', fontSize: 'var(--fs-sm)', color: 'var(--status-critical)' }}>{error}</div>
        )}

        {dimensions === null && !error && (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', padding: '8px 0' }}>Loading dimensions…</div>
        )}

        {dimensions !== null && tab === 'register' && (
          <RegisterTab
            dimensions={dimensions}
            onOpenValues={setOpen}
            onEdit={setEditing}
            onCreate={() => setShowCreate(true)}
            onArchiveToggle={async (d) => {
              const res = await apiClient.patch(`/api/dimensions/${d.id}`, { tenantId, archived: !d.archived });
              if (!res.success) { showToast(res.error || 'Could not update that dimension.', 'error'); return; }
              showToast(d.archived ? `${d.code} restored.` : `${d.code} archived.`, 'success');
              load();
            }}
          />
        )}

        {dimensions !== null && tab === 'accounts' && (
          <AccountsTab tenantId={tenantId} dimensions={activeDimensions} showToast={showToast} />
        )}

        {dimensions !== null && tab === 'defaults' && (
          <OtherDefaultsTab tenantId={tenantId} dimensions={activeDimensions.filter((d) => !d.isSystem)} showToast={showToast} />
        )}

        <button
          onClick={() => navigate('reports')}
          style={{ width: '100%', padding: 12, borderRadius: 12, background: 'var(--card)', border: '1px solid var(--border-subtle)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, marginBottom: 24 }}
        >
          <FileText size={15} color="var(--primary-green)" aria-hidden="true" />
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>P&amp;L by dimension</span>
          <ChevronRight size={14} color="var(--text-dim)" style={{ marginLeft: 'auto' }} aria-hidden="true" />
        </button>
      </div>

      {open && <DimensionValuesSheet dimension={open} tenantId={tenantId} onClose={() => setOpen(null)} showToast={showToast} />}
      {editing && (
        <EditDimensionSheet
          dimension={editing}
          tenantId={tenantId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); showToast('Dimension updated.', 'success'); load(); }}
        />
      )}
      {showCreate && (
        <CreateDimensionSheet
          tenantId={tenantId}
          onClose={() => setShowCreate(false)}
          onCreated={(code) => { setShowCreate(false); showToast(`Dimension ${code} created.`, 'success'); load(); }}
        />
      )}
    </div>
  );
}

/* ── Register tab ──────────────────────────────────────────────────────────
 * The exact table the owner showed a screenshot of from their own ERP:
 * DIMENSION ID / NAME / SHORT NAME / SEGMENTS / SEPARATOR / BUDGET CHECK /
 * BUDGET CONTROL / ACTIONS, with an Export button and a row count. That is
 * a desktop table (8 columns) — this app ships at 360px, so the columns
 * ride inside a horizontally scrolling container (the same pattern
 * components/farm/reports.tsx already uses for its itemised-detail tables)
 * rather than trying to squeeze onto one un-scrollable screen. */
function RegisterTab({
  dimensions, onOpenValues, onEdit, onCreate, onArchiveToggle,
}: {
  dimensions: Dimension[]; onOpenValues: (d: Dimension) => void; onEdit: (d: Dimension) => void
  onCreate: () => void; onArchiveToggle: (d: Dimension) => void
}) {
  function exportCsv() {
    const header = ['DIMENSION ID', 'NAME', 'SHORT NAME', 'SEGMENTS', 'SEPARATOR', 'BUDGET CHECK', 'BUDGET CONTROL', 'STATUS'];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows = dimensions.map((d) => [
      d.code, d.name, d.shortName || d.code, String(d.levelCount), d.separator,
      d.budgetCheck ? 'Yes' : 'No', d.budgetControl ? 'Yes' : 'No', d.archived ? 'Archived' : 'Active',
    ]);
    const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'analysis-dimensions.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-medium tracking-wide text-muted uppercase">
          {dimensions.length} dimension{dimensions.length === 1 ? '' : 's'}
        </div>
        <Button variant="secondary" size="sm" onClick={exportCsv}>
          <Download size={12} /> Export
        </Button>
      </div>

      {/* Desktop: a real, dense table — this is a power-user register, not a
          card list dressed up. Mobile: stacked cards below, since an
          8-column table cannot read at 360px no matter how it's scrolled. */}
      <div className="hidden overflow-hidden rounded-xl bg-surface shadow-(--shadow-border) lg:block">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {['Dimension ID', 'Name', 'Short name', 'Segments', 'Separator', 'Budget check', 'Budget control', 'Actions'].map((h) => (
                <th key={h} className="bg-surface-2 px-3 py-2 text-left text-[11px] font-medium tracking-wide text-muted uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dimensions.map((d) => (
              <tr key={d.id} className={cn('border-t border-border', d.archived && 'opacity-60')}>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="font-mono font-semibold">{d.code}</span>
                  {d.isSystem && <Lock size={9} className="ml-1.5 inline align-middle text-subtle" aria-hidden="true" />}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {d.name}{d.archived && <span className="chip chip-critical" style={{ marginLeft: 6 }}>Archived</span>}
                </td>
                <td className="px-3 py-2 font-mono whitespace-nowrap text-muted">{d.shortName || d.code}</td>
                <td className="px-3 py-2 whitespace-nowrap text-muted">{d.levelCount}</td>
                <td className="px-3 py-2 font-mono whitespace-nowrap text-muted">{d.separator}</td>
                <td className="px-3 py-2 whitespace-nowrap">{d.budgetCheck ? <Check size={13} className="text-success" /> : <X size={13} className="text-subtle" />}</td>
                <td className="px-3 py-2 whitespace-nowrap">{d.budgetControl ? <Check size={13} className="text-success" /> : <X size={13} className="text-subtle" />}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="flex gap-1">
                    <button onClick={() => onOpenValues(d)} className="btn-icon" title="Values"><ChevronRight size={13} /></button>
                    {!d.isSystem && (
                      <>
                        <button onClick={() => onEdit(d)} className="btn-icon" title="Edit"><Edit2 size={13} /></button>
                        <button onClick={() => onArchiveToggle(d)} className="btn-icon" title={d.archived ? 'Restore' : 'Archive'}>
                          {d.archived ? <RotateCcw size={13} /> : <Archive size={13} />}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {dimensions.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-3 text-muted italic">No dimensions yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile: one dense card per dimension, same fields as the table. */}
      <div className="flex flex-col gap-2 lg:hidden">
        {dimensions.length === 0 && (
          <div className="rounded-xl bg-surface p-4 text-sm text-muted italic shadow-(--shadow-border)">No dimensions yet.</div>
        )}
        {dimensions.map((d) => (
          <div key={d.id} className={cn('rounded-xl bg-surface p-3.5 shadow-(--shadow-border)', d.archived && 'opacity-60')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-sm font-semibold">{d.code}</span>
                  {d.isSystem && <Lock size={11} className="text-subtle" aria-hidden="true" />}
                  {d.archived && <Badge variant="danger">Archived</Badge>}
                </div>
                <div className="mt-0.5 text-sm text-muted">{d.name}</div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => onOpenValues(d)} className="btn-icon" title="Values"><ChevronRight size={14} /></button>
                {!d.isSystem && (
                  <>
                    <button onClick={() => onEdit(d)} className="btn-icon" title="Edit"><Edit2 size={14} /></button>
                    <button onClick={() => onArchiveToggle(d)} className="btn-icon" title={d.archived ? 'Restore' : 'Archive'}>
                      {d.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <div><span className="text-subtle">Short name </span><span className="font-mono text-muted">{d.shortName || d.code}</span></div>
              <div><span className="text-subtle">Segments </span><span className="text-muted">{d.levelCount}</span></div>
              <div><span className="text-subtle">Separator </span><span className="font-mono text-muted">{d.separator}</span></div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-subtle">Check {d.budgetCheck ? <Check size={12} className="text-success" /> : <X size={12} />}</span>
                <span className="flex items-center gap-1 text-subtle">Control {d.budgetControl ? <Check size={12} className="text-success" /> : <X size={12} />}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button variant="secondary" className="mt-3 mb-1.5 w-full justify-center" onClick={onCreate}>
        <Plus size={14} /> New dimension
      </Button>
    </div>
  );
}

/* ── A dimension's coded values ───────────────────────────────────────────
 * Values projected from a real farm/unit/batch are marked and NOT editable
 * here: their code follows the operational record, and letting someone rename
 * one in two places is how a ledger and a farm stop agreeing. A user-defined
 * dimension's own values CAN be renamed and archived here (item 4). */
function DimensionValuesSheet({
  dimension, tenantId, onClose, showToast,
}: { dimension: Dimension; tenantId: string; onClose: () => void; showToast: (msg: string, kind?: 'success' | 'error' | 'warning' | 'info') => void }) {
  const [values, setValues] = useState<DimensionValue[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [renaming, setRenaming] = useState<DimensionValue | null>(null);
  const [renameText, setRenameText] = useState('');

  const load = useCallback(() => {
    apiClient.get<DimensionValue[]>(`/api/dimensions/${dimension.id}/values?tenantId=${tenantId}`).then((r) => {
      if (r.success) setValues(r.data); else setValues([]);
    });
  }, [dimension.id, tenantId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!code.trim() || !name.trim()) { setErr('A code and a name are both required.'); return; }
    setBusy(true); setErr('');
    const res = await apiClient.post(`/api/dimensions/${dimension.id}/values`, { tenantId, code: code.trim(), name: name.trim() });
    setBusy(false);
    if (!res.success) { setErr(res.error || 'Could not add that value.'); return; }
    setCode(''); setName(''); setAdding(false); load();
  }

  async function saveRename() {
    if (!renaming || !renameText.trim()) return;
    const res = await apiClient.patch(`/api/dimensions/${dimension.id}/values/${renaming.id}`, { tenantId, name: renameText.trim() });
    if (!res.success) { showToast(res.error || 'Could not rename that value.', 'error'); return; }
    setRenaming(null); load();
  }

  async function toggleArchive(v: DimensionValue) {
    const res = await apiClient.patch(`/api/dimensions/${dimension.id}/values/${v.id}`, { tenantId, archived: !v.archived });
    if (!res.success) { showToast(res.error || 'Could not update that value.', 'error'); return; }
    load();
  }

  const canEditValue = (v: DimensionValue) => !dimension.isSystem && !v.sourceType;

  return (
    <Sheet open onOpenChange={onClose} side="bottom" className="max-h-[88%] rounded-t-2xl">
        <div style={{ padding: '16px 18px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'monospace', fontSize: 'var(--fs-lg)', fontWeight: 800, color: 'var(--text-primary)' }}>{dimension.code}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 1 }}>{dimension.name}</div>
            </div>
          </div>

          {values === null && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Loading values…</div>}
          {values?.length === 0 && (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
              No values yet.
            </div>
          )}

          {values && values.length > 0 && (
            <div className="farm-card" style={{ overflow: 'hidden', marginBottom: 12 }}>
              {values.map((v, i) => (
                <div key={v.id} style={{ padding: '10px 13px', borderBottom: i < values.length - 1 ? '1px solid var(--border-subtle)' : 'none', display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 'var(--fs-xs)', fontWeight: 800, color: v.archived ? 'var(--text-dim)' : 'var(--text-primary)', flexShrink: 0 }}>{v.code}</span>
                  {renaming?.id === v.id ? (
                    <input className="farm-input" autoFocus value={renameText} onChange={(e) => setRenameText(e.target.value)} style={{ flex: 1, minWidth: 0, padding: '4px 8px', fontSize: 'var(--fs-xs)' }} />
                  ) : (
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{v.name}</span>
                  )}
                  {v.sourceType && <span className="chip" style={{ fontSize: 'var(--fs-2xs)', flexShrink: 0 }}>{v.sourceType}</span>}
                  {v.archived && <span className="chip chip-critical" style={{ fontSize: 'var(--fs-2xs)', flexShrink: 0 }}>Archived</span>}
                  {canEditValue(v) && (
                    renaming?.id === v.id ? (
                      <>
                        <button className="btn-icon" onClick={saveRename} title="Save"><Check size={12} /></button>
                        <button className="btn-icon" onClick={() => setRenaming(null)} title="Cancel"><X size={12} /></button>
                      </>
                    ) : (
                      <>
                        <button className="btn-icon" onClick={() => { setRenaming(v); setRenameText(v.name); }} title="Rename"><Edit2 size={12} /></button>
                        <button className="btn-icon" onClick={() => toggleArchive(v)} title={v.archived ? 'Restore' : 'Archive'}>
                          {v.archived ? <RotateCcw size={12} /> : <Archive size={12} />}
                        </button>
                      </>
                    )
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Only user-defined dimensions take hand-typed values. A UNIT value
              mirrors a real production unit, so it is created by creating the
              unit — not here. */}
          {!dimension.isSystem && !dimension.archived && !adding && (
            <button onClick={() => setAdding(true)} className="btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>
              <Plus size={13} /> Add a value
            </button>
          )}
          {dimension.isSystem && (
            <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', lineHeight: 1.55 }}>
              These follow your farms, units and batches automatically — add a unit or a batch and its value
              appears here with the same code.
            </div>
          )}
          {!dimension.isSystem && dimension.archived && (
            <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', lineHeight: 1.55 }}>
              This dimension is archived — restore it from the register to add new values.
            </div>
          )}

          {adding && (
            <div>
              <label style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Code</label>
              <input className="farm-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. NORTH" style={{ marginBottom: 9, fontFamily: 'monospace' }} />
              <label style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Name</label>
              <input className="farm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Northern block" style={{ marginBottom: 10 }} />
              {err && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 9 }}>{err}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setAdding(false); setErr(''); }} disabled={busy} className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
                <button onClick={add} disabled={busy} className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>{busy ? 'Adding…' : 'Add'}</button>
              </div>
            </div>
          )}
        </div>
    </Sheet>
  );
}

/* ── Edit a user-defined dimension's own attributes ──────────────────────── */
function EditDimensionSheet({
  dimension, tenantId, onClose, onSaved,
}: { dimension: Dimension; tenantId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(dimension.name);
  const [shortName, setShortName] = useState(dimension.shortName);
  const [separator, setSeparator] = useState(dimension.separator);
  const [budgetCheck, setBudgetCheck] = useState(dimension.budgetCheck);
  const [budgetControl, setBudgetControl] = useState(dimension.budgetControl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!name.trim()) { setErr('A name is required.'); return; }
    setBusy(true); setErr('');
    const res = await apiClient.patch(`/api/dimensions/${dimension.id}`, {
      tenantId, name: name.trim(), shortName: shortName.trim(), separator: separator.trim() || '-', budgetCheck, budgetControl,
    });
    setBusy(false);
    if (!res.success) { setErr(res.error || 'Could not save that dimension.'); return; }
    onSaved();
  }

  return (
    <Sheet open onOpenChange={onClose} side="bottom" className="max-h-[88%] rounded-t-2xl">
        <div style={{ padding: '16px 18px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 800 }}>Edit dimension</div>
              <div style={{ fontFamily: 'monospace', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{dimension.code}</div>
            </div>
            <button className="btn-icon" onClick={onClose}><X size={16} /></button>
          </div>

          <label style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Name</label>
          <input className="farm-input" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 10 }} />

          <label style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Short name</label>
          <input className="farm-input" value={shortName} onChange={(e) => setShortName(e.target.value)} style={{ marginBottom: 10, fontFamily: 'monospace' }} />

          <label style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Separator</label>
          <input className="farm-input" value={separator} onChange={(e) => setSeparator(e.target.value)} maxLength={3} style={{ marginBottom: 4, fontFamily: 'monospace', width: 70 }} />
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginBottom: 12 }}>Used when a coded value is displayed as one string, e.g. &quot;BATCH-01&quot;.</div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={budgetCheck} onChange={(e) => setBudgetCheck(e.target.checked)} />
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-primary)' }}>Budget check</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={budgetControl} onChange={(e) => setBudgetControl(e.target.checked)} />
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-primary)' }}>Budget control</span>
          </label>
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 14, display: 'flex', gap: 6 }}>
            <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
            <span>No budget feature exists yet — these are stored for when one does, and do nothing today.</span>
          </div>

          {err && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 10 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={busy} className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
            <button onClick={save} disabled={busy} className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
    </Sheet>
  );
}

function CreateDimensionSheet({ tenantId, onClose, onCreated }: { tenantId: string; onClose: () => void; onCreated: (code: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  // The owner's "you can specify how many levels a dimension has, like two
  // levels for example batch and sub-batch, and one can type the name".
  const [levels, setLevels] = useState<string[]>(['']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function create() {
    const named = levels.map((l) => l.trim()).filter(Boolean);
    if (!code.trim() || !name.trim()) { setErr('A code and a name are both required.'); return; }
    if (named.length === 0) { setErr('Name at least one level.'); return; }
    setBusy(true); setErr('');
    const res = await apiClient.post('/api/dimensions', { tenantId, code: code.trim(), name: name.trim(), levels: named });
    setBusy(false);
    if (!res.success) { setErr(res.error || 'Could not create that dimension.'); return; }
    onCreated(code.trim().toUpperCase());
  }

  return (
    <Sheet open onOpenChange={onClose} side="bottom" className="max-h-[88%] rounded-t-2xl">
        <div style={{ padding: '16px 18px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 800 }}>New dimension</div>
            <button className="btn-icon" onClick={onClose}><X size={16} /></button>
          </div>

          <label style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Code</label>
          <input className="farm-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. PROJECT" style={{ marginBottom: 4, fontFamily: 'monospace' }} />
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginBottom: 10 }}>Short, and unlikely to change — this is what gets typed and memorised. Also used as this dimension&apos;s Short Name.</div>

          <label style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Name</label>
          <input className="farm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Project" style={{ marginBottom: 12 }} />

          <label style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Levels</label>
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.5 }}>
            Name each level from the top down. Two levels called Batch and Sub-batch let you report either
            per sub-batch or rolled up per batch.
          </div>
          {levels.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 7, marginBottom: 7, alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', width: 14, flexShrink: 0 }}>{i + 1}.</span>
              <input
                className="farm-input"
                value={l}
                onChange={(e) => setLevels((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={i === 0 ? 'e.g. Batch' : 'e.g. Sub-batch'}
                style={{ flex: 1 }}
              />
              {levels.length > 1 && (
                <button onClick={() => setLevels((prev) => prev.filter((_, j) => j !== i))} className="btn-icon" style={{ flexShrink: 0 }}><X size={13} /></button>
              )}
            </div>
          ))}
          <button onClick={() => setLevels((prev) => [...prev, ''])} style={{ background: 'none', border: 'none', color: 'var(--primary-green)', cursor: 'pointer', fontSize: 'var(--fs-xs)', fontWeight: 700, padding: 0, marginBottom: 12 }}>
            + Add a level
          </button>

          {err && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 10 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={busy} className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
            <button onClick={create} disabled={busy} className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>{busy ? 'Creating…' : 'Create'}</button>
          </div>
        </div>
    </Sheet>
  );
}

/* ── Account rules tab (Default Dimensions UI — item 1, the biggest gap) ───
 * The owner's own ERP shape: an Account form with a "Required Dimensions"
 * panel alongside Account Details and Account Analysis. `accounts` has NO
 * tenantId (see db/schemas/finance.ts:36 — the chart of accounts is shared
 * across every tenant on the platform), so Account Details is READ-ONLY here
 * — there is no per-tenant account row to write to, and one farm renaming a
 * shared account for everyone is not acceptable. Required Dimensions IS
 * per-tenant (it writes default_dimensions scoped by tenantId) and IS
 * editable — that split is stated on screen, not left for a farmer to
 * discover by typing into a field that silently does nothing. */
function AccountsTab({ tenantId, dimensions, showToast }: { tenantId: string; dimensions: Dimension[]; showToast: (msg: string, kind?: 'success' | 'error' | 'warning' | 'info') => void }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [open, setOpen] = useState<Account | null>(null);

  useEffect(() => {
    apiClient.get<Account[]>('/api/gl/accounts').then((r) => { if (r.success) setAccounts(r.data); else setAccounts([]); });
  }, []);

  return (
    <div>
      <div className="farm-card" style={{ padding: '11px 13px', marginBottom: 10, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <Info size={14} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          The chart of accounts below is shared by every farm on the platform — its code, name and class are
          read-only here. What you CAN set per account, for your farm only, is which dimensions a posting to
          it must carry.
        </div>
      </div>

      {accounts === null && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Loading accounts…</div>}
      {accounts?.length === 0 && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>No accounts found.</div>}

      {accounts && accounts.length > 0 && (
        <div className="farm-card" style={{ overflow: 'hidden', marginBottom: 12 }}>
          {accounts.map((a, i) => (
            <button
              key={a.id}
              onClick={() => setOpen(a)}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 13px', display: 'flex', alignItems: 'center', gap: 9,
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: i < accounts.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}
            >
              <span style={{ fontFamily: 'monospace', fontSize: 'var(--fs-xs)', fontWeight: 800, color: 'var(--text-primary)', flexShrink: 0 }}>{a.code}</span>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{a.name}</span>
              <span className="chip" style={{ fontSize: 'var(--fs-2xs)', flexShrink: 0 }}>{a.class}</span>
              <ChevronRight size={14} color="var(--text-dim)" style={{ flexShrink: 0 }} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {open && (
        <AccountDimensionsSheet
          account={open} tenantId={tenantId} dimensions={dimensions} onClose={() => setOpen(null)} showToast={showToast}
        />
      )}
    </div>
  );
}

function AccountDimensionsSheet({
  account, tenantId, dimensions, onClose, showToast,
}: { account: Account; tenantId: string; dimensions: Dimension[]; onClose: () => void; showToast: (msg: string, kind?: 'success' | 'error' | 'warning' | 'info') => void }) {
  const [rules, setRules] = useState<DefaultDimensionRow[] | null>(null);
  const [busyDim, setBusyDim] = useState<string | null>(null);

  const load = useCallback(() => {
    apiClient.get<DefaultDimensionRow[]>(`/api/dimensions/defaults?tenantId=${tenantId}&masterType=account&masterId=${account.id}`)
      .then((r) => { if (r.success) setRules(r.data); else setRules([]); });
  }, [tenantId, account.id]);
  useEffect(() => { load(); }, [load]);

  const ruleFor = (dimensionId: string) => rules?.find((r) => r.dimensionId === dimensionId);

  async function setRequirement(dim: Dimension, requirement: 'required' | 'optional' | 'blocked') {
    setBusyDim(dim.id);
    const res = await apiClient.post('/api/dimensions/defaults', {
      tenantId, masterType: 'account', masterId: account.id, dimensionCode: dim.code, requirement,
    });
    setBusyDim(null);
    if (!res.success) { showToast(res.error || 'Could not save that rule.', 'error'); return; }
    load();
  }

  return (
    <Sheet open onOpenChange={onClose} side="bottom" className="max-h-[90%] rounded-t-2xl">
        <div style={{ padding: '16px 18px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 800 }}>Account</div>
            <button className="btn-icon" onClick={onClose}><X size={16} /></button>
          </div>

          {/* Account Details — read-only, platform-wide */}
          <SectionLabel>Account details</SectionLabel>
          <div className="farm-card" style={{ padding: 13, marginBottom: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 'var(--fs-md)', color: 'var(--text-primary)' }}>{account.code}</span>
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-primary)' }}>{account.name}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="chip" style={{ fontSize: 'var(--fs-2xs)' }}>{account.class}</span>
              <span className="chip" style={{ fontSize: 'var(--fs-2xs)' }}>Normal balance: {account.normalBalance}</span>
            </div>
          </div>
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 16, display: 'flex', gap: 6 }}>
            <Lock size={11} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
            <span>Read-only: this is the shared chart of accounts every farm on the platform posts to. Renaming it here would rename it for all of them.</span>
          </div>

          {/* Account Analysis — a read display of what's already configured */}
          <SectionLabel>Account analysis</SectionLabel>
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
            {rules && rules.filter((r) => r.requirement !== 'optional').length === 0
              ? 'No dimension rules are set on this account for your farm yet — every posting to it can carry any dimension, and none are required.'
              : `${rules?.filter((r) => r.requirement === 'required').length ?? 0} required, ${rules?.filter((r) => r.requirement === 'blocked').length ?? 0} blocked, out of ${dimensions.length} dimension${dimensions.length === 1 ? '' : 's'}.`}
          </div>

          {/* Required Dimensions — per-tenant, editable */}
          <SectionLabel>Required dimensions</SectionLabel>
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 10 }}>
            Only for your farm. A posting to this account that is Required and has no value will be refused —
            never silently posted unanalysed.
          </div>

          {rules === null && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Loading…</div>}

          {rules !== null && dimensions.map((dim) => {
            const rule = ruleFor(dim.id);
            const requirement = rule?.requirement ?? 'optional';
            return (
              <div key={dim.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 'var(--fs-xs)', fontWeight: 800, color: 'var(--text-primary)' }}>{dim.code}</span>
                  <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginLeft: 6 }}>{dim.name}</span>
                </div>
                {/* Yes/No, the owner's own shape — with Blocked kept as a
                    third state (already enforced at posting; see
                    db/schemas/dimensions.ts's `requirement` comment). */}
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button
                    disabled={busyDim === dim.id}
                    onClick={() => setRequirement(dim, 'optional')}
                    className={requirement === 'optional' ? 'chip chip-info' : 'chip'}
                    style={{ border: 'none', cursor: 'pointer', fontSize: 'var(--fs-2xs)' }}
                  >No</button>
                  <button
                    disabled={busyDim === dim.id}
                    onClick={() => setRequirement(dim, 'required')}
                    className={requirement === 'required' ? 'chip chip-ok' : 'chip'}
                    style={{ border: 'none', cursor: 'pointer', fontSize: 'var(--fs-2xs)' }}
                  >Yes</button>
                  <button
                    disabled={busyDim === dim.id}
                    onClick={() => setRequirement(dim, 'blocked')}
                    className={requirement === 'blocked' ? 'chip chip-critical' : 'chip'}
                    style={{ border: 'none', cursor: 'pointer', fontSize: 'var(--fs-2xs)' }}
                    title="Never analyse this account by this dimension"
                  >Blocked</button>
                </div>
              </div>
            );
          })}
        </div>
    </Sheet>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7, marginTop: 4 }}>
      {children}
    </div>
  );
}

/* ── Other masters' defaults (item 1: "give the other masters their
 * defaults where it is cheap") ───────────────────────────────────────────
 * Only USER-DEFINED dimensions are offered here — a unit/batch/farm's own
 * system-dimension default is itself (written by lib/dimensions.ts's
 * project*() functions the moment the unit/batch/farm is created); showing
 * that as an editable field here would invite exactly the "two places to
 * rename one thing" mistake this whole task's rules exist to prevent. What
 * IS genuinely useful and missing is a tenant's OWN dimension (e.g.
 * "Department") defaulting onto their units/batches/employees/products — a
 * generic, one-screen way to set that, reusing the same
 * POST /api/dimensions/defaults every other default in this file writes to. */
type MasterKind = 'unit' | 'batch' | 'employee' | 'product';
const MASTER_KIND_LABEL: Record<MasterKind, string> = { unit: 'Production unit', batch: 'Batch', employee: 'Employee', product: 'Product' };
const MASTER_KIND_ENDPOINT: Record<MasterKind, string> = { unit: '/api/units', batch: '/api/batches', employee: '/api/employees', product: '/api/products' };

function OtherDefaultsTab({ tenantId, dimensions, showToast }: { tenantId: string; dimensions: Dimension[]; showToast: (msg: string, kind?: 'success' | 'error' | 'warning' | 'info') => void }) {
  const [kind, setKind] = useState<MasterKind>('unit');
  const [masters, setMasters] = useState<{ id: string; code: string; name: string }[] | null>(null);
  const [selected, setSelected] = useState<{ id: string; code: string; name: string } | null>(null);

  useEffect(() => {
    setMasters(null); setSelected(null);
    apiClient.get<{ id: string; code: string; name: string }[]>(`${MASTER_KIND_ENDPOINT[kind]}?tenantId=${tenantId}`).then((r) => {
      setMasters(r.success ? r.data : []);
    });
  }, [kind, tenantId]);

  if (dimensions.length === 0) {
    return (
      <div className="farm-card" style={{ padding: 16, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Create a dimension of your own first (e.g. Department) in the Dimensions tab — the built-in ones
        (Unit, Farm, Batch, Enterprise) already follow their own record automatically and have nothing to
        set here.
      </div>
    );
  }

  return (
    <div>
      <div className="chip-row" style={{ marginBottom: 10 }}>
        {(Object.keys(MASTER_KIND_LABEL) as MasterKind[]).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={kind === k ? 'chip chip-info' : 'chip'} style={{ flexShrink: 0, cursor: 'pointer', border: 'none' }}>
            {MASTER_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {masters === null && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Loading…</div>}
      {masters?.length === 0 && <div className="farm-card" style={{ padding: 14, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>No {MASTER_KIND_LABEL[kind].toLowerCase()}s yet.</div>}

      {masters && masters.length > 0 && (
        <div className="farm-card" style={{ overflow: 'hidden', marginBottom: 12 }}>
          {masters.map((m, i) => (
            <button
              key={m.id}
              onClick={() => setSelected(m)}
              style={{ width: '100%', textAlign: 'left', padding: '10px 13px', display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', cursor: 'pointer', borderBottom: i < masters.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}
            >
              <span style={{ fontFamily: 'monospace', fontSize: 'var(--fs-xs)', fontWeight: 800, color: 'var(--text-primary)', flexShrink: 0 }}>{m.code}</span>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{m.name}</span>
              <ChevronRight size={14} color="var(--text-dim)" style={{ flexShrink: 0 }} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {selected && (
        <MasterDefaultsSheet
          masterType={kind} masterLabel={MASTER_KIND_LABEL[kind]} master={selected} tenantId={tenantId}
          dimensions={dimensions} onClose={() => setSelected(null)} showToast={showToast}
        />
      )}
    </div>
  );
}

function MasterDefaultsSheet({
  masterType, masterLabel, master, tenantId, dimensions, onClose, showToast,
}: {
  masterType: MasterKind; masterLabel: string; master: { id: string; code: string; name: string }; tenantId: string
  dimensions: Dimension[]; onClose: () => void; showToast: (msg: string, kind?: 'success' | 'error' | 'warning' | 'info') => void
}) {
  const [rules, setRules] = useState<DefaultDimensionRow[] | null>(null);
  const [valuesByDim, setValuesByDim] = useState<Record<string, DimensionValue[]>>({});
  const [busyDim, setBusyDim] = useState<string | null>(null);

  const load = useCallback(() => {
    apiClient.get<DefaultDimensionRow[]>(`/api/dimensions/defaults?tenantId=${tenantId}&masterType=${masterType}&masterId=${master.id}`)
      .then((r) => { if (r.success) setRules(r.data); else setRules([]); });
  }, [tenantId, masterType, master.id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    dimensions.forEach((d) => {
      apiClient.get<DimensionValue[]>(`/api/dimensions/${d.id}/values?tenantId=${tenantId}`).then((r) => {
        if (r.success) setValuesByDim((prev) => ({ ...prev, [d.id]: r.data.filter((v) => !v.archived) }));
      });
    });
  }, [dimensions, tenantId]);

  const ruleFor = (dimensionId: string) => rules?.find((r) => r.dimensionId === dimensionId);

  async function setDefault(dim: Dimension, valueCode: string | null) {
    setBusyDim(dim.id);
    const res = await apiClient.post('/api/dimensions/defaults', {
      tenantId, masterType, masterId: master.id, dimensionCode: dim.code, valueCode, requirement: 'optional',
    });
    setBusyDim(null);
    if (!res.success) { showToast(res.error || 'Could not save that default.', 'error'); return; }
    load();
  }

  return (
    <Sheet open onOpenChange={onClose} side="bottom" className="max-h-[90%] rounded-t-2xl">
        <div style={{ padding: '16px 18px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{masterLabel}</div>
              <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 'var(--fs-md)' }}>{master.code}</span>
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{master.name}</span>
              </div>
            </div>
            <button className="btn-icon" onClick={onClose}><X size={16} /></button>
          </div>

          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 12 }}>
            Whatever you set here flows onto any sale, purchase or payroll line this {masterLabel.toLowerCase()} is
            posted against, unless something more specific overrides it.
          </div>

          {rules === null && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Loading…</div>}

          {rules !== null && dimensions.map((dim) => {
            const rule = ruleFor(dim.id);
            const currentValueId = rule?.dimensionValueId ?? '';
            const values = valuesByDim[dim.id] ?? [];
            return (
              <div key={dim.id} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  <span style={{ fontFamily: 'monospace' }}>{dim.code}</span> — {dim.name}
                </label>
                <select
                  className="farm-input"
                  disabled={busyDim === dim.id}
                  value={currentValueId}
                  onChange={(e) => {
                    const v = values.find((x) => x.id === e.target.value);
                    setDefault(dim, v ? v.code : null);
                  }}
                >
                  <option value="">No default</option>
                  {values.map((v) => <option key={v.id} value={v.id}>{v.code} — {v.name}</option>)}
                </select>
              </div>
            );
          })}
        </div>
    </Sheet>
  );
}
