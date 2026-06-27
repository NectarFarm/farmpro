'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { currentPeriod, periodLabel } from '@/lib/payslip';

const fmtKES = (n: number) => `KSh ${n.toLocaleString('en-KE')}`;
type Slip = { gross: number; advances: number; fines: number; bonuses: number; net: number; status: 'pending' | 'paid'; paidAt: string | null } | null;
interface Row {
  id: string; name: string; role: string; salary: number; active: boolean; eligible: boolean; paymentsFrom: string | null;
  payslip: Slip; preview: { gross: number; advances: number; fines: number; bonuses: number; net: number };
  ledger: { id: string; type: string; amount: number; note: string | null; date: string }[];
}
interface Summary { gross: number; net: number; fines: number; paid: number; withSlip: number }

export default function PayrollPage() {
  const [period, setPeriod] = useState(currentPeriod(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [addFor, setAddFor] = useState<string | null>(null);
  const [entry, setEntry] = useState({ type: 'advance', amount: '', note: '' });

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
    if (!amount) { setErr('Enter an amount.'); return; }
    if (await post({ action: 'ledger', employeeId, period, type: entry.type, amount, note: entry.note }, `add:${employeeId}`)) {
      setAddFor(null); setEntry({ type: 'advance', amount: '', note: '' });
    }
  };
  const delEntry = (ledgerId: string) => post({ action: 'deleteLedger', ledgerId }, `del:${ledgerId}`);

  const payslipPdf = async (row: Row) => {
    const b = row.payslip ?? row.preview;
    const { exportReport } = await import('@/lib/export');
    await exportReport({
      title: `Payslip — ${row.name}`,
      columns: ['Line', 'Amount (KSh)'],
      rows: [
        ['Gross salary', b.gross], ['Advances', -b.advances], ['Fines', -b.fines], ['Bonuses', b.bonuses],
        ['NET PAY', b.net],
      ],
      meta: { Employee: row.name, Period: periodLabel(period), Status: row.payslip?.status ?? 'preview', Paid: row.payslip?.paidAt ? new Date(row.payslip.paidAt).toLocaleDateString('en-KE') : '—' },
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
        title: `${year} pay statement — ${row.name}`,
        columns: ['Month', 'Gross', 'Advances', 'Fines', 'Bonuses', 'Net', 'Status'],
        rows: [
          ...d.payslips.map((p: { period: string; gross: number; advances: number; fines: number; bonuses: number; net: number; status: string }) =>
            [periodLabel(p.period), p.gross, p.advances, p.fines, p.bonuses, p.net, p.status.toUpperCase()]),
          ['TOTAL', d.totals.gross, d.totals.advances, d.totals.fines, d.totals.bonuses, d.totals.net, `${d.totals.paidMonths} paid`],
        ],
        meta: { Employee: row.name, Year: year, 'Months paid': d.totals.paidMonths },
      }, 'PDF');
    } catch { setErr('Could not build the year statement.'); } finally { setBusy(''); }
  };

  return (
    <div className="p-6 flex flex-col gap-5 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">💵 Payroll</h1>
          <p className="text-gray-500 text-sm">Run monthly pay, record advances & fines, lock a paid month, print payslips.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          <button onClick={runPayroll} disabled={busy !== ''} className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">{busy === 'run' ? 'Running…' : 'Run payroll'}</button>
        </div>
      </div>

      {err && <p className="text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm font-semibold">{err}</p>}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[['Gross', summary.gross], ['Net to pay', summary.net], ['Fines (income)', summary.fines], ['Paid', summary.paid]].map(([l, v]) => (
            <div key={l as string} className="bg-white border border-gray-200 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500">{l}</p>
              <p className="text-lg font-bold text-gray-900">{l === 'Paid' ? `${v}/${summary.withSlip}` : fmtKES(v as number)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
          <span className="font-bold text-gray-800 text-sm">{periodLabel(period)}</span>
          <button onClick={payAll} disabled={busy !== ''} className="text-xs font-semibold text-green-700 hover:underline">Mark all paid</button>
        </div>
        <table className="w-full text-sm">
          <thead className="text-gray-500 text-xs font-semibold border-b">
            <tr><th className="px-3 py-2 text-left">Employee</th><th className="px-2 py-2 text-right">Gross</th><th className="px-2 py-2 text-right">Adv</th><th className="px-2 py-2 text-right">Fines</th><th className="px-2 py-2 text-right">Net</th><th className="px-2 py-2 text-center">Status</th><th className="px-2 py-2"></th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(row => {
              const b = row.payslip ?? row.preview;
              const locked = row.payslip?.status === 'paid';
              return (
                <React.Fragment key={row.id}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-3 py-2"><span className="font-semibold text-gray-900">{row.name}</span> {!row.eligible && <span className="text-[10px] text-gray-400">(not eligible)</span>}</td>
                    <td className="px-2 py-2 text-right">{fmtKES(b.gross)}</td>
                    <td className="px-2 py-2 text-right text-amber-700">{b.advances ? `−${fmtKES(b.advances)}` : '—'}</td>
                    <td className="px-2 py-2 text-right text-red-600">{b.fines ? `−${fmtKES(b.fines)}` : '—'}</td>
                    <td className="px-2 py-2 text-right font-bold">{fmtKES(b.net)}</td>
                    <td className="px-2 py-2 text-center">
                      {locked ? <span className="text-xs font-semibold text-green-700">🔒 Paid</span>
                        : row.payslip ? <span className="text-xs font-semibold text-amber-600">Pending</span>
                        : <span className="text-xs text-gray-400">— run —</span>}
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {!locked && <button onClick={() => setAddFor(addFor === row.id ? null : row.id)} className="text-xs font-semibold text-gray-600 hover:underline mr-2">+ Adv/Fine</button>}
                      {row.payslip && !locked && <button onClick={() => pay(row.id)} disabled={busy !== ''} className="text-xs font-semibold text-green-700 hover:underline mr-2">Pay</button>}
                      <button onClick={() => payslipPdf(row)} className="text-xs font-semibold text-gray-500 hover:underline mr-2">Payslip</button>
                      <button onClick={() => yearPdf(row)} disabled={busy !== ''} className="text-xs font-semibold text-gray-500 hover:underline">{busy === `year:${row.id}` ? '…' : 'Year'}</button>
                    </td>
                  </tr>
                  {addFor === row.id && !locked && (
                    <tr className="bg-gray-50/70"><td colSpan={7} className="px-3 py-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <select value={entry.type} onChange={e => setEntry({ ...entry, type: e.target.value })} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                          <option value="advance">Advance</option><option value="fine">Fine</option><option value="bonus">Bonus</option><option value="adjustment">Adjustment (±)</option>
                        </select>
                        <input type="number" placeholder="Amount" value={entry.amount} onChange={e => setEntry({ ...entry, amount: e.target.value })} className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                        <input placeholder="Note (e.g. lateness)" value={entry.note} onChange={e => setEntry({ ...entry, note: e.target.value })} className="flex-1 min-w-[140px] border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                        <button onClick={() => addEntry(row.id)} disabled={busy !== ''} className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-semibold disabled:opacity-50">Add</button>
                      </div>
                      {row.ledger.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-1">
                          {row.ledger.map(l => (
                            <li key={l.id} className="text-xs text-gray-600 flex items-center gap-2">
                              <span className="capitalize font-semibold">{l.type}</span> {fmtKES(l.amount)} {l.note && <span className="text-gray-400">· {l.note}</span>} <span className="text-gray-300">{l.date}</span>
                              <button onClick={() => delEntry(l.id)} className="text-red-400 hover:text-red-600">✕</button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">No employees. Add staff with a salary on the People page.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">Tip: add advances/fines first, then “Run payroll”, check the nets, then “Pay”. A paid month is locked — changing a salary only affects future months.</p>
    </div>
  );
}
