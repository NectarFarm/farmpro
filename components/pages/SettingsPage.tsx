'use client';
import { useState } from 'react';
import { Settings, User, Lock, Building2, Trash2, Plus, Download, Upload, DollarSign, Edit2, Check, X, Phone, ShieldCheck, GripVertical, Bird } from 'lucide-react';
import { useFarmStore, hashPin } from '@/lib/store';
import { formatCurrency, generateId } from '@/lib/utils';
import { toast } from 'sonner';
import type { EmployeeSalary, CustomerPortalUser, FlockStageConfig, LocationType, EnterpriseType } from '@/lib/types';

const inputCls = 'w-full px-3 py-2 rounded-xl border border-border bg-input text-sm outline-none focus:ring-2 focus:ring-primary/30';
const btnPrimary = 'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-primary hover:opacity-90 transition-all';

const ENTERPRISE_TYPES: { value: EnterpriseType; label: string }[] = [
  { value: 'poultry', label: 'Poultry (birds / eggs)' },
  { value: 'pigs', label: 'Pigs / other livestock' },
  { value: 'fish', label: 'Fish / aquaculture' },
  { value: 'crops', label: 'Crops' },
  { value: 'mixed', label: 'Mixed farm' },
];

function Section({ title, icon, subtitle, children }: { title: string; icon: React.ReactNode; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="glass-card rounded-2xl p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-foreground flex items-center gap-2">{icon}{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// ── Salary Management sub-component ──────────────────────────────────────────
function SalarySection() {
  const { employees, employeeSalaries, addEmployeeSalary, updateEmployeeSalary, deleteEmployeeSalary } = useFarmStore();
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ employeeId: '', amount: '', payDay: '25', notes: '' });
  const s = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  function handleAdd() {
    if (!form.employeeId) { toast.error('Select an employee'); return; }
    const amt = Number(form.amount);
    if (!amt || amt <= 0) { toast.error('Enter valid salary amount'); return; }
    const day = parseInt(form.payDay);
    if (day < 1 || day > 28) { toast.error('Pay day must be 1–28'); return; }
    const emp = employees.find(e => e.id === form.employeeId);
    if (!emp) return;
    const existing = employeeSalaries.find(s => s.employeeId === form.employeeId);
    if (existing) { toast.error('Salary already set for this employee. Edit instead.'); return; }
    const sal: EmployeeSalary = {
      id: generateId(), employeeId: form.employeeId, employeeName: emp.name,
      amount: amt, payDayOfMonth: day, notes: form.notes,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    addEmployeeSalary(sal);
    toast.success(`Salary set for ${emp.name}`);
    setForm({ employeeId: '', amount: '', payDay: '25', notes: '' });
  }

  function handleUpdate(id: string) {
    const sal = employeeSalaries.find(s => s.id === id);
    if (!sal) return;
    const amt = Number(form.amount);
    const day = parseInt(form.payDay);
    if (!amt || amt <= 0 || day < 1 || day > 28) { toast.error('Invalid values'); return; }
    updateEmployeeSalary(id, { amount: amt, payDayOfMonth: day, notes: form.notes });
    toast.success('Salary updated');
    setEditId(null);
  }

  const totalMonthlySalaries = employeeSalaries.reduce((s, sal) => s + sal.amount, 0);

  return (
    <div className="space-y-3">
      {employeeSalaries.length > 0 && (
        <div className="px-3 py-2 rounded-xl text-xs font-semibold"
          style={{ background: 'oklch(0.42 0.14 148 / 0.08)', color: 'oklch(0.35 0.12 148)' }}>
          Total monthly salary expense: {formatCurrency(totalMonthlySalaries)}
        </div>
      )}
      {employeeSalaries.length === 0 && <p className="text-xs text-muted-foreground">No salary records yet.</p>}
      {employeeSalaries.map(sal => (
        <div key={sal.id} className="rounded-xl border border-border p-3">
          {editId === sal.id ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">{sal.employeeName}</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Amount (Ksh)</label>
                  <input type="number" min="0" value={form.amount} onChange={e => s('amount', e.target.value)} className={inputCls} placeholder="e.g. 15000" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Pay Day (1–28)</label>
                  <input type="number" min="1" max="28" value={form.payDay} onChange={e => s('payDay', e.target.value)} className={inputCls} />
                </div>
              </div>
              <input value={form.notes} onChange={e => s('notes', e.target.value)} className={inputCls} placeholder="Notes (optional)" />
              <div className="flex gap-2">
                <button onClick={() => handleUpdate(sal.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-primary text-white"><Check className="w-3 h-3" /> Save</button>
                <button onClick={() => setEditId(null)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-muted text-muted-foreground"><X className="w-3 h-3" /> Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{sal.employeeName}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {formatCurrency(sal.amount)}/month · Pay day: {sal.payDayOfMonth}th
                  {sal.notes && ` · ${sal.notes}`}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => { setEditId(sal.id); setForm({ employeeId: sal.employeeId, amount: String(sal.amount), payDay: String(sal.payDayOfMonth), notes: sal.notes ?? '' }); }}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><Edit2 className="w-3.5 h-3.5" /></button>
                <button onClick={() => { deleteEmployeeSalary(sal.id); toast.success('Salary record removed'); }}
                  className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          )}
        </div>
      ))}
      {/* Add salary form */}
      <div className="rounded-xl border border-dashed border-border p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add Salary Record</p>
        <select value={form.employeeId} onChange={e => s('employeeId', e.target.value)} className={inputCls}>
          <option value="">Select employee…</option>
          {employees.filter(emp => !employeeSalaries.find(s => s.employeeId === emp.id)).map(emp => (
            <option key={emp.id} value={emp.id}>{emp.name}</option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Monthly Salary (Ksh)</label>
            <input type="number" min="0" value={form.amount} onChange={e => s('amount', e.target.value)} className={inputCls} placeholder="e.g. 15000" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Pay Day of Month</label>
            <input type="number" min="1" max="28" value={form.payDay} onChange={e => s('payDay', e.target.value)} className={inputCls} />
          </div>
        </div>
        <input value={form.notes} onChange={e => s('notes', e.target.value)} className={inputCls} placeholder="Notes (optional)" />
        <button onClick={handleAdd} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Add Salary</button>
      </div>
    </div>
  );
}

// ── Customer Portal Users Section ─────────────────────────────────────────────
function CustomerPortalSection() {
  const { customers, customerPortalUsers, addCustomerPortalUser, updateCustomerPortalUser, removeCustomerPortalUser } = useFarmStore();
  const [form, setForm] = useState({ customerId: '', pin: '', confirmPin: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const s = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  function handleAdd() {
    if (!form.customerId) { toast.error('Select a customer'); return; }
    if (form.pin.length < 4) { toast.error('PIN must be ≥ 4 digits'); return; }
    if (form.pin !== form.confirmPin) { toast.error('PINs do not match'); return; }
    const cust = customers.find(c => c.id === form.customerId);
    if (!cust) return;
    if (customerPortalUsers.find(u => u.customerId === form.customerId)) { toast.error('Portal access already set for this customer'); return; }
    const user: CustomerPortalUser = {
      id: generateId(), customerId: form.customerId,
      name: cust.name, phone: cust.phone,
      pinHash: hashPin(form.pin), createdAt: new Date().toISOString(),
    };
    addCustomerPortalUser({ ...user, pin: form.pin });
    toast.success(`Portal access created for ${cust.name}`);
    setForm({ customerId: '', pin: '', confirmPin: '' });
  }

  function handleUpdatePin(id: string) {
    if (form.pin.length < 4) { toast.error('PIN must be ≥ 4 digits'); return; }
    if (form.pin !== form.confirmPin) { toast.error('PINs do not match'); return; }
    updateCustomerPortalUser(id, { pinHash: hashPin(form.pin) });
    toast.success('PIN updated'); setEditId(null); setForm({ customerId: '', pin: '', confirmPin: '' });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Give customers a PIN to log into the Customer Portal and place orders. Their PIN is 4+ digits — you set it here.
      </p>
      {customerPortalUsers.length === 0 && <p className="text-xs text-muted-foreground/60 italic">No portal users yet.</p>}
      {customerPortalUsers.map(u => (
        <div key={u.id} className="rounded-xl border border-border p-3">
          {editId === u.id ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">{u.name} <span className="text-xs text-muted-foreground">({u.phone})</span></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-muted-foreground block mb-1">New PIN</label><input type="password" value={form.pin} onChange={e => s('pin', e.target.value)} className={inputCls} placeholder="••••" /></div>
                <div><label className="text-xs text-muted-foreground block mb-1">Confirm PIN</label><input type="password" value={form.confirmPin} onChange={e => s('confirmPin', e.target.value)} className={inputCls} placeholder="••••" /></div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleUpdatePin(u.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-primary text-white"><Check className="w-3 h-3" /> Save</button>
                <button onClick={() => setEditId(null)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-muted text-muted-foreground"><X className="w-3 h-3" /> Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-sm font-medium">{u.name} <ShieldCheck className="w-3.5 h-3.5 text-primary" /></div>
                <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Phone className="w-3 h-3" /> {u.phone}</div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => { setEditId(u.id); setForm({ customerId: u.customerId, pin: '', confirmPin: '' }); }}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" title="Change PIN"><Edit2 className="w-3.5 h-3.5" /></button>
                <button onClick={() => { removeCustomerPortalUser(u.id); toast.success(`${u.name} portal access removed`); }}
                  className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          )}
        </div>
      ))}
      {/* Add form */}
      <div className="rounded-xl border border-dashed border-border p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Grant Portal Access</p>
        <select value={form.customerId} onChange={e => s('customerId', e.target.value)} className={inputCls}>
          <option value="">Select customer…</option>
          {customers.filter(c => !customerPortalUsers.find(u => u.customerId === c.id)).map(c => (
            <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs text-muted-foreground block mb-1">Set PIN (4+ digits)</label><input type="password" value={form.pin} onChange={e => s('pin', e.target.value)} className={inputCls} placeholder="••••" /></div>
          <div><label className="text-xs text-muted-foreground block mb-1">Confirm PIN</label><input type="password" value={form.confirmPin} onChange={e => s('confirmPin', e.target.value)} className={inputCls} placeholder="••••" /></div>
        </div>
        <button onClick={handleAdd} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Grant Access</button>
      </div>
    </div>
  );
}

// ── Pricing Section ───────────────────────────────────────────────────────────
function PricingSection() {
  const { pricePerEgg, pricePerTray, pricePerChick, setPricing } = useFarmStore();
  const [egg, setEgg] = useState(String(pricePerEgg));
  const [tray, setTray] = useState(String(pricePerTray));
  const [chick, setChick] = useState(String(pricePerChick));
  function save() {
    const e = Number(egg), t = Number(tray), c = Number(chick);
    if (e <= 0 || t <= 0 || c <= 0) { toast.error('All prices must be > 0'); return; }
    setPricing({ pricePerEgg: e, pricePerTray: t, pricePerChick: c });
    toast.success('Pricing updated');
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[{ label: 'Per Egg (Ksh)', val: egg, set: setEgg }, { label: 'Per Tray (Ksh)', val: tray, set: setTray }, { label: 'Per Chick (Ksh)', val: chick, set: setChick }].map(item => (
          <div key={item.label}>
            <label className="text-xs text-muted-foreground block mb-1">{item.label}</label>
            <input type="number" min="1" value={item.val} onChange={e => item.set(e.target.value)} className={inputCls} />
          </div>
        ))}
      </div>
      <button onClick={save} className={btnPrimary}><Check className="w-3.5 h-3.5" /> Save Prices</button>
    </div>
  );
}

// ── Flock Stages Section ──────────────────────────────────────────────────────
const ROLE_LABELS: Record<string, string> = { sold: 'Terminal · Sold', disposed: 'Terminal · Disposed' };

function FlockStagesSection() {
  const { flockStages, addFlockStage, updateFlockStage, deleteFlockStage } = useFarmStore();
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', role: '', pricePerBird: '0' });
  const s = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  function handleAdd() {
    if (!form.name.trim()) { toast.error('Stage name is required'); return; }
    const id = form.name.trim().toLowerCase().replace(/\s+/g, '-');
    if (flockStages.find(st => st.id === id)) { toast.error('A stage with that name already exists'); return; }
    const maxOrder = flockStages.reduce((m, st) => Math.max(m, st.displayOrder), -1);
    const stage: FlockStageConfig = {
      id, name: form.name.trim(),
      displayOrder: maxOrder + 1,
      role: form.role || null,
      pricePerBird: Number(form.pricePerBird) || 0,
    };
    addFlockStage(stage);
    toast.success(`Stage "${stage.name}" added`);
    setForm({ name: '', role: '', pricePerBird: '0' });
  }

  function handleUpdate(id: string) {
    const st = flockStages.find(x => x.id === id);
    if (!st) return;
    updateFlockStage(id, {
      name: form.name.trim() || st.name,
      role: form.role || null,
      pricePerBird: Number(form.pricePerBird) || 0,
    });
    toast.success('Stage updated');
    setEditId(null);
  }

  function moveUp(st: FlockStageConfig) {
    const sorted = [...flockStages].sort((a, b) => a.displayOrder - b.displayOrder);
    const idx = sorted.findIndex(x => x.id === st.id);
    if (idx <= 0) return;
    const prev = sorted[idx - 1];
    updateFlockStage(st.id, { displayOrder: prev.displayOrder });
    updateFlockStage(prev.id, { displayOrder: st.displayOrder });
  }

  function moveDown(st: FlockStageConfig) {
    const sorted = [...flockStages].sort((a, b) => a.displayOrder - b.displayOrder);
    const idx = sorted.findIndex(x => x.id === st.id);
    if (idx >= sorted.length - 1) return;
    const next = sorted[idx + 1];
    updateFlockStage(st.id, { displayOrder: next.displayOrder });
    updateFlockStage(next.id, { displayOrder: st.displayOrder });
  }

  const sorted = [...flockStages].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Define the lifecycle stages birds move through. Growth stages have a selling price per bird used in valuation.
        Terminal stages (Sold / Disposed) mark end-of-life — no further advancement from them.
      </p>

      {sorted.map((st, idx) => (
        <div key={st.id} className="rounded-xl border border-border p-3">
          {editId === st.id ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Stage Name</label>
                  <input value={form.name} onChange={e => s('name', e.target.value)} className={inputCls} placeholder={st.name} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Role</label>
                  <select value={form.role} onChange={e => s('role', e.target.value)} className={inputCls}>
                    <option value="">Growth (normal)</option>
                    <option value="sold">Terminal · Sold</option>
                    <option value="disposed">Terminal · Disposed</option>
                  </select>
                </div>
              </div>
              {!form.role && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Price per Bird (Ksh)</label>
                  <input type="number" min="0" value={form.pricePerBird} onChange={e => s('pricePerBird', e.target.value)} className={inputCls} />
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => handleUpdate(st.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-primary text-white"><Check className="w-3 h-3" /> Save</button>
                <button onClick={() => setEditId(null)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-muted text-muted-foreground"><X className="w-3 h-3" /> Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-0.5 text-muted-foreground">
                <button onClick={() => moveUp(st)} disabled={idx === 0} className="disabled:opacity-20 hover:text-foreground"><GripVertical className="w-3 h-3" /></button>
                <button onClick={() => moveDown(st)} disabled={idx === sorted.length - 1} className="disabled:opacity-20 hover:text-foreground rotate-180"><GripVertical className="w-3 h-3" /></button>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{st.name}</span>
                  {st.role && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                      {ROLE_LABELS[st.role] ?? st.role}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {st.role ? 'No selling price (terminal)' : `Price: ${formatCurrency(st.pricePerBird)}/bird`}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => {
                  setEditId(st.id);
                  setForm({ name: st.name, role: st.role ?? '', pricePerBird: String(st.pricePerBird) });
                }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><Edit2 className="w-3.5 h-3.5" /></button>
                <button onClick={() => { deleteFlockStage(st.id); toast.success(`Stage "${st.name}" removed`); }}
                  className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Add stage form */}
      <div className="rounded-xl border border-dashed border-border p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add Stage</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Name</label>
            <input value={form.name} onChange={e => s('name', e.target.value)} className={inputCls} placeholder="e.g. Finisher" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Role</label>
            <select value={form.role} onChange={e => s('role', e.target.value)} className={inputCls}>
              <option value="">Growth (normal)</option>
              <option value="sold">Terminal · Sold</option>
              <option value="disposed">Terminal · Disposed</option>
            </select>
          </div>
        </div>
        {!form.role && (
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Price per Bird (Ksh)</label>
            <input type="number" min="0" value={form.pricePerBird} onChange={e => s('pricePerBird', e.target.value)} className={inputCls} placeholder="0" />
          </div>
        )}
        <button onClick={handleAdd} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Add Stage</button>
      </div>
    </div>
  );
}

function LocationTypesSection() {
  const { locationTypes, addLocationType, updateLocationType, deleteLocationType } = useFarmStore();
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [newName, setNewName] = useState('');

  function handleAdd() {
    if (!newName.trim()) { toast.error('Location type name is required'); return; }
    const id = newName.trim().toLowerCase().replace(/\s+/g, '-');
    if (locationTypes.find(t => t.id === id)) { toast.error('A location type with that name already exists'); return; }
    const maxOrder = locationTypes.reduce((m, t) => Math.max(m, t.displayOrder), -1);
    addLocationType({ id, name: newName.trim(), displayOrder: maxOrder + 1 });
    toast.success(`Location type "${newName.trim()}" added`);
    setNewName('');
  }

  function handleUpdate(t: LocationType) {
    updateLocationType(t.id, { name: name.trim() || t.name });
    toast.success('Location type updated');
    setEditId(null);
  }

  function move(t: LocationType, dir: -1 | 1) {
    const sorted = [...locationTypes].sort((a, b) => a.displayOrder - b.displayOrder);
    const idx = sorted.findIndex(x => x.id === t.id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    updateLocationType(t.id, { displayOrder: swap.displayOrder });
    updateLocationType(swap.id, { displayOrder: t.displayOrder });
  }

  const sorted = [...locationTypes].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="space-y-3">
      {sorted.length === 0 && <p className="text-xs text-muted-foreground">No location types yet.</p>}
      {sorted.map((t, idx) => (
        <div key={t.id} className="rounded-xl border border-border p-3">
          {editId === t.id ? (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground block mb-1">Name</label>
                <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder={t.name} />
              </div>
              <button onClick={() => handleUpdate(t)} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs bg-primary text-white"><Check className="w-3 h-3" /> Save</button>
              <button onClick={() => setEditId(null)} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs bg-muted text-muted-foreground"><X className="w-3 h-3" /> Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-0.5 text-muted-foreground">
                <button onClick={() => move(t, -1)} disabled={idx === 0} className="disabled:opacity-20 hover:text-foreground"><GripVertical className="w-3 h-3" /></button>
                <button onClick={() => move(t, 1)} disabled={idx === sorted.length - 1} className="disabled:opacity-20 hover:text-foreground rotate-180"><GripVertical className="w-3 h-3" /></button>
              </div>
              <span className="flex-1 text-sm font-medium">{t.name}</span>
              <div className="flex gap-1.5">
                <button onClick={() => { setEditId(t.id); setName(t.name); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><Edit2 className="w-3.5 h-3.5" /></button>
                <button onClick={() => { deleteLocationType(t.id); toast.success(`Location type "${t.name}" removed`); }}
                  className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="rounded-xl border border-dashed border-border p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add Location Type</p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground block mb-1">Name</label>
            <input value={newName} onChange={e => setNewName(e.target.value)} className={inputCls} placeholder="e.g. Pond, Pen, Field" />
          </div>
          <button onClick={handleAdd} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Add</button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const {
    employees, addEmployee, removeEmployee,
    cages, addCage, deleteCage,
    locationTypes, enterpriseType, setEnterpriseType,
    exportData,
  } = useFarmStore();

  const [farmName, setFarmName] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('farmName') ?? '' : '');
  const [ownerName, setOwnerName] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('ownerName') ?? '' : '');
  function saveFarmInfo() {
    localStorage.setItem('farmName', farmName);
    localStorage.setItem('ownerName', ownerName);
    window.dispatchEvent(new Event('storage'));
    toast.success('Farm info saved');
  }

  const [curPin, setCurPin] = useState(''); const [newPin, setNewPin] = useState(''); const [confPin, setConfPin] = useState('');
  function handlePinChange() {
    if (newPin.length < 4) { toast.error('PIN must be ≥ 4 digits'); return; }
    if (newPin !== confPin) { toast.error('PINs do not match'); return; }
    localStorage.setItem('ownerPinOverride', hashPin(newPin));
    toast.success('PIN updated'); setCurPin(''); setNewPin(''); setConfPin('');
  }

  const [empName, setEmpName] = useState(''); const [empPin, setEmpPin] = useState('');
  async function handleAddEmployee() {
    if (!empName.trim()) { toast.error('Enter name'); return; }
    if (empPin.length < 4) { toast.error('PIN must be ≥ 4 digits'); return; }
    const emp = await addEmployee(empName.trim(), empPin);
    if (emp) { toast.success(`${empName} added`); setEmpName(''); setEmpPin(''); }
    else { toast.error('Failed to add employee'); }
  }

  const [mortThreshold, setMortThreshold] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('mortThreshold') ?? '5' : '5');
  const [budgetThreshold, setBudgetThreshold] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('budgetThreshold') ?? '90' : '90');
  function saveThresholds() { localStorage.setItem('mortThreshold', mortThreshold); localStorage.setItem('budgetThreshold', budgetThreshold); toast.success('Thresholds saved'); }

  const [cageName, setCageName] = useState(''); const [cageType, setCageType] = useState(''); const [cageCap, setCageCap] = useState('');
  const cageTypeValue = cageType || locationTypes[0]?.id || '';
  function handleAddCage() {
    if (!cageName.trim()) { toast.error('Enter cage name'); return; }
    if (!cageTypeValue) { toast.error('Add a location type first'); return; }
    const cap = parseInt(cageCap); if (isNaN(cap) || cap <= 0) { toast.error('Enter valid capacity'); return; }
    addCage({ id: generateId(), name: cageName.trim(), type: cageTypeValue, capacity: cap, createdAt: new Date().toISOString() });
    toast.success('Location added'); setCageName(''); setCageCap('');
  }

  function handleExport() {
    const blob = new Blob([exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'farm-data.json'; a.click(); URL.revokeObjectURL(url); toast.success('Exported');
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Configure farm settings, manage employees, salaries, cages, and alert thresholds</p>
      </div>

      <Section title="Farm Information" icon={<Building2 className="w-4 h-4 text-primary" />}>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-muted-foreground block mb-1">Farm Name</label><input value={farmName} onChange={e => setFarmName(e.target.value)} className={inputCls} placeholder="My Farm" /></div>
          <div><label className="text-xs text-muted-foreground block mb-1">Owner Name</label><input value={ownerName} onChange={e => setOwnerName(e.target.value)} className={inputCls} placeholder="Jane Wanjiku" /></div>
        </div>
        <button onClick={saveFarmInfo} className={btnPrimary}><Check className="w-3.5 h-3.5" /> Save</button>
        <div className="mt-3 pt-3 border-t border-border">
          <label className="text-xs text-muted-foreground block mb-1">Enterprise Type</label>
          <select value={enterpriseType} onChange={e => { setEnterpriseType(e.target.value as typeof enterpriseType); toast.success('Enterprise type updated'); }} className={inputCls}>
            {ENTERPRISE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <p className="text-[11px] text-muted-foreground mt-1">What you farm — sets the vocabulary and which modules are shown.</p>
        </div>
      </Section>

      <Section title="Egg & Chick Pricing" icon={<DollarSign className="w-4 h-4 text-primary" />} subtitle="Shown in customer portal and used for order estimates">
        <PricingSection />
      </Section>

      <Section title="Flock Stages" icon={<Bird className="w-4 h-4 text-primary" />} subtitle="Configure the lifecycle stages birds move through and their selling price per stage">
        <FlockStagesSection />
      </Section>

      <Section title="Location Types" icon={<Building2 className="w-4 h-4 text-primary" />} subtitle="Kinds of housing/areas on your farm — cage, pen, pond, tank, field, plot…">
        <LocationTypesSection />
      </Section>

      <Section title="Employee Management" icon={<User className="w-4 h-4 text-primary" />} subtitle="Add employees who can log in via the Employee portal">
        <div className="space-y-2">
          {employees.length === 0 && <p className="text-xs text-muted-foreground">No employees yet.</p>}
          {employees.map(emp => (
            <div key={emp.id} className="flex items-center justify-between rounded-xl px-3 py-2.5 bg-muted/50 border border-border">
              <span className="text-sm font-medium text-foreground">{emp.name}</span>
              <button onClick={() => { removeEmployee(emp.id); toast.success(`${emp.name} removed`); }}
                className="p-1 rounded-lg text-destructive hover:bg-destructive/10"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-end flex-wrap pt-1">
          <div className="flex-1 min-w-32"><label className="text-xs text-muted-foreground block mb-1">Name</label><input value={empName} onChange={e => setEmpName(e.target.value)} className={inputCls} placeholder="Employee name" /></div>
          <div className="w-28"><label className="text-xs text-muted-foreground block mb-1">PIN (4+ digits)</label><input type="password" value={empPin} onChange={e => setEmpPin(e.target.value)} className={inputCls} placeholder="••••" /></div>
          <button onClick={handleAddEmployee} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Add</button>
        </div>
      </Section>

      <Section title="Employee Salaries" icon={<DollarSign className="w-4 h-4 text-primary" />} subtitle="Set monthly salary per employee. On the pay day each month it auto-adds to Cost of Operations.">
        <SalarySection />
      </Section>

      <Section title="Customer Portal Access" icon={<ShieldCheck className="w-4 h-4 text-primary" />} subtitle="Create / manage login PINs for customers to access the order portal">
        <CustomerPortalSection />
      </Section>

      <Section title="Owner PIN" icon={<Lock className="w-4 h-4 text-primary" />}>
        <p className="text-xs text-muted-foreground">Default PIN is 1234.</p>
        <div className="grid grid-cols-3 gap-3">
          {[{label:'Current PIN',val:curPin,set:setCurPin},{label:'New PIN',val:newPin,set:setNewPin},{label:'Confirm PIN',val:confPin,set:setConfPin}].map(item => (
            <div key={item.label}><label className="text-xs text-muted-foreground block mb-1">{item.label}</label><input type="password" value={item.val} onChange={e => item.set(e.target.value)} className={inputCls} placeholder="••••" /></div>
          ))}
        </div>
        <button onClick={handlePinChange} className={btnPrimary}><Lock className="w-3.5 h-3.5" /> Update PIN</button>
      </Section>

      <Section title="Alert Thresholds" icon={<Settings className="w-4 h-4 text-primary" />}>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-muted-foreground block mb-1">Mortality Alert (%)</label><input type="number" min="0" max="100" value={mortThreshold} onChange={e => setMortThreshold(e.target.value)} className={inputCls} /></div>
          <div><label className="text-xs text-muted-foreground block mb-1">Budget Alert (%)</label><input type="number" min="0" max="100" value={budgetThreshold} onChange={e => setBudgetThreshold(e.target.value)} className={inputCls} /></div>
        </div>
        <button onClick={saveThresholds} className={btnPrimary}><Check className="w-3.5 h-3.5" /> Save Thresholds</button>
      </Section>

      <Section title="Cage Management" icon={<Building2 className="w-4 h-4 text-primary" />}>
        <div className="space-y-2">
          {cages.length === 0 && <p className="text-xs text-muted-foreground">No cages configured.</p>}
          {cages.map(c => (
            <div key={c.id} className="flex items-center justify-between rounded-xl px-3 py-2.5 bg-muted/50 border border-border">
              <span className="text-sm text-foreground">{c.name} <span className="text-xs text-muted-foreground capitalize">({c.type} · {c.capacity} birds)</span></span>
              <button onClick={() => { deleteCage(c.id); toast.success('Cage removed'); }} className="p-1 rounded-lg text-destructive hover:bg-destructive/10"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-28"><label className="text-xs text-muted-foreground block mb-1">Name</label><input value={cageName} onChange={e => setCageName(e.target.value)} className={inputCls} placeholder="Cage A" /></div>
          <div><label className="text-xs text-muted-foreground block mb-1">Type</label><select value={cageTypeValue} onChange={e => setCageType(e.target.value)} className={inputCls}>{locationTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div className="w-24"><label className="text-xs text-muted-foreground block mb-1">Capacity</label><input type="number" min="1" value={cageCap} onChange={e => setCageCap(e.target.value)} className={inputCls} /></div>
          <button onClick={handleAddCage} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Add</button>
        </div>
      </Section>

      <Section title="Data Management" icon={<Download className="w-4 h-4 text-primary" />}>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => toast.info('Demo data reset not available in production mode')} className="px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/70">Reset Demo Data</button>
          <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/70"><Download className="w-4 h-4" /> Export JSON</button>
          <label className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/70 cursor-pointer">
            <Upload className="w-4 h-4" /> Import JSON
            <input type="file" accept=".json" className="hidden" onChange={() => toast.info('Import coming soon')} />
          </label>
        </div>
      </Section>
    </div>
  );
}
