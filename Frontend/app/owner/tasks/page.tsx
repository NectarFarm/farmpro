'use client';
import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { Task, Batch } from '@/lib/types';
import { StatusChip } from '@/components/worker/StatusChip';
import { ClipboardList } from 'lucide-react';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { TableToolbar } from '@/components/TableToolbar';
import { Pager } from '@/components/Pager';
import { useTableFilter } from '@/hooks/useTableFilter';
import { cn } from '@/lib/utils';

const statusOf = (s: string) => (s === 'DONE' ? 'ok' : s === 'OVERDUE' ? 'critical' : 'info') as 'ok' | 'critical' | 'info';

export default function OwnerTasksPage() {
  const { t } = useTranslation();
  const TASK_TYPES = [
    { value: 'custom', label: t('taskCustom') },
    { value: 'morning_round', label: t('taskMorningRound') },
    { value: 'feeding', label: t('taskFeeding') },
    { value: 'vaccination', label: t('taskVaccination') },
    { value: 'weighing', label: t('taskWeightSampling') },
    { value: 'stock_count', label: t('taskStockCount') },
  ];
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

  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'done'>('all');
  const statusFiltered = tasks.filter(t =>
    statusFilter === 'all' ? true : statusFilter === 'done' ? t.status === 'DONE' : t.status !== 'DONE');
  const { search, setSearch, page, setPage, totalPages, paged } = useTableFilter(statusFiltered, {
    searchFields: (t) => `${t.title} ${t.type} ${workerName(t.assignedTo)} ${batchName(t.batchId) ?? ''}`,
    sortFn: (a, b) => b.dueAt.localeCompare(a.dueAt),
  });

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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
            <ClipboardList className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('tasks')}</h1>
            <p className="text-gray-500 text-sm">Assign work to staff and track what&apos;s done, due, or overdue.</p>
          </div>
        </div>
        <button onClick={() => { setErr(''); setShow(s => !s); }} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90">{show ? t('close') : `+ ${t('assignTask')}`}</button>
      </div>

      {err && <p className="text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 text-sm font-semibold">{err}</p>}

      {show && (
        <form onSubmit={createTask} className="bg-white border border-primary/30 rounded-xl p-5 flex flex-col gap-3">
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
          {workers.length === 0 && <p className="text-xs text-warning-foreground">No staff with a login yet — add a worker and set their PIN on the People page first.</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving || !tf.assignedTo} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">{saving ? t('saving') : t('assign')}</button>
            <button type="button" onClick={() => setShow(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">Cancel</button>
          </div>
        </form>
      )}

      <TableToolbar search={search} onSearchChange={setSearch} placeholder="Search tasks, people, batch…">
        {(['all', 'pending', 'done'] as const).map(f => (
          <button key={f} onClick={() => setStatusFilter(f)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold capitalize', statusFilter === f ? 'bg-primary text-primary-foreground' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
            {f}
          </button>
        ))}
      </TableToolbar>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <Table>
          <TableHeader className="bg-gray-50 text-gray-500 text-xs font-semibold">
            <TableRow>
              <TableHead className="px-4 py-3 text-left">{t('tasks')}</TableHead>
              <TableHead className="px-3 py-3 text-left">{t('people')}</TableHead>
              <TableHead className="px-3 py-3 text-left hidden md:table-cell">{t('batch')}</TableHead>
              <TableHead className="px-3 py-3 text-center hidden md:table-cell">{t('due')}</TableHead>
              <TableHead className="px-3 py-3 text-center">{t('status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-gray-100">
            {paged.map(t => (
              <TableRow key={t.id} className="hover:bg-gray-50">
                <TableCell className="px-4 py-3 whitespace-normal"><span className="font-semibold text-gray-900">{t.title}</span><span className="block text-xs text-gray-400 capitalize">{t.type.replace(/_/g, ' ')}</span></TableCell>
                <TableCell className="px-3 py-3 text-gray-700">{workerName(t.assignedTo)}</TableCell>
                <TableCell className="px-3 py-3 text-gray-500 hidden md:table-cell">{batchName(t.batchId) ?? '—'}</TableCell>
                <TableCell className="px-3 py-3 text-center text-gray-500 hidden md:table-cell">{t.dueAt ? new Date(t.dueAt).toLocaleDateString('en-KE') : '—'}</TableCell>
                <TableCell className="px-3 py-3 text-center"><StatusChip status={statusOf(t.status)} size="sm" label={t.status} /></TableCell>
              </TableRow>
            ))}
            {paged.length === 0 && <TableRow><TableCell colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm whitespace-normal">{t('noTasksYet')}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <Pager page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
