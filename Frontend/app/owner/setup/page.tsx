'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

const TEMPLATES = [
  { id:'layers', icon:'🐔', label:'Layers', desc:'Egg production batches' },
  { id:'broilers', icon:'🐔', label:'Broilers', desc:'Meat production batches' },
  { id:'pig_fatten', icon:'🐖', label:'Pig Fattening', desc:'Grower → slaughter' },
  { id:'pig_breed', icon:'🐖', label:'Pig Breeding', desc:'Sow/boar + litters' },
  { id:'tilapia', icon:'🐟', label:'Tilapia Pond', desc:'Fingerling → harvest' },
  { id:'catfish', icon:'🐟', label:'Catfish', desc:'Pond / tank grow-out' },
  { id:'maize', icon:'🌽', label:'Maize', desc:'Crop plot cycle' },
];

const STEPS = [
  { label: 'Farm', icon: '🏡' },
  { label: 'Units', icon: '🏗' },
  { label: 'Batches', icon: '🐄' },
  { label: 'Inventory', icon: '📦' },
  { label: 'Employees', icon: '👥' },
  { label: 'Worker Profile', icon: '⚙️' },
  { label: 'Thresholds', icon: '🔔' },
];

export default function SetupWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [farmName, setFarmName] = useState('');
  const [farmLocation, setFarmLocation] = useState('');
  const [currency] = useState('KSh');
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [units, setUnits] = useState([{ name: '', type: 'HOUSE', capacity: '' }]);
  const [batches, setBatches] = useState([{ name: '', species: '', unitName: '', qty: '', ageAtAcquire: '', cost: '' }]);
  const [inventory, setInventory] = useState([{ name: '', category: 'FEED_FINISHED', unit: 'kg', qty: '', unitCost: '' }]);
  const [employees, setEmployees] = useState([{ name: '', phone: '', role: 'worker', pin: '' }]);
  const [mortalityThreshold, setMortalityThreshold] = useState('1');
  const [lowStockKg, setLowStockKg] = useState('50');
  const [mortalityRate, setMortalityRate] = useState('2.0');

  const canNext = () => {
    if (step === 0) return farmName.trim().length > 0;
    if (step === 1) return units.every(u => u.name && u.capacity);
    if (step === 2) return batches.every(b => b.name && b.qty);
    return true;
  };

  const [finishing, setFinishing] = useState(false);
  const [finishErr, setFinishErr] = useState('');

  const handleFinish = async () => {
    setFinishing(true); setFinishErr('');
    try {
      const res = await fetch('/api/setup', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmName, farmLocation,
          units, batches, inventory, employees,
          mortalityRate, lowStockKg, mortalityPhotoThreshold: mortalityThreshold,
        }),
      });
      if (!res.ok) throw new Error(res.status === 403 ? 'Only the owner can run setup' : res.status === 401 ? 'Please sign in again' : 'Setup failed — please retry');
      try { localStorage.removeItem('ifms_setup_progress'); } catch { /* noop */ }
      router.replace('/owner/dashboard');
    } catch (e) { setFinishErr((e as Error).message); setFinishing(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-green-700 text-white px-6 py-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">🌾</span>
          <div><h1 className="text-xl font-bold">Setup Wizard</h1><p className="text-green-200 text-sm">Complete in &lt;15 minutes · Resumable</p></div>
        </div>
        <div className="flex gap-1.5">
          {STEPS.map((s, i) => (
            <button key={i} onClick={() => i < step + 1 && setStep(i)}
              className={cn('flex-1 h-2 rounded-full transition-colors', i <= step ? 'bg-white' : 'bg-green-500')}>
              <span className="sr-only">{s.label}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-green-200 text-xs">{STEPS[step].icon} Step {step+1}: {STEPS[step].label}</span>
          <span className="text-green-300 text-xs">{step+1}/{STEPS.length}</span>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 p-5 max-w-2xl mx-auto w-full">
        {/* Step 0: Farm */}
        {step === 0 && (
          <div className="flex flex-col gap-5">
            <h2 className="text-2xl font-bold text-gray-900">🏡 Your Farm</h2>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Farm Name *</label>
              <input value={farmName} onChange={e => setFarmName(e.target.value)} placeholder="e.g. Okello Family Farm"
                className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Location</label>
              <input value={farmLocation} onChange={e => setFarmLocation(e.target.value)} placeholder="e.g. Kiambu County, Kenya"
                className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base" />
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-blue-800 font-semibold text-sm mb-2">Quick-start templates</p>
              <p className="text-blue-600 text-xs mb-3">Select your enterprises — pre-fills units, schedules, and report sets.</p>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map(t => (
                  <button key={t.id} type="button" onClick={() => setSelectedTemplates(ts => ts.includes(t.id) ? ts.filter(x=>x!==t.id) : [...ts,t.id])}
                    className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-semibold transition-colors',
                      selectedTemplates.includes(t.id) ? 'bg-green-100 border-green-500 text-green-800' : 'bg-white border-gray-200 text-gray-700')}>
                    <span>{t.icon}</span><div className="text-left"><div>{t.label}</div><div className="text-xs text-gray-400 font-normal">{t.desc}</div></div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Units */}
        {step === 1 && (
          <div className="flex flex-col gap-5">
            <h2 className="text-2xl font-bold text-gray-900">🏗 Production Units</h2>
            {units.map((u, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
                <div className="flex gap-3">
                  <input value={u.name} onChange={e => setUnits(us => us.map((x,j)=>j===i?{...x,name:e.target.value}:x))}
                    placeholder="Unit name (e.g. Cage A1)" className="flex-1 border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                  <select value={u.type} onChange={e => setUnits(us => us.map((x,j)=>j===i?{...x,type:e.target.value}:x))}
                    className="border-2 border-gray-300 rounded-xl px-3 py-2.5 bg-white">
                    {['CAGE','PEN','HOUSE','POND','TANK','PLOT'].map(t=><option key={t}>{t}</option>)}
                  </select>
                </div>
                <input type="number" value={u.capacity} onChange={e => setUnits(us => us.map((x,j)=>j===i?{...x,capacity:e.target.value}:x))}
                  placeholder="Capacity (animals)" className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
              </div>
            ))}
            <button type="button" onClick={() => setUnits(u => [...u, {name:'',type:'HOUSE',capacity:''}])}
              className="w-full border-2 border-dashed border-green-400 text-green-700 rounded-xl py-3 font-semibold">
              + Add Unit
            </button>
          </div>
        )}

        {/* Step 2: Batches */}
        {step === 2 && (
          <div className="flex flex-col gap-5">
            <h2 className="text-2xl font-bold text-gray-900">🐄 Current Batches</h2>
            <p className="text-gray-500 text-sm">Enter animals or crops already on your farm.</p>
            {batches.map((b, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
                <input value={b.name} onChange={e => setBatches(bs => bs.map((x,j)=>j===i?{...x,name:e.target.value}:x))}
                  placeholder="Batch name (e.g. Layer #003)" className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={b.species} onChange={e => setBatches(bs => bs.map((x,j)=>j===i?{...x,species:e.target.value}:x))}
                    placeholder="Species (e.g. chicken)" className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                  <select value={b.unitName} onChange={e => setBatches(bs => bs.map((x,j)=>j===i?{...x,unitName:e.target.value}:x))}
                    className="border-2 border-gray-300 rounded-xl px-3 py-2.5">
                    <option value="">Which unit?</option>
                    {units.filter(u => u.name).map((u, ui) => <option key={ui} value={u.name}>{u.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input type="number" value={b.qty} onChange={e => setBatches(bs => bs.map((x,j)=>j===i?{...x,qty:e.target.value}:x))}
                    placeholder="Qty" className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                  <input type="number" value={b.ageAtAcquire} onChange={e => setBatches(bs => bs.map((x,j)=>j===i?{...x,ageAtAcquire:e.target.value}:x))}
                    placeholder="Age (days)" className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                  <input type="number" value={b.cost} onChange={e => setBatches(bs => bs.map((x,j)=>j===i?{...x,cost:e.target.value}:x))}
                    placeholder="Cost (KSh)" className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setBatches(b => [...b, {name:'',species:'',unitName:'',qty:'',ageAtAcquire:'',cost:''}])}
              className="w-full border-2 border-dashed border-green-400 text-green-700 rounded-xl py-3 font-semibold">
              + Add Batch
            </button>
          </div>
        )}

        {/* Step 3: Inventory */}
        {step === 3 && (
          <div className="flex flex-col gap-5">
            <h2 className="text-2xl font-bold text-gray-900">📦 Opening Inventory</h2>
            {inventory.map((item, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
                <input value={item.name} onChange={e => setInventory(inv => inv.map((x,j)=>j===i?{...x,name:e.target.value}:x))}
                  placeholder="Item name (e.g. Layer Mash)" className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                <div className="grid grid-cols-2 gap-2">
                  <select value={item.category} onChange={e => setInventory(inv => inv.map((x,j)=>j===i?{...x,category:e.target.value}:x))}
                    className="border-2 border-gray-300 rounded-xl px-3 py-2.5 bg-white">
                    <option value="FEED_FINISHED">Feed (Finished)</option>
                    <option value="FEED_INGREDIENT">Feed Ingredient</option>
                    <option value="MEDICINE">Medicine</option>
                    <option value="VACCINE">Vaccine</option>
                    <option value="SEED">Seed</option>
                  </select>
                  <input type="number" value={item.qty} onChange={e => setInventory(inv => inv.map((x,j)=>j===i?{...x,qty:e.target.value}:x))}
                    placeholder="Opening qty" className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                </div>
                <input type="number" value={item.unitCost} onChange={e => setInventory(inv => inv.map((x,j)=>j===i?{...x,unitCost:e.target.value}:x))}
                  placeholder="Unit cost (KSh)" className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
              </div>
            ))}
            <button type="button" onClick={() => setInventory(i => [...i, {name:'',category:'FEED_FINISHED',unit:'kg',qty:'',unitCost:''}])}
              className="w-full border-2 border-dashed border-green-400 text-green-700 rounded-xl py-3 font-semibold">
              + Add Item
            </button>
          </div>
        )}

        {/* Step 4: Employees */}
        {step === 4 && (
          <div className="flex flex-col gap-5">
            <h2 className="text-2xl font-bold text-gray-900">👥 Employees & PINs</h2>
            <p className="text-gray-500 text-sm">Workers log in with their phone + PIN. PINs are stored hashed — never plain text.</p>
            {employees.map((emp, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <input value={emp.name} onChange={e => setEmployees(es => es.map((x,j)=>j===i?{...x,name:e.target.value}:x))}
                    placeholder="Name" className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                  <input type="tel" value={emp.phone} onChange={e => setEmployees(es => es.map((x,j)=>j===i?{...x,phone:e.target.value}:x))}
                    placeholder="+254700…" className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={emp.role} onChange={e => setEmployees(es => es.map((x,j)=>j===i?{...x,role:e.target.value}:x))}
                    className="border-2 border-gray-300 rounded-xl px-3 py-2.5 bg-white">
                    <option value="worker">Worker</option>
                    <option value="manager">Manager</option>
                  </select>
                  <input type="password" value={emp.pin} onChange={e => setEmployees(es => es.map((x,j)=>j===i?{...x,pin:e.target.value}:x))}
                    placeholder="PIN (4–6 digits)" maxLength={6} className="border-2 border-gray-300 rounded-xl px-3 py-2.5 font-mono tracking-widest" />
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setEmployees(e => [...e, {name:'',phone:'',role:'worker',pin:''}])}
              className="w-full border-2 border-dashed border-green-400 text-green-700 rounded-xl py-3 font-semibold">
              + Add Employee
            </button>
          </div>
        )}

        {/* Step 5: Worker Profile Config */}
        {step === 5 && (
          <div className="flex flex-col gap-5">
            <h2 className="text-2xl font-bold text-gray-900">⚙️ Worker Portal Config</h2>
            <p className="text-gray-500 text-sm">Control what workers can see and enter. Hidden fields are stripped server-side — not CSS-hidden.</p>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 font-semibold">
                  <tr><th className="px-4 py-2 text-left">Field</th><th className="px-3 py-2">Visible</th><th className="px-3 py-2">Required</th><th className="px-3 py-2">Editable</th></tr>
                </thead>
                <tbody>
                  {[
                    ['Feed unit cost (KSh)','feed_unit_cost',false,false,false],
                    ['Feed quantity (kg)','feed_qty',true,true,true],
                    ['Egg sale price','egg_sale_price',false,false,false],
                    ['Mortality cause','mortality_cause',true,false,true],
                    ['Batch profit/loss','batch_pl',false,false,false],
                    ['Water level','water_level',true,true,true],
                    ['Eggs collected','eggs_collected',true,true,true],
                  ].map(([label,,v,r,e]) => (
                    <tr key={String(label)} className="border-t border-gray-100">
                      <td className="px-4 py-2 font-medium text-gray-800">{String(label)}</td>
                      {[v,r,e].map((checked, ci) => (
                        <td key={ci} className="px-3 py-2 text-center">
                          <input type="checkbox" defaultChecked={!!checked} className="w-4 h-4 accent-green-600" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="font-medium text-gray-700">Photo required if deaths &gt;</span>
              <input type="number" value={mortalityThreshold} onChange={e => setMortalityThreshold(e.target.value)}
                className="w-20 border-2 border-gray-300 rounded-xl px-3 py-2 text-center text-lg font-bold" min="0" />
            </div>
          </div>
        )}

        {/* Step 6: Thresholds */}
        {step === 6 && (
          <div className="flex flex-col gap-5">
            <h2 className="text-2xl font-bold text-gray-900">🔔 Alert Thresholds</h2>
            <div className="flex flex-col gap-4">
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-4 flex items-center justify-between">
                <div><p className="font-semibold text-gray-800">Mortality spike alert (%)</p><p className="text-xs text-gray-400">Alert when batch mortality rate exceeds this</p></div>
                <input type="number" step="0.1" value={mortalityRate} onChange={e => setMortalityRate(e.target.value)}
                  className="w-20 border-2 border-green-300 rounded-xl px-3 py-2 text-center text-xl font-bold" />
              </div>
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-4 flex items-center justify-between">
                <div><p className="font-semibold text-gray-800">Low stock threshold (kg)</p><p className="text-xs text-gray-400">Alert when feed drops below this</p></div>
                <input type="number" value={lowStockKg} onChange={e => setLowStockKg(e.target.value)}
                  className="w-20 border-2 border-green-300 rounded-xl px-3 py-2 text-center text-xl font-bold" />
              </div>
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <p className="text-green-800 font-bold">✓ Setup complete!</p>
                <p className="text-green-600 text-sm mt-1">Currency: {currency} · Farm: {farmName || '(unnamed)'} · {units.filter(u=>u.name).length} units · {batches.filter(b=>b.name).length} batches</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {finishErr && <div className="max-w-2xl mx-auto w-full px-5"><p className="text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm font-semibold">{finishErr}</p></div>}

      {/* Footer nav */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-5 py-4 flex gap-3 max-w-2xl mx-auto w-full">
        {step > 0 && (
          <button onClick={() => setStep(s => s - 1)} disabled={finishing}
            className="flex-1 min-h-[52px] bg-gray-100 text-gray-700 rounded-xl font-semibold text-base disabled:opacity-50">
            ← Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button onClick={() => { if (canNext()) setStep(s => s + 1); }}
            disabled={!canNext()}
            className="flex-1 min-h-[52px] bg-green-600 text-white rounded-xl font-bold text-base disabled:opacity-40">
            Next →
          </button>
        ) : (
          <button onClick={handleFinish} disabled={finishing}
            className="flex-1 min-h-[52px] bg-green-700 text-white rounded-xl font-bold text-lg disabled:opacity-50">
            {finishing ? 'Saving your farm…' : '✓ Finish Setup'}
          </button>
        )}
        {step < STEPS.length - 1 && (
          <button onClick={() => router.replace('/owner/dashboard')}
            className="text-sm text-gray-400 px-3">Skip</button>
        )}
      </div>
    </div>
  );
}
