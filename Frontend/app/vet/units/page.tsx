'use client';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { api } from '@/lib/api';
import type { Batch, HealthRecord } from '@/lib/types';

export default function VetUnitsPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthRecord[]>([]);
  const [showPrescription, setShowPrescription] = useState(false);
  const [prescription, setPrescription] = useState({ product: '', dose: '', route: '', withdrawal: '', notes: '' });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prescribeError, setPrescribeError] = useState('');

  useEffect(() => {
    if (!user) { router.replace('/owner/login'); return; }
    api.getBatches().then(b => setBatches(b.filter(b => b.status === 'ACTIVE')));
  }, [user, router]);

  useEffect(() => {
    if (selected) api.getHealthRecords(selected).then(setHealth);
  }, [selected]);

  const handlePrescribe = async () => {
    if (!selected) return;
    if (!prescription.product.trim()) { setPrescribeError('Enter a product / treatment.'); return; }
    setSaving(true); setPrescribeError('');
    try {
      await api.prescribe({
        batchId: selected,
        product: prescription.product.trim(),
        dose: Number(prescription.dose) || 0,
        route: prescription.route.trim(),
        withdrawal: prescription.withdrawal,
        notes: prescription.notes.trim(),
      });
      setSaved(true);
      setShowPrescription(false);
      setPrescription({ product: '', dose: '', route: '', withdrawal: '', notes: '' });
      api.getHealthRecords(selected).then(setHealth);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setPrescribeError((e as Error).message || 'Could not submit the prescription. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 flex flex-col gap-5 max-w-3xl mx-auto">
      <div className="bg-teal-700 text-white rounded-2xl px-6 py-5">
        <h1 className="text-2xl font-bold">🩺 Vet / Agronomist Portal</h1>
        <p className="text-teal-200 text-sm">Dr. {user?.name} — Assigned units only (FR-M5-5)</p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
        <p className="text-amber-800 text-sm font-semibold">Read + Prescribe only. No financial data. No other farms.</p>
      </div>

      {/* Unit list */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-bold text-gray-800 mb-3">Assigned Batches</h2>
        <div className="flex flex-col gap-2">
          {batches.map(b => (
            <button key={b.id} onClick={() => setSelected(selected === b.id ? null : b.id)}
              className={`flex items-center justify-between px-4 py-3 rounded-xl border-2 text-left transition-colors ${selected === b.id ? 'border-teal-500 bg-teal-50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'}`}>
              <div>
                <p className="font-semibold text-gray-900">{b.name}</p>
                <p className="text-xs text-gray-500">{b.species} · {b.currentQty} animals · Stage: {b.stage}</p>
              </div>
              <span className="text-gray-400">{selected === b.id ? '▲' : '▼'}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Health timeline */}
      {selected && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-800">Health Timeline — {batches.find(b=>b.id===selected)?.name}</h2>
            <button onClick={() => setShowPrescription(true)}
              className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-semibold">
              + Prescription
            </button>
          </div>
          {health.length === 0
            ? <p className="text-gray-400 text-sm">No health records for this batch.</p>
            : (
              <div className="flex flex-col gap-3">
                {health.map(h => (
                  <div key={h.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-3 h-3 rounded-full bg-teal-500 mt-1" />
                      <div className="flex-1 w-0.5 bg-gray-200 mt-1" />
                    </div>
                    <div className="pb-3">
                      <p className="font-semibold text-gray-900 text-sm">{h.type} — {new Date(h.appliedAt).toLocaleDateString('en-KE')}</p>
                      <p className="text-xs text-gray-500">Dose: {h.dose} · Route: {h.route || '—'}</p>
                      {h.withdrawalUntil && <p className="text-xs text-amber-600">⚠ Withdrawal until {new Date(h.withdrawalUntil).toLocaleDateString('en-KE')}</p>}
                      {h.nextDueAt && <p className="text-xs text-blue-500">Next due: {new Date(h.nextDueAt).toLocaleDateString('en-KE')}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )
          }

          {showPrescription && (
            <div className="mt-4 border-t pt-4 flex flex-col gap-3">
              <h3 className="font-bold text-gray-800">New Prescription / Advisory Note</h3>
              <input value={prescription.product} onChange={e => setPrescription(p=>({...p,product:e.target.value}))} placeholder="Product / treatment" className="border-2 border-gray-300 rounded-xl px-4 py-2 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <input value={prescription.dose} onChange={e => setPrescription(p=>({...p,dose:e.target.value}))} placeholder="Dose" className="border-2 border-gray-300 rounded-xl px-4 py-2 text-sm" />
                <input value={prescription.route} onChange={e => setPrescription(p=>({...p,route:e.target.value}))} placeholder="Route" className="border-2 border-gray-300 rounded-xl px-4 py-2 text-sm" />
              </div>
              <input value={prescription.withdrawal} onChange={e => setPrescription(p=>({...p,withdrawal:e.target.value}))} placeholder="Withdrawal period (days)" type="number" className="border-2 border-gray-300 rounded-xl px-4 py-2 text-sm" />
              <textarea value={prescription.notes} onChange={e => setPrescription(p=>({...p,notes:e.target.value}))} placeholder="Advisory notes…" rows={2} className="border border-gray-300 rounded-xl px-3 py-2 text-sm" />
              {prescribeError && <p className="text-red-600 text-sm font-semibold">⚠ {prescribeError}</p>}
              <div className="flex gap-2">
                <button onClick={handlePrescribe} disabled={saving}
                  className="flex-1 bg-teal-600 text-white rounded-xl py-2.5 font-semibold disabled:opacity-60">
                  {saving ? 'Submitting…' : 'Submit Prescription'}
                </button>
                <button onClick={() => { setShowPrescription(false); setPrescribeError(''); }} disabled={saving}
                  className="flex-1 bg-gray-100 text-gray-700 rounded-xl py-2.5 font-semibold disabled:opacity-60">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {saved && <p className="text-green-600 font-semibold text-sm mt-2">✓ Prescription submitted — owner/worker notified</p>}
        </div>
      )}
    </div>
  );
}
