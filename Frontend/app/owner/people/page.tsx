'use client';
import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Employee } from '@/lib/types';
import { StatusChip } from '@/components/worker/StatusChip';

const roleColor = (r: string) => ({ owner:'bg-purple-100 text-purple-700', manager:'bg-blue-100 text-blue-700', worker:'bg-green-100 text-green-700', vet:'bg-teal-100 text-teal-700', auditor:'bg-gray-100 text-gray-600' })[r] ?? 'bg-gray-100 text-gray-600';

const EMPTY = { name: '', phone: '', role: 'worker' };

export default function PeoplePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(EMPTY);

  const reload = () => api.getEmployees().then(setEmployees);
  useEffect(() => { reload(); }, []);

  const createEmployee = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setErr('');
    try {
      const res = await fetch('/api/data/employees', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(res.status === 403 ? 'Owner only' : res.status === 401 ? 'Please sign in again' : res.status === 400 ? 'Name and phone required' : `Failed (${res.status})`);
      setForm(EMPTY); setShow(false); await reload();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const toggleActive = async (emp: Employee) => {
    try {
      await fetch(`/api/data/employees?id=${emp.id}`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !emp.active }),
      });
      await reload();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="p-6 flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">👥 People & Roles</h1>
        <button onClick={() => setShow(v => !v)} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm">+ Add Employee</button>
      </div>

      {show && (
        <form onSubmit={createEmployee} className="bg-white border border-green-300 rounded-xl p-5 flex flex-col gap-3">
          <h3 className="font-bold text-gray-800">Add Employee</h3>
          {err && <p className="text-red-600 bg-red-50 rounded-lg px-3 py-2 text-sm font-semibold">{err}</p>}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input placeholder="Full name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input placeholder="Phone (+254…)" required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="worker">Worker</option>
              <option value="manager">Manager</option>
              <option value="vet">Vet</option>
            </select>
          </div>
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
              <th className="px-3 py-3 text-left">Phone</th>
              <th className="px-3 py-3 text-center">Role</th>
              <th className="px-3 py-3 text-center hidden md:table-cell">PIN Set</th>
              <th className="px-3 py-3 text-center">Status</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {employees.map(emp => (
              <tr key={emp.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-600">
                      {emp.name[0]}
                    </div>
                    <span className="font-semibold text-gray-900">{emp.name}</span>
                  </div>
                </td>
                <td className="px-3 py-3 font-mono text-gray-600 text-xs">{emp.phone}</td>
                <td className="px-3 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${roleColor(emp.role)}`}>{emp.role}</span>
                </td>
                <td className="px-3 py-3 text-center hidden md:table-cell">
                  {emp.pinSet
                    ? <span className="text-green-600 font-semibold">✓ Set</span>
                    : <span className="text-amber-500 font-semibold">⚠ Not set</span>
                  }
                </td>
                <td className="px-3 py-3 text-center">
                  <StatusChip status={emp.active ? 'ok' : 'offline'} size="sm" label={emp.active ? 'Active' : 'Inactive'} />
                </td>
                <td className="px-3 py-3 text-center">
                  <button onClick={() => toggleActive(emp)} className={`text-xs font-semibold hover:underline ${emp.active ? 'text-red-600' : 'text-green-600'}`}>
                    {emp.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
