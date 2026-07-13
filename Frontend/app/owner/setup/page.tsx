'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation, type TranslationKey } from '@/lib/i18n/useTranslation';
import { useAuthStore } from '@/lib/stores/auth';
import { cn } from '@/lib/utils';
import {
  Sprout, House, Building2, PawPrint, Package, Users, Settings, Bell,
  Egg, Drumstick, Fish, Wheat, Check, type LucideIcon,
} from 'lucide-react';

// Namespaced by tenant (not a bare shared key) so that on a shared/kiosk device,
// one owner's abandoned setup — including employee names/phone numbers — can
// never be silently restored into a different tenant's session. The tenantId is
// also stored inside the blob itself as a second check, in case a stale key from
// an old app version (pre-namespacing) is still sitting in localStorage.
const PROGRESS_KEY_PREFIX = 'ifms_setup_progress_';

interface SetupProgress {
  tenantId: string;
  farmName: string; farmLocation: string;
  templates: string[];
  units: { name: string; type: string; capacity: string }[];
  batches: { name: string; species: string; unitName: string; qty: string; ageAtAcquire: string; cost: string; acquiredDate: string }[];
  inventory: { name: string; category: string; unit: string; qty: string; unitCost: string }[];
  employees: { name: string; phone: string; role: string; pin: string; salary: string; payDay: string }[];
  mortalityRate: string; lowStockKg: string; mortalityThreshold: string;
  step: number;
}

function loadProgress(tenantId: string): SetupProgress | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY_PREFIX + tenantId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SetupProgress;
    return parsed.tenantId === tenantId ? parsed : null;
  } catch { return null; }
}

const TEMPLATES: { id: string; Icon: LucideIcon; labelKey: TranslationKey; descKey: TranslationKey }[] = [
  { id:'layers', Icon: Egg, labelKey:'layers', descKey:'layersDesc' },
  { id:'broilers', Icon: Drumstick, labelKey:'broilers', descKey:'broilersDesc' },
  { id:'pig_fatten', Icon: PawPrint, labelKey:'pigFatten', descKey:'pigFattenDesc' },
  { id:'pig_breed', Icon: PawPrint, labelKey:'pigBreed', descKey:'pigBreedDesc' },
  { id:'tilapia', Icon: Fish, labelKey:'tilapia', descKey:'tilapiaDesc' },
  { id:'catfish', Icon: Fish, labelKey:'catfish', descKey:'catfishDesc' },
  { id:'maize', Icon: Wheat, labelKey:'maize', descKey:'maizeDesc' },
];

const STEPS: { labelKey: TranslationKey; Icon: LucideIcon }[] = [
  { labelKey: 'farm', Icon: House },
  { labelKey: 'units', Icon: Building2 },
  { labelKey: 'batches', Icon: PawPrint },
  { labelKey: 'inventory', Icon: Package },
  { labelKey: 'employees', Icon: Users },
  { labelKey: 'workerProfile', Icon: Settings },
  { labelKey: 'thresholds', Icon: Bell },
];

export default function SetupWizardPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuthStore();
  const tenantId = user?.tenantId ?? '';
  const [step, setStep] = useState(0);
  const [farmName, setFarmName] = useState('');
  const [farmLocation, setFarmLocation] = useState('');
  const [currency] = useState('KSh');
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [units, setUnits] = useState([{ name: '', type: 'HOUSE', capacity: '' }]);
  const [batches, setBatches] = useState([{ name: '', species: '', unitName: '', qty: '', ageAtAcquire: '', cost: '', acquiredDate: '' }]);
  const [inventory, setInventory] = useState([{ name: '', category: 'FEED_FINISHED', unit: 'kg', qty: '', unitCost: '' }]);
  const [employees, setEmployees] = useState([{ name: '', phone: '', role: 'worker', pin: '', salary: '', payDay: '' }]);
  const [mortalityThreshold, setMortalityThreshold] = useState('1');
  const [lowStockKg, setLowStockKg] = useState('50');
  const [mortalityRate, setMortalityRate] = useState('2.0');

  // Restore any in-progress wizard state on mount (e.g. after a refresh or
  // crash) so typed data is never silently lost. Runs once; `hydrated` guards
  // the save effect below from firing before restore has applied (so we
  // don't immediately clobber saved progress with pre-restore blank state).
  const hydrated = useRef(false);
  useEffect(() => {
    // Wait for the auth store (persisted, hydrates async on mount) to actually
    // resolve a tenantId before restoring or allowing saves — restoring against
    // an empty tenantId would read/write nothing useful, and marking `hydrated`
    // early would let the save effect below fire with a blank tenantId key.
    if (!tenantId) return;
    const saved = loadProgress(tenantId);
    let restoredFarmName = '';
    if (saved) {
      restoredFarmName = saved.farmName ?? '';
      setFarmName(restoredFarmName);
      setFarmLocation(saved.farmLocation ?? '');
      if (saved.templates?.length) setSelectedTemplates(saved.templates);
      if (saved.units?.length) setUnits(saved.units);
      if (saved.batches?.length) setBatches(saved.batches);
      if (saved.inventory?.length) setInventory(saved.inventory);
      if (saved.employees?.length) setEmployees(saved.employees);
      if (saved.mortalityRate) setMortalityRate(saved.mortalityRate);
      if (saved.lowStockKg) setLowStockKg(saved.lowStockKg);
      if (saved.mortalityThreshold) setMortalityThreshold(saved.mortalityThreshold);
      if (typeof saved.step === 'number') setStep(saved.step);
    }
    // A returning owner already has a named farm server-side — an abandoned/absent
    // local draft must not make step 0 look blank as if nothing was ever set up.
    // Only fills in when the draft itself has no name, so it never overwrites text
    // the owner is actively mid-typing in this session.
    if (!restoredFarmName) {
      fetch('/api/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null)
        .then((me: { farmName?: string } | null) => { if (me?.farmName) setFarmName(me.farmName); })
        .catch(() => {});
    }
    hydrated.current = true;
  }, [tenantId]);

  // Persist progress (debounced) on every meaningful change, so a refresh or
  // crash mid-wizard doesn't lose what the owner already typed. Skipped until
  // the restore effect above has run, so we don't immediately clobber saved
  // progress with the pre-restore blank defaults.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hydrated.current || !tenantId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const progress: SetupProgress = {
        tenantId, farmName, farmLocation, templates: selectedTemplates, units, batches, inventory, employees,
        mortalityRate, lowStockKg, mortalityThreshold, step,
      };
      try { localStorage.setItem(PROGRESS_KEY_PREFIX + tenantId, JSON.stringify(progress)); } catch { /* noop */ }
    }, 400);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [tenantId, farmName, farmLocation, selectedTemplates, units, batches, inventory, employees, mortalityRate, lowStockKg, mortalityThreshold, step]);

  const canNext = () => {
    if (step === 0) return farmName.trim().length > 0;
    if (step === 1) return units.every(u => u.name && u.capacity);
    if (step === 2) return batches.every(b => b.name && b.qty);
    return true;
  };

  const [finishing, setFinishing] = useState(false);
  const [finishErr, setFinishErr] = useState('');

  // Retries are safe to resubmit as-is: /api/setup is idempotent-by-content
  // (dedupes by tenant+name / tenant+phone server-side), so no client-side
  // idempotency token is needed here — clicking Finish again after a failed
  // attempt reuses whatever was already created instead of duplicating it.
  const handleFinish = async () => {
    setFinishing(true); setFinishErr('');
    try {
      const res = await fetch('/api/setup', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmName, farmLocation, templates: selectedTemplates,
          units, batches, inventory, employees,
          mortalityRate, lowStockKg, mortalityPhotoThreshold: mortalityThreshold,
        }),
      });
      if (!res.ok) {
        // 400s carry a specific, actionable reason (e.g. "batch X could not be
        // assigned to a production unit" or a bad numeric field) — surface it
        // instead of a canned message, or the owner has no way to know what to
        // fix and "Setup failed — please retry" just fails the same way again.
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(
          res.status === 403 ? 'Only the owner can run setup'
            : res.status === 401 ? 'Please sign in again'
            : body.error || 'Setup failed — please retry'
        );
      }
      try { if (tenantId) localStorage.removeItem(PROGRESS_KEY_PREFIX + tenantId); } catch { /* noop */ }
      router.replace('/owner/dashboard');
    } catch (e) { setFinishErr((e as Error).message); setFinishing(false); }
  };

  const StepIcon = STEPS[step].Icon;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-6 py-5">
        <div className="flex items-center gap-3 mb-4">
          <Sprout className="w-8 h-8 shrink-0" />
          <div><h1 className="text-xl font-bold">{t('setupWizard')}</h1><p className="text-primary-foreground/80 text-sm">Get your farm ready to run in a few short steps.</p></div>
        </div>
        <div className="flex gap-1.5">
          {STEPS.map((s, i) => (
            <button key={i} onClick={() => i < step + 1 && setStep(i)}
              className={cn('flex-1 h-2 rounded-full transition-colors', i <= step ? 'bg-white' : 'bg-primary-foreground/30')}>
              <span className="sr-only">{t(s.labelKey)}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-primary-foreground/80 text-xs flex items-center gap-1"><StepIcon className="w-3.5 h-3.5" /> {t('step')} {step+1}: {t(STEPS[step].labelKey)}</span>
          <span className="text-primary-foreground/70 text-xs">{step+1}/{STEPS.length}</span>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 p-5 max-w-2xl mx-auto w-full">
        {/* Step 0: Farm */}
        {step === 0 && (
          <div className="flex flex-col gap-5">
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><House className="w-6 h-6 text-primary" /> {t('yourFarm')}</h2>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">{t('farmName')} *</label>
              <input value={farmName} onChange={e => setFarmName(e.target.value)} placeholder="e.g. Okello Family Farm"
                className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">{t('location')}</label>
              <input value={farmLocation} onChange={e => setFarmLocation(e.target.value)} placeholder="e.g. Kiambu County, Kenya"
                className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base" />
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-blue-800 font-semibold text-sm mb-2">{t('quickStartTemplates')}</p>
              <p className="text-blue-600 text-xs mb-3">{t('templateDesc')}</p>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map(tmpl => (
                  <button key={tmpl.id} type="button" onClick={() => setSelectedTemplates(ts => ts.includes(tmpl.id) ? ts.filter(x=>x!==tmpl.id) : [...ts,tmpl.id])}
                    className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-semibold transition-colors',
                      selectedTemplates.includes(tmpl.id) ? 'bg-primary/10 border-primary text-primary' : 'bg-white border-gray-200 text-gray-700')}>
                    <tmpl.Icon className="w-5 h-5 shrink-0" /><div className="text-left"><div>{t(tmpl.labelKey)}</div><div className="text-xs text-gray-400 font-normal">{t(tmpl.descKey)}</div></div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Units */}
        {step === 1 && (
          <div className="flex flex-col gap-5">
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Building2 className="w-6 h-6 text-primary" /> {t('productionUnits')}</h2>
            {units.map((u, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
                <div className="flex gap-3">
                  <input value={u.name} onChange={e => setUnits(us => us.map((x,j)=>j===i?{...x,name:e.target.value}:x))}
                    placeholder={t('unitNamePlaceholder')} className="flex-1 border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                  <select value={u.type} onChange={e => setUnits(us => us.map((x,j)=>j===i?{...x,type:e.target.value}:x))}
                    className="border-2 border-gray-300 rounded-xl px-3 py-2.5 bg-white">
                    {['CAGE','PEN','HOUSE','POND','TANK','PLOT'].map(t=><option key={t}>{t}</option>)}
                  </select>
                </div>
                <input type="number" value={u.capacity} onChange={e => setUnits(us => us.map((x,j)=>j===i?{...x,capacity:e.target.value}:x))}
                  placeholder={t('capacityPlaceholder')} className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
              </div>
            ))}
            <button type="button" onClick={() => setUnits(u => [...u, {name:'',type:'HOUSE',capacity:''}])}
              className="w-full border-2 border-dashed border-primary/40 text-primary rounded-xl py-3 font-semibold">
              + {t('addUnit')}
            </button>
          </div>
        )}

        {/* Step 2: Batches */}
        {step === 2 && (
          <div className="flex flex-col gap-5">
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><PawPrint className="w-6 h-6 text-primary" /> {t('currentBatches')}</h2>
            <p className="text-gray-500 text-sm">{t('batchesDesc')}</p>
            {batches.map((b, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
                <input value={b.name} onChange={e => setBatches(bs => bs.map((x,j)=>j===i?{...x,name:e.target.value}:x))}
                  placeholder={t('batchNamePlaceholder')} className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={b.species} onChange={e => setBatches(bs => bs.map((x,j)=>j===i?{...x,species:e.target.value}:x))}
                    placeholder={t('speciesPlaceholder')} className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                  <select value={b.unitName} onChange={e => setBatches(bs => bs.map((x,j)=>j===i?{...x,unitName:e.target.value}:x))}
                    className="border-2 border-gray-300 rounded-xl px-3 py-2.5">
                    <option value="">{t('whichUnit')}</option>
                    {units.filter(u => u.name).map((u, ui) => <option key={ui} value={u.name}>{u.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input type="number" value={b.qty} onChange={e => setBatches(bs => bs.map((x,j)=>j===i?{...x,qty:e.target.value}:x))}
                    placeholder={t('qty')} className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                  <input type="number" value={b.ageAtAcquire} onChange={e => setBatches(bs => bs.map((x,j)=>j===i?{...x,ageAtAcquire:e.target.value}:x))}
                    placeholder={t('ageDays')} className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                  <input type="number" value={b.cost} onChange={e => setBatches(bs => bs.map((x,j)=>j===i?{...x,cost:e.target.value}:x))}
                    placeholder={t('costKSh')} className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-500">{t('dateAcquired')}</label>
                  {/* Feeds ageDays()/lifecycle-stage math — leaving this at "today" for a
                      batch that's actually been on the farm for a while (the whole point
                      of this step) understates its true current age. */}
                  <input type="date" value={b.acquiredDate || new Date().toISOString().slice(0, 10)}
                    onChange={e => setBatches(bs => bs.map((x,j)=>j===i?{...x,acquiredDate:e.target.value}:x))}
                    className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setBatches(b => [...b, {name:'',species:'',unitName:'',qty:'',ageAtAcquire:'',cost:'',acquiredDate:''}])}
              className="w-full border-2 border-dashed border-primary/40 text-primary rounded-xl py-3 font-semibold">
              + {t('addBatch')}
            </button>
          </div>
        )}

        {/* Step 3: Inventory */}
        {step === 3 && (
          <div className="flex flex-col gap-5">
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Package className="w-6 h-6 text-primary" /> {t('openingInventory')}</h2>
            {inventory.map((item, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
                <input value={item.name} onChange={e => setInventory(inv => inv.map((x,j)=>j===i?{...x,name:e.target.value}:x))}
                  placeholder={t('itemNamePlaceholder')} className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                <div className="grid grid-cols-2 gap-2">
                  <select value={item.category} onChange={e => setInventory(inv => inv.map((x,j)=>j===i?{...x,category:e.target.value}:x))}
                    className="border-2 border-gray-300 rounded-xl px-3 py-2.5 bg-white">
                    <option value="FEED_FINISHED">{t('feedFinished')}</option>
                    <option value="FEED_INGREDIENT">{t('feedIngredient')}</option>
                    <option value="MEDICINE">{t('medicine')}</option>
                    <option value="VACCINE">{t('vaccine')}</option>
                    <option value="SEED">{t('seed')}</option>
                  </select>
                  <input type="number" value={item.qty} onChange={e => setInventory(inv => inv.map((x,j)=>j===i?{...x,qty:e.target.value}:x))}
                    placeholder={t('openingQty')} className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                </div>
                <input type="number" value={item.unitCost} onChange={e => setInventory(inv => inv.map((x,j)=>j===i?{...x,unitCost:e.target.value}:x))}
                  placeholder={t('unitCostPlaceholder')} className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
              </div>
            ))}
            <button type="button" onClick={() => setInventory(i => [...i, {name:'',category:'FEED_FINISHED',unit:'kg',qty:'',unitCost:''}])}
              className="w-full border-2 border-dashed border-primary/40 text-primary rounded-xl py-3 font-semibold">
              + {t('addItem')}
            </button>
          </div>
        )}

        {/* Step 4: Employees */}
        {step === 4 && (
          <div className="flex flex-col gap-5">
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Users className="w-6 h-6 text-primary" /> {t('employeesAndPINs')}</h2>
            <p className="text-gray-500 text-sm">{t('employeesPINDesc')}</p>
            {employees.map((emp, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <input value={emp.name} onChange={e => setEmployees(es => es.map((x,j)=>j===i?{...x,name:e.target.value}:x))}                    placeholder={t('name')}
 className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                  <input type="tel" value={emp.phone} onChange={e => setEmployees(es => es.map((x,j)=>j===i?{...x,phone:e.target.value}:x))}
                    placeholder={t('phonePlaceholder')} className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={emp.role} onChange={e => setEmployees(es => es.map((x,j)=>j===i?{...x,role:e.target.value}:x))}
                    className="border-2 border-gray-300 rounded-xl px-3 py-2.5 bg-white">
                    <option value="worker">{t('worker')}</option>
                    <option value="manager">{t('managerRole')}</option>
                  </select>
                  <input type="password" value={emp.pin} onChange={e => setEmployees(es => es.map((x,j)=>j===i?{...x,pin:e.target.value}:x))}
                    placeholder={t('pinPlaceholder')} maxLength={6} className="border-2 border-gray-300 rounded-xl px-3 py-2.5 font-mono tracking-widest" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" min="0" value={emp.salary} onChange={e => setEmployees(es => es.map((x,j)=>j===i?{...x,salary:e.target.value}:x))}
                    placeholder={`${t('salary')} (${currency})`} className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                  <input type="number" min="1" max="31" value={emp.payDay} onChange={e => setEmployees(es => es.map((x,j)=>j===i?{...x,payDay:e.target.value}:x))}
                    placeholder={`${t('payDay')} (1–31)`} className="border-2 border-gray-300 rounded-xl px-3 py-2.5" />
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setEmployees(e => [...e, {name:'',phone:'',role:'worker',pin:'',salary:'',payDay:''}])}
              className="w-full border-2 border-dashed border-primary/40 text-primary rounded-xl py-3 font-semibold">
              + {t('addEmployee')}
            </button>
          </div>
        )}

        {/* Step 5: Worker Profile Config */}
        {step === 5 && (
          <div className="flex flex-col gap-5">
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Settings className="w-6 h-6 text-primary" /> {t('configProfile')}</h2>
            <p className="text-gray-500 text-sm">{t('configProfileDesc')}</p>
            {/* Per-field visibility/required/editable is a real per-worker-profile setting
                (workerProfiles.fields, edited in app/owner/config/page.tsx and enforced
                server-side in lib/server/fieldPermissions.ts) — but /api/setup has no field
                for it, so a matrix here would silently discard every choice. Point at the
                page that actually saves it instead of showing controls that do nothing. */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-blue-800 text-sm">
                What each worker can see, edit, or must fill in — per field — is set up after setup, in <strong>Settings → Config</strong>, once your worker profiles exist.
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="font-medium text-gray-700">{t('photoRequiredIfDeaths')}</span>
              <input type="number" value={mortalityThreshold} onChange={e => setMortalityThreshold(e.target.value)}
                className="w-20 border-2 border-gray-300 rounded-xl px-3 py-2 text-center text-lg font-bold" min="0" />
            </div>
          </div>
        )}

        {/* Step 6: Thresholds */}
        {step === 6 && (
          <div className="flex flex-col gap-5">
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Bell className="w-6 h-6 text-primary" /> {t('alertThresholds')}</h2>
            <div className="flex flex-col gap-4">
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-4 flex items-center justify-between">
                <div><p className="font-semibold text-gray-800">{t('mortalitySpikeAlert')}</p><p className="text-xs text-gray-400">{t('mortalitySpikeDesc')}</p></div>
                <input type="number" step="0.1" value={mortalityRate} onChange={e => setMortalityRate(e.target.value)}
                  className="w-20 border-2 border-primary/40 rounded-xl px-3 py-2 text-center text-xl font-bold" />
              </div>
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-4 flex items-center justify-between">
                <div><p className="font-semibold text-gray-800">{t('lowStockThreshold')}</p><p className="text-xs text-gray-400">{t('lowStockDesc')}</p></div>
                <input type="number" value={lowStockKg} onChange={e => setLowStockKg(e.target.value)}
                  className="w-20 border-2 border-primary/40 rounded-xl px-3 py-2 text-center text-xl font-bold" />
              </div>
              <div className="bg-success/10 border border-success/30 rounded-xl p-4">
                <p className="text-success font-bold">{t('setupComplete')}</p>
                <p className="text-success/90 text-sm mt-1">{t('currency')}: {currency} · {t('farmName')}: {farmName || '(unnamed)'} · {units.filter(u=>u.name).length} {t('units')} · {batches.filter(b=>b.name).length} {t('batches')}</p>
                {/* Connects the two onboarding systems (Phase 6 item 9): the wizard only
                    covers first-time data entry — the Setup Guide (floating button on the
                    dashboard) covers day-to-day running: worker permissions, alert rules,
                    tasks, sales, payroll. */}
                <p className="text-success/90 text-xs mt-2">Next: after you finish, open the green &quot;Setup Guide&quot; button on your dashboard for what to do day to day — worker permissions, alert rules, tasks, sales and payroll.</p>
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
            {t('back')} ←
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button onClick={() => { if (canNext()) setStep(s => s + 1); }}
            disabled={!canNext()}
            className="flex-1 min-h-[52px] bg-primary text-primary-foreground rounded-xl font-bold text-base disabled:opacity-40">
            {t('next')} →
          </button>
        ) : (
          <button onClick={handleFinish} disabled={finishing}
            className="flex-1 min-h-[52px] bg-primary text-primary-foreground rounded-xl font-bold text-lg disabled:opacity-50 flex items-center justify-center gap-2">
            {!finishing && <Check className="w-5 h-5" />} {finishing ? t('saving') : t('finishSetup')}
          </button>
        )}
        {step < STEPS.length - 1 && (
          <button onClick={() => router.replace('/owner/dashboard')}
            className="text-sm text-gray-400 px-3">{t('skip')}</button>
        )}
      </div>
    </div>
  );
}
