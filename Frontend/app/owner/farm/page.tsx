'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { ProductionUnit, Batch } from '@/lib/types';
import { StatusChip } from '@/components/worker/StatusChip';
import { cn } from '@/lib/utils';

const speciesIcon = (s?: string) => {
  const t = (s ?? '').toLowerCase();
  if (/pig|pork|sow|boar|hog/.test(t)) return '🐖';
  if (/fish|tilapia|catfish|fingerling/.test(t)) return '🐟';
  if (/chick|poultry|hen|layer|broiler|bird|duck/.test(t)) return '🐔';
  if (/goat|sheep/.test(t)) return '🐐';
  if (/cattle|cow|dairy|calf/.test(t)) return '🐄';
  if (/maize|crop|bean|cereal|grain|veg|kale|tomato/.test(t)) return '🌽';
  return '🌿';
};
// Unit icon: prefer the batch species in it, else infer from the unit type.
const unitIcon = (type: string, species?: string) => {
  if (species) return speciesIcon(species);
  return ({ POND: '🐟', TANK: '🐟', PEN: '🐖', CAGE: '🐔', HOUSE: '🐔', PLOT: '🌽' } as Record<string, string>)[type] ?? '🏠';
};

const unitStatusVariant = (s: string) => {
  if (s === 'ACTIVE') return 'ok'; if (s === 'QUARANTINE') return 'critical';
  if (s === 'CLEANING') return 'warning'; return 'offline';
};

const EMPTY_UNIT = { name: '', type: 'HOUSE', capacity: '' };
const EMPTY_BATCH = { name: '', species: '', enterprise: '', unitId: '', qty: '', ageAtAcquire: '', cost: '' };
const ENTERPRISES = [
  { v: '', l: 'Auto-detect from species' },
  { v: 'layers', l: 'Layers (eggs + manure)' },
  { v: 'broilers', l: 'Broilers (meat + manure)' },
  { v: 'pig_fatten', l: 'Pig fattening (pork + manure)' },
  { v: 'pig_breed', l: 'Pig breeding (piglets + manure)' },
  { v: 'tilapia', l: 'Tilapia (fish)' },
  { v: 'catfish', l: 'Catfish (fish)' },
  { v: 'maize', l: 'Maize (grain)' },
];

export default function FarmPage() {
  const [units, setUnits] = useState<ProductionUnit[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [filter, setFilter] = useState<'all'|'active'|'closed'>('active');
  const [show, setShow] = useState<'' | 'unit' | 'batch'>('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [unitForm, setUnitForm] = useState(EMPTY_UNIT);
  const [batchForm, setBatchForm] = useState(EMPTY_BATCH);

  const [dueMap, setDueMap] = useState<Record<string, { due: boolean; nextStage: string | null; daysRemaining: number; overdueDays: number }>>({});
  const reload = () => {
    Promise.all([api.getUnits(), api.getBatches()]).then(([u,b]) => { setUnits(u); setBatches(b); });
    fetch('/api/lifecycle-due', { credentials: 'include' }).then(r => r.ok ? r.json() : []).then((rows: { batchId: string; due: typeof dueMap[string] }[]) => {
      setDueMap(Object.fromEntries(rows.map(r => [r.batchId, r.due])));
    }).catch(() => {});
  };
  useEffect(() => { reload(); }, []);

  const create = async (resource: 'units' | 'batches', payload: object, reset: () => void) => {
    setSaving(true); setErr('');
    try {
      const res = await fetch(`/api/data/${resource}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(res.status === 400 ? 'Please fill the required fields' : res.status === 403 ? 'Not permitted' : 'Save failed');
      reset(); setShow(''); await reload();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const filtered = batches.filter(b => filter === 'all' || (filter === 'active' ? b.status === 'ACTIVE' : b.status === 'CLOSED'));
  const unitBatches = (u: ProductionUnit) => batches.filter(b => b.unitId === u.id && b.status === 'ACTIVE');
  const unitPop = (u: ProductionUnit) => unitBatches(u).reduce((s, b) => s + b.currentQty, 0);
  const density = (u: ProductionUnit) => u.capacity ? (unitPop(u) / u.capacity * 100).toFixed(0) : '—';

  return (
    <div className="p-6 flex flex-col gap-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-gray-900">🐄 Farm</h1>
        <div className="flex gap-2">
          <Link href="/owner/farm/stages" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">🌱 Lifecycle stages</Link>
          <button onClick={() => setShow(show === 'unit' ? '' : 'unit')} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">+ Add Unit</button>
          <button onClick={() => setShow(show === 'batch' ? '' : 'batch')} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm">+ Add Batch</button>
        </div>
      </div>

      {err && <p className="text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm font-semibold">{err}</p>}

      {show === 'unit' && (
        <form onSubmit={e => { e.preventDefault(); create('units', unitForm, () => setUnitForm(EMPTY_UNIT)); }}
          className="bg-white border border-green-300 rounded-xl p-5 flex flex-col gap-3">
          <h3 className="font-bold text-gray-800">Add a production unit</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input required placeholder="Name (e.g. Cage A1)" value={unitForm.name} onChange={e => setUnitForm({ ...unitForm, name: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <select value={unitForm.type} onChange={e => setUnitForm({ ...unitForm, type: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm">
              {['HOUSE','CAGE','PEN','POND','TANK','PLOT'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="number" min="0" required placeholder="Capacity" value={unitForm.capacity} onChange={e => setUnitForm({ ...unitForm, capacity: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2"><button type="submit" disabled={saving} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Add Unit'}</button><button type="button" onClick={() => setShow('')} className="px-4 py-2 bg-gray-100 rounded-lg text-sm font-semibold">Cancel</button></div>
        </form>
      )}

      {show === 'batch' && (
        <form onSubmit={e => { e.preventDefault(); create('batches', batchForm, () => setBatchForm(EMPTY_BATCH)); }}
          className="bg-white border border-green-300 rounded-xl p-5 flex flex-col gap-3">
          <h3 className="font-bold text-gray-800">Add a batch</h3>
          {units.length === 0 && <p className="text-amber-600 text-sm">Add a production unit first — a batch must live in a unit.</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input required placeholder="Batch name (e.g. Layer #003)" value={batchForm.name} onChange={e => setBatchForm({ ...batchForm, name: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input placeholder="Species (e.g. chicken)" value={batchForm.species} onChange={e => setBatchForm({ ...batchForm, species: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <select value={batchForm.enterprise} onChange={e => setBatchForm({ ...batchForm, enterprise: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm md:col-span-2" title="Sets the products this batch yields">
              {ENTERPRISES.map(en => <option key={en.v} value={en.v}>Products: {en.l}</option>)}
            </select>
            <select required value={batchForm.unitId} onChange={e => setBatchForm({ ...batchForm, unitId: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Which unit?</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <input type="number" min="0" required placeholder="Quantity" value={batchForm.qty} onChange={e => setBatchForm({ ...batchForm, qty: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input type="number" min="0" placeholder="Age at acquire (days)" value={batchForm.ageAtAcquire} onChange={e => setBatchForm({ ...batchForm, ageAtAcquire: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input type="number" min="0" placeholder="Total acquisition cost (KSh)" value={batchForm.cost} onChange={e => setBatchForm({ ...batchForm, cost: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2"><button type="submit" disabled={saving || units.length === 0} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Add Batch'}</button><button type="button" onClick={() => setShow('')} className="px-4 py-2 bg-gray-100 rounded-lg text-sm font-semibold">Cancel</button></div>
        </form>
      )}

      {/* Units heatmap */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">Production Units</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {units.map(u => {
            const ub = unitBatches(u);
            const dens = parseInt(density(u));
            const heatColor = dens > 90 ? 'bg-red-100 border-red-300' : dens > 70 ? 'bg-amber-100 border-amber-300' : dens > 0 ? 'bg-green-100 border-green-300' : 'bg-gray-100 border-gray-200';
            return (
              <div key={u.id} className={cn('rounded-xl border p-4', heatColor)}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{unitIcon(u.type, ub[0]?.species ?? u.species)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 text-sm truncate">{u.name}</p>
                    <p className="text-xs text-gray-500">{u.code} · {u.type}</p>
                  </div>
                  <StatusChip status={unitStatusVariant(u.status)} size="sm" label={u.status} />
                </div>
                <div className="flex justify-between text-xs text-gray-600 mb-2">
                  <span>{unitPop(u)} / {u.capacity}</span>
                  <span>{dens > 0 ? `${dens}% full` : 'Empty'}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div className={cn('h-1.5 rounded-full', dens > 90 ? 'bg-red-500' : dens > 70 ? 'bg-amber-500' : 'bg-green-500')} style={{ width: `${Math.min(100, dens)}%` }} />
                </div>
                {ub.length > 0
                  ? <p className="text-xs text-gray-500 mt-1.5 truncate">{ub.length} batch{ub.length > 1 ? 'es' : ''} · {ub.map(b => b.name).join(', ')}</p>
                  : <p className="text-xs text-gray-400 mt-1.5">No batch yet</p>}
              </div>
            );
          })}
        </div>
      </section>

      {/* Batch table */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-700">Batches</h2>
          <div className="flex gap-1">
            {(['active','closed','all'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold capitalize', filter === f ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
                {f}
              </button>
            ))}
          </div>
        </div>
        {filtered.length === 0
          ? (
            <div className="text-center py-10 bg-white rounded-xl border border-dashed border-gray-200">
              <p className="text-gray-400">No batches. <button onClick={() => setShow('batch')} className="text-green-600 underline font-semibold">Add your first batch →</button></p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs font-semibold">
                  <tr>
                    <th className="px-4 py-3 text-left">Batch</th>
                    <th className="px-3 py-3 text-left hidden md:table-cell">Unit</th>
                    <th className="px-3 py-3 text-right">Age</th>
                    <th className="px-3 py-3 text-right">Qty</th>
                    <th className="px-3 py-3 text-right hidden lg:table-cell">Mortality</th>
                    <th className="px-3 py-3 text-center">Stage</th>
                    <th className="px-3 py-3 text-center">Status</th>
                    <th className="px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map(b => {
                    const u = units.find(u => u.id === b.unitId);
                    const days = Math.floor((Date.now() - new Date(b.acquiredDate).getTime()) / 86400000);
                    const mortPct = (((b.initialQty - b.currentQty) / b.initialQty) * 100).toFixed(1);
                    return (
                      <tr key={b.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => window.location.href=`/owner/farm/${b.id}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span>{speciesIcon(b.species)}</span>
                            <div><p className="font-semibold text-gray-900">{b.name}</p><p className="text-xs text-gray-400">{b.species}</p></div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-gray-600 hidden md:table-cell">{u?.name ?? '—'}</td>
                        <td className="px-3 py-3 text-right font-mono text-gray-700">D{days}</td>
                        <td className="px-3 py-3 text-right font-bold text-gray-900">{b.currentQty}</td>
                        <td className="px-3 py-3 text-right hidden lg:table-cell">
                          <span className={parseFloat(mortPct) > 5 ? 'text-red-600 font-bold' : 'text-gray-600'}>{mortPct}%</span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-semibold">{b.stage}</span>
                          {dueMap[b.id]?.due && dueMap[b.id]?.nextStage && (
                            <span className="block mt-0.5 text-[10px] font-semibold text-amber-600">→ due: {dueMap[b.id].nextStage}{dueMap[b.id].overdueDays > 0 ? ` (${dueMap[b.id].overdueDays}d)` : ''}</span>
                          )}
                          {dueMap[b.id] && !dueMap[b.id].due && dueMap[b.id].nextStage && (
                            <span className="block mt-0.5 text-[10px] text-gray-400">→ {dueMap[b.id].nextStage} in {dueMap[b.id].daysRemaining}d</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center"><StatusChip status={b.status === 'ACTIVE' ? 'ok' : 'offline'} size="sm" label={b.status} /></td>
                        <td className="px-3 py-3 text-center"><Link href={`/owner/farm/${b.id}`} className="text-green-600 font-semibold text-xs hover:underline">View →</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </section>
    </div>
  );
}
