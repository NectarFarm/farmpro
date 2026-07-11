'use client';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuthStore } from '@/lib/stores/auth';
import { useSyncStore } from '@/lib/stores/sync';
import { useWorkerProfileStore } from '@/lib/stores/workerProfile';
import { api } from '@/lib/api';
import { getPendingCount } from '@/lib/offline/db';
import type { Task } from '@/lib/types';
import { Wifi, WifiOff, Loader2, Check, Globe, Sun } from 'lucide-react';

export default function WorkerProfilePage() {
  const { t } = useTranslation();
  const { user, logout } = useAuthStore();
  const { isOnline, pendingCount, status } = useSyncStore();
  const { lang, setLang, highContrast, toggleHighContrast, profile } = useWorkerProfileStore();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dbPending, setDbPending] = useState(0);

  useEffect(() => {
    if (!user) { router.replace('/worker/login'); return; }
    api.getTasks(user.id).then(t => setTasks(t.filter(t => t.status === 'DONE')));
    getPendingCount().then(setDbPending).catch(() => {});
  }, [user, router]);

  const handleLogout = () => { logout(); router.replace('/worker/login'); };

  return (
    <div className="p-4 flex flex-col gap-5">
      {/* User card */}
      <div className="bg-green-700 text-white rounded-2xl px-5 py-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-green-500 flex items-center justify-center text-2xl font-bold">
            {user?.name?.[0] ?? 'W'}
          </div>
          <div>
            <p className="text-xl font-bold">{user?.name}</p>
            <p className="text-green-200 text-sm">{user?.phone} · {user?.role}</p>
            {profile && <p className="text-green-300 text-xs mt-0.5">Profile: {profile.name}</p>}
          </div>
        </div>
      </div>

      {/* Sync status */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="font-bold text-gray-800 mb-3">{t('syncStatus')}</h2>
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-600">{t('connectionStatus')}</span>
          <span className={`inline-flex items-center gap-1 font-bold ${isOnline ? 'text-green-600' : 'text-gray-500'}`}>
            {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />} {isOnline ? t('online') : t('offline')}
          </span>
        </div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-600">{t('pendingRecords')}</span>
          <span className="font-bold text-amber-600">{dbPending || pendingCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-600">{t('status')}</span>
          <span className="inline-flex items-center gap-1 font-semibold text-gray-700">
            {status === 'syncing' ? <Loader2 className="w-4 h-4 animate-spin" /> : status === 'offline' ? <WifiOff className="w-4 h-4" /> : <Check className="w-4 h-4 text-green-600" />}
            {status === 'syncing' ? `${t('syncingStatus')}…` : status === 'offline' ? t('offline') : t('idle')}
          </span>
        </div>
      </div>

      {/* Completed today */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="font-bold text-gray-800 mb-3">{t('completedTasks')}</h2>
        {tasks.length === 0
          ? <p className="text-gray-400 text-sm">{t('noCompletedToday')}</p>
          : tasks.map(t => (
            <div key={t.id} className="flex items-center gap-2 py-1 border-b last:border-0">
              <Check className="w-4 h-4 text-green-500 shrink-0" />
              <span className="text-sm text-gray-700">{t.title}</span>
            </div>
          ))
        }
      </div>

      {/* Settings */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-4">
        <h2 className="font-bold text-gray-800">{t('settings')}</h2>

        {/* Language toggle — NFR-L-2, offline capable */}
        <div className="flex items-center justify-between min-h-[48px]">
          <div>
          <p className="font-semibold text-gray-700 flex items-center gap-1.5"><Globe className="w-4 h-4 text-gray-500" /> {t('language')}</p>
          <p className="text-xs text-gray-400">{t('offlineMode')}</p>
          </div>
          <button onClick={() => setLang(lang === 'en' ? 'sw' : 'en')}
            className="px-4 py-2 bg-green-100 text-green-800 rounded-xl font-bold border border-green-300 min-h-[48px]">
            {lang === 'en' ? '🇬🇧 English' : '🇰🇪 Kiswahili'}
          </button>
        </div>

        {/* High contrast / sunlight mode — DS-1, A11Y-1 */}
        <div className="flex items-center justify-between min-h-[48px]">
          <div>
          <p className="font-semibold text-gray-700 flex items-center gap-1.5"><Sun className="w-4 h-4 text-amber-500" /> {t('sunlightMode')}</p>
          <p className="text-xs text-gray-400">{t('highContrast')}</p>
          </div>
          <button onClick={toggleHighContrast}
            className={`px-4 py-2 rounded-xl font-bold border min-h-[48px] ${highContrast ? 'bg-yellow-400 border-yellow-600 text-black' : 'bg-gray-100 text-gray-600 border-gray-300'}`}>
            {highContrast ? t('on') : t('off')}
          </button>
        </div>
      </div>

      {/* Logout */}
      <button onClick={handleLogout}
        className="w-full min-h-[56px] bg-gray-200 text-gray-800 rounded-xl text-lg font-bold border border-gray-300 active:bg-gray-300">
        {t('logout')}
      </button>
    </div>
  );
}
