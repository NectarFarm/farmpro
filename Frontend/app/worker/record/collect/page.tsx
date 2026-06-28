'use client';
import { Egg } from 'lucide-react';
import { uuid } from '@/lib/uuid';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { useSyncStore } from '@/lib/stores/sync';
import { api, getProducts } from '@/lib/api';
import { enqueuePendingRecord } from '@/lib/offline/db';
import { NumericKeypad } from '@/components/worker/NumericKeypad';
import type { Batch, Product } from '@/lib/types';

const freqLabel = (f: string) => ({ daily: 'Collect daily', weekly: 'Collect weekly', monthly: 'Collect monthly', per_cycle: 'Collect at harvest' }[f] ?? f);

export default function CollectProductsPage() {
  const { user } = useAuthStore();
  const { setPendingCount, pendingCount } = useSyncStore();
  const router = useRouter();

  const [batches, setBatches] = useState<Batch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [batchId, setBatchId] = useState('');
  const [productId, setProductId] = useState('');
  const [unitName, setUnitName] = useState('');
  const [qty, setQty] = useState('');
  const [keypad, setKeypad] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.getBatches().then(b => setBatches(b.filter(x => x.status === 'ACTIVE'))); }, []);
  useEffect(() => {
    setProductId(''); setQty('');
    if (!batchId) { setProducts([]); return; }
    // Only show things a worker actually COLLECTS (eggs, manure, milk, crop harvest).
    // The live animal itself is sold from the batch, never "collected", so exclude it.
    getProducts(batchId).then(ps => setProducts(ps.filter(p => !p.isAnimalProduct)));
  }, [batchId]);

  const product = products.find(p => p.id === productId);
  const qtyNum = parseFloat(qty) || 0;
  // The units this product can be collected in: the base unit + any sale units (tray, crate…).
  const units = product ? [{ name: product.baseUnit, perBase: 1 }, ...product.saleUnits.filter(u => u.name !== product.baseUnit).map(u => ({ name: u.name, perBase: u.perBase }))] : [];
  const perBase = units.find(u => u.name === unitName)?.perBase ?? 1;
  const baseQty = Math.round(qtyNum * perBase * 1000) / 1000;

  const pickProduct = (p: Product) => { setProductId(p.id); setQty(''); setUnitName(p.baseUnit); };

  const submit = async () => {
    if (!batchId) { setError('Select a batch'); return; }
    if (!product) { setError('Select a product'); return; }
    if (!qty || qtyNum <= 0) { setError('Enter how much you collected'); return; }
    setLoading(true); setError('');
    const clientUuid = uuid();
    // Always store the BASE-unit quantity so sales/stock math stays consistent.
    await enqueuePendingRecord('production', {
      clientUuid, batchId, productId: product.id, type: product.name, qty: baseQty,
      collectedUnit: unitName, collectedQty: qtyNum,
      recordedBy: user?.id, capturedAt: new Date().toISOString(),
    }, clientUuid);
    setPendingCount(pendingCount + 1);
    setToast(`✓ ${qtyNum} ${unitName}${perBase !== 1 ? ` (${baseQty} ${product.baseUnit})` : ''} of ${product.name} saved`);
    setLoading(false);
    setTimeout(() => router.replace('/worker/home'), 1500);
  };

  return (
    <div className="p-4 flex flex-col gap-5">
      <div className="bg-green-700 text-white rounded-2xl px-5 py-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Egg className="w-6 h-6 shrink-0" /><span>Collect Products</span></h1>
        <p className="text-green-200 text-sm">Record what you collected — eggs, milk, manure, meat…</p>
      </div>

      {/* Batch */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Batch</label>
        <select value={batchId} onChange={e => setBatchId(e.target.value)}
          className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base bg-white min-h-[52px]">
          <option value="">— Select batch —</option>
          {batches.map(b => <option key={b.id} value={b.id}>{b.name} · {b.currentQty}</option>)}
        </select>
      </div>

      {/* Product */}
      {batchId && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Product</label>
          {products.length === 0
            ? <p className="text-gray-400 text-sm bg-gray-50 rounded-lg px-3 py-2">No products set for this batch yet. Ask the owner to add them.</p>
            : (
              <div className="grid grid-cols-2 gap-2">
                {products.map(p => (
                  <button key={p.id} type="button" onClick={() => pickProduct(p)}
                    className={`rounded-xl px-3 py-3 text-left border-2 min-h-[64px] ${productId === p.id ? 'bg-green-50 border-green-500' : 'bg-white border-gray-200'}`}>
                    <p className="font-bold text-gray-800 text-sm">{p.name}</p>
                    <p className="text-xs text-gray-400">{freqLabel(String(p.collectFrequency))} · in {p.baseUnit}</p>
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
          <label className="text-sm font-medium text-gray-700">Counted in</label>
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
          <NumericKeypad large label={`How many ${unitName}?`} value={qty} onChange={setQty} allowDecimal unit={unitName} />
          <button onClick={() => setKeypad(false)} className="mt-3 w-full bg-green-600 text-white rounded-xl min-h-[44px] font-semibold">Done</button>
        </div>
      ) : (
        <button type="button" onClick={() => setKeypad(true)}
          className="flex justify-between items-center bg-white border-2 border-gray-300 rounded-xl px-4 py-3 min-h-[56px]">
          <span className="font-medium text-gray-700">Quantity collected ({unitName})</span>
          <span className={`text-2xl font-bold ${qty ? 'text-gray-900' : 'text-gray-400'}`}>{qty || '—'}</span>
        </button>
      ))}
      {product && perBase !== 1 && qtyNum > 0 && <p className="text-xs text-gray-500 -mt-2">= {baseQty} {product.baseUnit}</p>}

      {error && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{error}</p>}

      <button onClick={submit} disabled={loading || !batchId || !product || !qty}
        className="w-full min-h-[56px] bg-green-600 text-white rounded-xl text-xl font-bold disabled:opacity-40">
        {loading ? 'Saving…' : 'SUBMIT'}
      </button>

      {toast && <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-green-700 text-white px-5 py-3 rounded-xl font-semibold shadow-lg text-center">{toast}</div>}
    </div>
  );
}
