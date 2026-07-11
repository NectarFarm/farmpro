'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { ProductionUnit, Batch } from '@/lib/types';
import { StatusChip } from '@/components/worker/StatusChip';
import { cn } from '@/lib/utils';
import { ENTERPRISE_OPTIONS } from '@/lib/species';
import {
  Tractor, Sprout, BarChart3, Fish, Bird, Rabbit, Wheat, Milk, Bug, Leaf, House,
  PawPrint, Layers, type LucideIcon,
} from 'lucide-react';

const SPECIES_ICON_RULES: { test: RegExp; Icon: LucideIcon }[] = [
  { test: /pig|pork|sow|boar|hog|piglet/, Icon: PawPrint },
  { test: /fish|tilapia|catfish|fingerling/, Icon: Fish },
  { test: /chick|poultry|hen|layer|broiler|bird|duck|turkey|quail/, Icon: Bird },
  { test: /goat|kid/, Icon: PawPrint },
  { test: /cattle|cow|dairy|calf|bull|heifer/, Icon: Milk },
  { test: /rabbit|bunny/, Icon: Rabbit },
  { test: /bee|honey|hive/, Icon: Bug },
  { test: /maize|crop|bean|cereal|grain|veg|kale|tomato/, Icon: Wheat },
];
const speciesIcon = (s?: string): LucideIcon => {
  const t = (s ?? '').toLowerCase();
  return SPECIES_ICON_RULES.find(r => r.test.test(t))?.Icon ?? Leaf;
};
// Unit icon: prefer the batch species in it, else infer from the unit type.
const UNIT_TYPE_ICON: Record<string, LucideIcon> = { POND: Fish, TANK: Fish, PEN: PawPrint, CAGE: Bird, HOUSE: Bird, PLOT: Wheat, HIVE: Bug };
const unitIcon = (type: string, species?: string): LucideIcon => {
  if (species) return speciesIcon(species);
  return UNIT_TYPE_ICON[type] ?? House;
};
const unitStatusVariant = (s: string) => {
  if (s === 'ACTIVE') return 'ok'; if (s === 'QUARANTINE') return 'critical';
  if (s === 'CLEANING') return 'warning'; return 'offline';
};

const EMPTY_UNIT = { name: '', type: 'HOUSE', capacity: '' };
const EMPTY_BATCH = { name: '', species: '', enterprise: '', unitId: '', qty: '', ageAtAcquire: '', cost: '', acquiredDate: '' };

export default function FarmPage() {
  const { t } = useTranslation();
  const [units, setUnits] = useState<ProductionUnit[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [filter, setFilter] = useState<'all'|'active'|'closed'>('active');
  const [show, setShow] = useState<'' | 'unit' | 'batch'>('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [unitForm, setUnitForm] = useState(EMPTY_UNIT);
  const [batchForm, setBatchForm] = useState(EMPTY_BATCH);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; body: string; danger?: boolean; onConfirm: () => void } | null>(null);

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
      if (!res.ok) throw new Error(res.status === 400 ? t('errorRequired') : res.status === 403 ? t('errorForbidden') : t('saveFailed'));
      reset(); setShow(''); await reload();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const doDeleteUnit = async (id: string) => {
    try {
      const res = await fetch(`/api/data/units?id=${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      reload();
    } catch (e) { setErr((e as Error).message); }
  };
  const deleteUnit = (id: string, name: string) => {
    setConfirmDialog({
      title: t('deleteUnit'),
      body: t('confirmDeleteUnit', { name }),
      danger: true,
      onConfirm: () => { setConfirmDialog(null); doDeleteUnit(id); },
    });
  };

  const [search, setSearch] = useState('');
  const filtered = batches.filter(b => {
    if (filter === 'active' && b.status !== 'ACTIVE') return false;
    if (filter === 'closed' && b.status !== 'CLOSED') return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return b.name.toLowerCase().includes(q) || b.species.toLowerCase().includes(q) || b.stage.toLowerCase().includes(q);
    }
    return true;
  });
  const unitBatches = (u: ProductionUnit) => batches.filter(b => b.unitId === u.id && b.status === 'ACTIVE');
  const unitPop = (u: ProductionUnit) => unitBatches(u).reduce((s, b) => s + b.currentQty, 0);
  const density = (u: ProductionUnit) => u.capacity ? (unitPop(u) / u.capacity * 100).toFixed(0) : '—';

  return (
    <div className="p-6 flex flex-col gap-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-green-50 flex items-center justify-center">
            <Tractor className="w-6 h-6 text-green-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('farm')}</h1>
            <p className="text-gray-500 text-sm">Production units and batches — capacity, growth stage, and status.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/owner/farm/stages" className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm"><Sprout className="w-4 h-4" /> {t('lifecycleStages')}</Link>
          <Link href="/owner/farm/compare" className="flex items-center gap-1.5 px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg font-semibold text-sm hover:bg-indigo-200"><BarChart3 className="w-4 h-4" /> {t('compareBatches')}</Link>
          <button onClick={() => setShow(show === 'unit' ? '' : 'unit')} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">+ {t('addUnit')}</button>
          <button onClick={() => setShow(show === 'batch' ? '' : 'batch')} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm">+ {t('addBatch')}</button>
          <Link href="/owner/farm/split-delivery" className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">+ Split delivery</Link>
        </div>
      </div>

      {err && <p className="text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm font-semibold">{err}</p>}

      {show === 'unit' && (
        <form onSubmit={e => { e.preventDefault(); create('units', unitForm, () => setUnitForm(EMPTY_UNIT)); }}
          className="bg-white border border-green-300 rounded-xl p-5 flex flex-col gap-3">
          <h3 className="font-bold text-gray-800">{t('addProductionUnit')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input required placeholder={t('unitNamePlaceholderForm')} value={unitForm.name} onChange={e => setUnitForm({ ...unitForm, name: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <select value={unitForm.type} onChange={e => setUnitForm({ ...unitForm, type: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm">
              {['HOUSE','CAGE','PEN','POND','TANK','PLOT'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="number" min="0" required placeholder={t('capacityPlaceholderForm')} value={unitForm.capacity} onChange={e => setUnitForm({ ...unitForm, capacity: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2"><button type="submit" disabled={saving} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">{saving ? t('saving') : t('addUnit')}</button><button type="button" onClick={() => setShow('')} className="px-4 py-2 bg-gray-100 rounded-lg text-sm font-semibold">{t('cancel')}</button></div>
        </form>
      )}

      {show === 'batch' && (
        <form onSubmit={e => { e.preventDefault(); create('batches', batchForm, () => setBatchForm(EMPTY_BATCH)); }}
          className="bg-white border border-green-300 rounded-xl p-5 flex flex-col gap-4">
          <h3 className="font-bold text-gray-800 text-lg">{t('addBatch')}</h3>
          {units.length === 0 && <p className="text-amber-600 text-sm">{t('noUnits')}</p>}

          {/* Species picker — visual icon grid */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">{t('whatAreYouAdding')} <span className="text-gray-400 font-normal">{t('tapToSelectEnterprise')}</span></p>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {ENTERPRISE_OPTIONS.map(opt => {
                const selected = batchForm.enterprise === opt.key ||
                  (!batchForm.enterprise && opt.key === 'layers' && !batchForm.species);
                const OptIcon = opt.Icon;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      setBatchForm({
                        ...batchForm,
                        enterprise: batchForm.enterprise === opt.key ? '' : opt.key,
                        species: batchForm.enterprise === opt.key ? '' : opt.desc.split(' ')[0].toLowerCase(),
                      });
                    }}
                    className={`flex flex-col items-center gap-1 rounded-xl border-2 p-3 transition-all ${
                      selected
                        ? 'bg-green-50 border-green-500 shadow-sm'
                        : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <OptIcon className={`w-6 h-6 ${selected ? 'text-green-700' : 'text-gray-500'}`} />
                    <span className={`text-xs font-semibold ${selected ? 'text-green-700' : 'text-gray-600'}`}>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick fields — only the essentials */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input required placeholder={t('batchNamePlaceholderForm')} value={batchForm.name} onChange={e => setBatchForm({ ...batchForm, name: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <select required value={batchForm.unitId} onChange={e => setBatchForm({ ...batchForm, unitId: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">{t('whichUnit')}</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name} {u.species ? `(${u.species})` : ''}</option>)}
            </select>
            <input type="number" min="0" required placeholder={t('qtyPlaceholderForm')} value={batchForm.qty} onChange={e => setBatchForm({ ...batchForm, qty: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input type="date" placeholder="Date acquired" value={batchForm.acquiredDate || new Date().toISOString().slice(0, 10)} onChange={e => setBatchForm({ ...batchForm, acquiredDate: e.target.value })}
              className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>

          {/* Advanced fields (collapsible) */}
          <details className="text-sm">
            <summary className="cursor-pointer text-gray-500 font-semibold hover:text-gray-700">▼ {t('advanced')} ({t('ageCostBreed')})</summary>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <input placeholder={t('speciesAutoPlaceholder')} value={batchForm.species} onChange={e => setBatchForm({ ...batchForm, species: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <input type="number" min="0" placeholder={t('ageAtAcquirePlaceholder')} value={batchForm.ageAtAcquire} onChange={e => setBatchForm({ ...batchForm, ageAtAcquire: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <input type="number" min="0" placeholder={t('totalCostPlaceholder')} value={batchForm.cost} onChange={e => setBatchForm({ ...batchForm, cost: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </details>

          <div className="flex gap-2">
            <button type="submit" disabled={saving || units.length === 0} className="px-6 py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-50">{saving ? t('saving') : t('addBatch')}</button>
            <button type="button" onClick={() => setShow('')} className="px-4 py-2 bg-gray-100 rounded-lg text-sm font-semibold">{t('cancel')}</button>
          </div>
        </form>
      )}

      {/* Units heatmap */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">{t('productionUnits')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {units.map(u => {
            const ub = unitBatches(u);
            const dens = parseInt(density(u));
            const heatColor = dens > 90 ? 'bg-red-100 border-red-300' : dens > 70 ? 'bg-amber-100 border-amber-300' : dens > 0 ? 'bg-green-100 border-green-300' : 'bg-gray-100 border-gray-200';
            const UnitIcon = unitIcon(u.type, ub[0]?.species ?? u.species);
            return (
              <div key={u.id} className={cn('rounded-xl border p-4', heatColor)}>
                <div className="flex items-center gap-2 mb-2">
                  <UnitIcon className="w-5 h-5 text-gray-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 text-sm truncate">{u.name}</p>
                    <p className="text-xs text-gray-500">{u.code} · {u.type}</p>
                  </div>
                  <StatusChip status={unitStatusVariant(u.status)} size="sm" label={u.status} />
                </div>
                <div className="flex justify-between text-xs text-gray-600 mb-2">
                  <span>{unitPop(u)} / {u.capacity}</span>
                  <span>{dens > 0 ? `${dens}% ${t('full')}` : t('empty')}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div className={cn('h-1.5 rounded-full', dens > 90 ? 'bg-red-500' : dens > 70 ? 'bg-amber-500' : 'bg-green-500')} style={{ width: `${Math.min(100, dens)}%` }} />
                </div>                {ub.length > 0
                  ? <p className="text-xs text-gray-500 mt-1.5 truncate">{t('batchCountMeta', { count: ub.length, names: ub.map(b => b.name).join(', ') })}</p>
                  : <p className="text-xs text-gray-400 mt-1.5">{t('noBatchYet')}</p>}
              {(ub.length === 0 && (u.currentQty ?? 0) === 0) && (
                <button
                  onClick={() => deleteUnit(u.id, u.name)}
                  className="text-xs text-red-500 hover:text-red-700 mt-1.5"
                >
                  {t('deleteUnit')}
                </button>
              )}
            </div>
          );
          })
        }
      </div>
      </section>

      {/* Batch table */}
      <section>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-base font-semibold text-gray-700">{t('batches')}</h2>
          <div className="flex items-center gap-2">
            <input
              type="search"
              placeholder={t('searchBatches')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border-2 border-gray-300 rounded-lg px-3 py-1.5 text-sm w-48"
            />
            {(['active','closed','all'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold capitalize', filter === f ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
                {f === 'all' ? t('all') : f === 'active' ? t('active') : t('completed')}
              </button>
            ))}
          </div>
        </div>
        {filtered.length === 0
          ? (
            <div className="text-center py-10 bg-white rounded-xl border border-dashed border-gray-200">
              <p className="text-gray-400">{t('noBatches')} <button onClick={() => setShow('batch')} className="text-green-600 underline font-semibold">{t('addFirstBatch')} →</button></p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs font-semibold">
                  <tr>
                    <th className="px-4 py-3 text-left">{t('batch')}</th>
                    <th className="px-3 py-3 text-left hidden md:table-cell">{t('unit')}</th>
                    <th className="px-3 py-3 text-right">{t('age')}</th>
                    <th className="px-3 py-3 text-right">{t('qty')}</th>
                    <th className="px-3 py-3 text-right hidden lg:table-cell">{t('mortalityRate')}</th>
                    <th className="px-3 py-3 text-center">{t('stage')}</th>
                    <th className="px-3 py-3 text-center">{t('status')}</th>
                    <th className="px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map(b => {
                    const u = units.find(u => u.id === b.unitId);
                    const days = Math.floor((Date.now() - new Date(b.acquiredDate).getTime()) / 86400000);
                    const mortPct = (((b.initialQty - b.currentQty) / b.initialQty) * 100).toFixed(1);
                    const BIcon = speciesIcon(b.species);
                    return (
                      <tr key={b.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => window.location.href=`/owner/farm/${b.id}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <BIcon className="w-4 h-4 text-gray-500 shrink-0" />
                            <div>
                              <p className="font-semibold text-gray-900 flex items-center gap-1">
                                {b.name}
                                {b.deliveryGroupId && <Layers className="w-3 h-3 text-gray-400" aria-label="Part of a split delivery" />}
                              </p>
                              <p className="text-xs text-gray-400">{b.species}</p>
                            </div>
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
                            <span className="block mt-0.5 text-[10px] font-semibold text-amber-600">{t('nextStageDue', { stage: dueMap[b.id].nextStage ?? '' })}{dueMap[b.id].overdueDays > 0 ? ` (${dueMap[b.id].overdueDays}d)` : ''}</span>
                          )}
                          {dueMap[b.id] && !dueMap[b.id].due && dueMap[b.id].nextStage && (
                            <span className="block mt-0.5 text-[10px] text-gray-400">{t('nextStageIn', { stage: dueMap[b.id].nextStage ?? '', days: dueMap[b.id].daysRemaining })}</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center"><StatusChip status={b.status === 'ACTIVE' ? 'ok' : 'offline'} size="sm" label={b.status} /></td>
                        <td className="px-3 py-3 text-center"><Link href={`/owner/farm/${b.id}`} className="text-green-600 font-semibold text-xs hover:underline">{t('view')} →</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </section>

      {/* Generic styled confirm dialog — replaces window.confirm for delete-unit */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDialog(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm mx-4 p-5 flex flex-col gap-3 shadow-2xl">
            <h3 className={`font-bold ${confirmDialog.danger ? 'text-red-700' : 'text-gray-900'}`}>{confirmDialog.title}</h3>
            <p className="text-sm text-gray-600">{confirmDialog.body}</p>
            <div className="flex gap-2 mt-2">
              <button onClick={confirmDialog.onConfirm}
                className={`flex-1 px-4 py-2 rounded-lg font-semibold text-sm text-white ${confirmDialog.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}>
                {t('confirm')}
              </button>
              <button onClick={() => setConfirmDialog(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
