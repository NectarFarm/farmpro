'use client';
// Admin editor for subscription packages: name, price, and which features each
// includes. Saved packages replace the built-in free/standard/pro and feed the
// per-farm plan dropdowns.
import { useEffect, useState } from 'react';
import { Package2, X, Check } from 'lucide-react';

type Pkg = { id?: string; name: string; features: string[]; price: number };
type Feat = { key: string; label: string; desc: string };

export function AdminPackages({ onSaved }: { onSaved?: () => void }) {
  const [pkgs, setPkgs] = useState<Pkg[]>([]);
  const [features, setFeatures] = useState<Feat[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => fetch('/api/admin/packages', { credentials: 'include' })
    .then(r => r.ok ? r.json() : { packages: [], features: [] })
    .then(d => { setPkgs(d.packages ?? []); setFeatures(d.features ?? []); }).catch(() => {});
  useEffect(() => { load(); }, []);

  const set = (i: number, k: keyof Pkg, v: string | number) => setPkgs(p => p.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const toggleFeat = (i: number, key: string) => setPkgs(p => p.map((x, j) => j === i ? { ...x, features: x.features.includes(key) ? x.features.filter(f => f !== key) : [...x.features, key] } : x));
  const add = () => setPkgs(p => [...p, { name: '', features: [], price: 0 }]);
  const remove = (i: number) => setPkgs(p => p.filter((_, j) => j !== i));
  const save = async () => {
    setSaving(true); setMsg('');
    try {
      const r = await fetch('/api/admin/packages', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packages: pkgs }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Save failed');
      setPkgs((await r.json()).packages); setMsg('Packages saved'); setTimeout(() => setMsg(''), 2000); onSaved?.();
    } catch (e) { setMsg((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3">
      <button onClick={() => setOpen(v => !v)} className="flex items-center justify-between text-left">
        <div className="flex items-center gap-2.5">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
            <Package2 className="w-4 h-4 text-purple-700" />
          </div>
          <div>
            <h2 className="font-bold text-gray-800">Packages</h2>
            <p className="text-xs text-gray-400">Define the plans farms can be put on — name, price, and included features.</p>
          </div>
        </div>
        <span className="text-xs font-semibold text-gray-400">{open ? 'Hide' : `Edit (${pkgs.length})`}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-3">
          {pkgs.map((p, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-3 flex flex-col gap-2 bg-gray-50">
              <div className="flex items-center gap-2 flex-wrap">
                <input value={p.name} onChange={e => set(i, 'name', e.target.value)} placeholder="Package name" className="flex-1 min-w-[140px] border border-gray-300 rounded px-2 py-1 text-sm font-semibold" />
                <label className="text-xs text-gray-500 flex items-center gap-1">KSh
                  <input type="number" min="0" value={p.price} onChange={e => set(i, 'price', Number(e.target.value))} className="w-24 border border-gray-300 rounded px-2 py-1 text-sm" />/mo
                </label>
                <button onClick={() => remove(i)} className="text-red-400 hover:text-red-600 px-1" title="Remove"><X className="w-3.5 h-3.5" /></button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {features.map(f => (
                  <button key={f.key} type="button" onClick={() => toggleFeat(i, f.key)} title={f.desc}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold border ${p.features.includes(f.key) ? 'bg-green-50 text-green-700 border-green-300' : 'bg-white text-gray-400 border-gray-200'}`}>
                    {p.features.includes(f.key) && <Check className="w-3 h-3 shrink-0" />}{f.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button onClick={add} className="text-xs font-semibold text-green-600">+ Add package</button>
            <button onClick={save} disabled={saving} className="ml-auto px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save packages'}</button>
          </div>
          {msg && <p className="text-xs text-gray-600">{msg}</p>}
          <p className="text-[11px] text-gray-400">Editing a package updates the choices below. Existing farms keep their current features until you re-assign their package.</p>
        </div>
      )}
    </div>
  );
}
