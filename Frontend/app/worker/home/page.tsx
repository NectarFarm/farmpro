'use client';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { useSyncStore } from '@/lib/stores/sync';
import { api } from '@/lib/api';
import { cachedApi } from '@/lib/offline/refCache';
import type { Task, Alert } from '@/lib/types';
import { StatusChip } from '@/components/worker/StatusChip';
import { StaleDataNotice } from '@/components/worker/StaleDataNotice';
import { useTodayActivity, timeLabel } from '@/lib/hooks/useTodayActivity';
import Link from 'next/link';
import {
  Egg, Sunrise, Skull, Wheat, Syringe, Scale, ListOrdered, PackageOpen, Plus,
  Package, CheckCircle2, ClipboardList, AlertTriangle, ArrowUp, Check, type LucideIcon,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';

const TASK_ICON: Record<string, LucideIcon> = {
  morning_round: Sunrise, vaccination: Syringe, stock_count: Package,
  feeding: Wheat, sampling: Scale, custom: CheckCircle2,
};
const taskIcon = (type: string): LucideIcon => TASK_ICON[type] ?? ClipboardList;

export default function WorkerHomePage() {
  const { user } = useAuthStore();
  const { pendingCount } = useSyncStore();
  const { doneToday } = useTodayActivity();
  const { t } = useTranslation();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [staleAt, setStaleAt] = useState<string | null>(null);

  useEffect(() => {
    if (!user) { router.replace('/worker/login'); return; }
    let cancelled = false;
    // Load tasks and alerts INDEPENDENTLY — a failure in one must never freeze the
    // whole page (the old Promise.all rejected wholesale and left it on skeletons).
    cachedApi.getTasks(user.id)
      .then(t => { if (!cancelled) { setTasks(t.data); setStaleAt(t.cachedAt); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    api.getAlerts()
      .then(a => { if (!cancelled) setAlerts(a.filter(al => !al.acknowledged)); })
      .catch(() => { if (!cancelled) setAlerts([]); });
    return () => { cancelled = true; };
  }, [user, router]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('goodMorning') : hour < 17 ? t('goodAfternoon') : t('goodEvening');

  const statusOf = (task: Task) => {
    if (task.overdue || task.status === 'MISSED') return 'critical';
    if (task.status === 'DONE') return 'ok';
    if (new Date(task.dueAt) < new Date()) return 'warning';
    return 'info';
  };

  const statusLabel = (task: Task) => {
    if (task.status === 'DONE') return t('done');
    if (task.overdue || task.status === 'MISSED') return t('overdue');
    return t('due');
  };

  const alertStatus = (a: Alert) => a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info';

  const recordLinks = [
    { href:'/worker/record/collect', Icon: Egg, labelKey:'collectProducts', type:'production' },
    { href:'/worker/record/morning-round', Icon: Sunrise, labelKey:'morningRound', type:'morning_round' },
    { href:'/worker/record/mortality', Icon: Skull, labelKey:'recordMortality', type:'mortality' },
    { href:'/worker/record/feeding', Icon: Wheat, labelKey:'feedingLog', type:'feeding' },
    { href:'/worker/record/health', Icon: Syringe, labelKey:'healthVaccination', type:'health' },
    { href:'/worker/record/weight-sampling', Icon: Scale, labelKey:'weightSample', type:'weight_sample' },
    { href:'/worker/record/physical-count', Icon: ListOrdered, labelKey:'physicalCount', type:'physical_count' },
    { href:'/worker/record/closing-stock', Icon: PackageOpen, labelKey:'closingStock', type:'closing_stock' },
  ] as const;

  return (
    <div className="p-4 flex flex-col gap-5">
      {/* Greeting */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{greeting}, {user?.name?.split(' ')[0] ?? 'Worker'}</h1>
          <p className="text-sm text-gray-500">{new Date().toLocaleDateString('en-KE', { weekday:'long', day:'numeric', month:'long' })}</p>
        </div>
        {pendingCount > 0 && (
          <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 border border-amber-300 rounded-full px-3 py-1 text-sm font-bold">
            <ArrowUp className="w-3.5 h-3.5" /> {pendingCount} {t('pending')}
          </span>
        )}
      </div>

      <StaleDataNotice cachedAt={staleAt} />

      {/* Alerts */}
      {alerts.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-amber-600" /> {t('alerts')}</h2>
          <div className="flex flex-col gap-2">
            {alerts.map(a => (
              <div key={a.id} className={`rounded-xl px-4 py-3 border flex items-start gap-3 ${a.severity === 'critical' ? 'bg-red-50 border-red-300' : a.severity === 'warning' ? 'bg-amber-50 border-amber-300' : 'bg-blue-50 border-blue-300'}`}>
                <StatusChip status={alertStatus(a)} size="sm" label={a.severity.toUpperCase()} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{a.title}</p>
                  <p className="text-gray-600 text-xs mt-0.5">{a.message}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Today's Tasks */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><ClipboardList className="w-4 h-4" /> {t('myTasks')}</h2>
        {loading && <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-gray-200 rounded-xl animate-pulse" />)}</div>}
        {!loading && tasks.length === 0 && (
          <div className="text-center py-10 px-4 bg-white rounded-xl border border-dashed border-gray-300">
            <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">{t('noTasksToday')}<br />{t('pullToRefresh')}</p>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {tasks.map(task => {
            const href = task.type === 'morning_round' ? '/worker/record/morning-round'
              : task.type === 'vaccination' ? '/worker/record/health'
              : task.type === 'sampling' ? '/worker/record/weight-sampling'
              : task.type === 'stock_count' ? '/worker/record/physical-count'
              : '/worker/record/feeding';
            const TaskIcon = taskIcon(task.type);
            return (
              <div key={task.id} className={`rounded-xl px-4 py-3 border flex items-center gap-3 ${task.overdue || task.status === 'MISSED' ? 'bg-red-50 border-red-300' : task.status === 'DONE' ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
                <span className="shrink-0 w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center"><TaskIcon className="w-5 h-5 text-gray-600" /></span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">{task.title}</p>
                  <p className="text-xs text-gray-500">{new Date(task.dueAt).toLocaleTimeString('en-KE', { hour:'2-digit', minute:'2-digit' })}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip status={statusOf(task)} size="sm" label={statusLabel(task)} />
                  {task.status !== 'DONE' && (
                    <button
                      onClick={async (e) => {
                        e.preventDefault();
                        try {
                          await fetch(`/api/data/tasks?id=${encodeURIComponent(task.id)}`, {
                            method: 'PATCH',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: 'DONE' }),
                          });
                          // Optimistic update: mark as done in the local state
                          setTasks(prev => prev.map(tk => tk.id === task.id ? { ...tk, status: 'DONE' } : tk));
                        } catch { /* silently fail — the next refresh will correct it */ }
                      }}
                      className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 active:bg-green-800"
                    >
                      {t('done')}
                    </button>
                  )}
                  {task.status !== 'DONE' && (
                    <Link href={href} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200">
                      {t('open')}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Quick Record Links */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><Plus className="w-4 h-4" /> {t('record')}</h2>
        <div className="grid grid-cols-2 gap-2">
          {recordLinks.map(r => {
            const d = doneToday(r.type);
            return (
            <Link key={r.href} href={r.href}>
              <div className={`bg-white border rounded-xl px-4 py-3 flex items-center gap-3 active:bg-gray-50 min-h-[56px] ${d.count > 0 ? 'border-green-300' : 'border-gray-200'}`}>
                <span className="w-9 h-9 rounded-lg bg-green-50 text-green-700 flex items-center justify-center shrink-0"><r.Icon className="w-5 h-5" strokeWidth={2} /></span>
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-gray-700 block">{t(r.labelKey)}</span>
                  {d.count > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] text-green-600 font-semibold"><Check className="w-3 h-3" /> {d.count} {t('today')} · {timeLabel(d.lastAt)}</span>}
                </div>
              </div>
            </Link>
          ); })}
        </div>
      </section>
    </div>
  );
}
