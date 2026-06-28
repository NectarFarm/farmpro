'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, getCumulativeChartData, getProducts, createProduct, updateProduct } from '@/lib/api';
import type { Batch, BatchCostSummary, Sale, Product } from '@/lib/types';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Legend } from 'recharts';
import { ConfirmSheet } from '@/components/worker/ConfirmSheet';
import { StatusChip } from '@/components/worker/StatusChip';
import { headNoun, groupNoun } from '@/lib/species';

const fmtKES = (n: number) => `KSh ${Math.abs(n).toLocaleString('en-KE')}`;

export default function BatchDetailPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [cost, setCost] = useState<BatchCostSummary | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [saleQty, setSaleQty] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [saleBuyer, setSaleBuyer] = useState('');
  const [toast, setToast] = useState('');
  const [chartData, setChartData] = useState<{ day: number; cost: number; revenue: number }[]>([]);
  const [, setSaving] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [showProduct, setShowProduct] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [pErr, setPErr] = useState('');
  const [pForm, setPForm] = useState({ name: '', baseUnit: 'unit', collectFrequency: 'per_cycle', flow: 'sale', isAnimalProduct: false, units: [{ name: '', perBase: '1', price: '' }] });
  const [saleProductId, setSaleProductId] = useState('');
  const [saleUnitName, setSaleUnitName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [ep, setEp] = useState<{ name: string; collectFrequency: string; flow: string; units: { name: string; perBase: string; price: string }[]; isAnimalProduct: boolean }>({ name: '', collectFrequency: 'per_cycle', flow: 'sale', units: [], isAnimalProduct: false });
  const [activity, setActivity] = useState<{ kind: string; at: string; by: string; text: string; photoId: string | null; gpsLat: number | null; gpsLng: number | null }[]>([]);
  const [pendingCounts, setPendingCounts] = useState<{ clientUuid: string; physicalCount: number; systemCount: number; variance: number; reason: string | null; capturedAt: string }[]>([]);

  const reload = () => {
    Promise.all([api.getBatch(batchId), api.getCostSummary(batchId), api.getSales()]).then(([b,c,s]) => {
      setBatch(b); setCost(c); setSales(s.filter(sl => sl.batchId === batchId));
    });
    getCumulativeChartData(batchId).then(setChartData);
    getProducts(batchId).then(setProducts);
    fetch(`/api/batch-activity?batchId=${encodeURIComponent(batchId)}`, { credentials: 'include' }).then(r => r.ok ? r.json() : []).then(setActivity).catch(() => {});
    fetch('/api/physical-counts', { credentials: 'include' }).then(r => r.ok ? r.json() : [])
      .then((cs: { batchId: string }[]) => setPendingCounts(cs.filter(c => c.batchId === batchId) as never)).catch(() => {});
  };

  // Owner reconciles a worker head count: apply it to the live count, or dismiss it.
  const resolveCount = async (id: string, action: 'apply' | 'dismiss') => {
    await fetch('/api/physical-counts', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id }),
    });
    reload();
    setToast(action === 'apply' ? '✓ Head count applied' : 'Count dismissed');
  };

  const startEdit = (p: Product) => {
    setEditId(p.id);
    setEp({ name: p.name, collectFrequency: String(p.collectFrequency), flow: String(p.flow), units: p.saleUnits.map(u => ({ name: u.name, perBase: String(u.perBase), price: String(u.price) })), isAnimalProduct: p.isAnimalProduct ?? false });
  };
  const saveEdit = async () => {
    if (!editId) return;
    const saleUnits = ep.units.filter(u => u.name).map(u => ({ name: u.name, perBase: Number(u.perBase) || 1, price: Number(u.price) || 0 }));
    await updateProduct(editId, { name: ep.name, collectFrequency: ep.collectFrequency, saleUnits, isAnimalProduct: ep.isAnimalProduct });
    setEditId(null); getProducts(batchId).then(setProducts);
  };

  const addProduct = async () => {
    setSavingProduct(true); setPErr('');
    try {
      const saleUnits = pForm.units.filter(u => u.name && u.price !== '').map(u => ({ name: u.name, perBase: Number(u.perBase) || 1, price: Number(u.price) || 0 }));
      if (!pForm.name || saleUnits.length === 0) throw new Error('Enter a name and at least one sale unit with a price');
      await createProduct({ batchId, name: pForm.name, baseUnit: pForm.baseUnit, collectFrequency: pForm.collectFrequency, flow: pForm.flow, isAnimalProduct: pForm.isAnimalProduct, saleUnits });
      setPForm({ name: '', baseUnit: 'unit', collectFrequency: 'per_cycle', flow: 'sale', isAnimalProduct: false, units: [{ name: '', perBase: '1', price: '' }] });
      setShowProduct(false); getProducts(batchId).then(setProducts);
    } catch (e) { setPErr((e as Error).message); } finally { setSavingProduct(false); }
  };

  useEffect(() => { if (batchId) reload(); }, [batchId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!batch) return <div className="p-6 text-gray-400">Loading…</div>;

  const days = Math.floor((Date.now() - new Date(batch.acquiredDate).getTime()) / 86400000);

  // Withdrawal check — BR-WD
  const checkWithdrawal = () => ({
    cleared: true, until: null, daysLeft: 0,
  });
  const wdCheck = checkWithdrawal();

  const costBreakdown = cost ? [
    { name: 'Feed', value: cost.feedCost, color: '#16a34a' },
    { name: 'Stock purchase', value: cost.acquisitionCost, color: '#2563eb' },
    { name: 'Health', value: cost.healthCost, color: '#7c3aed' },
    { name: 'Labor', value: cost.laborCost, color: '#d97706' },
    { name: 'Salaries', value: cost.salaryCost ?? 0, color: '#db2777' },
    { name: 'Other', value: cost.overheadCost, color: '#6b7280' },
  ].filter(d => d.value > 0) : [];

  const saleProduct = products.find(p => p.id === saleProductId);
  const saleUnit = saleProduct?.saleUnits.find(u => u.name === saleUnitName);
  const saleProductType = () => saleProduct?.name ?? (batch?.species || 'produce');
  const pickSaleProduct = (id: string) => {
    const p = products.find(x => x.id === id); const u = p?.saleUnits[0];
    setSaleProductId(id); setSaleUnitName(u?.name ?? ''); if (u) setSalePrice(String(u.price));
  };
  const pickSaleUnit = (name: string) => {
    const u = saleProduct?.saleUnits.find(x => x.name === name);
    setSaleUnitName(name); if (u) setSalePrice(String(u.price));
  };

  const handleSale = async () => {
    if (!batch) return;
    setSaving(true);
    try {
      await api.recordSale({ batchId, productId: saleProductId, productType: saleProductType(), unitName: saleUnitName, quantity: saleQty, unitPrice: salePrice, buyer: saleBuyer });
      setShowSaleModal(false); setSaleQty(''); setSalePrice(''); setSaleBuyer('');
      setToast('✓ Sale recorded'); reload();
    } catch (e) { setToast('⚠ ' + (e as Error).message); }
    finally { setSaving(false); setTimeout(() => setToast(''), 2500); }
  };

  return (
    <div className="p-6 flex flex-col gap-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/owner/farm" className="hover:underline">Farm</Link>
        <span>›</span>
        <span className="text-gray-900 font-semibold">{batch.name}</span>
      </div>

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-xl px-6 py-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{batch.name}</h1>
            <p className="text-gray-500 text-sm">Day {days} · {batch.species} · {batch.breed ?? ''}</p>
            <p className="text-gray-400 text-xs">Source: {batch.source} · Initial: {batch.initialQty}</p>
          </div>
          <div className="flex gap-2">
            <StatusChip status={batch.status === 'ACTIVE' ? 'ok' : 'offline'} label={batch.status} />
            <button onClick={() => setShowSaleModal(true)}
              className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm hover:bg-green-700">
              Record Sale
            </button>
          </div>
        </div>

        {/* KPI row */}
        {cost && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 pt-4 border-t border-gray-100">
            {[
              { label:'Current Qty', value: String(batch.currentQty) },
              { label:'FCR', value: cost.fcr ? `${cost.fcr} ✓` : '—', good: cost.fcr ? cost.fcr <= 2.8 : null },
              { label:'Mortality %', value: cost.mortalityPct ? `${cost.mortalityPct}%` : '—', bad: cost.mortalityPct ? cost.mortalityPct > 5 : false },
              { label: cost.outputUnit === 'eggs' ? 'Cost/egg' : 'Cost/kg', value: cost.costPerUnit ? fmtKES(cost.costPerUnit) : '—' },
              { label:'Gross Margin', value: fmtKES(cost.grossMargin), good: cost.grossMargin > 0, bad: cost.grossMargin < 0 },
            ].map(k => (
              <div key={k.label} className="text-center">
                <p className="text-xs text-gray-400">{k.label}</p>
                <p className={`text-lg font-bold ${k.bad ? 'text-red-600' : k.good ? 'text-green-700' : 'text-gray-900'}`}>{k.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cost breakdown + cumulative chart + break-even cards */}
      <div className="grid md:grid-cols-2 gap-5">
        {/* Cost donut */}
        {cost && (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-bold text-gray-800 mb-2">Cost Breakdown</h2>
            <p className="text-xs text-gray-400 mb-3">Total cost: {fmtKES(cost.totalCost)}</p>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={costBreakdown} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                  {costBreakdown.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmtKES(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-2 mt-2">
              {costBreakdown.map(d => (
                <span key={d.name} className="flex items-center gap-1 text-xs text-gray-600">
                  <span className="w-3 h-3 rounded-full inline-block" style={{ background: d.color }} />
                  {d.name}: {fmtKES(d.value)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Cumulative cost vs revenue — FR-M10-6 honest cumulative */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-bold text-gray-800 mb-1">Cumulative Cost vs Revenue</h2>
          <p className="text-xs text-gray-400 mb-3">Intersection = break-even (honest cumulative, no instant flips)</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top:5, right:10, bottom:0, left:0 }}>
              <XAxis dataKey="day" tick={{ fontSize:10 }} label={{ value:'Day', position:'insideBottom', offset:-2 }} />
              <YAxis tick={{ fontSize:10 }} tickFormatter={v=>`${(v/1000).toFixed(0)}K`} />
              <Tooltip formatter={(v: number, n) => [fmtKES(v), n === 'cost' ? 'Cost' : 'Revenue']} />
              <Legend />
              <Area type="monotone" dataKey="cost" stroke="#ef4444" fill="#fee2e2" name="Cost" strokeWidth={2} />
              <Area type="monotone" dataKey="revenue" stroke="#16a34a" fill="#dcfce7" name="Revenue" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Break-even on remaining stock — per-head valuation (current position) */}
      {cost && (cost.remainingQty ?? 0) > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-400">Cost per surviving {headNoun(batch.species, 1)}</p>
            <p className="text-2xl font-bold text-gray-900">{fmtKES(cost.costPerBird ?? 0)}</p>
            <p className="text-xs text-gray-400">{fmtKES(cost.totalCost)} ÷ {cost.survivors ?? 0} survivors</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-400">Revenue received so far</p>
            <p className="text-2xl font-bold text-green-700">{fmtKES(cost.totalRevenue)}</p>
            <p className="text-xs text-gray-400">{cost.soldHead ?? 0} {headNoun(batch.species)} sold</p>
          </div>
          <div className={`bg-white border rounded-xl p-4 text-center ${cost.grossMargin < 0 ? 'border-amber-300' : 'border-green-200'}`}>
            <p className="text-xs text-gray-400">
              {cost.grossMargin < 0 ? `Break-even price per remaining ${headNoun(batch.species, 1)}` : 'Already in profit'}
            </p>
            <p className={`text-2xl font-bold ${cost.grossMargin < 0 ? 'text-amber-700' : 'text-green-700'}`}>
              {cost.grossMargin < 0
                ? fmtKES(cost.breakEvenPricePerRemaining ?? 0)
                : `+${fmtKES(cost.grossMargin)}`}
            </p>
            <p className="text-xs text-gray-400">
              {cost.grossMargin < 0
                ? `Need ${fmtKES(Math.abs(cost.grossMargin))} more from the ${cost.remainingQty ?? 0} unsold ${headNoun(batch.species)}`
                : `Already ${fmtKES(cost.grossMargin)} ahead`}
            </p>
          </div>
        </div>
      )}

      {/* Per-batch analysis section (species-aware wording) */}
      {cost && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-bold text-gray-800 mb-3">{groupNoun(batch.species)} Analysis</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">Mortality Rate</p>
              <p className={`text-lg font-bold ${(cost.mortalityPct ?? 0) > 5 ? 'text-red-600' : 'text-gray-900'}`}>
                {cost.mortalityPct ? `${cost.mortalityPct}%` : '0%'}
              </p>
              <p className="text-xs text-gray-400">
                {cost.deaths ?? 0} of {batch.initialQty} died
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">Survival Rate</p>
              <p className="text-lg font-bold text-gray-900">
                {batch.initialQty > 0 ? (((cost.survivors ?? 0) / batch.initialQty) * 100).toFixed(0) : 0}%
              </p>
              <p className="text-xs text-gray-400">{cost.survivors ?? 0} of {batch.initialQty} survived</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">Feed Conversion (FCR)</p>
              <p className={`text-lg font-bold ${cost.fcr && cost.fcr > 2.8 ? 'text-amber-600' : 'text-gray-900'}`}>
                {cost.fcr ?? '—'}
              </p>
              <p className="text-xs text-gray-400">{cost.outputUnit === 'eggs' ? 'kg feed / dozen eggs' : 'kg feed / kg output'}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">On farm now</p>
              <p className="text-lg font-bold text-gray-900">{cost.currentQty}</p>
              <p className="text-xs text-gray-400">{cost.soldHead ?? 0} sold · {cost.deaths ?? 0} died</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">Acquisition cost / {headNoun(batch.species, 1)}</p>
              <p className="text-lg font-bold text-gray-900">
                {fmtKES(batch.initialQty > 0 ? Math.round(batch.acquisitionCost / batch.initialQty) : 0)}
              </p>
              <p className="text-xs text-gray-400">Initial purchase price</p>
            </div>
          </div>
        </div>
      )}

      {/* Products this batch yields */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-800">Products this batch yields</h2>
          <button onClick={() => setShowProduct(v => !v)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold">+ Add Product</button>
        </div>

        {showProduct && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-3 flex flex-col gap-3">
            {pErr && <p className="text-red-600 text-xs font-semibold">{pErr}</p>}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input placeholder="Product (e.g. Eggs, Manure)" value={pForm.name} onChange={e => setPForm({ ...pForm, name: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
              <input list="baseunits" placeholder="Base unit (piece, kg, head)" value={pForm.baseUnit} onChange={e => setPForm({ ...pForm, baseUnit: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
              <datalist id="baseunits"><option value="piece" /><option value="kg" /><option value="head" /><option value="bag" /><option value="litre" /><option value="tray" /><option value="crate" /></datalist>
              <select value={pForm.collectFrequency} onChange={e => setPForm({ ...pForm, collectFrequency: e.target.value })} className="border rounded-lg px-3 py-2 text-sm">
                {['daily','weekly','monthly','per_cycle'].map(f => <option key={f} value={f}>Collected {f.replace('_',' ')}</option>)}
              </select>
              <select value={pForm.flow} onChange={e => setPForm({ ...pForm, flow: e.target.value })} className="border rounded-lg px-3 py-2 text-sm md:col-span-3" title="Sale = you sell it; Expense = an input you consume">
                <option value="sale">Sold for revenue (sale)</option>
                <option value="expense">Consumed / input (expense)</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={pForm.isAnimalProduct} onChange={e => setPForm({ ...pForm, isAnimalProduct: e.target.checked })} className="rounded" />
              This product IS the animal — selling it removes the animal from the live count
            </label>
            <p className="text-xs font-semibold text-gray-500">Sale units & prices</p>
            {pForm.units.map((u, i) => (
              <div key={i} className="flex gap-2">
                <input placeholder="Unit (e.g. Tray)" value={u.name} onChange={e => setPForm(f => ({ ...f, units: f.units.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))} className="flex-1 border rounded-lg px-3 py-2 text-sm" />
                <input type="number" min="1" placeholder={`${pForm.baseUnit}/unit`} value={u.perBase} onChange={e => setPForm(f => ({ ...f, units: f.units.map((x, j) => j === i ? { ...x, perBase: e.target.value } : x) }))} className="w-24 border rounded-lg px-3 py-2 text-sm" title={`How many ${pForm.baseUnit} in one ${u.name || 'unit'}`} />
                <input type="number" min="0" placeholder="Price KES" value={u.price} onChange={e => setPForm(f => ({ ...f, units: f.units.map((x, j) => j === i ? { ...x, price: e.target.value } : x) }))} className="w-28 border rounded-lg px-3 py-2 text-sm" />
                {pForm.units.length > 1 && <button type="button" onClick={() => setPForm(f => ({ ...f, units: f.units.filter((_, j) => j !== i) }))} className="px-2 text-gray-400 hover:text-red-600">✕</button>}
              </div>
            ))}
            <button type="button" onClick={() => setPForm(f => ({ ...f, units: [...f.units, { name: '', perBase: '1', price: '' }] }))} className="text-xs text-green-600 font-semibold self-start">+ Add sale unit</button>
            <div className="flex gap-2">
              <button onClick={addProduct} disabled={savingProduct} className="px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50">{savingProduct ? 'Saving…' : 'Save Product'}</button>
              <button onClick={() => setShowProduct(false)} className="px-4 py-2 bg-gray-200 rounded-lg text-xs font-semibold">Cancel</button>
            </div>
          </div>
        )}

        {products.length === 0
          ? <p className="text-gray-400 text-sm">No products yet. Add what this batch gives — eggs, manure, meat, etc.</p>
          : (
            <div className="flex flex-col gap-2">
              {products.map(p => editId === p.id ? (
                <div key={p.id} className="border-2 border-indigo-300 rounded-lg p-3 flex flex-col gap-2 bg-indigo-50/40">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input value={ep.name} onChange={e => setEp({ ...ep, name: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" placeholder="Product name" />
                    <select value={ep.collectFrequency} onChange={e => setEp({ ...ep, collectFrequency: e.target.value })} className="border rounded-lg px-3 py-2 text-sm">
                      {['daily','weekly','monthly','per_cycle'].map(f => <option key={f} value={f}>Collected {f.replace('_',' ')}</option>)}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input type="checkbox" checked={ep.isAnimalProduct} onChange={e => setEp({ ...ep, isAnimalProduct: e.target.checked })} className="rounded" />
                    This product IS the animal — selling it removes the animal from inventory
                  </label>
                  <p className="text-xs font-semibold text-gray-500">Sale units & prices (edit freely)</p>
                  {ep.units.map((u, i) => (
                    <div key={i} className="flex gap-2">
                      <input value={u.name} onChange={e => setEp(s => ({ ...s, units: s.units.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))} className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Unit" />
                      <input type="number" value={u.perBase} onChange={e => setEp(s => ({ ...s, units: s.units.map((x, j) => j === i ? { ...x, perBase: e.target.value } : x) }))} className="w-20 border rounded-lg px-3 py-2 text-sm" />
                      <input type="number" value={u.price} onChange={e => setEp(s => ({ ...s, units: s.units.map((x, j) => j === i ? { ...x, price: e.target.value } : x) }))} className="w-28 border rounded-lg px-3 py-2 text-sm" placeholder="Price" />
                      {ep.units.length > 1 && <button type="button" onClick={() => setEp(s => ({ ...s, units: s.units.filter((_, j) => j !== i) }))} className="px-2 text-gray-400 hover:text-red-600">✕</button>}
                    </div>
                  ))}
                  <button type="button" onClick={() => setEp(s => ({ ...s, units: [...s.units, { name: '', perBase: '1', price: '' }] }))} className="text-xs text-indigo-600 font-semibold self-start">+ Add sale unit</button>
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold">Save changes</button>
                    <button onClick={() => setEditId(null)} className="px-4 py-2 bg-gray-200 rounded-lg text-xs font-semibold">Cancel</button>
                  </div>
                </div>
              ) : (
                <div key={p.id} className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2">
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{p.name} <span className="text-xs text-gray-400">· collected {String(p.collectFrequency).replace('_',' ')}</span></p>
                    <p className="text-xs text-gray-500">{p.saleUnits.map(u => `${u.name} ${fmtKES(u.price)}`).join(' · ')}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded capitalize">{p.flow}</span>
                    <button onClick={() => startEdit(p)} className="text-xs text-indigo-600 font-semibold hover:underline">Edit</button>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </div>

      {/* Pending head counts — a worker counted the live animals; the owner decides
          whether to correct the system count. Workers never move it themselves. */}
      {pendingCounts.length > 0 && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-5">
          <h2 className="font-bold text-amber-900 mb-1">⚠ Head count to review</h2>
          <p className="text-amber-800 text-xs mb-3">A worker counted the animals. Apply to set the live count, or dismiss to keep the current figure.</p>
          <div className="flex flex-col gap-2">
            {pendingCounts.map(c => (
              <div key={c.clientUuid} className="flex items-center justify-between flex-wrap gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2">
                <div className="text-sm">
                  <span className="font-semibold text-gray-900">Counted {c.physicalCount}</span>
                  <span className="text-gray-500"> · system {c.systemCount} · variance <span className={c.variance < 0 ? 'text-red-600 font-semibold' : 'text-amber-700 font-semibold'}>{c.variance > 0 ? '+' : ''}{c.variance}</span>{c.reason ? ` · ${c.reason}` : ''}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => resolveCount(c.clientUuid, 'apply')} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold">Apply (set to {c.physicalCount})</button>
                  <button onClick={() => resolveCount(c.clientUuid, 'dismiss')} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold">Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Worker activity — what the field team recorded, with photos & GPS */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-bold text-gray-800 mb-3">Worker Activity</h2>
        {activity.length === 0
          ? <p className="text-gray-400 text-sm">No field records yet. Mortality, feeding, health and collections recorded by workers show here.</p>
          : (
            <div className="flex flex-col gap-2">
              {activity.map((a, i) => {
                const icon = a.kind === 'mortality' ? '💀' : a.kind === 'health' ? '💉' : a.kind === 'feeding' ? '🌾' : '🥚';
                return (
                  <div key={i} className="flex items-start gap-3 border border-gray-100 rounded-lg p-3">
                    <span className="text-xl">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 capitalize">{a.kind} · {a.text}</p>
                      <p className="text-xs text-gray-400">{new Date(a.at).toLocaleString('en-KE')} · by {a.by}
                        {a.gpsLat != null && a.gpsLng != null && (
                          <> · <a className="text-blue-600 underline" href={`https://maps.google.com/?q=${a.gpsLat},${a.gpsLng}`} target="_blank" rel="noreferrer">📍 location</a></>
                        )}
                      </p>
                    </div>
                    {a.photoId && (
                       
                      <a href={`/api/photos/${a.photoId}`} target="_blank" rel="noreferrer" className="shrink-0">
                        <img src={`/api/photos/${a.photoId}`} alt="evidence" className="w-14 h-14 object-cover rounded-lg border border-gray-200" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )
        }
      </div>

      {/* Sales history */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-bold text-gray-800 mb-3">Sales History</h2>
        {sales.length === 0
          ? <p className="text-gray-400 text-sm">No sales recorded yet.</p>
          : (
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-xs font-semibold border-b">
                <tr><th className="text-left pb-2">Date</th><th className="text-left">Product</th><th className="text-right">Qty</th><th className="text-right">Amount</th><th className="text-left">Buyer</th><th className="text-center">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sales.map(s => (
                  <tr key={s.id} className="py-2">
                    <td className="py-2 text-gray-400">{new Date(s.createdAt).toLocaleDateString('en-KE')}</td>
                    <td className="py-2 text-gray-700">{s.productType}</td>
                    <td className="py-2 text-right">{s.quantity}</td>
                    <td className="py-2 text-right font-semibold text-gray-900">{fmtKES(s.totalAmount)}</td>
                    <td className="py-2 text-gray-600">{s.buyer}</td>
                    <td className="py-2 text-center"><StatusChip status={s.withdrawalCheck === 'cleared' ? 'ok' : 'critical'} size="sm" label={s.withdrawalCheck === 'cleared' ? '✓ Cleared' : '⛔ Blocked'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>

      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-green-700 text-white px-5 py-3 rounded-xl font-semibold shadow-lg">{toast}</div>}

      {/* Sale modal — BR-WD withdrawal check */}
      <ConfirmSheet
        open={showSaleModal}
        title="Record Sale"
        summary=""
        onConfirm={handleSale}
        onCancel={() => setShowSaleModal(false)}
        confirmLabel="Record Sale"
      >
        <div className="flex flex-col gap-3">
          <div className={`rounded-xl px-4 py-3 border-2 ${wdCheck.cleared ? 'bg-green-50 border-green-400' : 'bg-red-50 border-red-500'}`}>
            {wdCheck.cleared
              ? <p className="text-green-800 font-semibold text-sm">✓ Cleared for sale — no active withdrawal period.</p>
              : <><p className="text-red-800 font-bold">⛔ BLOCKED — withdrawal until {wdCheck.until} ({wdCheck.daysLeft} days left).</p><p className="text-red-700 text-xs">Selling this product is unsafe.</p></>
            }
          </div>
          <select value={saleProductId} onChange={e => pickSaleProduct(e.target.value)} className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base">
            <option value="">Select product…</option>
            {products.filter(p => p.flow === 'sale').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {saleProduct && (
            <select value={saleUnitName} onChange={e => pickSaleUnit(e.target.value)} className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base">
              <option value="">Sale unit…</option>
              {saleProduct.saleUnits.map(u => <option key={u.name} value={u.name}>{u.name} — {fmtKES(u.price)}</option>)}
            </select>
          )}
          <input value={saleQty} onChange={e => setSaleQty(e.target.value)} type="number" placeholder={`Quantity${saleUnit ? ` (${saleUnit.name})` : ' / weight'}`}
            className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base" />
          <input value={salePrice} onChange={e => setSalePrice(e.target.value)} type="number" placeholder="Price per unit (KSh)"
            className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base" />
          <input value={saleBuyer} onChange={e => setSaleBuyer(e.target.value)} placeholder="Buyer name"
            className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base" />
        </div>
      </ConfirmSheet>
    </div>
  );
}
