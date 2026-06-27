import { db } from '@/db';
import { employees, payslips } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, badRequest, unauthorized, forbidden } from '@/lib/server/http';
import { yearStatement } from '@/lib/payslip';

const ALLOWED = ['owner', 'manager'];

// GET /api/payroll/statement?employeeId=&year=YYYY — one employee's payslips for a
// year plus the totals, for the year-statement PDF.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const url = new URL(req.url);
  const employeeId = url.searchParams.get('employeeId');
  const year = url.searchParams.get('year') || String(new Date().getFullYear());
  if (!employeeId) return badRequest('employeeId required');

  const [emp] = await db.select().from(employees).where(and(eq(employees.tenantId, session.tenantId), eq(employees.id, employeeId))).limit(1);
  if (!emp) return badRequest('Unknown employee.');

  const slips = (await db.select().from(payslips)
    .where(and(eq(payslips.tenantId, session.tenantId), eq(payslips.employeeId, employeeId))))
    .filter((s) => s.period.startsWith(`${year}-`))
    .sort((a, b) => a.period.localeCompare(b.period));

  return ok({
    employee: { id: emp.id, name: emp.name, salary: emp.salary, paymentsFrom: emp.paymentsFrom },
    year,
    payslips: slips.map((s) => ({ period: s.period, gross: s.gross, advances: s.advances, fines: s.fines, bonuses: s.bonuses, net: s.net, status: s.status, paidAt: s.paidAt })),
    totals: yearStatement(slips, year),
  });
}
