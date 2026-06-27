'use client';
import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Employee, Batch } from '@/lib/types';
import { StatusChip } from '@/components/worker/StatusChip';

const roleColor = (r: string) => ({ owner:'bg-purple-100 text-purple-700', manager:'bg-blue-100 text-blue-700', worker:'bg-green-100 text-green-700', vet:'bg-teal-100 text-teal-700', auditor:'bg-gray-100 text-gray-600' })[r] ?? 'bg-gray-100 text-gray-600';
const fmtKES = (n: number) => `KSh ${n.toLocaleString('en-KE')}`;
const EMPTY = { name: '', phone: '', role: 'worker', salary: '', payDay: '' };

// All current batches selected → null ("all, incl. future"); otherwise the explicit list.
function assignmentPayload(selected: Set<string>, allIds: string[]): string[] | null {
  return allIds.length > 0 && allIds.every(id => selected.has(id)) ? null : [...selected];
}
// Which batch ids an employee currently covers, for seeding the editor (null = all).
function selectedFor(emp: Employee, allIds: string[]): Set<string> {
  return new Set(emp.assignedBatchIds == null ? allIds : emp.assignedBatchIds.filter(id => allIds.includes(id)));
}

export default function PeoplePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [addSel, setAddSel] = useState<Set<string>>(new Set());

  // Inline assignment/pay editor for an existing employee.
  const [editId, setEditId] = useState<string | null>(null);
  const [editSel, setEditSel] = useState<Set<string>>(new Set());
  const [editSalary, setEditSalary] = useState('');
  const [editPayDay, setEditPayDay] = useState('');

  const activeBatches = batches.filter(b => b.status === 'ACTIVE');
  const allIds = activeBatches.map(b => b.id);
  const batchName = (id: string) => batches.find(b => b.id === id)?.name ?? id;

  const reload = () => Promise.all([api.getEmployees(), api.getBatches()]).then(([e, b]) => { setEmployees(e); setBatches(b); });
  useEffect(() => { reload(); }, []);

  const openAdd = () => { setForm(EMPTY); setAddSel(new Set(activeBatches.map(b => b.id))); setErr(''); setShow(true); };
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set); next.has(id) ? next.delete(id) : next.add(id); setter(next);
  };

  const createEmployee = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setErr('');
    try {
      const res = await fetch('/api/data/employees', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name, phone: form.phone, role: form.role,
          salary: Number(form.salary) || 0,
          payDay: form.payDay ? Number(form.payDay) : null,
          assignedBatchIds: assignmentPayload(addSel, allIds),
        }),
      });
      if (!res.ok) throw new Error(res.status === 403 ? 'Owner only' : res.status === 401 ? 'Please sign in again' : res.status === 400 ? 'Name and phone required' : `Failed (${res.status})`);
      setForm(EMPTY); setShow(false); await reload();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const startEdit = (emp: Employee) => {
    setEditId(emp.id);
    setEditSel(selectedFor(emp, allIds));
    setEditSalary(emp.salary ? String(emp.salary) : '');
    setEditPayDay(emp.payDay ? String(emp.payDay) : '');
  };
  const saveEdit = async (emp: Employee) => {
    setSaving(true); setErr('');
    try {
      await fetch(`/api/data/employees?id=${emp.id}`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salary: Number(editSalary) || 0,
          payDay: editPayDay ? Number(editPayDay) : null,
          assignedBatchIds: assignmentPayload(editSel, allIds),
        }),
      });
      setEditId(null); await reload();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const patchEmployee = async (id: string, body: Record<string, unknown>) => {
    await fetch(`/api/data/employees?id=${id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await reload();
  };

  const assignmentLabel = (emp: Employee) =>
    emp.assignedBatchIds == null ? 'All batches'
      : emp.assignedBatchIds.length === 0 ? 'None'
      : `${emp.assignedBatchIds.filter(id => allIds.includes(id)).length} of ${allIds.length}`;

  const BatchPicker = ({ sel, setter }: { sel: Set<string>; setter: (s: Set<string>) => void }) => (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500">Works on (uncheck to unassign)</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setter(new Set(allIds))} className="text-xs text-green-600 font-semibold">All</button>
          <button type="button" onClick={() => setter(new Set())} className="text-xs text-gray-400 font-semibold">None</button>
        </div>
      </div>
      {activeBatches.length === 0
        ? <p className="text-xs text-gray-400">No active batches yet.</p>
        : (
          <div className="flex flex-wrap gap-2">
            {activeBatches.map(b => (
              <button key={b.id} type="button" onClick={() => toggle(sel, setter, b.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 ${sel.has(b.id) ? 'bg-green-50 text-green-700 border-green-300' : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
                {sel.has(b.id) ? '✓ ' : ''}{b.name}
              </button>
            ))}
          </div>
        )}
      {allIds.length > 0 && allIds.every(id => sel.has(id)) && (
        <p className="text-[11px] text-gray-400">All selected → also covers any future batches.</p>
      )}
    </div>
  );

  return (
    <div className="p-6 flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">👥 People & Roles</h1>
        <button onClick={openAdd} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm">+ Add Employee</button>
      </div>

      {err && <p className="text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm font-semibold">{err}</p>}

      {show && (
        <form onSubmit={createEmployee} className="bg-white border border-green-300 rounded-xl p-5 flex flex-col gap-4">
          <h3 className="font-bold text-gray-800">Add Employee</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input placeholder="Full name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input placeholder="Phone (+254…)" required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="worker">Worker</option>
              <option value="manager">Manager</option>
              <option value="vet">Vet</option>
            </select>
            <input type="number" min="0" placeholder="Monthly salary (KSh)" value={form.salary} onChange={e => setForm({ ...form, salary: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input type="number" min="1" max="31" placeholder="Pay day (1–31)" value={form.payDay} onChange={e => setForm({ ...form, payDay: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <BatchPicker sel={addSel} setter={setAddSel} />
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Add'}</button>
            <button type="button" onClick={() => setShow(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">Cancel</button>
          </div>
        </form>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs font-semibold">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-3 py-3 text-center">Role</th>
              <th className="px-3 py-3 text-right hidden md:table-cell">Salary</th>
              <th className="px-3 py-3 text-center hidden md:table-cell">Pay day</th>
              <th className="px-3 py-3 text-center">Works on</th>
              <th className="px-3 py-3 text-center">Status</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {employees.map(emp => (
              <React.Fragment key={emp.id}>
                <tr className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-600">{emp.name[0]}</div>
                      <div>
                        <span className="font-semibold text-gray-900 block">{emp.name}</span>
                        <span className="font-mono text-gray-400 text-xs">{emp.phone}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${roleColor(emp.role)}`}>{emp.role}</span></td>
                  <td className="px-3 py-3 text-right hidden md:table-cell">{emp.salary ? fmtKES(emp.salary) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-3 text-center hidden md:table-cell">{emp.payDay ? `${emp.payDay}` : <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-3 text-center"><span className="text-xs font-semibold text-gray-700">{assignmentLabel(emp)}</span></td>
                  <td className="px-3 py-3 text-center"><StatusChip status={emp.active ? 'ok' : 'offline'} size="sm" label={emp.active ? 'Active' : 'Inactive'} /></td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button onClick={() => editId === emp.id ? setEditId(null) : startEdit(emp)} className="text-xs font-semibold text-green-700 hover:underline mr-3">{editId === emp.id ? 'Close' : 'Manage'}</button>
                    <button onClick={() => patchEmployee(emp.id, { active: !emp.active })} className={`text-xs font-semibold hover:underline ${emp.active ? 'text-red-600' : 'text-green-600'}`}>{emp.active ? 'Deactivate' : 'Activate'}</button>
                  </td>
                </tr>
                {editId === emp.id && (
                  <tr className="bg-gray-50/60">
                    <td colSpan={7} className="px-4 py-4">
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap gap-3">
                          <label className="text-xs font-semibold text-gray-500 flex flex-col gap-1">Monthly salary (KSh)
                            <input type="number" min="0" value={editSalary} onChange={e => setEditSalary(e.target.value)} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm w-44" />
                          </label>
                          <label className="text-xs font-semibold text-gray-500 flex flex-col gap-1">Pay day (1–31)
                            <input type="number" min="1" max="31" value={editPayDay} onChange={e => setEditPayDay(e.target.value)} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm w-28" />
                          </label>
                        </div>
                        <BatchPicker sel={editSel} setter={setEditSel} />
                        <div className="flex gap-2">
                          <button onClick={() => saveEdit(emp)} disabled={saving} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>
                          <button onClick={() => setEditId(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">Cancel</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {employees.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">No employees yet. Click “+ Add Employee”.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
