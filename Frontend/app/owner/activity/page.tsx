'use client';
import React, { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { ConflictResolver, type Conflict } from '@/components/owner/ConflictResolver';

interface Row { kind: string; at: string; by: string; byId: string | null; batch: string; text: string; photoId: string | null; gpsLat: number | null; gpsLng: number | null }
const icon = (k: string) => ({ mortality: '💀', health: '💉', feeding: '🌾', collection: '🥚', 'stock count': '📦', 'head count': '🔢', 'weight sample': '⚖️', observation: '👁️' }[k] ?? '📋');

export default function ActivityPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [workers, setWorkers] = useState<{ id: string; name: string }[]>([]);
  const [worker, setWorker] = useState('');
  const [day, setDay] = useState('');
  const [loading, setLoading] = useState(true);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [cBusy, setCBusy] = useState('');

  const load = (w: string) => {
    setLoading(true);
    fetch(`/api/worker-activity${w ? `?workerId=${w}` : ''}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { data: [] }).then(d => { setRows(Array.isArray(d) ? d : d.data ?? []); setLoading(false); }).catch(() => setLoading(false));
  };
  const loadConflicts = () => fetch('/api/conflicts', { credentials: 'include' }).then(r => r.ok ? r.json() : []).then(setConflicts).catch(() => {});
  const resolve = async (id: string, resolution: 'accept' | 'kept_mine' | 'kept_server') => {
    setCBusy(id);
    try {
      await fetch('/api/conflicts', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, resolution }) });
      await loadConflicts();
    } finally { setCBusy(''); }
  };
  useEffect(() => { fetch('/api/workers', { credentials: 'include' }).then(r => r.ok ? r.json() : []).then(setWorkers).catch(() => {}); load(''); loadConflicts(); }, []);

  const shown = day ? rows.filter(r => r.at.slice(0, 10) === day) : rows;

  // group by date
  const byDate: Record<string, Row[]> = {};
  for (const r of shown) { const d = r.at.slice(0, 10); (byDate[d] ??= []).push(r); }
  const dates = Object.keys(byDate).sort().reverse();

  return (
    <div className="p-6 flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">📝 {t('workerActivity')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('workerActivity')}</p>
      </div>

      {conflicts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="font-bold text-red-700 text-sm">⚠ Sync conflicts to review ({conflicts.length})</h2>
          <p className="text-xs text-gray-500 -mt-1">Two workers recorded the same day&apos;s figure for a batch. The later one was kept — accept that, or override.</p>
          {conflicts.map(c => <ConflictResolver key={c.id} conflict={c} onResolve={resolve} busy={cBusy === c.id} />)}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-semibold text-gray-700">{t('worker')}:</span>
        <select value={worker} onChange={e => { setWorker(e.target.value); load(e.target.value); }} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">{t('allWorkers')}</option>
          {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <span className="text-sm font-semibold text-gray-700">{t('day')}:</span>
        <input type="date" value={day} onChange={e => setDay(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        {day && <button onClick={() => setDay('')} className="text-xs text-gray-500 underline">clear</button>}
      </div>

      {loading ? <p className="text-gray-400">{t('loading')}</p>
        : dates.length === 0 ? (
          <div className="text-center py-10 bg-white border border-dashed border-gray-200 rounded-xl">
            <p className="text-gray-400">{t('noActivity')}{worker ? ` ${t('for')} ${t('worker')}` : ''}.</p>
          </div>
        ) : dates.map(d => (
          <div key={d}>
            <h2 className="font-bold text-gray-700 text-sm mb-2">{new Date(d).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })} <span className="text-gray-400 font-normal">· {byDate[d].length} records</span></h2>
            <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
              {byDate[d].map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-xl">{icon(r.kind)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800"><span className="font-semibold capitalize">{r.kind}</span> · {r.text} <span className="text-gray-400">· {r.batch}</span></p>
                    <p className="text-xs text-gray-400">{new Date(r.at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })} · by {r.by}
                      {r.gpsLat != null && r.gpsLng != null && <> · <a className="text-blue-600 underline" href={`https://maps.google.com/?q=${r.gpsLat},${r.gpsLng}`} target="_blank" rel="noreferrer">📍</a></>}
                    </p>
                  </div>
                  {r.photoId && (
                     
                    <a href={`/api/photos/${r.photoId}`} target="_blank" rel="noreferrer"><img src={`/api/photos/${r.photoId}`} alt="evidence" className="w-12 h-12 object-cover rounded-lg border border-gray-200" /></a>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      }
    </div>
  );
}
