'use client';
import { Syringe } from 'lucide-react';
import { uuid } from '@/lib/uuid';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { useSyncStore } from '@/lib/stores/sync';
import { api } from '@/lib/api';
import { enqueuePendingRecord } from '@/lib/offline/db';
import { CameraCapture, type CaptureResult } from '@/components/worker/CameraCapture';
import { ConfirmSheet } from '@/components/worker/ConfirmSheet';
import type { Batch, InventoryItem, InventoryLot } from '@/lib/types';

const ROUTES = ['Drinking water','Injection','Oral','Spray','Feed mix'];
const TYPES = ['VACCINE','MEDICATION','SUPPLEMENT','DEWORM','OTHER'];

export default function HealthPage() {
  const { user } = useAuthStore();
  const { setPendingCount, pendingCount } = useSyncStore();
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
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.getBatches(), api.getItems(), api.getLots()]).then(([b,i,l]) => {
      setBatches(b.filter(b => b.status === 'ACTIVE'));
      setItems(i.filter(i => i.category === 'MEDICINE' || i.category === 'VACCINE'));
      setLots(l);
    });
  }, []);

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
    if (!batchId || !lotId || !dose) { setError('Fill all required fields'); setShowConfirm(false); return; }
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
    await enqueuePendingRecord('health', payload, clientUuid);
    setPendingCount(pendingCount + 1);
    setToast('✓ Saved — will sync'); setShowConfirm(false);
    setTimeout(() => router.replace('/worker/home'), 1800);
  };

  const medicineLots = lots.filter(l => {
    const item = items.find(i => i.id === l.itemId);
    return item && (item.category === 'MEDICINE' || item.category === 'VACCINE') && l.qtyOnHand > 0;
  });

  return (
    <div className="p-4 flex flex-col gap-5">
      <div className="bg-blue-700 text-white rounded-2xl px-5 py-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Syringe className="w-6 h-6 shrink-0" /><span>Health / Vaccination</span></h1>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Batch *</label>
        <select value={batchId} onChange={e => setBatchId(e.target.value)}
          className="border-2 border-gray-300 rounded-xl px-4 py-3 bg-white min-h-[52px]">
          <option value="">— Select batch —</option>
          {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Type *</label>
        <select value={type} onChange={e => setType(e.target.value)}
          className="border-2 border-gray-300 rounded-xl px-4 py-3 bg-white min-h-[52px]">
          {TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Product Lot *</label>
        <select value={lotId} onChange={e => setLotId(e.target.value)}
          className="border-2 border-gray-300 rounded-xl px-4 py-3 bg-white min-h-[52px]">
          <option value="">— Select product —</option>
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
          <label className="text-sm font-medium text-gray-700">Dose *</label>
          <input type="number" value={dose} onChange={e => setDose(e.target.value)}
            className={`border-2 rounded-xl px-4 py-3 text-lg min-h-[52px] ${overDose ? 'border-red-400' : 'border-gray-300'}`} placeholder="e.g. 100" />
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Route</label>
          <select value={route} onChange={e => setRoute(e.target.value)}
            className="border-2 border-gray-300 rounded-xl px-4 py-3 bg-white min-h-[52px]">
            <option value="">— Route —</option>
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

      <button onClick={() => { if (!batchId || !lotId || !dose) { setError('Fill batch, product, and dose'); return; } if (overDose) { setError('Dose exceeds what is left in the lot.'); return; } setShowConfirm(true); }}
        disabled={overDose}
        className="w-full min-h-[56px] bg-blue-600 text-white rounded-xl text-xl font-bold disabled:opacity-40">
        SUBMIT
      </button>

      {toast && <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-green-700 text-white px-5 py-3 rounded-xl font-semibold shadow-lg">{toast}</div>}

      <ConfirmSheet open={showConfirm} title="Confirm Treatment" onConfirm={handleConfirm} onCancel={() => setShowConfirm(false)}
        summary={`Applying ${type.toLowerCase()} to ${batches.find(b=>b.id===batchId)?.name ?? 'batch'}.${withdrawalUntil ? ` Withdrawal until ${withdrawalUntil} — no sale before then.` : ''}`}
        confirmLabel="Confirm Treatment"
      />
    </div>
  );
}
