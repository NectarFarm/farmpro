'use client';
import React, { useEffect, useState } from 'react';
import { periodLabel } from '@/lib/payslip';

const fmtKES = (n: number) => `KSh ${n.toLocaleString('en-KE')}`;
interface Slip { period: string; gross: number; advances: number; fines: number; bonuses: number; net: number; status: string }
interface Data {
  employee: { name: string; salary: number; payDay: number | null; paymentsFrom: string | null } | null;
  paidTotal: number; monthsPaid: number; monthsSinceStart: number; outstandingAdvance: number; payslips: Slip[];
}

export default function MyPayPage() {
  const [d, setD] = useState<Data | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/payroll/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(setD).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <div className="p-4 text-gray-400">Loading…</div>;
  if (!d?.employee) return <div className="p-4 text-gray-500 text-sm">No pay record is linked to your account yet. Ask the farm owner.</div>;

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="bg-green-700 text-white rounded-2xl px-5 py-4">
        <p className="text-green-200 text-xs">Paid to date{d.employee.paymentsFrom ? ` · since ${periodLabel(d.employee.paymentsFrom)}` : ''}</p>
        <p className="text-3xl font-bold">{fmtKES(d.paidTotal)}</p>
        <p className="text-green-200 text-sm mt-1">{d.monthsPaid} month{d.monthsPaid === 1 ? '' : 's'} paid · salary {fmtKES(d.employee.salary)}/mo{d.employee.payDay ? ` · pay day ${d.employee.payDay}` : ''}</p>
      </div>

      {d.outstandingAdvance > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-amber-800 text-sm font-semibold">
          Outstanding advance: {fmtKES(d.outstandingAdvance)}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b font-bold text-gray-800 text-sm">My payslips</div>
        {d.payslips.length === 0
          ? <p className="px-4 py-6 text-center text-gray-400 text-sm">No payslips yet.</p>
          : (
            <ul className="divide-y divide-gray-100">
              {d.payslips.map(s => (
                <li key={s.period} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{periodLabel(s.period)}</p>
                    <p className="text-xs text-gray-400">
                      gross {fmtKES(s.gross)}{s.advances ? ` · adv −${fmtKES(s.advances)}` : ''}{s.fines ? ` · fine −${fmtKES(s.fines)}` : ''}{s.bonuses ? ` · bonus +${fmtKES(s.bonuses)}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-gray-900">{fmtKES(s.net)}</p>
                    <p className={`text-xs font-semibold ${s.status === 'paid' ? 'text-green-600' : 'text-amber-600'}`}>{s.status === 'paid' ? '✓ paid' : 'pending'}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
