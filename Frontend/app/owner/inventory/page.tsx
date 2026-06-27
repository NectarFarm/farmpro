'use client';
import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { InventoryItem, InventoryLot } from '@/lib/types';
import { StatusChip } from '@/components/worker/StatusChip';

const fmtKES = (n: number) => `KSh ${n.toLocaleString('en-KE')}`;
const EMPTY = { itemId: '', itemName: '', unit: 'kg', category: 'FEED_FINISHED', supplier: '', quantity: '', unitCost: '' };

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [purchases, setPurchases] = useState<{ id: string; itemId: string; supplier: string; quantity: number; unitCost: number; totalCost: number; createdAt: string }[]>([]);
  const [tab, setTab] = useState<'stock'|'formulation'|'variance'|'recent'>('stock');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [mixName, setMixName] = useState('');
  const [mixRows, setMixRows] = useState<{ itemId: string; kg: string }[]>([{ itemId: '', kg: '' }]);
  const [mixing, setMixing] = useState(false);
  const [mixErr, setMixErr] = useState('');
  const [mixDone, setMixDone] = useState('');
  const [editItem, setEditItem] = useState<string | null>(null);
  const [itemEdit, setItemEdit] = useState({ name: '', unit: '', lowStockThreshold: '' });
  const [editLot, setEditLot] = useState<string | null>(null);
  const [lotEdit, setLotEdit] = useState({ qtyOnHand: '', unitCost: '' });

  const [formulas, setFormulas] = useState<{ id: string; name: string; components: { itemId: string; kg: number }[]; totalKg: number; unitCost: number }[]>([]);
  const [editFormulaId, setEditFormulaId] = useState<string | null>(null);
  const loadFormulas = () => fetch('/api/feed-mix', { credentials: 'include' }).then(r => r.ok ? r.json() : []).then(setFormulas).catch(() => {});
  const applyFormula = (f: { id: string; name: string; components: { itemId: string; kg: number }[] }) => {
    setMixName(f.name); setMixRows(f.components.map(c => ({ itemId: c.itemId, kg: String(c.kg) }))); setMixDone(''); setMixErr(''); setEditFormulaId(f.id);
  };
  const deleteFormula = (id: string) => fetch(`/api/feed-mix?id=${id}`, { method: 'DELETE', credentials: 'include' }).then(loadFormulas);
  const updateFormula = async () => {
    if (!editFormulaId) return;
    setMixing(true); setMixErr(''); setMixDone('');
    try {
      const components = mixRows.filter(r => r.itemId && Number(r.kg) > 0).map(r => ({ itemId: r.itemId, kg: Number(r.kg) }));
      const res = await fetch(`/api/feed-mix?id=${editFormulaId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: mixName, components }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Update failed');
      setMixDone(`✓ Recipe "${mixName}" updated (no stock used)`);
      setEditFormulaId(null); setMixName(''); setMixRows([{ itemId: '', kg: '' }]); await loadFormulas();
    } catch (e) { setMixErr((e as Error).message); } finally { setMixing(false); }
  };

  const reload = () => Promise.all([api.getItems(), api.getLots(), api.getPurchases()]).then(([i,l,p]) => { setItems(i); setLots(l); setPurchases(p); });
  const patchData = async (resource: string, id: string, body: Record<string, unknown>) => {
    await fetch(`/api/data/${resource}?id=${id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await reload();
  };
  const startItemEdit = (it: InventoryItem) => { setEditItem(it.id); setItemEdit({ name: it.name, unit: it.unit, lowStockThreshold: String(it.lowStockThreshold) }); };
  const saveItemEdit = async () => { if (!editItem) return; await patchData('items', editItem, { name: itemEdit.name, unit: itemEdit.unit, lowStockThreshold: Number(itemEdit.lowStockThreshold) }); setEditItem(null); };
  const startLotEdit = (l: InventoryLot) => { setEditLot(l.id); setLotEdit({ qtyOnHand: String(l.qtyOnHand), unitCost: String(l.unitCost) }); };
  const saveLotEdit = async () => { if (!editLot) return; await patchData('lots', editLot, { qtyOnHand: Number(lotEdit.qtyOnHand), unitCost: Number(lotEdit.unitCost) }); setEditLot(null); };
  useEffect(() => {
    reload(); loadFormulas();
    fetch('/api/inventory/variance', { credentials: 'include' }).then(r => r.ok ? r.json() : []).then(setVariances).catch(() => {});
  }, []);

  const ingredients = items.filter(i => i.category === 'FEED_INGREDIENT');
  const itemCost = (itemId: string) => {
    const ls = lots.filter(l => l.itemId === itemId);
    return ls.length ? ls.reduce((s, l) => s + l.unitCost, 0) / ls.length : 0;
  };
  const mixKg = mixRows.reduce((s, r) => s + (Number(r.kg) || 0), 0);
  const mixCost = mixRows.reduce((s, r) => s + (Number(r.kg) || 0) * itemCost(r.itemId), 0);

  const recordMix = async () => {
    setMixing(true); setMixErr(''); setMixDone('');
    try {
      const components = mixRows.filter(r => r.itemId && Number(r.kg) > 0).map(r => ({ itemId: r.itemId, kg: Number(r.kg) }));
      const res = await fetch('/api/feed-mix', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: mixName, components }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Mix failed'); }
      const data = await res.json();
      setMixDone(`✓ Mixed ${data.totalKg}kg of "${mixName}" at KSh ${data.unitCost}/kg`);
      setMixName(''); setMixRows([{ itemId: '', kg: '' }]); await reload(); await loadFormulas();
    } catch (e) { setMixErr((e as Error).message); } finally { setMixing(false); }
  };

  const recordPurchase = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setErr('');
    try {
      const isNew = form.itemId === '__new';
      const payload = isNew
        ? { itemId: '__new', itemName: form.itemName, unit: form.unit, category: form.category, supplier: form.supplier, quantity: form.quantity, unitCost: form.unitCost }
        : { itemId: form.itemId, supplier: form.supplier, quantity: form.quantity, unitCost: form.unitCost };
      await api.recordPurchase(payload);
      setForm(EMPTY); setShow(false); await reload();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const getStock = (itemId: string) => lots.filter(l => l.itemId === itemId).reduce((s,l) => s + l.qtyOnHand, 0);
  const isLow = (item: InventoryItem) => getStock(item.id) < item.lowStockThreshold;
  const isExpiringSoon = (lot: InventoryLot) => {
    if (!lot.expiryDate) return false;
    return (new Date(lot.expiryDate).getTime() - Date.now()) < 30 * 86400000;
  };

  // Variance computed server-side from workers' daily closing-stock counts vs on-hand.
  const [variances, setVariances] = useState<{ item: string; unit: string; expected: number; counted: number; variance: number }[]>([]);

  const tabs = [
    { key:'stock', label:'Stock & Lots' },
    { key:'formulation', label:'Feed Formulation' },
    { key:'variance', label:'Variance Flags' },
    { key:'recent', label:'Recent Stock' },
  ] as const;

  return (
    <div className="p-6 flex flex-col gap-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">📦 Inventory</h1>
        <button onClick={() => setShow(v => !v)} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm">+ Record Purchase</button>
      </div>

      {show && (
        <form onSubmit={recordPurchase} className="bg-white border border-green-300 rounded-xl p-5 flex flex-col gap-3">
          <h3 className="font-bold text-gray-800">Record a Purchase (adds stock)</h3>
          {err && <p className="text-red-600 bg-red-50 rounded-lg px-3 py-2 text-sm font-semibold">{err}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select required value={form.itemId} onChange={e => setForm({ ...form, itemId: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Select item…</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
              <option value="__new">+ New item…</option>
            </select>
            <input placeholder="Supplier" value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            {form.itemId === '__new' && (
              <>
                <input required placeholder="New item name (e.g. Maize, Dewormer)" value={form.itemName} onChange={e => setForm({ ...form, itemName: e.target.value })} className="border-2 border-green-300 rounded-lg px-3 py-2 text-sm" />
                <div className="grid grid-cols-2 gap-2">
                  <input list="purchunits" placeholder="Unit (kg, bag, bottle)" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} className="border-2 border-green-300 rounded-lg px-3 py-2 text-sm" />
                  <datalist id="purchunits"><option value="kg" /><option value="bag" /><option value="litre" /><option value="bottle" /><option value="dose" /><option value="piece" /></datalist>
                  <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="border-2 border-green-300 rounded-lg px-3 py-2 text-sm">
                    {['FEED_FINISHED','FEED_INGREDIENT','MEDICINE','VACCINE','SEED','FERTILIZER','PESTICIDE','EQUIPMENT','CONSUMABLE'].map(c => <option key={c} value={c}>{c.replace('_',' ')}</option>)}
                  </select>
                </div>
              </>
            )}
            <input type="number" min="0" placeholder="How many (e.g. 50)" required value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input type="number" min="0" placeholder="Price each (KSh)" required value={form.unitCost} onChange={e => setForm({ ...form, unitCost: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          {Number(form.quantity) > 0 && Number(form.unitCost) > 0 && (
            <p className="text-sm text-gray-600">{form.quantity} × KSh {form.unitCost} each = <span className="font-bold text-gray-900">Total KSh {(Number(form.quantity) * Number(form.unitCost)).toLocaleString()}</span></p>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Add Stock'}</button>
            <button type="button" onClick={() => setShow(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">Cancel</button>
          </div>
        </form>
      )}

      <div className="flex gap-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab === t.key ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'stock' && (
        <div className="flex flex-col gap-5">
          {items.map(item => {
            const itemLots = lots.filter(l => l.itemId === item.id && l.qtyOnHand > 0);
            const totalStock = getStock(item.id);
            return (
              <div key={item.id} className={`bg-white border rounded-xl p-5 ${isLow(item) ? 'border-amber-300' : 'border-gray-200'}`}>
                {editItem === item.id ? (
                  <div className="mb-3 flex flex-col gap-2 bg-gray-50 rounded-lg p-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input value={itemEdit.name} onChange={e => setItemEdit({ ...itemEdit, name: e.target.value })} placeholder="Name" className="border rounded-lg px-3 py-2 text-sm" />
                      <input value={itemEdit.unit} onChange={e => setItemEdit({ ...itemEdit, unit: e.target.value })} placeholder="Unit" className="border rounded-lg px-3 py-2 text-sm" />
                      <input type="number" value={itemEdit.lowStockThreshold} onChange={e => setItemEdit({ ...itemEdit, lowStockThreshold: e.target.value })} placeholder="Low-stock alert at" className="border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveItemEdit} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold">Save</button>
                      <button onClick={() => setEditItem(null)} className="px-3 py-1.5 bg-gray-200 rounded-lg text-xs font-semibold">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-gray-900">{item.name}</h3>
                        {isLow(item) && <StatusChip status="warning" size="sm" label="LOW STOCK" />}
                        <button onClick={() => startItemEdit(item)} className="text-xs text-green-600 font-semibold hover:underline">Edit</button>
                      </div>
                      <p className="text-xs text-gray-400">{item.category} · Low-stock alert at {item.lowStockThreshold} {item.unit}</p>
                    </div>
                    <span className="text-2xl font-bold text-gray-900">{totalStock} <span className="text-base text-gray-500">{item.unit}</span></span>
                  </div>
                )}
                {itemLots.length > 0 && (
                  <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-xs text-gray-600 min-w-[440px]">
                    <thead className="text-gray-400 font-semibold border-b border-gray-100">
                      <tr>
                        <th className="text-left px-2 pb-2">Lot No.</th>
                        <th className="text-right px-3 pb-2">Qty</th>
                        <th className="text-right px-3 pb-2">Unit Cost</th>
                        <th className="text-left px-3 pb-2 whitespace-nowrap">Received</th>
                        <th className="text-left px-3 pb-2 whitespace-nowrap">Expiry</th>
                        <th className="text-center px-2 pb-2">WD</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {itemLots.map(lot => (
                        <tr key={lot.id}>
                          <td className="py-2 px-2 font-mono">{lot.lotNo}</td>
                          <td className="py-2 px-3 text-right font-bold text-gray-900 whitespace-nowrap">
                            {editLot === lot.id
                              ? <input type="number" value={lotEdit.qtyOnHand} onChange={e => setLotEdit({ ...lotEdit, qtyOnHand: e.target.value })} className="w-20 border rounded px-2 py-1 text-right" />
                              : <>{lot.qtyOnHand} {lot.unit}</>}
                          </td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            {editLot === lot.id
                              ? <input type="number" value={lotEdit.unitCost} onChange={e => setLotEdit({ ...lotEdit, unitCost: e.target.value })} className="w-20 border rounded px-2 py-1 text-right" />
                              : <>KSh {lot.unitCost}</>}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">{new Date(lot.receivedDate).toLocaleDateString('en-KE')}</td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            {lot.expiryDate
                              ? <span className={isExpiringSoon(lot) ? 'text-amber-600 font-semibold' : ''}>{new Date(lot.expiryDate).toLocaleDateString('en-KE')}{isExpiringSoon(lot) ? ' ⚠' : ''}</span>
                              : '—'
                            }
                          </td>
                          <td className="py-2 px-2 text-center whitespace-nowrap">
                            {editLot === lot.id
                              ? <span className="flex gap-1 justify-center"><button onClick={saveLotEdit} className="text-green-600 font-bold">✓</button><button onClick={() => setEditLot(null)} className="text-gray-400">✕</button></span>
                              : <button onClick={() => startLotEdit(lot)} className="text-gray-400 hover:text-green-600" title="Fix qty/cost">✎</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
                {itemLots.length === 0 && <p className="text-xs text-gray-400">No lots with stock. All lots depleted (FIFO).</p>}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'formulation' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-bold text-gray-800 mb-3">Feed Formulation — Recipe Builder</h2>
          <p className="text-gray-500 text-sm mb-4">Define feed recipes from ingredients. Each mix produces a finished-feed lot with rolled-up unit cost.</p>

          {formulas.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-bold text-gray-500 mb-2">Saved recipes — tap “Use / edit” to mix another batch or tweak the recipe</p>
              <div className="flex flex-col gap-2">
                {formulas.map(f => (
                  <div key={f.id} className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 text-sm">{f.name} <span className="text-xs text-gray-400">· KSh {f.unitCost}/kg · {f.totalKg}kg</span></p>
                      <p className="text-xs text-gray-500 truncate">{f.components.map(c => `${items.find(i => i.id === c.itemId)?.name ?? '?'} ${c.kg}kg`).join(' + ')}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button onClick={() => applyFormula(f)} className="text-xs text-green-600 font-semibold hover:underline">Use / edit</button>
                      <button onClick={() => deleteFormula(f.id)} className="text-xs text-gray-400 hover:text-red-600">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-3">
            {mixErr && <p className="text-red-600 bg-red-50 rounded-lg px-3 py-2 text-sm font-semibold">{mixErr}</p>}
            {mixDone && <p className="text-green-700 bg-green-50 rounded-lg px-3 py-2 text-sm font-semibold">{mixDone}</p>}
            <input value={mixName} onChange={e => setMixName(e.target.value)} placeholder="Finished feed name (e.g. Custom Layer Mash)" className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base" />
            <div className="flex flex-col gap-2">
              {mixRows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <select value={row.itemId} onChange={e => setMixRows(rs => rs.map((r, idx) => idx === i ? { ...r, itemId: e.target.value } : r))}
                    className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm">
                    <option value="">Ingredient…</option>
                    {ingredients.map(ing => <option key={ing.id} value={ing.id}>{ing.name} (KSh {itemCost(ing.id).toFixed(0)}/kg)</option>)}
                  </select>
                  <input value={row.kg} onChange={e => setMixRows(rs => rs.map((r, idx) => idx === i ? { ...r, kg: e.target.value } : r))}
                    type="number" min="0" placeholder="kg" className="w-24 border border-gray-300 rounded-xl px-3 py-2 text-sm text-center" />
                  {mixRows.length > 1 && (
                    <button type="button" onClick={() => setMixRows(rs => rs.filter((_, idx) => idx !== i))} className="px-2 text-gray-400 hover:text-red-600">✕</button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setMixRows(rs => [...rs, { itemId: '', kg: '' }])} className="text-sm text-green-600 font-semibold self-start">+ Add ingredient</button>
            </div>
            <div className="flex items-center justify-between bg-green-50 rounded-xl px-4 py-2">
              <span className="text-sm font-semibold text-green-700">Rolled-up cost:</span>
              <span className="text-lg font-bold text-green-800">{mixKg > 0 ? `KSh ${(mixCost / mixKg).toFixed(2)} / kg · ${mixKg}kg total` : '—'}</span>
            </div>
            {editFormulaId && <p className="text-xs text-indigo-600 -mb-1">Editing the saved recipe. “Update recipe” saves changes without using stock; “Record Mix” actually mixes &amp; consumes stock.</p>}
            <div className="flex flex-col sm:flex-row gap-2">
              {editFormulaId && (
                <button onClick={updateFormula} disabled={mixing || !mixName || mixKg <= 0} className="flex-1 bg-indigo-600 text-white rounded-xl py-3 font-bold disabled:opacity-50">
                  {mixing ? 'Saving…' : 'Update recipe'}
                </button>
              )}
              <button onClick={recordMix} disabled={mixing || !mixName || mixKg <= 0} className="flex-1 bg-green-600 text-white rounded-xl py-3 font-bold disabled:opacity-50">
                {mixing ? 'Mixing…' : 'Record Mix Event'}
              </button>
              {editFormulaId && (
                <button type="button" onClick={() => { setEditFormulaId(null); setMixName(''); setMixRows([{ itemId: '', kg: '' }]); }} className="px-4 bg-gray-100 text-gray-700 rounded-xl py-3 font-semibold text-sm">New</button>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'variance' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-bold text-gray-800 mb-3">Closing-Stock Variance Flags (FR-M4-4)</h2>
          <p className="text-gray-500 text-sm mb-4">Discrepancies between counted stock and logged consumption. Review before correcting.</p>
          {variances.length === 0
            ? (
              <div className="text-center py-8 bg-gray-50 border border-dashed border-gray-200 rounded-xl">
                <p className="text-gray-400 text-sm">No variance flags 🎉</p>
                <p className="text-gray-400 text-xs mt-1">Flags appear when a worker&apos;s daily closing-stock count differs from what feeding logs say should remain.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {variances.map(v => (
                  <div key={v.item} className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <div>
                      <p className="font-semibold text-gray-900">{v.item}</p>
                      <p className="text-xs text-gray-500">Expected {v.expected} {v.unit} · Counted {v.counted} {v.unit}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-amber-700 font-bold">{v.variance > 0 ? '+' : ''}{v.variance} {v.unit}</p>
                      <p className="text-xs text-amber-600">▲ Variance flag (BR-11)</p>
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </div>
      )}

      {tab === 'recent' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-bold text-gray-800 mb-3">Recent Stock Additions</h2>
          <p className="text-gray-500 text-sm mb-4">Feed and supplies you&apos;ve recently added to inventory.</p>
          {purchases.length === 0
            ? (
              <div className="text-center py-8 bg-gray-50 border border-dashed border-gray-200 rounded-xl">
                <p className="text-gray-400 text-sm">No purchases recorded yet.</p>
                <p className="text-gray-400 text-xs mt-1">Use the &quot;+ Record Purchase&quot; button to add stock.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-gray-500 text-xs font-semibold border-b">
                    <tr>
                      <th className="text-left pb-2">Date</th>
                      <th className="text-left pb-2">Item</th>
                      <th className="text-left pb-2">Supplier</th>
                      <th className="text-right pb-2">Qty</th>
                      <th className="text-right pb-2">Unit Cost</th>
                      <th className="text-right pb-2">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[...purchases].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(p => {
                      const item = items.find(i => i.id === p.itemId);
                      return (
                        <tr key={p.id} className="hover:bg-gray-50">
                          <td className="py-2 text-gray-400">{new Date(p.createdAt).toLocaleDateString('en-KE')}</td>
                          <td className="py-2 font-semibold text-gray-900">{item?.name ?? p.itemId}</td>
                          <td className="py-2 text-gray-600">{p.supplier}</td>
                          <td className="py-2 text-right">{p.quantity}</td>
                          <td className="py-2 text-right text-gray-600">{fmtKES(p.unitCost)}</td>
                          <td className="py-2 text-right font-bold text-red-700">{fmtKES(p.totalCost)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>
      )}
    </div>
  );
}
