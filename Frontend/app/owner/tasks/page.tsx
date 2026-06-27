'use client';
import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Task, Batch } from '@/lib/types';
import { StatusChip } from '@/components/worker/StatusChip';

const TASK_TYPES = [
  { value: 'custom', label: 'Custom' },
  { value: 'morning_round', label: 'Morning round' },
  { value: 'feeding', label: 'Feeding' },
  { value: 'vaccination', label: 'Vaccination / treatment' },
  { value: 'weighing', label: 'Weight sampling' },
  { value: 'stock_count', label: 'Stock count' },
];
const statusOf = (s: string) => (s === 'DONE' ? 'ok' : s === 'OVERDUE' ? 'critical' : 'info') as 'ok' | 'critical' | 'info';

export default function OwnerTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workers, setWorkers] = useState<{ id: string; name: string }[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [tf, setTf] = useState({ title: '', type: 'custom', assignedTo: '', batchId: '', dueAt: '' });

  const loadTasks = async () => {
    const r = await fetch('/api/data/tasks', { credentials: 'include' });
    if (r.ok) setTasks(await r.json());
  };
  useEffect(() => {
    loadTasks();
    fetch('/api/workers', { credentials: 'include' }).then(r => r.ok ? r.json() : []).then(setWorkers).catch(() => {});
    api.getBatches().then(b => setBatches(b.filter(x => x.status === 'ACTIVE'))).catch(() => {});
  }, []);

  const workerName = (id: string) => workers.find(w => w.id === id)?.name ?? '—';
  const batchName = (id?: string | null) => (id ? batches.find(b => b.id === id)?.name ?? id : null);

  const createTask = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setErr('');
    try {
      const due = tf.dueAt ? new Date(tf.dueAt).toISOString() : new Date().toISOString();
      const res = await fetch('/api/data/tasks', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: tf.title, type: tf.type, assignedTo: tf.assignedTo, batchId: tf.batchId || null, dueAt: due, scheduledFor: due }),
      });
      if (!res.ok) throw new Error(res.status === 400 ? 'A title and an assignee are required.' : res.status === 403 ? 'Owner/manager only.' : `Failed (${res.status})`);
      setTf({ title: '', type: 'custom', assignedTo: '', batchId: '', dueAt: '' }); setShow(false); await loadTasks();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <div className="p-6 flex flex-col gap-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📋 Tasks</h1>
          <p className="text-gray-500 text-sm">Assign work to staff — they see it on their phone when they sign in.</p>
        </div>
        <button onClick={() => { setErr(''); setShow(s => !s); }} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm">{show ? 'Close' : '+ Assign Task'}</button>
      </div>

      {err && <p className="text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm font-semibold">{err}</p>}

      {show && (
        <form onSubmit={createTask} className="bg-white border border-green-300 rounded-xl p-5 flex flex-col gap-3">
          <input required placeholder="Task title (e.g. Vaccinate Batch A)" value={tf.title} onChange={e => setTf({ ...tf, title: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select required value={tf.assignedTo} onChange={e => setTf({ ...tf, assignedTo: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Assign to…</option>
              {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <select value={tf.type} onChange={e => setTf({ ...tf, type: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm">
              {TASK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select value={tf.batchId} onChange={e => setTf({ ...tf, batchId: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Batch (optional)</option>
              {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <input type="date" value={tf.dueAt} onChange={e => setTf({ ...tf, dueAt: e.target.value })} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          {workers.length === 0 && <p className="text-xs text-amber-600">No staff with a login yet — add a worker and set their PIN on the People page first.</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving || !tf.assignedTo} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">{saving ? 'Assigning…' : 'Assign'}</button>
            <button type="button" onClick={() => setShow(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">Cancel</button>
          </div>
        </form>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs font-semibold">
            <tr>
              <th className="px-4 py-3 text-left">Task</th>
              <th className="px-3 py-3 text-left">Assigned to</th>
              <th className="px-3 py-3 text-left hidden md:table-cell">Batch</th>
              <th className="px-3 py-3 text-center hidden md:table-cell">Due</th>
              <th className="px-3 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tasks.map(t => (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="px-4 py-3"><span className="font-semibold text-gray-900">{t.title}</span><span className="block text-xs text-gray-400 capitalize">{t.type.replace(/_/g, ' ')}</span></td>
                <td className="px-3 py-3 text-gray-700">{workerName(t.assignedTo)}</td>
                <td className="px-3 py-3 text-gray-500 hidden md:table-cell">{batchName(t.batchId) ?? '—'}</td>
                <td className="px-3 py-3 text-center text-gray-500 hidden md:table-cell">{t.dueAt ? new Date(t.dueAt).toLocaleDateString('en-KE') : '—'}</td>
                <td className="px-3 py-3 text-center"><StatusChip status={statusOf(t.status)} size="sm" label={t.status} /></td>
              </tr>
            ))}
            {tasks.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">No tasks yet. Click “+ Assign Task”.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
