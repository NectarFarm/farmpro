'use client';
// Platform-wide client error feed — GET /api/admin/errors existed since the
// NFR-remediation pass but had no UI page (a confirmed dead end). Route-only
// data source, so this page is deliberately simple: most-recent-first,
// searchable/paginated, no server-side filters.
import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { TableToolbar } from '@/components/TableToolbar';
import { Pager } from '@/components/Pager';
import { useTableFilter } from '@/hooks/useTableFilter';

interface ErrorLog {
  id: string; tenantId: string | null; userId: string | null; context: string | null;
  severity: string; message: string; digest: string | null; stack: string | null;
  url: string | null; userAgent: string | null; createdAt: string | null;
}

const SEVERITY_TINT: Record<string, string> = {
  error: 'text-destructive bg-destructive/10',
  fatal: 'text-white bg-destructive',
  warning: 'text-warning-foreground bg-warning/15',
  info: 'text-blue-700 bg-blue-50',
};

export default function AdminErrorsPage() {
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = () => {
    setLoading(true); setErr('');
    fetch('/api/admin/errors', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 403 ? 'Admins only.' : 'Failed to load'))))
      .then((d) => setErrors(d.errors ?? []))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const { search, setSearch, page, setPage, totalPages, paged } = useTableFilter(errors, {
    searchFields: (e) => `${e.context ?? ''} ${e.message} ${e.tenantId ?? ''}`,
    sortFn: (a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  });

  return (
    <div className="p-6 flex flex-col gap-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Errors</h1>
            <p className="text-gray-500 text-sm">Crashes reported by any farm&apos;s app, across every tenant — most recent 200.</p>
          </div>
        </div>
        <button onClick={load} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200 flex items-center gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {err && <p className="text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 text-sm font-semibold">{err}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-12"><p className="text-gray-400">Loading…</p></div>
      ) : errors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <AlertTriangle className="w-12 h-12 mb-3 opacity-30" />
          <p>No errors reported.</p>
        </div>
      ) : (
        <>
          <TableToolbar search={search} onSearchChange={setSearch} placeholder="Search context, message, tenant…" />
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="font-semibold text-gray-500 text-xs uppercase tracking-wider">Date</TableHead>
                  <TableHead className="font-semibold text-gray-500 text-xs uppercase tracking-wider">Context</TableHead>
                  <TableHead className="font-semibold text-gray-500 text-xs uppercase tracking-wider">Severity</TableHead>
                  <TableHead className="font-semibold text-gray-500 text-xs uppercase tracking-wider">Message</TableHead>
                  <TableHead className="font-semibold text-gray-500 text-xs uppercase tracking-wider">Tenant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((e) => (
                  <React.Fragment key={e.id}>
                    <TableRow className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpanded((cur) => (cur === e.id ? null : e.id))}>
                      <TableCell className="text-gray-400 text-xs whitespace-nowrap">{e.createdAt ? new Date(e.createdAt).toLocaleString('en-KE') : '—'}</TableCell>
                      <TableCell className="text-gray-700 text-xs font-mono">{e.context ?? '—'}</TableCell>
                      <TableCell><span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${SEVERITY_TINT[e.severity] ?? 'bg-gray-100 text-gray-600'}`}>{e.severity}</span></TableCell>
                      <TableCell className="text-gray-800 text-sm max-w-md truncate">{e.message}</TableCell>
                      <TableCell className="text-gray-400 text-xs font-mono">{e.tenantId ?? '—'}</TableCell>
                    </TableRow>
                    {expanded === e.id && (
                      <TableRow className="bg-gray-50/60 hover:bg-gray-50/60">
                        <TableCell colSpan={5} className="whitespace-normal">
                          <div className="flex flex-col gap-1 text-xs text-gray-600 py-2">
                            {e.url && <p><span className="font-semibold">URL:</span> {e.url}</p>}
                            {e.digest && <p><span className="font-semibold">Digest:</span> {e.digest}</p>}
                            {e.userId && <p><span className="font-semibold">User:</span> {e.userId}</p>}
                            {e.userAgent && <p><span className="font-semibold">User agent:</span> {e.userAgent}</p>}
                            {e.stack && <pre className="bg-white border border-gray-200 rounded-lg p-3 overflow-x-auto text-[11px] whitespace-pre-wrap">{e.stack}</pre>}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
