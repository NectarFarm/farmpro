'use client';
import { Skull } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { useWorkerProfileStore } from '@/lib/stores/workerProfile';
import { useSyncStore } from '@/lib/stores/sync';
import { api } from '@/lib/api';
import { enqueuePendingRecord } from '@/lib/offline/db';
import { CameraCapture, type CaptureResult } from '@/components/worker/CameraCapture';
import { ConfirmSheet } from '@/components/worker/ConfirmSheet';
import type { ProductionUnit, Batch } from '@/lib/types';
import { cn } from '@/lib/utils';

const CAUSES = ['Sudden death','Disease','Injury','Unknown','Heat stress','Respiratory','Other'];

export default function MortalityPage() {
  const { user } = useAuthStore();
  const { profile } = useWorkerProfileStore();
  const { setPendingCount, pendingCount } = useSyncStore();
  const router = useRouter();

  const [units, setUnits] = useState<ProductionUnit[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [unitId, setUnitId] = useState('');
  const [count, setCount] = useState(0);
  const [cause, setCause] = useState('');
  const [capture, setCapture] = useState<CaptureResult | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const photoThreshold = profile?.mortalityPhotoThreshold ?? 1;
  const photoRequired = count > photoThreshold;

  const batch = batches.find(b => b.unitId === unitId && b.status === 'ACTIVE');
  const unit = units.find(u => u.id === unitId);

  useEffect(() => {
    Promise.all([api.getUnits(), api.getBatches()]).then(([u,b]) => {
      setUnits(u.filter(u => u.status === 'ACTIVE'));
      setBatches(b.filter(b => b.status === 'ACTIVE'));
    });
  }, []);

  const mortalityRate = batch ? ((count / batch.initialQty) * 100).toFixed(1) : null;
  const threshold = profile?.alertThresholds?.mortalityRate ?? 2.0;
  const rateAbove = mortalityRate && parseFloat(mortalityRate) > threshold;

  const validate = () => {
    if (!unitId) { setError('Select a unit'); return false; }
    if (count < 1) { setError('Enter number of deaths (minimum 1)'); return false; }
    if (batch && count > batch.currentQty) { setError(`Batch has ${batch.currentQty} animals; cannot record ${count} deaths`); return false; }
    if (photoRequired && !capture) { setError(`Photo mandatory above ${photoThreshold} death${photoThreshold !== 1 ? 's' : ''}`); return false; }
    return true;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setShowConfirm(true);
  };

  const handleConfirm = async () => {
    const clientUuid = crypto.randomUUID();
    const payload = {
      clientUuid, unitId, batchId: batch?.id, count, cause: cause || undefined,
      gpsLat: capture?.gpsLat, gpsLng: capture?.gpsLng, gpsAccuracy: capture?.gpsAccuracy, gpsTimestamp: capture?.gpsTimestamp,
      photo: capture?.dataUrl, // the actual compressed image — uploaded on sync
      recordedBy: user?.id, capturedAt: new Date().toISOString(),
    };
    await enqueuePendingRecord('mortality', payload, clientUuid);
    setPendingCount(pendingCount + 1);
    setToast('✓ Saved — will sync'); setShowConfirm(false);
    setTimeout(() => router.replace('/worker/home'), 1500);
  };

  return (
    <div className="p-4 flex flex-col gap-5">
      {/* Header */}
      <div className="bg-red-700 text-white rounded-2xl px-5 py-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Skull className="w-6 h-6 shrink-0" /><span>Record Mortality</span></h1>
      </div>

      {/* Unit select */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Unit</label>
        <select value={unitId} onChange={e => setUnitId(e.target.value)}
          className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base bg-white min-h-[52px]">
          <option value="">— Select unit —</option>
          {units.map(u => {
            const b = batches.find(b => b.unitId === u.id && b.status === 'ACTIVE');
            return <option key={u.id} value={u.id}>{u.name}{b ? ` · ${b.currentQty} animals` : ''}</option>;
          })}
        </select>
        {batch && <p className="text-sm font-semibold text-gray-700">{batch.name} — <span className="text-green-700">{batch.currentQty} animals left</span>{count > 0 ? ` → ${batch.currentQty - count} after` : ''}</p>}
      </div>

      {/* Death stepper — DS-2: small count */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">Deaths{batch ? ` (max ${batch.currentQty})` : ''}</label>
        <div className="flex items-center gap-4 bg-white border-2 border-gray-300 rounded-xl px-5 py-3">
          <button type="button" onClick={() => setCount(c => Math.max(0, c-1))}
            className="w-14 h-14 rounded-xl bg-gray-100 text-3xl font-bold flex items-center justify-center active:bg-gray-200">−</button>
          <span className="flex-1 text-center text-5xl font-bold text-gray-900">{count}</span>
          <button type="button" onClick={() => setCount(c => batch ? Math.min(batch.currentQty, c+1) : c+1)}
            className="w-14 h-14 rounded-xl bg-gray-100 text-3xl font-bold flex items-center justify-center active:bg-gray-200">+</button>
        </div>
        {rateAbove && (
          <p className="text-amber-700 bg-amber-50 rounded-lg px-3 py-2 text-sm font-semibold">
            ▲ Rate now {mortalityRate}% (threshold {threshold}%)
          </p>
        )}
      </div>

      {/* Cause */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Cause (optional)</label>
        <select value={cause} onChange={e => setCause(e.target.value)}
          className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base bg-white min-h-[52px]">
          <option value="">— Select cause —</option>
          {CAUSES.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      {/* Camera — DS-6/7 */}
      <CameraCapture
        label="Evidence Photo"
        required={photoRequired}
        captured={capture}
        onCapture={setCapture}
        onRemove={() => setCapture(null)}
      />

      {/* Error */}
      {error && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{error}</p>}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!unitId}
        className={cn('w-full min-h-[56px] rounded-xl text-xl font-bold text-white', 'bg-red-600 active:bg-red-700 disabled:opacity-40')}>
        SUBMIT
      </button>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-green-700 text-white px-5 py-3 rounded-xl font-semibold shadow-lg">
          {toast}
        </div>
      )}

      <ConfirmSheet
        open={showConfirm} danger
        title="Confirm Mortality Record"
        summary={`Recording ${count} death${count !== 1 ? 's' : ''} in ${unit?.name ?? 'unit'}. Population → ${(batch?.currentQty ?? 0) - count}. This action is audited and cannot be silently undone.`}
        confirmLabel="Confirm Mortality"
        onConfirm={handleConfirm}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}
