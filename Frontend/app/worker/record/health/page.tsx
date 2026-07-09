'use client';
import { Syringe } from 'lucide-react';
import { uuid } from '@/lib/uuid';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuthStore } from '@/lib/stores/auth';
import { useSyncStore } from '@/lib/stores/sync';
import { api } from '@/lib/api';
import { enqueuePendingRecord } from '@/lib/offline/db';
import { useTodayActivity, timeLabel } from '@/lib/hooks/useTodayActivity';
import { CameraCapture, type CaptureResult } from '@/components/worker/CameraCapture';
import { ConfirmSheet } from '@/components/worker/ConfirmSheet';
import { useToast } from '@/hooks/use-toast';
import type { Batch, InventoryItem, InventoryLot } from '@/lib/types';

const ROUTES = ['Drinking water','Injection','Oral','Spray','Feed mix'];
const TYPES = ['VACCINE','MEDICATION','SUPPLEMENT','DEWORM','OTHER'];

export default function HealthPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { setPendingCount, pendingCount } = useSyncStore();
  const { doneToday } = useTodayActivity();
  const router = useRouter();
  const { toast } = useToast();

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

  useEffect(() => {
    Promise.all([api.getBatches(), api.getItems(), api.getLots()]).then(([b,i,l]) => {
      setBatches(b.filter(b => b.status === 'ACTIVE'));
      setItems(i.filter(i => i.category === 'MEDICINE' || i.category === 'VACCINE'));
      setLots(l);
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
    if (!batchId || !lotId || !dose || Number(dose) <= 0) { setError('Fill all required fields with a valid dose'); setShowConfirm(false); return; }
    if (selectedLot && doseNum > selectedLot.qtyOnHand + 1e-6) {
      setError(`Only ${selectedLot.qtyOnHand} ${selectedLot.unit} left in this lot — you entered ${doseNum}.`); setShowConfirm(false); return;
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
    toast({ description: '✓ Saved — will sync' }); setShowConfirm(false);
    setTimeout(() => router.replace('/worker/home'), 1800);
  };

  const medicineLots = lots.filter(l => {
    const item = items.find(i => i.id === l.itemId);
    return item && (item.category === 'MEDICINE' || item.category === 'VACCINE') && l.qtyOnHand > 0;
  });

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
          <p className="text-xs font-semibold text-amber-600">⚠ This batch already had a health record today at {timeLabel(doneToday('health', batchId).lastAt)}. Only record again if it&apos;s a separate treatment.</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">{t('treatmentType')} *</label>
        <select value={type} onChange={e => setType(e.target.value)}
          className="border-2 border-gray-300 rounded-xl px-4 py-3 bg-white min-h-[52px]">
          {TYPES.map(t => <option key={t}>{t}</option>)}
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
          <p className={`text-xs font-semibold ${overDose ? 'text-red-600' : 'text-gray-500'}`}>
            {overDose
              ? `⚠ Only ${available} ${selectedLot.unit} left in this lot — you entered ${doseNum}. Record a purchase or reduce the dose.`
              : `${available} ${selectedLot.unit} in this lot${doseNum > 0 ? ` · ${Math.round((available - doseNum) * 1000) / 1000} left after` : ''}`}
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
            {ROUTES.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
      </div>

      {/* Withdrawal info — BR-WD food safety */}
      {withdrawalUntil && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded-xl px-4 py-3">
          <p className="text-amber-800 font-bold text-sm">⚠ Withdrawal until {withdrawalUntil}</p>
          <p className="text-amber-700 text-xs mt-0.5">No sale of product from this batch before {withdrawalUntil}.</p>
          <p className="text-amber-700 text-xs">Next due: {nextDue}</p>
        </div>
      )}

      <CameraCapture label="Evidence Photo" captured={capture} onCapture={setCapture} onRemove={() => setCapture(null)} />

      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)…" rows={2}
        className="border border-gray-300 rounded-xl px-3 py-2 text-sm" />

      {error && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{error}</p>}
      {loadError && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{loadError}</p>}

      <button onClick={() => { if (!batchId || !lotId || !dose || Number(dose) <= 0) { setError('Fill batch, product, and a valid dose'); return; } if (overDose) { setError('Dose exceeds what is left in the lot.'); return; } setShowConfirm(true); }}
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
