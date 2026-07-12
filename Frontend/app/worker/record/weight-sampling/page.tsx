'use client';
import { Scale, AlertTriangle, CheckCircle2 } from 'lucide-react';
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
import { StaleDataNotice } from '@/components/worker/StaleDataNotice';
import { isBroilerSpecies } from '@/lib/species';
import type { Batch } from '@/lib/types';

export default function WeightSamplingPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { setPendingCount, pendingCount } = useSyncStore();
  const { doneToday } = useTodayActivity();
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState('');
  const [sampleSize, setSampleSize] = useState('10');
  const [avgWeight, setAvgWeight] = useState('');
  const [activeField, setActiveField] = useState<'size'|'weight'|null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [staleAt, setStaleAt] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    cachedApi.getBatches().then(b => { setBatches(b.data.filter(b => b.status === 'ACTIVE')); setStaleAt(b.cachedAt); })
      .catch(() => setLoadError(t('loadFormDataFailed')));
  }, [t]);

  const [now] = useState(() => Date.now());
  const batch = batches.find(b => b.id === batchId);
  const acquiredDate = batch ? new Date(batch.acquiredDate) : null;
  const daysOnFarm = acquiredDate ? Math.floor((now - acquiredDate.getTime()) / 86400000) : 0;
  // ADG/target-weight projection only makes sense for broilers (meat birds sold
  // at a target live weight). Layers, pigs, fish, etc. don't follow this curve,
  // so the whole block is hidden for them (item 5) rather than showing a
  // meaningless number.
  const isBroiler = isBroilerSpecies(batch?.species);
  const BROILER_START_WEIGHT_KG = 0.04; // 40g day-old chick approx
  const BROILER_TARGET_WEIGHT_KG = 2.5;
  const avgKg = parseFloat(avgWeight) || 0;
  const adg = isBroiler && daysOnFarm > 0 && avgKg > 0 ? (((avgKg - BROILER_START_WEIGHT_KG) / daysOnFarm) * 1000).toFixed(0) : null;
  const projectedDays = adg && avgKg ? Math.round((BROILER_TARGET_WEIGHT_KG - avgKg) / (parseFloat(adg)/1000)) : null;

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
    setSubmitting(false);
    // No timed redirect — explicit success state + Done button (item 8).
    setSaved(true);
  };

  if (saved) {
    return (
      <div className="p-4 flex flex-col gap-5">
        <div className="bg-green-50 border border-green-300 rounded-2xl p-6 text-center">
          <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-2" />
          <h1 className="text-xl font-bold text-green-800">{t('savedWillSync')}</h1>
        </div>
        <button onClick={() => router.replace('/worker/home')}
          className="w-full min-h-[56px] bg-purple-600 text-white rounded-xl text-xl font-bold">
          {t('backToHome')}
        </button>
      </div>
    );
  }

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
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {t('alreadySampledTodayAt', { time: timeLabel(doneToday('weight_sample', batchId).lastAt) })}</p>
        )}
      </div>

      {activeField === 'size' ? (
        <div className="bg-white rounded-xl border p-4">
          <NumericKeypad label={t('sampleSize')} value={sampleSize} onChange={setSampleSize} />
          <button onClick={() => setActiveField(null)} className="mt-3 w-full bg-green-600 text-white rounded-xl min-h-[44px] font-semibold">{t('done')}</button>
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
          <button onClick={() => setActiveField(null)} className="mt-3 w-full bg-green-600 text-white rounded-xl min-h-[44px] font-semibold">{t('done')}</button>
        </div>
      ) : (
        <button type="button" onClick={() => setActiveField('weight')}
          className="flex justify-between items-center bg-white border-2 border-gray-300 rounded-xl px-4 py-3 min-h-[56px]">
          <span className="font-medium text-gray-700">{t('averageWeight')}</span>
          <span className={`text-2xl font-bold ${avgWeight ? 'text-gray-900' : 'text-gray-400'}`}>{avgWeight || '—'} kg</span>
        </button>
      )}

      {/* ADG projection — broilers only (item 5): the 40g start / 2.5kg target
          curve doesn't apply to layers, pigs, fish, etc. */}
      {isBroiler && adg && batchId && (
        <div className="bg-blue-50 border border-blue-300 rounded-xl px-4 py-3">
          <p className="text-blue-800 font-bold">{t('adgPerDay', { adg })}</p>
          {projectedDays && projectedDays > 0 && (
            <p className="text-blue-600 text-sm">{t('projectedWeightDays', { target: BROILER_TARGET_WEIGHT_KG, days: projectedDays, day: daysOnFarm + projectedDays })}</p>
          )}
        </div>
      )}

      {error && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{error}</p>}
      {loadError && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{loadError}</p>}
      <StaleDataNotice cachedAt={staleAt} />

      <button onClick={handleSubmit} disabled={!batchId || !avgWeight || submitting}
        className="w-full min-h-[56px] bg-purple-600 text-white rounded-xl text-xl font-bold disabled:opacity-40">
        {submitting ? t('saving') : t('submit')}
      </button>
    </div>
  );
}
