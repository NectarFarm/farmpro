'use client';
import React, { useState } from 'react';

const REPORTS = [
  { id:'pl', icon:'💰', title:'Profit & Loss', desc:'By species, batch, and unit', tags:['finance'], available:true },
  { id:'production', icon:'📊', title:'Production Summary', desc:'Eggs, meat, fish, crop yield', tags:['ops'], available:true },
  { id:'fcr', icon:'🌾', title:'FCR & ADG Analysis', desc:'Feed efficiency and growth rates', tags:['ops','performance'], available:true },
  { id:'mortality', icon:'📉', title:'Mortality Report', desc:'Day-of-cycle curve, causes', tags:['ops','health'], available:true },
  { id:'feed_var', icon:'📦', title:'Inventory & Feed Variance', desc:'Consumption vs. counted closing stock', tags:['ops'], available:true },
  { id:'sales', icon:'🛒', title:'Sales & Receivables', desc:'Revenue, credit balances, withdrawal log', tags:['finance'], available:true },
  { id:'vax', icon:'💉', title:'Vaccination & Withdrawal Log', desc:'Treatment compliance, food-safety audit', tags:['health','compliance'], available:true },
  { id:'labor', icon:'👥', title:'Labor & Task Completion', desc:'Worker tasks, completion rates', tags:['ops'], available:true },
  { id:'baseline', icon:'📈', title:'Baseline vs Period Impact', desc:'Month-1 baseline vs current — for funding', tags:['finance','investor'], available:true },
  { id:'batch_card', icon:'🐄', title:'Batch Performance Card', desc:'Per-batch FCR, mortality, P&L close-out', tags:['performance'], available:true },
];

export default function ReportsPage() {
  const [filter, setFilter] = useState<'all'|'finance'|'ops'|'health'|'performance'>('all');
  const [generated, setGenerated] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [dateFrom, setDateFrom] = useState('2026-01-01');
  const [dateTo, setDateTo] = useState('2026-06-30');
  const [linkEmail, setLinkEmail] = useState('');
  const [linkDays, setLinkDays] = useState(7);
  const [link, setLink] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateLink = async () => {
    setLinkBusy(true); setLink('');
    try {
      const res = await fetch('/api/auditor-link', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: linkEmail, days: linkDays }),
      });
      if (!res.ok) throw new Error(res.status === 403 ? 'Owner only' : 'Failed to generate link');
      const data = await res.json();
      setLink(data.url);
    } catch (e) { setErr((e as Error).message); } finally { setLinkBusy(false); }
  };

  const filtered = REPORTS.filter(r => filter === 'all' || r.tags.includes(filter));

  const runExport = async (id: string, fmt: 'PDF' | 'Excel' | 'CSV') => {
    setErr(''); setBusy(`${id}:${fmt}`);
    try {
      const res = await fetch(`/api/reports/${id}?from=${dateFrom}&to=${dateTo}`, { credentials: 'include' });
      if (!res.ok) {
        throw new Error(res.status === 401 ? 'Please sign in again' : res.status === 403 ? 'Not permitted for your role' : `Report failed (${res.status})`);
      }
      const data = await res.json();
      const { exportReport } = await import('@/lib/export');
      await exportReport(data, fmt);
      setGenerated(id); setTimeout(() => setGenerated(null), 2500);
    } catch (e) {
      setErr((e as Error).message ?? 'Export failed');
    } finally { setBusy(null); }
  };

  return (
    <div className="p-6 flex flex-col gap-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">📈 Reports</h1>
        <p className="text-gray-500 text-sm mt-1">Export PDF, Excel, or CSV — generated live from your data.</p>
      </div>

      {err && <p className="text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm font-semibold">{err}</p>}

      {/* Date range */}
      <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center gap-4 flex-wrap">
        <span className="font-semibold text-gray-700 text-sm">Date range:</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <span className="text-gray-400">→</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <span className="text-xs text-gray-400">All reports filtered to this range</span>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {['all','finance','ops','health','performance'].map(f => (
          <button key={f} onClick={() => setFilter(f as typeof filter)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize ${filter === f ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {f}
          </button>
        ))}
      </div>

      {/* Report cards */}
      <div className="grid md:grid-cols-2 gap-4">
        {filtered.map(r => (
          <div key={r.id} className={`bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3 ${!r.available ? 'opacity-50' : ''}`}>
            <div className="flex items-start gap-3">
              <span className="text-3xl">{r.icon}</span>
              <div className="flex-1">
                <h3 className="font-bold text-gray-900">{r.title}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{r.desc}</p>
                <div className="flex gap-1 mt-1">
                  {r.tags.map(t => <span key={t} className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded text-xs">{t}</span>)}
                </div>
              </div>
            </div>
            {generated === r.id && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-green-700 text-sm font-semibold">
                ✓ Report ready — downloading…
              </div>
            )}
            <div className="flex gap-2">
              {(['PDF','Excel','CSV'] as const).map(fmt => (
                <button key={fmt} disabled={busy !== null} onClick={() => runExport(r.id, fmt)}
                  className="flex-1 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 disabled:opacity-40">
                  {busy === `${r.id}:${fmt}` ? '…' : (fmt === 'PDF' ? '📄' : fmt === 'Excel' ? '📊' : '📋')} {fmt}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Auditor access */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
        <h2 className="font-bold text-blue-800 mb-1">🔒 Investor/Auditor Read-Only Links (FR-M15-6)</h2>
        <p className="text-blue-600 text-sm mb-3">Generate expiring, scoped links for investors or auditors. They see only selected reports in read-only mode.</p>
        <div className="flex gap-3 flex-wrap">
          <input value={linkEmail} onChange={e => setLinkEmail(e.target.value)} placeholder="Auditor email (optional)" className="flex-1 min-w-[180px] border border-blue-300 rounded-xl px-4 py-2 text-sm" />
          <select value={linkDays} onChange={e => setLinkDays(Number(e.target.value))} className="border border-blue-300 rounded-xl px-3 py-2 text-sm bg-white">
            <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
          </select>
          <button onClick={generateLink} disabled={linkBusy} className="px-4 py-2 bg-blue-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50">{linkBusy ? 'Generating…' : 'Generate Link'}</button>
        </div>
        {link && (
          <div className="mt-3 bg-white border border-blue-200 rounded-xl p-3 flex items-center gap-2">
            <input readOnly value={link} className="flex-1 text-xs text-gray-600 bg-transparent outline-none" onFocus={e => e.target.select()} />
            <button onClick={() => navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
              className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold">{copied ? '✓ Copied' : 'Copy'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
