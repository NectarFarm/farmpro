'use client';
import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { InventoryItem, InventoryLot, Purchase } from '@/lib/types';
import { StatusChip } from '@/components/worker/StatusChip';
import { Boxes, Check, X, Pencil, AlertTriangle, PartyPopper } from 'lucide-react';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { TableToolbar } from '@/components/TableToolbar';
import { Pager } from '@/components/Pager';
import { SeeMoreButton } from '@/components/SeeMoreButton';
import { useTableFilter } from '@/hooks/useTableFilter';
import { useCappedList } from '@/hooks/useCappedList';

const fmtKES = (n: number) => `KSh ${n.toLocaleString('en-KE')}`;
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY = {
  itemId: '', itemName: '', unit: 'kg', category: 'FEED_FINISHED', supplier: '', quantity: '', unitCost: '',
  receivedAt: today(), paidLater: false, paymentMethod: 'cash', amountPaid: '',
};

export default function InventoryPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [amountOwed, setAmountOwed] = useState<{ amountOwed: number; count: number } | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [tab, setTab] = useState<'stock'|'formulation'|'process'|'variance'|'recent'>('stock');
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
  const [processForm, setProcessForm] = useState({ inputItemId: '', inputQty: '', outputItemId: '', outputItemName: '', outputUnit: 'kg', outputQty: '', fee: '' });
  const [processing, setProcessing] = useState(false);
  const [processErr, setProcessErr] = useState('');
  const [processDone, setProcessDone] = useState('');
  const [editLot, setEditLot] = useState<string | null>(null);
  const [lotEdit, setLotEdit] = useState({ qtyOnHand: '', unitCost: '' });
  const [lotEditErr, setLotEditErr] = useState('');

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
      setMixDone(`Recipe "${mixName}" updated (no stock used)`);
      setEditFormulaId(null); setMixName(''); setMixRows([{ itemId: '', kg: '' }]); await loadFormulas();
    } catch (e) { setMixErr((e as Error).message); } finally { setMixing(false); }
  };

  const reload = () => Promise.all([api.getItems(), api.getLots(), api.getPurchases()]).then(([i,l,p]) => { setItems(i); setLots(l); setPurchases(p); });
  const loadOwed = () => fetch('/api/purchases?owed=1', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(setAmountOwed).catch(() => {});
  const patchData = async (resource: string, id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/data/${resource}?id=${id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || t('errorGeneric'));
    }
    await reload();
  };
  const startItemEdit = (it: InventoryItem) => { setEditItem(it.id); setItemEdit({ name: it.name, unit: it.unit, lowStockThreshold: String(it.lowStockThreshold) }); };
  const saveItemEdit = async () => {
    if (!editItem) return;
    try {
      await patchData('items', editItem, { name: itemEdit.name, unit: itemEdit.unit, lowStockThreshold: Number(itemEdit.lowStockThreshold) });
      setEditItem(null);
    } catch (e) { setErr((e as Error).message); }
  };
  const startLotEdit = (l: InventoryLot) => { setEditLot(l.id); setLotEdit({ qtyOnHand: String(l.qtyOnHand), unitCost: String(l.unitCost) }); setLotEditErr(''); };
  const saveLotEdit = async () => {
    if (!editLot) return;
    if (Number(lotEdit.qtyOnHand) < 0 || Number(lotEdit.unitCost) < 0) {
      setLotEditErr(t('errorGeneric'));
      return;
    }
    try {
      await patchData('lots', editLot, { qtyOnHand: Number(lotEdit.qtyOnHand), unitCost: Number(lotEdit.unitCost) });
      setEditLot(null);
      setLotEditErr('');
    } catch (e) { setLotEditErr((e as Error).message); }
  };
  useEffect(() => {
    reload(); loadFormulas(); loadOwed();
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
      setMixDone(`Mixed ${data.totalKg}kg of "${mixName}" at KSh ${data.unitCost}/kg`);
      setMixName(''); setMixRows([{ itemId: '', kg: '' }]); await reload(); await loadFormulas();
    } catch (e) { setMixErr((e as Error).message); } finally { setMixing(false); }
  };

  const recordProcess = async (e: React.FormEvent) => {
    e.preventDefault(); setProcessing(true); setProcessErr(''); setProcessDone('');
    try {
      const res = await fetch('/api/inventory/process', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputItemId: processForm.inputItemId, inputQty: processForm.inputQty,
          outputItemId: processForm.outputItemId,
          ...(processForm.outputItemId === '__new' ? { outputItemName: processForm.outputItemName, outputUnit: processForm.outputUnit } : {}),
          outputQty: processForm.outputQty,
          fee: processForm.fee || 0,
        }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Could not record this.'); }
      const data = await res.json();
      const outName = processForm.outputItemId === '__new' ? processForm.outputItemName : (items.find(i => i.id === processForm.outputItemId)?.name ?? 'output');
      setProcessDone(`Produced ${processForm.outputQty} ${outName} at ${fmtKES(data.outputUnitCost)}/unit`);
      setProcessForm({ inputItemId: '', inputQty: '', outputItemId: '', outputItemName: '', outputUnit: 'kg', outputQty: '', fee: '' });
      await reload();
    } catch (e) { setProcessErr((e as Error).message); } finally { setProcessing(false); }
  };

  const recordPurchase = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setErr('');
    try {
      const isNew = form.itemId === '__new';
      const base = {
        supplier: form.supplier, quantity: form.quantity, unitCost: form.unitCost, receivedAt: form.receivedAt,
        ...(form.paidLater
          ? { paymentMethod: 'credit', amountPaid: form.amountPaid || '0' }
          : { paymentMethod: form.paymentMethod }),
      };
      const payload = isNew
        ? { ...base, itemId: '__new', itemName: form.itemName, unit: form.unit, category: form.category }
        : { ...base, itemId: form.itemId };
      await api.recordPurchase(payload);
      setForm(EMPTY); setShow(false); await reload(); await loadOwed();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const settlePurchase = async (id: string, amount: number) => {
    setSettlingId(id);
    try {
      await fetch(`/api/purchases?id=${id}`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountPaid: amount, paymentMethod: 'mpesa', paidAt: new Date().toISOString() }),
      });
      await reload(); await loadOwed();
    } finally { setSettlingId(null); }
  };

  const itemNameFor = (id: string) => items.find(i => i.id === id)?.name ?? id;
  const { search: purchaseSearch, setSearch: setPurchaseSearch, page: purchasePage, setPage: setPurchasePage, totalPages: purchaseTotalPages, paged: pagedPurchases } = useTableFilter(purchases, {
    searchFields: (p) => `${itemNameFor(p.itemId)} ${p.supplier}`,
    sortFn: (a, b) => new Date(b.receivedAt ?? b.createdAt).getTime() - new Date(a.receivedAt ?? a.createdAt).getTime(),
  });

  const getStock = (itemId: string) => lots.filter(l => l.itemId === itemId).reduce((s,l) => s + l.qtyOnHand, 0);
  const isLow = (item: InventoryItem) => getStock(item.id) < item.lowStockThreshold;
  const isExpiringSoon = (lot: InventoryLot) => {
    if (!lot.expiryDate) return false;
    return (new Date(lot.expiryDate).getTime() - Date.now()) < 30 * 86400000;
  };

  const [stockSort, setStockSort] = useState<'low' | 'name' | 'stock'>('low');
  const STOCK_SORTERS: Record<typeof stockSort, (a: InventoryItem, b: InventoryItem) => number> = {
    low: (a, b) => Number(isLow(b)) - Number(isLow(a)) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    stock: (a, b) => getStock(b.id) - getStock(a.id),
  };
  const { search: stockSearch, setSearch: setStockSearch, visible: visibleItems, remaining: stockRemaining, filteredCount: stockFilteredCount, showMore: showMoreStock, showAll: showAllStock } = useCappedList(items, {
    searchFields: ['name', 'category'],
    sortFn: STOCK_SORTERS[stockSort],
  });

  // Variance computed server-side from workers' daily closing-stock counts vs on-hand.
  const [variances, setVariances] = useState<{ item: string; unit: string; expected: number; counted: number; variance: number }[]>([]);

  const tabs = [
    { key:'stock', label: t('stockLots') },
    { key:'formulation', label: t('feedFormulation') },
    { key:'process', label: 'Milling' },
    { key:'variance', label: t('inventoryVariance') },
    { key:'recent', label: t('recentStock') },
  ] as const;

  return (
    <div className="p-6 flex flex-col gap-6 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
            <Boxes className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('inventory')}</h1>
            <p className="text-gray-500 text-sm">Stock levels, feed formulation, and purchase history.</p>
          </div>
        </div>
        <button onClick={() => setShow(v => !v)} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90">+ {t('recordPurchase')}</button>
      </div>

      {/* Only shown when something's actually owed — no reason to take up screen
          space with a "KSh 0 owed" tile every time. */}
      {amountOwed && amountOwed.count > 0 && (
        <div className="bg-warning/15 border border-warning/40 rounded-xl px-5 py-4 flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-warning-foreground font-bold text-lg">{fmtKES(amountOwed.amountOwed)} owed to suppliers</p>
            <p className="text-warning-foreground/90 text-sm">{amountOwed.count} unpaid {amountOwed.count === 1 ? 'delivery' : 'deliveries'} — settle from the Recent tab.</p>
          </div>
          <button onClick={() => setTab('recent')} className="px-3 py-1.5 bg-warning text-warning-foreground rounded-lg text-xs font-semibold shrink-0">View</button>
        </div>
      )}

      {show && (
        <form onSubmit={recordPurchase} className="bg-white border border-primary/30 rounded-xl p-5 flex flex-col gap-3">
          <h3 className="font-bold text-gray-800">{t('recordPurchase')}</h3>
          {err && <p className="text-destructive bg-destructive/10 rounded-lg px-3 py-2 text-sm font-semibold">{err}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select required value={form.itemId} onChange={e => setForm({ ...form, itemId: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Select item…</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
              <option value="__new">+ New item…</option>
            </select>
            <input placeholder={t('supplier')} value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            {form.itemId === '__new' && (
              <>
                <input required placeholder="New item name (e.g. Maize, Dewormer)" value={form.itemName} onChange={e => setForm({ ...form, itemName: e.target.value })} className="border-2 border-primary/30 rounded-lg px-3 py-2 text-sm" />
                <div className="grid grid-cols-2 gap-2">
                  <input list="purchunits" placeholder="Unit (kg, bag, bottle)" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} className="border-2 border-primary/30 rounded-lg px-3 py-2 text-sm" />
                  <datalist id="purchunits"><option value="kg" /><option value="bag" /><option value="litre" /><option value="bottle" /><option value="dose" /><option value="piece" /></datalist>
                  <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="border-2 border-primary/30 rounded-lg px-3 py-2 text-sm">
                    {['FEED_FINISHED','FEED_INGREDIENT','MEDICINE','VACCINE','SEED','FERTILIZER','PESTICIDE','EQUIPMENT','CONSUMABLE'].map(c => <option key={c} value={c}>{c.replace('_',' ')}</option>)}
                  </select>
                </div>
              </>
            )}
            <input type="number" min="0" placeholder="How many (e.g. 50)" required value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input type="number" min="0" placeholder="Price each (KSh)" required value={form.unitCost} onChange={e => setForm({ ...form, unitCost: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-500">Date received</label>
            {/* Backdatable — a farmer catching up on a paper backlog shouldn't have every
                entry silently land on "today," which would wreck cost timelines. */}
            <input type="date" value={form.receivedAt} onChange={e => setForm({ ...form, receivedAt: e.target.value })}
              className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          {Number(form.quantity) > 0 && Number(form.unitCost) > 0 && (
            <p className="text-sm text-gray-600">{form.quantity} × KSh {form.unitCost} each = <span className="font-bold text-gray-900">Total KSh {(Number(form.quantity) * Number(form.unitCost)).toLocaleString()}</span></p>
          )}
          <details className="text-sm border border-gray-200 rounded-lg">
            <summary className="cursor-pointer text-gray-500 font-semibold hover:text-gray-700 px-4 py-3 bg-gray-50 rounded-lg">▼ Payment</summary>
            <div className="p-4 flex flex-col gap-3">
              <label className="flex items-center gap-2 text-gray-700 font-medium">
                <input type="checkbox" checked={form.paidLater} onChange={e => setForm({ ...form, paidLater: e.target.checked })} className="w-4 h-4 accent-primary" />
                Not paid yet — settle later (credit)
              </label>
              {form.paidLater ? (
                <input type="number" min="0" placeholder="Amount already paid, if any (KSh)" value={form.amountPaid}
                  onChange={e => setForm({ ...form, amountPaid: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
              ) : (
                <select value={form.paymentMethod} onChange={e => setForm({ ...form, paymentMethod: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="cash">Cash</option>
                  <option value="mpesa">M-Pesa</option>
                  <option value="bank">Bank</option>
                  <option value="other">Other</option>
                </select>
              )}
            </div>
          </details>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">{saving ? t('saving') : t('addStock')}</button>
            <button type="button" onClick={() => setShow(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">{t('cancel')}</button>
          </div>
        </form>
      )}

      <div className="flex gap-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab === t.key ? 'bg-primary text-primary-foreground' : 'bg-gray-100 text-gray-600'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'stock' && (
        <div className="flex flex-col gap-5">
          {items.length > 0 && (
            <TableToolbar search={stockSearch} onSearchChange={setStockSearch} placeholder="Search items…">
              <select value={stockSort} onChange={e => setStockSort(e.target.value as typeof stockSort)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-600">
                <option value="low">Low stock first</option>
                <option value="name">Name A–Z</option>
                <option value="stock">Highest stock first</option>
              </select>
              <span className="text-xs text-gray-400">{stockFilteredCount} item{stockFilteredCount === 1 ? '' : 's'}</span>
            </TableToolbar>
          )}
          {visibleItems.map(item => {
            const itemLots = lots.filter(l => l.itemId === item.id && l.qtyOnHand > 0);
            const totalStock = getStock(item.id);
            return (
              <div key={item.id} className={`bg-white border rounded-xl p-5 ${isLow(item) ? 'border-warning/40' : 'border-gray-200'}`}>
                {editItem === item.id ? (
                  <div className="mb-3 flex flex-col gap-2 bg-gray-50 rounded-lg p-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input value={itemEdit.name} onChange={e => setItemEdit({ ...itemEdit, name: e.target.value })} placeholder="Name" className="border rounded-lg px-3 py-2 text-sm" />
                      <input value={itemEdit.unit} onChange={e => setItemEdit({ ...itemEdit, unit: e.target.value })} placeholder="Unit" className="border rounded-lg px-3 py-2 text-sm" />
                      <input type="number" value={itemEdit.lowStockThreshold} onChange={e => setItemEdit({ ...itemEdit, lowStockThreshold: e.target.value })} placeholder="Low-stock alert at" className="border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveItemEdit} className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90">Save</button>
                      <button onClick={() => setEditItem(null)} className="px-3 py-1.5 bg-gray-200 rounded-lg text-xs font-semibold">{t('cancel')}</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-gray-900">{item.name}</h3>
                        {isLow(item) && <StatusChip status="warning" size="sm" label="LOW STOCK" />}
                        <button onClick={() => startItemEdit(item)} className="text-xs text-primary font-semibold hover:underline">Edit</button>
                      </div>
                      <p className="text-xs text-gray-400">{item.category} · Low-stock alert at {item.lowStockThreshold} {item.unit}</p>
                    </div>
                    <span className="text-2xl font-bold text-gray-900">{totalStock} <span className="text-base text-gray-500">{item.unit}</span></span>
                  </div>
                )}
                {itemLots.length > 0 && (
                  <div className="-mx-1">
                  {lotEditErr && itemLots.some(l => l.id === editLot) && (
                    <p className="text-destructive bg-destructive/10 rounded-lg px-3 py-2 text-xs font-semibold mb-2">{lotEditErr}</p>
                  )}
                  <Table className="text-xs text-gray-600 min-w-[440px]">
                    <TableHeader className="text-gray-400 font-semibold border-b border-gray-100">
                      <TableRow>
                        <TableHead className="text-left px-2 pb-2">{t('lotNo')}</TableHead>
                        <TableHead className="text-right px-3 pb-2">{t('qty')}</TableHead>
                        <TableHead className="text-right px-3 pb-2">{t('unitCost')}</TableHead>
                        <TableHead className="text-left px-3 pb-2 whitespace-nowrap">{t('received')}</TableHead>
                        <TableHead className="text-left px-3 pb-2 whitespace-nowrap">{t('expiry')}</TableHead>
                        <TableHead className="text-center px-2 pb-2">WD</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-gray-50">
                      {itemLots.map(lot => (
                        <TableRow key={lot.id}>
                          <TableCell className="py-2 px-2 font-mono">{lot.lotNo}</TableCell>
                          <TableCell className="py-2 px-3 text-right font-bold text-gray-900 whitespace-nowrap">
                            {editLot === lot.id
                              ? <input type="number" min="0" value={lotEdit.qtyOnHand} onChange={e => setLotEdit({ ...lotEdit, qtyOnHand: e.target.value })} className="w-20 border rounded px-2 py-1 text-right" />
                              : <>{lot.qtyOnHand} {lot.unit}</>}
                          </TableCell>
                          <TableCell className="py-2 px-3 text-right whitespace-nowrap">
                            {editLot === lot.id
                              ? <input type="number" min="0" value={lotEdit.unitCost} onChange={e => setLotEdit({ ...lotEdit, unitCost: e.target.value })} className="w-20 border rounded px-2 py-1 text-right" />
                              : <>KSh {lot.unitCost}</>}
                          </TableCell>
                          <TableCell className="py-2 px-3 whitespace-nowrap">{new Date(lot.receivedDate).toLocaleDateString('en-KE')}</TableCell>
                          <TableCell className="py-2 px-3 whitespace-nowrap">
                            {lot.expiryDate
                              ? <span className={`inline-flex items-center gap-1 ${isExpiringSoon(lot) ? 'text-warning-foreground font-semibold' : ''}`}>{new Date(lot.expiryDate).toLocaleDateString('en-KE')}{isExpiringSoon(lot) && <AlertTriangle className="w-3 h-3" />}</span>
                              : '—'
                            }
                          </TableCell>
                          <TableCell className="py-2 px-2 text-center whitespace-nowrap">
                            {editLot === lot.id
                              ? <span className="flex gap-1 justify-center"><button onClick={saveLotEdit} className="text-primary"><Check className="w-4 h-4" /></button><button onClick={() => { setEditLot(null); setLotEditErr(''); }} className="text-gray-400"><X className="w-4 h-4" /></button></span>
                              : <button onClick={() => startLotEdit(lot)} className="text-gray-400 hover:text-primary" title="Fix qty/cost"><Pencil className="w-3.5 h-3.5" /></button>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                )}
                {itemLots.length === 0 && <p className="text-xs text-gray-400">No lots with stock. All lots depleted (FIFO).</p>}
              </div>
            );
          })}
          {items.length > 0 && stockFilteredCount === 0 && (
            <p className="text-center text-gray-400 text-sm py-6">No items match &quot;{stockSearch}&quot;.</p>
          )}
          <SeeMoreButton remaining={stockRemaining} onShowMore={showMoreStock} onShowAll={showAllStock} />
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
                      <button onClick={() => applyFormula(f)} className="text-xs text-primary font-semibold hover:underline">Use / edit</button>
                      <button onClick={() => deleteFormula(f.id)} className="text-xs text-gray-400 hover:text-destructive">{t('delete')}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-3">
            {mixErr && <p className="text-destructive bg-destructive/10 rounded-lg px-3 py-2 text-sm font-semibold">{mixErr}</p>}
            {mixDone && <p className="text-success bg-success/10 rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1.5"><Check className="w-4 h-4 shrink-0" /> {mixDone}</p>}
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
                    <button type="button" onClick={() => setMixRows(rs => rs.filter((_, idx) => idx !== i))} className="px-2 text-gray-400 hover:text-red-600"><X className="w-4 h-4" /></button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setMixRows(rs => [...rs, { itemId: '', kg: '' }])} className="text-sm text-primary font-semibold self-start">+ Add ingredient</button>
            </div>
            <div className="flex items-center justify-between bg-primary/10 rounded-xl px-4 py-2">
              <span className="text-sm font-semibold text-primary">Rolled-up cost:</span>
              <span className="text-lg font-bold text-primary">{mixKg > 0 ? `KSh ${(mixCost / mixKg).toFixed(2)} / kg · ${mixKg}kg total` : '—'}</span>
            </div>
            {editFormulaId && <p className="text-xs text-indigo-600 -mb-1">Editing the saved recipe. “Update recipe” saves changes without using stock; “Record Mix” actually mixes &amp; consumes stock.</p>}
            <div className="flex flex-col sm:flex-row gap-2">
              {editFormulaId && (
                <button onClick={updateFormula} disabled={mixing || !mixName || mixKg <= 0} className="flex-1 bg-indigo-600 text-white rounded-xl py-3 font-bold disabled:opacity-50">
                  {mixing ? t('saving') : t('updateRecipe')}
                </button>
              )}
              <button onClick={recordMix} disabled={mixing || !mixName || mixKg <= 0} className="flex-1 bg-primary text-primary-foreground rounded-xl py-3 font-bold hover:bg-primary/90 disabled:opacity-50">
                {mixing ? t('mixing') : t('recordMixEvent')}
              </button>
              {editFormulaId && (
                <button type="button" onClick={() => { setEditFormulaId(null); setMixName(''); setMixRows([{ itemId: '', kg: '' }]); }} className="px-4 bg-gray-100 text-gray-700 rounded-xl py-3 font-semibold text-sm">New</button>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'process' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-bold text-gray-800 mb-3">Milling / Processing</h2>
          <p className="text-gray-500 text-sm mb-4">Convert one item into a different, already-existing one — e.g. whole maize into flour. Always a loss, never a gain: output can&apos;t exceed input.</p>
          {processErr && <p className="text-destructive bg-destructive/10 rounded-lg px-3 py-2 text-sm font-semibold mb-3">{processErr}</p>}
          {processDone && <p className="text-success bg-success/10 rounded-lg px-3 py-2 text-sm font-semibold mb-3">{processDone}</p>}
          <form onSubmit={recordProcess} className="flex flex-col gap-3 max-w-md">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500">Raw item going in</label>
              <div className="grid grid-cols-2 gap-2">
                <select required value={processForm.inputItemId} onChange={e => setProcessForm({ ...processForm, inputItemId: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">Select item…</option>
                  {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                </select>
                <input type="number" min="0" required placeholder="Quantity" value={processForm.inputQty} onChange={e => setProcessForm({ ...processForm, inputQty: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500">Processed item coming out</label>
              <div className="grid grid-cols-2 gap-2">
                <select required value={processForm.outputItemId} onChange={e => setProcessForm({ ...processForm, outputItemId: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">Select item…</option>
                  {items.filter(i => i.id !== processForm.inputItemId).map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                  <option value="__new">+ New item…</option>
                </select>
                <input type="number" min="0" required placeholder="Quantity" value={processForm.outputQty} onChange={e => setProcessForm({ ...processForm, outputQty: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              {processForm.outputItemId === '__new' && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <input required placeholder="e.g. Maize flour" value={processForm.outputItemName} onChange={e => setProcessForm({ ...processForm, outputItemName: e.target.value })} className="border-2 border-primary/30 rounded-lg px-3 py-2 text-sm" />
                  <input list="processunits" placeholder="Unit (kg, bag…)" value={processForm.outputUnit} onChange={e => setProcessForm({ ...processForm, outputUnit: e.target.value })} className="border-2 border-primary/30 rounded-lg px-3 py-2 text-sm" />
                  <datalist id="processunits"><option value="kg" /><option value="bag" /><option value="litre" /></datalist>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500">Milling / processing fee (KSh, optional)</label>
              <input type="number" min="0" placeholder="e.g. 400" value={processForm.fee} onChange={e => setProcessForm({ ...processForm, fee: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            {Number(processForm.inputQty) > 0 && Number(processForm.outputQty) > 0 && (
              <p className="text-sm text-gray-600">Yield: <span className="font-bold text-gray-900">{((Number(processForm.outputQty) / Number(processForm.inputQty)) * 100).toFixed(1)}%</span></p>
            )}
            <button type="submit" disabled={processing} className="bg-primary text-primary-foreground rounded-xl py-3 font-bold hover:bg-primary/90 disabled:opacity-50">
              {processing ? t('saving') : 'Record processing'}
            </button>
          </form>
        </div>
      )}

      {tab === 'variance' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          {/* Closing-stock variance flags — FR-M4-4 */}
          <h2 className="font-bold text-gray-800 mb-3">Closing-Stock Variance Flags</h2>
          <p className="text-gray-500 text-sm mb-4">Discrepancies between counted stock and logged consumption. Review before correcting.</p>
          {variances.length === 0
            ? (
              <div className="text-center py-8 bg-gray-50 border border-dashed border-gray-200 rounded-xl">
                <p className="text-gray-400 text-sm flex items-center justify-center gap-1.5"><PartyPopper className="w-4 h-4" /> No variance flags</p>
                <p className="text-gray-400 text-xs mt-1">Flags appear when a worker&apos;s daily closing-stock count differs from what feeding logs say should remain.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {variances.map(v => (
                  <div key={v.item} className="flex items-center justify-between bg-warning/15 border border-warning/40 rounded-xl px-4 py-3">
                    <div>
                      <p className="font-semibold text-gray-900">{v.item}</p>
                      <p className="text-xs text-gray-500">Expected {v.expected} {v.unit} · Counted {v.counted} {v.unit}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-warning-foreground font-bold">{v.variance > 0 ? '+' : ''}{v.variance} {v.unit}</p>
                      {/* Variance always gets flagged for owner review — BR-11 */}
                      <p className="text-xs text-warning-foreground">▲ Variance flag</p>
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
              <>
                <TableToolbar search={purchaseSearch} onSearchChange={setPurchaseSearch} placeholder="Search item or supplier…" className="mb-3" />
                <Table>
                  <TableHeader className="text-gray-500 text-xs font-semibold border-b">
                    <TableRow>
                      <TableHead className="text-left pb-2">{t('date')}</TableHead>
                      <TableHead className="text-left pb-2">{t('item')}</TableHead>
                      <TableHead className="text-left pb-2">{t('supplier')}</TableHead>
                      <TableHead className="text-right pb-2">{t('qty')}</TableHead>
                      <TableHead className="text-right pb-2">{t('unitCost')}</TableHead>
                      <TableHead className="text-right pb-2">{t('total')}</TableHead>
                      <TableHead className="text-right pb-2">Payment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-gray-50">
                    {pagedPurchases.map(p => {
                      const owed = Math.max(0, p.totalCost - p.amountPaid);
                      return (
                        <TableRow key={p.id} className="hover:bg-gray-50">
                          <TableCell className="py-2 text-gray-400">{new Date(p.receivedAt ?? p.createdAt).toLocaleDateString('en-KE')}</TableCell>
                          <TableCell className="py-2 font-semibold text-gray-900">{itemNameFor(p.itemId)}</TableCell>
                          <TableCell className="py-2 text-gray-600">{p.supplier}</TableCell>
                          <TableCell className="py-2 text-right">{p.quantity}</TableCell>
                          <TableCell className="py-2 text-right text-gray-600">{fmtKES(p.unitCost)}</TableCell>
                          <TableCell className="py-2 text-right font-bold text-red-700">{fmtKES(p.totalCost)}</TableCell>
                          <TableCell className="py-2 text-right">
                            {owed <= 0 ? (
                              <span className="inline-block px-2 py-0.5 rounded-full bg-success/10 text-success text-xs font-semibold">Paid</span>
                            ) : (
                              <div className="flex items-center justify-end gap-2">
                                <span className="inline-block px-2 py-0.5 rounded-full bg-warning/15 text-warning-foreground text-xs font-semibold whitespace-nowrap">Owes {fmtKES(owed)}</span>
                                <button onClick={() => settlePurchase(p.id, p.totalCost)} disabled={settlingId === p.id}
                                  className="text-xs font-semibold text-success hover:underline disabled:opacity-50 whitespace-nowrap">
                                  {settlingId === p.id ? '…' : 'Mark paid'}
                                </button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <div className="mt-3">
                  <Pager page={purchasePage} totalPages={purchaseTotalPages} onPageChange={setPurchasePage} />
                </div>
              </>
            )
          }
        </div>
      )}
    </div>
  );
}
