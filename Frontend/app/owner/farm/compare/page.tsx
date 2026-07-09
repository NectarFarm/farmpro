'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { Batch, BatchCostSummary } from '@/lib/types';
import { StatusChip } from '@/components/worker/StatusChip';
import { groupNoun } from '@/lib/species';

const fmtKES = (n: number) => `KSh ${n.toLocaleString('en-KE')}`;

export default function BatchComparePage() {
  const { t } = useTranslation();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [costs, setCosts] = useState<Record<string, BatchCostSummary | null>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadErr('');
    api.getBatches().then(all => {
      if (cancelled) return;
      setBatches(all.filter(b => b.status === 'ACTIVE'));
      setLoaded(true);
    }).catch(err => {
      if (cancelled) return;
      console.error('Failed to load batches', err);
      setLoadErr('Failed to load batches. Please try again.');
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [reloadKey]);

  // Load costs for selected batches
  useEffect(() => {
    for (const id of selected) {
      if (!(id in costs)) {
        api.getCostSummary(id)
          .then(c => setCosts(prev => ({ ...prev, [id]: c })))
          .catch(err => { console.error('Failed to load cost summary', err); setCosts(prev => ({ ...prev, [id]: null })); });
      }
    }
  }, [selected, costs]);

  const toggleBatch = (id: string) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectedBatches = batches.filter(b => selected.includes(b.id));

  // All metric keys to compare
  const metrics: { key: string; label: string; fmt: (v: number | undefined | null) => string; good?: (v: number) => boolean; bad?: (v: number) => boolean }[] = [
    { key: 'currentQty', label: t('currentQty'), fmt: v => String(v ?? '—') },
    { key: 'survivors', label: t('survivors'), fmt: v => String(v ?? '—') },
    { key: 'soldHead', label: t('sold'), fmt: v => String(v ?? '—') },
    { key: 'deaths', label: t('deaths'), fmt: v => String(v ?? '—') },
    { key: 'mortalityPct', label: t('mortalityRate'), fmt: v => v != null ? `${v}%` : '—', bad: v => v > 5 },
    { key: 'fcr', label: 'FCR', fmt: v => v != null ? String(v) : '—', good: v => v <= 2.8 },
    { key: 'henDayPct', label: t('henDayPct'), fmt: v => v != null ? `${v}%` : '—' },
    { key: 'totalRevenue', label: t('revenue'), fmt: v => v != null ? fmtKES(v) : '—' },
    { key: 'totalCost', label: t('totalCost'), fmt: v => v != null ? fmtKES(v) : '—' },
    { key: 'grossMargin', label: t('grossMargin'), fmt: v => v != null ? fmtKES(v) : '—', good: v => v > 0, bad: v => v < 0 },
    { key: 'costPerUnit', label: t('costPerUnit'), fmt: v => v != null ? fmtKES(v) : '—' },
    { key: 'costPerBird', label: t('costPerHead'), fmt: v => v != null ? fmtKES(v) : '—' },
    { key: 'breakEvenPricePerRemaining', label: t('breakEven'), fmt: v => v != null && v > 0 ? fmtKES(v) : t('profitable') },
  ];

  const getVal = (cost: BatchCostSummary | null | undefined, key: string): number | undefined | null => {
    if (!cost) return null;
    return (cost as unknown as Record<string, unknown>)[key] as number | undefined;
  };

  if (!loaded) return <div className="p-6 text-gray-400">Loading…</div>;

  if (loadErr) {
    return (
      <div className="p-6 flex flex-col items-center gap-3 text-center">
        <p className="text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm font-semibold">{loadErr}</p>
        <button
          onClick={() => { setLoaded(false); setReloadKey(k => k + 1); }}
          className="px-4 py-2 bg-gray-800 text-white rounded-lg font-semibold text-sm"
        >
          ↻ Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📊 {t('batchComparison')}</h1>
          <p className="text-gray-500 text-sm">{t('selectBatchesToCompare')}</p>
        </div>
        <Link href="/owner/farm" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-200">
          ← {t('backToFarm')}
        </Link>
      </div>

      {/* Batch selector */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="font-bold text-gray-800 text-sm mb-3">{t('selectBatchesToCompare')}</h2>
        <div className="flex flex-wrap gap-2">
          {batches.map(b => {
            const isOn = selected.includes(b.id);
            const days = Math.floor((Date.now() - new Date(b.acquiredDate).getTime()) / 86400000);
            return (
              <button
                key={b.id}
                onClick={() => toggleBatch(b.id)}
                disabled={!isOn && selected.length >= 6}
                className={`px-3 py-2 rounded-xl border text-sm font-semibold transition-all ${
                  isOn
                    ? 'bg-green-600 text-white border-green-600 shadow-sm'
                    : selected.length >= 6
                    ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-green-300 hover:bg-green-50'
                }`}
              >
                {b.name} <span className="opacity-70">· {b.species} · D{days}</span>
              </button>
            );
          })}
          {batches.length === 0 && <p className="text-sm text-gray-400">{t('noActiveBatchesToCompare')}</p>}
        </div>
      </div>

      {/* Comparison table */}
      {selectedBatches.length >= 2 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>                        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-gray-500">{t('metric')}</th>
                {selectedBatches.map(b => {
                  const c = costs[b.id];
                  return (
                    <th key={b.id} className="px-3 py-3 text-center">
                      <Link href={`/owner/farm/${b.id}`} className="font-bold text-gray-900 hover:text-green-700 hover:underline">
                        {b.name}
                      </Link>
                      <p className="text-[10px] text-gray-400 font-normal">
                        {b.species} · {b.stage} · {groupNoun(b.species)}
                      </p>
                      {c && (
                        <span className={`text-xs font-semibold ${c.grossMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {c.grossMargin >= 0 ? '+' : ''}{fmtKES(c.grossMargin)}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {metrics.map(m => (
                <tr key={m.key} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs font-semibold text-gray-600 whitespace-nowrap">{m.label}</td>
                  {selectedBatches.map(b => {
                    const c = costs[b.id];
                    const val = getVal(c, m.key);
                    let color = '';
                    if (val != null && m.bad && m.bad(val)) color = 'text-red-600 font-bold';
                    else if (val != null && m.good && m.good(val)) color = 'text-green-600 font-bold';
                    return (
                      <td key={b.id} className={`px-3 py-2.5 text-center text-sm ${color}`}>
                        {m.fmt(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedBatches.length < 2 && selected.length > 0 && (
        <div className="text-center py-8 bg-white border border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-400 text-sm">{t('selectAtLeast2')}</p>
        </div>
      )}
    </div>
  );
}
