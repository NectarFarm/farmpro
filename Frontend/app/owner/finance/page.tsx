'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, getProducts } from '@/lib/api';
import type { Sale, Purchase, Batch, Product, BatchCostSummary, InventoryItem } from '@/lib/types';
import { StatusChip } from '@/components/worker/StatusChip';

const fmtKES = (n: number) => `KES ${n.toLocaleString('en-KE')}`;
const EMPTY = { batchId: '', productId: '', unitName: '', quantity: '', unitPrice: '', buyer: '' };

export default function FinancePage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tab, setTab] = useState<'sales'|'purchases'|'batchpl'>('sales');
  const [showSale, setShowSale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [avail, setAvail] = useState<{ produced: number; sold: number; available: number } | null>(null);

  const [batchPL, setBatchPL] = useState<{ batch: Batch; cost: BatchCostSummary | null }[]>([]);

  const [items, setItems] = useState<InventoryItem[]>([]);
  const itemName = (id: string) => items.find(i => i.id === id)?.name ?? id;

  const reload = () => Promise.all([api.getSales(), api.getPurchases()]).then(([s,p]) => { setSales(s); setPurchases(p); });
  useEffect(() => { reload(); api.getBatches().then(setBatches); api.getItems().then(setItems); }, []);
  useEffect(() => {
    if (!batches.length) { setBatchPL([]); return; }
    Promise.all(batches.map(async b => ({ batch: b, cost: await api.getCostSummary(b.id) }))).then(setBatchPL);
  }, [batches]);

  const product = products.find(p => p.id === form.productId);
  const unit = product?.saleUnits.find(u => u.name === form.unitName);
  const total = (Number(form.quantity) || 0) * (Number(form.unitPrice) || 0);

  // When the batch changes, load its products (eggs/pork/manure…) and reset the rest.
  const onBatch = async (batchId: string) => {
    setForm({ ...EMPTY, batchId }); setAvail(null);
    setProducts(batchId ? await getProducts(batchId) : []);
  };
  const onProduct = (productId: string) => {
    const p = products.find(x => x.id === productId);
    const u = p?.saleUnits[0];
    setForm(f => ({ ...f, productId, unitName: u?.name ?? '', unitPrice: u ? String(u.price) : '' }));
    setAvail(null);
    if (p && form.batchId) {
      fetch(`/api/availability?batchId=${form.batchId}&product=${encodeURIComponent(p.name)}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null).then(setAvail).catch(() => {});
    }
  };
  // Base units the current entry would sell (quantity × the unit's perBase).
  const sellingBase = (Number(form.quantity) || 0) * (unit?.perBase ?? 1);
  const overSell = avail != null && sellingBase > avail.available + 1e-6;
  const onUnit = (unitName: string) => {
    const u = product?.saleUnits.find(x => x.name === unitName);
    setForm(f => ({ ...f, unitName, unitPrice: u ? String(u.price) : f.unitPrice }));
  };

  const createSale = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setErr('');
    try {
      const res = await fetch('/api/data/sales', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: form.batchId, productId: form.productId, productType: product?.name ?? 'produce',
          unitName: form.unitName, quantity: form.quantity, unitPrice: form.unitPrice, buyer: form.buyer,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Surface the server's real message (e.g. "Only 74 eggs available to sell…").
        throw new Error(data.error || (res.status === 403 ? 'Not permitted' : res.status === 401 ? 'Please sign in again' : `Failed (${res.status})`));
      }
      setForm(EMPTY); setProducts([]); setShowSale(false); await reload();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const totalRevenue = sales.reduce((s,sl) => s + sl.totalAmount, 0);
  const totalCost = purchases.reduce((s,p) => s + p.totalCost, 0);

  return (
    <div className="p-6 flex flex-col gap-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">💰 Finance</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowSale(v => !v)} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm">+ Record Sale</button>
        </div>
      </div>

      {showSale && (
        <form onSubmit={createSale} className="bg-white border border-green-300 rounded-xl p-5 flex flex-col gap-3">
          <h3 className="font-bold text-gray-800">Record a Sale</h3>
          {err && <p className="text-red-600 bg-red-50 rounded-lg px-3 py-2 text-sm font-semibold">{err}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select required value={form.batchId} onChange={e => onBatch(e.target.value)} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Select batch…</option>
              {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select required value={form.productId} onChange={e => onProduct(e.target.value)} disabled={!form.batchId} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm disabled:opacity-50">
              <option value="">{form.batchId ? (products.length ? 'Select product…' : 'No products for this batch') : 'Pick a batch first'}</option>
              {products.filter(p => p.flow === 'sale').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select required value={form.unitName} onChange={e => onUnit(e.target.value)} disabled={!product} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm disabled:opacity-50">
              <option value="">Sale unit…</option>
              {product?.saleUnits.map(u => <option key={u.name} value={u.name}>{u.name} — {fmtKES(u.price)}</option>)}
            </select>
            <input type="number" min="0" placeholder={`How many${unit ? ` (${unit.name})` : ''}`} required value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input type="number" min="0" placeholder={`Price each${unit ? ` (per ${unit.name})` : ''} (KES)`} required value={form.unitPrice} onChange={e => setForm({ ...form, unitPrice: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input placeholder="Buyer" value={form.buyer} onChange={e => setForm({ ...form, buyer: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          {avail && product && (
            <p className={`text-sm rounded-lg px-3 py-2 ${overSell ? 'bg-red-50 text-red-700 font-semibold' : 'bg-gray-50 text-gray-600'}`}>
              {overSell
                ? `⚠ Only ${avail.available} ${product.baseUnit} available — you're trying to sell ${sellingBase}. Record the collection first.`
                : `${avail.available} ${product.baseUnit} available to sell (collected ${avail.produced}, sold ${avail.sold})${sellingBase > 0 ? ` · this sale = ${sellingBase} ${product.baseUnit}` : ''}`}
            </p>
          )}
          {total > 0 && <p className="text-sm text-gray-600">Total: <span className="font-bold text-green-700">{fmtKES(total)}</span></p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving || overSell} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save Sale'}</button>
            <button type="button" onClick={() => setShowSale(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">Cancel</button>
          </div>
        </form>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
          <p className="text-xs text-gray-500">Total Revenue</p>
          <p className="text-2xl font-bold text-green-700">{fmtKES(totalRevenue)}</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-xs text-gray-500">Total Purchases</p>
          <p className="text-2xl font-bold text-red-700">{fmtKES(totalCost || 0)}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
          <p className="text-xs text-gray-500">Revenue − Purchases</p>
          <p className={`text-2xl font-bold ${totalRevenue - totalCost >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmtKES(totalRevenue - totalCost)}</p>
        </div>
      </div>

      <div className="flex gap-1">
        {[{key:'sales',l:'Sales'},{key:'purchases',l:'Purchases'},{key:'batchpl',l:'Batch P&L'}].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as typeof tab)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab === t.key ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {t.l}
          </button>
        ))}
      </div>

      {tab === 'sales' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs font-semibold">
              <tr><th className="px-4 py-3 text-left">Date</th><th className="px-3 py-3 text-left">Product</th><th className="px-3 py-3 text-right">Qty</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3 text-left hidden md:table-cell">Buyer</th><th className="px-3 py-3 text-center">WD Check</th><th className="px-3 py-3 text-center">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sales.map(s => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(s.createdAt).toLocaleDateString('en-KE')}</td>
                  <td className="px-3 py-3 font-medium text-gray-900">{s.productType}</td>
                  <td className="px-3 py-3 text-right">{s.quantity}</td>
                  <td className="px-3 py-3 text-right font-bold text-gray-900">{fmtKES(s.totalAmount)}</td>
                  <td className="px-3 py-3 text-gray-600 hidden md:table-cell">{s.buyer}</td>
                  <td className="px-3 py-3 text-center">
                    <StatusChip status={s.withdrawalCheck === 'cleared' ? 'ok' : 'critical'} size="sm" label={s.withdrawalCheck === 'cleared' ? '✓ Cleared' : '⛔ Blocked'} />
                  </td>
                  <td className="px-3 py-3 text-center"><span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs">{s.status}</span></td>
                </tr>
              ))}
              {sales.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No sales recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'purchases' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs font-semibold">
              <tr><th className="px-4 py-3 text-left">Date</th><th className="px-3 py-3 text-left">Item</th><th className="px-3 py-3 text-left hidden md:table-cell">Supplier</th><th className="px-3 py-3 text-right">Qty</th><th className="px-3 py-3 text-right">Unit cost</th><th className="px-3 py-3 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {purchases.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(p.createdAt).toLocaleDateString('en-KE')}</td>
                  <td className="px-3 py-3 font-medium text-gray-900">{itemName(p.itemId)}</td>
                  <td className="px-3 py-3 text-gray-600 hidden md:table-cell">{p.supplier}</td>
                  <td className="px-3 py-3 text-right">{p.quantity}</td>
                  <td className="px-3 py-3 text-right text-gray-600">{fmtKES(p.unitCost)}</td>
                  <td className="px-3 py-3 text-right font-bold text-red-700">{fmtKES(p.totalCost)}</td>
                </tr>
              ))}
              {purchases.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No purchases yet. Record one on the Inventory page (&quot;+ Record Purchase&quot;).</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'batchpl' && (
        <div className="flex flex-col gap-3">
          {batchPL.length === 0 && <p className="text-gray-400 text-sm text-center py-6">No batches yet. Add a batch on the Farm page to see its P&L.</p>}
          {batchPL.map(({ batch, cost }) => {
            const margin = cost?.grossMargin ?? 0;
            return (
              <Link key={batch.id} href={`/owner/farm/${batch.id}`} className={`bg-white border rounded-xl p-5 flex items-center justify-between hover:bg-gray-50 ${margin >= 0 ? 'border-green-200' : 'border-red-200'}`}>
                <div>
                  <p className="font-bold text-gray-900">{batch.name}</p>
                  <p className="text-xs text-gray-400">Stage: {batch.stage}{cost?.fcr ? ` · FCR ${cost.fcr}` : ''}{cost?.mortalityPct != null ? ` · Mortality ${cost.mortalityPct}%` : ''}</p>
                </div>
                <div className="text-right">
                  <p className={`text-xl font-bold ${margin >= 0 ? 'text-green-700' : 'text-red-600'}`}>{margin >= 0 ? '+' : '−'}{fmtKES(margin)}</p>
                  <p className="text-xs text-gray-400">Cost {fmtKES(cost?.totalCost ?? 0)} · Rev {fmtKES(cost?.totalRevenue ?? 0)}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
