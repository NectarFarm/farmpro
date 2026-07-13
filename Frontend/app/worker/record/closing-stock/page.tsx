'use client';
import { PackageOpen, Check, AlertTriangle, Plus } from 'lucide-react';
import { RecordHeader } from '@/components/worker/RecordPageShell';
import { uuid } from '@/lib/uuid';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuthStore } from '@/lib/stores/auth';
import { useSyncStore } from '@/lib/stores/sync';
import { cachedApi } from '@/lib/offline/refCache';
import { enqueuePendingRecord } from '@/lib/offline/db';
import { useToast } from '@/hooks/use-toast';
import { StaleDataNotice } from '@/components/worker/StaleDataNotice';
import type { InventoryItem, InventoryLot } from '@/lib/types';

export default function ClosingStockPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { setPendingCount, pendingCount } = useSyncStore();
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [counts, setCounts] = useState<Record<string,string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [staleAt, setStaleAt] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([cachedApi.getItems(), cachedApi.getLots()]).then(([i,l]) => {
      const feedItems = i.data.filter(it => it.category.startsWith('FEED'));
      setItems(feedItems);
      setLots(l.data);
      setStaleAt(i.cachedAt ?? l.cachedAt);
    }).catch(() => setLoadError(t('loadFormDataFailed')));
  }, [t]);

  const getOnHand = (itemId: string) => lots.filter(l => l.itemId === itemId).reduce((s,l) => s + l.qtyOnHand, 0);
  const getVariance = (itemId: string) => {
    const entered = parseFloat(counts[itemId] || '');
    if (isNaN(entered)) return null;
    return entered - getOnHand(itemId);
  };

  const handleSubmit = async () => {
    setError('');
    const enteredEntries = items.filter(item => counts[item.id] !== undefined && counts[item.id] !== '');
    const negative = enteredEntries.find(item => parseFloat(counts[item.id]) < 0);
    if (negative) { setError(t('countCannotBeNegative')); return; }
    setLoading(true);
    const capturedAt = new Date().toISOString();
    try {
      for (const item of enteredEntries) {
        const clientUuid = uuid();
        await enqueuePendingRecord('closing_stock', {
          clientUuid, itemId: item.id, closingQty: parseFloat(counts[item.id]),
          recordedBy: user?.id, capturedAt,
        }, clientUuid);
      }
    } catch {
      setLoading(false);
      setError(t('saveFailedRetry'));
      return;
    }
    setPendingCount(pendingCount + Object.keys(counts).length);
    toast({ description: <span className="flex items-center gap-1.5"><Check className="w-4 h-4" /> {t('savedWillSync')}</span> });
    setLoading(false);
    setTimeout(() => router.replace('/worker/home'), 1500);
  };

  return (
    <div className="p-4 flex flex-col gap-5 md:max-w-lg md:mx-auto">
      <RecordHeader icon={PackageOpen} title={t('closingStockCount')} subtitle={t('closingStockSubtitle')} accent="teal" />

      {loadError && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{loadError}</p>}
      <StaleDataNotice cachedAt={staleAt} />

      {items.length === 0 && !loadError && (
        <div className="text-center py-10 text-gray-400">{t('loadingItems')}</div>
      )}

      {items.map(item => {
        const onHand = getOnHand(item.id);
        const variance = getVariance(item.id);
        const hasVariance = variance !== null && Math.abs(variance) > 0.5;
        return (
          <div key={item.id} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-2">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-bold text-gray-900">{item.name}</p>
                <p className="text-xs text-gray-500">{t('system')}: {onHand} {item.unit} {t('onHand')}</p>
              </div>
              {onHand <= item.lowStockThreshold && (
                <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold"><AlertTriangle className="w-3 h-3" /> {t('lowStock')}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 shrink-0">{t('youCounted')} ({item.unit})</label>
              <input
                type="number" step="0.1" min="0"
                value={counts[item.id] ?? ''}
                onChange={e => setCounts(c => ({ ...c, [item.id]: e.target.value }))}
                placeholder={t('egPlaceholder', { value: onHand })}
                className="flex-1 border-2 border-gray-300 rounded-xl px-4 py-2 text-xl font-bold text-center min-h-[52px]"
              />
            </div>
            {/* Variance always gets flagged for owner review — BR-11 */}
            {hasVariance && variance !== null && (
              <p className={`flex items-center gap-1.5 text-sm font-semibold rounded-lg px-3 py-1 ${variance < 0 ? 'text-red-700 bg-red-50' : 'text-amber-700 bg-amber-50'}`}>
                {variance < 0 ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <Plus className="w-4 h-4 shrink-0" />}
                {variance < 0 ? t('shortage') : t('surplus')} {Math.abs(variance).toFixed(1)} {item.unit} — {t('varianceWillBeFlagged')}
              </p>
            )}
          </div>
        );
      })}

      {error && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{error}</p>}

      <button onClick={handleSubmit} disabled={loading || Object.keys(counts).length === 0}
        className="w-full min-h-[56px] bg-teal-600 text-white rounded-xl text-xl font-bold disabled:opacity-40">
        {loading ? t('saving') : t('submitAll')}
      </button>
    </div>
  );
}
