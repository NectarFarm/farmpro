'use client';
// ============================================================
// farm-config.tsx — Farm Configuration (farm-configuration task)
//
// The gap this fills, in the owner's own words: "we miss that page for
// configuring the farm, like things that can be permanent like stage life."
//
// Everything a farm sets up ONCE and then lives with was scattered or missing:
//   - stages were not configurable at all. `batches.stage` was free text
//     written by a free-text input, so "Finisher", "finisher" and "Finishr"
//     became three stages on one farm, and nothing anywhere knew how long a
//     stage was meant to last. Both are fixed by db/schemas/stages.ts and the
//     Stages tab here.
//   - products could only be attached from the BATCH side, one batch at a
//     time. The question a farmer actually asks when setting up — "which
//     batches produce eggs?" — had no screen. The Products tab answers it in
//     that direction, backed by GET/PUT /api/products/[id]/batches.
//   - production units and daily routines already have good screens, so this
//     links OUT to them rather than reimplementing them. Duplicating a working
//     editor is how two editors drift.
//
// Owner-only. Renaming or reordering a stage changes what every batch's
// `stage` value MEANS and what PATCH /api/batches/[id] will accept into it —
// that is a data-shape decision, not day-to-day operations, and a manager
// running the farm has no reason to redefine the vocabulary underneath live
// batches. The API enforces the same thing independently (PUT /api/stages).
// ============================================================
import React, { useState, useEffect, useCallback } from 'react';
import { useNav, TopNav } from './navigation';
import { useToast } from './ui-shared';
import { apiClient } from '@/lib/request';
import { ENTERPRISE_REGISTRY } from './data';
import {
  Plus, X, ChevronRight, Layers, Package, Lock, AlertTriangle, Check, Sprout,
} from './icons';

/* GET /api/stages's payload. `typicalDays` is nullable because migration 0036
 * backfills stage NAMES from what each farm's batches already use, and the
 * duration for those is genuinely unknown — the UI says "not set" rather than
 * inventing a figure for the field a farmer would trust most. */
interface ApiStage {
  id: string;
  enterprise: string;
  name: string;
  sortOrder: number;
  typicalDays: number | null;
}
interface StagesPayload {
  stages: ApiStage[];
  enterprises: string[];
  /** (enterprise, stage) pairs live batches are currently sitting at. */
  inUse: { enterprise: string; stage: string }[];
}

interface ApiProduct {
  id: string;
  name: string;
  type: string;
  status: string;
}
interface ProductBatchLink {
  batchId: string;
  code: string;
  name: string;
  enterprise: string;
  unitId: string;
  unitName: string;
  offers: boolean;
  inherits: boolean;
  via: 'inherited' | 'added' | 'excluded' | 'not-offered';
}

/* A stage being edited. `days` stays a STRING so an empty box is
 * distinguishable from a zero — "" means "not set" (stored as null), which is
 * a real and common value here. */
interface DraftStage {
  key: string;
  name: string;
  days: string;
}

function enterpriseLabel(key: string): string {
  return ENTERPRISE_REGISTRY.find((r) => r.subtype === key)?.label
    // A tenant can hold an enterprise key the UI registry has no entry for
    // (an admin grant, or a key added after this build). Render the key
    // readably instead of blank.
    ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

let draftSeq = 0;
const newKey = () => `draft-${draftSeq++}`;

export function FarmConfigScreen() {
  const { role, navigate } = useNav();
  const { showToast } = useToast();
  const [tab, setTab] = useState<'stages' | 'products' | 'structure'>('stages');

  const isOwner = role === 'owner' || role === 'super_admin';

  if (!isOwner) {
    // The API refuses these writes anyway; saying so up front beats offering
    // controls that fail on submit. Same reasoning as the read-only rows on
    // the Settings screen.
    return (
      <div className="screen-content">
        <TopNav title="Farm Configuration" showBack />
        <div className="px-screen" style={{ paddingTop: 16 }}>
          <div className="farm-card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Lock size={18} color="var(--text-dim)" aria-hidden="true" />
            <div>
              <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                Owner access only
              </div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                This page defines what a stage means and which batches produce what — changes here affect every
                existing batch, so only the farm owner can make them. Ask them if something needs adding.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-content">
      <TopNav title="Farm Configuration" subtitle="The permanent setup — stages, products, structure" showBack />
      <div className="px-screen" style={{ paddingTop: 14 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto' }}>
          {([
            ['stages', 'Stages', Layers],
            ['products', 'Products', Package],
            ['structure', 'Structure', Sprout],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
                fontSize: 'var(--fs-sm)', fontWeight: 700,
                background: tab === id ? 'rgba(74,222,128,0.12)' : 'var(--card)',
                border: tab === id ? '1px solid var(--primary-green)' : '1px solid var(--border-subtle)',
                color: tab === id ? 'var(--primary-green)' : 'var(--text-muted)',
              }}
            >
              <Icon size={13} aria-hidden="true" />{label}
            </button>
          ))}
        </div>

        {tab === 'stages' && <StagesTab showToast={showToast} />}
        {tab === 'products' && <ProductsTab showToast={showToast} />}
        {tab === 'structure' && <StructureTab navigate={navigate} />}
      </div>
    </div>
  );
}

/* ── Stages ──────────────────────────────────────────────────────────────────
 * One editable list per enterprise. Order IS the progression — PUT /api/stages
 * derives sortOrder from the array index rather than accepting one, so two
 * stages can never claim the same position. */
function StagesTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error' | 'warning' | 'info') => void }) {
  const [data, setData] = useState<StagesPayload | null>(null);
  const [enterprise, setEnterprise] = useState('');
  const [draft, setDraft] = useState<DraftStage[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiClient.get<StagesPayload>('/api/stages').then((res) => {
      if (!res.success) { setError(res.error || 'Could not load the stage setup.'); setData({ stages: [], enterprises: [], inUse: [] }); return; }
      setData(res.data);
      setEnterprise((prev) => prev || res.data.enterprises[0] || '');
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  // Reset the draft whenever the selected enterprise changes, so edits to one
  // enterprise can never be saved against another.
  useEffect(() => {
    if (!data || !enterprise) { setDraft([]); return; }
    setDraft(
      data.stages
        .filter((s) => s.enterprise === enterprise)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((s) => ({ key: s.id, name: s.name, days: s.typicalDays === null ? '' : String(s.typicalDays) }))
    );
    setError('');
  }, [data, enterprise]);

  // Stages live batches are sitting at, for this enterprise. Removing one of
  // these leaves those batches holding a value the farm no longer recognises,
  // and PATCH /api/batches/[id] would then refuse to advance them — so it is
  // worth a warning before the save, not an error after it.
  const inUseHere = new Set(
    (data?.inUse ?? [])
      .filter((r) => r.enterprise === enterprise)
      .map((r) => r.stage.trim().toLowerCase())
  );
  const removedInUse = [...inUseHere].filter(
    (used) => !draft.some((d) => d.name.trim().toLowerCase() === used)
  );

  function move(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= draft.length) return;
    const next = [...draft];
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  }

  async function save() {
    setError('');
    // Checked here too, not only server-side, because the server's refusal
    // would name only the first duplicate and the farmer is looking at the
    // whole list.
    const seen = new Set<string>();
    for (const d of draft) {
      const name = d.name.trim();
      if (!name) { setError('Every stage needs a name.'); return; }
      const key = name.toLowerCase();
      if (seen.has(key)) { setError(`"${name}" is listed twice.`); return; }
      seen.add(key);
      if (d.days.trim() !== '') {
        const n = Number(d.days);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
          setError(`Stage life for "${name}" must be a whole number of days above zero.`);
          return;
        }
      }
    }

    setSaving(true);
    const res = await apiClient.put('/api/stages', {
      enterprise,
      stages: draft.map((d) => ({ name: d.name.trim(), typicalDays: d.days.trim() === '' ? null : Number(d.days) })),
    });
    setSaving(false);
    if (!res.success) { setError(res.error || 'Could not save the stages.'); return; }
    showToast(`Stages saved for ${enterpriseLabel(enterprise)}.`, 'success');
    load();
  }

  if (data === null) {
    return <div style={{ padding: 14, fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Loading…</div>;
  }

  if (data.enterprises.length === 0) {
    return (
      <div className="farm-card" style={{ padding: 16, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        This farm has no enterprises yet, so there is nothing to define stages for. Create a batch, or ask an
        administrator to add an enterprise to the account, and it will appear here.
      </div>
    );
  }

  return (
    <div>
      <div className="farm-card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>Enterprise</div>
        <select className="farm-input" value={enterprise} onChange={(e) => setEnterprise(e.target.value)}>
          {data.enterprises.map((k) => <option key={k} value={k}>{enterpriseLabel(k)}</option>)}
        </select>
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          Stages are per enterprise — a broiler house and a maize plot do not share a progression.
        </div>
      </div>

      <div className="farm-card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div className="section-eyebrow">Stages, in order</div>
          <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)' }}>{draft.length} stage{draft.length === 1 ? '' : 's'}</span>
        </div>
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.5 }}>
          The order here is the progression. Advancing a batch offers the next one down.
          Stage life is how long it usually lasts — leave it blank if you do not want to commit to a number.
        </div>

        {draft.length === 0 && (
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
            No stages defined for {enterpriseLabel(enterprise)}. Until you add some, batches of this enterprise
            accept any stage text — which is what lets typos through.
          </div>
        )}

        {draft.map((d, i) => {
          const isUsed = inUseHere.has(d.name.trim().toLowerCase());
          return (
            <div key={d.key} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: i < draft.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 800, color: 'var(--text-dim)', width: 16, flexShrink: 0 }}>{i + 1}</span>
                <input
                  className="farm-input"
                  value={d.name}
                  onChange={(e) => setDraft(draft.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)))}
                  placeholder="Stage name"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  onClick={() => setDraft(draft.filter((_, xi) => xi !== i))}
                  className="btn-icon"
                  aria-label={`Remove ${d.name || 'stage'}`}
                  style={{ flexShrink: 0 }}
                ><X size={14} /></button>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingLeft: 22 }}>
                <input
                  className="farm-input"
                  type="number" inputMode="numeric" min="1" step="1"
                  value={d.days}
                  onChange={(e) => setDraft(draft.map((x, xi) => (xi === i ? { ...x, days: e.target.value } : x)))}
                  placeholder="Not set"
                  style={{ width: 90, flexShrink: 0 }}
                />
                <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', flex: 1 }}>
                  days{d.days.trim() === '' ? ' · stage life not set' : ''}
                </span>
                <button onClick={() => move(i, -1)} disabled={i === 0} className="btn-icon" aria-label="Move up" style={{ opacity: i === 0 ? 0.35 : 1, flexShrink: 0 }}>↑</button>
                <button onClick={() => move(i, 1)} disabled={i === draft.length - 1} className="btn-icon" aria-label="Move down" style={{ opacity: i === draft.length - 1 ? 0.35 : 1, flexShrink: 0 }}>↓</button>
              </div>
              {isUsed && (
                <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', paddingLeft: 22, marginTop: 4 }}>
                  Live batches are at this stage
                </div>
              )}
            </div>
          );
        })}

        <button
          onClick={() => setDraft([...draft, { key: newKey(), name: '', days: '' }])}
          className="btn-secondary"
          style={{ width: '100%', justifyContent: 'center', fontSize: 'var(--fs-sm)', padding: 10, marginTop: 4 }}
        ><Plus size={14} /> Add a stage</button>
      </div>

      {removedInUse.length > 0 && (
        <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.25)', marginBottom: 12, display: 'flex', gap: 10 }}>
          <AlertTriangle size={16} color="var(--status-critical)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Live batches are sitting at <strong>{removedInUse.join(', ')}</strong>, which this list no longer
            contains. Saving leaves them holding a stage the farm no longer recognises, and they cannot be advanced
            until it is added back or they are moved to a stage that exists.
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10, lineHeight: 1.5 }}>{error}</div>}

      <button onClick={save} className="btn-primary" disabled={saving} style={{ width: '100%', justifyContent: 'center', marginBottom: 20 }}>
        {saving ? 'Saving…' : `Save stages for ${enterpriseLabel(enterprise)}`}
      </button>
    </div>
  );
}

/* ── Products ────────────────────────────────────────────────────────────────
 * The direction that had no screen: pick a product, see and set which batches
 * produce it. GET/PUT /api/products/[id]/batches writes only the EXCEPTIONS to
 * unit inheritance — a batch that should offer a product and already inherits
 * it gets no row at all, which is what keeps a later change to the unit
 * reaching its batches. */
function ProductsTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error' | 'warning' | 'info') => void }) {
  const [products, setProducts] = useState<ApiProduct[] | null>(null);
  const [productId, setProductId] = useState('');
  const [links, setLinks] = useState<ProductBatchLink[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient.get<ApiProduct[]>('/api/products').then((res) => {
      setProducts(res.success ? res.data : []);
      if (res.success && res.data[0]) setProductId(res.data[0].id);
    });
  }, []);

  const loadLinks = useCallback(() => {
    if (!productId) return;
    setLinks(null);
    apiClient.get<{ batches: ProductBatchLink[] }>(`/api/products/${productId}/batches`).then((res) => {
      if (!res.success) { setError(res.error || 'Could not load batches.'); setLinks([]); return; }
      setLinks(res.data.batches);
      setSelected(new Set(res.data.batches.filter((b) => b.offers).map((b) => b.batchId)));
      setError('');
    });
  }, [productId]);
  useEffect(() => { loadLinks(); }, [loadLinks]);

  async function save() {
    setSaving(true);
    setError('');
    const res = await apiClient.put(`/api/products/${productId}/batches`, { batchIds: [...selected] });
    setSaving(false);
    if (!res.success) { setError(res.error || 'Could not save.'); return; }
    const name = products?.find((p) => p.id === productId)?.name ?? 'Product';
    showToast(`${name} updated.`, 'success');
    loadLinks();
  }

  if (products === null) {
    return <div style={{ padding: 14, fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Loading…</div>;
  }
  if (products.length === 0) {
    return (
      <div className="farm-card" style={{ padding: 16, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        No products in the catalogue yet. Products are what a batch yields and what a sale draws down — without
        them a sale cannot reduce stock. Add them from the Crops &amp; Livestock screen first.
      </div>
    );
  }

  const byEnterprise = new Map<string, ProductBatchLink[]>();
  for (const l of links ?? []) {
    const list = byEnterprise.get(l.enterprise) ?? [];
    list.push(l);
    byEnterprise.set(l.enterprise, list);
  }

  return (
    <div>
      <div className="farm-card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>Product</div>
        <select className="farm-input" value={productId} onChange={(e) => setProductId(e.target.value)}>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          Tick the batches that produce this. A batch normally inherits its products from its production unit —
          ticking or unticking one here records an exception for that batch only.
        </div>
      </div>

      {links === null && <div style={{ padding: 14, fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Loading batches…</div>}

      {links !== null && links.length === 0 && (
        <div className="farm-card" style={{ padding: 16, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          No active batches to attach this to yet.
        </div>
      )}

      {links !== null && [...byEnterprise.entries()].map(([ent, rows]) => (
        <div key={ent} className="farm-card" style={{ padding: 14, marginBottom: 10 }}>
          <div className="section-eyebrow" style={{ marginBottom: 10 }}>{enterpriseLabel(ent)}</div>
          {rows.map((l, i) => {
            const on = selected.has(l.batchId);
            return (
              <div
                key={l.batchId}
                onClick={() => {
                  const next = new Set(selected);
                  if (on) next.delete(l.batchId); else next.add(l.batchId);
                  setSelected(next);
                }}
                style={{
                  display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer',
                  padding: '9px 0',
                  borderBottom: i < rows.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                }}
              >
                <div style={{
                  width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: on ? 'var(--primary-green)' : 'transparent',
                  border: on ? 'none' : '1px solid var(--border-subtle)',
                }}>
                  {on && <Check size={12} color="#062e13" aria-hidden="true" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {l.code} — {l.name}
                  </div>
                  <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)' }}>
                    {l.unitName}
                    {/* Naming HOW the current answer was reached matters: an
                        override must not be presented as a choice the farmer
                        made deliberately, and an inherited link should say so
                        so they know editing the unit is the better fix. */}
                    {l.via === 'inherited' && ' · from the unit'}
                    {l.via === 'added' && ' · added just for this batch'}
                    {l.via === 'excluded' && ' · excluded from this batch'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10, lineHeight: 1.5 }}>{error}</div>}

      {links !== null && links.length > 0 && (
        <button onClick={save} className="btn-primary" disabled={saving} style={{ width: '100%', justifyContent: 'center', marginBottom: 20 }}>
          {saving ? 'Saving…' : 'Save which batches produce this'}
        </button>
      )}
    </div>
  );
}

/* ── Structure ───────────────────────────────────────────────────────────────
 * Links out rather than reimplementing. Production units and routines already
 * have real editors; a second copy here would drift from them, and "configure
 * the farm" is about being able to FIND the setup, not about it all living in
 * one file. */
function StructureTab({ navigate }: { navigate: (to: 'crops' | 'routines' | 'people' | 'governance') => void }) {
  const rows: { label: string; desc: string; to: 'crops' | 'routines' | 'people' | 'governance' }[] = [
    { label: 'Production units', desc: 'Houses, pens, paddocks and plots — and the products each one yields', to: 'crops' },
    { label: 'Daily routines', desc: 'The steps a worker is asked to complete on each round', to: 'routines' },
    { label: 'People & roles', desc: 'Who works here, and which batches they are assigned to', to: 'people' },
    { label: 'Permissions & approvals', desc: 'What each role may do, and what needs signing off first', to: 'governance' },
  ];
  return (
    <div>
      <div className="farm-card" style={{ overflow: 'hidden', marginBottom: 14 }}>
        {rows.map((r, i) => (
          <div
            key={r.to}
            onClick={() => navigate(r.to)}
            style={{
              padding: '13px 14px', display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer',
              borderBottom: i < rows.length - 1 ? '1px solid var(--border-subtle)' : 'none',
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--text-primary)' }}>{r.label}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 1, lineHeight: 1.45 }}>{r.desc}</div>
            </div>
            <ChevronRight size={16} color="var(--text-dim)" aria-hidden="true" />
          </div>
        ))}
      </div>
      <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 20 }}>
        These already have their own screens, so this page links to them rather than keeping a second copy of the
        same editor.
      </div>
    </div>
  );
}
