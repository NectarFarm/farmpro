import { db } from '@/db';
import { users, employees, payslips, employeeLedger } from '@/db/schemas';
import { and, eq, desc } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, unauthorized } from '@/lib/server/http';
import { monthsBetween, currentPeriod } from '@/lib/payslip';

// GET /api/payroll/me — the signed-in worker's own pay: payslips, advances/fines,
// cumulative net and months paid. The worker (a users row) is matched to their
// employee record by phone within the same farm.
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  const tenantId = session.tenantId;

  const [u] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, session.userId)).limit(1);
  const [emp] = u?.phone
    ? await db.select().from(employees).where(and(eq(employees.tenantId, tenantId), eq(employees.phone, u.phone))).limit(1)
    : [];
  if (!emp) return ok({ employee: null, payslips: [], outstandingAdvance: 0, paidTotal: 0, monthsPaid: 0 });

  const slips = await db.select().from(payslips)
    .where(and(eq(payslips.tenantId, tenantId), eq(payslips.employeeId, emp.id))).orderBy(desc(payslips.period));
  const ledger = await db.select().from(employeeLedger)
    .where(and(eq(employeeLedger.tenantId, tenantId), eq(employeeLedger.employeeId, emp.id)));

  const paid = slips.filter((s) => s.status === 'paid');
  const paidTotal = Math.round(paid.reduce((s, p) => s + p.net, 0) * 100) / 100;
  const r2 = (n: number) => Math.round(n * 100) / 100;

  return ok({
    employee: { name: emp.name, salary: emp.salary, payDay: emp.payDay, paymentsFrom: emp.paymentsFrom },
    paidTotal,
    monthsPaid: paid.length,
    monthsSinceStart: emp.paymentsFrom ? monthsBetween(emp.paymentsFrom, currentPeriod(new Date())) : paid.length,
    outstandingAdvance: r2(ledger.filter((l) => l.type === 'advance').reduce((s, l) => s + l.amount, 0)),
    payslips: slips.map((s) => ({ period: s.period, gross: s.gross, advances: s.advances, fines: s.fines, bonuses: s.bonuses, net: s.net, status: s.status, paidAt: s.paidAt })),
    ledger: ledger.map((l) => ({ type: l.type, amount: l.amount, note: l.note, period: l.period, date: l.date })),
  });
}
