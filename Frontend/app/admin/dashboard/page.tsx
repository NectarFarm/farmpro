'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  Tractor, ScrollText, Settings, Layers, Bird, Users,
  CheckCircle2, XCircle, ArrowRight, Activity, Shield, BarChart3
} from 'lucide-react';

const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

const QUICK_LINKS = [
  { href: '/admin/farms', icon: Tractor, labelId: 'manageFarms', descId: 'manageFarmsDesc', color: 'bg-gray-900 text-white' },
  { href: '/admin/audit', icon: ScrollText, labelId: 'auditLog', descId: 'auditLogDesc', color: 'bg-indigo-600 text-white' },
  { href: '/admin/settings', icon: Settings, labelId: 'settings', descId: 'settingsDesc', color: 'bg-emerald-600 text-white' },
] as const;

export default function AdminDashboardPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState({
    totalFarms: 0, activeFarms: 0, suspendedFarms: 0,
    totalUsers: 0, totalWorkers: 0, totalBatchesAll: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadStats = () => {
    setLoading(true);
    setError(false);
    fetch('/api/admin/stats', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('request failed')))
      .then(d => {
        if (d && typeof d.totalFarms === 'number') setStats({
          totalFarms: d.totalFarms ?? 0,
          activeFarms: d.activeFarms ?? 0,
          suspendedFarms: d.suspendedFarms ?? 0,
          totalUsers: d.totalUsers ?? 0,
          totalWorkers: d.totalWorkers ?? 0,
          totalBatchesAll: d.totalBatchesAll ?? 0,
        });
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadStats(); }, []);

  const statCards = [
    { label: t('totalFarms'), value: fmt(stats.totalFarms), icon: Tractor, tint: 'text-gray-900 bg-gray-100' },
    { label: t('activeFarms'), value: fmt(stats.activeFarms), icon: CheckCircle2, tint: 'text-green-600 bg-green-50' },
    { label: t('totalUsers'), value: fmt(stats.totalUsers), icon: Users, tint: 'text-blue-600 bg-blue-50' },
    { label: t('totalBatchesAll'), value: fmt(stats.totalBatchesAll), icon: Layers, tint: 'text-amber-600 bg-amber-50' },
    { label: t('totalWorkers'), value: fmt(stats.totalWorkers), icon: Bird, tint: 'text-violet-600 bg-violet-50' },
    { label: t('inactive'), value: fmt(stats.suspendedFarms), icon: XCircle, tint: 'text-red-600 bg-red-50' },
  ];

  return (
    <div className="p-6 flex flex-col gap-8 max-w-5xl mx-auto">
      {/* Hero */}
      <div className="flex items-center gap-3">
        <div className="shrink-0 w-11 h-11 rounded-xl bg-gray-900 flex items-center justify-center">
          <Shield className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('platformConsole')}</h1>
          <p className="text-gray-500 text-sm mt-1">Farms, users, and activity across every tenant on the platform.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-3">
          <p className="text-red-600 text-sm font-semibold">{t('errorLoadFailed')}</p>
          <button onClick={loadStats}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition-colors">
            {t('retry')}
          </button>
        </div>
      ) : (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {statCards.map(card => (
              <div key={card.label} className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm flex flex-col gap-2 hover:shadow-md transition-shadow">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${card.tint}`}>
                  <card.icon className="w-[18px] h-[18px]" strokeWidth={2} />
                </div>
                <p className="text-2xl font-bold tracking-tight text-gray-900">{card.value}</p>
                <p className="text-[11px] text-gray-500 font-medium">{card.label}</p>
              </div>
            ))}
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {QUICK_LINKS.map(link => (
              <Link key={link.href} href={link.href}
                className="group rounded-xl border border-gray-200 bg-white p-5 flex flex-col gap-3 hover:shadow-md transition-all">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${link.color}`}>
                  <link.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-bold text-gray-900 group-hover:text-gray-700 transition-colors flex items-center gap-1">
                    {t(link.labelId)}
                    <ArrowRight className="w-3.5 h-3.5 opacity-0 -ml-1 group-hover:opacity-100 group-hover:ml-0 transition-all" />
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{t(link.descId)}</p>
                </div>
              </Link>
            ))}
          </div>

          {/* Platform summary */}
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-5 h-5 text-gray-400" />
              <h2 className="font-bold text-gray-900">{t('platformSummary')}</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-gray-400">{t('totalFarms')}</p>
                <p className="text-xl font-bold text-gray-900">{stats.totalFarms}</p>
              </div>
              <div>
                <p className="text-gray-400">{t('activeFarms')}</p>
                <p className="text-xl font-bold text-green-700">{stats.activeFarms}</p>
              </div>
              <div>
                <p className="text-gray-400">{t('inactive')}</p>
                <p className="text-xl font-bold text-red-600">{stats.suspendedFarms}</p>
              </div>
              <div>
                <p className="text-gray-400">{t('totalUsers')}</p>
                <p className="text-xl font-bold text-gray-900">{stats.totalUsers}</p>
              </div>
              <div>
                <p className="text-gray-400">{t('totalWorkers')}</p>
                <p className="text-xl font-bold text-gray-900">{stats.totalWorkers}</p>
              </div>
              <div>
                <p className="text-gray-400">{t('totalBatchesAll')}</p>
                <p className="text-xl font-bold text-gray-900">{stats.totalBatchesAll}</p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 shrink-0" /> {stats.activeFarms} {t('active').toLowerCase()}</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 shrink-0" /> {stats.suspendedFarms} {t('inactive').toLowerCase()}</span>
                <span className="flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5 shrink-0" /> {t('averageFCR')} {(stats.totalBatchesAll / Math.max(stats.totalFarms, 1)).toFixed(1)} {t('batches').toLowerCase()}/{t('farm').toLowerCase()}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
