'use client';
import { Sunrise, CheckCircle2, Check, AlertTriangle, Bird, PawPrint, Fish, Leaf, type LucideIcon } from 'lucide-react';
import { uuid } from '@/lib/uuid';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuthStore } from '@/lib/stores/auth';
import { useSyncStore } from '@/lib/stores/sync';
import { api } from '@/lib/api';
import { enqueuePendingRecord } from '@/lib/offline/db';
import { useTodayActivity, timeLabel } from '@/lib/hooks/useTodayActivity';
import { SegmentedToggle } from '@/components/worker/SegmentedToggle';
import { NumericKeypad } from '@/components/worker/NumericKeypad';
import { ConfirmSheet } from '@/components/worker/ConfirmSheet';
import type { ProductionUnit, Batch, InventoryItem, InventoryLot } from '@/lib/types';
import { cn } from '@/lib/utils';

type WaterLevel = 'LOW' | 'OK' | 'FULL';

interface UnitEntry {
  unitId: string; batchId: string; unitName: string; batchName: string;
  species: string; currentQty: number;
  // Feed USED today (deducted from stock) — not the error-prone "remaining" guess.
  waterLevel: WaterLevel | null; feedItemId: string; feedUsed: string;
  eggsCollected: string; eggsCracked: string;
  abnormal: boolean | null; abnormalNote: string;
  waterColour: 'CLEAR' | 'GREEN' | 'MURKY' | null;
  tempC: string; doMgL: string; ph: string; ammonia: string;
}

export default function MorningRoundPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { setPendingCount, pendingCount } = useSyncStore();
  const { doneToday } = useTodayActivity();
  const router = useRouter();
  const [units, setUnits] = useState<(ProductionUnit & { batch?: Batch })[]>([]);
  const [feedItems, setFeedItems] = useState<InventoryItem[]>([]);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [step, setStep] = useState<'start' | number | 'summary'>('start');
  const [entries, setEntries] = useState<UnitEntry[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    Promise.all([api.getUnits(), api.getBatches(), api.getItems(), api.getLots()]).then(([us, bs, items, ls]) => {
      const active = us.filter(u => u.status === 'ACTIVE');
      const withBatch = active.map(u => ({ ...u, batch: bs.find(b => b.unitId === u.id && b.status === 'ACTIVE') }));
      setUnits(withBatch.filter(u => u.batch));
      setFeedItems(items.filter(i => String(i.category).startsWith('FEED')));
      setLots(ls);
      setEntries(withBatch.filter(u => u.batch).map(u => ({
        unitId: u.id, batchId: u.batch!.id, unitName: u.name, batchName: u.batch!.name,
        species: u.species ?? '', currentQty: u.batch!.currentQty,
        waterLevel: null, feedItemId: '', feedUsed: '', eggsCollected: '', eggsCracked: '',
        abnormal: null, abnormalNote: '',
        waterColour: null, tempC: '', doMgL: '', ph: '', ammonia: '',
      })));
    }).catch(() => setLoadError(t('loadFormDataFailed')));
  }, [t]);

  // kg of a feed item currently on hand (sum of its lots).
  const onHand = (itemId: string) => lots.filter(l => l.itemId === itemId).reduce((s, l) => s + l.qtyOnHand, 0);

  const updateEntry = (idx: number, patch: Partial<UnitEntry>) => setEntries(e => e.map((en, i) => i === idx ? { ...en, ...patch } : en));

  // Feed used must name a feed and not exceed what's in stock (can't use what you don't have).
  const feedError = (e: UnitEntry): string | null => {
    const used = parseFloat(e.feedUsed) || 0;
    if (used <= 0) return null;                 // feed is optional
    if (!e.feedItemId) return 'Pick which feed you used.';
    if (used > onHand(e.feedItemId) + 1e-6) return `Only ${onHand(e.feedItemId)} kg of that feed in stock — you entered ${used}.`;
    return null;
  };

  const canSaveEntry = (e: UnitEntry) => {
    if (!e.waterLevel) return false;
    if (e.abnormal === null) return false;
    if (feedError(e)) return false;
    return true;
  };

  const handleFinish = async () => {
    const clientUuid = uuid();
    const payload = { clientUuid, startedAt: new Date().toISOString(), entries, recordedBy: user?.id };
    try {
      await enqueuePendingRecord('morning_round', payload, clientUuid);
    } catch {
      setError(t('saveFailedRetry'));
      setShowConfirm(false);
      return;
    }
    setPendingCount(pendingCount + 1);
    setSaved(true);
    setShowConfirm(false);
    setStep('summary');
  };

  if (step === 'start') {
    const round = doneToday('morning_round');
    return (
      <div className="p-4 flex flex-col gap-6">
        <div className="bg-green-700 text-white rounded-2xl p-6">
          <h1 className="text-2xl font-bold mb-1 flex items-center gap-2"><Sunrise className="w-6 h-6 shrink-0" /><span>{t('morningRound')}</span></h1>
          <p className="text-green-200 text-sm">{new Date().toLocaleString('en-KE')}</p>
        </div>
        {loadError && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{loadError}</p>}
        {round.count > 0 && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-xl px-4 py-3">
            <p className="flex items-center gap-1.5 text-amber-900 font-bold text-sm"><Check className="w-4 h-4 shrink-0" /> Today&apos;s round was already done at {timeLabel(round.lastAt)}{round.count > 1 ? ` (${round.count} times)` : ''}.</p>
            <p className="text-amber-800 text-xs mt-0.5">Only start again if you&apos;re doing a separate round (e.g. an evening check).</p>
          </div>
        )}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-gray-600 mb-3">You will visit <strong>{units.length} unit{units.length !== 1 ? 's' : ''}</strong>:</p>
          {units.map(u => {
            const SpeciesIcon: LucideIcon = u.species?.includes('poultry') ? Bird : u.species?.includes('pig') ? PawPrint : u.species?.includes('tilapia') || u.species?.includes('catfish') ? Fish : Leaf;
            return (
              <div key={u.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                <span className="shrink-0 w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center"><SpeciesIcon className="w-4 h-4 text-green-700" /></span>
                <div><p className="font-semibold text-gray-900">{u.name}</p><p className="text-xs text-gray-500">{u.batch?.name} · {u.batch?.currentQty} animals</p></div>
              </div>
            );
          })}
        </div>
        <button onClick={() => setStep(0)} disabled={units.length === 0}
          className="w-full min-h-[56px] bg-green-600 text-white rounded-xl text-xl font-bold active:bg-green-700 disabled:opacity-40 flex items-center justify-center gap-2">
          <Sunrise className="w-5 h-5" /> {round.count > 0 ? t('startAnotherRound') : t('startRound')}
        </button>
        {units.length === 0 && (
          <p className="text-center text-sm text-gray-500">No active units with a batch yet — ask the owner to add one before doing the round.</p>
        )}
      </div>
    );
  }

  if (step === 'summary') {
    const total = entries.reduce((s, e) => s + (parseInt(e.eggsCollected)||0), 0);
    return (
      <div className="p-4 flex flex-col gap-5">
        <div className="bg-green-50 border border-green-300 rounded-2xl p-5 text-center">
          <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-2" />
          <h1 className="text-xl font-bold text-green-800">{t('roundComplete')}</h1>
          {saved && <p className="text-sm text-green-600 mt-1">{t('savedWillSync')}</p>}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2">
          <h2 className="font-bold text-gray-800">{t('roundSummary')}</h2>
          <div className="flex justify-between"><span className="text-gray-500">{t('eggsCollected')}</span><span className="font-bold">{total}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">{t('unitsVisited')}</span><span className="font-bold">{entries.length}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">{t('abnormalitiesCount')}</span><span className="font-bold">{entries.filter(e => e.abnormal).length}</span></div>
        </div>
        <button onClick={() => router.replace('/worker/home')}
          className="w-full min-h-[56px] bg-green-600 text-white rounded-xl text-xl font-bold">
          {t('backToHome')}
        </button>
      </div>
    );
  }

  const idx = step as number;
  const entry = entries[idx];
  const isPoultry = entry.species.includes('poultry');
  const isFish = entry.species.includes('tilapia') || entry.species.includes('catfish');

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Progress */}
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-gray-200 rounded-full h-2"><div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${((idx+1)/entries.length)*100}%` }} /></div>
        <span className="text-xs text-gray-500 font-semibold">{idx+1}/{entries.length}</span>
      </div>

      {/* Unit header */}
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
        <h2 className="font-bold text-gray-900 text-lg">{entry.unitName}</h2>
        <p className="text-sm text-gray-500">{entry.batchName} · {entry.currentQty} animals</p>
      </div>

      {/* Water Level */}
      <SegmentedToggle
        label={t('waterLevel')}
        options={[
          { value: 'LOW', label: t('waterLevelLow'), icon: <AlertTriangle className="w-4 h-4" /> },
          { value: 'OK', label: t('waterLevelOK') },
          { value: 'FULL', label: t('waterLevelFull') },
        ]}
        value={entry.waterLevel}
        onChange={v => updateEntry(idx, { waterLevel: v })}
        error={entry.waterLevel === null ? 'Required' : undefined}
      />

      {/* Feed USED today — deducted from stock. (We capture what was used, not what's
          left: "remaining" is a guess and never updates the store.) */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">{t('feedUsed')} <span className="text-gray-400 font-normal">— {t('comesOffStock')}</span></label>
        <select value={entry.feedItemId} onChange={e => updateEntry(idx, { feedItemId: e.target.value })}
          className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm bg-white min-h-[48px]">
          <option value="">— Which feed? —</option>
          {feedItems.map(fi => <option key={fi.id} value={fi.id}>{fi.name} — {onHand(fi.id)} {fi.unit} left</option>)}
        </select>
        {activeField === 'feed' ? (
          <>
            <NumericKeypad label="Feed used (kg)" value={entry.feedUsed} onChange={v => updateEntry(idx, { feedUsed: v })} allowDecimal unit="kg" />
            <button type="button" onClick={() => setActiveField(null)} className="mt-1 w-full bg-green-600 text-white rounded-xl min-h-[44px] font-semibold">Done</button>
          </>
        ) : (
          <button type="button" onClick={() => setActiveField('feed')}
            className="w-full flex justify-between items-center bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 min-h-[52px]">
            <span className="font-medium text-gray-700">{t('feedUsed')}</span>
            <span className={cn('text-xl font-bold', entry.feedUsed ? 'text-gray-900' : 'text-gray-400')}>{entry.feedUsed || '—'} <span className="text-base text-gray-500">kg</span></span>
          </button>
        )}
        {feedError(entry) && <p className="flex items-center gap-1.5 text-xs font-semibold text-red-600"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {feedError(entry)}</p>}
      </div>

      {/* Poultry fields */}
      {isPoultry && (
        <>
          {activeField === 'eggs' ? (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <NumericKeypad large label={t('eggsCollected')} value={entry.eggsCollected} onChange={v => updateEntry(idx, { eggsCollected: v })} unit={t('eggs')} />
              <NumericKeypad label={t('cracked')} value={entry.eggsCracked} onChange={v => updateEntry(idx, { eggsCracked: v })} className="mt-3" />
              <button type="button" onClick={() => setActiveField(null)} className="mt-3 w-full bg-green-600 text-white rounded-xl min-h-[44px] font-semibold">Done</button>
            </div>
          ) : (
            <button type="button" onClick={() => setActiveField('eggs')}
              className="w-full flex justify-between items-center bg-white border border-gray-200 rounded-xl px-4 py-3 min-h-[56px]">
              <span className="font-medium text-gray-700">Eggs</span>
              <span className={cn('text-xl font-bold', entry.eggsCollected ? 'text-gray-900' : 'text-gray-400')}>{entry.eggsCollected || '—'}</span>
            </button>
          )}
        </>
      )}

      {/* Fish/pond fields */}
      {isFish && (
        <>
          <SegmentedToggle label={t('waterColour')}
            options={[{value:'CLEAR',label:'Clear'},{value:'GREEN',label:'Green (good)'},{value:'MURKY',label:'Murky'}]}
            value={entry.waterColour} onChange={v => updateEntry(idx, { waterColour: v })} />
          {activeField === 'water_params' ? (
            <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-2 gap-3">
              <NumericKeypad label={`${t('temperature')} °C`} value={entry.tempC} onChange={v => updateEntry(idx, { tempC: v })} allowDecimal unit="°C" />
              <NumericKeypad label={`DO ${t('mgPerL')}`} value={entry.doMgL} onChange={v => updateEntry(idx, { doMgL: v })} allowDecimal unit="mg/L" />
              <NumericKeypad label="pH" value={entry.ph} onChange={v => updateEntry(idx, { ph: v })} allowDecimal unit="pH" />
              <NumericKeypad label={t('ammonia')} value={entry.ammonia} onChange={v => updateEntry(idx, { ammonia: v })} allowDecimal unit="mg/L" />
              <button type="button" onClick={() => setActiveField(null)} className="col-span-2 bg-green-600 text-white rounded-xl min-h-[44px] font-semibold">Done</button>
            </div>
          ) : (
            <button type="button" onClick={() => setActiveField('water_params')}
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-left min-h-[56px]">
              <span className="font-medium text-gray-700">{t('waterParameters')}</span>
              <span className="ml-2 text-gray-400 text-sm">{entry.ph ? `pH ${entry.ph} · DO ${entry.doMgL}` : 'Tap to enter'}</span>
            </button>
          )}
        </>
      )}

      {/* Abnormal — no default, DS-2 */}
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1"><AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" /> {t('abnormalQuestion')} <span className="text-red-500 text-xs">— required, no default</span></p>
        <div className="flex gap-3">
          {[{v:false,l:t('no')},{v:true,l:t('yes')}].map(({v,l}) => (
            <button key={l} type="button" onClick={() => updateEntry(idx, { abnormal: v })}
              className={cn('flex-1 min-h-[56px] rounded-xl text-lg font-bold border-2 transition-colors',
                entry.abnormal === v ? (v ? 'bg-amber-500 border-amber-600 text-white' : 'bg-green-600 border-green-700 text-white') : 'bg-white border-gray-300 text-gray-700')}>
              {l}
            </button>
          ))}
        </div>
        {entry.abnormal && (
          <textarea value={entry.abnormalNote} onChange={e => updateEntry(idx, { abnormalNote: e.target.value })}
            placeholder="Describe the abnormality…" rows={2}
            className="mt-2 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm" />
        )}
      </div>

      {error && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 font-semibold">{error}</p>}

      {/* Save & Next */}
      <button
        disabled={!canSaveEntry(entry)}
        onClick={() => { if (idx < entries.length - 1) setStep(idx + 1); else setShowConfirm(true); }}
        className="w-full min-h-[56px] bg-green-600 text-white rounded-xl text-xl font-bold disabled:opacity-40">
        {idx < entries.length - 1 ? `${t('saveAndNext')} →` : t('finishRound')}
      </button>

      <ConfirmSheet
        open={showConfirm}
        title="Finish Morning Round?"
        summary={`${entries.length} units recorded. Submit to queue?`}
        confirmLabel="Finish & Queue"
        onConfirm={handleFinish}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}
