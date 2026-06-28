'use client';
import { Scale } from 'lucide-react';
import { uuid } from '@/lib/uuid';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { useSyncStore } from '@/lib/stores/sync';
import { api } from '@/lib/api';
import { enqueuePendingRecord } from '@/lib/offline/db';
import { NumericKeypad } from '@/components/worker/NumericKeypad';
import type { Batch } from '@/lib/types';

export default function WeightSamplingPage() {
  const { user } = useAuthStore();
  const { setPendingCount, pendingCount } = useSyncStore();
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState('');
  const [sampleSize, setSampleSize] = useState('10');
  const [avgWeight, setAvgWeight] = useState('');
  const [activeField, setActiveField] = useState<'size'|'weight'|null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    api.getBatches().then(b => setBatches(b.filter(b => b.status === 'ACTIVE')));
  }, []);

  const [now] = useState(() => Date.now());
  const batch = batches.find(b => b.id === batchId);
  const acquiredDate = batch ? new Date(batch.acquiredDate) : null;
  const daysOnFarm = acquiredDate ? Math.floor((now - acquiredDate.getTime()) / 86400000) : 0;
  const startWeight = 0.04; // 40g day-old chick approx
  const avgKg = parseFloat(avgWeight) || 0;
  const adg = daysOnFarm > 0 && avgKg > 0 ? (((avgKg - startWeight) / daysOnFarm) * 1000).toFixed(0) : null;
  const projectedDays = adg && avgKg ? Math.round((2.5 - avgKg) / (parseFloat(adg)/1000)) : null;

  const handleSubmit = async () => {
    if (!batchId || !avgWeight) return;
    const clientUuid = uuid();
    await enqueuePendingRecord('weight_sample', { clientUuid, batchId, sampleSize: parseInt(sampleSize)||10, avgWeightKg: avgKg, measuredAt: new Date().toISOString(), measuredBy: user?.id }, clientUuid);
    setPendingCount(pendingCount + 1);
    setToast('✓ Saved — will sync');
    setTimeout(() => router.replace('/worker/home'), 1500);
  };

  return (
    <div className="p-4 flex flex-col gap-5">
      <div className="bg-purple-700 text-white rounded-2xl px-5 py-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Scale className="w-6 h-6 shrink-0" /><span>Weight Sampling</span></h1>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Batch</label>
        <select value={batchId} onChange={e => setBatchId(e.target.value)}
          className="border-2 border-gray-300 rounded-xl px-4 py-3 bg-white min-h-[52px]">
          <option value="">— Select batch —</option>
          {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {activeField === 'size' ? (
        <div className="bg-white rounded-xl border p-4">
          <NumericKeypad label="Sample size (animals)" value={sampleSize} onChange={setSampleSize} />
          <button onClick={() => setActiveField(null)} className="mt-3 w-full bg-green-600 text-white rounded-xl min-h-[44px] font-semibold">Done</button>
        </div>
      ) : (
        <button type="button" onClick={() => setActiveField('size')}
          className="flex justify-between items-center bg-white border-2 border-gray-300 rounded-xl px-4 py-3 min-h-[56px]">
          <span className="font-medium text-gray-700">Sample size</span>
          <span className="text-2xl font-bold text-gray-900">{sampleSize} animals</span>
        </button>
      )}

      {activeField === 'weight' ? (
        <div className="bg-white rounded-xl border p-4">
          <NumericKeypad large label="Average weight (kg)" value={avgWeight} onChange={setAvgWeight} allowDecimal unit="kg" />
          <button onClick={() => setActiveField(null)} className="mt-3 w-full bg-green-600 text-white rounded-xl min-h-[44px] font-semibold">Done</button>
        </div>
      ) : (
        <button type="button" onClick={() => setActiveField('weight')}
          className="flex justify-between items-center bg-white border-2 border-gray-300 rounded-xl px-4 py-3 min-h-[56px]">
          <span className="font-medium text-gray-700">Average weight</span>
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

      <button onClick={handleSubmit} disabled={!batchId || !avgWeight}
        className="w-full min-h-[56px] bg-purple-600 text-white rounded-xl text-xl font-bold disabled:opacity-40">
        SAVE
      </button>

      {toast && <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-green-700 text-white px-5 py-3 rounded-xl font-semibold shadow-lg">{toast}</div>}
    </div>
  );
}
