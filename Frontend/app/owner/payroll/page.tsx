'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { currentPeriod, periodLabel } from '@/lib/payslip';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Wallet, Lock, X, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { StatPanel } from '@/components/ui/stat-panel';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';

const fmtKES = (n: number) => `KSh ${n.toLocaleString('en-KE')}`;
type Slip = { gross: number; advances: number; fines: number; bonuses: number; net: number; status: 'pending' | 'paid'; paidAt: string | null } | null;
interface Row {
  id: string; name: string; role: string; salary: number; active: boolean; eligible: boolean; paymentsFrom: string | null;
  payslip: Slip; preview: { gross: number; advances: number; fines: number; bonuses: number; net: number };
  ledger: { id: string; type: string; amount: number; note: string | null; date: string }[];
}
interface Summary { gross: number; net: number; fines: number; paid: number; withSlip: number }

export default function PayrollPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(currentPeriod(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [addFor, setAddFor] = useState<string | null>(null);
  const [entry, setEntry] = useState({ type: 'advance', amount: '', note: '' });
  // Generated once per logical entry attempt (when the add-advance/fine row opens for
  // an employee) and reused across any retry of that SAME attempt — so a manual retry
  // after a lost response can't create a duplicate via a fresh idempotency key. Only
  // regenerated when the form is (re)opened, or cleared after a successful submit.
  const [entryUuid, setEntryUuid] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await fetch(`/api/payroll?period=${period}`, { credentials: 'include' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed to load');
      const d = await r.json(); setRows(d.employees ?? []); setSummary(d.summary ?? null);
    } catch (e) { setErr((e as Error).message); }
  }, [period]);
  useEffect(() => { load(); }, [load]);

  const post = async (body: Record<string, unknown>, key: string) => {
    setBusy(key); setErr('');
    try {
      const r = await fetch('/api/payroll', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Action failed');
      await load(); return true;
    } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(''); }
  };

  const runPayroll = () => post({ action: 'run', period }, 'run');
  const pay = (employeeId: string) => post({ action: 'pay', period, employeeId }, `pay:${employeeId}`);
  const payAll = () => post({ action: 'pay', period }, 'payall');
  const addEntry = async (employeeId: string) => {
    const amount = Number(entry.amount);
    // Every type except 'adjustment' must be strictly positive — the backend
    // (app/api/payroll/route.ts) already enforces this same rule and allows a
    // negative adjustment (e.g. reversing a bonus entered by mistake).
    if (!entry.amount || Number.isNaN(amount) || amount === 0 || (entry.type !== 'adjustment' && amount < 0)) {
      setErr(entry.type === 'adjustment' ? 'Enter a non-zero amount.' : 'Enter an amount greater than 0.');
      return;
    }
    const clientUuid = entryUuid ?? crypto.randomUUID();
    if (await post({ action: 'ledger', employeeId, period, type: entry.type, amount, note: entry.note, clientUuid }, `add:${employeeId}`)) {
      setAddFor(null); setEntry({ type: 'advance', amount: '', note: '' }); setEntryUuid(null);
    }
  };
  const delEntry = (ledgerId: string) => post({ action: 'deleteLedger', ledgerId }, `del:${ledgerId}`);

  const payslipPdf = async (row: Row) => {
    const b = row.payslip ?? row.preview;
    const { exportReport } = await import('@/lib/export');
    await exportReport({
      title: t('payslip'),
      subtitle: row.name,
      columns: [t('line'), `${t('amount')} (KSh)`],
      rows: [
        [t('grossSalary'), b.gross], [t('advances'), -b.advances], [t('fines'), -b.fines], [t('bonuses'), b.bonuses],
        [t('netPay'), b.net],
      ],
      meta: { [t('employee')]: row.name, [t('period')]: periodLabel(period), [t('status')]: row.payslip?.status ?? t('preview'), [t('paid')]: row.payslip?.paidAt ? new Date(row.payslip.paidAt).toLocaleDateString('en-KE') : '—' },
    }, 'PDF');
  };

  const yearPdf = async (row: Row) => {
    setBusy(`year:${row.id}`);
    try {
      const year = period.slice(0, 4);
      const r = await fetch(`/api/payroll/statement?employeeId=${row.id}&year=${year}`, { credentials: 'include' });
      if (!r.ok) throw new Error('Failed');
      const d = await r.json();
      const { exportReport } = await import('@/lib/export');
      await exportReport({
        title: `${year} ${t('payStatement')}`,
        subtitle: row.name,
        columns: [t('month'), t('gross'), t('advances'), t('fines'), t('bonuses'), t('net'), t('status')],
        rows: [
          ...d.payslips.map((p: { period: string; gross: number; advances: number; fines: number; bonuses: number; net: number; status: string }) =>
            [periodLabel(p.period), p.gross, p.advances, p.fines, p.bonuses, p.net, p.status.toUpperCase()]),
          [t('total'), d.totals.gross, d.totals.advances, d.totals.fines, d.totals.bonuses, d.totals.net, `${d.totals.paidMonths} ${t('paid')}`],
        ],
        hasTotalsRow: true,
        meta: { [t('employee')]: row.name, [t('year')]: year, [t('paidMonths')]: d.totals.paidMonths },
      }, 'PDF');
    } catch { setErr(t('couldNotBuildStatement')); } finally { setBusy(''); }
  };

  return (
    <div className="p-6 flex flex-col gap-5 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
            <Wallet className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('payroll')}</h1>
            <p className="text-gray-500 text-sm">Run monthly pay, track advances/fines/bonuses, and generate payslips.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          <button onClick={runPayroll} disabled={busy !== ''} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 disabled:opacity-50">{busy === 'run' ? t('saving') : t('runPayroll')}</button>
        </div>
      </div>

      {err && <p className="text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 text-sm font-semibold">{err}</p>}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            ['gross', t('gross'), summary.gross, Wallet, 'neutral'] as const,
            ['net', t('netProfit'), summary.net, TrendingUp, summary.net >= 0 ? 'good' : 'bad'] as const,
            ['fines', t('fines'), summary.fines, AlertTriangle, summary.fines > 0 ? 'bad' : 'neutral'] as const,
            ['paid', t('paid'), summary.paid, CheckCircle2, 'neutral'] as const,
          ]).map(([id, label, val, Icon, tone]) => (
            <StatPanel key={id} label={label} icon={Icon} tone={tone}
              value={id === 'paid' ? `${val}/${summary.withSlip}` : fmtKES(val)} />
          ))}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
          <span className="font-bold text-gray-800 text-sm">{periodLabel(period)}</span>
          <button onClick={payAll} disabled={busy !== ''} className="text-xs font-semibold text-green-700 hover:underline">{t('markPaid')}</button>
        </div>
        <Table>
          <TableHeader className="text-gray-500 text-xs font-semibold border-b">
            <TableRow><TableHead className="px-3 py-2 text-left">{t('name')}</TableHead><TableHead className="px-2 py-2 text-right">{t('gross')}</TableHead><TableHead className="px-2 py-2 text-right">{t('adv')}</TableHead><TableHead className="px-2 py-2 text-right">{t('fines')}</TableHead><TableHead className="px-2 py-2 text-right">{t('netProfit')}</TableHead><TableHead className="px-2 py-2 text-center">{t('status')}</TableHead><TableHead className="px-2 py-2"></TableHead></TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-gray-100">
            {rows.map(row => {
              const b = row.payslip ?? row.preview;
              const locked = row.payslip?.status === 'paid';
              return (
                <React.Fragment key={row.id}>
                  <TableRow className="hover:bg-gray-50">
                    <TableCell className="px-3 py-2 whitespace-normal"><span className="font-semibold text-gray-900">{row.name}</span> {!row.eligible && <span className="text-[10px] text-gray-400">(not eligible)</span>}</TableCell>
                    <TableCell className="px-2 py-2 text-right">{fmtKES(b.gross)}</TableCell>
                    <TableCell className="px-2 py-2 text-right text-amber-700">{b.advances ? `−${fmtKES(b.advances)}` : '—'}</TableCell>
                    <TableCell className="px-2 py-2 text-right text-red-600">{b.fines ? `−${fmtKES(b.fines)}` : '—'}</TableCell>
                    <TableCell className="px-2 py-2 text-right font-bold">{fmtKES(b.net)}</TableCell>
                    <TableCell className="px-2 py-2 text-center">
                      {locked ? <span className="flex items-center justify-center gap-1 text-xs font-semibold text-green-700"><Lock className="w-3 h-3" /> {t('paid')}</span>
                        : row.payslip ? <span className="text-xs font-semibold text-amber-600">{t('pending')}</span>
                        : <span className="text-xs text-gray-400">{t('notRun')}</span>}
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right whitespace-nowrap">
                      {!locked && <button onClick={() => { const opening = addFor !== row.id; setAddFor(opening ? row.id : null); setEntryUuid(opening ? crypto.randomUUID() : null); }} className="text-xs font-semibold text-gray-600 hover:underline mr-2">{t('addAdvFine')}</button>}
                      {row.payslip && !locked && <button onClick={() => pay(row.id)} disabled={busy !== ''} className="text-xs font-semibold text-green-700 hover:underline mr-2">{t('pay')}</button>}
                      <button onClick={() => payslipPdf(row)} className="text-xs font-semibold text-gray-500 hover:underline mr-2">{t('payslip')}</button>
                      <button onClick={() => yearPdf(row)} disabled={busy !== ''} className="text-xs font-semibold text-gray-500 hover:underline">{busy === `year:${row.id}` ? '…' : t('yearStatement')}</button>
                    </TableCell>
                  </TableRow>
                  {addFor === row.id && !locked && (
                    <TableRow className="bg-gray-50/70 hover:bg-gray-50/70"><TableCell colSpan={7} className="px-3 py-3 whitespace-normal">
                      <div className="flex flex-wrap items-end gap-2">
                        <select value={entry.type} onChange={e => setEntry({ ...entry, type: e.target.value })} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                          <option value="advance">{t('advance')}</option><option value="fine">{t('fines')}</option><option value="bonus">{t('bonus')}</option><option value="adjustment">{t('adjustment')}</option>
                        </select>
                        <input type="number" min={entry.type === 'adjustment' ? undefined : 0} placeholder={t('amount')} value={entry.amount} onChange={e => setEntry({ ...entry, amount: e.target.value })} className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                        <input placeholder="Note (e.g. lateness)" value={entry.note} onChange={e => setEntry({ ...entry, note: e.target.value })} className="flex-1 min-w-[140px] border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                        <button onClick={() => addEntry(row.id)} disabled={busy !== ''} className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-semibold disabled:opacity-50">Add</button>
                      </div>
                      {row.ledger.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-1">
                          {row.ledger.map(l => (
                            <li key={l.id} className="text-xs text-gray-600 flex items-center gap-2">
                              <span className="capitalize font-semibold">{l.type}</span> {fmtKES(l.amount)} {l.note && <span className="text-gray-400">· {l.note}</span>} <span className="text-gray-300">{l.date}</span>
                              <button onClick={() => delEntry(l.id)} className="text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell></TableRow>
                  )}
                </React.Fragment>
              );
            })}
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="px-3 py-6 text-center text-gray-400 whitespace-normal">No employees. Add staff with a salary on the People page.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-gray-400">Tip: add advances/fines first, then “Run payroll”, check the nets, then “Pay”. A paid month is locked — changing a salary only affects future months.</p>
    </div>
  );
}
