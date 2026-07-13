'use client';
import React, { useEffect, useState } from 'react';
import {
  Database, HardDrive, Gauge, Shield, Check, X,
  CheckCircle2, XCircle, AlertTriangle, RefreshCw, Server, Terminal,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';

type HealthStatus = 'healthy' | 'degraded' | 'down';

interface SystemStatus {
  healthy: boolean;
  database: { ok: boolean; version: string; error: string | null };
  storage: { configured: boolean; bucket: string };
  environment: {
    nodeVersion: string; runtime: string; nodeEnv: string;
    platform: string; arch: string; uptimeSeconds: number; pid: number;
  };
  rateLimit: { loginMax: number; windowMs: number };
  migrationVersion: string;
  recentActivity: { auditEntries7d: number; errors7d: number };
  ts: string;
}

function statusLevel(s: SystemStatus): HealthStatus {
  if (s.healthy && s.database.ok) return 'healthy';
  if (s.database.ok) return 'degraded';
  return 'down';
}

const STATUS_META: Record<HealthStatus, { label: string; icon: LucideIcon; bg: string; txt: string; pulse: string }> = {
  healthy:   { label: 'All Systems Operational', icon: CheckCircle2,  bg: 'bg-success/10 border-success/30', txt: 'text-success', pulse: 'bg-success' },
  degraded:  { label: 'Degraded',                icon: AlertTriangle, bg: 'bg-warning/15 border-warning/40',  txt: 'text-warning-foreground', pulse: 'bg-warning' },
  down:      { label: 'System Down',             icon: XCircle,       bg: 'bg-destructive/10 border-destructive/30',     txt: 'text-destructive',   pulse: 'bg-destructive' },
};

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-gray-100 last:border-b-0">
      <span className="text-gray-400 font-medium">{label}</span>
      <span className="text-gray-800 font-semibold text-right max-w-[60%] truncate" title={value}>{value}</span>
    </div>
  );
}

export default function AdminStatusPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
    fetch('/api/admin/status', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('request failed')))
      .then(d => { setData(d); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="p-6 flex flex-col gap-6 max-w-5xl mx-auto">
        <div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 h-28 animate-pulse" />)}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 h-64 animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 flex flex-col items-center justify-center py-20 max-w-5xl mx-auto gap-4">
        <Server className="w-16 h-16 text-gray-300" />
        <p className="text-destructive text-sm font-semibold">{t('errorLoadFailed')}</p>
        <button onClick={load} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-semibold hover:bg-gray-800 transition-colors">
          {t('retry')}
        </button>
      </div>
    );
  }

  const level = statusLevel(data);
  const meta = STATUS_META[level];
  const Icon = meta.icon;

  const statusCards = [
    {
      label: 'Database', icon: Database, ok: data.database.ok,
      detail: data.database.ok ? (data.database.version || 'connected') : (data.database.error || 'disconnected'),
      tint: data.database.ok ? 'text-success bg-success/10' : 'text-destructive bg-destructive/10',
    },
    {
      label: 'Storage', icon: HardDrive, ok: data.storage.configured,
      detail: data.storage.configured ? `R2 · ${data.storage.bucket}` : 'Not configured (base64 fallback active)',
      tint: 'text-blue-600 bg-blue-50',
    },
    {
      label: `${t('auditLog')} (7d)`, icon: Shield, ok: data.recentActivity.errors7d === 0,
      detail: `${data.recentActivity.auditEntries7d} entries · ${data.recentActivity.errors7d} errors`,
      tint: data.recentActivity.errors7d === 0 ? 'text-indigo-600 bg-indigo-50' : 'text-warning-foreground bg-warning/15',
    },
  ];

  return (
    <div className="p-6 flex flex-col gap-6 max-w-5xl mx-auto">
      {/* Hero */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center">
            <Gauge className="w-6 h-6 text-blue-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">System Status</h1>
            <p className="text-gray-500 text-sm mt-1">Platform health &mdash; database, storage, environment, and recent activity</p>
          </div>
        </div>
        <button onClick={load} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> {t('refresh')}
        </button>
      </div>

      {/* Overall status banner */}
      <div className={`rounded-xl border p-5 flex items-center gap-4 ${meta.bg}`}>
        <div className="relative">
          <Icon className={`w-10 h-10 ${meta.txt}`} strokeWidth={2} />
          <span className={`absolute -top-0.5 -right-0.5 w-3 h-3 ${meta.pulse} rounded-full animate-ping opacity-75`} />
        </div>
        <div>
          <p className={`text-lg font-bold ${meta.txt}`}>{meta.label}</p>
          <p className="text-sm text-gray-500 mt-0.5">
            Last checked: {new Date(data.ts).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        </div>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {statusCards.map(card => (
          <div key={card.label} className="rounded-xl border border-gray-200/80 bg-white p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${card.tint}`}>
                <card.icon className="w-[18px] h-[18px]" strokeWidth={2} />
              </div>
              {card.ok
                ? <CheckCircle2 className="w-5 h-5 text-success" strokeWidth={2.5} />
                : <XCircle className="w-5 h-5 text-destructive" strokeWidth={2.5} />
              }
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">{card.label}</p>
              <p className="text-xs text-gray-400 mt-0.5 break-all">{card.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Environment */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-5 h-5 text-gray-400" />
            <h2 className="font-bold text-gray-900">Environment</h2>
          </div>
          <div className="space-y-2.5 text-sm">
            <Row label="Node" value={data.environment.nodeVersion} />
            <Row label="Runtime" value={data.environment.runtime} />
            <Row label="Environment" value={data.environment.nodeEnv} />
            <Row label="Platform" value={`${data.environment.platform} (${data.environment.arch})`} />
            <Row label="PID" value={String(data.environment.pid)} />
          </div>
        </div>

        {/* Performance */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Gauge className="w-5 h-5 text-gray-400" />
            <h2 className="font-bold text-gray-900">Performance</h2>
          </div>
          <div className="space-y-2.5 text-sm">
            <Row label="Uptime" value={fmtUptime(data.environment.uptimeSeconds)} />
            <Row label="Migration" value={data.migrationVersion} />
            <Row label="Rate limit (login)" value={`${data.rateLimit.loginMax} req/${data.rateLimit.windowMs / 1000}s`} />
            <Row label="Storage" value={data.storage.configured ? `R2 · ${data.storage.bucket}` : 'base64 (fallback)'} />
          </div>
        </div>
      </div>

      {/* Diagnostics */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Terminal className="w-5 h-5 text-gray-400" />
          <h2 className="font-bold text-gray-900">Diagnostics</h2>
        </div>
        <div className="space-y-2 text-xs font-mono text-gray-600 bg-gray-50 border border-gray-100 rounded-lg p-4">
          <p className="text-gray-400"># System status &mdash; {new Date(data.ts).toISOString()}</p>
          <p className="flex items-center gap-1.5">DB: {data.database.ok ? <Check className="w-3.5 h-3.5 text-success" /> : <X className="w-3.5 h-3.5 text-destructive" />} {data.database.version || data.database.error}</p>
          <p className="flex items-center gap-1.5">Storage: {data.storage.configured ? <><Check className="w-3.5 h-3.5 text-success" /> {data.storage.bucket}</> : <><X className="w-3.5 h-3.5 text-destructive" /> (base64 fallback)</>}</p>
          <p>Migration: v{data.migrationVersion}</p>
          <p>Audit (7d): {data.recentActivity.auditEntries7d} entries, {data.recentActivity.errors7d} failures</p>
          <p>Uptime: {fmtUptime(data.environment.uptimeSeconds)}</p>
          <p>Runtime: {data.environment.runtime} · Node {data.environment.nodeVersion} · {data.environment.platform}/{data.environment.arch}</p>
        </div>
      </div>
    </div>
  );
}
