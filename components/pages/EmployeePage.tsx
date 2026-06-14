'use client';
import { useState, useMemo } from 'react';
import { Egg, Wheat, Skull, CheckCircle, Bird, AlertTriangle } from 'lucide-react';
import { useFarmStore } from '@/lib/store';
import { generateId } from '@/lib/utils';
import { toast } from 'sonner';

function today() { return new Date().toISOString().slice(0, 10); }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-green-500';

export default function EmployeePage() {
  const {
    session, flocks,
    addEggCollection, addMortalityRecord, addFeedDispenseRecord,
    eggCollections, feedDispenseRecords, mortalityRecords, feedInventory,
  } = useFarmStore();

  const layerFlocks = flocks.filter(f => f.stage === 'layer');
  const allFlocks = flocks;

  const FCR_RECS: Record<string, number> = {
    brooder: 15,
    grower: 30,
    layer: 110,
    disposal: 110,
  };

  // Egg form
  const [eggFlock, setEggFlock] = useState('');
  const [eggDate, setEggDate] = useState(today());
  const [eggCount, setEggCount] = useState('');
  const [eggBroken, setEggBroken] = useState('0');

  // Feed form
  const [feedFlock, setFeedFlock] = useState('');
  const [feedDate, setFeedDate] = useState(today());
  const [feedQty, setFeedQty] = useState('');
  const [feedType, setFeedType] = useState<'starter' | 'grower' | 'layer' | 'finisher'>('layer');
  const [feedNotes, setFeedNotes] = useState('');

  // Mortality form
  const [mortFlock, setMortFlock] = useState('');
  const [mortDate, setMortDate] = useState(today());
  const [mortCount, setMortCount] = useState('');
  const [mortCause, setMortCause] = useState('');

  const selectedInventory = useMemo(
    () => feedInventory.find(fi => fi.feedType === feedType),
    [feedInventory, feedType]
  );

  const stockWarning = useMemo(() => {
    const qty = parseFloat(feedQty);
    if (!isNaN(qty) && qty > 0 && selectedInventory && qty > selectedInventory.currentStockKg) {
      return `Only ${selectedInventory.currentStockKg.toFixed(1)} kg available in stock`;
    }
    return null;
  }, [feedQty, selectedInventory]);

  function submitEgg() {
    if (!eggFlock) { toast.error('Select a flock'); return; }
    const cnt = parseInt(eggCount);
    const brk = parseInt(eggBroken) || 0;
    if (isNaN(cnt) || cnt < 0) { toast.error('Enter a valid egg count'); return; }
    if (brk < 0 || brk > cnt) { toast.error('Broken count cannot exceed total count'); return; }
    if (eggDate > today()) { toast.error('Date cannot be in the future'); return; }
    addEggCollection({
      id: generateId(),
      flockId: eggFlock,
      date: eggDate,
      count: cnt,
      broken: brk,
      sellable: cnt - brk,
      createdAt: new Date().toISOString(),
    });
    toast.success(`Logged ${cnt} eggs (${brk} broken)`);
    setEggCount('');
    setEggBroken('0');
  }

  function submitFeed() {
    if (!feedFlock) { toast.error('Select a flock'); return; }
    const qty = parseFloat(feedQty);
    if (isNaN(qty) || qty <= 0) { toast.error('Enter valid quantity'); return; }
    if (feedDate > today()) { toast.error('Date cannot be in the future'); return; }
    if (stockWarning) { toast.error(stockWarning); return; }
    addFeedDispenseRecord({
      id: generateId(),
      flockId: feedFlock,
      date: feedDate,
      quantityKg: qty,
      feedType,
      feedSource: 'purchased',
      notes: feedNotes || undefined,
      createdAt: new Date().toISOString(),
    });
    toast.success(`Dispensed ${qty} kg of ${feedType} feed`);
    setFeedQty('');
    setFeedNotes('');
  }

  function submitMortality() {
    if (!mortFlock) { toast.error('Select a flock'); return; }
    const cnt = parseInt(mortCount);
    if (isNaN(cnt) || cnt < 0) { toast.error('Enter a valid count'); return; }
    if (mortDate > today()) { toast.error('Date cannot be in the future'); return; }
    addMortalityRecord({ id: generateId(), flockId: mortFlock, date: mortDate, count: cnt, cause: mortCause, createdAt: new Date().toISOString() });
    toast.success(`Logged ${cnt} mortality`);
    setMortCount(''); setMortCause('');
  }

  // Today's summary
  const todayStr = today();
  const todayEggs = useMemo(() => eggCollections.filter(e => e.date === todayStr), [eggCollections, todayStr]);
  const todayFeed = useMemo(() => feedDispenseRecords.filter(r => r.date === todayStr), [feedDispenseRecords, todayStr]);
  const todayMort = useMemo(() => mortalityRecords.filter(r => r.date === todayStr), [mortalityRecords, todayStr]);

  const selectedFlock = allFlocks.find(f => f.id === feedFlock);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Bird className="w-6 h-6 text-green-600" />
          Welcome{session?.employeeName ? `, ${session.employeeName}` : ''}!
        </h1>
        <p className="text-sm text-gray-500 mt-1">Quick data entry for farm operations – egg collection, feeding, and health records</p>
      </div>

      {/* Today's summary */}
      <div className="bg-green-50 border border-green-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-green-800 flex items-center gap-2 mb-2"><CheckCircle className="w-4 h-4" /> Today's Activity</p>
        <div className="flex flex-wrap gap-4 text-sm text-gray-600">
          <span>🥚 Eggs: <strong>{todayEggs.reduce((s, e) => s + e.count, 0)}</strong></span>
          <span>🌾 Feed: <strong>{todayFeed.reduce((s, r) => s + r.quantityKg, 0).toFixed(1)} kg</strong></span>
          <span>💀 Mortality: <strong>{todayMort.reduce((s, r) => s + r.count, 0)}</strong></span>
        </div>
      </div>

      {/* Log Egg Collection */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm space-y-3">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2 text-base">
          <Egg className="w-5 h-5 text-yellow-500" /> Log Egg Collection
        </h2>
        <Field label="Flock (layer)">
          <select value={eggFlock} onChange={e => setEggFlock(e.target.value)} className={inputCls}>
            <option value="">Select flock…</option>
            {layerFlocks.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" value={eggDate} max={today()} onChange={e => setEggDate(e.target.value)} className={inputCls} /></Field>
          <Field label="Total Collected"><input type="number" min="0" value={eggCount} onChange={e => setEggCount(e.target.value)} className={inputCls} placeholder="0" /></Field>
          <Field label="Broken Eggs"><input type="number" min="0" value={eggBroken} onChange={e => setEggBroken(e.target.value)} className={inputCls} placeholder="0" /></Field>
          <Field label="Sellable (auto)"><div className={inputCls + ' bg-gray-50 text-gray-500'}>{Math.max(0, (parseInt(eggCount) || 0) - (parseInt(eggBroken) || 0))}</div></Field>
        </div>
        <button onClick={submitEgg} className="w-full py-2.5 bg-yellow-500 text-white rounded-lg font-medium hover:bg-yellow-600 transition-colors">Submit Collection</button>
      </div>

      {/* Log Feed Dispensed */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm space-y-3">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2 text-base">
          <Wheat className="w-5 h-5 text-amber-600" /> Log Feed Dispensed
        </h2>
        <Field label="Flock">
          <select value={feedFlock} onChange={e => setFeedFlock(e.target.value)} className={inputCls}>
            <option value="">Select flock…</option>
            {allFlocks.map(f => <option key={f.id} value={f.id}>{f.name} ({f.currentCount} birds)</option>)}
          </select>
        </Field>
        {selectedFlock && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
            <strong>Recommendation:</strong> {selectedFlock.currentCount} birds at {selectedFlock.stage} stage —{' '}
            <strong>{((selectedFlock.currentCount * (FCR_RECS[selectedFlock.stage] ?? 0)) / 1000).toFixed(1)} kg</strong> per day.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" value={feedDate} max={today()} onChange={e => setFeedDate(e.target.value)} className={inputCls} /></Field>
          <Field label="Feed Type">
            <select
              value={feedType}
              onChange={e => setFeedType(e.target.value as typeof feedType)}
              className={inputCls}
            >
              {feedInventory.map(fi => (
                <option key={fi.feedType} value={fi.feedType}>
                  {fi.feedType.charAt(0).toUpperCase() + fi.feedType.slice(1)} — {fi.currentStockKg.toFixed(1)} kg in stock
                </option>
              ))}
            </select>
          </Field>
          <Field label="Qty (kg)">
            <input
              type="number"
              min="0"
              step="0.1"
              value={feedQty}
              onChange={e => setFeedQty(e.target.value)}
              className={inputCls + (stockWarning ? ' border-red-400 focus:ring-red-400' : '')}
              placeholder="0"
            />
          </Field>
          <Field label="Notes (optional)">
            <input type="text" value={feedNotes} onChange={e => setFeedNotes(e.target.value)} className={inputCls} placeholder="e.g. morning session" />
          </Field>
        </div>
        {stockWarning && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {stockWarning}
          </div>
        )}
        <button
          onClick={submitFeed}
          disabled={!!stockWarning}
          className="w-full py-2.5 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          Submit Feed Log
        </button>
      </div>

      {/* Log Mortality */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm space-y-3">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2 text-base">
          <Skull className="w-5 h-5 text-red-500" /> Log Mortality
        </h2>
        <Field label="Flock">
          <select value={mortFlock} onChange={e => setMortFlock(e.target.value)} className={inputCls}>
            <option value="">Select flock…</option>
            {allFlocks.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" value={mortDate} max={today()} onChange={e => setMortDate(e.target.value)} className={inputCls} /></Field>
          <Field label="Count"><input type="number" min="0" value={mortCount} onChange={e => setMortCount(e.target.value)} className={inputCls} placeholder="0" /></Field>
        </div>
        <Field label="Cause (optional)"><input type="text" value={mortCause} onChange={e => setMortCause(e.target.value)} className={inputCls} placeholder="e.g. disease, predator…" /></Field>
        <button onClick={submitMortality} className="w-full py-2.5 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors">Submit Mortality</button>
      </div>
    </div>
  );
}
