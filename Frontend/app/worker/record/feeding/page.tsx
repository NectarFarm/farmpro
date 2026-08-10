'use client';
import { Wheat, Plus, X, Check, AlertTriangle } from 'lucide-react';
import { RecordHeader } from '@/components/worker/RecordPageShell';
import { uuid } from '@/lib/uuid';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuthStore } from '@/lib/stores/auth';
import { useSyncStore } from '@/lib/stores/sync';
import { cachedApi } from '@/lib/offline/refCache';
import { enqueuePendingRecord } from '@/lib/offline/db';
import { useTodayActivity, timeLabel } from '@/lib/hooks/useTodayActivity';
import { useToast } from '@/hooks/use-toast';
import { StaleDataNotice } from '@/components/worker/StaleDataNotice';
import type { Batch, InventoryItem, InventoryLot } from '@/lib/types';

type Row = { itemId: string; qty: string };

export default function FeedingPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { setPendingCount, pendingCount } = useSyncStore();
  const { doneToday, refresh } = useTodayActivity();
  const router = useRouter();
  const { toast } = useToast();

  const [batches, setBatches] = useState<Batch[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [batchId, setBatchId] = useState('');
  const [rows, setRows] = useState<Row[]>([{ itemId: '', qty: '' }]);
  const [doneBatches, setDoneBatches] = useState<string[]>([]); // batches fed this visit
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [staleAt, setStaleAt] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([cachedApi.getBatches(), cachedApi.getItems(), cachedApi.getLots()]).then(([b, i, l]) => {
      setBatches(b.data.filter(b => b.status === 'ACTIVE'));
      setItems(i.data.filter(i => i.category.startsWith('FEED')));
      setLots(l.data);
      setStaleAt(b.cachedAt ?? i.cachedAt ?? l.cachedAt);
    }).catch(() => setLoadError(t('loadFormDataFailed')));
  }, [t]);

  const onHand = (itemId: string) => lots.filter(l => l.itemId === itemId).reduce((s, l) => s + l.qtyOnHand, 0);
  const itemOf = (id: string) => items.find(i => i.id === id);
  const activeLot = (itemId: string) => lots.filter(l => l.itemId === itemId && l.qtyOnHand > 0).sort((a, b) => (a.receivedDate < b.receivedDate ? -1 : 1))[0];

  const setRow = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addRow = () => setRows(rs => [...rs, { itemId: '', qty: '' }]);
  const removeRow = (i: number) => setRows(rs => rs.filter((_, idx) => idx !== i));

  const rowOver = (r: Row) => !!r.itemId && (parseFloat(r.qty) || 0) > onHand(r.itemId);
  const anyOver = rows.some(rowOver);
  const validRows = rows.filter(r => r.itemId && (parseFloat(r.qty) || 0) > 0);
  // Was this batch already fed today (recorded earlier OR earlier this visit)?
  const fedToday = batchId ? doneToday('feeding', batchId) : { count: 0, lastAt: null };
  const fedThisVisit = batchId ? doneBatches.includes(batchId) : false;
  const batchName = (id: string) => batches.find(b => b.id === id)?.name ?? id;

  const handleSubmit = async () => {
    if (!batchId) { setError(t('selectBatchError')); return; }
    if (!validRows.length) { setError(t('addAtLeastOneFeed')); return; }
    if (anyOver) { setError(t('feedOverStock')); return; }
    const ids = validRows.map(r => r.itemId);
    if (new Set(ids).size !== ids.length) { setError(t('feedListedTwice')); return; }
    setLoading(true); setError('');
    const at = new Date().toISOString();
    try {
      for (const r of validRows) {
        const clientUuid = uuid();
        await enqueuePendingRecord('feeding', {
          clientUuid, batchId, feedItemId: r.itemId, lotId: activeLot(r.itemId)?.id,
          quantityKg: parseFloat(r.qty),
          recordedBy: user?.id, capturedAt: at,
        }, clientUuid);
      }
    } catch {
      setLoading(false);
      setError(t('saveFailedRetry'));
      return;
    }
    setPendingCount(pendingCount + validRows.length);
    setDoneBatches(d => d.includes(batchId) ? d : [...d, batchId]);
    toast({ description: <span className="flex items-center gap-1.5"><Check className="w-4 h-4" /> {t('batchFedPickNext', { batch: batchName(batchId) })}</span> });
    // Stay in the flow for the next batch instead of leaving the page.
    setBatchId(''); setRows([{ itemId: '', qty: '' }]); setLoading(false); refresh();
  };

  return (
    <div className="p-4 flex flex-col gap-5 md:max-w-lg md:mx-auto">
      <RecordHeader icon={Wheat} title={t('feedingLog')} subtitle={t('feedingLogSubtitle')} accent="green" />

      {loadError && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{loadError}</p>}
      <StaleDataNotice cachedAt={staleAt} />

      {/* Progress this visit + finish */}
      {doneBatches.length > 0 && (
        <div className="bg-green-50 border border-green-300 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-green-800 text-sm font-semibold"><Check className="w-4 h-4 shrink-0" /> {t('fedBatchesRound', { count: doneBatches.length })}</p>
          <button onClick={() => router.replace('/worker/home')} className="px-3 py-1.5 bg-green-700 text-white rounded-lg text-xs font-semibold">{t('finish')}</button>
        </div>
      )}

      {/* Batch */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">{t('batch')}</label>
        <select value={batchId} onChange={e => setBatchId(e.target.value)}
          className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base bg-white min-h-[52px]">
          <option value="">{t('selectBatch')}</option>
          {batches.map(b => <option key={b.id} value={b.id}>{b.name} · {b.currentQty} {t('animals')}{doneBatches.includes(b.id) ? ` (${t('fedStatus')})` : ''}</option>)}
        </select>
        {batchId && (fedThisVisit || fedToday.count > 0) && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {fedToday.lastAt ? t('alreadyFedTodayAt', { batch: batchName(batchId), time: timeLabel(fedToday.lastAt) }) : t('alreadyFedToday', { batch: batchName(batchId) })}</p>
        )}
      </div>

      {/* Feed rows — pick a specific feed; add another for the same batch */}
      <div className="flex flex-col gap-3">
        <label className="text-sm font-medium text-gray-700">{t('feedConsumed')}</label>
        {rows.map((r, i) => {
          const it = itemOf(r.itemId);
          const stock = r.itemId ? onHand(r.itemId) : 0;
          const over = rowOver(r);
          return (
            <div key={i} className="bg-white border-2 border-gray-200 rounded-xl p-3 flex flex-col gap-2">
              <div className="flex gap-2 items-center">
                <select value={r.itemId} onChange={e => setRow(i, { itemId: e.target.value, qty: '' })}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px] bg-white">
                  <option value="">{t('selectFeed')}</option>
                  {items.map(fi => { const s = onHand(fi.id); return <option key={fi.id} value={fi.id}>{fi.name} — {s} {fi.unit} {t('onHand')}{s < fi.lowStockThreshold ? ` (${t('lowStock')})` : ''}</option>; })}
                </select>
                {rows.length > 1 && <button type="button" onClick={() => removeRow(i)} aria-label={t('removeLabel')} className="text-gray-400 hover:text-red-600 p-2"><X className="w-5 h-5" /></button>}
              </div>
              {r.itemId && (
                <>
                  <input type="number" min="0" inputMode="decimal" value={r.qty} onChange={e => setRow(i, { qty: e.target.value })}
                    placeholder={t('usedUnitPlaceholder', { unit: it?.unit ?? 'kg' })} className={`w-full border-2 rounded-lg px-3 py-2 text-base min-h-[48px] ${over ? 'border-red-400 text-red-600' : 'border-gray-300'}`} />
                  <p className={`text-xs ${over ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{over ? t('onlyStockLeft', { stock, unit: it?.unit ?? '' }) : t('stockInStock', { stock, unit: it?.unit ?? '' })}</p>
                </>
              )}
            </div>
          );
        })}
        <button type="button" onClick={addRow} className="self-start flex items-center gap-1 text-green-700 font-semibold text-sm"><Plus className="w-4 h-4" /> {t('addAnotherFeed')}</button>
      </div>

      {error && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{error}</p>}

      <button onClick={handleSubmit} disabled={loading || !batchId || !validRows.length || anyOver}
        className="w-full min-h-[56px] bg-green-600 text-white rounded-xl text-xl font-bold disabled:opacity-40">
        {loading ? t('saving') : anyOver ? t('feedExceedsStock') : `${t('submit')}${validRows.length > 1 ? ` (${validRows.length} ${t('feeds')})` : ''}`}
      </button>
    </div>
  );
}
