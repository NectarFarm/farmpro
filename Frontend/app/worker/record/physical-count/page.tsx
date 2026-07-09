'use client';
import { ListOrdered } from 'lucide-react';
import { uuid } from '@/lib/uuid';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuthStore } from '@/lib/stores/auth';
import { useSyncStore } from '@/lib/stores/sync';
import { api } from '@/lib/api';
import { enqueuePendingRecord } from '@/lib/offline/db';
import { useTodayActivity, timeLabel } from '@/lib/hooks/useTodayActivity';
import { NumericKeypad } from '@/components/worker/NumericKeypad';
import { ConfirmSheet } from '@/components/worker/ConfirmSheet';
import { useToast } from '@/hooks/use-toast';
import type { Batch, ProductionUnit } from '@/lib/types';

const VARIANCE_REASONS = ['Missing — suspected theft','Found extra (uncounted)','Uncounted deaths','Transfer not recorded','Counting error','Other'];

export default function PhysicalCountPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { setPendingCount, pendingCount } = useSyncStore();
  const { doneToday } = useTodayActivity();
  const router = useRouter();
  const { toast } = useToast();

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

  useEffect(() => {
    Promise.all([api.getBatches(), api.getUnits()]).then(([b,u]) => {
      setBatches(b.filter(b => b.status === 'ACTIVE'));
      setUnits(u);
    }).catch(() => setLoadError(t('loadFormDataFailed')));
  }, [t]);

  const batch = batches.find(b => b.id === batchId);
  const unit = units.find(u => u.id === batch?.unitId);
  const systemCount = batch?.currentQty ?? 0;
  const physCount = parseInt(counted) || 0;
  const variance = physCount - systemCount;
  const hasVariance = counted !== '' && variance !== 0;

  const handleSubmit = () => {
    if (!batchId) { setError('Select a batch'); return; }
    if (!counted) { setError('Enter physical count'); return; }
    if (hasVariance && !reason) { setError('Variance requires a reason (BR-12)'); return; }
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
    toast({ description: '✓ Saved — will sync' }); setShowConfirm(false);
    setTimeout(() => router.replace('/worker/home'), 1500);
  };

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
          {batches.map(b => { const u = units.find(u => u.id === b.unitId); return <option key={b.id} value={b.id}>{b.name} · {u?.name} · {b.currentQty} (system)</option>; })}
        </select>
        {batchId && doneToday('physical_count', batchId).count > 0 && (
          <p className="text-xs font-semibold text-amber-600">⚠ Already counted today at {timeLabel(doneToday('physical_count', batchId).lastAt)}.</p>
        )}
      </div>

      {batch && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <p className="text-blue-800 font-semibold">{unit?.name} — {batch.name}</p>
          <p className="text-blue-700 text-sm">System expects: <strong>{systemCount}</strong> (opening − deaths − sales)</p>
        </div>
      )}

      {showKeypad ? (
        <div className="bg-white rounded-xl border p-4">
          <NumericKeypad large label={t('youCounted')} value={counted} onChange={setCounted} />
          <button onClick={() => setShowKeypad(false)} className="mt-3 w-full bg-green-600 text-white rounded-xl min-h-[44px] font-semibold">Done</button>
        </div>
      ) : (
        <button type="button" onClick={() => setShowKeypad(true)}
          className="flex justify-between items-center bg-white border-2 border-gray-300 rounded-xl px-4 py-3 min-h-[64px]">
          <span className="font-medium text-gray-700">{t('youCounted')}</span>
          <span className={`text-4xl font-bold ${counted ? 'text-gray-900' : 'text-gray-400'}`}>{counted || '—'}</span>
        </button>
      )}

      {/* Variance */}
      {hasVariance && (
        <div className={`rounded-xl px-4 py-3 border-2 ${variance < 0 ? 'bg-red-50 border-red-400' : 'bg-green-50 border-green-400'}`}>
          <p className={`font-bold text-lg ${variance < 0 ? 'text-red-700' : 'text-green-700'}`}>
            {t('variance')} {variance > 0 ? '+' : ''}{variance} — {t('reasonForVariance')} (BR-12)
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
              {VARIANCE_REASONS.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional notes…" rows={2}
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm" />
        </>
      )}

      {error && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{error}</p>}
      {loadError && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{loadError}</p>}

      <button onClick={handleSubmit} disabled={!batchId || !counted}
        className="w-full min-h-[56px] bg-orange-600 text-white rounded-xl text-xl font-bold disabled:opacity-40">
        {t('submitAdjustment')}
      </button>

      <ConfirmSheet open={showConfirm} danger={hasVariance} title="Confirm Physical Count"
        summary={`${batch?.name}: system ${systemCount} → you counted ${physCount}${hasVariance ? `. Variance ${variance > 0 ? '+' : ''}${variance}: "${reason}"` : ' (no variance)'}. This is an audited adjustment.`}
        confirmLabel="Submit Count" onConfirm={handleConfirm} onCancel={() => setShowConfirm(false)} />
    </div>
  );
}
