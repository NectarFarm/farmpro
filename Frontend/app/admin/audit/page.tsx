'use client';
import React, { useEffect, useState } from 'react';
import { ScrollText, RefreshCw, Filter } from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/lib/i18n/useTranslation';

interface Entry {
  id: string; tenantId: string; farm: string; actor: string; action: string;
  entity: string | null; meta: unknown; at: string;
}

const ACTION_TINT: Record<string, string> = {
  'tenant.create': 'text-green-700 bg-green-50',
  'tenant.delete': 'text-red-700 bg-red-50',
  'tenant.suspend': 'text-amber-700 bg-amber-50',
  'tenant.reactivate': 'text-green-700 bg-green-50',
  'branding.update': 'text-indigo-700 bg-indigo-50',
  'packages.update': 'text-purple-700 bg-purple-50',
};

const actionLabel = (action: string, t: (k: TranslationKey) => string): string => {
  const map: Record<string, string> = {
    'tenant.create': t('farmCreated'),
    'tenant.delete': t('farmDeleted'),
    'tenant.suspend': t('farmSuspended'),
    'tenant.reactivate': t('farmReactivated'),
    'tenant.update': t('farmUpdated'),
    'branding.update': t('brandingChanged'),
    'packages.update': t('packagesChanged'),
  };
  return map[action] ?? action;
};

export default function AdminAuditPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [farms, setFarms] = useState<{ id: string; name: string }[]>([]);
  const [farm, setFarm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const load = (tenantId: string) => {
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    // Load enough entries to paginate through — 500 max per the API cap
    params.set('limit', '500');
    fetch(`/api/admin/audit?${params.toString()}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('request failed')))
      .then(d => { setEntries(d.entries ?? []); if (d.farms) setFarms(d.farms); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(farm); setPage(1); }, [farm]);

  const detail = (e: Entry) => {
    const m = e.meta as Record<string, unknown> | null;
    if (!m) return e.entity ?? '';
    const parts = Object.entries(m).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
    return [e.entity, ...parts].filter(Boolean).join(' · ');
  };

  const metaJson = (e: Entry) => {
    const m = e.meta as Record<string, unknown> | null;
    if (!m || Object.keys(m).length === 0) return null;
    return JSON.stringify(m, null, 2);
  };


  // Audit table with client-side pagination
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedEntries = entries.slice((safePage - 1) * pageSize, safePage * pageSize);

  const Pagination = () => totalPages > 1 ? (
    <div className="flex items-center justify-center gap-2">
      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
        className="px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition-colors">
        ← {t('prev')}
      </button>
      {(() => {
        const total = totalPages;
        const cur = safePage;
        let pages: number[];
        if (total <= 7) {
          pages = Array.from({ length: total }, (_, j) => j + 1);
        } else if (cur <= 4) {
          pages = [1, 2, 3, 4, 5, -1, total];
        } else if (cur >= total - 3) {
          pages = [1, -1, total - 4, total - 3, total - 2, total - 1, total];
        } else {
          pages = [1, -1, cur - 1, cur, cur + 1, -1, total];
        }
        return pages.map((p, idx) =>
          p === -1
            ? <span key={`ellipsis-${idx}`} className="px-1 text-gray-300 text-xs">⋯</span>
            : (
              <button key={p} onClick={() => setPage(p)}
                className={`min-w-[32px] h-[32px] text-xs font-semibold rounded-lg transition-colors ${p === cur ? 'bg-green-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 border border-gray-200'}`}>
                {p}
              </button>
            )
        );
      })()}
      <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
        className="px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition-colors">
        {t('next')} →
      </button>
    </div>
  ) : null;

  const entriesTable = (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">{t('date')}</th>
              <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">{t('farm')}</th>
              <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">{t('action')}</th>
              <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">{t('by')}</th>
              <th className="text-left py-3 px-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">{t('details')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paginatedEntries.map(e => (
                  <React.Fragment key={e.id}>
                    <tr
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                    >
                      <td className="py-3 px-4 text-gray-400 whitespace-nowrap text-xs">
                        <span title={new Date(e.at).toLocaleString('en-KE')}>
                          {new Date(e.at).toLocaleDateString('en-KE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-medium text-gray-700">{e.farm}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold ${ACTION_TINT[e.action] ?? 'text-gray-600 bg-gray-100'}`}>
                          {actionLabel(e.action, t)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-600">{e.actor}</td>
                      <td className="py-3 px-4 text-gray-500 text-xs max-w-xs truncate">{detail(e)}</td>
                    </tr>
                    {expanded === e.id && (
                      <tr className="bg-gray-50">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="text-xs font-mono text-gray-600 whitespace-pre-wrap bg-white border border-gray-200 rounded-lg p-3">
                            <p className="text-gray-400 mb-1">Action: <span className="text-gray-700">{e.action}</span></p>
                            <p className="text-gray-400 mb-1">Entity: <span className="text-gray-700">{e.entity ?? '—'}</span></p>
                            <p className="text-gray-400 mb-1">Farm ID: <span className="text-gray-700">{e.tenantId}</span></p>
                            <p className="text-gray-400 mb-1">Timestamp: <span className="text-gray-700">{new Date(e.at).toISOString()}</span></p>
                            {metaJson(e) && (
                              <>
                                <p className="text-gray-400 mb-1 mt-2">Metadata:</p>
                                <pre className="text-gray-700 bg-gray-100 rounded p-2 overflow-x-auto">{metaJson(e)}</pre>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );

  return (
    <div className="p-6 flex flex-col gap-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ScrollText className="w-6 h-6" /> {t('auditLog')}
          </h1>
          <p className="text-gray-500 text-sm mt-1">{t('auditDesc')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-gray-400">{entries.length} {t('entries')}</div>
          <button onClick={() => load(farm)} disabled={loading}
            className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50 flex items-center gap-1">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> {t('refresh')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap bg-white border border-gray-200 rounded-xl p-4">
        <Filter className="w-4 h-4 text-gray-400" />
        <label className="text-sm text-gray-600 font-medium">{t('farm')}</label>
        <select value={farm} onChange={e => setFarm(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-[180px] max-w-xs">
          <option value="">{t('allFarms')}</option>
          {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <div className="h-6 w-px bg-gray-200" />
        <label className="text-sm text-gray-600 font-medium">{t('pageSize')}</label>
        <select value={pageSize} onChange={e => { setPage(1); setPageSize(Number(e.target.value)); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-24">
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 text-gray-300 animate-spin" />
        </div>
      )}

      {/* Audit table */}
      {!loading && error ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-3">
          <ScrollText className="w-12 h-12 opacity-30" />
          <p className="text-red-600 text-sm font-semibold">{t('errorLoadFailed')}</p>
          <button onClick={() => load(farm)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition-colors">
            {t('retry')}
          </button>
        </div>
      ) : !loading && entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <ScrollText className="w-12 h-12 mb-3 opacity-30" />
          <p>{t('noAuditEntries')}</p>
        </div>
      ) : !loading && (
        <>
          <Pagination />
          {entriesTable}
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{t('page')} {safePage} {t('of').toLowerCase()} {totalPages}</span>
            <span>{paginatedEntries.length} {t('of').toLowerCase()} {entries.length} {t('entries')}{farm ? ` ${t('for').toLowerCase()} ${t('farm').toLowerCase()}` : ''}.</span>
            <span>{t('auditDesc')}</span>
          </div>
        </>
      )}
    </div>
  );
}
