'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { api, getCumulativeChartData, getProducts, createProduct, updateProduct } from '@/lib/api';
import type { Batch, BatchCostSummary, Sale, Product } from '@/lib/types';
import dynamic from 'next/dynamic';
import { ConfirmSheet } from '@/components/worker/ConfirmSheet';
import { StatusChip } from '@/components/worker/StatusChip';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TableToolbar } from '@/components/TableToolbar';
import { Pager } from '@/components/Pager';
import { useTableFilter } from '@/hooks/useTableFilter';
import { headNoun, groupNoun } from '@/lib/species';
import {
  Sprout, Settings, X, AlertTriangle, Check, Skull, Syringe, Wheat, Egg, type LucideIcon,
} from 'lucide-react';

const chartLoading = () => <div className="h-64 rounded-xl bg-gray-100 animate-pulse" />;
const CostDonut = dynamic(() => import('./BatchCharts').then(m => m.CostDonut), { ssr: false, loading: chartLoading });
const CumulativeChart = dynamic(() => import('./BatchCharts').then(m => m.CumulativeChart), { ssr: false, loading: chartLoading });

const ACTIVITY_ICON: Record<string, LucideIcon> = { mortality: Skull, health: Syringe, feeding: Wheat };
const activityIcon = (kind: string): LucideIcon => ACTIVITY_ICON[kind] ?? Egg;

const fmtKES = (n: number) => `KSh ${Math.abs(n).toLocaleString('en-KE')}`;

export default function BatchDetailPage() {
  const { t } = useTranslation();
  const { batchId } = useParams<{ batchId: string }>();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [cost, setCost] = useState<BatchCostSummary | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [saleQty, setSaleQty] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [saleBuyer, setSaleBuyer] = useState('');
  const [toast, setToast] = useState('');
  const [toastWarn, setToastWarn] = useState(false);
  const showToast = (msg: string, warn = false) => { setToast(msg); setToastWarn(warn); };
  const [chartData, setChartData] = useState<{ day: number; cost: number; revenue: number }[]>([]);
  const [, setSaving] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [showProduct, setShowProduct] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [pErr, setPErr] = useState('');
  const [pForm, setPForm] = useState({ name: '', baseUnit: 'unit', collectFrequency: 'per_cycle', flow: 'sale', isAnimalProduct: false, units: [{ name: '', perBase: '1', price: '' }] });
  const [saleProductId, setSaleProductId] = useState('');
  const [saleUnitName, setSaleUnitName] = useState('');
  const [avail, setAvail] = useState<{ basis: 'headcount' | 'harvested' | 'biomass'; available: number; produced?: number; sold?: number; avgWeightKg?: number } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [ep, setEp] = useState<{ name: string; collectFrequency: string; flow: string; units: { name: string; perBase: string; price: string }[]; isAnimalProduct: boolean }>({ name: '', collectFrequency: 'per_cycle', flow: 'sale', units: [], isAnimalProduct: false });
  const [activity, setActivity] = useState<{ kind: string; at: string; by: string; text: string; photoId: string | null; gpsLat: number | null; gpsLng: number | null }[]>([]);
  const [pendingCounts, setPendingCounts] = useState<{ clientUuid: string; physicalCount: number; systemCount: number; variance: number; reason: string | null; capturedAt: string }[]>([]);
  type Life = { stage: string; stageEnteredAt: string | null; age: number; stages: { name: string; startDay: number }[]; due: { due: boolean; nextStage: string | null; daysRemaining: number; overdueDays: number }; unitId: string; units: { id: string; name: string }[]; events: { fromStage: string | null; toStage: string; fromUnitId: string | null; toUnitId: string | null; qtyBefore: number | null; qtyAfter: number | null; note: string | null; at: string }[] };
  const [life, setLife] = useState<Life | null>(null);
  const [showAdvance, setShowAdvance] = useState(false);
  const [adv, setAdv] = useState({ toStage: '', toUnitId: '', newQty: '', note: '' });
  const [advErr, setAdvErr] = useState('');
  const [savingBatch, setSavingBatch] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [wdCheck, setWdCheck] = useState<{ cleared: boolean; until: string | null; daysLeft: number } | null>(null);
  const [wdError, setWdError] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; body: string; danger?: boolean; onConfirm: () => void } | null>(null);
  const [deleteBatchTyped, setDeleteBatchTyped] = useState('');
  const [showDeleteBatch, setShowDeleteBatch] = useState(false);

  const reload = () => {
    setLoadError('');
    Promise.all([api.getBatch(batchId), api.getCostSummary(batchId), api.getSales()]).then(([b,c,s]) => {
      setBatch(b); setCost(c); setSales(s.filter(sl => sl.batchId === batchId));
    }).catch((e) => setLoadError((e as Error).message || 'Failed to load batch'));
    getCumulativeChartData(batchId).then(setChartData).catch(() => {});
    getProducts(batchId).then(setProducts).catch(() => {});
    fetch(`/api/batch-activity?batchId=${encodeURIComponent(batchId)}`, { credentials: 'include' }).then(r => r.ok ? r.json() : { data: [] }).then(d => setActivity(Array.isArray(d) ? d : d.data ?? [])).catch(() => {});
    fetch('/api/physical-counts', { credentials: 'include' }).then(r => r.ok ? r.json() : [])
      .then((cs: { batchId: string }[]) => setPendingCounts(cs.filter(c => c.batchId === batchId) as never)).catch(() => {});
    fetch(`/api/batches/lifecycle?batchId=${encodeURIComponent(batchId)}`, { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(setLife).catch(() => {});
  };

  const loadWithdrawal = () => {
    setWdError('');
    fetch(`/api/withdrawal-check?batchId=${encodeURIComponent(batchId)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load withdrawal status')))
      .then(setWdCheck)
      .catch((e) => setWdError((e as Error).message || 'Failed to load withdrawal status'));
  };

  // Open the Advance/Move sheet with the next stage + current unit/qty prefilled.
  const openAdvance = () => {
    if (!life) return;
    setAdv({ toStage: life.due.nextStage ?? life.stage, toUnitId: life.unitId, newQty: '', note: '' });
    setAdvErr(''); setShowAdvance(true);
  };
  const submitAdvance = async () => {
    setAdvErr('');
    try {
      const res = await fetch('/api/batches/advance', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, toStage: adv.toStage, toUnitId: adv.toUnitId || undefined, newQty: adv.newQty !== '' ? Number(adv.newQty) : undefined, note: adv.note || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed');
      setShowAdvance(false); reload();
    } catch (e) { setAdvErr((e as Error).message); }
  };

  // Owner reconciles a worker head count: apply it to the live count, or dismiss it.
  const resolveCount = async (id: string, action: 'apply' | 'dismiss') => {
    try {
      const res = await fetch('/api/physical-counts', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to update count');
      reload();
      showToast(action === 'apply' ? t('headCountApplied') : t('countDismissed'));
    } catch (e) {
      showToast((e as Error).message, true);
    }
    setTimeout(() => setToast(''), 3500);
  };

  const startEdit = (p: Product) => {
    setEditId(p.id);
    setEp({ name: p.name, collectFrequency: String(p.collectFrequency), flow: String(p.flow), units: p.saleUnits.map(u => ({ name: u.name, perBase: String(u.perBase), price: String(u.price) })), isAnimalProduct: p.isAnimalProduct ?? false });
  };
  const saveEdit = async () => {
    if (!editId) return;
    try {
      const saleUnits = ep.units.filter(u => u.name).map(u => ({ name: u.name, perBase: Number(u.perBase) || 1, price: Number(u.price) || 0 }));
      await updateProduct(editId, { name: ep.name, collectFrequency: ep.collectFrequency, saleUnits, isAnimalProduct: ep.isAnimalProduct });
      setEditId(null); getProducts(batchId).then(setProducts).catch(err => console.error('Failed to reload products', err));
      showToast(t('changesSaved'));
    } catch (e) {
      showToast((e as Error).message, true);
    }
    setTimeout(() => setToast(''), 3500);
  };

  const doDeleteProduct = async (id: string) => {
    try {
      const res = await fetch(`/api/products?id=${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Delete failed');
      getProducts(batchId).then(setProducts).catch(err => console.error('Failed to reload products', err));
      showToast(t('productDeleted'));
    } catch (e) { showToast((e as Error).message, true); }
    setTimeout(() => setToast(''), 3500);
  };
  const deleteProduct = (id: string, name: string) => {
    setConfirmDialog({
      title: t('deleteProduct'),
      body: t('confirmDeleteProduct', { name }),
      danger: true,
      onConfirm: () => { setConfirmDialog(null); doDeleteProduct(id); },
    });
  };

  const doCloseBatch = async () => {
    if (!batch) return;
    setSavingBatch(true);
    try {
      const res = await fetch(`/api/data/batches?id=${encodeURIComponent(batch.id)}&action=close`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Close failed');
      showToast(t('batchClosed'));
      reload();
    } catch (e) { showToast((e as Error).message, true); }
    finally { setSavingBatch(false); setTimeout(() => setToast(''), 3500); }
  };
  const closeBatch = () => {
    if (!batch) return;
    setConfirmDialog({
      title: t('closeBatch'),
      body: t('confirmCloseBatch', { name: batch.name, qty: batch.currentQty }),
      onConfirm: () => { setConfirmDialog(null); doCloseBatch(); },
    });
  };

  const doDeleteBatch = async () => {
    if (!batch) return;
    setShowDeleteBatch(false); setDeleteBatchTyped('');
    setSavingBatch(true);
    try {
      const res = await fetch(`/api/data/batches?id=${encodeURIComponent(batch.id)}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) {
        if (data.error && data.error.includes('Close')) {
          showToast(t('cannotDeleteBatchHasData'));
        } else {
          throw new Error(data.error || 'Delete failed');
        }
      } else {
        showToast(data.closed ? t('batchClosed') : t('batchDeleted'));
        window.location.href = '/owner/farm';
        return;
      }
    } catch (e) { showToast((e as Error).message, true); }
    finally { setSavingBatch(false); setTimeout(() => setToast(''), 3500); }
  };

  const addProduct = async () => {
    setSavingProduct(true); setPErr('');
    try {
      const saleUnits = pForm.units.filter(u => u.name && u.price !== '').map(u => ({ name: u.name, perBase: Number(u.perBase) || 1, price: Number(u.price) || 0 }));
      if (!pForm.name || saleUnits.length === 0) throw new Error('Enter a name and at least one sale unit with a price');
      await createProduct({ batchId, name: pForm.name, baseUnit: pForm.baseUnit, collectFrequency: pForm.collectFrequency, flow: pForm.flow, isAnimalProduct: pForm.isAnimalProduct, saleUnits });
      setPForm({ name: '', baseUnit: 'unit', collectFrequency: 'per_cycle', flow: 'sale', isAnimalProduct: false, units: [{ name: '', perBase: '1', price: '' }] });
      setShowProduct(false); getProducts(batchId).then(setProducts).catch(err => console.error('Failed to reload products', err));
    } catch (e) { setPErr((e as Error).message); } finally { setSavingProduct(false); }
  };

  useEffect(() => { if (batchId) { reload(); loadWithdrawal(); } }, [batchId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) {
    return (
      <div className="p-6 flex flex-col items-center gap-3 text-center">
        <p className="text-red-600 font-semibold">{loadError}</p>
        <button onClick={reload} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90">{t('retry')}</button>
      </div>
    );
  }

  if (!batch) return <div className="p-6 text-gray-400">{t('loading')}</div>;

  const days = Math.floor((Date.now() - new Date(batch.acquiredDate).getTime()) / 86400000);

  const costBreakdown = cost ? [
    { name: t('costFeed'), value: cost.feedCost, color: '#16a34a' },
    { name: t('costStock'), value: cost.acquisitionCost, color: '#2563eb' },
    { name: t('costHealth'), value: cost.healthCost, color: '#7c3aed' },
    { name: t('costLabor'), value: cost.laborCost, color: '#d97706' },
    { name: t('costSalaries'), value: cost.salaryCost ?? 0, color: '#db2777' },
    { name: t('costOther'), value: cost.overheadCost, color: '#6b7280' },
  ].filter(d => d.value > 0) : [];

  const saleProduct = products.find(p => p.id === saleProductId);
  const saleUnit = saleProduct?.saleUnits.find(u => u.name === saleUnitName);
  const saleProductType = () => saleProduct?.name ?? (batch?.species || 'produce');
  const pickSaleProduct = (id: string) => {
    const p = products.find(x => x.id === id); const u = p?.saleUnits[0];
    setSaleProductId(id); setSaleUnitName(u?.name ?? ''); if (u) setSalePrice(String(u.price));
    setAvail(null);
    if (p && batchId) {
      fetch(`/api/availability?batchId=${encodeURIComponent(batchId)}&productId=${encodeURIComponent(p.id)}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null).then(setAvail).catch(() => {});
    }
  };
  const pickSaleUnit = (name: string) => {
    const u = saleProduct?.saleUnits.find(x => x.name === name);
    setSaleUnitName(name); if (u) setSalePrice(String(u.price));
  };

  // Base units this entry would sell (quantity × the unit's perBase) — same check finance/page.tsx enforces.
  const sellingBase = (Number(saleQty) || 0) * (saleUnit?.perBase ?? 1);
  const overSell = avail != null && sellingBase > avail.available + 1e-6;

  const handleSale = async () => {
    if (!batch) return;
    const qtyNum = Number(saleQty);
    const priceNum = Number(salePrice);
    if (!saleQty || Number.isNaN(qtyNum) || qtyNum <= 0) { showToast('Enter a valid quantity', true); setTimeout(() => setToast(''), 2500); return; }
    if (!salePrice || Number.isNaN(priceNum) || priceNum < 0) { showToast('Enter a valid price', true); setTimeout(() => setToast(''), 2500); return; }
    if (overSell) { showToast(`Only ${avail?.available ?? 0} available — reduce quantity`, true); setTimeout(() => setToast(''), 2500); return; }
    if (wdCheck && !wdCheck.cleared) { showToast(t('saleUnsafe'), true); setTimeout(() => setToast(''), 2500); return; }
    setSaving(true);
    try {
      await api.recordSale({ batchId, productId: saleProductId, productType: saleProductType(), unitName: saleUnitName, quantity: qtyNum, unitPrice: priceNum, buyer: saleBuyer });
      setShowSaleModal(false); setSaleQty(''); setSalePrice(''); setSaleBuyer(''); setAvail(null);
      showToast(t('saleRecorded')); reload();
    } catch (e) { showToast((e as Error).message, true); }
    finally { setSaving(false); setTimeout(() => setToast(''), 2500); }
  };

  const { search: salesSearch, setSearch: setSalesSearch, page: salesPage, setPage: setSalesPage, totalPages: salesTotalPages, paged: pagedSales } = useTableFilter(sales, {
    searchFields: (s) => `${s.productType} ${s.buyer}`,
    sortFn: (a, b) => b.createdAt.localeCompare(a.createdAt),
  });

  return (
    <div className="p-6 flex flex-col gap-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/owner/farm" className="hover:underline">{t('farm')}</Link>
        <span>›</span>
        <span className="text-gray-900 font-semibold">{batch.name}</span>
      </div>

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-xl px-6 py-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{batch.name}</h1>
            <p className="text-gray-500 text-sm">{t('day')} {days} · {batch.species} · {batch.breed ?? ''}</p>
            <p className="text-gray-400 text-xs">{t('source')}: {batch.source} · {t('initialQty')}: {batch.initialQty}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <StatusChip status={batch.status === 'ACTIVE' ? 'ok' : 'offline'} label={batch.status} />
            {batch.status === 'ACTIVE' && (
              <>
                <button onClick={() => setShowSaleModal(true)}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90">
                  {t('recordSale')}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-600 rounded-lg font-semibold text-sm hover:bg-gray-50">
                      <Settings className="w-4 h-4" /> {t('manage')}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[200px] p-0">
                    <DropdownMenuItem onClick={closeBatch} disabled={savingBatch}
                      className="px-4 py-2.5 text-sm text-gray-700 font-semibold disabled:opacity-50 rounded-none flex-col items-start gap-0">
                      {t('closeBatch')}
                      <span className="block text-xs text-gray-400 font-normal">{t('closeBatchDesc')}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setDeleteBatchTyped(''); setShowDeleteBatch(true); }} disabled={savingBatch}
                      variant="destructive"
                      className="px-4 py-2.5 text-sm font-semibold disabled:opacity-50 border-t border-gray-100 rounded-none flex-col items-start gap-0">
                      {t('deleteBatch')}
                      <span className="block text-xs text-gray-400 font-normal">{t('deleteBatchDesc')}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>

        {/* KPI row */}
        {cost && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 pt-4 border-t border-gray-100">
            {[
              { label: t('currentQty'), value: String(batch.currentQty) },
              { label: t('fcr'), value: cost.fcr ? `${cost.fcr}` : '—', good: cost.fcr ? cost.fcr <= 2.8 : null },
              { label: t('mortalityRate'), value: cost.mortalityPct ? `${cost.mortalityPct}%` : '—', bad: cost.mortalityPct ? cost.mortalityPct > 5 : false },
              { label: cost.outputUnit === 'eggs' ? t('costPerUnit') : t('costPerUnit'), value: cost.costPerUnit ? fmtKES(cost.costPerUnit) : '—' },
              { label: t('grossMargin'), value: fmtKES(cost.grossMargin), good: cost.grossMargin > 0, bad: cost.grossMargin < 0 },
            ].map(k => (
              <div key={k.label} className="text-center">
                <p className="text-xs text-gray-400">{k.label}</p>
                <p className={`text-lg font-bold ${k.bad ? 'text-destructive' : k.good ? 'text-success' : 'text-gray-900'}`}>{k.value}</p>
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
            <h2 className="font-bold text-gray-800 mb-2">{t('costBreakdown')}</h2>
            <p className="text-xs text-gray-400 mb-3">{t('totalCost')}: {fmtKES(cost.totalCost)}</p>
            <CostDonut data={costBreakdown} />
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
          <h2 className="font-bold text-gray-800 mb-1">{t('cumulativeCostVsRevenue')}</h2>
          <p className="text-xs text-gray-400 mb-3">{t('breakEven')}</p>
          <CumulativeChart data={chartData} />
        </div>
      </div>

      {/* Break-even on remaining stock — per-head valuation (current position) */}
      {cost && (cost.remainingQty ?? 0) > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-400">{t('costPerSurviving')} {headNoun(batch.species, 1)}</p>
            <p className="text-2xl font-bold text-gray-900">{fmtKES(cost.costPerBird ?? 0)}</p>
            <p className="text-xs text-gray-400">{fmtKES(cost.totalCost)} \u00f7 {cost.survivors ?? 0} {t('survivors')}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-400">{t('revenueReceivedSoFar')}</p>
            <p className="text-2xl font-bold text-success">{fmtKES(cost.totalRevenue)}</p>
            <p className="text-xs text-gray-400">{cost.soldHead ?? 0} {headNoun(batch.species)} {t('sold')}</p>
          </div>
          <div className={`bg-white border rounded-xl p-4 text-center ${cost.grossMargin < 0 ? 'border-warning/40' : 'border-success/30'}`}>
            <p className="text-xs text-gray-400">
              {cost.grossMargin < 0 ? `${t('breakEven')} per ${headNoun(batch.species, 1)}` : t('alreadyInProfit')}
            </p>
            <p className={`text-2xl font-bold ${cost.grossMargin < 0 ? 'text-warning-foreground' : 'text-success'}`}>
              {cost.grossMargin < 0
                ? fmtKES(cost.breakEvenPricePerRemaining ?? 0)
                : `+${fmtKES(cost.grossMargin)}`}
            </p>
            <p className="text-xs text-gray-400">
              {cost.grossMargin < 0
                ? t('needMoreFrom', { amount: fmtKES(Math.abs(cost.grossMargin)), qty: cost.remainingQty ?? 0, noun: headNoun(batch.species) })
                : t('alreadyAhead', { amount: fmtKES(cost.grossMargin) })}
            </p>
          </div>
        </div>
      )}

      {/* Per-batch analysis section (species-aware wording) */}
      {cost && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-bold text-gray-800 mb-3">{groupNoun(batch.species)} {t('details')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">{t('mortalityRate')}</p>
              <p className={`text-lg font-bold ${(cost.mortalityPct ?? 0) > 5 ? 'text-red-600' : 'text-gray-900'}`}>
                {cost.mortalityPct ? `${cost.mortalityPct}%` : '0%'}
              </p>
              <p className="text-xs text-gray-400">
                {t('ofCountDied', { count: cost.deaths ?? 0, total: batch.initialQty })}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">{t('survivalRate')}</p>
              <p className="text-lg font-bold text-gray-900">
                {batch.initialQty > 0 ? (((cost.survivors ?? 0) / batch.initialQty) * 100).toFixed(0) : 0}%
              </p>
              <p className="text-xs text-gray-400">{t('ofCountSurvived', { count: cost.survivors ?? 0, total: batch.initialQty })}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">{t('feedConversion')}</p>
              <p className={`text-lg font-bold ${cost.fcr && cost.fcr > 2.8 ? 'text-amber-600' : 'text-gray-900'}`}>
                {cost.fcr ?? '—'}
              </p>
              <p className="text-xs text-gray-400">{cost.outputUnit === 'eggs' ? t('fcrPerDozen') : t('fcrPerKg')}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">{t('onFarmNow')}</p>
              <p className="text-lg font-bold text-gray-900">{cost.currentQty}</p>
              <p className="text-xs text-gray-400">{t('countSoldAndDied', { sold: cost.soldHead ?? 0, died: cost.deaths ?? 0 })}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">{t('acquisitionCost')} / {headNoun(batch.species, 1)}</p>
              <p className="text-lg font-bold text-gray-900">
                {fmtKES(batch.initialQty > 0 ? Math.round(batch.acquisitionCost / batch.initialQty) : 0)}
              </p>
              <p className="text-xs text-gray-400">{t('initialPurchasePrice')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Products this batch yields */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-800">{t('productsThisBatchYields')}</h2>
          <button onClick={() => setShowProduct(v => !v)} className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90">+ {t('addProduct')}</button>
        </div>

        {showProduct && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-3 flex flex-col gap-3">
            {pErr && <p className="text-red-600 text-xs font-semibold">{pErr}</p>}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input placeholder={t('productNamePlaceholder')} value={pForm.name} onChange={e => setPForm({ ...pForm, name: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
              <input list="baseunits" placeholder={t('baseUnitPlaceholder')} value={pForm.baseUnit} onChange={e => setPForm({ ...pForm, baseUnit: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
              <datalist id="baseunits"><option value="piece" /><option value="kg" /><option value="head" /><option value="bag" /><option value="litre" /><option value="tray" /><option value="crate" /></datalist>
              <select value={pForm.collectFrequency} onChange={e => setPForm({ ...pForm, collectFrequency: e.target.value })} className="border rounded-lg px-3 py-2 text-sm">
                {['daily','weekly','monthly','per_cycle'].map(f => <option key={f} value={f}>Collected {f.replace('_',' ')}</option>)}
              </select>
              <select value={pForm.flow} onChange={e => setPForm({ ...pForm, flow: e.target.value })} className="border rounded-lg px-3 py-2 text-sm md:col-span-3" title={t('soldForRevenue')}>
                <option value="sale">{t('soldForRevenue')}</option>
                <option value="expense">{t('consumedInput')}</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={pForm.isAnimalProduct} onChange={e => setPForm({ ...pForm, isAnimalProduct: e.target.checked })} className="rounded" />
              {t('productIsAnimal')}
            </label>
            <p className="text-xs font-semibold text-gray-500">{t('saleUnitsLabel')}</p>
            {pForm.units.map((u, i) => (
              <div key={i} className="flex gap-2">
                <input placeholder={t('unitPlaceholder')} value={u.name} onChange={e => setPForm(f => ({ ...f, units: f.units.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))} className="flex-1 border rounded-lg px-3 py-2 text-sm" />
                <input type="number" min="1" placeholder={`${pForm.baseUnit}/unit`} value={u.perBase} onChange={e => setPForm(f => ({ ...f, units: f.units.map((x, j) => j === i ? { ...x, perBase: e.target.value } : x) }))} className="w-24 border rounded-lg px-3 py-2 text-sm" title={`How many ${pForm.baseUnit} in one ${u.name || 'unit'}`} />
                <input type="number" min="0" placeholder="Price KES" value={u.price} onChange={e => setPForm(f => ({ ...f, units: f.units.map((x, j) => j === i ? { ...x, price: e.target.value } : x) }))} className="w-28 border rounded-lg px-3 py-2 text-sm" />
                {pForm.units.length > 1 && <button type="button" onClick={() => setPForm(f => ({ ...f, units: f.units.filter((_, j) => j !== i) }))} className="px-2 text-gray-400 hover:text-red-600"><X className="w-4 h-4" /></button>}
              </div>
            ))}
            <button type="button" onClick={() => setPForm(f => ({ ...f, units: [...f.units, { name: '', perBase: '1', price: '' }] }))} className="text-xs text-primary font-semibold self-start">{t('addSaleUnit')}</button>
            <div className="flex gap-2">
              <button onClick={addProduct} disabled={savingProduct} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 disabled:opacity-50">{savingProduct ? t('saving') : t('saveProduct')}</button>
              <button onClick={() => setShowProduct(false)} className="px-4 py-2 bg-gray-200 rounded-lg text-xs font-semibold">{t('cancel')}</button>
            </div>
          </div>
        )}

        {products.length === 0
          ? <p className="text-gray-400 text-sm">{t('noProductsYet')}</p>
          : (
            <div className="flex flex-col gap-2">
              {products.map(p => editId === p.id ? (
                <div key={p.id} className="border-2 border-indigo-300 rounded-lg p-3 flex flex-col gap-2 bg-indigo-50/40">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input value={ep.name} onChange={e => setEp({ ...ep, name: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" placeholder={t('productNamePlaceholder')} />
                    <select value={ep.collectFrequency} onChange={e => setEp({ ...ep, collectFrequency: e.target.value })} className="border rounded-lg px-3 py-2 text-sm">
                      {['daily','weekly','monthly','per_cycle'].map(f => <option key={f} value={f}>Collected {f.replace('_',' ')}</option>)}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input type="checkbox" checked={ep.isAnimalProduct} onChange={e => setEp({ ...ep, isAnimalProduct: e.target.checked })} className="rounded" />
                    {t('productIsAnimalInv')}
                  </label>
                  <p className="text-xs font-semibold text-gray-500">{t('saleUnitsLabel')}</p>
                  {ep.units.map((u, i) => (
                    <div key={i} className="flex gap-2">
                      <input value={u.name} onChange={e => setEp(s => ({ ...s, units: s.units.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))} className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder={t('unitPlaceholder')} />
                      <input type="number" value={u.perBase} onChange={e => setEp(s => ({ ...s, units: s.units.map((x, j) => j === i ? { ...x, perBase: e.target.value } : x) }))} className="w-20 border rounded-lg px-3 py-2 text-sm" />
                      <input type="number" value={u.price} onChange={e => setEp(s => ({ ...s, units: s.units.map((x, j) => j === i ? { ...x, price: e.target.value } : x) }))} className="w-28 border rounded-lg px-3 py-2 text-sm" placeholder={t('price')} />
                      {ep.units.length > 1 && <button type="button" onClick={() => setEp(s => ({ ...s, units: s.units.filter((_, j) => j !== i) }))} className="px-2 text-gray-400 hover:text-red-600"><X className="w-4 h-4" /></button>}
                    </div>
                  ))}
                  <button type="button" onClick={() => setEp(s => ({ ...s, units: [...s.units, { name: '', perBase: '1', price: '' }] }))} className="text-xs text-indigo-600 font-semibold self-start">{t('addSaleUnit')}</button>
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold">{t('saveChanges')}</button>
                    <button onClick={() => setEditId(null)} className="px-4 py-2 bg-gray-200 rounded-lg text-xs font-semibold">{t('cancel')}</button>
                  </div>
                </div>
              ) : (
                <div key={p.id} className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2">
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{p.name} <span className="text-xs text-gray-400">{t('collectedFreq', { freq: String(p.collectFrequency).replace('_',' ') })}</span></p>
                    <p className="text-xs text-gray-500">{p.saleUnits.map(u => `${u.name} ${fmtKES(u.price)}`).join(' · ')}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded capitalize">{p.flow}</span>
                    <button onClick={() => startEdit(p)} className="text-xs text-indigo-600 font-semibold hover:underline">{t('edit')}</button>
                    <button onClick={() => deleteProduct(p.id, p.name)} className="text-xs text-red-500 hover:text-red-700 hover:underline px-1"><X className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </div>

      {/* Lifecycle — growth stages, age, "due to move", advance/move + history */}
      {life && life.stages.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-bold text-gray-800 flex items-center gap-1.5"><Sprout className="w-4 h-4 text-primary" /> {t('lifecycle')}</h2>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Age <span className="font-bold text-gray-800">{life.age}d</span></span>
              <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-semibold">{life.stage}</span>
            </div>
          </div>

          {life.due.nextStage && (life.due.due
            ? <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-300 rounded-lg px-4 py-2 text-amber-800 text-sm font-semibold"><AlertTriangle className="w-4 h-4 shrink-0" /> Due to move to {life.due.nextStage}{life.due.overdueDays > 0 ? ` — ${life.due.overdueDays} day${life.due.overdueDays > 1 ? 's' : ''} overdue` : ' now'}.</div>
            : <p className="text-sm text-gray-500">Next: <span className="font-semibold text-gray-700">{life.due.nextStage}</span> in {life.due.daysRemaining} day{life.due.daysRemaining !== 1 ? 's' : ''}.</p>)}

          <div className="flex flex-wrap gap-1">
            {life.stages.map((s, i) => {
              const next = life.stages[i + 1];
              const isCurrent = s.name === life.stage;
              return (
                <div key={i} className={`px-2.5 py-1 rounded-lg text-xs border ${isCurrent ? 'bg-primary text-primary-foreground border-primary' : life.age >= s.startDay ? 'bg-success/10 text-success border-success/30' : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
                  {s.name} <span className="opacity-70">{next ? `d${s.startDay}–${next.startDay}` : `d${s.startDay}+`}</span>
                </div>
              );
            })}
          </div>

          <button onClick={openAdvance} className="self-start px-4 py-2 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90">{t('advancedStageOrMove')}</button>

          {life.events.length > 0 && (
            <div className="border-t border-gray-100 pt-2">
              <p className="text-xs font-semibold text-gray-400 mb-1">{t('history')}</p>
              <ul className="flex flex-col gap-1">
                {life.events.map((e, i) => {
                  const uName = (id: string | null) => life.units.find(u => u.id === id)?.name ?? '';
                  const moved = e.fromUnitId && e.toUnitId && e.fromUnitId !== e.toUnitId;
                  const lost = e.qtyBefore != null && e.qtyAfter != null && e.qtyAfter !== e.qtyBefore;
                  return (
                    <li key={i} className="text-xs text-gray-600">
                      <span className="text-gray-400">{new Date(e.at).toLocaleDateString('en-KE')}</span>{' '}
                      {e.fromStage && e.fromStage !== e.toStage ? <>{e.fromStage} → <span className="font-semibold">{e.toStage}</span></> : <span className="font-semibold">{e.toStage}</span>}
                      {moved && <> · moved {uName(e.fromUnitId)} → {uName(e.toUnitId)}</>}
                      {lost && <> · {e.qtyBefore}→{e.qtyAfter}</>}
                      {e.note && <span className="text-gray-400"> · {e.note}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {showAdvance && life && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowAdvance(false)} />
          <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 flex flex-col gap-3">
            <h3 className="font-bold text-gray-900">{t('advanceMoveTitle', { name: batch?.name ?? '' })}</h3>
            {advErr && <p className="text-red-600 bg-red-50 rounded-lg px-3 py-2 text-sm font-semibold">{advErr}</p>}
            <label className="text-xs font-semibold text-gray-500">{t('stage')}
              <select value={adv.toStage} onChange={e => setAdv({ ...adv, toStage: e.target.value })} className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm">
                {life.stages.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-500">{t('moveToUnit')}
              <select value={adv.toUnitId} onChange={e => setAdv({ ...adv, toUnitId: e.target.value })} className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm">
                {life.units.map(u => <option key={u.id} value={u.id}>{u.name}{u.id === life.unitId ? t('currentLabel') : ''}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-500">New head count (optional — e.g. hatched / transferred)
              <input type="number" min="0" value={adv.newQty} onChange={e => setAdv({ ...adv, newQty: e.target.value })} placeholder={`${batch?.currentQty ?? ''} ${t('now')}`} className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </label>              <input value={adv.note} onChange={e => setAdv({ ...adv, note: e.target.value })} placeholder={t('noteOptional')} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button onClick={submitAdvance} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90">{t('save')}</button>
              <button onClick={() => setShowAdvance(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">{t('cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Pending head counts — a worker counted the live animals; the owner decides
          whether to correct the system count. Workers never move it themselves. */}
      {pendingCounts.length > 0 && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-5">
          <h2 className="font-bold text-amber-900 mb-1">{t('headCountReview')}</h2>
          <p className="text-amber-800 text-xs mb-3">{t('headCountDesc')}</p>
          <div className="flex flex-col gap-2">
            {pendingCounts.map(c => (
              <div key={c.clientUuid} className="flex items-center justify-between flex-wrap gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2">
                <div className="text-sm">
                  <span className="font-semibold text-gray-900">{t('countedLabel', { count: c.physicalCount })}</span>
                  <span className="text-gray-500"> · {t('systemLabel', { count: c.systemCount })} · {t('varianceLabel', { variance: (c.variance > 0 ? '+' : '') + c.variance })}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => resolveCount(c.clientUuid, 'apply')} className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90">{t('applyCount', { count: c.physicalCount })}</button>
                  <button onClick={() => resolveCount(c.clientUuid, 'dismiss')} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold">{t('dismissLabel')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Worker activity — what the field team recorded, with photos & GPS */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-bold text-gray-800 mb-3">{t('workerActivity')}</h2>
        {activity.length === 0
          ? <p className="text-gray-400 text-sm">{t('noFieldRecordsYet')}</p>
          : (
            <div className="flex flex-col gap-2">
              {activity.map((a, i) => {
                const Icon = activityIcon(a.kind);
                return (
                  <div key={i} className="flex items-start gap-3 border border-gray-100 rounded-lg p-3">
                    <div className="shrink-0 w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center">
                      <Icon className="w-4 h-4 text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 capitalize">{a.kind} · {a.text}</p>
                      <p className="text-xs text-gray-400">{new Date(a.at).toLocaleString('en-KE')} · by {a.by}
                        {a.gpsLat != null && a.gpsLng != null && (
                          <> · <a className="text-blue-600 underline" href={`https://maps.google.com/?q=${a.gpsLat},${a.gpsLng}`} target="_blank" rel="noreferrer">{t('locationLabel')}</a></>
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
        <h2 className="font-bold text-gray-800 mb-3">{t('salesHistory')}</h2>
        {sales.length === 0
          ? <p className="text-gray-400 text-sm">{t('noSales')}</p>
          : (
            <>
              <TableToolbar search={salesSearch} onSearchChange={setSalesSearch} placeholder="Search product or buyer…" className="mb-3" />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="text-gray-500 text-xs font-semibold border-b">
                    <TableRow><TableHead className="text-left pb-2">{t('date')}</TableHead><TableHead className="text-left">{t('product')}</TableHead><TableHead className="text-right">{t('qty')}</TableHead><TableHead className="text-right">{t('amount')}</TableHead><TableHead className="text-left">{t('buyer')}</TableHead><TableHead className="text-center">{t('status')}</TableHead></TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-gray-50">
                    {pagedSales.map(s => (
                      <TableRow key={s.id} className="py-2">
                        <TableCell className="py-2 text-gray-400">{new Date(s.createdAt).toLocaleDateString('en-KE')}</TableCell>
                        <TableCell className="py-2 text-gray-700">{s.productType}</TableCell>
                        <TableCell className="py-2 text-right">{s.quantity}</TableCell>
                        <TableCell className="py-2 text-right font-semibold text-gray-900">{fmtKES(s.totalAmount)}</TableCell>
                        <TableCell className="py-2 text-gray-600">{s.buyer}</TableCell>
                        <TableCell className="py-2 text-center"><StatusChip status={s.withdrawalCheck === 'cleared' ? 'ok' : 'critical'} size="sm" label={s.withdrawalCheck === 'cleared' ? t('clearedLabel') : t('blockedLabel')} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-3">
                <Pager page={salesPage} totalPages={salesTotalPages} onPageChange={setSalesPage} />
              </div>
            </>
          )
        }
      </div>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-5 py-3 rounded-xl font-semibold shadow-lg ${toastWarn ? 'bg-warning text-warning-foreground' : 'bg-success text-white'}`}>
          {toastWarn ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <Check className="w-4 h-4 shrink-0" />} {toast}
        </div>
      )}

      {/* Sale modal — BR-WD withdrawal check */}
      <ConfirmSheet
        open={showSaleModal}
        title={t('recordSale')}
        summary=""
        onConfirm={handleSale}
        onCancel={() => setShowSaleModal(false)}
        confirmLabel={t('recordSale')}
      >
        <div className="flex flex-col gap-3">
          {wdError ? (
            <div className="rounded-xl px-4 py-3 border-2 bg-amber-50 border-amber-400 flex items-center justify-between gap-2">
              <p className="text-amber-800 text-sm font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0" /> {wdError}</p>
              <button type="button" onClick={loadWithdrawal} className="text-amber-800 text-xs font-bold underline shrink-0">{t('retry')}</button>
            </div>
          ) : wdCheck == null ? (
            <div className="rounded-xl px-4 py-3 border-2 bg-gray-50 border-gray-300">
              <p className="text-gray-500 text-sm">{t('loading')}</p>
            </div>
          ) : (
            <div className={`rounded-xl px-4 py-3 border-2 ${wdCheck.cleared ? 'bg-success/10 border-success/40' : 'bg-destructive/10 border-destructive/50'}`}>
              {wdCheck.cleared
                ? <p className="text-success font-semibold text-sm flex items-center gap-1.5"><Check className="w-4 h-4 shrink-0" /> {t('clearedForSale')}</p>
                : <><p className="text-destructive font-bold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0" /> {t('blockedWithdrawal', { date: wdCheck.until ?? '', days: wdCheck.daysLeft })}</p><p className="text-destructive text-xs">{t('saleUnsafe')}</p></>
              }
            </div>
          )}
          <select value={saleProductId} onChange={e => pickSaleProduct(e.target.value)} className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base">
            <option value="">{t('selectProduct')}</option>
            {products.filter(p => p.flow === 'sale').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {saleProduct && (
            <select value={saleUnitName} onChange={e => pickSaleUnit(e.target.value)} className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base">
              <option value="">{t('selectSaleUnit')}</option>
              {saleProduct.saleUnits.map(u => <option key={u.name} value={u.name}>{u.name} — {fmtKES(u.price)}</option>)}
            </select>
          )}
          {avail && (
            <p className={`text-sm rounded-lg px-3 py-2 ${overSell ? 'bg-red-50 text-red-700 font-semibold' : 'bg-gray-50 text-gray-600'}`}>
              {overSell
                ? `Only ${avail.available} available — you're trying to sell ${sellingBase}.`
                : `${avail.available} available to sell${sellingBase > 0 ? ` · this sale = ${sellingBase}` : ''}`}
            </p>
          )}
          <input value={saleQty} onChange={e => setSaleQty(e.target.value)} type="number" min="0" placeholder={t('quantityWithUnit', { unit: saleUnit ? ` (${saleUnit.name})` : ' / weight' })}
            className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base" />
          <input value={salePrice} onChange={e => setSalePrice(e.target.value)} type="number" min="0" placeholder={t('pricePerUnit')}
            className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base" />
          <input value={saleBuyer} onChange={e => setSaleBuyer(e.target.value)} placeholder={t('buyer')}
            className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base" />
        </div>
      </ConfirmSheet>

      {/* Generic styled confirm dialog — replaces window.confirm for delete-product / close-batch */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDialog(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm mx-4 p-5 flex flex-col gap-3 shadow-2xl">
            <h3 className={`font-bold ${confirmDialog.danger ? 'text-destructive' : 'text-gray-900'}`}>{confirmDialog.title}</h3>
            <p className="text-sm text-gray-600">{confirmDialog.body}</p>
            <div className="flex gap-2 mt-2">
              <button onClick={confirmDialog.onConfirm}
                className={`flex-1 px-4 py-2 rounded-lg font-semibold text-sm text-white ${confirmDialog.danger ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary hover:bg-primary/90'}`}>
                {t('confirm')}
              </button>
              <button onClick={() => setConfirmDialog(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete-batch dialog — irreversible, so require typing the batch name before enabling delete */}
      {showDeleteBatch && batch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowDeleteBatch(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm mx-4 p-5 flex flex-col gap-3 shadow-2xl">
            <h3 className="font-bold text-red-700">{t('deleteBatch')}</h3>
            <p className="text-sm text-gray-600">{t('confirmDeleteBatch', { name: batch.name })}</p>
            <p className="text-xs text-gray-500">Type <span className="font-mono font-semibold text-gray-800">{batch.name}</span> to confirm.</p>
            <input value={deleteBatchTyped} onChange={e => setDeleteBatchTyped(e.target.value)} placeholder={batch.name}
              className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <div className="flex gap-2 mt-2">
              <button onClick={doDeleteBatch} disabled={deleteBatchTyped !== batch.name || savingBatch}
                className="flex-1 px-4 py-2 rounded-lg font-semibold text-sm text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {t('deleteBatch')}
              </button>
              <button onClick={() => { setShowDeleteBatch(false); setDeleteBatchTyped(''); }} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
