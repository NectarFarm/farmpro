'use client';
import { Egg, Check, Info } from 'lucide-react';
import { uuid } from '@/lib/uuid';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuthStore } from '@/lib/stores/auth';
import { useSyncStore } from '@/lib/stores/sync';
import { cachedApi } from '@/lib/offline/refCache';
import { enqueuePendingRecord } from '@/lib/offline/db';
import { useTodayActivity, timeLabel } from '@/lib/hooks/useTodayActivity';
import { NumericKeypad } from '@/components/worker/NumericKeypad';
import { useToast } from '@/hooks/use-toast';
import { StaleDataNotice } from '@/components/worker/StaleDataNotice';
import type { Batch, Product } from '@/lib/types';

import type { TranslationKey } from '@/lib/i18n/useTranslation';

const FREQ_KEYS: Record<string, TranslationKey> = { daily: 'collectDaily', weekly: 'collectWeekly', monthly: 'collectMonthly', per_cycle: 'collectPerCycle' };
const freqLabel = (f: string, t: (k: TranslationKey) => string) => (FREQ_KEYS[f] ? t(FREQ_KEYS[f]) : f);

export default function CollectProductsPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { setPendingCount, pendingCount } = useSyncStore();
  const { doneToday, refresh } = useTodayActivity();
  const router = useRouter();
  const { toast } = useToast();

  const [batches, setBatches] = useState<Batch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [batchId, setBatchId] = useState('');
  const [productId, setProductId] = useState('');
  const [unitName, setUnitName] = useState('');
  const [qty, setQty] = useState('');
  const [keypad, setKeypad] = useState(false);
  const [doneBatches, setDoneBatches] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [staleAt, setStaleAt] = useState<string | null>(null);

  useEffect(() => {
    cachedApi.getBatches().then(b => { setBatches(b.data.filter(x => x.status === 'ACTIVE')); setStaleAt(b.cachedAt); })
      .catch(() => setLoadError(t('loadFormDataFailed')));
  }, [t]);
  useEffect(() => {
    setProductId(''); setQty('');
    if (!batchId) { setProducts([]); return; }
    // Only show things a worker actually COLLECTS (eggs, manure, milk, crop harvest).
    // The live animal itself is sold from the batch, never "collected", so exclude it.
    cachedApi.getProducts(batchId).then(ps => {
      setProducts(ps.data.filter(p => !p.isAnimalProduct));
      if (ps.cachedAt) setStaleAt(s => s ?? ps.cachedAt);
    }).catch(err => console.error('Failed to load products', err));
  }, [batchId]);

  const product = products.find(p => p.id === productId);
  const qtyNum = parseFloat(qty) || 0;
  // The units this product can be collected in: the base unit + any sale units (tray, crate…).
  const units = product ? [{ name: product.baseUnit, perBase: 1 }, ...product.saleUnits.filter(u => u.name !== product.baseUnit).map(u => ({ name: u.name, perBase: u.perBase }))] : [];
  const perBase = units.find(u => u.name === unitName)?.perBase ?? 1;
  const baseQty = Math.round(qtyNum * perBase * 1000) / 1000;

  const pickProduct = (p: Product) => { setProductId(p.id); setQty(''); setUnitName(p.baseUnit); };

  const submit = async () => {
    if (!batchId) { setError(t('selectBatchError')); return; }
    if (!product) { setError(t('selectProductError')); return; }
    if (!qty || qtyNum <= 0) { setError(t('enterQtyCollected')); return; }
    setLoading(true); setError('');
    const clientUuid = uuid();
    try {
      // Always store the BASE-unit quantity so sales/stock math stays consistent.
      await enqueuePendingRecord('production', {
        clientUuid, batchId, productId: product.id, type: product.name, qty: baseQty,
        collectedUnit: unitName, collectedQty: qtyNum,
        recordedBy: user?.id, capturedAt: new Date().toISOString(),
      }, clientUuid);
    } catch {
      setLoading(false);
      setError(t('saveFailedRetry'));
      return;
    }
    setPendingCount(pendingCount + 1);
    setDoneBatches(d => d.includes(batchId) ? d : [...d, batchId]);
    toast({ description: <span className="flex items-center gap-1.5"><Check className="w-4 h-4" /> {t('productCollectedPickNext', { qty: qtyNum, unit: unitName, product: product.name })}</span> });
    // Stay in the flow for the next batch/product.
    setBatchId(''); setProductId(''); setQty(''); setLoading(false); refresh();
  };

  return (
    <div className="p-4 flex flex-col gap-5">
      <div className="bg-green-700 text-white rounded-2xl px-5 py-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Egg className="w-6 h-6 shrink-0" /><span>{t('collectProducts')}</span></h1>
        <p className="text-green-200 text-sm">{t('collectSubtitle')}</p>
      </div>

      {loadError && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{loadError}</p>}
      <StaleDataNotice cachedAt={staleAt} />

      {doneBatches.length > 0 && (
        <div className="bg-green-50 border border-green-300 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-green-800 text-sm font-semibold"><Check className="w-4 h-4 shrink-0" /> {t('collectedThisRound', { count: doneBatches.length })}</p>
          <button onClick={() => router.replace('/worker/home')} className="px-3 py-1.5 bg-green-700 text-white rounded-lg text-xs font-semibold">{t('finish')}</button>
        </div>
      )}

      {/* Batch */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">{t('batch')}</label>
        <select value={batchId} onChange={e => setBatchId(e.target.value)}
          className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base bg-white min-h-[52px]">
          <option value="">{t('selectBatch')}</option>
          {batches.map(b => <option key={b.id} value={b.id}>{b.name} · {b.currentQty}{doneBatches.includes(b.id) ? ` (${t('doneTag')})` : ''}</option>)}
        </select>
        {batchId && doneToday('production', batchId).count > 0 && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600"><Info className="w-3.5 h-3.5 shrink-0" /> {t('alreadyCollectedTodayAt', { time: timeLabel(doneToday('production', batchId).lastAt) })}</p>
        )}
      </div>

      {/* Product */}
      {batchId && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">{t('products')}</label>
          {products.length === 0
            ? <p className="text-gray-400 text-sm bg-gray-50 rounded-lg px-3 py-2">{t('noProductsSet')}</p>
            : (
              <div className="grid grid-cols-2 gap-2">
                {products.map(p => (
                  <button key={p.id} type="button" onClick={() => pickProduct(p)}
                    className={`rounded-xl px-3 py-3 text-left border-2 min-h-[64px] ${productId === p.id ? 'bg-green-50 border-green-500' : 'bg-white border-gray-200'}`}>
                    <p className="font-bold text-gray-800 text-sm">{p.name}</p>
                    <p className="text-xs text-gray-400">{freqLabel(String(p.collectFrequency), t)} · {t('inUnit', { unit: p.baseUnit })}</p>
                  </button>
                ))}
              </div>
            )
          }
        </div>
      )}

      {/* Collection unit — collect in pieces, trays, crates… */}
      {product && units.length > 1 && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">{t('unit')}</label>
          <div className="flex flex-wrap gap-2">
            {units.map(u => (
              <button key={u.name} type="button" onClick={() => { setUnitName(u.name); setQty(''); }}
                className={`px-4 py-2 rounded-xl border-2 text-sm font-semibold ${unitName === u.name ? 'bg-green-50 border-green-500 text-green-800' : 'bg-white border-gray-200 text-gray-600'}`}>
                {u.name}{u.perBase !== 1 ? ` (${u.perBase} ${product.baseUnit})` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quantity */}
      {product && (keypad ? (
        <div className="bg-white rounded-xl border p-4">
          <NumericKeypad large label={`${t('howMany')} ${unitName}?`} value={qty} onChange={setQty} allowDecimal unit={unitName} />
          <button onClick={() => setKeypad(false)} className="mt-3 w-full bg-green-600 text-white rounded-xl min-h-[44px] font-semibold">{t('done')}</button>
        </div>
      ) : (
        <button type="button" onClick={() => setKeypad(true)}
          className="flex justify-between items-center bg-white border-2 border-gray-300 rounded-xl px-4 py-3 min-h-[56px]">
          <span className="font-medium text-gray-700">{t('quantityCollectedUnit', { unit: unitName })}</span>
          <span className={`text-2xl font-bold ${qty ? 'text-gray-900' : 'text-gray-400'}`}>{qty || '—'}</span>
        </button>
      ))}
      {product && perBase !== 1 && qtyNum > 0 && <p className="text-xs text-gray-500 -mt-2">= {baseQty} {product.baseUnit}</p>}

      {error && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{error}</p>}

      <button onClick={submit} disabled={loading || !batchId || !product || !qty}
        className="w-full min-h-[56px] bg-green-600 text-white rounded-xl text-xl font-bold disabled:opacity-40">
        {loading ? t('saving') : t('submit')}
      </button>
    </div>
  );
}
