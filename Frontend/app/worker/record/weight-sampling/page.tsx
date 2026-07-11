'use client';
import { Scale, Check, AlertTriangle } from 'lucide-react';
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
import type { Batch } from '@/lib/types';

export default function WeightSamplingPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { setPendingCount, pendingCount } = useSyncStore();
  const { doneToday } = useTodayActivity();
  const router = useRouter();
  const { toast } = useToast();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState('');
  const [sampleSize, setSampleSize] = useState('10');
  const [avgWeight, setAvgWeight] = useState('');
  const [activeField, setActiveField] = useState<'size'|'weight'|null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [staleAt, setStaleAt] = useState<string | null>(null);

  useEffect(() => {
    cachedApi.getBatches().then(b => { setBatches(b.data.filter(b => b.status === 'ACTIVE')); setStaleAt(b.cachedAt); })
      .catch(() => setLoadError(t('loadFormDataFailed')));
  }, [t]);

  const [now] = useState(() => Date.now());
  const batch = batches.find(b => b.id === batchId);
  const acquiredDate = batch ? new Date(batch.acquiredDate) : null;
  const daysOnFarm = acquiredDate ? Math.floor((now - acquiredDate.getTime()) / 86400000) : 0;
  const startWeight = 0.04; // 40g day-old chick approx
  const avgKg = parseFloat(avgWeight) || 0;
  const adg = daysOnFarm > 0 && avgKg > 0 ? (((avgKg - startWeight) / daysOnFarm) * 1000).toFixed(0) : null;
  const projectedDays = adg && avgKg ? Math.round((2.5 - avgKg) / (parseFloat(adg)/1000)) : null;

  const handleSubmit = async () => {
    if (!batchId || !avgWeight || submitting) return;
    setSubmitting(true); setError('');
    const clientUuid = uuid();
    try {
      await enqueuePendingRecord('weight_sample', { clientUuid, batchId, sampleSize: parseInt(sampleSize)||10, avgWeightKg: avgKg, measuredAt: new Date().toISOString(), measuredBy: user?.id }, clientUuid);
    } catch {
      setSubmitting(false);
      setError(t('saveFailedRetry'));
      return;
    }
    setPendingCount(pendingCount + 1);
    toast({ description: <span className="flex items-center gap-1.5"><Check className="w-4 h-4" /> Saved — will sync</span> });
    setTimeout(() => router.replace('/worker/home'), 1500);
  };

  return (
    <div className="p-4 flex flex-col gap-5">
      <div className="bg-purple-700 text-white rounded-2xl px-5 py-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Scale className="w-6 h-6 shrink-0" /><span>{t('weightSample')}</span></h1>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">{t('batch')}</label>
        <select value={batchId} onChange={e => setBatchId(e.target.value)}
          className="border-2 border-gray-300 rounded-xl px-4 py-3 bg-white min-h-[52px]">
          <option value="">{t('selectBatch')}</option>
          {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {batchId && doneToday('weight_sample', batchId).count > 0 && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Already sampled today at {timeLabel(doneToday('weight_sample', batchId).lastAt)}.</p>
        )}
      </div>

      {activeField === 'size' ? (
        <div className="bg-white rounded-xl border p-4">
          <NumericKeypad label={t('sampleSize')} value={sampleSize} onChange={setSampleSize} />
          <button onClick={() => setActiveField(null)} className="mt-3 w-full bg-green-600 text-white rounded-xl min-h-[44px] font-semibold">Done</button>
        </div>
      ) : (
        <button type="button" onClick={() => setActiveField('size')}
          className="flex justify-between items-center bg-white border-2 border-gray-300 rounded-xl px-4 py-3 min-h-[56px]">
          <span className="font-medium text-gray-700">{t('sampleSize')}</span>
          <span className="text-2xl font-bold text-gray-900">{sampleSize} {t('animals')}</span>
        </button>
      )}

      {activeField === 'weight' ? (
        <div className="bg-white rounded-xl border p-4">
          <NumericKeypad large label={t('averageWeight')} value={avgWeight} onChange={setAvgWeight} allowDecimal unit="kg" />
          <button onClick={() => setActiveField(null)} className="mt-3 w-full bg-green-600 text-white rounded-xl min-h-[44px] font-semibold">Done</button>
        </div>
      ) : (
        <button type="button" onClick={() => setActiveField('weight')}
          className="flex justify-between items-center bg-white border-2 border-gray-300 rounded-xl px-4 py-3 min-h-[56px]">
          <span className="font-medium text-gray-700">{t('averageWeight')}</span>
          <span className={`text-2xl font-bold ${avgWeight ? 'text-gray-900' : 'text-gray-400'}`}>{avgWeight || '—'} kg</span>
        </button>
      )}

      {/* ADG projection */}
      {adg && batchId && (
        <div className="bg-blue-50 border border-blue-300 rounded-xl px-4 py-3">
          <p className="text-blue-800 font-bold">ADG {adg} g/day</p>
          {projectedDays && projectedDays > 0 && (
            <p className="text-blue-600 text-sm">Projected 2.5 kg in ~{projectedDays} days (day {daysOnFarm + projectedDays} of cycle)</p>
          )}
        </div>
      )}

      {error && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{error}</p>}
      {loadError && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{loadError}</p>}
      <StaleDataNotice cachedAt={staleAt} />

      <button onClick={handleSubmit} disabled={!batchId || !avgWeight || submitting}
        className="w-full min-h-[56px] bg-purple-600 text-white rounded-xl text-xl font-bold disabled:opacity-40">
        {submitting ? t('saving') : 'SAVE'}
      </button>
    </div>
  );
}
