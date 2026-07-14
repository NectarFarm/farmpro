'use client';
import React, { useState, useEffect } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { api } from '@/lib/api';
import type { ProductionUnit } from '@/lib/types';
import {
  LineChart, ShoppingCart, BarChart3, TrendingDown, Syringe, Package, Users,
  Wallet, Bird, Wheat, FileText, FileSpreadsheet, Table, ShieldCheck, Check,
  Copy, Link2, Loader2, type LucideIcon,
} from 'lucide-react';

type Scope = 'range' | 'lifecycle';
type Cat = 'finance' | 'ops' | 'health' | 'performance';
interface Report { id: string; Icon: LucideIcon; title: string; desc: string; cat: Cat; scope: Scope; }

const REPORTS: Report[] = [
  // Date-filtered transaction logs + period financials.
  { id: 'baseline', Icon: LineChart, title: 'Period Financial Summary', desc: 'Revenue − expenses for the chosen dates — the headline P&L for funders.', cat: 'finance', scope: 'range' },
  { id: 'sales', Icon: ShoppingCart, title: 'Sales & Receivables', desc: 'Every sale in the period: product, qty, price, buyer.', cat: 'finance', scope: 'range' },
  { id: 'production', Icon: BarChart3, title: 'Production Summary', desc: 'Eggs, meat, fish, crop collected per day.', cat: 'ops', scope: 'range' },
  { id: 'mortality', Icon: TrendingDown, title: 'Mortality Report', desc: 'Deaths and recorded causes, by date.', cat: 'health', scope: 'range' },
  { id: 'vax', Icon: Syringe, title: 'Vaccination & Treatment Log', desc: 'Treatments applied — food-safety / withdrawal audit.', cat: 'health', scope: 'range' },
  { id: 'feed_var', Icon: Package, title: 'Feed Consumption', desc: 'Feed drawn down per batch over the period.', cat: 'ops', scope: 'range' },
  { id: 'labor', Icon: Users, title: 'Labour & Task Cost', desc: 'Logged worker hours and their cost.', cat: 'ops', scope: 'range' },
  // Full-lifecycle batch economics (all-time; not date-filtered).
  { id: 'pl', Icon: Wallet, title: 'Profit & Loss by Batch', desc: 'Feed, health, labour, salaries, overhead vs revenue — with a bottom-line total.', cat: 'finance', scope: 'lifecycle' },
  { id: 'batch_card', Icon: Bird, title: 'Batch Performance Card', desc: 'FCR, mortality, survived/sold/on-farm, cost & margin per batch.', cat: 'performance', scope: 'lifecycle' },
  { id: 'fcr', Icon: Wheat, title: 'FCR & Efficiency', desc: 'Feed conversion per batch, species-aware (per dozen / per kg).', cat: 'performance', scope: 'lifecycle' },
];

const CAT_STYLE: Record<Cat, { border: string; iconBg: string; iconText: string; badge: string }> = {
  finance:     { border: 'border-l-emerald-500', iconBg: 'bg-emerald-50', iconText: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700' },
  ops:         { border: 'border-l-sky-500',     iconBg: 'bg-sky-50',     iconText: 'text-sky-600',     badge: 'bg-sky-50 text-sky-700' },
  health:      { border: 'border-l-rose-500',    iconBg: 'bg-rose-50',    iconText: 'text-rose-600',    badge: 'bg-rose-50 text-rose-700' },
  performance: { border: 'border-l-violet-500',  iconBg: 'bg-violet-50',  iconText: 'text-violet-600',  badge: 'bg-violet-50 text-violet-700' },
};

const FORMAT_ICON: Record<'PDF' | 'Excel' | 'CSV', LucideIcon> = { PDF: FileText, Excel: FileSpreadsheet, CSV: Table };

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function ReportsPage() {
  const { t } = useTranslation();
  const [generated, setGenerated] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [dateFrom, setDateFrom] = useState(iso(new Date(Date.now() - 90 * 86400000)));
  const [dateTo, setDateTo] = useState(iso(new Date()));
  const [units, setUnits] = useState<ProductionUnit[]>([]);
  const [unitId, setUnitId] = useState('');
  const [linkEmail, setLinkEmail] = useState('');
  const [linkDays, setLinkDays] = useState(7);
  const [link, setLink] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getUnits().then(setUnits).catch(() => setUnits([]));
  }, []);

  const generateLink = async () => {
    setLinkBusy(true); setLink(''); setErr('');
    try {
      const res = await fetch('/api/auditor-link', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        // Omit email entirely when blank rather than sending '' — belt-and-braces
        // alongside the server's own preprocessing of '' to undefined.
        body: JSON.stringify({ ...(linkEmail.trim() ? { email: linkEmail.trim() } : {}), days: linkDays }),
      });
      if (!res.ok) {
        // Surface the server's actual reason (e.g. "Invalid email") instead of a
        // generic string — a validation error was previously indistinguishable
        // from a real failure, which is what made this bug hard to diagnose.
        const body = await res.json().catch(() => ({}));
        throw new Error(res.status === 403 ? 'Owner only' : body.error || 'Failed to generate link');
      }
      setLink((await res.json()).url);
    } catch (e) { setErr((e as Error).message); } finally { setLinkBusy(false); }
  };

  const runExport = async (id: string, fmt: 'PDF' | 'Excel' | 'CSV') => {
    setErr(''); setBusy(`${id}:${fmt}`);
    try {
      const unitParam = unitId ? `&unitId=${encodeURIComponent(unitId)}` : '';
      const res = await fetch(`/api/reports/${id}?from=${dateFrom}&to=${dateTo}${unitParam}`, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status === 401 ? t('errorUnauthorized') : res.status === 403 ? t('notPermittedForRole') : t('reportFailed', { status: String(res.status) }));
      const data = await res.json();
      // Translate server-side report column headers for exported PDF/CSV/Excel
      const colMap: Record<string, string> = {
        'Date': 'date', 'Batch': 'batch', 'Unit': 'unit', 'Type': 'type', 'Qty': 'qty',
        'Product': 'product', 'Unit Price': 'unitPrice', 'Total': 'total',
        'Buyer': 'buyer', 'Deaths': 'deaths', 'Cause': 'cause', 'Lot': 'lot',
        'Hours': 'hours', 'Rate': 'rate', 'Cost': 'cost', 'Feed kg': 'feedKg',
        'Line': 'line', 'Amount': 'amount', 'Info': 'details',
        'Feed': 'feedConsumed', 'Health': 'health', 'Labour': 'labour',
        'Salaries': 'salaries', 'Overhead': 'overhead', 'Acquisition': 'acquisition',
        'Total Cost': 'totalCost', 'Revenue': 'revenue', 'Net Profit': 'grossMargin',
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

  const Card = ({ r }: { r: Report }) => {
    const style = CAT_STYLE[r.cat];
    return (
      <div className={`bg-white border border-gray-200 border-l-4 ${style.border} rounded-2xl p-5 flex flex-col gap-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all`}>
        <div className="flex items-start gap-3">
          <div className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${style.iconBg}`}>
            <r.Icon className={`w-5 h-5 ${style.iconText}`} />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h3 className="font-semibold text-gray-900 leading-snug">{r.title}</h3>
            <span className={`inline-block mt-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${style.badge}`}>{r.cat}</span>
          </div>
        </div>
        <p className="text-sm text-gray-500 leading-relaxed">{r.desc}</p>

        {generated === r.id && (
          <div className="flex items-center gap-1.5 bg-success/10 border border-success/30 rounded-lg px-3 py-1.5 text-success text-xs font-semibold">
            <Check className="w-3.5 h-3.5 shrink-0" /> Generated — downloading…
          </div>
        )}

        <div className="flex gap-2 mt-auto">
          {(['PDF', 'Excel', 'CSV'] as const).map((fmt) => {
            const FmtIcon = FORMAT_ICON[fmt];
            const isBusy = busy === `${r.id}:${fmt}`;
            return (
              <button key={fmt} disabled={busy !== null} onClick={() => runExport(r.id, fmt)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gray-50 hover:bg-primary/10 hover:text-primary border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 disabled:opacity-40 transition-colors">
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FmtIcon className="w-3.5 h-3.5" />}
                {fmt}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const rangeReports = REPORTS.filter(r => r.scope === 'range');
  const lifecycleReports = REPORTS.filter(r => r.scope === 'lifecycle');

  return (
    <div className="p-6 flex flex-col gap-8 max-w-5xl">
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
            <LineChart className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('reports')}</h1>
            <p className="text-gray-500 text-sm">Export activity logs and batch economics for your records, a lender, or an investor.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</span>
          <select value={unitId} onChange={e => setUnitId(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-sm bg-white min-w-[10rem]">
            <option value="">All units</option>
            {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>

      {err && <p className="text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 text-sm font-semibold">{err}</p>}

      {/* ── Section 1: date-filtered ───────────────────────────────── */}
      <section className="flex flex-col gap-4">
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
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-bold text-gray-800">Batch economics <span className="text-xs font-semibold text-gray-400">· full lifecycle</span></h2>
          <p className="text-xs text-gray-400">Each batch&apos;s all-time numbers — not affected by the date range. Matches the figures on the batch page.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {lifecycleReports.map(r => <Card key={r.id} r={r} />)}
        </div>
      </section>

      {/* ── Auditor / investor links ───────────────────────────────── */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-5 h-5 text-blue-700 shrink-0" />
          <h2 className="font-bold text-blue-800">Investor / Auditor read-only links</h2>
        </div>
        <p className="text-blue-600 text-sm mb-3">Generate an expiring, read-only link so an investor or auditor can review without an account.</p>
        <div className="flex gap-3 flex-wrap">
          <input value={linkEmail} onChange={e => setLinkEmail(e.target.value)} placeholder="Auditor email (optional)" className="flex-1 min-w-[180px] border border-blue-300 rounded-xl px-4 py-2 text-sm" />
          <select value={linkDays} onChange={e => setLinkDays(Number(e.target.value))} className="border border-blue-300 rounded-xl px-3 py-2 text-sm bg-white">
            {/* Server caps at MAX_AUDITOR_LINK_DAYS = 14 (lib/server/auditorLinks.ts) —
                these options previously went up to 90, which always failed. */}
            <option value={1}>1 day</option><option value={7}>7 days</option><option value={14}>14 days</option>
          </select>
          <button onClick={generateLink} disabled={linkBusy} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50">
            {linkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            {linkBusy ? 'Generating…' : 'Generate link'}
          </button>
        </div>
        {link && (
          <div className="mt-3 bg-white border border-blue-200 rounded-xl p-3 flex items-center gap-2">
            <input readOnly value={link} className="flex-1 text-xs text-gray-600 bg-transparent outline-none" onFocus={e => e.target.select()} />
            <button onClick={() => navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
