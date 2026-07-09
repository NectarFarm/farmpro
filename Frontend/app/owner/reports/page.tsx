'use client';
import React, { useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';

type Scope = 'range' | 'lifecycle';
interface Report { id: string; icon: string; title: string; desc: string; cat: 'finance' | 'ops' | 'health' | 'performance'; scope: Scope; }

const REPORTS: Report[] = [
  // Date-filtered transaction logs + period financials.
  { id: 'baseline', icon: '📈', title: 'Period Financial Summary', desc: 'Revenue − expenses for the chosen dates — the headline P&L for funders.', cat: 'finance', scope: 'range' },
  { id: 'sales', icon: '🛒', title: 'Sales & Receivables', desc: 'Every sale in the period: product, qty, price, buyer.', cat: 'finance', scope: 'range' },
  { id: 'production', icon: '📊', title: 'Production Summary', desc: 'Eggs, meat, fish, crop collected per day.', cat: 'ops', scope: 'range' },
  { id: 'mortality', icon: '📉', title: 'Mortality Report', desc: 'Deaths and recorded causes, by date.', cat: 'health', scope: 'range' },
  { id: 'vax', icon: '💉', title: 'Vaccination & Treatment Log', desc: 'Treatments applied — food-safety / withdrawal audit.', cat: 'health', scope: 'range' },
  { id: 'feed_var', icon: '📦', title: 'Feed Consumption', desc: 'Feed drawn down per batch over the period.', cat: 'ops', scope: 'range' },
  { id: 'labor', icon: '👥', title: 'Labour & Task Cost', desc: 'Logged worker hours and their cost.', cat: 'ops', scope: 'range' },
  // Full-lifecycle batch economics (all-time; not date-filtered).
  { id: 'pl', icon: '💰', title: 'Profit & Loss by Batch', desc: 'Feed, health, labour, salaries, overhead vs revenue — with a bottom-line total.', cat: 'finance', scope: 'lifecycle' },
  { id: 'batch_card', icon: '🐔', title: 'Batch Performance Card', desc: 'FCR, mortality, survived/sold/on-farm, cost & margin per batch.', cat: 'performance', scope: 'lifecycle' },
  { id: 'fcr', icon: '🌾', title: 'FCR & Efficiency', desc: 'Feed conversion per batch, species-aware (per dozen / per kg).', cat: 'performance', scope: 'lifecycle' },
];

const CAT_ACCENT: Record<Report['cat'], string> = {
  finance: 'border-l-emerald-500', ops: 'border-l-sky-500', health: 'border-l-rose-500', performance: 'border-l-violet-500',
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function ReportsPage() {
  const { t } = useTranslation();
  const [generated, setGenerated] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [dateFrom, setDateFrom] = useState(iso(new Date(Date.now() - 90 * 86400000)));
  const [dateTo, setDateTo] = useState(iso(new Date()));
  const [linkEmail, setLinkEmail] = useState('');
  const [linkDays, setLinkDays] = useState(7);
  const [link, setLink] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateLink = async () => {
    setLinkBusy(true); setLink(''); setErr('');
    try {
      const res = await fetch('/api/auditor-link', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: linkEmail, days: linkDays }),
      });
      if (!res.ok) throw new Error(res.status === 403 ? 'Owner only' : 'Failed to generate link');
      setLink((await res.json()).url);
    } catch (e) { setErr((e as Error).message); } finally { setLinkBusy(false); }
  };

  const runExport = async (id: string, fmt: 'PDF' | 'Excel' | 'CSV') => {
    setErr(''); setBusy(`${id}:${fmt}`);
    try {
      const res = await fetch(`/api/reports/${id}?from=${dateFrom}&to=${dateTo}`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status === 401 ? t('errorUnauthorized') : res.status === 403 ? t('notPermittedForRole') : t('reportFailed', { status: String(res.status) }));
      const data = await res.json();
      // Translate server-side report column headers for exported PDF/CSV/Excel
      const colMap: Record<string, string> = {
        'Date': 'date', 'Batch': 'batch', 'Type': 'type', 'Qty': 'qty',
        'Product': 'product', 'Unit Price': 'unitPrice', 'Total': 'total',
        'Buyer': 'buyer', 'Deaths': 'deaths', 'Cause': 'cause', 'Lot': 'lot',
        'Hours': 'hours', 'Rate': 'rate', 'Cost': 'cost', 'Feed kg': 'feedKg',
        'Line': 'line', 'Amount': 'amount', 'Info': 'details',
        'Feed': 'feedConsumed', 'Health': 'health', 'Labour': 'labour',
        'Salaries': 'salaries', 'Overhead': 'overhead', 'Acquisition': 'acquisition',
        'Total Cost': 'totalCost', 'Revenue': 'revenue', 'Gross Margin': 'grossMargin',
        'Species': 'species',        'FCR': 'fcr', 'FCR basis': 'fcrBasis',
        'Mortality': 'mortalityRate', 'Feed Cost (KSh)': 'feedConsumed',
        'Stage': 'stage', 'Survived': 'survivors', 'Sold': 'sold',
        'On farm': 'onFarmNow', 'Cost/Unit': 'costPerUnit', 'Margin': 'margin',
      };
      data.columns = data.columns.map((c: string) => (t as (k: string) => string)(colMap[c] ?? c));
      const { exportReport } = await import('@/lib/export');
      await exportReport(data, fmt);
      setGenerated(id); setTimeout(() => setGenerated(null), 2500);
    } catch (e) {
      setErr((e as Error).message ?? t('exportFailed'));
    } finally { setBusy(null); }
  };

  const Card = ({ r }: { r: Report }) => (
    <div className={`bg-white border border-gray-200 border-l-4 ${CAT_ACCENT[r.cat]} rounded-xl p-4 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none">{r.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-gray-900">{r.title}</h3>
            <span className="text-[10px] uppercase tracking-wide font-bold text-gray-400">{r.cat}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{r.desc}</p>
        </div>
      </div>
      {generated === r.id && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 text-green-700 text-xs font-semibold">✓ Generated — downloading…</div>
      )}
      <div className="flex gap-2">
        {(['PDF', 'Excel', 'CSV'] as const).map(fmt => (
          <button key={fmt} disabled={busy !== null} onClick={() => runExport(r.id, fmt)}
            className="flex-1 py-2 bg-gray-50 hover:bg-green-50 hover:text-green-700 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 disabled:opacity-40 transition-colors">
            {busy === `${r.id}:${fmt}` ? '…' : (fmt === 'PDF' ? '📄' : fmt === 'Excel' ? '📊' : '📋')} {fmt}
          </button>
        ))}
      </div>
    </div>
  );

  const rangeReports = REPORTS.filter(r => r.scope === 'range');
  const lifecycleReports = REPORTS.filter(r => r.scope === 'lifecycle');

  return (
    <div className="p-6 flex flex-col gap-7 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">📈 {t('reports')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('reports')}</p>
      </div>

      {err && <p className="text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm font-semibold">{err}</p>}

      {/* ── Section 1: date-filtered ───────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-bold text-gray-800">Activity & period financials</h2>
            <p className="text-xs text-gray-400">Filtered to the date range below.</p>
          </div>
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
            <span className="text-gray-400 text-sm">→</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {rangeReports.map(r => <Card key={r.id} r={r} />)}
        </div>
      </section>

      {/* ── Section 2: lifecycle ───────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-bold text-gray-800">Batch economics <span className="text-xs font-semibold text-gray-400">· full lifecycle</span></h2>
          <p className="text-xs text-gray-400">Each batch&apos;s all-time numbers — not affected by the date range. Matches the figures on the batch page.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {lifecycleReports.map(r => <Card key={r.id} r={r} />)}
        </div>
      </section>

      {/* ── Auditor / investor links ───────────────────────────────── */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
        <h2 className="font-bold text-blue-800 mb-1">🔒 Investor / Auditor read-only links</h2>
        <p className="text-blue-600 text-sm mb-3">Generate an expiring, read-only link so an investor or auditor can review without an account.</p>
        <div className="flex gap-3 flex-wrap">
          <input value={linkEmail} onChange={e => setLinkEmail(e.target.value)} placeholder="Auditor email (optional)" className="flex-1 min-w-[180px] border border-blue-300 rounded-xl px-4 py-2 text-sm" />
          <select value={linkDays} onChange={e => setLinkDays(Number(e.target.value))} className="border border-blue-300 rounded-xl px-3 py-2 text-sm bg-white">
            <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
          </select>
          <button onClick={generateLink} disabled={linkBusy} className="px-4 py-2 bg-blue-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50">{linkBusy ? 'Generating…' : 'Generate link'}</button>
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
