'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { STAGE_ENTERPRISES, defaultStages, type StageDef } from '@/lib/lifecycle';

const LABELS: Record<string, string> = {
  layers: 'Layers (eggs)', broilers: 'Broilers (meat)', pig_fatten: 'Pig fattening',
  pig_breed: 'Pig breeding', tilapia: 'Tilapia', catfish: 'Catfish', maize: 'Maize',
};

export default function LifecycleStagesPage() {
  const [enterprise, setEnterprise] = useState(STAGE_ENTERPRISES[0]);
  const [all, setAll] = useState<Record<string, StageDef[]>>({});
  const [rows, setRows] = useState<StageDef[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/lifecycle-stages', { credentials: 'include' }).then(r => r.ok ? r.json() : []).then((data: { enterprise: string; name: string; startDay: number }[]) => {
      const grouped: Record<string, StageDef[]> = {};
      for (const d of data) (grouped[d.enterprise] ??= []).push({ name: d.name, startDay: d.startDay });
      setAll(grouped);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setSaved(false); setErr('');
    setRows((all[enterprise] && all[enterprise].length ? all[enterprise] : defaultStages(enterprise)).map(s => ({ ...s })));
  }, [enterprise, all]);

  const setRow = (i: number, patch: Partial<StageDef>) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addRow = () => setRows(rs => [...rs, { name: '', startDay: (rs[rs.length - 1]?.startDay ?? 0) + 7 }]);
  const removeRow = (i: number) => setRows(rs => rs.filter((_, idx) => idx !== i));

  const save = async () => {
    const clean = rows.map(r => ({ name: r.name.trim(), startDay: Math.max(0, Math.round(Number(r.startDay) || 0)) })).filter(r => r.name);
    if (!clean.length) { setErr('Add at least one stage.'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/lifecycle-stages', {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enterprise, stages: clean }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      const sorted = [...clean].sort((a, b) => a.startDay - b.startDay); if (sorted[0]) sorted[0].startDay = 0;
      setAll(a => ({ ...a, [enterprise]: sorted })); setRows(sorted); setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const sortedPreview = [...rows].sort((a, b) => (Number(a.startDay) || 0) - (Number(b.startDay) || 0));

  return (
    <div className="p-6 flex flex-col gap-5 max-w-3xl">
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500"><Link href="/owner/farm" className="hover:underline">← Farm</Link></div>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">🌱 Lifecycle stages</h1>
        <p className="text-gray-500 text-sm">Set the growth phases for each animal type and the AGE (days) each begins. The farm then shows when a batch is due to move to the next phase.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {STAGE_ENTERPRISES.map(e => (
          <button key={e} onClick={() => setEnterprise(e)}
            className={`px-3 py-2 rounded-xl font-semibold text-sm border-2 ${enterprise === e ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300'}`}>
            {LABELS[e] ?? e}
          </button>
        ))}
      </div>

      {err && <p className="text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm font-semibold">{err}</p>}

      <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3">
        <div className="grid grid-cols-[1fr_120px_40px] gap-2 text-xs font-semibold text-gray-400">
          <span>Stage name</span><span>Begins at (days)</span><span></span>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_120px_40px] gap-2 items-center">
            <input value={r.name} onChange={e => setRow(i, { name: e.target.value })} placeholder="e.g. Grower"
              className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input type="number" min="0" value={String(r.startDay)} onChange={e => setRow(i, { startDay: Number(e.target.value) })}
              className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={() => removeRow(i)} aria-label="Remove" className="text-gray-400 hover:text-red-600">✕</button>
          </div>
        ))}
        <button onClick={addRow} className="self-start text-green-700 font-semibold text-sm">+ Add stage</button>
        <p className="text-[11px] text-gray-400">The earliest stage is always pinned to day 0. Stages are ordered by their start day.</p>
      </div>

      {sortedPreview.length > 1 && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
          <span className="font-semibold text-gray-700">Timeline: </span>
          {sortedPreview.map((s, i) => (
            <span key={i}>{i > 0 && ' → '}{s.name || '?'} <span className="text-gray-400">(d{Math.max(0, Math.round(Number(s.startDay) || 0))})</span></span>
          ))}
        </div>
      )}

      <button onClick={save} disabled={saving}
        className={`w-full min-h-[52px] rounded-xl font-bold text-base disabled:opacity-50 ${saved ? 'bg-green-100 text-green-700' : 'bg-green-600 text-white hover:bg-green-700'}`}>
        {saving ? 'Saving…' : saved ? '✓ Stages saved' : `Save ${LABELS[enterprise] ?? enterprise} stages`}
      </button>
    </div>
  );
}
