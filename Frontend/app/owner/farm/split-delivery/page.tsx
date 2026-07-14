'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { ProductionUnit } from '@/lib/types';
import { groupedEnterpriseOptions } from '@/lib/species';
import { cn } from '@/lib/utils';
import { Boxes, Layers, ListChecks, Check } from 'lucide-react';

const fmtKES = (n: number) => `KSh ${n.toLocaleString('en-KE')}`;

const STEPS = [
  { labelKey: 'delivery', icon: Boxes, title: 'The delivery' },
  { labelKey: 'allocate', icon: Layers, title: 'Split across units' },
  { labelKey: 'review', icon: ListChecks, title: 'Review & confirm' },
] as const;

// One delivery (e.g. 3600 fries) stocked across several units at once (e.g.
// 1200 into each of 3 tanks) — each allocation becomes its own ordinary batch,
// automatically cost-split, tagged so they're traceable back to this one
// delivery. Built as a short step flow (matching the Setup Wizard) rather than
// one long crowded form, since it's naturally three separate decisions and
// this needs to work cleanly on a small phone screen in the field.
export default function SplitDeliveryPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [units, setUnits] = useState<ProductionUnit[]>([]);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ count: number } | null>(null);

  const [name, setName] = useState('');
  const [enterprise, setEnterprise] = useState('');
  const [species, setSpecies] = useState('');
  const [acquiredDate, setAcquiredDate] = useState(new Date().toISOString().slice(0, 10));
  const [ageAtAcquire, setAgeAtAcquire] = useState('0');
  const [totalQty, setTotalQty] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [rows, setRows] = useState<{ unitId: string; qty: string }[]>([{ unitId: '', qty: '' }, { unitId: '', qty: '' }]);

  useEffect(() => { api.getUnits().then(setUnits); }, []);

  const allocatedQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const remaining = (Number(totalQty) || 0) - allocatedQty;
  const costPerHead = Number(totalQty) > 0 ? Number(totalCost) / Number(totalQty) : 0;

  const canNext = () => {
    if (step === 0) return name.trim().length > 0 && Number(totalQty) > 0;
    if (step === 1) return rows.filter(r => r.unitId && Number(r.qty) > 0).length >= 2 && remaining === 0;
    return true;
  };

  const submit = async () => {
    setSaving(true); setErr('');
    try {
      const allocations = rows.filter(r => r.unitId && Number(r.qty) > 0).map(r => ({ unitId: r.unitId, qty: Number(r.qty) }));
      const res = await fetch('/api/batches/split-delivery', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, species: species || enterprise, enterprise: enterprise || null,
          acquiredDate, ageAtAcquire: Number(ageAtAcquire) || 0,
          totalQty: Number(totalQty), totalCost: Number(totalCost) || 0, allocations,
        }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Could not save this delivery.'); }
      const data = await res.json();
      setDone({ count: data.count });
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white border border-success/30 rounded-2xl p-8 max-w-sm w-full text-center flex flex-col gap-4 items-center">
          <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center"><Check className="w-7 h-7 text-success" /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Delivery recorded</h1>
            <p className="text-gray-500 text-sm mt-1">Created {done.count} batches, one per unit, linked to this delivery.</p>
          </div>
          <button onClick={() => router.replace('/owner/farm')} className="w-full min-h-[48px] bg-primary text-primary-foreground rounded-xl font-bold hover:bg-primary/90">Back to Farm</button>
        </div>
      </div>
    );
  }

  const StepIcon = STEPS[step].icon;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-primary text-primary-foreground px-5 py-4">
        <div className="flex items-center gap-2 text-sm text-primary-foreground/80 mb-2">
          <Link href="/owner/farm" className="hover:underline">← {t('farm')}</Link>
        </div>
        <h1 className="text-lg font-bold flex items-center gap-2"><StepIcon className="w-5 h-5" /> Split one delivery across units</h1>
        <div className="flex gap-1.5 mt-3">
          {STEPS.map((s, i) => (
            <div key={i} className={cn('flex-1 h-1.5 rounded-full', i <= step ? 'bg-white' : 'bg-primary-foreground/30')} />
          ))}
        </div>
        <p className="text-primary-foreground/80 text-xs mt-1">Step {step + 1} of {STEPS.length}: {STEPS[step].title}</p>
      </div>

      <div className="flex-1 p-5 max-w-lg mx-auto w-full flex flex-col gap-5">
        {err && <p className="text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 text-sm font-semibold">{err}</p>}

        {step === 0 && (
          <div className="flex flex-col gap-4">
            <p className="text-gray-500 text-sm">One delivery received in one go — e.g. "3600 fries from Aquaculture Barn Kisumu."</p>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Delivery / batch name *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. June tilapia fries"
                className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base" />
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-gray-700">What is it?</p>
              {groupedEnterpriseOptions().map(({ group, options }) => (
                <div key={group} className="flex flex-col gap-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{group}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {options.map(opt => (
                      <button key={opt.key} type="button" onClick={() => { setEnterprise(o => o === opt.key ? '' : opt.key); setSpecies(enterprise === opt.key ? '' : opt.defaultSpecies); }}
                        className={cn('flex flex-col items-center gap-1 rounded-xl border-2 p-3', enterprise === opt.key ? 'bg-primary/10 border-primary' : 'bg-white border-gray-200')}>
                        <opt.Icon className={cn('w-5 h-5', enterprise === opt.key ? 'text-primary' : 'text-gray-500')} />
                        <span className="text-xs font-semibold text-gray-700">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500">Date received</label>
                <input type="date" value={acquiredDate} onChange={e => setAcquiredDate(e.target.value)} className="border-2 border-gray-300 rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500">Age on arrival (days)</label>
                <input type="number" min="0" value={ageAtAcquire} onChange={e => setAgeAtAcquire(e.target.value)} className="border-2 border-gray-300 rounded-xl px-3 py-2.5 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500">Total quantity *</label>
                <input type="number" min="0" value={totalQty} onChange={e => setTotalQty(e.target.value)} placeholder="e.g. 3600" className="border-2 border-gray-300 rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-500">Total cost (KSh)</label>
                <input type="number" min="0" value={totalCost} onChange={e => setTotalCost(e.target.value)} placeholder="e.g. 18000" className="border-2 border-gray-300 rounded-xl px-3 py-2.5 text-sm" />
              </div>
            </div>
            {costPerHead > 0 && <p className="text-xs text-gray-400">≈ {fmtKES(Math.round(costPerHead * 100) / 100)} each — split automatically by how many go to each unit.</p>}
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <p className="text-gray-500 text-sm">Which units is this going into, and how many to each?</p>
            {rows.map((r, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
                <select value={r.unitId} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, unitId: e.target.value } : x))}
                  className="border-2 border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white">
                  <option value="">Select unit…</option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <div className="flex gap-2 items-center">
                  <input type="number" min="0" value={r.qty} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))}
                    placeholder="How many" className="flex-1 border-2 border-gray-300 rounded-lg px-3 py-2.5 text-sm" />
                  {rows.length > 2 && (
                    <button type="button" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600 px-2" aria-label="Remove">✕</button>
                  )}
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setRows(rs => [...rs, { unitId: '', qty: '' }])}
              className="w-full border-2 border-dashed border-primary/40 text-primary rounded-xl py-3 font-semibold text-sm">
              + Add another unit
            </button>
            <div className={cn('rounded-xl px-4 py-3 text-sm font-semibold text-center',
              remaining === 0 ? 'bg-success/10 text-success border border-success/30' : 'bg-warning/15 text-warning-foreground border border-warning/40')}>
              {remaining === 0 ? `All ${totalQty} allocated ✓` : remaining > 0 ? `${remaining} left to allocate` : `${-remaining} too many — reduce a row`}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-2">
              <p className="font-bold text-gray-900">{name}</p>
              <p className="text-sm text-gray-500">{totalQty} total · {fmtKES(Number(totalCost) || 0)} · received {acquiredDate}</p>
            </div>
            <div className="flex flex-col gap-2">
              {rows.filter(r => r.unitId && Number(r.qty) > 0).map((r, i) => {
                const unit = units.find(u => u.id === r.unitId);
                const share = Number(totalQty) > 0 ? ((Number(totalCost) || 0) * Number(r.qty)) / Number(totalQty) : 0;
                return (
                  <div key={i} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-800 text-sm">{unit?.name ?? r.unitId}</p>
                      <p className="text-xs text-gray-400">{r.qty} · own batch, own history</p>
                    </div>
                    <p className="font-bold text-gray-900 text-sm">{fmtKES(Math.round(share))}</p>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-400">This creates {rows.filter(r => r.unitId && Number(r.qty) > 0).length} separate batches, each behaving normally (mortality, health, sales, cost reports) — linked together only as "from the same delivery."</p>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-5 py-4 flex gap-3 max-w-lg mx-auto w-full">
        {step > 0 && (
          <button onClick={() => setStep(s => s - 1)} disabled={saving} className="flex-1 min-h-[52px] bg-gray-100 text-gray-700 rounded-xl font-semibold disabled:opacity-50">{t('back')} ←</button>
        )}
        {step < STEPS.length - 1 ? (
          <button onClick={() => canNext() && setStep(s => s + 1)} disabled={!canNext()} className="flex-1 min-h-[52px] bg-primary text-primary-foreground rounded-xl font-bold hover:bg-primary/90 disabled:opacity-40">{t('next')} →</button>
        ) : (
          <button onClick={submit} disabled={saving} className="flex-1 min-h-[52px] bg-primary text-primary-foreground rounded-xl font-bold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
            {!saving && <Check className="w-5 h-5" />} {saving ? t('saving') : 'Confirm & create batches'}
          </button>
        )}
      </div>
    </div>
  );
}
