'use client';
import { Wheat, Plus, X } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { useSyncStore } from '@/lib/stores/sync';
import { api } from '@/lib/api';
import { enqueuePendingRecord } from '@/lib/offline/db';
import type { Batch, InventoryItem, InventoryLot } from '@/lib/types';

type Row = { itemId: string; qty: string; leftover: string };

export default function FeedingPage() {
  const { user } = useAuthStore();
  const { setPendingCount, pendingCount } = useSyncStore();
  const router = useRouter();

  const [batches, setBatches] = useState<Batch[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [batchId, setBatchId] = useState('');
  const [rows, setRows] = useState<Row[]>([{ itemId: '', qty: '', leftover: '' }]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([api.getBatches(), api.getItems(), api.getLots()]).then(([b, i, l]) => {
      setBatches(b.filter(b => b.status === 'ACTIVE'));
      setItems(i.filter(i => i.category.startsWith('FEED')));
      setLots(l);
    });
  }, []);

  const onHand = (itemId: string) => lots.filter(l => l.itemId === itemId).reduce((s, l) => s + l.qtyOnHand, 0);
  const itemOf = (id: string) => items.find(i => i.id === id);
  const activeLot = (itemId: string) => lots.filter(l => l.itemId === itemId && l.qtyOnHand > 0).sort((a, b) => (a.receivedDate < b.receivedDate ? -1 : 1))[0];

  const setRow = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addRow = () => setRows(rs => [...rs, { itemId: '', qty: '', leftover: '' }]);
  const removeRow = (i: number) => setRows(rs => rs.filter((_, idx) => idx !== i));

  const rowOver = (r: Row) => !!r.itemId && (parseFloat(r.qty) || 0) > onHand(r.itemId);
  const anyOver = rows.some(rowOver);
  const validRows = rows.filter(r => r.itemId && (parseFloat(r.qty) || 0) > 0);

  const handleSubmit = async () => {
    if (!batchId) { setError('Select a batch'); return; }
    if (!validRows.length) { setError('Add at least one feed with a quantity'); return; }
    if (anyOver) { setError('One feed is more than what is in stock'); return; }
    const ids = validRows.map(r => r.itemId);
    if (new Set(ids).size !== ids.length) { setError('The same feed is listed twice — combine them into one'); return; }
    setLoading(true); setError('');
    const at = new Date().toISOString();
    for (const r of validRows) {
      const clientUuid = crypto.randomUUID();
      await enqueuePendingRecord('feeding', {
        clientUuid, batchId, feedItemId: r.itemId, lotId: activeLot(r.itemId)?.id,
        quantityKg: parseFloat(r.qty), leftoverKg: parseFloat(r.leftover) || undefined,
        recordedBy: user?.id, capturedAt: at,
      }, clientUuid);
    }
    setPendingCount(pendingCount + validRows.length);
    setToast(`✓ ${validRows.length} feed${validRows.length > 1 ? 's' : ''} saved — will sync`);
    setLoading(false);
    setTimeout(() => router.replace('/worker/home'), 1500);
  };

  return (
    <div className="p-4 flex flex-col gap-5">
      <div className="bg-green-700 text-white rounded-2xl px-5 py-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Wheat className="w-6 h-6 shrink-0" /><span>Feeding Log</span></h1>
        <p className="text-green-200 text-sm">Record every feed given to this batch — add as many as you used.</p>
      </div>

      {/* Batch */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Batch</label>
        <select value={batchId} onChange={e => setBatchId(e.target.value)}
          className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base bg-white min-h-[52px]">
          <option value="">— Select batch —</option>
          {batches.map(b => <option key={b.id} value={b.id}>{b.name} · {b.currentQty} animals</option>)}
        </select>
      </div>

      {/* Feed rows — pick a specific feed; add another for the same batch */}
      <div className="flex flex-col gap-3">
        <label className="text-sm font-medium text-gray-700">Feeds given</label>
        {rows.map((r, i) => {
          const it = itemOf(r.itemId);
          const stock = r.itemId ? onHand(r.itemId) : 0;
          const over = rowOver(r);
          return (
            <div key={i} className="bg-white border-2 border-gray-200 rounded-xl p-3 flex flex-col gap-2">
              <div className="flex gap-2 items-center">
                <select value={r.itemId} onChange={e => setRow(i, { itemId: e.target.value, qty: '' })}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[44px] bg-white">
                  <option value="">— Pick a feed —</option>
                  {items.map(fi => { const s = onHand(fi.id); return <option key={fi.id} value={fi.id}>{fi.name} — {s} {fi.unit} left{s < fi.lowStockThreshold ? ' ⚠ LOW' : ''}</option>; })}
                </select>
                {rows.length > 1 && <button type="button" onClick={() => removeRow(i)} aria-label="Remove" className="text-gray-400 hover:text-red-600 p-2"><X className="w-5 h-5" /></button>}
              </div>
              {r.itemId && (
                <>
                  <div className="flex gap-2 items-center">
                    <input type="number" min="0" inputMode="decimal" value={r.qty} onChange={e => setRow(i, { qty: e.target.value })}
                      placeholder={`Given (${it?.unit ?? 'kg'})`} className={`flex-1 border-2 rounded-lg px-3 py-2 text-base min-h-[48px] ${over ? 'border-red-400 text-red-600' : 'border-gray-300'}`} />
                    <input type="number" min="0" inputMode="decimal" value={r.leftover} onChange={e => setRow(i, { leftover: e.target.value })}
                      placeholder="Leftover (opt)" className="w-28 border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-[48px]" />
                  </div>
                  <p className={`text-xs ${over ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{over ? `Only ${stock} ${it?.unit} in stock` : `${stock} ${it?.unit} in stock`}</p>
                </>
              )}
            </div>
          );
        })}
        <button type="button" onClick={addRow} className="self-start flex items-center gap-1 text-green-700 font-semibold text-sm"><Plus className="w-4 h-4" /> Add another feed</button>
      </div>

      {error && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{error}</p>}

      <button onClick={handleSubmit} disabled={loading || !batchId || !validRows.length || anyOver}
        className="w-full min-h-[56px] bg-green-600 text-white rounded-xl text-xl font-bold disabled:opacity-40">
        {loading ? 'Saving…' : anyOver ? 'A feed exceeds stock' : `SUBMIT${validRows.length > 1 ? ` (${validRows.length} feeds)` : ''}`}
      </button>

      {toast && <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-green-700 text-white px-5 py-3 rounded-xl font-semibold shadow-lg">{toast}</div>}
    </div>
  );
}
