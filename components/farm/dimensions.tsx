'use client';
// ============================================================
// dimensions.tsx — Analytical dimensions (Business Central model)
//
// The config surface for the dimension layer on the GL. Until this existed
// the whole feature was real but unreachable: the backfill had projected
// every farm, unit and batch into coded dimension values, postings were
// capturing them, and `GET /api/reports/dimension-pl` could report by any
// level — with nothing in the app to look at any of it.
//
// Codes are the point. Accountants memorise them, so every list here leads
// with the code in monospace and treats the name as the subtitle, not the
// other way round.
// ============================================================
import React, { useCallback, useEffect, useState } from 'react';
import { useNav, TopNav } from './navigation';
import { useToast } from './ui-shared';
import { apiClient } from '@/lib/request';
import { Plus, X, ChevronRight, Layers, Lock, FileText } from './icons';

type DimensionLevel = { id: string; ordinal: number; name: string };
type Dimension = {
  id: string; code: string; name: string; sortOrder: number;
  isSystem: boolean; active: boolean; levels: DimensionLevel[];
};
type DimensionValue = {
  id: string; code: string; name: string; levelOrdinal: number;
  parentValueId: string | null; sourceType: string | null; archived: boolean;
};

export function DimensionsScreen() {
  const { tenantId, navigate } = useNav();
  const { showToast } = useToast();
  const [dimensions, setDimensions] = useState<Dimension[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Dimension | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    apiClient.get<Dimension[]>(`/api/dimensions?tenantId=${tenantId}`).then((res) => {
      if (res.success) { setDimensions(res.data); setError(''); }
      else setError(res.error || 'Could not load dimensions.');
    });
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="screen-content">
      <TopNav title="Dimensions" subtitle="How the ledger is analysed" />
      <div className="px-screen" style={{ paddingTop: 14 }}>

        <div className="farm-card" style={{ padding: '12px 14px', marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Layers size={16} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.55 }}>
            Every sale, purchase and payroll run is tagged with these, and every journal line carries them.
            That is what lets a P&amp;L be produced per unit, per farm or per batch instead of one figure for
            the whole business.
          </div>
        </div>

        {error && (
          <div className="farm-card" style={{ padding: 13, marginBottom: 14, border: '1px solid rgba(248,113,113,0.3)', fontSize: 'var(--fs-sm)', color: 'var(--status-critical)' }}>{error}</div>
        )}

        {dimensions === null && !error && (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', padding: '8px 0' }}>Loading dimensions…</div>
        )}

        {dimensions?.map((d) => (
          <button
            key={d.id}
            onClick={() => setOpen(d)}
            className="farm-card"
            style={{ width: '100%', padding: 13, marginBottom: 8, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 11 }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Code first and in monospace — this is what an accountant
                    scans for, and what they type into a journal. */}
                <span style={{ fontFamily: 'monospace', fontSize: 'var(--fs-sm)', fontWeight: 800, color: 'var(--text-primary)' }}>{d.code}</span>
                {d.isSystem && (
                  <span className="chip" style={{ fontSize: 'var(--fs-2xs)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <Lock size={9} aria-hidden="true" /> Built in
                  </span>
                )}
                {!d.active && <span className="chip chip-critical" style={{ fontSize: 'var(--fs-2xs)' }}>Inactive</span>}
              </div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{d.name}</div>
              <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginTop: 3 }}>
                {d.levels.length} level{d.levels.length === 1 ? '' : 's'}
                {d.levels.length > 0 ? ` · ${d.levels.map((l) => l.name).join(' → ')}` : ''}
              </div>
            </div>
            <ChevronRight size={15} color="var(--text-dim)" style={{ flexShrink: 0 }} aria-hidden="true" />
          </button>
        ))}

        {dimensions?.length === 0 && (
          <div className="farm-card" style={{ padding: 16, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            No dimensions yet. The built-in ones (Unit, Farm, Batch, Enterprise) are created for a farm the
            first time something is posted — add your own below for anything else you want to report by.
          </div>
        )}

        <button onClick={() => setShowCreate(true)} className="btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 6, marginBottom: 10 }}>
          <Plus size={14} /> New dimension
        </button>

        <button
          onClick={() => navigate('reports')}
          style={{ width: '100%', padding: 12, borderRadius: 12, background: 'var(--card)', border: '1px solid var(--border-subtle)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9, marginBottom: 24 }}
        >
          <FileText size={15} color="var(--primary-green)" aria-hidden="true" />
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>P&amp;L by dimension</span>
          <ChevronRight size={14} color="var(--text-dim)" style={{ marginLeft: 'auto' }} aria-hidden="true" />
        </button>
      </div>

      {open && <DimensionValuesSheet dimension={open} tenantId={tenantId} onClose={() => setOpen(null)} />}
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

/* ── A dimension's coded values ───────────────────────────────────────────
 * Values projected from a real farm/unit/batch are marked and NOT editable
 * here: their code follows the operational record, and letting someone rename
 * one in two places is how a ledger and a farm stop agreeing. */
function DimensionValuesSheet({ dimension, tenantId, onClose }: { dimension: Dimension; tenantId: string; onClose: () => void }) {
  const [values, setValues] = useState<DimensionValue[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '22px 22px 0 0', width: '100%', maxHeight: '88%', overflowY: 'auto', border: '1px solid var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '16px 18px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'monospace', fontSize: 'var(--fs-lg)', fontWeight: 800, color: 'var(--text-primary)' }}>{dimension.code}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 1 }}>{dimension.name}</div>
            </div>
            <button className="btn-icon" onClick={onClose}><X size={16} /></button>
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
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{v.name}</span>
                  {v.sourceType && <span className="chip" style={{ fontSize: 'var(--fs-2xs)', flexShrink: 0 }}>{v.sourceType}</span>}
                  {v.archived && <span className="chip chip-critical" style={{ fontSize: 'var(--fs-2xs)', flexShrink: 0 }}>Archived</span>}
                </div>
              ))}
            </div>
          )}

          {/* Only user-defined dimensions take hand-typed values. A UNIT value
              mirrors a real production unit, so it is created by creating the
              unit — not here. */}
          {!dimension.isSystem && !adding && (
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
      </div>
    </div>
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
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '22px 22px 0 0', width: '100%', maxHeight: '88%', overflowY: 'auto', border: '1px solid var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '16px 18px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 800 }}>New dimension</div>
            <button className="btn-icon" onClick={onClose}><X size={16} /></button>
          </div>

          <label style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Code</label>
          <input className="farm-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. PROJECT" style={{ marginBottom: 4, fontFamily: 'monospace' }} />
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginBottom: 10 }}>Short, and unlikely to change — this is what gets typed and memorised.</div>

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
      </div>
    </div>
  );
}
