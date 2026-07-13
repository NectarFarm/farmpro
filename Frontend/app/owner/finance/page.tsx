'use client';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, getProducts } from '@/lib/api';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { Sale, Purchase, Batch, Product, BatchCostSummary, InventoryItem, Employee } from '@/lib/types';
import { StatusChip } from '@/components/worker/StatusChip';
import { daysUntilPayDay } from '@/lib/payroll';
import { Wallet, AlertTriangle, Bell } from 'lucide-react';
import { Pager } from '@/components/Pager';

const fmtKES = (n: number) => `KSh ${n.toLocaleString('en-KE')}`;
const EMPTY = { batchId: '', productId: '', unitName: '', quantity: '', unitPrice: '', buyer: '' };
const PAGE_SIZE = 20;

export default function FinancePage() {
  const { t } = useTranslation();
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tab, setTab] = useState<'sales'|'purchases'|'batchpl'>('sales');
  const [salesPage, setSalesPage] = useState(1);
  const [purchasesPage, setPurchasesPage] = useState(1);
  const [showSale, setShowSale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [avail, setAvail] = useState<{ basis: 'headcount' | 'harvested' | 'biomass'; available: number; produced?: number; sold?: number; avgWeightKg?: number } | null>(null);

  const [batchPL, setBatchPL] = useState<{ batch: Batch; cost: BatchCostSummary | null }[]>([]);

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payroll, setPayroll] = useState<{ fines: number; net: number; withSlip: number } | null>(null);
  // Per-employee payroll rows for this month (from GET /api/payroll) — used to build
  // an accurate monthly wage estimate below (see monthSalaries) instead of the
  // all-or-nothing payroll.net, which silently drops any employee payroll hasn't
  // been run for yet this month (e.g. a new hire added after "Run payroll" already ran).
  const [payrollEmployees, setPayrollEmployees] = useState<{ eligible: boolean; payslip: { net: number } | null; preview: { net: number } }[]>([]);
  const itemName = (id: string) => items.find(i => i.id === id)?.name ?? id;

  const reload = () => Promise.all([api.getSales(), api.getPurchases(), api.getBatches()]).then(([s,p,b]) => { setSales(s); setPurchases(p); setBatches(b); });
  useEffect(() => {
    reload(); api.getItems().then(setItems); api.getEmployees().then(setEmployees).catch(() => {});
    fetch(`/api/payroll?period=${new Date().toISOString().slice(0, 7)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null).then(d => { if (d?.summary) setPayroll(d.summary); if (d?.employees) setPayrollEmployees(d.employees); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!batches.length) { setBatchPL([]); return; }
    Promise.all(batches.map(async b => ({ batch: b, cost: await api.getCostSummary(b.id).catch(err => { console.error('Failed to load cost summary', err); return null; }) }))).then(setBatchPL);
  }, [batches]);

  const product = products.find(p => p.id === form.productId);
  const unit = product?.saleUnits.find(u => u.name === form.unitName);
  const total = (Number(form.quantity) || 0) * (Number(form.unitPrice) || 0);

  // When the batch changes, load its products (eggs/pork/manure…) and reset the rest.
  const onBatch = async (batchId: string) => {
    setForm({ ...EMPTY, batchId }); setAvail(null);
    try {
      setProducts(batchId ? await getProducts(batchId) : []);
    } catch (err) {
      console.error('Failed to load products', err);
      setProducts([]);
    }
  };
  const onProduct = (productId: string) => {
    const p = products.find(x => x.id === productId);
    const u = p?.saleUnits[0];
    setForm(f => ({ ...f, productId, unitName: u?.name ?? '', unitPrice: u ? String(u.price) : '' }));
    setAvail(null);
    if (p && form.batchId) {
      fetch(`/api/availability?batchId=${form.batchId}&productId=${encodeURIComponent(p.id)}`, { credentials: 'include' })
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
      await api.recordSale({
        batchId: form.batchId, productId: form.productId, productType: product?.name ?? 'produce',
        unitName: form.unitName, quantity: form.quantity, unitPrice: form.unitPrice, buyer: form.buyer,
      });
      setForm(EMPTY); setProducts([]); setShowSale(false); await reload();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const totalRevenue = sales.reduce((s,sl) => s + sl.totalAmount, 0);
  const totalCost = purchases.reduce((s,p) => s + p.totalCost, 0);

  // Rows come back id-ordered (not chronological — id is a random UUID), so sort
  // newest-first for display; paginate client-side to keep long histories usable.
  // getSales/getPurchases fetch with limit=0 (unbounded), so a farm with years of
  // history can mean a genuinely large array — memoize instead of re-sorting on
  // every unrelated re-render (typing in the sale form above, tab switches, etc).
  const sortedSales = useMemo(() => [...sales].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [sales]);
  const salesTotalPages = Math.max(1, Math.ceil(sortedSales.length / PAGE_SIZE));
  const safeSalesPage = Math.min(salesPage, salesTotalPages);
  const pagedSales = sortedSales.slice((safeSalesPage - 1) * PAGE_SIZE, safeSalesPage * PAGE_SIZE);

  const sortedPurchases = useMemo(() => [...purchases].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [purchases]);
  const purchasesTotalPages = Math.max(1, Math.ceil(sortedPurchases.length / PAGE_SIZE));
  const safePurchasesPage = Math.min(purchasesPage, purchasesTotalPages);
  const pagedPurchases = sortedPurchases.slice((safePurchasesPage - 1) * PAGE_SIZE, safePurchasesPage * PAGE_SIZE);

  // This-month budget: revenue in vs expenses out, for the current month.
  // Expenses = stock purchases this month + the monthly wage bill (salaries accrue
  // every month regardless of which day they're paid).
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const inMonth = (d?: string) => (d ?? '').slice(0, 7) === thisMonth;
  const monthSales = sales.filter(s => inMonth(s.createdAt)).reduce((a, s) => a + s.totalAmount, 0);
  const monthFines = payroll?.fines ?? 0;                 // staff fines are farm income
  const monthRevenue = monthSales + monthFines;
  const monthPurchases = purchases.filter(p => inMonth(p.createdAt)).reduce((a, p) => a + p.totalCost, 0);
  // Per-employee hybrid: the actual run/paid net for anyone payroll has already been
  // run for this month, and a live preview for anyone eligible but not yet processed
  // (e.g. hired after "Run payroll" already ran) — so nobody is silently dropped.
  const monthSalaries = payrollEmployees
    .filter(e => e.eligible)
    .reduce((s, e) => s + (e.payslip ? e.payslip.net : e.preview.net), 0);
  const monthExpenses = monthPurchases + monthSalaries;
  const monthNet = monthRevenue - monthExpenses;
  const monthLabel = now.toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });

  // Soonest upcoming pay day across paid, active staff → a reminder (no auto-posting).
  const paidStaff = employees.filter(e => e.active && (e.salary ?? 0) > 0 && e.payDay);
  const nextPayInDays = paidStaff.reduce((min, e) => Math.min(min, daysUntilPayDay(e.payDay, now)), Infinity);
  const payReminder = paidStaff.length > 0 && nextPayInDays <= 5
    ? (nextPayInDays === 0 ? `Salaries due today: ${fmtKES(monthSalaries)}` : `Salaries due in ${nextPayInDays} day${nextPayInDays === 1 ? '' : 's'}: ${fmtKES(monthSalaries)}`)
    : '';

  return (
    <div className="p-6 flex flex-col gap-6 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-green-50 flex items-center justify-center">
            <Wallet className="w-6 h-6 text-green-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('finance')}</h1>
            <p className="text-gray-500 text-sm">Sales, purchases, monthly budget, and profit &amp; loss per batch.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowSale(v => !v)} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm">+ {t('recordSale')}</button>
        </div>
      </div>

      {showSale && (
        <form onSubmit={createSale} className="bg-white border border-green-300 rounded-xl p-5 flex flex-col gap-3">
          <h3 className="font-bold text-gray-800">{t('recordSale')}</h3>
          {err && <p className="text-red-600 bg-red-50 rounded-lg px-3 py-2 text-sm font-semibold">{err}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select required value={form.batchId} onChange={e => onBatch(e.target.value)} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Select batch…</option>
              {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select required value={form.productId} onChange={e => onProduct(e.target.value)} disabled={!form.batchId} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm disabled:opacity-50">
              <option value="">{form.batchId ? (products.length ? t('selectProduct') : t('noProductsForBatch')) : t('pickBatchFirst')}</option>
              {products.filter(p => p.flow === 'sale').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select required value={form.unitName} onChange={e => onUnit(e.target.value)} disabled={!product} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm disabled:opacity-50">
              <option value="">Sale unit…</option>
              {product?.saleUnits.map(u => <option key={u.name} value={u.name}>{u.name} — {fmtKES(u.price)}</option>)}
            </select>
            <input type="number" min="0" placeholder={`How many${unit ? ` (${unit.name})` : ''}`} required value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input type="number" min="0" placeholder={`Price each${unit ? ` (per ${unit.name})` : ''} (KSh)`} required value={form.unitPrice} onChange={e => setForm({ ...form, unitPrice: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input placeholder={t('buyer')} value={form.buyer} onChange={e => setForm({ ...form, buyer: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          {avail && product && (
            <p className={`flex items-start gap-1.5 text-sm rounded-lg px-3 py-2 ${overSell ? 'bg-red-50 text-red-700 font-semibold' : 'bg-gray-50 text-gray-600'}`}>
              {overSell && <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
              <span>
                {avail.basis === 'headcount'
                  ? (overSell
                      ? `Only ${avail.available} ${product.baseUnit} left in this batch — you're trying to sell ${sellingBase}. Record mortalities or check the live count.`
                      : `${avail.available} live ${product.baseUnit} in this batch${sellingBase > 0 ? ` · this sale removes ${sellingBase}, leaving ${avail.available - sellingBase}` : ''}`)
                  : avail.basis === 'biomass'
                  ? (overSell
                      ? `Only about ${avail.available} ${product.baseUnit} of live ${product.name} here (≈ live count × ${avail.avgWeightKg} ${product.baseUnit}) — you're trying to sell ${sellingBase}.`
                      : `≈ ${avail.available} ${product.baseUnit} of live ${product.name} sellable (live animals × ${avail.avgWeightKg} ${product.baseUnit} avg). Record a weight sample to refine it.`)
                  : (overSell
                      ? `Only ${avail.available} ${product.baseUnit} available — you're trying to sell ${sellingBase}. Record the collection first.`
                      : `${avail.available} ${product.baseUnit} available to sell (collected ${avail.produced}, sold ${avail.sold})${sellingBase > 0 ? ` · this sale = ${sellingBase} ${product.baseUnit}` : ''}`)}
              </span>
            </p>
          )}
          {total > 0 && <p className="text-sm text-gray-600">Total: <span className="font-bold text-green-700">{fmtKES(total)}</span></p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving || overSell} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">{saving ? t('saving') : t('saveSale')}</button>
            <button type="button" onClick={() => setShowSale(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">Cancel</button>
          </div>
        </form>
      )}

      {/* This-month budget — expenses & revenue for the current month */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-800 text-sm">Budget · {monthLabel}</h2>
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${monthNet >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            {monthNet >= 0 ? t('surplus') : t('deficit')} {fmtKES(monthNet)}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-xs text-gray-500">{t('revenueIn')}</p>
            <p className="text-xl font-bold text-green-700">{fmtKES(monthRevenue)}</p>
            {monthFines > 0 && <p className="text-[11px] text-gray-400">incl. {fmtKES(monthFines)} staff fines</p>}
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500">{t('expensesOut')}</p>
            <p className="text-xl font-bold text-red-700">{fmtKES(monthExpenses)}</p>
            <p className="text-[11px] text-gray-400">{fmtKES(monthPurchases)} stock · {fmtKES(monthSalaries)} salaries</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500">{t('netThisMonth')}</p>
            <p className={`text-xl font-bold ${monthNet >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmtKES(monthNet)}</p>
          </div>
        </div>
        {payReminder && (
          <div className="mt-3 flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-800 text-xs font-semibold"><Bell className="w-3.5 h-3.5 shrink-0" /> {payReminder}</div>
        )}
      </div>

      {/* All-time summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
        {[{key:'sales',l:t('sales')},{key:'purchases',l:t('purchases')},{key:'batchpl',l:`${t('batch')} P&L`}].map(tabItem => (
          <button key={tabItem.key} onClick={() => setTab(tabItem.key as typeof tab)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab === tabItem.key ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {tabItem.l}
          </button>
        ))}
      </div>

      {tab === 'sales' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs font-semibold">
                <tr><th className="px-4 py-3 text-left">{t('date')}</th><th className="px-3 py-3 text-left">{t('product')}</th><th className="px-3 py-3 text-right">{t('qty')}</th><th className="px-3 py-3 text-right">{t('amount')}</th><th className="px-3 py-3 text-left hidden md:table-cell">{t('buyer')}</th>        <th className="px-3 py-3 text-center">{t('wdCheck')}</th><th className="px-3 py-3 text-center">{t('status')}</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagedSales.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-400 text-xs">{new Date(s.createdAt).toLocaleDateString('en-KE')}</td>
                    <td className="px-3 py-3 font-medium text-gray-900">{s.productType}</td>
                    <td className="px-3 py-3 text-right">{s.quantity}</td>
                    <td className="px-3 py-3 text-right font-bold text-gray-900">{fmtKES(s.totalAmount)}</td>
                    <td className="px-3 py-3 text-gray-600 hidden md:table-cell">{s.buyer}</td>
                    <td className="px-3 py-3 text-center">
                      <StatusChip status={s.withdrawalCheck === 'cleared' ? 'ok' : 'critical'} size="sm" label={s.withdrawalCheck === 'cleared' ? 'Cleared' : 'Blocked'} />
                    </td>
                    <td className="px-3 py-3 text-center"><span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs">{s.status}</span></td>
                  </tr>
                ))}
                {sales.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No sales recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
          {salesTotalPages > 1 && (
            <div className="py-3 border-t border-gray-100">
              <Pager page={safeSalesPage} totalPages={salesTotalPages} onPageChange={setSalesPage} prevLabel={t('prev')} nextLabel={t('next')} />
            </div>
          )}
        </div>
      )}

      {tab === 'purchases' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs font-semibold">
                <tr><th className="px-4 py-3 text-left">{t('date')}</th><th className="px-3 py-3 text-left">{t('item')}</th><th className="px-3 py-3 text-left hidden md:table-cell">{t('supplier')}</th><th className="px-3 py-3 text-right">{t('qty')}</th><th className="px-3 py-3 text-right">{t('unitCost')}</th><th className="px-3 py-3 text-right">{t('total')}</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagedPurchases.map(p => (
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
          {purchasesTotalPages > 1 && (
            <div className="py-3 border-t border-gray-100">
              <Pager page={safePurchasesPage} totalPages={purchasesTotalPages} onPageChange={setPurchasesPage} prevLabel={t('prev')} nextLabel={t('next')} />
            </div>
          )}
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
