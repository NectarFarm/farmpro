'use client';
import { ListOrdered, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { uuid } from '@/lib/uuid';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation, type TranslationKey } from '@/lib/i18n/useTranslation';
import { useAuthStore } from '@/lib/stores/auth';
import { useSyncStore } from '@/lib/stores/sync';
import { cachedApi } from '@/lib/offline/refCache';
import { enqueuePendingRecord } from '@/lib/offline/db';
import { useTodayActivity, timeLabel } from '@/lib/hooks/useTodayActivity';
import { NumericKeypad } from '@/components/worker/NumericKeypad';
import { ConfirmSheet } from '@/components/worker/ConfirmSheet';
import { StaleDataNotice } from '@/components/worker/StaleDataNotice';
import type { Batch, ProductionUnit } from '@/lib/types';

// value = canonical string stored on the record; labelKey = translated display text.
const VARIANCE_REASONS: { value: string; labelKey: TranslationKey }[] = [
  { value: 'Missing — suspected theft', labelKey: 'varianceMissingTheft' },
  { value: 'Found extra (uncounted)', labelKey: 'varianceFoundExtra' },
  { value: 'Uncounted deaths', labelKey: 'varianceUncountedDeaths' },
  { value: 'Transfer not recorded', labelKey: 'varianceTransferNotRecorded' },
  { value: 'Counting error', labelKey: 'varianceCountingError' },
  { value: 'Other', labelKey: 'otherOption' },
];

export default function PhysicalCountPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { setPendingCount, pendingCount } = useSyncStore();
  const { doneToday } = useTodayActivity();
  const router = useRouter();

  const [batches, setBatches] = useState<Batch[]>([]);
  const [units, setUnits] = useState<ProductionUnit[]>([]);
  const [batchId, setBatchId] = useState('');
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [showKeypad, setShowKeypad] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [staleAt, setStaleAt] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([cachedApi.getBatches(), cachedApi.getUnits()]).then(([b,u]) => {
      setBatches(b.data.filter(b => b.status === 'ACTIVE'));
      setUnits(u.data);
      setStaleAt(b.cachedAt ?? u.cachedAt);
    }).catch(() => setLoadError(t('loadFormDataFailed')));
  }, [t]);

  const batch = batches.find(b => b.id === batchId);
  const unit = units.find(u => u.id === batch?.unitId);
  const systemCount = batch?.currentQty ?? 0;
  const physCount = parseInt(counted) || 0;
  const variance = physCount - systemCount;
  const hasVariance = counted !== '' && variance !== 0;

  const handleSubmit = () => {
    if (!batchId) { setError(t('selectBatchError')); return; }
    if (!counted) { setError(t('enterPhysicalCount')); return; }
    // Variance always needs a reason on file — BR-12 (audited stock adjustment).
    if (hasVariance && !reason) { setError(t('varianceRequiresReason')); return; }
    setShowConfirm(true);
  };

  const handleConfirm = async () => {
    const clientUuid = uuid();
    try {
      await enqueuePendingRecord('physical_count', {
        clientUuid, batchId, unitId: batch?.unitId,
        systemCount, physicalCount: physCount, variance,
        reason: variance !== 0 ? reason : 'no variance', notes: notes || undefined,
        recordedBy: user?.id, capturedAt: new Date().toISOString(),
      }, clientUuid);
    } catch {
      setError(t('saveFailedRetry')); setShowConfirm(false);
      return;
    }
    setPendingCount(pendingCount + 1);
    setShowConfirm(false);
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
          className="w-full min-h-[56px] bg-orange-600 text-white rounded-xl text-xl font-bold">
          {t('backToHome')}
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-5">
      <div className="bg-orange-700 text-white rounded-2xl px-5 py-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><ListOrdered className="w-6 h-6 shrink-0" /><span>{t('physicalCount')}</span></h1>
        <p className="text-orange-200 text-sm">{t('reconciliationAudit')}</p>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">{t('batch')} / {t('unit')}</label>
        <select value={batchId} onChange={e => { setBatchId(e.target.value); setCounted(''); }}
          className="border-2 border-gray-300 rounded-xl px-4 py-3 bg-white min-h-[52px]">
          <option value="">{t('selectBatch')}</option>
          {batches.map(b => { const u = units.find(u => u.id === b.unitId); return <option key={b.id} value={b.id}>{b.name} · {u?.name} · {b.currentQty} ({t('system')})</option>; })}
        </select>
        {batchId && doneToday('physical_count', batchId).count > 0 && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {t('alreadyCountedTodayAt', { time: timeLabel(doneToday('physical_count', batchId).lastAt) })}</p>
        )}
      </div>

      {batch && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <p className="text-blue-800 font-semibold">{unit?.name} — {batch.name}</p>
          <p className="text-blue-700 text-sm">{t('systemExpects')}: <strong>{systemCount}</strong> {t('openingDeathsSalesNote')}</p>
        </div>
      )}

      {showKeypad ? (
        <div className="bg-white rounded-xl border p-4">
          <NumericKeypad large label={t('youCounted')} value={counted} onChange={setCounted} />
          <button onClick={() => setShowKeypad(false)} className="mt-3 w-full bg-green-600 text-white rounded-xl min-h-[44px] font-semibold">{t('done')}</button>
        </div>
      ) : (
        <button type="button" onClick={() => setShowKeypad(true)}
          className="flex justify-between items-center bg-white border-2 border-gray-300 rounded-xl px-4 py-3 min-h-[64px]">
          <span className="font-medium text-gray-700">{t('youCounted')}</span>
          <span className={`text-4xl font-bold ${counted ? 'text-gray-900' : 'text-gray-400'}`}>{counted || '—'}</span>
        </button>
      )}

      {/* Variance — always needs a recorded reason (BR-12: audited stock adjustment) */}
      {hasVariance && (
        <div className={`rounded-xl px-4 py-3 border-2 ${variance < 0 ? 'bg-red-50 border-red-400' : 'bg-green-50 border-green-400'}`}>
          <p className={`font-bold text-lg ${variance < 0 ? 'text-red-700' : 'text-green-700'}`}>
            {t('variance')} {variance > 0 ? '+' : ''}{variance} — {t('reasonForVariance')}
          </p>
        </div>
      )}
      {hasVariance && (
        <>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">{t('reasonForVariance')} *</label>
            <select value={reason} onChange={e => setReason(e.target.value)}
              className="border-2 border-gray-300 rounded-xl px-4 py-3 bg-white min-h-[52px]">
              <option value="">{t('selectCause')}</option>
              {VARIANCE_REASONS.map(r => <option key={r.value} value={r.value}>{t(r.labelKey)}</option>)}
            </select>
          </div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('additionalNotesPlaceholder')} rows={2}
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm" />
        </>
      )}

      {error && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{error}</p>}
      {loadError && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{loadError}</p>}
      <StaleDataNotice cachedAt={staleAt} />

      <button onClick={handleSubmit} disabled={!batchId || !counted}
        className="w-full min-h-[56px] bg-orange-600 text-white rounded-xl text-xl font-bold disabled:opacity-40">
        {t('submitAdjustment')}
      </button>

      <ConfirmSheet open={showConfirm} danger={hasVariance} title={t('confirmPhysicalCountTitle')}
        summary={hasVariance
          ? t('physicalCountSummaryVariance', { batch: batch?.name ?? '', system: systemCount, counted: physCount, variance: `${variance > 0 ? '+' : ''}${variance}`, reason: t(VARIANCE_REASONS.find(r => r.value === reason)?.labelKey ?? 'otherOption') })
          : t('physicalCountSummaryNoVariance', { batch: batch?.name ?? '', system: systemCount, counted: physCount })}
        confirmLabel={t('confirmPhysicalCount')} onConfirm={handleConfirm} onCancel={() => setShowConfirm(false)} />
    </div>
  );
}
