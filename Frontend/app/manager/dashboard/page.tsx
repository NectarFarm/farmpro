'use client';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { api, getDashboardKPIs } from '@/lib/api';
import type { Task, Alert } from '@/lib/types';
import { StatusChip } from '@/components/worker/StatusChip';
import Link from 'next/link';

export default function ManagerDashboardPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [kpis, setKpis] = useState({
    activeBatches: 0, totalBirds: 0, mortalityPct: 0, avgFCR: 0,
    grossMargin: 0, pendingAlerts: 0, taskCompletionPct: 0, revenueThisMonth: 0,
  });
  const [workers, setWorkers] = useState<{ id: string; name: string }[]>([]);
  const [showTask, setShowTask] = useState(false);
  const [saving, setSaving] = useState(false);
  const [taskErr, setTaskErr] = useState('');
  const [tf, setTf] = useState({ title: '', type: 'custom', assignedTo: '', dueAt: '' });

  const loadTasks = async () => {
    try {
      const r = await fetch('/api/data/tasks', { credentials: 'include' });
      if (r.ok) { setTasks(await r.json()); return; }
    } catch { /* fall through */ }
    if (user) setTasks(await api.getTasks(user.id));
  };

  useEffect(() => {
    if (!user) { router.replace('/owner/login'); return; }
    loadTasks();
    api.getAlerts().then(setAlerts);
    getDashboardKPIs().then(setKpis);
    fetch('/api/workers', { credentials: 'include' }).then(r => r.ok ? r.json() : []).then(setWorkers).catch(() => {});
  }, [user, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const createTask = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setTaskErr('');
    try {
      const due = tf.dueAt || new Date().toISOString();
      const res = await fetch('/api/data/tasks', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...tf, dueAt: due, scheduledFor: due }),
      });
      if (!res.ok) throw new Error(res.status === 403 ? 'Not permitted' : res.status === 400 ? 'Title and worker required' : `Failed (${res.status})`);
      setTf({ title: '', type: 'custom', assignedTo: '', dueAt: '' }); setShowTask(false); await loadTasks();
    } catch (e) { setTaskErr((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <div className="p-6 flex flex-col gap-6 max-w-5xl">
      <div className="bg-blue-700 text-white rounded-2xl px-6 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Operations Dashboard</h1>
          <p className="text-blue-200 text-sm">Manager view — financial data hidden (FR-M19-2)</p>
        </div>
        <span className="bg-blue-600 px-3 py-1 rounded-full text-sm font-semibold">Manager</span>
      </div>

      {/* KPIs — no financials */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label:'Active Batches', value: kpis.activeBatches, icon:'🐄' },
          { label:'Total Animals', value: kpis.totalBirds, icon:'📊' },
          { label:'Mortality %', value: `${kpis.mortalityPct}%`, icon:'📉', bad: kpis.mortalityPct > 5 },
          { label:'Task Completion', value: `${kpis.taskCompletionPct}%`, icon:'✅' },
        ].map(k => (
          <div key={k.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <span className="text-xl">{k.icon}</span>
            <p className="text-xs text-gray-500 mt-1">{k.label}</p>
            <p className={`text-2xl font-bold ${(k as {bad?: boolean}).bad ? 'text-red-600' : 'text-gray-900'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <p className="text-amber-800 text-sm font-semibold">💰 Financial data is not visible to managers.</p>
        <p className="text-amber-700 text-xs">Cost, margin, and revenue fields are stripped server-side per your worker profile configuration.</p>
      </div>

      {/* Task management */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-800">Tasks</h2>
          <button onClick={() => setShowTask(v => !v)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold">Assign Task</button>
        </div>
        {showTask && (
          <form onSubmit={createTask} className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-3 flex flex-col gap-2">
            {taskErr && <p className="text-red-600 text-xs font-semibold">{taskErr}</p>}
            <input placeholder="Task title" required value={tf.title} onChange={e => setTf({ ...tf, title: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <select required value={tf.assignedTo} onChange={e => setTf({ ...tf, assignedTo: e.target.value })} className="border rounded-lg px-3 py-2 text-sm">
                <option value="">Assign to…</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <select value={tf.type} onChange={e => setTf({ ...tf, type: e.target.value })} className="border rounded-lg px-3 py-2 text-sm">
                {['morning_round', 'vaccination', 'stock_count', 'feeding', 'sampling', 'custom'].map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
            </div>
            <input type="date" value={tf.dueAt} onChange={e => setTf({ ...tf, dueAt: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50">{saving ? 'Assigning…' : 'Assign'}</button>
              <button type="button" onClick={() => setShowTask(false)} className="px-4 py-2 bg-gray-200 rounded-lg text-xs font-semibold">Cancel</button>
            </div>
          </form>
        )}
        {tasks.length === 0
          ? <p className="text-gray-400 text-sm">No tasks assigned to you.</p>
          : tasks.map(t => (
            <div key={t.id} className={`flex items-center gap-3 py-2 border-b last:border-0 ${t.overdue ? 'text-red-600' : ''}`}>
              <StatusChip status={t.overdue ? 'critical' : t.status === 'DONE' ? 'ok' : 'info'} size="sm" label={t.status} />
              <span className="font-medium text-sm flex-1">{t.title}</span>
              <span className="text-xs text-gray-400">{new Date(t.dueAt).toLocaleTimeString('en-KE', { hour:'2-digit', minute:'2-digit' })}</span>
            </div>
          ))
        }
      </div>

      {/* Alerts */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-bold text-gray-800 mb-3">Alerts</h2>
        {alerts.filter(a => !a.acknowledged).map(a => (
          <div key={a.id} className={`rounded-xl px-4 py-2 mb-2 flex gap-3 ${a.severity === 'critical' ? 'bg-red-50' : 'bg-amber-50'}`}>
            <StatusChip status={a.severity === 'critical' ? 'critical' : 'warning'} size="sm" />
            <p className="text-sm font-medium">{a.title}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { href:'/owner/farm', icon:'🐄', label:'Farm & Batches' },
          { href:'/owner/inventory', icon:'📦', label:'Inventory' },
          { href:'/owner/reports', icon:'📈', label:'Reports' },
        ].map(item => (
          <Link key={item.href} href={item.href}
            className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3 hover:shadow-sm">
            <span className="text-2xl">{item.icon}</span>
            <span className="font-semibold text-gray-800 text-sm">{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
