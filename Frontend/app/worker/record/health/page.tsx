'use client';
import { Syringe, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { uuid } from '@/lib/uuid';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation, type TranslationKey } from '@/lib/i18n/useTranslation';
import { useAuthStore } from '@/lib/stores/auth';
import { useSyncStore } from '@/lib/stores/sync';
import { cachedApi } from '@/lib/offline/refCache';
import { enqueuePendingRecord } from '@/lib/offline/db';
import { useTodayActivity, timeLabel } from '@/lib/hooks/useTodayActivity';
import { CameraCapture, type CaptureResult } from '@/components/worker/CameraCapture';
import { ConfirmSheet } from '@/components/worker/ConfirmSheet';
import { StaleDataNotice } from '@/components/worker/StaleDataNotice';
import type { Batch, InventoryItem, InventoryLot } from '@/lib/types';

// value = canonical string stored on the record; labelKey = translated display text.
const ROUTES: { value: string; labelKey: TranslationKey }[] = [
  { value: 'Drinking water', labelKey: 'routeDrinkingWater' },
  { value: 'Injection', labelKey: 'routeInjection' },
  { value: 'Oral', labelKey: 'routeOral' },
  { value: 'Spray', labelKey: 'routeSpray' },
  { value: 'Feed mix', labelKey: 'routeFeedMix' },
];
const TYPES: { value: string; labelKey: TranslationKey }[] = [
  { value: 'VACCINE', labelKey: 'treatmentVaccine' },
  { value: 'MEDICATION', labelKey: 'treatmentMedication' },
  { value: 'SUPPLEMENT', labelKey: 'treatmentSupplement' },
  { value: 'DEWORM', labelKey: 'treatmentDeworm' },
  { value: 'OTHER', labelKey: 'otherOption' },
];

export default function HealthPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { setPendingCount, pendingCount } = useSyncStore();
  const { doneToday } = useTodayActivity();
  const router = useRouter();

  const [batches, setBatches] = useState<Batch[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [batchId, setBatchId] = useState('');
  const [type, setType] = useState('VACCINE');
  const [lotId, setLotId] = useState('');
  const [dose, setDose] = useState('');
  const [route, setRoute] = useState('');
  const [notes, setNotes] = useState('');
  const [capture, setCapture] = useState<CaptureResult | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [staleAt, setStaleAt] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([cachedApi.getBatches(), cachedApi.getItems(), cachedApi.getLots()]).then(([b,i,l]) => {
      setBatches(b.data.filter(b => b.status === 'ACTIVE'));
      setItems(i.data.filter(i => i.category === 'MEDICINE' || i.category === 'VACCINE'));
      setLots(l.data);
      setStaleAt(b.cachedAt ?? i.cachedAt ?? l.cachedAt);
    }).catch(() => setLoadError(t('loadFormDataFailed')));
  }, [t]);

  const selectedLot = lots.find(l => l.id === lotId);
  const available = selectedLot?.qtyOnHand ?? 0;
  const doseNum = parseFloat(dose) || 0;
  const overDose = !!selectedLot && doseNum > available + 1e-6; // can't give more than the lot holds
  const withdrawalDays = selectedLot?.withdrawalDays ?? 0;
  const appliedAt = new Date();
  const withdrawalUntil = withdrawalDays > 0
    ? new Date(appliedAt.getTime() + withdrawalDays * 86400000).toLocaleDateString('en-KE')
    : null;
  const nextDue = new Date(appliedAt.getTime() + 30 * 86400000).toLocaleDateString('en-KE');

  const handleConfirm = async () => {
    if (!batchId || !lotId || !dose || Number(dose) <= 0) { setError(t('fillRequiredValidDose')); setShowConfirm(false); return; }
    if (selectedLot && doseNum > selectedLot.qtyOnHand + 1e-6) {
      setError(t('onlyLeftInLot', { qty: selectedLot.qtyOnHand, unit: selectedLot.unit, entered: doseNum })); setShowConfirm(false); return;
    }
    const clientUuid = uuid();
    const payload = {
      clientUuid, batchId, type, productLotId: lotId, dose: parseFloat(dose),
      route, notes: notes || undefined, appliedBy: user?.id,
      appliedAt: appliedAt.toISOString(),
      withdrawalUntil: withdrawalDays > 0 ? new Date(appliedAt.getTime() + withdrawalDays * 86400000).toISOString() : undefined,
      nextDueAt: new Date(appliedAt.getTime() + 30 * 86400000).toISOString(),
      hasPhoto: !!capture, capturedAt: appliedAt.toISOString(),
    };
    try {
      await enqueuePendingRecord('health', payload, clientUuid);
    } catch {
      setError(t('saveFailedRetry')); setShowConfirm(false);
      return;
    }
    setPendingCount(pendingCount + 1);
    setShowConfirm(false);
    // No timed redirect — explicit success state + Done button (item 8).
    setSaved(true);
  };

  const medicineLots = lots.filter(l => {
    const item = items.find(i => i.id === l.itemId);
    return item && (item.category === 'MEDICINE' || item.category === 'VACCINE') && l.qtyOnHand > 0;
  });

  if (saved) {
    return (
      <div className="p-4 flex flex-col gap-5">
        <div className="bg-green-50 border border-green-300 rounded-2xl p-6 text-center">
          <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-2" />
          <h1 className="text-xl font-bold text-green-800">{t('savedWillSync')}</h1>
        </div>
        <button onClick={() => router.replace('/worker/home')}
          className="w-full min-h-[56px] bg-green-600 text-white rounded-xl text-xl font-bold">
          {t('backToHome')}
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-5">
      <div className="bg-blue-700 text-white rounded-2xl px-5 py-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Syringe className="w-6 h-6 shrink-0" /><span>{t('healthVaccination')}</span></h1>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">{t('batch')} *</label>
        <select value={batchId} onChange={e => setBatchId(e.target.value)}
          className="border-2 border-gray-300 rounded-xl px-4 py-3 bg-white min-h-[52px]">
          <option value="">{t('selectBatch')}</option>
          {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {batchId && doneToday('health', batchId).count > 0 && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {t('alreadyHealthRecordToday', { time: timeLabel(doneToday('health', batchId).lastAt) })}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">{t('treatmentType')} *</label>
        <select value={type} onChange={e => setType(e.target.value)}
          className="border-2 border-gray-300 rounded-xl px-4 py-3 bg-white min-h-[52px]">
          {TYPES.map(ty => <option key={ty.value} value={ty.value}>{t(ty.labelKey)}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">{t('productLot')} *</label>
        <select value={lotId} onChange={e => setLotId(e.target.value)}
          className="border-2 border-gray-300 rounded-xl px-4 py-3 bg-white min-h-[52px]">
          <option value="">{t('selectProduct')}</option>
          {medicineLots.map(l => {
            const item = items.find(i => i.id === l.itemId);
            return <option key={l.id} value={l.id}>{item?.name} · Lot {l.lotNo} · {l.qtyOnHand} {l.unit}{l.withdrawalDays ? ` · WD ${l.withdrawalDays}d` : ''}</option>;
          })}
        </select>
        {selectedLot && (
          <p className={`flex items-center gap-1.5 text-xs font-semibold ${overDose ? 'text-red-600' : 'text-gray-500'}`}>
            {overDose && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
            {overDose
              ? t('onlyLeftInLot', { qty: available, unit: selectedLot.unit, entered: doseNum })
              : `${available} ${selectedLot.unit} ${t('onHand')}${doseNum > 0 ? ` · ${Math.round((available - doseNum) * 1000) / 1000} ${t('onHand')}` : ''}`}
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">{t('dosage')} *</label>
          <input type="number" min="0" value={dose} onChange={e => setDose(e.target.value)}
            className={`border-2 rounded-xl px-4 py-3 text-lg min-h-[52px] ${overDose ? 'border-red-400' : 'border-gray-300'}`} placeholder="e.g. 100" />
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">{t('applicationRoute')}</label>
          <select value={route} onChange={e => setRoute(e.target.value)}
            className="border-2 border-gray-300 rounded-xl px-4 py-3 bg-white min-h-[52px]">
            <option value="">{t('route')}</option>
            {ROUTES.map(r => <option key={r.value} value={r.value}>{t(r.labelKey)}</option>)}
          </select>
        </div>
      </div>

      {/* Withdrawal info — food-safety hold period on the treated batch */}
      {withdrawalUntil && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded-xl px-4 py-3">
          <p className="flex items-center gap-1.5 text-amber-800 font-bold text-sm"><AlertTriangle className="w-4 h-4 shrink-0" /> {t('withdrawalUntilDate', { date: withdrawalUntil })}</p>
          <p className="text-amber-700 text-xs mt-0.5">{t('noSaleBeforeDate', { date: withdrawalUntil })}</p>
          <p className="text-amber-700 text-xs">{t('nextDueDate', { date: nextDue })}</p>
        </div>
      )}

      <CameraCapture label={t('evidencePhoto')} captured={capture} onCapture={setCapture} onRemove={() => setCapture(null)} />

      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('notesOptionalPlaceholder')} rows={2}
        className="border border-gray-300 rounded-xl px-3 py-2 text-sm" />

      {error && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{error}</p>}
      {loadError && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{loadError}</p>}
      <StaleDataNotice cachedAt={staleAt} />

      <button onClick={() => { if (!batchId || !lotId || !dose || Number(dose) <= 0) { setError(t('fillBatchProductDose')); return; } if (overDose) { setError(t('doseExceedsLot')); return; } setShowConfirm(true); }}
        disabled={overDose}
        className="w-full min-h-[56px] bg-blue-600 text-white rounded-xl text-xl font-bold disabled:opacity-40">
        {t('submit')}
      </button>

      <ConfirmSheet open={showConfirm} title={t('confirmTreatment')} onConfirm={handleConfirm} onCancel={() => setShowConfirm(false)}
        summary={`${t('applyingTreatmentSummary', { type: type.toLowerCase(), batch: batches.find(b => b.id === batchId)?.name ?? t('batch') })}${withdrawalUntil ? ` ${t('withdrawalNoSaleNote', { date: withdrawalUntil })}` : ''}`}
        confirmLabel={t('confirmTreatment')}
      />
    </div>
  );
}
