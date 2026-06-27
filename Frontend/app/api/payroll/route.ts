import { db } from '@/db';
import { employees, payslips, employeeLedger } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, created, badRequest, unauthorized, forbidden } from '@/lib/server/http';
import { computePayslip, validPeriod, currentPeriod, type LedgerEntry, type LedgerType } from '@/lib/payslip';

const ALLOWED = ['owner', 'manager'];
const LEDGER_TYPES: LedgerType[] = ['advance', 'fine', 'bonus', 'adjustment'];

async function slipFor(tenantId: string, employeeId: string, period: string) {
  const [s] = await db.select().from(payslips)
    .where(and(eq(payslips.tenantId, tenantId), eq(payslips.employeeId, employeeId), eq(payslips.period, period))).limit(1);
  return s ?? null;
}
async function ledgerFor(tenantId: string, employeeId: string, period: string) {
  return db.select().from(employeeLedger)
    .where(and(eq(employeeLedger.tenantId, tenantId), eq(employeeLedger.employeeId, employeeId), eq(employeeLedger.period, period)));
}
const asEntries = (rows: { type: string; amount: number }[]): LedgerEntry[] => rows.map((r) => ({ type: r.type as LedgerType, amount: r.amount }));

// GET /api/payroll?period=YYYY-MM — every employee with their payslip (if any),
// a LIVE preview of what they'd be paid, and the month's ledger entries.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const tenantId = session.tenantId;
  const period = new URL(req.url).searchParams.get('period') || currentPeriod(new Date());
  if (!validPeriod(period)) return badRequest('Invalid period (use YYYY-MM).');

  const emps = await db.select().from(employees).where(eq(employees.tenantId, tenantId));
  const out = [];
  let totGross = 0, totNet = 0, totFines = 0, paidCount = 0;
  for (const e of emps) {
    const slip = await slipFor(tenantId, e.id, period);
    const ledger = await ledgerFor(tenantId, e.id, period);
    const preview = computePayslip(e.salary, asEntries(ledger));
    const eligible = e.active && e.salary > 0 && (!e.paymentsFrom || e.paymentsFrom <= period);
    out.push({
      id: e.id, name: e.name, role: e.role, salary: e.salary, active: e.active, paymentsFrom: e.paymentsFrom, eligible,
      payslip: slip ? { gross: slip.gross, advances: slip.advances, fines: slip.fines, bonuses: slip.bonuses, net: slip.net, status: slip.status, paidAt: slip.paidAt } : null,
      preview,
      ledger: ledger.map((l) => ({ id: l.id, type: l.type, amount: l.amount, note: l.note, date: l.date })),
    });
    if (slip) { totGross += slip.gross; totNet += slip.net; totFines += slip.fines; if (slip.status === 'paid') paidCount++; }
  }
  return ok({ period, employees: out, summary: { gross: Math.round(totGross * 100) / 100, net: Math.round(totNet * 100) / 100, fines: Math.round(totFines * 100) / 100, paid: paidCount, withSlip: out.filter((o) => o.payslip).length } });
}

// POST /api/payroll  { action: 'run'|'pay'|'ledger'|'deleteLedger', ... }
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const tenantId = session.tenantId;
  const body = (await req.json().catch(() => ({}))) as { action?: string; period?: string; employeeId?: string; type?: LedgerType; amount?: number; note?: string; ledgerId?: string };
  const now = new Date().toISOString();
  const { audit, actorLabel } = await import('@/lib/server/audit');

  if (body.action === 'run') {
    const period = body.period || currentPeriod(new Date());
    if (!validPeriod(period)) return badRequest('Invalid period.');
    const emps = await db.select().from(employees).where(eq(employees.tenantId, tenantId));
    let generated = 0;
    for (const e of emps) {
      if (!(e.active && e.salary > 0 && (!e.paymentsFrom || e.paymentsFrom <= period))) continue;
      const existing = await slipFor(tenantId, e.id, period);
      if (existing?.status === 'paid') continue; // locked — never rewrite a disbursed month
      const b = computePayslip(e.salary, asEntries(await ledgerFor(tenantId, e.id, period)));
      if (existing) {
        await db.update(payslips).set({ gross: b.gross, advances: b.advances, fines: b.fines, bonuses: b.bonuses, net: b.net })
          .where(eq(payslips.id, existing.id));
      } else {
        await db.insert(payslips).values({ id: crypto.randomUUID(), tenantId, employeeId: e.id, period, gross: b.gross, advances: b.advances, fines: b.fines, bonuses: b.bonuses, net: b.net, status: 'pending', paidAt: null, createdAt: now });
      }
      generated++;
    }
    await audit({ tenantId, actor: actorLabel(session), action: 'payroll.run', meta: { period, employees: generated } });
    return ok({ period, generated });
  }

  if (body.action === 'pay') {
    const period = body.period;
    if (!validPeriod(period)) return badRequest('Invalid period.');
    const where = body.employeeId
      ? and(eq(payslips.tenantId, tenantId), eq(payslips.period, period!), eq(payslips.employeeId, body.employeeId))
      : and(eq(payslips.tenantId, tenantId), eq(payslips.period, period!), eq(payslips.status, 'pending'));
    await db.update(payslips).set({ status: 'paid', paidAt: now }).where(where);
    await audit({ tenantId, actor: actorLabel(session), action: 'payroll.pay', meta: { period, employeeId: body.employeeId ?? 'all' } });
    return ok({ period, paid: true });
  }

  if (body.action === 'ledger') {
    const { employeeId, type, note } = body;
    const period = body.period;
    const amount = Number(body.amount);
    if (!employeeId || !type || !LEDGER_TYPES.includes(type)) return badRequest('employeeId and a valid type are required.');
    if (!validPeriod(period)) return badRequest('Invalid period.');
    if (!Number.isFinite(amount) || amount === 0) return badRequest('Enter an amount.');
    if (type !== 'adjustment' && amount < 0) return badRequest('Amount must be positive.');
    // Can't change a month that's already been paid out.
    const slip = await slipFor(tenantId, employeeId, period!);
    if (slip?.status === 'paid') return badRequest('That month is already paid and locked. Use the next month.');
    await db.insert(employeeLedger).values({ id: crypto.randomUUID(), tenantId, employeeId, type, amount, note: note ?? null, period: period!, date: now.slice(0, 10), createdAt: now });
    // Keep the pending payslip (if generated) in step.
    if (slip) {
      const b = computePayslip(slip.gross, asEntries(await ledgerFor(tenantId, employeeId, period!)));
      await db.update(payslips).set({ advances: b.advances, fines: b.fines, bonuses: b.bonuses, net: b.net }).where(eq(payslips.id, slip.id));
    }
    await audit({ tenantId, actor: actorLabel(session), action: `payroll.${type}`, entity: employeeId, meta: { period, amount } });
    return created({ ok: true });
  }

  if (body.action === 'deleteLedger') {
    if (!body.ledgerId) return badRequest('ledgerId required');
    const [entry] = await db.select().from(employeeLedger).where(and(eq(employeeLedger.tenantId, tenantId), eq(employeeLedger.id, body.ledgerId))).limit(1);
    if (!entry) return ok({ ok: true });
    const slip = await slipFor(tenantId, entry.employeeId, entry.period);
    if (slip?.status === 'paid') return badRequest('That month is already paid and locked.');
    await db.delete(employeeLedger).where(eq(employeeLedger.id, entry.id));
    if (slip) {
      const b = computePayslip(slip.gross, asEntries(await ledgerFor(tenantId, entry.employeeId, entry.period)));
      await db.update(payslips).set({ advances: b.advances, fines: b.fines, bonuses: b.bonuses, net: b.net }).where(eq(payslips.id, slip.id));
    }
    return ok({ ok: true });
  }

  return badRequest('Unknown action.');
}
